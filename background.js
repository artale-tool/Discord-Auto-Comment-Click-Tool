let shouldStop = false;

// ---------------- background helpers ----------------
function showNotification(title = "通知", message = "", id = "default-notification") {
  chrome.notifications.create(id, {
    type: "basic",
    iconUrl: "icon.png",
    title,
    message
  }, () => setTimeout(() => chrome.notifications.clear(id), 2000));
}

function runScriptInTab(tabId, mode) {
  chrome.scripting.executeScript({
    target: { tabId },
    args: [mode],
    func: async (mode) => {
      /* ---------------- shared helpers in content script ---------------- */
      const FINISH_KEYWORDS = ['中獎','領','恭喜','謝','流','已','私','停','截','結'];

      const delay = ms => new Promise(r => setTimeout(r, ms));

      function waitUntil(conditionFn, interval = 100, timeoutMs = 5000) {
        return new Promise((resolve, reject) => {
          const start = Date.now();
          const timer = setInterval(() => {
            if (conditionFn()) {
              clearInterval(timer);
              resolve();
            } else if (Date.now() - start > timeoutMs) {
              clearInterval(timer);
              reject(new Error("waitUntil timeout"));
            }
          }, interval);
        });
      }

      const checkShouldStop = () => new Promise(resolve => {
        chrome.runtime.sendMessage({ type: "getShouldStop" }, res => resolve(res.shouldStop));
      });

      const showNotification = (title, message) => {
        chrome.runtime.sendMessage({ type: "SHOW_NOTIFICATION", title, message });
      };

      async function scrollToBottomUntilDone() {

        // 等待串文讀取完成
        await waitUntil(() => !document.querySelector('[class*="pointerCover"]'));

        const scroller = document.querySelector('[class*="scroller_"][class*="auto_"]');
        if (!scroller) return;

        // 點擊 "跳到至當前" 按鈕
        const jumpBtn = document.querySelector('[class*="jumpToPresent"] [role="button"]');
        if (jumpBtn) {
          jumpBtn.click();

          // 持續等待，直到 jumpBtn 消失 且 scroller 到最底
          await waitUntil(() => {
            const stillBtn = document.querySelector('[class*="jumpToPresent"] [role="button"]');
            const isAtBottom = Math.abs(scroller.scrollTop + scroller.clientHeight - scroller.scrollHeight) < 2;
            return !stillBtn && isAtBottom;
          });

        } else {
          
          // 沒有按鈕則移到最底部
          scroller.scrollTop = scroller.scrollHeight;
        }


      }

      /* ---------------- clickNext ---------------- */
      async function clickNext() {
        const scrollContainer = document.querySelector('[class*="scrollerBase_"][class*="list_"]');
        if (!scrollContainer) return "❌ 找不到 scroll container";

        while (scrollContainer.scrollTop < scrollContainer.scrollHeight) {
          if (await checkShouldStop()) return "⛔ 已手動停止";

          const candidates = [...document.querySelectorAll('[class*="mainCard_"][class*="container_"]')]
            .filter(el => !el.querySelector('[class*="newMessageCount_"]'))
            .filter(el => [...el.querySelectorAll('[style]')]
              .some(child => child.getAttribute("style")?.includes('color: var(--header-primary)')));

          const matched = candidates.filter(el => {
            const msg = el.querySelector('[class*="messageContent_"]')?.textContent ?? "";
            const title = el.querySelector('[class*="postTitleText_"]')?.textContent ?? "";
            return /抽/.test(msg) || /抽/.test(title);
          });

          if (matched.length) {
            const card = matched[0];
            const postTitle = card.querySelector('[class*="postTitleText_"]')?.textContent.trim() ?? "";

            scrollContainer.scrollTop = card.offsetTop;
            card.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
            
            await delay(500);

            // 滑到底部
            await scrollToBottomUntilDone();

            const rawMessages = [...document.querySelectorAll('li[id^="chat-messages-"]:not(:has([class*="systemMessage_"]))')];
            let msgs = rawMessages.slice(-10);

            let finishedMsg = null; // 若偵測到結束訊息，存放文字內容方便之後通知
            if (rawMessages.length > 10) {
              const finishedEl = msgs.find(el => {
                const contentContainer = el.querySelector('[class^="contents_"]');
                const node = contentContainer?.querySelector('[id*="message-content-"]')?.childNodes[0];
                const txt  = node?.textContent.trim() ?? "";
                return FINISH_KEYWORDS.some(k => txt.includes(k));
              });
              if (finishedEl) {
                finishedMsg = finishedEl.textContent.trim();
              }
            } else {
              msgs = msgs.slice(1);
            }

            /* -------- 收集號碼 -------- */
            const counter = Object.create(null);
            const posMap = Object.create(null); // 現在存 { index, width }
            for (let i = msgs.length - 1; i >= 0; i--) {
              const contentContainer = msgs[i].querySelector('[class^="contents_"]');
              const node = contentContainer?.querySelector('[id*="message-content-"]');

            let text = "";
            if (node) {
              const spans = Array.from(node.children).filter(el =>
                el.tagName === "SPAN" &&
                !el.className.includes("mention") && // 排除 mention
                !el.className.includes("timestamp_") // 排除 (已編輯)
              );

              spans.forEach(span => {
                text += span.textContent;
              });

              text = text.trim();
            } else {
              continue;
            }

              const lines = text.split("\n").map(t=>t.trim()).filter(Boolean);
              for (const line of lines) {
                const matches = [...line.matchAll(/\d+/g)];
                for (const m of matches) {
                  const n = parseInt(m[0], 10);
                  const key = line.replace(m[0], '').trim() || '(空字串)';

                  (counter[key] ??= new Set()).add(n);
                  posMap[key] ??= { index: m.index, width: m[0].length };   // ←★ 多存寬度
                }
              }
            }

            /* -------- 找最佳連號 -------- */
            let bestKey = null, bestRun = 0, bestMax = 0;
            for (const [key,set] of Object.entries(counter)) {
              const arr=[...set].sort((a,b)=>a-b);
              let run=1,maxRun=1;
              for (let j=1;j<arr.length;j++){
                run = arr[j]===arr[j-1]+1 ? run+1 :1;
                maxRun=Math.max(maxRun,run);
              }
              const maxVal=arr[arr.length-1];
              if (maxRun>bestRun|| (maxRun===bestRun&&maxVal>bestMax)){
                bestKey=key;bestRun=maxRun;bestMax=maxVal;
              }
            }

            if (bestKey && bestKey!=='(空字串)'){
              const { index: idx, width } = posMap[bestKey];
              const nextNumStr = String(bestMax + 1).padStart(width, '0');  // ←★ 補 0
              const nextText   = bestKey.slice(0, idx) + nextNumStr + bestKey.slice(idx);

              // 複製到剪貼簿
              const ta=document.createElement("textarea");
              ta.value=nextText;document.body.appendChild(ta);ta.select();document.execCommand("copy");ta.remove();

              // 若有結束訊息，複製完才顯示通知並結束
              if (finishedMsg) {
                showNotification("結束", "已複製但可能結束", "done");
                return "結束抽獎";
              } 

              // 貼上並送出
              const editor=document.querySelector('div[contenteditable="true"][data-slate-editor="true"]');
              if (editor){
                editor.focus();
                const pasteEvt=new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:new DataTransfer()});
                pasteEvt.clipboardData.setData('text/plain', nextText);
                editor.dispatchEvent(pasteEvt);
                editor.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',code:'Enter',keyCode:13,which:13,bubbles:true}));
              }
              return "✅ 點擊留言成功：" + postTitle;
            } else {
              showNotification("結束", "⚠️ 找不到符合格式的留言", "done");
              return "找不到符合條件的留言"
            }
          } else {
            scrollContainer.scrollBy(0,600);
            await delay(400);
          }
        }
        showNotification("搜尋結束", "找不到符合條件的留言，請重新執行", "done");
        return "⚠️ 找不到符合條件的留言";
      }

      /* ---------------- readAll ---------------- */
      async function readAll() {
        const channelScroller = document.querySelector('[class*="scroller_"][id="channels"]');
        const thread = document.querySelector('[role="group"][aria-label*="討論串"]');
        if (!channelScroller || !thread) return "❌ 找不到討論串";

        const unread = [...thread.querySelectorAll('[role="listitem"]')]
          .filter(el => el.querySelector('[class*="unread_"]')).reverse();

        for (const li of unread) {
          if (await checkShouldStop()) return "⛔ 已手動停止";

          channelScroller.scrollTop = li.offsetTop;
          li.querySelector('[role="button"]')?.dispatchEvent(new MouseEvent("click",{bubbles:true}));

          // 滑至底部
          await waitUntil(() => document.querySelector('li[id^="chat-messages-"]:not(:has([aria-label="原貼文者"]))'));
          await scrollToBottomUntilDone();

          // 等 newMessagesBar 消失
          await waitUntil(()=>!document.querySelector('[class*="newMessagesBar_"]'),200);

          const last10=[...document.querySelectorAll('li[id^="chat-messages-"]:not(:has([class*="systemMessage_"]))')].slice(-10);
          const finished = last10.find(el=>{
            const contentContainer = el.querySelector('[class^="contents_"]');
            const node = contentContainer?.querySelector('[id*="message-content-"]')?.childNodes[0];
            const txt  = node?.textContent.trim() ?? "";
            return FINISH_KEYWORDS.some(k=>txt.includes(k));
          });
          if (finished){

            const followBtn = Array.from(document.querySelectorAll('[aria-label="將此貼文新增至您的頻道名單並接收其通知。"]'))
              .find(el => el.textContent.trim() === "正在追蹤");
            if (followBtn) {
              followBtn.click();
            } else {
              // 右鍵 > 取消追蹤
              const btn = li.querySelector('[role="button"]');
              if (btn) {
                const rightClickEvent = new MouseEvent('contextmenu', {
                  bubbles: true,
                  cancelable: true,
                  view: window,
                  button: 2,          // 右鍵代碼（0:左鍵, 1:中鍵, 2:右鍵）
                  buttons: 2,         // 通常設為2以代表右鍵按鈕
                  clientX: btn.getBoundingClientRect().left,
                  clientY: btn.getBoundingClientRect().top,
                });

                btn.dispatchEvent(rightClickEvent);
                await delay(500);

                const leaveItem = document.querySelector('[id="thread-context-leave-thread"]');
                if (leaveItem) {
                  leaveItem.click()
                }
              }
            }

            showNotification("結束", finished.textContent.trim(), "done");
            return "已結束抽獎";
          }
        }
        showNotification("讀取結束","✅ 已讀取所有貼文", "done");
        return "✅ 已讀取所有貼文";
      }

      /* ---------------- execute ---------------- */
      return mode === "clickNext" ? await clickNext() : await readAll();
    }
  });
}

// ---------------- background message listener ----------------
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  switch (msg.type) {
    case "setShouldStop":
      shouldStop = msg.value;
      sendResponse({ success: true });
      break;

    case "getShouldStop":
      sendResponse({ shouldStop });
      break;

    case "runClickNext":
      if (msg.tabId) runScriptInTab(msg.tabId, "clickNext");
      return true;

    case "runReadAll":
      if (msg.tabId) runScriptInTab(msg.tabId, "readAll");
      return true;

    case "SHOW_NOTIFICATION":
      showNotification(msg.title, msg.message);
      break;
  }
});
