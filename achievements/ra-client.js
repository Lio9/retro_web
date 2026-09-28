/**
 * RaIntegration —— RetroAchievements 集成骨架（P4 预留）
 *
 * 合规约束（必须保持）：
 *  - 只读内存 peek，禁止 poke
 *  - 不伪造 ROM 哈希
 *  - 不支持双 ROM 同步刷成就
 *  - 密码/API Key 不放前端，经 Java 后端代理
 */
(function (global) {
"use strict";

class RaIntegration {
  constructor({ apiBase = "/api/ra", memoryReader = null } = {}) {
    this.apiBase = apiBase;
    this.memoryReader = memoryReader;
    this.mode = "off"; // off | softcore | hardcore
    this.game = null;
    this.session = null;
    this.supported = null;
  }

  /**
   * 识别 ROM 是否在 RA 库中。
   * 注意：RA 使用特定哈希算法，上线前用官方样本做黄金用例。
   */
  async identify(romBytes) {
    const hash = await this.computeRaRomHash(romBytes);
    try {
      const res = await fetch(`${this.apiBase}/game?hash=${encodeURIComponent(hash)}`, {
        credentials: "include",
      });
      if (res.status === 404) {
        this.supported = {
          supported: false,
          hash,
          reason: "hash-not-in-ra-db",
        };
        return this.supported;
      }
      if (!res.ok) {
        this.supported = {
          supported: false,
          hash,
          reason: "ra-lookup-failed",
          status: res.status,
        };
        return this.supported;
      }
      const info = await res.json();
      this.game = info;
      this.supported = { supported: true, hash, game: info };
      return this.supported;
    } catch (err) {
      this.supported = {
        supported: false,
        hash,
        reason: "network-error",
        error: String(err),
      };
      return this.supported;
    }
  }

  /**
   * RA 哈希算法占位。
   * 实现时请严格对照 RA 文档；不同主机平台算法可能不同。
   */
  async computeRaRomHash(bytes) {
    // 仅作占位：生产环境替换为 RA 官方算法
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return [...new Uint8Array(digest)]
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }

  setMode(mode) {
    this.mode = mode;
  }

  /** 每帧调用（接入 rcheevos 后填充） */
  pumpFrame() {
    if (this.mode === "off" || !this.game) return;
    // TODO: rc_client_do_frame + 解锁回调
  }

  /** 解锁上报走后端代理 */
  async reportUnlock(achievementId, hardcore = false) {
    await fetch(`${this.apiBase}/unlock`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ achievementId, hardcore, when: new Date().toISOString() }),
    });
  }
}

/**
 * 只读内存适配器工厂 —— 绝不暴露写接口给成就层
 */
function makeMemoryReader(bridge) {
  return (address, size) => {
    if (bridge.mode === "wasm" && bridge.mod && bridge.mod._nds_peek) {
      const ptr = bridge.mod._nds_peek(address, size);
      return new Uint8Array(bridge.mod.HEAPU8.buffer, ptr, size).slice();
    }
    // DemoCore：返回确定性伪内存，便于联调 rc_client
    const out = new Uint8Array(size);
    for (let i = 0; i < size; i++) {
      out[i] = (address + i + (bridge._frameCount || 0)) & 0xff;
    }
    return out;
  };
}

global.RaIntegration = RaIntegration;
global.makeMemoryReader = makeMemoryReader;
})(typeof window !== "undefined" ? window : globalThis);
