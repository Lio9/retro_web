/**
 * RA Connect 客户端 —— 对齐 rcheevos / rhash 协议
 *
 * 端点（dorequest.php）：
 *   r=login2&u&p 或 t          → Token
 *   r=gameid&m=hash            → GameID（无需登录）
 *   r=patch&u&t&g&m            → 游戏与成就定义
 *   r=unlocks&u&t&g&h          → 用户已解锁
 *   r=startsession&u&t&g&h&m   → 会话
 *   r=awardachievement&u&t&a&h&m&o&v
 *
 * NDS 哈希（rhash hash_rom.c::rc_hash_nintendo_ds）：
 *   MD5( header[0:0x160] || arm9 || arm7 || icon[0:0xA00] )
 *   可选跳过 SuperCard 512 字节头。
 */
(function (global) {
  "use strict";

  const DEFAULT_HOST = "https://retroachievements.org";
  const CONSOLE_NDS = 18; // RC_CONSOLE_NINTENDO_DS

  /* ---------------- MD5（自包含，WebCrypto 不支持 MD5） ---------------- */
  function md5(strOrBytes) {
    const bytes = typeof strOrBytes === "string" ? utf8(strOrBytes) : strOrBytes;
    return md5Bytes(bytes);
  }

  function utf8(s) {
    return new TextEncoder().encode(s);
  }

  function md5Bytes(input) {
    // 标准 MD5
    const S = [
      7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
      5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
      4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
      6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
    ];
    const K = new Uint32Array(64);
    for (let i = 0; i < 64; i++) {
      K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296);
    }

    const ml = input.length;
    const withPad = new Uint8Array(((ml + 8) >> 6 << 6) + 64);
    withPad.set(input);
    withPad[ml] = 0x80;
    const bitLen = ml * 8;
    withPad[withPad.length - 8] = bitLen & 0xff;
    withPad[withPad.length - 7] = (bitLen >>> 8) & 0xff;
    withPad[withPad.length - 6] = (bitLen >>> 16) & 0xff;
    withPad[withPad.length - 5] = (bitLen >>> 24) & 0xff;

    let a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476;
    const M = new Uint32Array(16);

    for (let i = 0; i < withPad.length; i += 64) {
      for (let j = 0; j < 16; j++) {
        M[j] =
          withPad[i + j * 4] |
          (withPad[i + j * 4 + 1] << 8) |
          (withPad[i + j * 4 + 2] << 16) |
          (withPad[i + j * 4 + 3] << 24);
      }
      let A = a0, B = b0, C = c0, D = d0;
      for (let j = 0; j < 64; j++) {
        let F, g;
        if (j < 16) {
          F = (B & C) | (~B & D);
          g = j;
        } else if (j < 32) {
          F = (D & B) | (~D & C);
          g = (5 * j + 1) % 16;
        } else if (j < 48) {
          F = B ^ C ^ D;
          g = (3 * j + 5) % 16;
        } else {
          F = C ^ (B | ~D);
          g = (7 * j) % 16;
        }
        F = (F + A + K[j] + M[g]) | 0;
        A = D;
        D = C;
        C = B;
        B = (B + ((F << S[j]) | (F >>> (32 - S[j])))) | 0;
      }
      a0 = (a0 + A) | 0;
      b0 = (b0 + B) | 0;
      c0 = (c0 + C) | 0;
      d0 = (d0 + D) | 0;
    }

    const out = new Uint8Array(16);
    const vals = [a0, b0, c0, d0];
    for (let i = 0; i < 4; i++) {
      out[i * 4] = vals[i] & 0xff;
      out[i * 4 + 1] = (vals[i] >>> 8) & 0xff;
      out[i * 4 + 2] = (vals[i] >>> 16) & 0xff;
      out[i * 4 + 3] = (vals[i] >>> 24) & 0xff;
    }
    return toHex(out);
  }

  function toHex(buf) {
    let s = "";
    for (let i = 0; i < buf.length; i++) s += buf[i].toString(16).padStart(2, "0");
    return s;
  }

  /* ---------------- NDS 哈希（对齐 rhash） ---------------- */
  /**
   * @param {Uint8Array} bytes 完整 .nds
   * @returns {string} 32 位 hex MD5
   */
  function hashNdsRom(bytes) {
    if (!bytes || bytes.length < 512) {
      throw new Error("ROM 过小，不是合法 NDS");
    }

    let offset = 0;
    let header = bytes.subarray(0, 512);

    // SuperCard 头：2E 00 00 EA ... B0: 44 46 96 00
    if (
      header[0] === 0x2e &&
      header[1] === 0x00 &&
      header[2] === 0x00 &&
      header[3] === 0xea &&
      header[0xb0] === 0x44 &&
      header[0xb1] === 0x46 &&
      header[0xb2] === 0x96 &&
      header[0xb3] === 0x00
    ) {
      offset = 512;
      if (bytes.length < 1024) throw new Error("SuperCard 头后数据不足");
      header = bytes.subarray(512, 1024);
    }

    const u32 = (o) =>
      header[o] | (header[o + 1] << 8) | (header[o + 2] << 16) | (header[o + 3] << 24);

    const arm9Addr = u32(0x20) >>> 0;
    const arm9Size = u32(0x2c) >>> 0;
    const arm7Addr = u32(0x30) >>> 0;
    const arm7Size = u32(0x3c) >>> 0;
    const iconAddr = u32(0x68) >>> 0;

    if (arm9Size + arm7Size > 16 * 1024 * 1024) {
      throw new Error("ARM9/ARM7 尺寸异常，可能不是 NDS ROM");
    }

    const take = (fileOff, size, padTo) => {
      const start = fileOff + offset;
      const end = start + size;
      if (start > bytes.length) {
        const p = new Uint8Array(padTo || size);
        return p;
      }
      const slice = bytes.subarray(start, Math.min(end, bytes.length));
      if (padTo && slice.length < padTo) {
        const p = new Uint8Array(padTo);
        p.set(slice);
        return p;
      }
      return slice;
    };

    // 顺序与 rhash 一致：header 0x160 → arm9 → arm7 → icon 0xA00
    const parts = [];
    parts.push(header.subarray(0, 0x160));
    parts.push(take(arm9Addr, arm9Size));
    parts.push(take(arm7Addr, arm7Size));
    parts.push(take(iconAddr, 0xa00, 0xa00));

    let total = 0;
    for (const p of parts) total += p.length;
    const cat = new Uint8Array(total);
    let o = 0;
    for (const p of parts) {
      cat.set(p, o);
      o += p.length;
    }
    return md5Bytes(cat);
  }

  /* ---------------- HTTP：直连或经 Java 代理 ---------------- */
  class RaApi {
    /**
     * @param {{host?: string, proxyBase?: string|null, fetchImpl?: Function}} opts
     *  proxyBase 例如 "/api/ra"：有则走后端（推荐，避免 CORS/密钥暴露）
     */
    constructor(opts = {}) {
      this.host = (opts.host || DEFAULT_HOST).replace(/\/$/, "");
      // 默认同源 /api/ra；也可传绝对地址 http://127.0.0.1:8080/api/ra
      this.proxyBase = opts.proxyBase != null ? opts.proxyBase : "/api/ra";
      this.fetch = opts.fetchImpl || global.fetch.bind(global);
      this.username = "";
      this.token = "";
      this.userData = null;
      this._lastProxyError = "";
    }

    get isLoggedIn() {
      return !!(this.token && this.username);
    }

    async _dorequest(params, { useAuth = false } = {}) {
      const body = new URLSearchParams();
      for (const [k, v] of Object.entries(params)) {
        if (v != null && v !== "") body.set(k, String(v));
      }
      if (useAuth && this.token) {
        body.set("u", this.username);
        body.set("t", this.token);
      }

      // 代理优先；代理不存在时回退直连
      if (this.proxyBase) {
        try {
          const res = await this.fetch(this.proxyBase + "/dorequest", {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(Object.fromEntries(body.entries())),
          });
          const text = await res.text();
          if (res.ok) return parseRaJson(text);
          this._lastProxyError = "代理 HTTP " + res.status;
        } catch (proxyErr) {
          this._lastProxyError =
            "代理不可达（未启动 api/ 或路径不对）：" +
            (proxyErr && proxyErr.message ? proxyErr.message : proxyErr);
        }
      }

      // 直连：浏览器常因 CORS / RA 拒绝而 Failed to fetch
      try {
        const res = await this.fetch(this.host + "/dorequest.php", {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            Accept: "application/json, text/plain, */*",
          },
          body: body.toString(),
        });
        const text = await res.text();
        if (!res.ok) {
          return {
            Error: "ra-http-" + res.status,
            Message:
              res.status === 403
                ? "RA 服务器拒绝了当前网络/IP（403）。请换网络，或经 Java 代理中转。"
                : "RA 返回 HTTP " + res.status,
          };
        }
        return parseRaJson(text);
      } catch (directErr) {
        const proxyHint = this._lastProxyError ? this._lastProxyError + "；" : "";
        throw new Error(
          proxyHint +
            "直连 RA 失败：" +
            (directErr && directErr.message ? directErr.message : directErr) +
            "。原因通常是：1) 未启动 api/ 后端代理 2) 浏览器 CORS 拦截跨域 3) 当前网络被 RA 拒绝(403)。"
        );
      }
    }

    /** r=login2 */
    async login(username, password) {
      this.username = username;
      const data = await this._dorequest({
        r: "login2",
        u: username,
        p: password,
      });
      if (!data || data.Success === false || data.Error) {
        throw new Error(data && (data.Error || data.Message) ? (data.Error || data.Message) : "RA 登录失败");
      }
      this.token = data.Token || data.token;
      this.userData = data;
      return data;
    }

    logout() {
      this.username = "";
      this.token = "";
      this.userData = null;
    }

    /** r=gameid —— 哈希识别，无需登录 */
    async resolveHash(gameHash) {
      const data = await this._dorequest({ r: "gameid", m: gameHash });
      const id = data && (data.GameID || data.game_id || data.GameId);
      return Number(id) || 0;
    }

    /** r=patch —— 游戏 + 成就定义 */
    async fetchGamePatch(gameId, gameHash) {
      return this._dorequest(
        { r: "patch", g: gameId, m: gameHash },
        { useAuth: true }
      );
    }

    /** r=unlocks */
    async fetchUnlocks(gameId, hardcore = false) {
      return this._dorequest(
        { r: "unlocks", g: gameId, h: hardcore ? 1 : 0 },
        { useAuth: true }
      );
    }

    /** r=startsession */
    async startSession(gameId, gameHash, hardcore = false) {
      return this._dorequest(
        {
          r: "startsession",
          g: gameId,
          h: hardcore ? 1 : 0,
          m: gameHash,
        },
        { useAuth: true }
      );
    }

    /**
     * r=awardachievement
     * 签名 v = md5(id + username + hardcore [+ id + o])
     * 仅应在本地评估逻辑判定解锁后调用，禁止伪造。
     */
    async awardAchievement(achievementId, gameHash, hardcore = false, secondsSinceUnlock = 0) {
      if (!this.isLoggedIn) throw new Error("请先登录 RA");
      const id = Number(achievementId);
      const h = hardcore ? 1 : 0;
      let sigSrc = String(id) + this.username + String(h);
      if (secondsSinceUnlock) {
        sigSrc += String(id) + String(secondsSinceUnlock);
      }
      const v = md5(sigSrc);
      return this._dorequest(
        {
          r: "awardachievement",
          a: id,
          h,
          m: gameHash,
          o: secondsSinceUnlock || undefined,
          v,
        },
        { useAuth: true }
      );
    }

    /** 一站式：识别 ROM 并拉成就；网络失败时仍返回本地哈希 */
    async identifyAndLoad(bytes, { hardcore = false } = {}) {
      const gameHash = hashNdsRom(bytes);
      const result = {
        gameHash,
        gameId: 0,
        supported: false,
        title: "",
        achievements: [],
        unlocks: [],
        networkError: null,
      };

      try {
        const gameId = await this.resolveHash(gameHash);
        result.gameId = gameId;
        result.supported = gameId > 0;
        if (!gameId) return result;

        const patch = await this.fetchGamePatch(gameId, gameHash);
        result.patchRaw = patch;
        result.title =
          (patch &&
            (patch.PatchData && patch.PatchData.title ||
              patch.Title ||
              patch.title)) ||
          "";
        const ach =
          (patch &&
            (patch.PatchData && patch.PatchData.achievements ||
              patch.achievements ||
              patch.Achievements)) ||
          [];
        result.achievements = normalizeAchievements(ach);

        if (this.isLoggedIn) {
          try {
            const unlocks = await this.fetchUnlocks(gameId, hardcore);
            result.unlocks =
              (unlocks && (unlocks.Unlocks || unlocks.unlocks || unlocks)) || [];
          } catch (_) {
            result.unlocks = [];
          }
        }
      } catch (err) {
        result.networkError = String(err && err.message ? err.message : err);
      }
      return result;
    }
  }

  function parseRaJson(text) {
    if (!text) return {};
    try {
      return JSON.parse(text);
    } catch (_) {
      return { raw: text };
    }
  }

  function normalizeAchievements(list) {
    if (!Array.isArray(list)) {
      if (list && typeof list === "object") {
        // 可能是 {id: ach}
        return Object.keys(list).map((k) => normalizeOne(list[k], k));
      }
      return [];
    }
    return list.map((a) => normalizeOne(a));
  }

  function normalizeOne(a, fallbackId) {
    return {
      id: Number(a.ID || a.id || a.AchievementID || fallbackId),
      title: a.Title || a.title || a.Name || "",
      description: a.Description || a.description || "",
      points: Number(a.Points || a.points || 0),
      author: a.Author || a.author || "",
      flags: a.Flags || a.flags,
      badge: a.BadgeName || a.badge || a.icon || "",
    };
  }

  global.RaApi = RaApi;
  global.raHashNdsRom = hashNdsRom;
  global.raMd5 = md5;
  global.RA_CONSOLE_NDS = CONSOLE_NDS;
})(typeof window !== "undefined" ? window : globalThis);
