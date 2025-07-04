document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("clickBtn").onclick = async () => {
    const listEl = document.getElementById("list");
    listEl.textContent = "搜尋中...";

    await clickFindScrollAndShow();
  };
});

async function clickFindScrollAndShow() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.id) return;

  const result = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: async () => {
      function delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
      }

      const maxScrolls = 10;
      let scrollCount = 0;

      while (scrollCount < maxScrolls) {
        const filtered = [...document.querySelectorAll('[class*="mainCard_"][class*="container_"]')].filter(el => {
          const hasNoNewMessage = !el.querySelector('[class*="newMessageCount_"]');
          const hasPrimaryColor = [...el.querySelectorAll('[style]')].some(child =>
            child.getAttribute("style")?.includes('color: var(--header-primary)')
          );
          return hasNoNewMessage && hasPrimaryColor;
        });

        const matched = filtered.filter(el => {
          const messageText = el.querySelector('[class*="messageContent_"]')?.textContent || "";
          const titleText = el.querySelector('[class*="postTitleText_"]')?.textContent || "";
          return messageText.includes("抽") || titleText.includes("抽");
        });

        if (matched.length > 0) {
          const el = matched[0];
          const title = el.querySelector('[class*="postTitleText_"]')?.textContent.trim() || "";

          // 冒泡 click 事件
          el.dispatchEvent(new MouseEvent("click", {
            bubbles: true,
            cancelable: true,
            view: window
          }));

          // 等待直到有出現 [id*="chat-messages-"]
          await new Promise(resolve => {
            const checkExist = setInterval(() => {
              if (document.querySelector('[id*="chat-messages-"]')) {
                clearInterval(checkExist);
                resolve();
              }
            }, 100);
          });

          // 每隔 1 秒點擊一次 specialBtn，直到按鈕不再存在
          while (true) {
            const specialBtn = document.querySelector('[class*="button_"][class*="lookFilled_"]');
            if (!specialBtn) break;

            specialBtn.click();
            await delay(1000);
          }

          return title;
        } else {
          // 找不到，滾動 list 容器
          const scrollContainer = document.querySelector('[class*="scrollerBase_"][class*="list_"]');
          if (!scrollContainer) break;
          scrollContainer.scrollBy(0, 600);
          await delay(1000);
          scrollCount++;
        }
      }

      // 超過滾動次數還是沒找到
      return null;
    }
  });

  const listEl = document.getElementById("list");
  if (result && result[0].result) {
    listEl.textContent = "• " + result[0].result;
  } else {
    listEl.textContent = "找不到符合條件的留言";
  }
}
