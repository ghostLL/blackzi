export default async function (ctx) {
  const history = ctx.storage.getJSON("tg_checkin_history") || {
    lastDate: null,
    streak: 0,
    totalSuccess: 0,
    lastResult: null,
  };

  const last = history.lastResult;
  const success = last?.success === true;
  const statusText = success ? "已签到" : last ? "签到失败" : "尚未签到";
  const statusColor = success ? "#34C759" : last ? "#FF3B30" : "#8E8E93";
  const timeStr = last?.time
    ? new Date(last.time).toLocaleString("zh-CN", {
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "--";

  const family = ctx.widgetFamily || "systemMedium";
  const isSmall = family === "systemSmall" || family.startsWith("accessory");

  // 小尺寸精简
  if (isSmall) {
    return {
      type: "widget",
      padding: 12,
      gap: 6,
      backgroundColor: { light: "#F2F2F7", dark: "#1C1C1E" },
      children: [
        {
          type: "stack",
          direction: "row",
          alignItems: "center",
          gap: 6,
          children: [
            {
              type: "image",
              src: "sf-symbol:paperplane.fill",
              width: 18,
              height: 18,
              color: statusColor,
            },
            {
              type: "text",
              text: statusText,
              font: { size: "headline", weight: "semibold" },
              textColor: statusColor,
            },
          ],
        },
        {
          type: "text",
          text: `连续 ${history.streak || 0} 天`,
          font: { size: "caption1" },
          textColor: { light: "#3C3C43", dark: "#EBEBF5" },
        },
      ],
    };
  }

  // 中 / 大尺寸
  return {
    type: "widget",
    padding: 16,
    gap: 10,
    backgroundColor: { light: "#F2F2F7", dark: "#1C1C1E" },
    children: [
      {
        type: "stack",
        direction: "row",
        alignItems: "center",
        gap: 8,
        children: [
          {
            type: "image",
            src: "sf-symbol:paperplane.fill",
            width: 22,
            height: 22,
            color: "#0088CC",
          },
          {
            type: "text",
            text: "Telegram 签到",
            font: { size: "headline", weight: "bold" },
            textColor: { light: "#000000", dark: "#FFFFFF" },
          },
          { type: "spacer" },
          {
            type: "text",
            text: statusText,
            font: { size: "subheadline", weight: "semibold" },
            textColor: statusColor,
          },
        ],
      },
      {
        type: "stack",
        direction: "row",
        gap: 16,
        children: [
          {
            type: "stack",
            direction: "column",
            gap: 2,
            children: [
              {
                type: "text",
                text: "连续天数",
                font: { size: "caption1" },
                textColor: { light: "#8E8E93", dark: "#8E8E93" },
              },
              {
                type: "text",
                text: String(history.streak || 0),
                font: { size: "title2", weight: "bold" },
                textColor: { light: "#000000", dark: "#FFFFFF" },
              },
            ],
          },
          {
            type: "stack",
            direction: "column",
            gap: 2,
            children: [
              {
                type: "text",
                text: "累计成功",
                font: { size: "caption1" },
                textColor: { light: "#8E8E93", dark: "#8E8E93" },
              },
              {
                type: "text",
                text: String(history.totalSuccess || 0),
                font: { size: "title2", weight: "bold" },
                textColor: { light: "#000000", dark: "#FFFFFF" },
              },
            ],
          },
          { type: "spacer" },
        ],
      },
      {
        type: "text",
        text: `上次：${timeStr}${last?.message ? " · " + last.message : ""}`,
        font: { size: "caption2" },
        textColor: { light: "#8E8E93", dark: "#8E8E93" },
        maxLines: 2,
      },
    ],
  };
}