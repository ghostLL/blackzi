export default async function (ctx) {
  const token = (ctx.env.BOT_TOKEN || "").trim();
  const chatId = (ctx.env.CHAT_ID || "").trim();
  const text = (ctx.env.CHECKIN_TEXT || "/checkin").trim();
  const doNotify = String(ctx.env.NOTIFY || "true").toLowerCase() !== "false";

  if (!token || !chatId) {
    const msg = "缺少 BOT_TOKEN 或 CHAT_ID，请在模块 Env / compat_arguments 中配置";
    console.log(msg);
    if (doNotify) {
      ctx.notify({ title: "Telegram 签到失败", body: msg, sound: true });
    }
    return;
  }

  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  const now = new Date();
  const today = now.toISOString().slice(0, 10); // YYYY-MM-DD

  let result = {
    success: false,
    message: "",
    time: now.toISOString(),
    date: today,
  };

  try {
    const resp = await ctx.http.post(url, {
      headers: { "Content-Type": "application/json" },
      body: {
        chat_id: chatId,
        text: text,
        disable_notification: false,
      },
      timeout: 15000,
    });

    const data = await resp.json();

    if (resp.status === 200 && data.ok) {
      result.success = true;
      result.message = "签到消息已发送";
      result.messageId = data.result?.message_id;
    } else {
      result.success = false;
      result.message = data.description || `HTTP ${resp.status}`;
    }
  } catch (e) {
    result.success = false;
    result.message = e.message || String(e);
  }

  // 读取历史记录并更新连续天数
  let history = ctx.storage.getJSON("tg_checkin_history") || {
    lastDate: null,
    streak: 0,
    totalSuccess: 0,
    lastResult: null,
  };

  if (result.success) {
    if (history.lastDate === today) {
      // 当天已签过，不重复累加
    } else {
      const yesterday = new Date(now);
      yesterday.setDate(yesterday.getDate() - 1);
      const yStr = yesterday.toISOString().slice(0, 10);

      if (history.lastDate === yStr) {
        history.streak = (history.streak || 0) + 1;
      } else {
        history.streak = 1;
      }
      history.lastDate = today;
      history.totalSuccess = (history.totalSuccess || 0) + 1;
    }
  }

  history.lastResult = result;
  ctx.storage.setJSON("tg_checkin_history", history);

  // 通知
  if (doNotify) {
    const title = result.success ? "✅ Telegram 签到成功" : "❌ Telegram 签到失败";
    const body = result.success
      ? `${text}\n连续 ${history.streak} 天 · 累计 ${history.totalSuccess} 次`
      : result.message;
    ctx.notify({
      title,
      body,
      sound: true,
    });
  }

  console.log(JSON.stringify(result));
}