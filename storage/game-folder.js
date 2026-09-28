/**
 * 游戏目录存档桥 —— 与 ROM 同文件夹自动读/写 .sav
 * 优先 File System Access API（Chrome/Edge），失败则回退多文件选择。
 */
(function (global) {
  "use strict";

  function log(msg, level) {
    if (typeof global.emitLog === "function") global.emitLog(msg, level || "ok");
  }

  function baseName(name) {
    return String(name || "").replace(/\.[^.]+$/, "");
  }

  function isSavName(name) {
    return /\.(sav|srm|mcr)$/i.test(name || "");
  }

  class GameFolder {
    constructor() {
      this.dirHandle = null;
      this.romHandle = null;
      this.romName = "";
      this.savHandle = null;
      this._saving = false;
    }

    get canWrite() {
      return !!(this.dirHandle && this.romName);
    }

    /**
     * 打开游戏文件夹并挑选 ROM
     * @returns {{romFile: File, savBytes: Uint8Array|null, romName: string}}
     */
    async pickFromDirectory() {
      if (!global.showDirectoryPicker) {
        throw new Error("当前浏览器不支持文件夹访问，请改用「选择 ROM」并多选 .sav");
      }
      const dir = await global.showDirectoryPicker({
        id: "retro-games",
        mode: "readwrite",
      });
      this.dirHandle = dir;

      const roms = [];
      const savs = [];
      for await (const [name, handle] of dir.entries()) {
        if (handle.kind !== "file") continue;
        if (isSavName(name)) {
          savs.push({ name, handle });
        } else if (/\.(nds|gba|nes|sfc|smc|gb|gbc|md|gen|sms|gg|n64|z64|v64|bin|cue|pce|lnx|ws|wsc|ngp|iso|img|zip)$/i.test(name)) {
          roms.push({ name, handle });
        }
      }
      if (!roms.length) throw new Error("所选文件夹里没有可识别的 ROM");

      // 简单选择：优先 .nds，否则第一个
      roms.sort((a, b) => {
        const an = /\.nds$/i.test(a.name) ? 0 : 1;
        const bn = /\.nds$/i.test(b.name) ? 0 : 1;
        return an - bn || a.name.localeCompare(b.name);
      });

      // 多 ROM 时用文件名提示后取第一个（后续可做成列表）
      if (roms.length > 1) {
        log(
          `文件夹中有 ${roms.length} 个 ROM，优先加载：${roms[0].name}`,
          "warn"
        );
      }

      const romEntry = roms[0];
      const romFile = await romEntry.handle.getFile();
      this.romHandle = romEntry.handle;
      this.romName = romEntry.name;

      // 同名 .sav
      let savBytes = null;
      const want = baseName(romEntry.name) + ".sav";
      const hit =
        savs.find((s) => s.name.toLowerCase() === want.toLowerCase()) ||
        savs.find((s) => baseName(s.name).toLowerCase() === baseName(romEntry.name).toLowerCase());
      if (hit) {
        const sf = await hit.handle.getFile();
        savBytes = new Uint8Array(await sf.arrayBuffer());
        this.savHandle = hit.handle;
        log(`已从游戏目录载入存档：${hit.name}（${savBytes.length} 字节）`, "ok");
      } else {
        // 准备同名 sav 句柄，便于写回
        try {
          this.savHandle = await dir.getFileHandle(want, { create: true });
        } catch (_) {
          this.savHandle = null;
        }
        log("游戏目录未发现同名 .sav，游玩后将自动写入", "warn");
      }

      return { romFile, savBytes, romName: romEntry.name };
    }

    /** 从多选文件中解析 ROM + 同名存档 */
    static pickFromFiles(fileList) {
      const files = Array.from(fileList || []);
      const roms = files.filter((f) => !isSavName(f.name));
      const savs = files.filter((f) => isSavName(f.name));
      if (!roms.length) throw new Error("未选择 ROM");
      const romFile = roms[0];
      let savFile =
        savs.find((s) => baseName(s.name).toLowerCase() === baseName(romFile.name).toLowerCase()) ||
        savs[0] ||
        null;
      return {
        romFile,
        savBytes: null,
        savFile,
        romName: romFile.name,
      };
    }

    /** 把电池档写回 ROM 同目录 */
    async writeSav(bytes) {
      if (!this.canWrite || !bytes || !bytes.length) return false;
      if (this._saving) return false;
      this._saving = true;
      try {
        const name = baseName(this.romName) + ".sav";
        let handle = this.savHandle;
        if (!handle) {
          handle = await this.dirHandle.getFileHandle(name, { create: true });
          this.savHandle = handle;
        }
        const w = await handle.createWritable();
        await w.write(bytes);
        await w.close();
        return true;
      } catch (err) {
        log("写回 .sav 失败：" + (err && err.message ? err.message : err), "warn");
        return false;
      } finally {
        this._saving = false;
      }
    }
  }

  /**
   * 从 EmulatorJS 导出电池档并写回目录
   */
  async function syncSavFromEmulator(folder) {
    if (!folder || !folder.canWrite) return false;
    const emu = global.EJS_emulator;
    if (!emu || !emu.gameManager) return false;
    try {
      const file = await emu.gameManager.getSaveFile();
      if (!file || !file.length) return false;
      const bytes = file instanceof Uint8Array ? file : new Uint8Array(file);
      const ok = await folder.writeSav(bytes);
      if (ok) log(`存档已写回游戏目录（${bytes.length} 字节）`, "ok");
      return ok;
    } catch (_) {
      return false;
    }
  }

  /** 把 .sav 注入 EmulatorJS 文件系统并加载 */
  function injectSavIntoEmulator(bytes) {
    if (!bytes || !bytes.length) return false;
    const emu = global.EJS_emulator;
    if (!emu || !emu.gameManager) return false;
    try {
      const gm = emu.gameManager;
      if (!gm.FS || typeof gm.getSaveFilePath !== "function") {
        log("模拟器存档接口尚未就绪", "warn");
        return false;
      }
      const path = gm.getSaveFilePath();
      const paths = String(path || "").split("/").filter(Boolean);
      let cp = "";
      for (let i = 0; i < paths.length - 1; i++) {
        cp += "/" + paths[i];
        try {
          if (!gm.FS.analyzePath(cp).exists) gm.FS.mkdir(cp);
        } catch (_) { /* ignore */ }
      }
      try {
        if (gm.FS.analyzePath(path).exists) gm.FS.unlink(path);
      } catch (_) { /* ignore */ }
      gm.FS.writeFile(path, bytes);
      if (typeof gm.loadSaveFiles === "function") gm.loadSaveFiles();
      log(`已将同目录存档载入游戏（${bytes.length} 字节）`, "ok");
      return true;
    } catch (err) {
      const msg = err && err.message ? err.message : JSON.stringify(err);
      log("注入存档失败：" + msg, "warn");
      return false;
    }
  }

  global.GameFolder = GameFolder;
  global.syncSavFromEmulator = syncSavFromEmulator;
  global.injectSavIntoEmulator = injectSavIntoEmulator;
})(typeof window !== "undefined" ? window : globalThis);
