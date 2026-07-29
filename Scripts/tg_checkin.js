/**
 * Egern Auto Check-in Script for Telegram
 */

async function runCheckin() {
  const token = $environment?.env?.TG_BOT_TOKEN;
  const chatId = $environment?.env?.TG_CHAT_ID;
  const text = $environment?.env?.CHECKIN_TEXT || "/checkin";

  if (!token || !chatId) {
    console.log("[TG Checkin] 缺少必要的环境变量：TG_BOT_TOKEN 或 TG_CHAT_ID");
    saveStatus(false, "环境变量未设置");
    return;
  }

  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  const body = {
    chat_id: chatId,
    text: text
  };

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body)
    });

    const resData = await response.json();

    if (resData.ok) {
      console.log("[TG Checkin] 签到指令发送成功");
      saveStatus(true, "已发送签到指令");
    } else {
      console.log(`[TG Checkin] 发送失败: ${resData.description}`);
      saveStatus(false, resData.description || "发送失败");
    }
  } catch (error) {
    console.log(`[TG Checkin] 网络请求异常: ${error.message}`);
    saveStatus(false, "网络请求异常");
  }
}

function saveStatus(success, message) {
  const now = new Date();
  const timeStr = `${now.getMonth() + 1}/${now.getDate()} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  
  const statusData = {
    lastCheckin: timeStr,
    status: success ? "成功" : "失败",
    message: message
  };

  $persistentStore.write(JSON.stringify(statusData), "tg_checkin_status");
}

runCheckin();
