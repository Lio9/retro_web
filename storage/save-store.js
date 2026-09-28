/**
 * SaveStore —— 本地电池存档持久化（IndexedDB）
 * 数据模型（与后端 save_meta 对齐）：
 *   { gameId, romName, bytes, revision, sha256, updatedAt }
 * 经典脚本挂到 window，兼容 file:// 与 http。
 */
(function (global) {
"use strict";

class SaveStore {
  constructor(dbName = "nds-web-emu") {
    this.dbName = dbName;
    this.dbPromise = this.open();
  }

  open() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(this.dbName, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains("saves")) {
          const os = db.createObjectStore("saves", { keyPath: "id" });
          os.createIndex("gameId", "gameId", { unique: false });
          os.createIndex("updatedAt", "updatedAt", { unique: false });
        }
        if (!db.objectStoreNames.contains("meta")) {
          db.createObjectStore("meta", { keyPath: "gameId" });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  localId(gameId) {
    return `${gameId}:local`;
  }

  async putLocal({ gameId, romName, bytes, revision = 0, sha256 = "" }) {
    const db = await this.dbPromise;
    const record = {
      id: this.localId(gameId),
      gameId,
      romName,
      bytes,
      revision,
      sha256,
      updatedAt: Date.now(),
    };
    return new Promise((resolve, reject) => {
      const tx = db.transaction("saves", "readwrite");
      tx.objectStore("saves").put(record);
      tx.oncomplete = () => resolve(record);
      tx.onerror = () => reject(tx.error);
    });
  }

  async getLocal(gameId) {
    const db = await this.dbPromise;
    return new Promise((resolve, reject) => {
      const tx = db.transaction("saves", "readonly");
      const req = tx.objectStore("saves").get(this.localId(gameId));
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  }

  async listLocal() {
    const db = await this.dbPromise;
    return new Promise((resolve, reject) => {
      const tx = db.transaction("saves", "readonly");
      const req = tx.objectStore("saves").getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }

  async putMeta(gameId, meta) {
    const db = await this.dbPromise;
    return new Promise((resolve, reject) => {
      const tx = db.transaction("meta", "readwrite");
      tx.objectStore("meta").put({ gameId, ...meta });
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
    });
  }

  async getMeta(gameId) {
    const db = await this.dbPromise;
    return new Promise((resolve, reject) => {
      const tx = db.transaction("meta", "readonly");
      const req = tx.objectStore("meta").get(gameId);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  }

  /** 触发浏览器下载 .sav */
  exportFile(bytes, filename = "game.sav") {
    const blob = new Blob([bytes], { type: "application/octet-stream" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  /** 建议申请持久化存储，降低被驱逐概率 */
  async requestPersistence() {
    try {
      if (navigator.storage && navigator.storage.persist) {
        const granted = await navigator.storage.persist();
        return granted;
      }
    } catch (_) {
      /* 忽略 */
    }
    return false;
  }

  async estimateUsage() {
    try {
      if (navigator.storage && navigator.storage.estimate) {
        return await navigator.storage.estimate();
      }
    } catch (_) {
      /* 忽略 */
    }
    return null;
  }
}

/**
 * 自动保存：防抖写入 IndexedDB
 */
function attachAutoSave(bridge, store, options = {}) {
  const debounceMs = options.debounceMs ?? 2000;
  let timer = 0;

  // 每帧节流：仅在 dirty 时调度（P0 简化：定时导出）
  bridge.onFrame(() => {
    if (!bridge.romId) return;
    clearTimeout(timer);
    timer = setTimeout(async () => {
      try {
        const bytes = bridge.extractSav();
        if (!bytes || bytes.length === 0) return;
        await store.putLocal({
          gameId: bridge.romId,
          romName: bridge.romName,
          bytes,
          revision: 0,
        });
        options.onSaved && options.onSaved(bytes.length);
      } catch (err) {
        options.onError && options.onError(err);
      }
    }, debounceMs);
  });

  return () => clearTimeout(timer);
}

global.SaveStore = SaveStore;
global.attachAutoSave = attachAutoSave;
})(typeof window !== "undefined" ? window : globalThis);
