/**
 * NovaDS —— 纯净模拟器主逻辑
 * 主舞台=游戏；配置全在抽屉菜单
 */
(function () {
  "use strict";

  const {
    EjsNds,
    SaveStore,
    RaApi,
    EmuSystems,
    GameFolder,
    syncSavFromEmulator,
    injectSavIntoEmulator,
  } = window;

  const $ = (id) => document.getElementById(id);

  const ui = {
    topSub: $("top-sub"),
    raPill: $("ra-pill"),
    emptyState: $("empty-state"),
    gameWrap: $("game-wrap"),
    gameHost: $("game-host"),
    drawer: $("drawer"),
    drawerBackdrop: $("drawer-backdrop"),
    log: $("log"),
    romInput: $("rom-input"),
    romName: $("rom-name"),
    romRow: $("rom-row"),
    system: $("system-select"),
    systemNote: $("system-note"),
    core: $("core-select"),
    coreNote: $("core-note"),
    btnStart: $("btn-start"),
    btnStop: $("btn-stop"),
    btnOpenFolder: $("btn-open-folder"),
    chipMode: $("chip-mode"),
    chipState: $("chip-state"),
    chipSav: $("chip-sav"),
    raUserStat: $("ra-user-stat"),
    raHashStat: $("ra-hash-stat"),
    raGameStat: $("ra-game-stat"),
    raAchStat: $("ra-ach-stat"),
    raAchList: $("ra-ach-list"),
    raModal: $("ra-modal"),
    raModalError: $("ra-modal-error"),
    raUser: $("ra-user"),
    raPass: $("ra-pass"),
    raLoginBtn: $("ra-login-btn"),
  };

  const store = new SaveStore();
  const apiParam = new URLSearchParams(location.search).get("api");
  const ra = new RaApi({
    proxyBase: apiParam || localStorage.getItem("raProxyBase") || "/api/ra",
  });
  const folder = new GameFolder();

  let started = false;
  let currentRomFile = null;
  let currentRomName = "";
  let currentRomBytes = null;
  let pendingSavBytes = null;
  let savSyncTimer = 0;
  let identifyTimer = 0;
  let lastIdentifyKey = "";

  function log(msg, level) {
    if (!ui.log) return;
    const line = document.createElement("div");
    line.className = level || "ok";
    line.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
    ui.log.appendChild(line);
    ui.log.scrollTop = ui.log.scrollHeight;
    if (ui.topSub) ui.topSub.textContent = String(msg).slice(0, 42);
  }
  window.emitLog = log;

  function setChipState(text) {
    if (ui.chipState) ui.chipState.textContent = text;
  }

  /* ---------- 抽屉 ---------- */
  function openDrawer() {
    ui.drawer.classList.add("open");
    ui.drawerBackdrop.classList.add("open");
  }
  function closeDrawer() {
    ui.drawer.classList.remove("open");
    ui.drawerBackdrop.classList.remove("open");
  }

  /* ---------- 主机 / 核心 ---------- */
  function currentSystem() {
    return EmuSystems.getSystem(ui.system.value);
  }

  function fillSystems() {
    ui.system.innerHTML = "";
    EmuSystems.SYSTEMS.forEach((s) => {
      const opt = document.createElement("option");
      opt.value = s.id;
      opt.textContent = s.name;
      ui.system.appendChild(opt);
    });
    ui.system.value = "nds";
    fillCores();
  }

  function fillCores() {
    const sys = currentSystem();
    ui.core.innerHTML = "";
    sys.cores.forEach((c) => {
      const opt = document.createElement("option");
      opt.value = c.id;
      opt.textContent = c.label;
      ui.core.appendChild(opt);
    });
    ui.core.value = sys.defaultCore;
    if (ui.systemNote) ui.systemNote.textContent = sys.note || "";
    updateCoreNote();
    if (ui.romInput) ui.romInput.accept = sys.accept;
  }

  function updateCoreNote() {
    const sys = currentSystem();
    const c = sys.cores.find((x) => x.id === ui.core.value) || sys.cores[0];
    if (ui.coreNote) {
      ui.coreNote.textContent = c.needsBios ? "建议自备 BIOS" : "免 BIOS · 可直接启动";
    }
    if (ui.chipMode) ui.chipMode.textContent = `core ${sys.id}/${ui.core.value}`;
  }

  function markFileRow(input, rowId, nameId) {
    const f = input && input.files && input.files[0] ? input.files[0].name : "";
    const row = $(rowId);
    const nameEl = $(nameId);
    if (nameEl) nameEl.textContent = f || "未选择";
    if (row) row.classList.toggle("has-file", !!f);
    return !!f;
  }

  function refreshReady() {
    const hasRom = !!currentRomFile;
    ui.btnStart.disabled = !hasRom || started;
    return hasRom;
  }

  function showEmpty(show) {
    if (ui.emptyState) ui.emptyState.hidden = !show;
    if (ui.gameWrap) ui.gameWrap.hidden = show;
    if (!show && ui.gameHost && !ui.gameHost.childElementCount) {
      ui.gameWrap.hidden = false;
    }
  }

  /* ---------- 加载 ROM ---------- */
  async function adoptRom(romFile, savBytes) {
    currentRomFile = romFile;
    currentRomName = romFile.name;
    pendingSavBytes = savBytes || null;

    if (ui.romName) {
      ui.romName.textContent = currentRomName + (savBytes ? " + .sav" : "");
    }
    if (ui.romRow) ui.romRow.classList.add("has-file");

    const guess = EmuSystems.guessSystem(currentRomName);
    if (guess && ui.system.value !== guess) {
      ui.system.value = guess;
      fillCores();
      log(`主机：${currentSystem().name}`, "ok");
    }

    const cap = 8 * 1024 * 1024;
    if (romFile.size <= cap || currentSystem().id === "nds") {
      currentRomBytes = new Uint8Array(await romFile.arrayBuffer());
    } else {
      currentRomBytes = new Uint8Array(await romFile.slice(0, cap).arrayBuffer());
    }

    log(`ROM 就绪：${currentRomName}`, "ok");
    if (savBytes) log(`同目录存档 ${savBytes.length}B，启动时注入`, "ok");

    refreshReady();
    lastIdentifyKey = "";
    scheduleIdentify();
    setChipState("ready");
  }

  async function onOpenFolder() {
    try {
      setChipState("pick folder…");
      const picked = await folder.pickFromDirectory();
      await adoptRom(picked.romFile, picked.savBytes);
      closeDrawer();
      setChipState("ready");
    } catch (err) {
      const msg = String(err && err.message ? err.message : err);
      if (!/abort|cancel/i.test(msg)) log(msg, "err");
      setChipState("idle");
    }
  }

  async function onRomChange() {
    if (!ui.romInput.files || !ui.romInput.files.length) return;
    try {
      const picked = GameFolder.pickFromFiles(ui.romInput.files);
      let savBytes = null;
      if (picked.savFile) savBytes = new Uint8Array(await picked.savFile.arrayBuffer());
      await adoptRom(picked.romFile, savBytes);
    } catch (err) {
      log(String(err && err.message ? err.message : err), "err");
    }
  }

  function collectBios() {
    return {
      bios7: ($("bios7-input").files || [])[0] || null,
      bios9: ($("bios9-input").files || [])[0] || null,
      firmware: ($("fw-input").files || [])[0] || null,
      extra: ($("extra-bios-input").files || [])[0] || null,
    };
  }

  /* ---------- 启动 / 停止 ---------- */
  async function onStart() {
    if (!currentRomFile && !(ui.romInput.files && ui.romInput.files[0])) {
      log("请先选择 ROM", "warn");
      openDrawer();
      return;
    }
    const romFile = currentRomFile || ui.romInput.files[0];
    const sys = currentSystem();
    const retroarchCore = ui.core.value;
    const bios = collectBios();

    ui.btnStart.disabled = true;
    setChipState("loading…");
    showEmpty(false);

    try {
      const result = await EjsNds.startEmulatorJs({
        mountEl: ui.gameHost,
        romFile,
        bios7: bios.bios7,
        bios9: bios.bios9,
        firmware: bios.firmware,
        extraBios: bios.extra,
        core: sys.id,
        retroarchCore,
        onStatus: (t) => {
          setChipState(t);
        },
      });

      started = true;
      ui.btnStop.disabled = false;
      if (ui.chipMode) ui.chipMode.textContent = `${sys.id}/${retroarchCore}`;
      setChipState("running");
      log(`已启动 ${currentRomName || romFile.name}`, "ok");
      closeDrawer();

      if (pendingSavBytes) {
        const tryInject = (n) => {
          if (!injectSavIntoEmulator(pendingSavBytes) && n < 5) {
            setTimeout(() => tryInject(n + 1), 700);
          }
        };
        setTimeout(() => tryInject(1), 800);
      }

      startSavSync();
      scheduleIdentify();
    } catch (err) {
      setChipState("error");
      log(String(err && err.message ? err.message : err), "err");
      ui.btnStart.disabled = false;
      showEmpty(true);
    }
  }

  function onStop() {
    syncSavFromEmulator(folder).catch(() => {});
    clearInterval(savSyncTimer);
    if (ui.gameHost) ui.gameHost.innerHTML = "";
    const loader = document.getElementById("ejs-loader");
    if (loader) loader.remove();
    started = false;
    ui.btnStop.disabled = true;
    refreshReady();
    showEmpty(true);
    setChipState("stopped");
    log("已停止", "warn");
  }

  function startSavSync() {
    clearInterval(savSyncTimer);
    if (!folder.canWrite) {
      if (ui.chipSav) ui.chipSav.textContent = "sav memory";
      log("无文件夹写权限，存档暂存浏览器", "warn");
      return;
    }
    if (ui.chipSav) ui.chipSav.textContent = "sav → folder";
    savSyncTimer = setInterval(() => syncSavFromEmulator(folder), 8000);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") syncSavFromEmulator(folder);
    });
  }

  /* ---------- RA ---------- */
  function updateRaPill() {
    if (ra.isLoggedIn) {
      ui.raPill.className = "pill on";
      ui.raPill.querySelector("span").textContent = ra.username || "RA";
      if (ui.raUserStat) ui.raUserStat.textContent = ra.username;
      $("btn-ra-logout").disabled = false;
    } else {
      ui.raPill.className = "pill off";
      ui.raPill.querySelector("span").textContent = "RA";
      if (ui.raUserStat) ui.raUserStat.textContent = "未登录";
      $("btn-ra-logout").disabled = true;
    }
  }

  function openRaModal() {
    showRaError("");
    ui.raModal.hidden = false;
    ui.raUser.focus();
  }
  function closeRaModal() {
    ui.raModal.hidden = true;
  }
  function showRaError(msg) {
    ui.raModalError.textContent = msg || "";
    ui.raModalError.classList.toggle("show", !!msg);
  }

  async function onRaLogin() {
    const u = (ui.raUser.value || "").trim();
    const p = ui.raPass.value || "";
    if (!u || !p) {
      showRaError("请填写用户名与密码 / API Key");
      return;
    }
    ui.raLoginBtn.disabled = true;
    ui.raLoginBtn.textContent = "登录中…";
    try {
      const data = await ra.login(u, p);
      const name = data.Username || data.username || u;
      updateRaPill();
      closeRaModal();
      log(`RA 已登录：${name}`, "ok");
      scheduleIdentify();
    } catch (err) {
      const msg = String(err && err.message ? err.message : err);
      showRaError(
        "登录失败：" +
          msg +
          "　若为 CORS/代理问题，启动 api/ 后使用 ?api=http://127.0.0.1:8080/api/ra"
      );
    } finally {
      ui.raLoginBtn.disabled = false;
      ui.raLoginBtn.textContent = "登录";
    }
  }

  function onRaLogout() {
    ra.logout();
    updateRaPill();
    log("已退出 RA", "warn");
  }

  function scheduleIdentify() {
    clearTimeout(identifyTimer);
    identifyTimer = setTimeout(doIdentify, 400);
  }

  async function doIdentify() {
    if (!currentRomBytes) return;
    const sys = currentSystem();
    if (!sys || sys.id !== "nds") {
      if (ui.raGameStat) ui.raGameStat.textContent = "—";
      return;
    }
    const key = currentRomName + ":" + currentRomBytes.length;
    if (key === lastIdentifyKey) return;
    lastIdentifyKey = key;
    try {
      const result = await ra.identifyAndLoad(currentRomBytes, { hardcore: false });
      if (ui.raHashStat) ui.raHashStat.textContent = result.gameHash.slice(0, 12) + "…";
      if (result.networkError && !result.gameId) {
        if (ui.raGameStat) ui.raGameStat.textContent = "网络不可达";
        return;
      }
      if (ui.raGameStat) {
        ui.raGameStat.textContent = result.supported
          ? `${result.title || "Game"} #${result.gameId}`
          : "未在 RA 库";
      }
      if (ui.raAchStat) ui.raAchStat.textContent = String(result.achievements.length);
      if (ui.raAchList) {
        if (!result.supported) {
          ui.raAchList.innerHTML = "哈希未登记";
        } else {
          const unlocks = new Set(
            (result.unlocks || []).map((u) => Number(u.ID || u.id || u.AchievementID || u))
          );
          ui.raAchList.innerHTML = result.achievements
            .slice(0, 30)
            .map((a) => {
              const d = unlocks.has(Number(a.id));
              return `<div>${d ? "✓ " : "· "}${escapeHtml(a.title)}</div>`;
            })
            .join("");
        }
      }
    } catch (_) {
      /* 静默，详情在弹窗 */
    }
  }

  function escapeHtml(s) {
    return String(s)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;");
  }

  /* ---------- 绑定 ---------- */
  function bind() {
    $("btn-menu").addEventListener("click", openDrawer);
    $("btn-menu-2").addEventListener("click", openDrawer);
    $("btn-close-drawer").addEventListener("click", closeDrawer);
    ui.drawerBackdrop.addEventListener("click", closeDrawer);

    ui.emptyState.addEventListener("click", () => {
      openDrawer();
    });
    ui.emptyState.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") openDrawer();
    });

    ui.btnOpenFolder.addEventListener("click", onOpenFolder);
    ui.btnStart.addEventListener("click", onStart);
    ui.btnStop.addEventListener("click", onStop);

    ui.romInput.addEventListener("change", onRomChange);
    $("rom-row").addEventListener("click", (e) => {
      if (e.target !== ui.romInput) ui.romInput.click();
    });
    $("bios7-row").addEventListener("click", (e) => {
      if (e.target.id !== "bios7-input") $("bios7-input").click();
    });
    $("bios9-row").addEventListener("click", (e) => {
      if (e.target.id !== "bios9-input") $("bios9-input").click();
    });
    $("fw-row").addEventListener("click", (e) => {
      if (e.target.id !== "fw-input") $("fw-input").click();
    });
    $("extra-bios-row").addEventListener("click", (e) => {
      if (e.target.id !== "extra-bios-input") $("extra-bios-input").click();
    });

    [
      ["bios7-input", "bios7-row", "bios7-name"],
      ["bios9-input", "bios9-row", "bios9-name"],
      ["fw-input", "fw-row", "fw-name"],
      ["extra-bios-input", "extra-bios-row", "extra-bios-name"],
    ].forEach(([input, row, name]) => {
      $(input).addEventListener("change", () => markFileRow($(input), row, name));
    });

    ui.system.addEventListener("change", () => {
      fillCores();
      lastIdentifyKey = "";
      scheduleIdentify();
    });
    ui.core.addEventListener("change", updateCoreNote);

    $("btn-ra-open").addEventListener("click", openRaModal);
    $("btn-ra-logout").addEventListener("click", onRaLogout);
    ui.raLoginBtn.addEventListener("click", onRaLogin);
    ui.raModal.querySelectorAll("[data-close]").forEach((el) => {
      el.addEventListener("click", closeRaModal);
    });
    ui.raPass.addEventListener("keydown", (e) => {
      if (e.key === "Enter") onRaLogin();
      if (e.key === "Escape") closeRaModal();
    });

    // ESC 关抽屉
    window.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        closeDrawer();
        closeRaModal();
      }
    });
  }

  document.addEventListener("DOMContentLoaded", async () => {
    fillSystems();
    bind();
    updateRaPill();
    refreshReady();
    showEmpty(true);
    if (location.protocol === "file:") {
      log("建议本地 HTTP 访问", "warn");
    }
    try {
      await store.requestPersistence();
    } catch (_) { /* ignore */ }
    log("就绪", "ok");
    setChipState("idle");
  });
})();
