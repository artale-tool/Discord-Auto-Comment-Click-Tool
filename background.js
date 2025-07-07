let shouldStop = false;

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // 設定停止旗標
  if (msg.type === "setShouldStop") {
    shouldStop = msg.value;
    sendResponse({ success: true });

  // 查詢是否應該停止
  } else if (msg.type === "getShouldStop") {
    sendResponse({ shouldStop });

  // 點下則留言
  } else if (msg.type === "runClickNext" && msg.tabId) {
    chrome.scripting.executeScript({
      target: { tabId: msg.tabId },
      func: async () => {
        const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
        const checkShouldStop = () => new Promise(resolve => {
          chrome.runtime.sendMessage({ type: "getShouldStop" }, res => resolve(res.shouldStop));
        });

        const scrollContainer = document.querySelector('[class*="scrollerBase_"][class*="list_"]');
        const maxScrolls = 10;
        let scrollCount = 0;

        while (scrollCount < maxScrolls) {
          if (await checkShouldStop()) return "⛔ 已手動停止";

          const filtered = [...document.querySelectorAll('[class*="mainCard_"][class*="container_"]')].filter(el => {
            const hasNoNewMessage = !el.querySelector('[class*="newMessageCount_"]');
            const hasPrimaryColor = [...el.querySelectorAll('[style]')].some(child =>
              child.getAttribute("style")?.includes('color: var(--header-primary)')
            );
            return hasNoNewMessage && hasPrimaryColor;
          });

          const matched = filtered.filter(el => {
            const msg = el.querySelector('[class*="messageContent_"]')?.textContent || "";
            const title = el.querySelector('[class*="postTitleText_"]')?.textContent || "";
            return msg.includes("抽") || title.includes("抽") || title.includes("送") || msg.includes("送");
          });

          if (matched.length > 0) {
            const el = matched[0];
            const title = el.querySelector('[class*="postTitleText_"]')?.textContent.trim() || "";

            if (scrollContainer)
                scrollContainer.scrollTop = el.offsetTop;
            el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));

            await new Promise(resolve => {
              const checkExist = setInterval(() => {
                if (document.querySelector('[id*="chat-messages-"]')) {
                  clearInterval(checkExist);
                  resolve();
                }
              }, 100);
            });

            while (true) {
              const specialBtn = [...document.querySelectorAll('[class*="button_"][class*="lookFilled_"]')]
                .find(btn => btn.textContent.trim() === "跳到至當前");
              if (!specialBtn) break;

              specialBtn.click();
              await delay(2000);
            }

            const messageScroll = document.querySelector('[class*="scroller_"][class*="auto_"]');
            if (messageScroll) messageScroll.scrollTop = messageScroll.scrollHeight;

            return "✅ 點擊留言成功：" + title;
          } else {
            if (!scrollContainer) break;
            scrollContainer.scrollBy(0, 600);
            await delay(1000);
            scrollCount++;
          }
        }

        return "⚠️ 找不到符合條件的留言";
      }
    });
    // 不需 sendResponse
    return true;

  // 閱讀所有追蹤貼文
  } else if (msg.type === "runReadAll" && msg.tabId) {
    chrome.scripting.executeScript({
      target: { tabId: msg.tabId },
      func: async () => {
        const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
        const checkShouldStop = () => new Promise(resolve => {
          chrome.runtime.sendMessage({ type: "getShouldStop" }, res => resolve(res.shouldStop));
        });

        const scroller = document.querySelector('[class*="scroller_"][id="channels"]');
        const thread = document.querySelector('[role="group"][aria-label="交易買賣討論區 討論串"]');
        const unread = [...thread.querySelectorAll('[role="listitem"]')]
          .filter(el => el.querySelector('[class*="unread_"]')).reverse();

        for (const el of unread) {
          if (await checkShouldStop()) return "⛔ 已手動停止";

          scroller.scrollTop = el.offsetTop; // 可加一點偏移量
          el.querySelector('[role="button"]')?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

          await new Promise(resolve => {
            const interval = setInterval(() => {
              if (document.querySelector('[id*="chat-messages-"]')) {
                clearInterval(interval);
                resolve();
              }
            }, 100);
          });

          while (true) {
            const btn = [...document.querySelectorAll('[class*="button_"][class*="lookFilled_"]')]
              .find(b => b.textContent.trim() === "跳到至當前");
            if (!btn) break;
            btn.click();
            await delay(2000);
          }

          const scroll = document.querySelector('[class*="scroller_"][class*="auto_"]');
          if (scroll) scroll.scrollTop = scroll.scrollHeight;
          await delay(1000);
        }

        return "✅ 已讀取所有貼文";
      }
    });
    return true;
  }
});
