/**
 * EmulatorJS 真机加载器（本地自托管 + 可选 CDN 回退）
 * 真实 NDS：ROM + bios7 + bios9 + firmware → EmulatorJS(melonDS)
 * BIOS/ROM 必须用户自备，本项目不分发任何版权文件。
 */
(function (global) {
  "use strict";

  // 优先本地自托管，避免官方 CDN 在部分网络不可达
  const LOCAL_DATA = "vendor/emulatorjs/data/";
  const FALLBACK_CDN = "https://fastly.jsdelivr.net/gh/EmulatorJS/EmulatorJS@main/data/";
  const OFFICIAL_CDN = "https://cdn.emulatorjs.org/stable/data/";

  function log(msg, level) {
    if (typeof global.emitLog === "function") {
      global.emitLog(msg, level || "ok");
    }
  }

  function absoluteBase(rel) {
    try {
      return new URL(rel, location.href).href;
    } catch (_) {
      return rel;
    }
  }

  async function canFetch(url) {
    try {
      const res = await fetch(url, { method: "GET", cache: "no-store" });
      return res.ok;
    } catch (_) {
      return false;
    }
  }

  /** 选择可用 data 根目录：本地 → jsdelivr → 官方 CDN */
  async function resolveDataRoot() {
    const candidates = [LOCAL_DATA, FALLBACK_CDN, OFFICIAL_CDN];
    for (const c of candidates) {
      const base = absoluteBase(c);
      const loaderUrl = base + "loader.js";
      if (await canFetch(loaderUrl)) {
        log(`EmulatorJS 数据源：${base}`, "ok");
        return base.endsWith("/") ? base : base + "/";
      }
      log(`数据源不可用：${base}`, "warn");
    }
    throw new Error("无法加载 EmulatorJS（本地 vendor 与 CDN 均不可用）");
  }

  /** BIOS 三件套打成内存 zip */
  async function packBiosZip(bios7, bios9, firmware) {
    if (!global.JSZip) {
      throw new Error("JSZip 未加载，无法打包 BIOS");
    }
    const zip = new global.JSZip();
    zip.file("bios7.bin", bios7);
    zip.file("bios9.bin", bios9);
    zip.file("firmware.bin", firmware);
    return zip.generateAsync({ type: "blob" });
  }

  /**
   * 启动真实 EmulatorJS（多主机）
   * @param {object} options
   *  - mountEl, romFile
   *  - core: EmulatorJS 系统 id（nds/gba/nes/snes/...）
   *  - retroarchCore: 具体 libretro 核心（desmume/melonds/mgba/...）
   *  - bios7/bios9/firmware: 仅 NDS melonDS 需要
   *  - extraBios: 其他主机单文件 BIOS（可选）
   */
  async function startEmulatorJs(options) {
    const {
      mountEl,
      romFile,
      bios7,
      bios9,
      firmware,
      extraBios,
      onStatus,
      core = "nds",
      retroarchCore,
    } = options;

    const mount = typeof mountEl === "string" ? document.getElementById(mountEl) : mountEl;
    if (!mount) throw new Error("找不到模拟器挂载点");
    if (!mount.id) mount.id = "ejs-game";

    onStatus && onStatus("正在检测 EmulatorJS 数据源…");
    const dataRoot = await resolveDataRoot();

    let biosUrl = "";
    const isNds = core === "nds";
    const hasNdsBios = !!(bios7 && bios9 && firmware);
    const hasExtraBios = !!extraBios;

    if (isNds && hasNdsBios) {
      onStatus && onStatus("正在打包 NDS BIOS…");
      log("打包 bios7 / bios9 / firmware（仅在内存中）", "ok");
      const biosBlob = await packBiosZip(bios7, bios9, firmware);
      biosUrl = URL.createObjectURL(biosBlob);
    } else if (hasExtraBios) {
      log("使用自备单文件 BIOS：" + (extraBios.name || ""), "ok");
      biosUrl = URL.createObjectURL(extraBios);
    } else {
      log("未提供 BIOS：使用 HLE / 免 BIOS 核心", "ok");
    }

    const romUrl = URL.createObjectURL(romFile);
    const gameId =
      core + "_" + romFile.name.replace(/[^a-z0-9]/gi, "_").toLowerCase();

    // EmulatorJS 全局配置
    global.EJS_player = "#" + mount.id;
    global.EJS_core = core;
    if (biosUrl) global.EJS_biosUrl = biosUrl;
    else delete global.EJS_biosUrl;
    global.EJS_gameUrl = romUrl;
    global.EJS_gameName = romFile.name;
    global.EJS_gameID = gameId;
    global.EJS_pathtodata = dataRoot;
    global.EJS_startOnLoaded = true;
    global.EJS_language = "zh-CN";
    global.EJS_threads = false;
    // 底栏：仅底部滑入显示（仍会挂 click，启动后再打补丁）
    global.EJS_defaultOptions = Object.assign({}, global.EJS_defaultOptions || {}, {
      menubarBehavior: "downward",
      ...(retroarchCore ? { retroarch_core: retroarchCore } : {}),
    });

    const prev = document.getElementById("ejs-loader");
    if (prev) prev.remove();
    mount.innerHTML = "";

    onStatus && onStatus("正在加载 EmulatorJS / 核心 WASM…");
    log("加载 loader：" + dataRoot + "loader.js", "ok");

    await new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.id = "ejs-loader";
      script.src = dataRoot + "loader.js";
      script.onload = () => {
        onStatus && onStatus("模拟器已启动：" + romFile.name);
        log(`EmulatorJS 已加载（core=${core}${retroarchCore ? "/" + retroarchCore : ""}）`, "ok");
        // 延迟打菜单补丁，等 gameManager / menu 就绪
        setTimeout(() => {
          try {
            patchQuietMenubar(global.EJS_emulator);
          } catch (_) { /* ignore */ }
        }, 1200);
        resolve();
      };
      script.onerror = () => {
        const err = new Error("加载 EmulatorJS loader 失败：" + dataRoot);
        onStatus && onStatus(err.message);
        log(err.message, "err");
        reject(err);
      };
      document.body.appendChild(script);
    });

    return {
      gameId,
      romUrl,
      biosUrl,
      core,
      retroarchCore: retroarchCore || "",
      engine: "EmulatorJS/" + (retroarchCore || core),
      dataRoot,
      hasBios: hasNdsBios || hasExtraBios,
    };
  }

  function releaseUrls(urls) {
    (urls || []).forEach((u) => {
      try { URL.revokeObjectURL(u); } catch (_) { /* ignore */ }
    });
  }

  /**
   * 让 EmulatorJS 底栏更安静：
   *  - 点击游戏画面不再弹出
   *  - 仅底部热区悬停时显示，1.6s 自动收起
   */
  function patchQuietMenubar(emu) {
    if (!emu || !emu.elements || !emu.elements.parent) return false;
    const parent = emu.elements.parent;
    const menu = emu.elements.menu;
    if (!menu) return false;

    try {
      emu.menu && emu.menu.close && emu.menu.close();
    } catch (_) { /* ignore */ }

    let hideTimer = 0;
    const hide = () => {
      if (emu.paused || emu.settingsMenuOpen || emu.disksMenuOpen) return;
      menu.classList.add("ejs_menu_bar_hidden");
    };
    const show = (ms) => {
      clearTimeout(hideTimer);
      hideTimer = setTimeout(hide, ms || 1600);
      menu.classList.remove("ejs_menu_bar_hidden");
    };

    // 覆盖 menu API
    emu.menu = {
      close: () => {
        clearTimeout(hideTimer);
        menu.classList.add("ejs_menu_bar_hidden");
      },
      open: (force) => {
        if (!emu.started && force !== true) return;
        show(force === true ? 8000 : 1600);
      },
      toggle: () => {
        if (menu.classList.contains("ejs_menu_bar_hidden")) show(1600);
        else hide();
      },
    };

    // 底部热区（比原逻辑更可控）
    parent.style.position = parent.style.position || "relative";
    let hot = parent.querySelector(".nova-menubar-hot");
    if (!hot) {
      hot = document.createElement("div");
      hot.className = "nova-menubar-hot";
      hot.style.cssText =
        "position:absolute;left:0;right:0;bottom:0;height:14%;min-height:18px;z-index:10001;cursor:default;";
      parent.appendChild(hot);
    }
    hot.onmouseenter = () => show(2200);
    hot.onmousemove = () => {
      if (menu.classList.contains("ejs_menu_bar_hidden")) show(2200);
      else {
        clearTimeout(hideTimer);
        hideTimer = setTimeout(hide, 2200);
      }
    };
    hot.addEventListener("pointerenter", () => show(2200));
    hot.addEventListener("mousemove", () => show(2200));

    // 父级靠近底部也显示（兜底）
    parent.addEventListener("mousemove", (e) => {
      const rect = parent.getBoundingClientRect();
      const yRatio = (e.clientY - rect.top) / Math.max(rect.height, 1);
      if (yRatio >= 0.78) show(2000);
    });

    // 菜单悬停保持
    menu.addEventListener("mouseenter", () => clearTimeout(hideTimer));
    menu.addEventListener("mouseleave", () => {
      hideTimer = setTimeout(hide, 900);
    });

    // 点击画面：无条件收起（不保留 hover 判断，避免 EmulatorJS 反复 show）
    const hideNow = () => {
      clearTimeout(hideTimer);
      menu.classList.add("ejs_menu_bar_hidden");
    };

    parent.addEventListener(
      "click",
      (e) => {
        if (menu.contains(e.target)) return;
        if (emu.settingsMenuOpen || emu.disksMenuOpen) return;
        hideNow();
        setTimeout(hideNow, 20);
        setTimeout(hideNow, 120);
      },
      true
    );

    // 被 EmulatorJS 强行打开时，若指针不在底部热区则立刻关
    const mo = new MutationObserver(() => {
      if (menu.classList.contains("ejs_menu_bar_hidden")) return;
      if (emu.settingsMenuOpen || emu.disksMenuOpen) return;
      if (hot && hot.matches(":hover")) return;
      hideNow();
    });
    mo.observe(menu, { attributes: true, attributeFilter: ["class"] });

    menu.classList.add("ejs_menu_bar_hidden");
    log("底栏：底部悬停显示，点击画面自动收起", "ok");
    return true;
  }

  global.EjsNds = {
    startEmulatorJs,
    packBiosZip,
    releaseUrls,
    resolveDataRoot,
    patchQuietMenubar,
    LOCAL_DATA,
    FALLBACK_CDN,
    OFFICIAL_CDN,
  };
})(typeof window !== "undefined" ? window : globalThis);
