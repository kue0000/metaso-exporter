/**
 * Metaso Exporter - Content Script
 * 秘塔AI搜索导出插件 - 内容脚本
 * 支持简洁/深入/深度研究三种模式
 * 导出为 Markdown 格式
 */

(function () {
  "use strict";

  // ==================== 工具函数 ====================

  /** 获取当前时间戳字符串 */
  function getTimestamp() {
    const now = new Date();
    return now.toLocaleString("zh-CN", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  /** 生成文件名安全字符串 */
  function safeFilename(str) {
    return str.replace(/[\\/:*?"<>|]/g, "_").substring(0, 80);
  }

  // ==================== 页面内容提取 ====================

  /** 检测当前页面是否包含搜索结果 */
  function hasSearchResult() {
    return !!document.querySelector(".searchRoot");
  }

  /** 获取搜索查询标题 */
  function getQueryTitle() {
    const titleEl = document.querySelector(
      '[class*="search-title_result-title"]'
    );
    if (titleEl) {
      const spans = titleEl.querySelectorAll("span");
      for (const span of spans) {
        const text = span.textContent.trim();
        if (text && !text.includes("收藏") && text.length > 1) return text;
      }
    }
    const url = window.location.href;
    if (url.includes("/chat/")) {
      return "秘塔搜索结果_" + url.split("/chat/")[1]?.substring(0, 20);
    }
    return "秘塔搜索结果";
  }

  /** 获取当前搜索模式 (简洁/深入/深度研究) */
  function getSearchMode() {
    try {
      const url = new URL(window.location.href);
      const mode = url.searchParams.get("mode");
      if (mode) {
        const modeMap = { concise: "简洁", deep: "深入", research: "深度研究" };
        return modeMap[mode] || mode;
      }
    } catch (e) {}

    const deepResearchBadge = document.querySelector(
      '[class*="deep-research"], [class*="research-mode"]'
    );
    if (deepResearchBadge) return "深度研究";

    const markdownBodies = document.querySelectorAll(".markdown-body");
    const totalLen = Array.from(markdownBodies).reduce(
      (sum, b) => sum + b.textContent.length, 0
    );
    if (totalLen > 5000) return "深度研究（推测）";
    if (totalLen > 2000) return "深入（推测）";
    if (totalLen > 0) return "简洁（推测）";
    return "搜索结果";
  }

  /** 获取AI回答的主要内容 (markdown-body) */
  function getAnswerContent() {
    const markdownBodies = document.querySelectorAll(".markdown-body");
    const contents = [];
    markdownBodies.forEach((body, index) => {
      const textLen = body.textContent.trim().length;
      if (textLen < 20 && index === 0) {
        contents.push({ type: "reference-preview", html: body.innerHTML, text: body.textContent.trim() });
      } else {
        contents.push({ type: "answer", html: body.innerHTML, text: body.textContent.trim() });
      }
    });
    return contents;
  }

  /** 获取学术引用/参考文献 */
  function getAcademicReferences() {
    const refContainers = document.querySelectorAll('[class*="ref-container"], [class*="academic-ref"]');
    const refs = [];
    refContainers.forEach((container) => {
      const titleEl = container.querySelector('[class*="ref-title"]');
      const authorEl = container.querySelector('[class*="ref-author"]');
      const linkEl = container.querySelector("a");
      refs.push({
        title: titleEl?.textContent?.trim() || "",
        author: authorEl?.textContent?.trim() || "",
        url: linkEl?.href || "",
      });
    });
    return refs;
  }

  /** 通过 React Fiber 提取来源数据（含原始 URL） */
  function getSourcesWithUrls(container) {
    const originBoxes = container.querySelectorAll(".search-origin-box");
    const sources = [];
    originBoxes.forEach((box) => {
      const idx = parseInt(box.getAttribute("origin-box-data-index") || "0", 10);
      const fiberKey = Object.keys(box).find(k => k.startsWith("__reactFiber"));
      let url = null, title = null;

      if (fiberKey) {
        let fiber = box[fiberKey];
        for (let depth = 0; depth < 5 && fiber; depth++) {
          const item = fiber.memoizedProps?.item;
          if (item) {
            url = item.titleLinkUrl || item.originLink?.link || null;
            title = item.title || null;
            break;
          }
          fiber = fiber.return;
        }
      }

      if (!title) {
        const contentEl = box.querySelector('[class*="contentContainer"]');
        title = contentEl?.textContent?.trim() || "";
      }

      if (title) {
        sources.push({ index: idx + 1, title, url: url || "" });
      }
    });
    return sources;
  }

  /** 获取右侧来源列表（兜底，无 URL） */
  function getSourceReferences() {
    const originBoxes = document.querySelectorAll(".search-origin-box");
    const sources = [];
    originBoxes.forEach((box, index) => {
      const contentEl = box.querySelector('[class*="contentContainer"]');
      const titleEl = contentEl?.querySelector("div > div");
      const text = contentEl?.textContent?.trim() || "";
      const linkEl = box.querySelector("a");
      if (text) {
        sources.push({ index: index + 1, title: text, url: linkEl?.href || "" });
      }
    });
    return sources;
  }

  /** 获取相关推荐话题 */
  function getRelatedTopics() {
    const topics = [];
    const swiperSlides = document.querySelectorAll(".swiper-slide");
    swiperSlides.forEach((slide) => {
      const titleEl = slide.querySelector('[class*="font-bold"]') ||
        slide.querySelector('[class*="line-clamp"]') ||
        slide.querySelector('[class*="text-\\[16px\\]"]');
      if (titleEl && titleEl.textContent.trim().length > 2) {
        const authorEl = slide.querySelector('[class*="truncate"]:not([class*="font-bold"])');
        topics.push({ title: titleEl.textContent.trim(), author: authorEl?.textContent?.trim() || "" });
      }
    });
    if (topics.length === 0) {
      const cards = document.querySelectorAll('[class*="swiper-slide"], [class*="topic-card"], [class*="knowledge-card"]');
      cards.forEach((card) => {
        const titleEl = card.querySelector("div");
        if (titleEl && titleEl.textContent.trim().length > 2) {
          topics.push({ title: titleEl.textContent.trim(), author: "" });
        }
      });
    }
    return topics;
  }

  /** 获取追问/后续问题 */
  function getFollowUpQuestions() {
    const followUpEls = document.querySelectorAll('[class*="follow-up"], [class*="related-question"], [class*="suggest"]');
    const questions = [];
    followUpEls.forEach((el) => {
      const text = el.textContent.trim();
      if (text && text.length > 5) questions.push(text);
    });
    return questions;
  }

  /** 提取每轮问答（用户提问 + AI回答 + 该轮来源） */
  function getConversationTurns() {
    const turnContainers = document.querySelectorAll(".max-w-6xl.px-5");
    const turns = [];

    turnContainers.forEach((container, turnIndex) => {
      const questionEl = container.querySelector(".resultTitle");
      const questionText = questionEl?.textContent?.trim() || "";
      if (!questionText) return; // 跳过非问答容器（如底部输入区）

      // 获取该轮 AI 回答
      const markdownBodies = container.querySelectorAll(".markdown-body");
      const answers = [];
      markdownBodies.forEach((body) => {
        const textLen = body.textContent.trim().length;
        if (textLen < 20 && answers.length === 0) {
          answers.push({ type: "reference-preview", html: body.innerHTML, text: body.textContent.trim() });
        } else {
          answers.push({ type: "answer", html: body.innerHTML, text: body.textContent.trim() });
        }
      });

      // 获取该轮范围内的来源（含 URL）
      const sources = getSourcesWithUrls(container);

      turns.push({ question: questionText, answers, sources });
    });

    return turns;
  }

  /** 获取完整结构化数据 */
  function extractFullData() {
    const turns = getConversationTurns();

    // 兜底：如果没有解析到轮次，使用旧逻辑
    if (turns.length === 0) {
      return {
        title: getQueryTitle(),
        mode: getSearchMode(),
        url: window.location.href,
        timestamp: getTimestamp(),
        turns: [{
          question: getQueryTitle(),
          answers: getAnswerContent(),
          sources: getSourceReferences(),
        }],
        academicRefs: getAcademicReferences(),
        relatedTopics: getRelatedTopics(),
        followUps: getFollowUpQuestions(),
      };
    }

    return {
      title: turns[0].question,
      mode: getSearchMode(),
      url: window.location.href,
      timestamp: getTimestamp(),
      turns,
      academicRefs: getAcademicReferences(),
      relatedTopics: getRelatedTopics(),
      followUps: getFollowUpQuestions(),
    };
  }

  // ==================== HTML -> Markdown 转换 ====================

  function htmlToMarkdown(html) {
    const div = document.createElement("div");
    div.innerHTML = html;

    // 将引用标记转换为脚注标记 [^N]
    div.querySelectorAll('[class*="reference-dot"]').forEach((el) => {
      const linkIdx = el.getAttribute("data-link-index");
      if (linkIdx !== null) {
        const footnoteNum = parseInt(linkIdx, 10) + 1;
        el.replaceWith(`[^${footnoteNum}]`);
      } else {
        const num = el.getAttribute("data-number") || "";
        el.replaceWith(num ? `[${num}]` : "");
      }
    });

    div.querySelectorAll("*").forEach((el) => {
      el.removeAttribute("class");
      el.removeAttribute("style");
      el.removeAttribute("node");
    });

    let md = "";

    function processNode(node) {
      if (node.nodeType === Node.TEXT_NODE) return node.textContent;
      if (node.nodeType !== Node.ELEMENT_NODE) return "";

      const tag = node.tagName.toLowerCase();
      let inner = "";
      node.childNodes.forEach((child) => { inner += processNode(child); });

      switch (tag) {
        case "h1": return "\n# " + inner.trim() + "\n\n";
        case "h2": return "\n## " + inner.trim() + "\n\n";
        case "h3": return "\n### " + inner.trim() + "\n\n";
        case "h4": return "\n#### " + inner.trim() + "\n\n";
        case "h5": return "\n##### " + inner.trim() + "\n\n";
        case "h6": return "\n###### " + inner.trim() + "\n\n";
        case "p": return inner.trim() + "\n\n";
        case "strong": case "b": return "**" + inner + "**";
        case "em": case "i": return "*" + inner + "*";
        case "code": return "`" + inner + "`";
        case "pre": return "\n```\n" + inner + "\n```\n\n";
        case "ul": return "\n" + inner + "\n";
        case "ol": return "\n" + inner + "\n";
        case "li": return "- " + inner.trim() + "\n";
        case "a":
          const href = node.getAttribute("href");
          return href ? `[${inner}](${href})` : inner;
        case "br": return "\n";
        case "hr": return "\n---\n\n";
        case "blockquote": return "> " + inner.trim() + "\n\n";
        case "table": return "\n" + inner + "\n";
        case "thead": return inner;
        case "tbody": return inner;
        case "tr": return "| " + inner + "\n";
        case "th": case "td": return inner.trim() + " | ";
        case "img":
          const src = node.getAttribute("src");
          const alt = node.getAttribute("alt") || "";
          return src ? `![${alt}](${src})` : "";
        case "span":
          if ((node.className || "").includes("ref-tag")) return "[" + inner + "] ";
          return inner;
        case "div": return inner + "\n";
        default: return inner;
      }
    }

    div.childNodes.forEach((child) => { md += processNode(child); });
    md = md.replace(/\n{3,}/g, "\n\n");
    return md.trim();
  }

  // ==================== 构建 Markdown 字符串 ====================

  /** 生成当前搜索结果的完整 Markdown 字符串（不下载） */
  function buildMarkdownString() {
    const data = extractFullData();
    let md = "";

    md += `# ${data.title}\n\n`;
    md += `> 自动生成于 ${data.timestamp}  \n`;
    md += `> 搜索模式: ${data.mode}  \n`;
    md += `> 来源: ${data.url}\n\n`;
    md += `---\n\n`;

    if (data.academicRefs.length > 0) {
      md += `## 参考文献\n\n`;
      data.academicRefs.forEach((ref, i) => {
        const link = ref.url ? `[${ref.title}](${ref.url})` : ref.title;
        md += `${i + 1}. **${link}**`;
        if (ref.author) md += ` — ${ref.author}`;
        md += `\n`;
      });
      md += `\n---\n\n`;
    }

    data.turns.forEach((turn, index) => {
      const turnLabel = data.turns.length > 1 ? `（第${index + 1}轮）` : "";
      md += `## 提问${turnLabel}: ${turn.question}\n\n`;
      turn.answers.forEach((content) => {
        if (content.type === "reference-preview") {
          md += `> **摘要**: ${content.text}\n\n`;
        } else {
          md += `### AI 回答\n\n`;
          md += htmlToMarkdown(content.html) + "\n\n";
        }
      });
      if (turn.sources.length > 0) {
        turn.sources.forEach((src) => {
          if (src.url) {
            md += `[^${src.index}]: [${src.title}](${src.url})\n`;
          } else {
            md += `[^${src.index}]: ${src.title}\n`;
          }
        });
        md += `\n`;
      }
      if (index < data.turns.length - 1) { md += `---\n\n`; }
    });

    if (data.relatedTopics.length > 0) {
      md += `## 相关话题\n\n`;
      data.relatedTopics.forEach((topic) => {
        md += `- ${topic.title}`;
        if (topic.author) md += ` (${topic.author})`;
        md += `\n`;
      });
      md += `\n`;
    }

    if (data.followUps.length > 0) {
      md += `## 追问\n\n`;
      data.followUps.forEach((q) => { md += `- ${q}\n`; });
    }

    return md;
  }

  /** 导出为 Markdown 文件 */
  function exportMarkdown() {
    const data = extractFullData();
    const md = buildMarkdownString();
    downloadFile(safeFilename(data.title) + ".md", md, "text/markdown;charset=utf-8");
    showToast("Markdown 导出成功!");
  }

  // ==================== 纯文本转换 & 剪贴板 ====================

  /** 将 Markdown 转为纯文本（去掉语法标记） */
  function markdownToPlainText(md) {
    return md
      .replace(/^#{1,6}\s+/gm, "")
      .replace(/\*\*(.+?)\*\*/g, "$1")
      .replace(/\*(.+?)\*/g, "$1")
      .replace(/`([^`]+)`/g, "$1")
      .replace(/```[\s\S]*?```/g, (m) => m.replace(/```\w*\n?/g, "").replace(/```/g, ""))
      .replace(/^\s*[-*+]\s+/gm, "• ")
      .replace(/^\s*>\s*/gm, "")
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/\[\^(\d+)\]/g, "[$1]")
      .replace(/^\[\^?\d+\]:\s*/gm, "")
      .replace(/^---+$/gm, "————————")
      .replace(/\n{3,}/g, "\n\n");
  }

  /** 复制到剪贴板（带降级方案） */
  async function copyToClipboard(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (e) {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.cssText = "position:fixed;left:-9999px;top:-9999px;opacity:0";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(ta);
      return ok;
    }
  }

  /** 复制 Markdown 到剪贴板 */
  async function exportClipboard() {
    const md = buildMarkdownString();
    const ok = await copyToClipboard(md);
    showToast(ok ? "Markdown 已复制到剪贴板!" : "复制失败，请手动复制", !ok);
  }

  /** 导出纯文本文件 */
  function exportPlainText() {
    const data = extractFullData();
    const md = buildMarkdownString();
    const plain = markdownToPlainText(md);
    downloadFile(safeFilename(data.title) + ".txt", plain, "text/plain;charset=utf-8");
    showToast("纯文本导出成功!");
  }

  // ==================== 文件下载工具 ====================

  function downloadFile(filename, content, mimeType) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // ==================== Toast 提示 ====================

  function showToast(message, isError = false) {
    const existing = document.getElementById("metaso-exporter-toast");
    if (existing) existing.remove();

    const toast = document.createElement("div");
    toast.id = "metaso-exporter-toast";
    toast.textContent = message;
    if (isError) toast.classList.add("error");
    document.body.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = "0";
      setTimeout(() => toast.remove(), 300);
    }, 1500);
  }

  // ==================== 悬浮导出按钮 UI ====================

  function createExportButton() {
    if (document.getElementById("metaso-exporter-panel")) return;

    const panel = document.createElement("div");
    panel.id = "metaso-exporter-panel";
    panel.innerHTML = `
      <div id="metaso-exporter-menu" class="metaso-menu">
        <div class="metaso-menu-item" data-action="md">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
            <polyline points="7 10 12 15 17 10"/>
            <line x1="12" y1="15" x2="12" y2="3"/>
          </svg>
          <span>导出 .md</span>
        </div>
        <div class="metaso-menu-item" data-action="copy">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
          </svg>
          <span>复制到剪贴板</span>
        </div>
        <div class="metaso-menu-item" data-action="txt">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
            <polyline points="14 2 14 8 20 8"/>
            <line x1="16" y1="13" x2="8" y2="13"/>
            <line x1="16" y1="17" x2="8" y2="17"/>
          </svg>
          <span>导出纯文本</span>
        </div>
      </div>
      <div id="metaso-exporter-trigger" title="导出秘塔搜索结果">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
          <polyline points="7 10 12 15 17 10"/>
          <line x1="12" y1="15" x2="12" y2="3"/>
        </svg>
      </div>
    `;
    document.body.appendChild(panel);

    const trigger = document.getElementById("metaso-exporter-trigger");
    const menu = document.getElementById("metaso-exporter-menu");
    let menuOpen = false;

    function toggleMenu() {
      if (!hasSearchResult()) {
        showToast("请先执行搜索后再导出", true);
        return;
      }
      menuOpen = !menuOpen;
      menu.classList.toggle("metaso-menu-open", menuOpen);
    }

    function closeMenu() {
      menuOpen = false;
      menu.classList.remove("metaso-menu-open");
    }

    trigger.addEventListener("click", (e) => {
      e.stopPropagation();
      toggleMenu();
    });

    menu.querySelectorAll(".metaso-menu-item").forEach((item) => {
      item.addEventListener("click", (e) => {
        e.stopPropagation();
        const action = item.getAttribute("data-action");
        if (action === "md") exportMarkdown();
        else if (action === "copy") exportClipboard();
        else if (action === "txt") exportPlainText();
        closeMenu();
      });
    });

    document.addEventListener("click", () => {
      if (menuOpen) closeMenu();
    });
  }

  // ==================== 监听页面变化 ====================

  function watchForRouteChanges() {
    let lastUrl = window.location.href;
    const observer = new MutationObserver(() => {
      if (window.location.href !== lastUrl) {
        lastUrl = window.location.href;
        setTimeout(() => {
          if (hasSearchResult()) createExportButton();
        }, 1500);
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  // ==================== 初始化 ====================

  function init() {
    if (hasSearchResult()) {
      createExportButton();
    } else {
      const observer = new MutationObserver(() => {
        if (hasSearchResult()) {
          createExportButton();
          observer.disconnect();
        }
      });
      observer.observe(document.body, { childList: true, subtree: true });
      setTimeout(() => observer.disconnect(), 10000);
    }
    watchForRouteChanges();
  }

  // ==================== Popup 消息监听 ====================

  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "check-status") {
      sendResponse({
        hasResult: hasSearchResult(),
        mode: getSearchMode(),
        title: getQueryTitle(),
      });
    } else if (request.action === "export") {
      if (!hasSearchResult()) {
        showToast("请先执行搜索后再导出", true);
        sendResponse({ success: false, error: "No search result" });
        return;
      }
      const format = request.format || "markdown";
      if (format === "clipboard") exportClipboard();
      else if (format === "text") exportPlainText();
      else exportMarkdown();
      sendResponse({ success: true });
    }
    return true;
  });

  // 启动
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
