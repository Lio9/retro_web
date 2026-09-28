/**
 * MelonBridge —— melonDS WASM 桥接层（P0 骨架）
 *
 * 职责：
 *  1. 加载 WASM 核心（或内置 DemoCore 演示）
 *  2. 双屏帧缓冲 blit 到上下 Canvas
 *  3. 键盘/触摸输入映射
 *  4. 电池存档 .sav 导出/导入
 *
 * 约定导出（接入真实 melonDS 时按实际符号名替换）：
 *  _nds_load_rom, _nds_run_frame, _nds_framebuffer_top/bottom,
 *  _nds_set_input, _nds_touch, _nds_sav_size, _nds_export_sav, _nds_import_sav,
 *  _nds_peek, _nds_reset, _nds_pause
 *
 * 说明：使用经典脚本挂到 window，兼容 file:// 直接打开与 http 预览。
 */
(function (global) {
"use strict";

class MelonBridge {
  constructor({ topCanvas, bottomCanvas }) {
    this.topCanvas = topCanvas;
    this.bottomCanvas = bottomCanvas;
    this.topCtx = topCanvas.getContext("2d", { alpha: false });
    this.bottomCtx = bottomCanvas.getContext("2d", { alpha: false });

    this.mod = null;
    this.demo = null;
    this.running = false;
    this.paused = false;
    this.romName = "";
    this.romBytes = null;
    this.romId = "";
    this.romHeaderTitle = "";
    this.mode = "idle"; // idle | demo | wasm

    this._raf = 0;
    this._last = 0;
    this._acc = 0;
    this._frameCount = 0;
    this._frameListeners = [];
    this._onLog = null;
  }

  log(msg, level = "ok") {
    this._onLog && this._onLog(msg, level);
  }

  /** 注册帧回调（支持多个监听器，避免被互相覆盖） */
  onFrame(fn) {
    if (typeof fn === "function") {
      this._frameListeners.push(fn);
    }
  }

  onLog(fn) {
    this._onLog = fn;
  }

  /**
   * 初始化。wasmUrl 存在则尝试加载真实核心，否则启动 DemoCore。
   * @param {{wasmUrl?: string, forceDemo?: boolean}} options
   */
  async init(options = {}) {
    const { wasmUrl, forceDemo = false } = options;

    // 未提供 WASM 或强制演示时，使用 DemoCore（保证 P0 UI 可独立预览）
    if (!wasmUrl || forceDemo) {
      this._initDemo();
      this.mode = "demo";
      this.log("已启动 DemoCore（未加载 melonDS WASM）。接入真实核心后调用 loadWasm()。", "warn");
      return { mode: "demo" };
    }

    try {
      await this.loadWasm(wasmUrl);
      this.mode = "wasm";
      this.log("melonDS WASM 加载成功。", "ok");
      return { mode: "wasm" };
    } catch (err) {
      this._initDemo();
      this.mode = "demo";
      this.log(`WASM 加载失败，回退 DemoCore：${err.message}`, "warn");
      return { mode: "demo", error: String(err) };
    }
  }

  /**
   * 加载真实 Emscripten/melonDS 模块。
   * 接入时：把 createModule 换成你的构建产物导出。
   */
  async loadWasm(wasmUrl) {
    // 占位：真实项目中替换为
    //   const factory = (await import("./melon.js")).default;
    //   this.mod = await factory({ locateFile: (p) => new URL(p, wasmUrl).href });
    const factory = globalThis.createModule || globalThis.createMelonModule;
    if (typeof factory !== "function") {
      throw new Error("未找到 WASM 模块工厂（createModule / createMelonModule）");
    }
    this.mod = await factory({
      locateFile: (p) => new URL(p, wasmUrl).href,
    });
    this.demo = null;
  }

  _initDemo() {
    this.demo = {
      t: 0,
      // 演示用双屏缓冲：256*192*4 RGBA
      top: new Uint8ClampedArray(256 * 192 * 4),
      bottom: new Uint8ClampedArray(256 * 192 * 4),
      input: 0,
      touch: { x: 0, y: 0, down: false },
      sav: new Uint8Array(512).fill(0),
    };
  }

  /** 加载 ROM：真实核心写入内存；DemoCore 解析头信息用于占位显示 */
  async loadRom(file) {
    const buf = new Uint8Array(await file.arrayBuffer());
    this.romName = file.name;
    this.romBytes = buf;
    this.romId = await this.computeRomId(buf);
    this.romHeaderTitle = this._parseNdsTitle(buf);

    if (this.mode === "wasm" && this.mod) {
      const ptr = this.mod._malloc(buf.length);
      this.mod.HEAPU8.set(buf, ptr);
      // 真实导出名以构建为准
      this.mod._nds_load_rom(ptr, buf.length);
      this.mod._free(ptr);
    }

    this.log(`已加载 ROM：${file.name}（${buf.length} 字节）`, "ok");
    if (this.romHeaderTitle) {
      this.log(`ROM 标题：${this.romHeaderTitle}`, "ok");
    }
    return {
      name: file.name,
      size: buf.length,
      romId: this.romId,
      title: this.romHeaderTitle || "",
    };
  }

  /**
   * 解析 NDS 头中的游戏标题（偏移 0x00，最长 12 字节 ASCII）。
   * 解析失败不报错，仅返回空串。
   */
  _parseNdsTitle(bytes) {
    try {
      if (!bytes || bytes.length < 12) return "";
      let s = "";
      for (let i = 0; i < 12; i++) {
        const c = bytes[i];
        if (c === 0) break;
        // 可打印 ASCII
        if (c >= 32 && c < 127) s += String.fromCharCode(c);
      }
      return s.trim();
    } catch (_) {
      return "";
    }
  }

  /** 稳定 ROM 标识：用于存档键；RA 哈希请单独按官方算法实现 */
  async computeRomId(bytes) {
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return [...new Uint8Array(digest)]
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }

  /** 按键映射：bit 位置与 UI 标签保持一致 */
  static KEY_BITS = {
    ArrowUp: 0,
    ArrowDown: 1,
    ArrowLeft: 2,
    ArrowRight: 3,
    KeyX: 4,
    KeyZ: 5,
    KeyA: 6,
    KeyS: 7,
    Enter: 8,
    ShiftLeft: 9,
    KeyQ: 10,
    KeyW: 11,
  };

  static KEY_LABELS = [
    ["ArrowUp", "上"],
    ["ArrowDown", "下"],
    ["ArrowLeft", "左"],
    ["ArrowRight", "右"],
    ["KeyX", "X"],
    ["KeyZ", "Y / B"],
    ["KeyA", "A"],
    ["KeyS", "B / A"],
    ["Enter", "Start"],
    ["ShiftLeft", "Select"],
    ["KeyQ", "L"],
    ["KeyW", "R"],
  ];

  bindKeyboard(onKeyState) {
    const held = new Set();

    window.addEventListener("keydown", (e) => {
      // 避免输入框抢焦点时触发
      const tag = (e.target && e.target.tagName) || "";
      if (tag === "INPUT" || tag === "TEXTAREA") return;

      const bit = MelonBridge.KEY_BITS[e.code];
      if (bit == null) return;
      e.preventDefault();
      if (held.has(e.code)) return;
      held.add(e.code);
      this._setInput(bit, 1);
      onKeyState && onKeyState(e.code, true);
    });

    window.addEventListener("keyup", (e) => {
      const bit = MelonBridge.KEY_BITS[e.code];
      if (bit == null) return;
      held.delete(e.code);
      this._setInput(bit, 0);
      onKeyState && onKeyState(e.code, false);
    });

    window.addEventListener("blur", () => {
      held.clear();
      for (let i = 0; i < 12; i++) this._setInput(i, 0);
      onKeyState && onKeyState(null, false);
    });
  }

  _setInput(bit, pressed) {
    if (this.mode === "wasm" && this.mod) {
      this.mod._nds_set_input(bit, pressed ? 1 : 0);
      return;
    }
    if (this.demo) {
      if (pressed) this.demo.input |= 1 << bit;
      else this.demo.input &= ~(1 << bit);
    }
  }

  /** 底屏触摸：把 CSS 像素映射到 256x192 */
  bindTouch() {
    const c = this.bottomCanvas;
    const toLocal = (ev) => {
      const r = c.getBoundingClientRect();
      const x = ((ev.clientX - r.left) / r.width) * 256;
      const y = ((ev.clientY - r.top) / r.height) * 192;
      return {
        x: Math.max(0, Math.min(255, Math.floor(x))),
        y: Math.max(0, Math.min(191, Math.floor(y))),
      };
    };

    c.addEventListener("pointerdown", (ev) => {
      c.setPointerCapture(ev.pointerId);
      const p = toLocal(ev);
      this._touch(p.x, p.y, 1);
    });
    c.addEventListener("pointermove", (ev) => {
      if (!ev.buttons) return;
      const p = toLocal(ev);
      this._touch(p.x, p.y, 1);
    });
    c.addEventListener("pointerup", () => this._touch(0, 0, 0));
    c.addEventListener("pointercancel", () => this._touch(0, 0, 0));
  }

  _touch(x, y, down) {
    if (this.mode === "wasm" && this.mod) {
      this.mod._nds_touch(x, y, down);
      return;
    }
    if (this.demo) {
      this.demo.touch = { x, y, down: !!down };
    }
  }

  /** 导出电池存档 .sav 字节 */
  extractSav() {
    if (this.mode === "wasm" && this.mod) {
      const size = this.mod._nds_sav_size();
      const ptr = this.mod._malloc(size);
      this.mod._nds_export_sav(ptr, size);
      const bytes = new Uint8Array(this.mod.HEAPU8.buffer, ptr, size).slice();
      this.mod._free(ptr);
      return bytes;
    }
    if (this.demo) {
      // 演示：把输入状态写入存档首字节，方便验证导入导出闭环
      const bytes = this.demo.sav.slice();
      bytes[0] = this.demo.input & 0xff;
      bytes[1] = (this.demo.input >> 8) & 0xff;
      bytes[2] = this._frameCount & 0xff;
      bytes[3] = (this._frameCount >> 8) & 0xff;
      return bytes;
    }
    return new Uint8Array(0);
  }

  /** 导入 .sav 到当前核心 */
  importSav(bytes) {
    if (this.mode === "wasm" && this.mod) {
      const ptr = this.mod._malloc(bytes.length);
      this.mod.HEAPU8.set(bytes, ptr);
      this.mod._nds_import_sav(ptr, bytes.length);
      this.mod._free(ptr);
      return true;
    }
    if (this.demo) {
      this.demo.sav = bytes.slice(0, Math.max(512, bytes.length));
      this.log(`DemoCore 已载入存档 ${bytes.length} 字节`, "ok");
      return true;
    }
    return false;
  }

  reset() {
    if (this.mode === "wasm" && this.mod && this.mod._nds_reset) {
      this.mod._nds_reset();
    } else if (this.demo) {
      this.demo.t = 0;
      this._frameCount = 0;
    }
    this.log("已复位", "ok");
  }

  setPaused(p) {
    this.paused = !!p;
  }

  /** 是否已加载 ROM：未加载时不推进帧、不调用核心 */
  get hasRom() {
    return !!(this.romBytes && this.romBytes.length > 0);
  }

  get stats() {
    return {
      mode: this.mode,
      romName: this.romName,
      romId: this.romId,
      frameCount: this._frameCount,
      running: this.running,
      paused: this.paused,
      hasRom: this.hasRom,
    };
  }

  _notifyFrame() {
    const stats = this.stats;
    for (let i = 0; i < this._frameListeners.length; i++) {
      try {
        this._frameListeners[i](stats);
      } catch (_) {
        /* 单个监听器异常不影响渲染 */
      }
    }
  }

  /** 双屏绘制 */
  blitFrame() {
    const w = 256;
    const h = 192;

    // 未加载 ROM：只画待机画面，不推进任何游戏状态
    if (!this.hasRom) {
      this._drawIdle(this.topCtx, "TOP");
      this._drawIdle(this.bottomCtx, "BOTTOM");
      this._notifyFrame();
      return;
    }

    if (this.mode === "wasm" && this.mod) {
      const topPtr = this.mod._nds_framebuffer_top();
      const botPtr = this.mod._nds_framebuffer_bottom();
      const top = new ImageData(
        new Uint8ClampedArray(this.mod.HEAPU8.buffer, topPtr, w * h * 4),
        w,
        h
      );
      const bot = new ImageData(
        new Uint8ClampedArray(this.mod.HEAPU8.buffer, botPtr, w * h * 4),
        w,
        h
      );
      this.topCtx.putImageData(top, 0, 0);
      this.bottomCtx.putImageData(bot, 0, 0);
      this._notifyFrame();
      return;
    }

    // DemoCore：绘制可辨识的双屏测试画面
    this._drawDemo(this.topCtx, this.demo.top, "TOP", this.demo.t);
    this._drawDemo(this.bottomCtx, this.demo.bottom, "BOTTOM", this.demo.t + 0.7);
    this._notifyFrame();
  }

  /** 在已绘制的画面上叠加文字说明（便于用户理解这是 Demo 而非游戏画面） */
  _drawOverlayText(ctx, label) {
    const title = this.romHeaderTitle || this.romName || "(no title)";
    ctx.save();
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    // 半透明底板，保证文字可读
    ctx.fillStyle = "rgba(8, 12, 20, 0.72)";
    ctx.fillRect(18, 70, 220, 56);

    ctx.fillStyle = label === "TOP" ? "#5b9dff" : "#3ddc97";
    ctx.font = "bold 13px sans-serif";
    ctx.fillText("DEMO CORE · 非真实游戏画面", 128, 86);

    ctx.fillStyle = "#e8eef7";
    ctx.font = "12px sans-serif";
    const shown = title.length > 22 ? title.slice(0, 21) + "…" : title;
    ctx.fillText(shown, 128, 106);

    ctx.fillStyle = "#93a4bb";
    ctx.font = "10px sans-serif";
    ctx.fillText(
      this.running && !this.paused
        ? (this.paused ? "PAUSED" : "SIMULATING @60fps")
        : "IDLE",
      128,
      148
    );
    ctx.restore();
  }

  /** 待机画面：静态占位，帧数保持 0 */
  _drawIdle(ctx, label) {
    const w = 256;
    const h = 192;
    const data = new Uint8ClampedArray(w * h * 4);
    const put = (x, y, r, g, b) => {
      if (x < 0 || y < 0 || x >= w || y >= h) return;
      const i = (y * w + x) * 4;
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = 255;
    };

    // 深色底 + 细网格
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        const grid = x % 16 === 0 || y % 16 === 0 ? 8 : 0;
        data[i] = 12 + grid;
        data[i + 1] = 18 + grid;
        data[i + 2] = 28 + grid * 2;
        data[i + 3] = 255;
      }
    }

    // 边框
    for (let x = 0; x < w; x++) {
      put(x, 1, 55, 70, 95);
      put(x, h - 2, 55, 70, 95);
    }
    for (let y = 0; y < h; y++) {
      put(1, y, 55, 70, 95);
      put(w - 2, y, 55, 70, 95);
    }

    // 中心提示条（不同屏不同色，便于辨认）
    const accent = label === "TOP" ? [91, 157, 255] : [61, 220, 151];
    for (let y = 88; y < 104; y++) {
      for (let x = 48; x < 208; x++) {
        put(x, y, accent[0] * 0.25, accent[1] * 0.25, accent[2] * 0.35);
      }
    }
    // 提示条左右短线
    for (let x = 48; x < 208; x++) {
      put(x, 88, accent[0], accent[1], accent[2]);
      put(x, 103, accent[0], accent[1], accent[2]);
    }

    ctx.putImageData(new ImageData(data, w, h), 0, 0);
    // 待机提示
    ctx.save();
    ctx.fillStyle = "#93a4bb";
    ctx.font = "12px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("等待加载 ROM…", 128, 128);
    ctx.restore();
  }

  _drawDemo(ctx, buffer, label, t) {
    const w = 256;
    const h = 192;
    const data = buffer;
    const input = this.demo ? this.demo.input : 0;
    const touch = this.demo ? this.demo.touch : { x: 0, y: 0, down: false };

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        const wave = Math.sin((x + t * 40) * 0.04) + Math.cos((y - t * 28) * 0.05);
        const base = 18 + (wave + 2) * 10;
        data[i] = base * 0.55;
        data[i + 1] = base * 0.85 + (label === "TOP" ? 12 : 0);
        data[i + 2] = base * 1.25 + (label === "BOTTOM" ? 24 : 8);
        data[i + 3] = 255;
      }
    }

    // 简单绘制网格与标签（直接改像素，避免依赖文字 API）
    const put = (x, y, r, g, b) => {
      if (x < 0 || y < 0 || x >= w || y >= h) return;
      const i = (y * w + x) * 4;
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = 255;
    };

    // 边框
    for (let x = 0; x < w; x++) {
      put(x, 2, 61, 220, 151);
      put(x, h - 3, 61, 220, 151);
    }
    for (let y = 0; y < h; y++) {
      put(2, y, 61, 220, 151);
      put(w - 3, y, 61, 220, 151);
    }

    // 中心十字与输入指示条
    for (let d = -30; d <= 30; d++) {
      put(w / 2 + d, h / 2, 91, 157, 255);
      put(w / 2, h / 2 + d, 91, 157, 255);
    }

    // 按键位指示
    for (let bit = 0; bit < 12; bit++) {
      const on = (input >> bit) & 1;
      const bx = 16 + (bit % 6) * 36;
      const by = 16 + Math.floor(bit / 6) * 18;
      const col = on ? [240, 180, 41] : [80, 100, 130];
      for (let yy = 0; yy < 8; yy++) {
        for (let xx = 0; xx < 28; xx++) {
          put(bx + xx, by + yy, col[0], col[1], col[2]);
        }
      }
    }

    // 触摸点
    if (touch.down) {
      for (let dy = -5; dy <= 5; dy++) {
        for (let dx = -5; dx <= 5; dx++) {
          if (dx * dx + dy * dy <= 25) {
            put(touch.x + dx, touch.y + dy, 255, 107, 107);
          }
        }
      }
    }

    ctx.putImageData(new ImageData(data, w, h), 0, 0);
    this._drawOverlayText(ctx, label);
  }

  start() {
    // 关键约束：没有 ROM 不进入模拟循环，避免帧数空转
    if (!this.hasRom) {
      this.log("请先加载 ROM，再启动模拟器", "warn");
      this.blitFrame();
      return false;
    }
    if (this.running) return true;
    this.running = true;
    this._last = performance.now();
    this._acc = 0;

    const step = (now) => {
      if (!this.running) return;

      const dt = now - this._last;
      this._last = now;
      // 仅在已加载 ROM 且未暂停时推进逻辑帧
      if (!this.paused && this.hasRom) {
        this._acc += dt;
        // 固定 60fps 逻辑步进
        while (this._acc >= 1000 / 60) {
          this._acc -= 1000 / 60;
          this._runFrame();
          this._frameCount++;
        }
      }
      this.blitFrame();
      this._raf = requestAnimationFrame(step);
    };
    this._raf = requestAnimationFrame(step);
    this.log("模拟器已启动", "ok");
    return true;
  }

  _runFrame() {
    // 双保险：无 ROM 绝不调用核心
    if (!this.hasRom) return;

    if (this.mode === "wasm" && this.mod) {
      this.mod._nds_run_frame();
      return;
    }
    if (this.demo) {
      this.demo.t += 1 / 60;
    }
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this._raf);
    this.log("模拟器已停止", "ok");
  }
}

global.MelonBridge = MelonBridge;
})(typeof window !== "undefined" ? window : globalThis);
