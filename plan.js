/* 网页版 NDS 模拟器技术规划 — 交互脚本
   功能：目录高亮、平滑滚动、复制代码、顶部导航选中态 */
(function () {
  "use strict";

  // 当前章节高亮：滚动时根据 section 可见性切换目录与顶部导航
  function setupActiveNav() {
    var links = Array.prototype.slice.call(
      document.querySelectorAll('.toc a[href^="#"], .top-nav a[href^="#"]')
    );
    var sections = Array.prototype.slice.call(
      document.querySelectorAll("section.card[id]")
    );
    if (!links.length || !sections.length) return;

    var map = {};
    links.forEach(function (a) {
      var id = a.getAttribute("href").slice(1);
      if (!map[id]) map[id] = [];
      map[id].push(a);
    });

    var observer = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting) return;
          var id = entry.target.id;
          links.forEach(function (a) {
            a.classList.remove("active");
          });
          (map[id] || []).forEach(function (a) {
            a.classList.add("active");
          });
        });
      },
      {
        rootMargin: "-20% 0px -65% 0px",
        threshold: 0.01
      }
    );

    sections.forEach(function (sec) {
      observer.observe(sec);
    });
  }

  // 代码块右上角「复制」按钮
  function setupCopyButtons() {
    var blocks = document.querySelectorAll("pre");
    blocks.forEach(function (pre) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "copy-btn";
      btn.textContent = "复制";
      btn.style.cssText =
        "position:absolute;top:10px;right:10px;opacity:0.85;" +
        "background:#374151;color:#f9fafb;border:0;border-radius:8px;" +
        "padding:4px 10px;font-size:12px;cursor:pointer;";
      pre.style.position = "relative";
      pre.appendChild(btn);
      btn.addEventListener("click", function () {
        var code = pre.querySelector("code");
        var text = code ? code.textContent : pre.textContent;
        // 优先使用剪贴板 API，失败时回退到 execCommand
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(text).then(function () {
            btn.textContent = "已复制";
            setTimeout(function () {
              btn.textContent = "复制";
            }, 1400);
          });
        } else {
          var ta = document.createElement("textarea");
          ta.value = text;
          document.body.appendChild(ta);
          ta.select();
          document.execCommand("copy");
          document.body.removeChild(ta);
          btn.textContent = "已复制";
          setTimeout(function () {
            btn.textContent = "复制";
          }, 1400);
        }
      });
    });
  }

  // 打印友好：折叠非当前段落可选，这里仅确保锚点可用
  function setupSmoothAnchors() {
    document.querySelectorAll('a[href^="#"]').forEach(function (a) {
      a.addEventListener("click", function (e) {
        var id = a.getAttribute("href").slice(1);
        var el = document.getElementById(id);
        if (!el) return;
        e.preventDefault();
        el.scrollIntoView({ behavior: "smooth", block: "start" });
        history.replaceState(null, "", "#" + id);
      });
    });
  }

  document.addEventListener("DOMContentLoaded", function () {
    setupActiveNav();
    setupCopyButtons();
    setupSmoothAnchors();
  });
})();
