/**
 * Egern Widget Script for TG Checkin Display
 */
export default async function(ctx) {
  // 从本地存储读取签到状态
  const rawData = $persistentStore.read("tg_checkin_status");
  let statusData = {
    lastCheckin: "未签到",
    status: "待运行",
    message: "等待第一次触发"
  };

  if (rawData) {
    try {
      statusData = JSON.parse(rawData);
    } catch (e) {
      console.log("[TG Widget] 解析状态数据失败");
    }
  }

  const isSuccess = statusData.status === "成功";
  const badgeColor = isSuccess ? "#34C759" : "#FF3B30";

  return {
    type: "widget",
    backgroundColor: "#1C1C1E",
    padding: 14,
    children: [
      {
        type: "stack",
        direction: "row",
        alignItems: "center",
        children: [
          {
            type: "text",
            text: "Telegram 签到",
            font: { size: "subheadline", weight: "bold" },
            textColor: "#FFFFFF"
          },
          { type: "spacer" },
          {
            type: "text",
            text: statusData.status,
            font: { size: "caption1", weight: "bold" },
            textColor: badgeColor
          }
        ]
      },
      { type: "spacer", length: 10 },
      {
        type: "text",
        text: `最近签到: ${statusData.lastCheckin}`,
        font: { size: "footnote" },
        textColor: "#8E8E93"
      },
      { type: "spacer", length: 6 },
      {
        type: "text",
        text: `状态信息: ${statusData.message}`,
        font: { size: "caption2" },
        textColor: "#A1A1A6",
        maxLines: 2
      }
    ]
  };
}
