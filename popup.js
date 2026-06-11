/**
 * Metaso Exporter - Popup Script
 */

document.addEventListener("DOMContentLoaded", () => {
  const statusEl = document.getElementById("status");
  const statusText = document.getElementById("status-text");
  const buttons = document.querySelectorAll(".export-btn");

  // 检测当前页面是否是 metaso 搜索结果页
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs[0];

    if (!tab || !tab.url || !tab.url.includes("metaso.cn")) {
      statusEl.className = "status not-ready";
      statusText.textContent = "请先打开 metaso.cn 并搜索";
      return;
    }

    // 向 content script 发送消息检查状态
    chrome.tabs.sendMessage(
      tab.id,
      { action: "check-status" },
      (response) => {
        if (chrome.runtime.lastError || !response) {
          statusEl.className = "status not-ready";
          statusText.textContent = "内容脚本未就绪，请刷新页面";
          return;
        }

        if (response.hasResult) {
          statusEl.className = "status ready";
          statusText.textContent = `已检测到搜索结果 (${response.mode})`;
          buttons.forEach((btn) => (btn.disabled = false));
        } else {
          statusEl.className = "status not-ready";
          statusText.textContent = "未检测到搜索结果，请先搜索";
        }
      }
    );
  });

  // 导出按钮点击事件
  buttons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const format = btn.getAttribute("data-format");

      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        chrome.tabs.sendMessage(
          tabs[0].id,
          { action: "export", format },
          (response) => {
            if (chrome.runtime.lastError) {
              console.error("Export error:", chrome.runtime.lastError);
            }
            // 关闭 popup
            window.close();
          }
        );
      });
    });
  });
});
