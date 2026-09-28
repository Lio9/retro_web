/**
 * 主机 / 模拟器核心目录
 * EJS_core 使用 EmulatorJS 系统 ID；retroarchCore 可选指定具体 libretro 核心。
 * 默认策略：优先免 BIOS / HLE 友好核心。
 */
(function (global) {
  "use strict";

  /** 主流主机列表（覆盖常见卡带/光盘掌机） */
  const SYSTEMS = [
    {
      id: "nds",
      name: "Nintendo DS",
      accept: ".nds,.bin",
      cores: [
        { id: "desmume", label: "DeSmuME（免 BIOS，推荐）", needsBios: false },
        { id: "desmume2015", label: "DeSmuME 2015（免 BIOS）", needsBios: false },
        { id: "melonds", label: "melonDS（更准，需自备 BIOS）", needsBios: true },
      ],
      defaultCore: "desmume",
      note: "无 BIOS 也能玩；要高兼容请自备 bios7/9+firmware（自有机导出）",
    },
    {
      id: "gba",
      name: "Game Boy Advance",
      accept: ".gba,.bin,.zip",
      cores: [{ id: "mgba", label: "mGBA", needsBios: false }],
      defaultCore: "mgba",
      note: "mGBA 自带 HLE，无需 BIOS",
    },
    {
      id: "nes",
      name: "FC / NES",
      accept: ".nes,.zip",
      cores: [
        { id: "fceumm", label: "FCEUmm", needsBios: false },
        { id: "nestopia", label: "Nestopia", needsBios: false },
      ],
      defaultCore: "fceumm",
      note: "无需 BIOS",
    },
    {
      id: "snes",
      name: "SFC / SNES",
      accept: ".sfc,.smc,.zip",
      cores: [{ id: "snes9x", label: "Snes9x", needsBios: false }],
      defaultCore: "snes9x",
      note: "无需 BIOS",
    },
    {
      id: "gb",
      name: "Game Boy / GBC",
      accept: ".gb,.gbc,.zip",
      cores: [{ id: "gambatte", label: "Gambatte", needsBios: false }],
      defaultCore: "gambatte",
      note: "无需 BIOS",
    },
    {
      id: "segaMD",
      name: "Mega Drive / Genesis",
      accept: ".md,.gen,.smd,.bin,.zip",
      cores: [
        { id: "genesis_plus_gx", label: "Genesis Plus GX", needsBios: false },
        { id: "picodrive", label: "PicoDrive", needsBios: false },
      ],
      defaultCore: "genesis_plus_gx",
      note: "无需 BIOS",
    },
    {
      id: "segaMS",
      name: "Master System / GG",
      accept: ".sms,.gg,.zip",
      cores: [
        { id: "smsplus", label: "SMS Plus", needsBios: false },
        { id: "genesis_plus_gx", label: "Genesis Plus GX", needsBios: false },
      ],
      defaultCore: "smsplus",
      note: "无需 BIOS",
    },
    {
      id: "n64",
      name: "Nintendo 64",
      accept: ".n64,.z64,.v64,.zip",
      cores: [
        { id: "mupen64plus_next", label: "Mupen64Plus-Next", needsBios: false },
        { id: "parallel_n64", label: "ParaLLEl-N64", needsBios: false },
      ],
      defaultCore: "mupen64plus_next",
      note: "无需 BIOS；体积大加载稍慢",
    },
    {
      id: "psx",
      name: "PlayStation",
      accept: ".bin,.cue,.chd,.iso,.img",
      cores: [
        { id: "pcsx_rearmed", label: "PCSX ReARMed", needsBios: false },
        { id: "mednafen_psx_hw", label: "Beetle PSX HW", needsBios: false },
      ],
      defaultCore: "pcsx_rearmed",
      note: "无 BIOS 用 HLE；自备 SCPH BIOS 兼容更好（自有机/合法来源）",
    },
    {
      id: "pce",
      name: "PC Engine / TG16",
      accept: ".pce,.bin,.zip",
      cores: [{ id: "mednafen_pce", label: "Beetle PCE", needsBios: false }],
      defaultCore: "mednafen_pce",
      note: "无需 BIOS",
    },
    {
      id: "atari2600",
      name: "Atari 2600",
      accept: ".a26,.bin,.zip",
      cores: [{ id: "stella2014", label: "Stella 2014", needsBios: false }],
      defaultCore: "stella2014",
      note: "无需 BIOS",
    },
    {
      id: "vb",
      name: "Virtual Boy",
      accept: ".vb,.bin,.zip",
      cores: [{ id: "beetle_vb", label: "Beetle VB", needsBios: false }],
      defaultCore: "beetle_vb",
      note: "无需 BIOS",
    },
    {
      id: "lynx",
      name: "Atari Lynx",
      accept: ".lnx,.zip",
      cores: [{ id: "handy", label: "Handy", needsBios: false }],
      defaultCore: "handy",
      note: "可选 lynxboot.img，缺失时多数游戏仍可跑",
    },
    {
      id: "ws",
      name: "WonderSwan / Color",
      accept: ".ws,.wsc,.bin,.zip",
      cores: [{ id: "mednafen_wswan", label: "Beetle WonderSwan", needsBios: false }],
      defaultCore: "mednafen_wswan",
      note: "无需 BIOS",
    },
    {
      id: "ngp",
      name: "Neo Geo Pocket",
      accept: ".ngp,.ngc,.zip",
      cores: [{ id: "mednafen_ngp", label: "Beetle NGP", needsBios: false }],
      defaultCore: "mednafen_ngp",
      note: "无需 BIOS",
    },
  ];

  function getSystem(id) {
    return SYSTEMS.find((s) => s.id === id) || SYSTEMS[0];
  }

  /** 按文件名猜测主机（可选便利） */
  function guessSystem(filename) {
    const n = (filename || "").toLowerCase();
    if (n.endsWith(".nds")) return "nds";
    if (n.endsWith(".gba")) return "gba";
    if (n.endsWith(".nes")) return "nes";
    if (n.endsWith(".sfc") || n.endsWith(".smc")) return "snes";
    if (n.endsWith(".gb") || n.endsWith(".gbc")) return "gb";
    if (n.endsWith(".md") || n.endsWith(".gen") || n.endsWith(".smd")) return "segaMD";
    if (n.endsWith(".sms") || n.endsWith(".gg")) return "segaMS";
    if (n.endsWith(".n64") || n.endsWith(".z64") || n.endsWith(".v64")) return "n64";
    if (n.endsWith(".cue") || n.endsWith(".chd") || n.endsWith(".iso")) return "psx";
    if (n.endsWith(".pce")) return "pce";
    if (n.endsWith(".lnx")) return "lynx";
    if (n.endsWith(".ws") || n.endsWith(".wsc")) return "ws";
    if (n.endsWith(".ngp") || n.endsWith(".ngc")) return "ngp";
    return null;
  }

  global.EmuSystems = { SYSTEMS, getSystem, guessSystem };
})(typeof window !== "undefined" ? window : globalThis);
