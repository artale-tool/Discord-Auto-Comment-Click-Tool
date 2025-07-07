async function sendStopFlag(value) {
  await chrome.runtime.sendMessage({ type: "setShouldStop", value });
}

document.addEventListener("DOMContentLoaded", () => {

  document.getElementById("clickBtn").onclick = async () => {
    const listEl = document.getElementById("list");
    listEl.textContent = "檢查中...";
    await sendStopFlag(false);

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    // 先檢查是否有討論區
    const [checkResult] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        const cards = [...document.querySelectorAll('[class*="mainCard_"][class*="container_"]')]
        return cards.length > 0;
      }
    });

    if (checkResult?.result) {
      // 有找到討論區，開始執行
      chrome.runtime.sendMessage({ type: "runClickNext", tabId: tab.id });
      setTimeout(() => {
        window.close();
      }, 1000);
      
    } else {
      listEl.textContent = "⚠️ 找不到討論區貼文";
    }
  };

  document.getElementById("readAllBtn").onclick = async () => {
    const listEl = document.getElementById("list");
    listEl.textContent = "檢查中...";
    await sendStopFlag(false);

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    // 預先檢查是否有未讀貼文
    const [checkResult] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        const thread = document.querySelector('[role="group"][aria-label="交易買賣討論區 討論串"]');
        if (!thread) return false;
        const unread = [...thread.querySelectorAll('[role="listitem"]')]
          .filter(el => el.querySelector('[class*="unread_"]'));
        return unread.length > 0;
      }
    });

    if (checkResult?.result) {
      // 有未讀才繼續：背景執行、關閉 popup
      chrome.runtime.sendMessage({ type: "runReadAll", tabId: tab.id });
      setTimeout(() => {
        window.close();
      }, 1000);
      
    } else {
      // 沒找到：顯示訊息
      listEl.textContent = "⚠️ 沒有未讀留言可處理";
    }
  };

  document.getElementById("stopBtn").onclick = async () => {
    await sendStopFlag(true);
    document.getElementById("list").textContent = "⛔ 已停止操作";
  };
});
