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

        while (scrollContainer.scrollTop < scrollContainer.scrollHeight) {
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
            return msg.includes("抽") || title.includes("抽");
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
              const bar = document.querySelector('[class*="jumpToPresentBar_"]');
              const button = bar ? bar.querySelector('[role="button"]') : null;
              if (!button) break;

              button.click();
              await delay(2000);
            }

            const messageScroll = document.querySelector('[class*="scroller_"][class*="auto_"]');
            if (messageScroll) messageScroll.scrollTop = messageScroll.scrollHeight;

            await new Promise(resolve => {
              const checkExist = setInterval(() => {
                if (document.querySelector('[id*="chat-messages-"]')) {
                  clearInterval(checkExist);
                  resolve();
                }
              }, 100);
            });

            const rawMessages = Array.from(document.querySelectorAll('li[id^="chat-messages-"]'));
            const allMessages = rawMessages.slice(-10); // 取最後10個

            // 檢查是否結束
            for (const msgElement of allMessages) {
              const text = msgElement.textContent || '';
              if (text.includes('中獎') || text.includes('領') || text.includes('恭喜') || text.includes('感謝') ||
                  text.includes('結束') || text.includes('截') || text.includes('流標') || text.includes('直購')) {

                // 顯示通知
                chrome.runtime.sendMessage({
                    type: "SHOW_NOTIFICATION",
                    title: "結束",
                    message: `已結束抽獎`,
                });

                return "已結束抽獎"
              }
            }

            const pattern = /^(\d+)(\D+)$|^(\D+)(\d+)$/; // 數字+文字 或 文字+數字
            const counter = {}; // { keyword: [數字, 數字, ...] }
            const formatMap = {}; // { keyword: 'prefix' | 'suffix' }

            for (let i = allMessages.length - 1; i >= 0; i--) {
                const text = allMessages[i].querySelector('[id*="message-content-"]')?.childNodes[0]?.textContent.trim();
                if (!text) continue;

                const match = text.match(pattern);
                if (match) {
                    let number = null;
                    let keyword = null;
                    let format = null;

                    if (match[1] && match[2]) {
                        number = parseInt(match[1], 10);
                        keyword = match[2];
                        format = 'prefix'; // 數字在前
                    } else if (match[3] && match[4]) {
                        keyword = match[3];
                        number = parseInt(match[4], 10);
                        format = 'suffix'; // 數字在後
                    }

                    if (!isNaN(number)) {
                        if (!counter[keyword]) counter[keyword] = [];
                        counter[keyword].push(number);

                        if (!formatMap[keyword]) formatMap[keyword] = format;
                    }
                }
            }

            // 找出出現最多次的關鍵詞
            let mostCommonKeyword = null;
            let highestCount = 0;
            for (const key in counter) {
                if (counter[key].length > highestCount) {
                    highestCount = counter[key].length;
                    mostCommonKeyword = key;
                }
            }

            if (mostCommonKeyword !== null) {
                // 去重 & 遞減排序
                const sorted = [...new Set(counter[mostCommonKeyword])]
                  .sort((a, b) => b - a);


                // 先假設最大就是正確的
                let validMax = sorted[0];

                // 從大到小找第一組連號
                for (let i = 0; i < sorted.length - 1; i++) {
                  const current = sorted[i];
                  const next = sorted[i + 1];

                  if (current - next === 1) {
                    validMax = current;
                    break;
                  }
                }
                
                const nextNumber = validMax + 1;             // 下一個該用的號碼
                const format = formatMap[mostCommonKeyword];
                const nextText =
                  format === 'prefix'
                    ? `${nextNumber}${mostCommonKeyword}`
                    : `${mostCommonKeyword}${nextNumber}`;

                // 建立隱藏 textarea 複製
                const textarea = document.createElement("textarea");
                textarea.value = nextText;
                document.body.appendChild(textarea);
                textarea.select();
                try {
                    document.execCommand("copy");

                    // 顯示通知
                    chrome.runtime.sendMessage({
                        type: "SHOW_NOTIFICATION",
                        title: "複製完成",
                        message: `已複製 ${nextText} 到剪貼簿`,
                    });

                    // 模擬點擊 + 貼上文字
                    const editorEl = document.querySelector('div[contenteditable="true"][data-slate-editor="true"]');

                    if (editorEl) {
                      // 模擬點擊聚焦
                      editorEl.focus();

                      const clipboardEvent = new ClipboardEvent('paste', {
                        bubbles: true,
                        cancelable: true,
                        clipboardData: new DataTransfer()
                      });
                      clipboardEvent.clipboardData.setData('text/plain', nextText);

                      // 派發 paste 事件
                      editorEl.dispatchEvent(clipboardEvent);

                      // 模擬按 Enter 鍵 (keydown)
                      const enterEvent = new KeyboardEvent('keydown', {
                        key: 'Enter',
                        code: 'Enter',
                        keyCode: 13,
                        which: 13,
                        bubbles: true
                      });
                      editorEl.dispatchEvent(enterEvent);
                    }


                } catch (err) {
                    console.error("❌ 複製失敗", err);
                }
                document.body.removeChild(textarea);
            } else {
                console.warn("⚠️ 找不到符合格式的留言");
            }


            return "✅ 點擊留言成功：" + title;
          } else {
            if (!scrollContainer) break;
            scrollContainer.scrollBy(0, 600);
            await delay(500);
          }
        }

        // 顯示通知
        chrome.runtime.sendMessage({
            type: "SHOW_NOTIFICATION",
            title: "搜尋結束",
            message: `找不到符合條件的留言，請重新執行`,
        });
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

          scroller.scrollTop = el.offsetTop;
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
            const bar = document.querySelector('[class*="jumpToPresentBar_"]');
            const button = bar ? bar.querySelector('[role="button"]') : null;
            if (!button) break;
            button.click();
            await delay(2000);
          }

          const scroll = document.querySelector('[class*="scroller_"][class*="auto_"]');
          if (scroll) scroll.scrollTop = scroll.scrollHeight;

          while (document.querySelector('[class*="newMessagesBar_"]')){
              if (scroll) scroll.scrollTop = scroll.scrollHeight;
              await delay(200);
          }
              
        }

        // 顯示通知
        chrome.runtime.sendMessage({
            type: "SHOW_NOTIFICATION",
            title: "讀取結束",
            message: `✅ 已讀取所有貼文`,
        });

        return "✅ 已讀取所有貼文";
      }
    });
    return true;
  } else if (msg.type === "SHOW_NOTIFICATION") {
    const notificationId = "default-notification";

    chrome.notifications.create(notificationId, {
        type: "basic",
        iconUrl: "icon.png",
        title: msg.title || "通知",
        message: msg.message || ""
    }, () => {
        setTimeout(() => {
        chrome.notifications.clear(notificationId);
        }, 2000);  // 自動清除
    });
  }
});
