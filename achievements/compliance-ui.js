/**
 * compliance-ui —— 中文 ROM / RA 合规引导
 * 只做识别与引导，不提供任何绕过手段。
 */
(function (global) {
"use strict";

function renderCompliance(container, status) {
  if (!container) return;

  if (!status) {
    container.innerHTML = `<p class="hint">加载 ROM 后将自动识别哈希并显示成就支持状态。</p>`;
    return;
  }

  const { hash, supported, game, reason } = status;

  if (supported && game) {
    container.innerHTML = `
      <div class="compliance ok">
        <p><strong>RA 已支持该 ROM 哈希</strong>，可以按规则解锁成就。</p>
        <p class="hint">游戏：<code>${escapeHtml(game.title || game.gameId || "")}</code></p>
        <p class="hint">哈希：<code>${escapeHtml(hash)}</code></p>
      </div>
    `;
    return;
  }

  container.innerHTML = `
    <div class="compliance warn">
      <p><strong>未在 RA 数据库中找到该哈希</strong>。</p>
      <p class="hint">若这是汉化/翻译补丁版：请向 RA 成就开发者申请登记 translation patch 新哈希。</p>
      <ol class="hint">
        <li>记录下方哈希，到 RA 对应游戏页核对。</li>
        <li>按官方流程申请将补丁版本加入数据库。</li>
        <li>官方添加前，成就保持锁定（预期行为）。</li>
      </ol>
      <p class="hint">文件哈希：<code>${escapeHtml(hash || "-")}</code></p>
      <p class="hint">原因：<code>${escapeHtml(reason || "unknown")}</code></p>
      <p class="hint"><strong>本站不提供哈希伪造、双 ROM 同步或内存修改。</strong></p>
    </div>
  `;
}

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/** 给用户复制的申请模板 */
function patchRequestTemplate({ gameName, patchName, hash, patchUrl }) {
  return `主题：Translation patch hash request — ${gameName || "Game"} (NDS)

你好，我使用的是 ${gameName || "游戏"} 的中文翻译补丁版本。
希望申请将以下补丁版本登记为新的 translation patch 哈希，以便成就可按规则解锁。

- 原版游戏（英文）：${gameName || ""}
- 补丁名称/版本：${patchName || ""}
- 应用补丁后的文件哈希：${hash || ""}
- 补丁下载/发布页：${patchUrl || ""}
- 说明：仅补丁文本，无玩法修改/未解锁内容

感谢审核。`;
}

global.renderCompliance = renderCompliance;
global.patchRequestTemplate = patchRequestTemplate;
})(typeof window !== "undefined" ? window : globalThis);
