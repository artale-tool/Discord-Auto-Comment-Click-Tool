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

            const rawMessages = Array.from(document.querySelectorAll('li[id^="chat-messages-"]:not(:has([class*="systemMessage_"]))'));
            let allMessages = rawMessages.slice(-10); // 取最後10個

            // 檢查是否結束
            if (rawMessages.length > 10) {
              for (const msgElement of allMessages) {
                const text = msgElement.textContent || '';
                if (text.includes('中獎') || text.includes('領') || text.includes('恭喜') || text.includes('謝') ||
                    text.includes('結') || text.includes('截') || text.includes('流') || text.includes('已') ||
                    text.includes('私')) {

                  // 顯示通知
                  chrome.runtime.sendMessage({
                      type: "SHOW_NOTIFICATION",
                      title: "結束",
                      message: `已結束抽獎`,
                  });

                  return "已結束抽獎"
                }
              }
            } else {
              allMessages = allMessages.slice(1);
            }

            const numberRegex = /\d+/g;
            const counter = Object.create(null); // { keyword: Set<number> }
            const positionMap = Object.create(null); // { keyword: number (數字在文字中的位置 index) }

            for (let i = allMessages.length - 1; i >= 0; i--) {
              const node = allMessages[i]
                .querySelector('[id*="message-content-"]')?.childNodes[0];
              if (!node) continue;

              const fullText = node.textContent.trim();
              if (!fullText) continue;

              const parts = fullText.split('\n').map(s => s.trim()).filter(s => s.length > 0);

              for (const text of parts) {
                const matches = [...text.matchAll(numberRegex)];
                if (!matches.length) continue;

                for (const match of matches) {
                  const numStr = match[0];
                  const num = parseInt(numStr, 10);
                  const index = match.index;

                  const keyword = text.replace(numStr, '').trim() || '(空字串)';

                  if (!counter[keyword]) counter[keyword] = new Set();
                  counter[keyword].add(num);

                  if (positionMap[keyword] === undefined) {
                    positionMap[keyword] = index;
                  }
                }
              }
            }

            // 尋找最長連號
            let bestKey = null;
            let bestRunLen = 0;
            let bestMaxNumber = 0;

            for (const [key, numSet] of Object.entries(counter)) {
              const arr = [...numSet].sort((a, b) => a - b);
              let curLen = 1, maxRunLen = 1;

              for (let j = 1; j < arr.length; j++) {
                if (arr[j] === arr[j - 1] + 1) {
                  curLen++;
                  maxRunLen = Math.max(maxRunLen, curLen);
                } else {
                  curLen = 1;
                }
              }

              const maxVal = arr[arr.length - 1];

              if (
                maxRunLen > bestRunLen ||
                (maxRunLen === bestRunLen && maxVal > bestMaxNumber)
              ) {
                bestKey = key;
                bestRunLen = maxRunLen;
                bestMaxNumber = maxVal;
              }
            }

            // 產生下一個號碼
            if (bestKey !== null && bestKey !== '(空字串)') {
                const nextNumber = bestMaxNumber + 1;
                const index = positionMap[bestKey];

                const nextText =
                  bestKey.slice(0, index) + nextNumber.toString() + bestKey.slice(index);

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

          // 滑動至最下面
          while (true) {
            const bar = document.querySelector('[class*="jumpToPresentBar_"]');
            const button = bar ? bar.querySelector('[role="button"]') : null;
            if (!button) break;
            button.click();
            await delay(2000);
          }

          const scroll = document.querySelector('[class*="scroller_"][class*="auto_"]');
          if (scroll) scroll.scrollTop = scroll.scrollHeight;

          // 等待新訊息橫條消失
          while (document.querySelector('[class*="newMessagesBar_"]')){
              if (scroll) scroll.scrollTop = scroll.scrollHeight;
              await delay(200);
          }

          const rawMessages = Array.from(document.querySelectorAll('li[id^="chat-messages-"]'));
          const allMessages = rawMessages.slice(-10); // 取最後10個

          // 檢查是否結束
          for (const msgElement of allMessages) {
            const text = msgElement.textContent || '';
            if (text.includes('中獎') || text.includes('領') || text.includes('恭喜') || text.includes('感謝') ||
                text.includes('停') || text.includes('私') || text.includes('流標') || text.includes('直購') ) {

              // 顯示通知
              chrome.runtime.sendMessage({
                  type: "SHOW_NOTIFICATION",
                  title: "結束",
                  message: `已結束抽獎`,
              });

              return "已結束抽獎"
            }
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
