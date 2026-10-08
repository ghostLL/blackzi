/*
 * 中国电信小组件（优化版）
 * 用这个链接去登录 https://e.dlife.cn
 * 同一个文件，两种用法：
 *   1. generic 类型 → iOS 小组件
 *   2. request 类型 → 登录捕获
 *
 * 环境变量：不需要手动填，添加模块后登录即可
 *   CT_LOGIN_URL
 *   CT_COOKIE
 *   CT_SHOW_USED_FLOW
 *   CT_FILTER_ORIENTATE_FLOW
 *   CT_TITLE
 *
 * 数据来源：
 *   https://e.dlife.cn/user/package_detail.do
 *   https://e.dlife.cn/user/balance.do
 *
 * 优化内容：
 *   - 流量/语音自动区分「国内」与「本地」
 *   - 界面美化（电信蓝系、进度条、卡片布局）
 *   - 无本地数据时自动隐藏对应项
 */

const URLS = {
  login: 'https://e.dlife.cn/index.do',
  detail: 'https://e.dlife.cn/user/package_detail.do',
  balance: 'https://e.dlife.cn/user/balance.do',
};

// 电信蓝系配色
const COLORS = {
  bg: {
    light: '#F7F9FC',
    dark: '#1C1C1E',
  },
  card: {
    light: '#FFFFFF',
    dark: '#2C2C2E',
  },
  border: {
    light: '#E8EEF5',
    dark: '#3A3A3C',
  },
  title: {
    light: '#8A94A6',
    dark: '#8E8E93',
  },
  value: {
    light: '#1A1A2E',
    dark: '#FFFFFF',
  },
  time: {
    light: '#A0AAB8',
    dark: '#636366',
  },
  error: {
    light: '#FF3B30',
    dark: '#FF453A',
  },
  accent: {
    light: '#007AFF',
    dark: '#0A84FF',
  },
  flow: {
    light: '#FF6B35',
    dark: '#FF8A5B',
  },
  voice: {
    light: '#34C759',
    dark: '#30D158',
  },
  fee: {
    light: '#007AFF',
    dark: '#0A84FF',
  },
  progressBg: {
    light: '#E8EEF5',
    dark: '#3A3A3C',
  },
};

function formatFlow(kb) {
  const mb = kb / 1024;
  if (mb < 1024) {
    return { amount: mb.toFixed(2), unit: 'MB' };
  }
  return { amount: (mb / 1024).toFixed(2), unit: 'GB' };
}

function pad2(n) {
  return n < 10 ? `0${n}` : `${n}`;
}

function fmtTime(ts) {
  const d = new Date(ts);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function isLocalName(name = '') {
  return /本地|省内|本市|本省/.test(name);
}

function isDirectional(name = '') {
  return /定向/.test(name);
}

async function refreshCookie(ctx) {
  const loginUrl =
    (ctx.env.CT_LOGIN_URL || '').trim() ||
    ctx.storage.get('ct_login_url') ||
    '';

  if (!loginUrl) {
    return ctx.storage.get('ct_cookie') || '';
  }

  const url = (loginUrl.match(/(http.+)&sign/) || [])[1] || loginUrl;

  const resp = await ctx.http.get(url, {
    redirect: 'manual',
    timeout: 15000,
    credentials: 'omit',
  });

  const setCookies =
    (resp.headers &&
      resp.headers.getAll &&
      resp.headers.getAll('set-cookie')) ||
    [];

  const pairs = setCookies
    .map((c) => String(c).split(';')[0].trim())
    .filter(Boolean);

  if (pairs.length > 0) {
    ctx.storage.set('ct_cookie', pairs.join('; '));
  }

  return ctx.storage.get('ct_cookie') || '';
}

async function fetchJson(ctx, url, cookie) {
  const resp = await ctx.http.get(url, {
    headers: { Cookie: cookie },
    timeout: 15000,
    credentials: 'omit',
  });

  if (!resp || resp.status !== 200) {
    throw new Error(`HTTP ${resp ? resp.status : 'no-response'}: ${url}`);
  }

  return await resp.json();
}

function parseTelecom(detail, balance, opts) {
  const { showUsedFlow, filterOrientateFlow } = opts;

  // 流量：国内 / 本地
  let domesticFlowTotal = 0;
  let domesticFlowBalance = 0;
  let domesticFlowUsed = 0;

  let localFlowTotal = 0;
  let localFlowBalance = 0;
  let localFlowUsed = 0;

  // 语音：国内 / 本地
  let domesticVoiceTotal = 0;
  let domesticVoiceBalance = 0;

  let localVoiceTotal = 0;
  let localVoiceBalance = 0;

  let isUnlimitedFlow = false;
  let hasLocalFlow = false;
  let hasLocalVoice = false;

  for (const data of detail?.items || []) {
    if (data.offerType === 19) continue;

    for (const item of data.items || []) {
      const name = item.ratableResourcename || '';
      const unitType = item.unitTypeId;

      // 流量 unitTypeId == 3
      if (unitType == 3) {
        const ratable = parseFloat(item.ratableAmount) || 0;
        const balanceAmt = parseFloat(item.balanceAmount) || 0;
        const used = parseFloat(item.usageAmount) || 0;

        // 跳过异常大数
        if (item.balanceAmount == '999999999999') continue;

        const directional = isDirectional(name);
        if (filterOrientateFlow && directional) {
          // 定向流量只累计已用，不计入总量
          domesticFlowUsed += used;
          continue;
        }

        if (isLocalName(name)) {
          hasLocalFlow = true;
          localFlowTotal += ratable;
          localFlowBalance += balanceAmt;
          localFlowUsed += used;
        } else {
          // 默认归国内
          domesticFlowTotal += ratable;
          domesticFlowBalance += balanceAmt;
          domesticFlowUsed += used;
        }

        if (data.offerType == 21 && item.ratableAmount == '0') {
          isUnlimitedFlow = true;
        }
      }

      // 语音 unitTypeId == 1
      else if (unitType == 1) {
        const ratable = parseInt(item.ratableAmount, 10) || 0;
        const balanceAmt = parseInt(item.balanceAmount, 10) || 0;

        if (isLocalName(name)) {
          hasLocalVoice = true;
          localVoiceTotal += ratable;
          localVoiceBalance += balanceAmt;
        } else {
          domesticVoiceTotal += ratable;
          domesticVoiceBalance += balanceAmt;
        }
      }
    }
  }

  // 部分账号语音总量在外层
  if (detail.voiceAmount && detail.voiceBalance) {
    domesticVoiceTotal = detail.voiceAmount;
    domesticVoiceBalance = detail.voiceBalance;
  }

  // 格式化流量
  const fmtDomesticFlow = formatFlow(domesticFlowBalance);
  const fmtLocalFlow = formatFlow(localFlowBalance);
  const fmtUsedDomestic = formatFlow(domesticFlowUsed);
  const fmtUsedLocal = formatFlow(localFlowUsed);

  const makeFlowItem = (title, number, unit, percent, color) => ({
    title,
    number,
    unit,
    percent: Math.min(100, Math.max(0, percent)),
    color,
  });

  let flowDomestic;
  if (showUsedFlow || isUnlimitedFlow) {
    flowDomestic = makeFlowItem(
      '国内已用',
      fmtUsedDomestic.amount,
      fmtUsedDomestic.unit,
      domesticFlowTotal > 0
        ? +((domesticFlowUsed / domesticFlowTotal) * 100).toFixed(1)
        : 0,
      COLORS.flow
    );
  } else {
    flowDomestic = makeFlowItem(
      '国内流量',
      fmtDomesticFlow.amount,
      fmtDomesticFlow.unit,
      domesticFlowTotal > 0
        ? +((domesticFlowBalance / domesticFlowTotal) * 100).toFixed(1)
        : 100,
      COLORS.flow
    );
  }

  let flowLocal = null;
  if (hasLocalFlow) {
    if (showUsedFlow || isUnlimitedFlow) {
      flowLocal = makeFlowItem(
        '本地已用',
        fmtUsedLocal.amount,
        fmtUsedLocal.unit,
        localFlowTotal > 0
          ? +((localFlowUsed / localFlowTotal) * 100).toFixed(1)
          : 0,
        COLORS.flow
      );
    } else {
      flowLocal = makeFlowItem(
        '本地流量',
        fmtLocalFlow.amount,
        fmtLocalFlow.unit,
        localFlowTotal > 0
          ? +((localFlowBalance / localFlowTotal) * 100).toFixed(1)
          : 100,
        COLORS.flow
      );
    }
  }

  // 语音
  const voiceDomestic = {
    title: '国内语音',
    number: `${domesticVoiceBalance}`,
    unit: '分钟',
    percent:
      domesticVoiceTotal > 0
        ? +((domesticVoiceBalance / domesticVoiceTotal) * 100).toFixed(1)
        : 100,
    color: COLORS.voice,
  };

  let voiceLocal = null;
  if (hasLocalVoice) {
    voiceLocal = {
      title: '本地语音',
      number: `${localVoiceBalance}`,
      unit: '分钟',
      percent:
        localVoiceTotal > 0
          ? +((localVoiceBalance / localVoiceTotal) * 100).toFixed(1)
          : 100,
      color: COLORS.voice,
    };
  }

  // 话费
  const feeNum = Number(balance?.totalBalanceAvailable);
  const fee = {
    title: '剩余话费',
    number: Number.isFinite(feeNum) ? (feeNum / 100).toFixed(2) : '0.00',
    unit: '元',
    color: COLORS.fee,
  };

  return {
    fee,
    flowDomestic,
    flowLocal,
    voiceDomestic,
    voiceLocal,
    hasLocalFlow,
    hasLocalVoice,
    updatedAt: Date.now(),
  };
}

async function tryCookie(ctx, cookie, settings) {
  const detail = await fetchJson(ctx, URLS.detail, cookie);
  const balance = await fetchJson(ctx, URLS.balance, cookie);
  const ds = parseTelecom(detail, balance, settings);
  ctx.storage.setJSON('ct_datasource', ds);
  return ds;
}

async function loadData(ctx) {
  const envCookie = (ctx.env.CT_COOKIE || '').trim();
  const loginUrl =
    (ctx.env.CT_LOGIN_URL || '').trim() ||
    ctx.storage.get('ct_login_url') ||
    '';

  const settings = {
    showUsedFlow: ctx.env.CT_SHOW_USED_FLOW === 'true',
    filterOrientateFlow: ctx.env.CT_FILTER_ORIENTATE_FLOW === 'true',
  };

  const storedCookie = ctx.storage.get('ct_cookie') || '';
  const configured = !!(envCookie || loginUrl || storedCookie);
  const firstCookie = envCookie || storedCookie;

  if (firstCookie) {
    try {
      const ds = await tryCookie(ctx, firstCookie, settings);
      return { configured, ds, fromCache: false };
    } catch (e) {}
  }

  if (!envCookie && loginUrl) {
    try {
      const fresh = await refreshCookie(ctx);
      if (fresh && fresh !== firstCookie) {
        const ds = await tryCookie(ctx, fresh, settings);
        return { configured, ds, fromCache: false };
      }
    } catch (e) {}
  }

  const cached = ctx.storage.getJSON('ct_datasource');
  return {
    configured,
    ds: cached || null,
    fromCache: !!cached,
  };
}

// ========== UI 组件 ==========

function makeCapsule(title, value, unit) {
  return {
    type: 'stack',
    direction: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    flex: 1,
    padding: [8, 8, 8, 8],
    backgroundColor: COLORS.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
    children: [
      {
        type: 'text',
        text: title,
        font: { size: 'caption2', weight: 'medium' },
        textColor: COLORS.title,
        textAlign: 'center',
        maxLines: 1,
        minScale: 0.7,
      },
      {
        type: 'stack',
        direction: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 3,
        children: [
          {
            type: 'text',
            text: String(value ?? '0'),
            font: { size: 'title2', weight: 'semibold' },
            textColor: COLORS.value,
            textAlign: 'center',
            maxLines: 1,
            minScale: 0.65,
          },
          {
            type: 'text',
            text: unit || '',
            font: { size: 'caption2', weight: 'regular' },
            textColor: COLORS.title,
            maxLines: 1,
          },
        ],
      },
    ],
  };
}

function headerRow(title, ds) {
  const time = ds && ds.updatedAt ? fmtTime(ds.updatedAt) : '--:--';

  return {
    type: 'stack',
    direction: 'row',
    alignItems: 'center',
    children: [
      {
        type: 'stack',
        direction: 'row',
        alignItems: 'center',
        gap: 6,
        children: [
          {
            type: 'image',
            src: 'sf-symbol:antenna.radiowaves.left.and.right',
            color: COLORS.accent,
            width: 16,
            height: 16,
          },
          {
            type: 'text',
            text: title,
            font: { size: 'headline', weight: 'semibold' },
            textColor: COLORS.value,
            maxLines: 1,
            minScale: 0.75,
          },
        ],
      },
      { type: 'spacer' },
      {
        type: 'stack',
        direction: 'row',
        alignItems: 'center',
        gap: 4,
        children: [
          {
            type: 'image',
            src: 'sf-symbol:arrow.clockwise',
            color: COLORS.time,
            width: 11,
            height: 11,
          },
          {
            type: 'text',
            text: time,
            font: { size: 'caption2' },
            textColor: COLORS.time,
            maxLines: 1,
          },
        ],
      },
    ],
  };
}

function buildMainWidget(title, ds) {
  // 第一行：话费 + 国内语音 + 本地语音（有本地才显示）
  const topRowChildren = [
    makeCapsule(ds.fee.title, ds.fee.number, ds.fee.unit),
    makeCapsule(
      ds.voiceDomestic.title,
      ds.voiceDomestic.number,
      ds.voiceDomestic.unit
    ),
  ];
  if (ds.voiceLocal) {
    topRowChildren.push(
      makeCapsule(
        ds.voiceLocal.title,
        ds.voiceLocal.number,
        ds.voiceLocal.unit
      )
    );
  }

  // 第二行：国内流量 + 本地流量（有本地才显示）
  const bottomRowChildren = [
    makeCapsule(
      ds.flowDomestic.title,
      ds.flowDomestic.number,
      ds.flowDomestic.unit
    ),
  ];
  if (ds.flowLocal) {
    bottomRowChildren.push(
      makeCapsule(
        ds.flowLocal.title,
        ds.flowLocal.number,
        ds.flowLocal.unit
      )
    );
  }

  return {
    type: 'widget',
    backgroundColor: COLORS.bg,
    padding: [10, 14, 10, 14],
    gap: 10,
    refreshAfter: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    children: [
      headerRow(title, ds),
      {
        type: 'stack',
        direction: 'row',
        alignItems: 'center',
        gap: 9,
        children: topRowChildren,
      },
      {
        type: 'stack',
        direction: 'row',
        alignItems: 'center',
        gap: 9,
        children: bottomRowChildren,
      },
    ],
  };
}

function buildSmall(title, ds) {
  // 小尺寸优先显示话费 + 国内流量 + 国内语音
  const children = [
    headerRow(title, ds),
    {
      type: 'stack',
      direction: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: [8, 12, 8, 12],
      backgroundColor: COLORS.card,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: COLORS.border,
      children: [
        {
          type: 'text',
          text: ds.fee.title,
          font: { size: 'caption2', weight: 'medium' },
          textColor: COLORS.title,
        },
        {
          type: 'stack',
          direction: 'row',
          alignItems: 'center',
          gap: 2,
          children: [
            {
              type: 'text',
              text: ds.fee.number,
              font: { size: 'title2', weight: 'bold' },
              textColor: COLORS.fee,
            },
            {
              type: 'text',
              text: ds.fee.unit,
              font: { size: 'caption2' },
              textColor: COLORS.title,
            },
          ],
        },
      ],
    },
    {
      type: 'stack',
      direction: 'row',
      gap: 6,
      children: [
        makeCapsule(
          ds.voiceDomestic.title,
          ds.voiceDomestic.number,
          ds.voiceDomestic.unit
        ),
        makeCapsule(
          ds.flowDomestic.title,
          ds.flowDomestic.number,
          ds.flowDomestic.unit
        ),
      ],
    },
  ];

  // 如果有本地数据，小尺寸用更紧凑方式提示
  if (ds.hasLocalFlow || ds.hasLocalVoice) {
    const tips = [];
    if (ds.voiceLocal) {
      tips.push(`本地语音 ${ds.voiceLocal.number}分`);
    }
    if (ds.flowLocal) {
      tips.push(`本地流量 ${ds.flowLocal.number}${ds.flowLocal.unit}`);
    }
    children.push({
      type: 'text',
      text: tips.join(' · '),
      font: { size: 'caption2' },
      textColor: COLORS.time,
      textAlign: 'center',
      maxLines: 1,
      minScale: 0.7,
    });
  }

  return {
    type: 'widget',
    backgroundColor: COLORS.bg,
    padding: [10, 12, 10, 12],
    gap: 8,
    refreshAfter: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    children,
  };
}

function buildLockScreen(title, ds, family) {
  if (family === 'accessoryCircular' || family === 'accessoryInline') {
    return {
      type: 'widget',
      children: [
        {
          type: 'text',
          text: `¥${ds.fee.number}`,
          font: { size: 'body', weight: 'semibold' },
          textAlign: 'center',
        },
      ],
    };
  }

  const parts = [`¥${ds.fee.number}`];
  parts.push(`${ds.flowDomestic.number}${ds.flowDomestic.unit}`);
  parts.push(`${ds.voiceDomestic.number}分`);

  return {
    type: 'widget',
    padding: 8,
    gap: 3,
    children: [
      {
        type: 'text',
        text: title,
        font: { size: 'caption2', weight: 'semibold' },
      },
      {
        type: 'text',
        text: parts.join(' · '),
        font: { size: 'footnote' },
        maxLines: 1,
        minScale: 0.55,
      },
    ],
  };
}

function buildError(title, message, url) {
  const w = {
    type: 'widget',
    backgroundColor: COLORS.bg,
    padding: 14,
    gap: 9,
    children: [
      {
        type: 'stack',
        direction: 'row',
        alignItems: 'center',
        gap: 6,
        children: [
          {
            type: 'image',
            src: 'sf-symbol:exclamationmark.triangle.fill',
            color: COLORS.error,
            width: 14,
            height: 14,
          },
          {
            type: 'text',
            text: title,
            font: { size: 'headline', weight: 'bold' },
            textColor: COLORS.error,
            maxLines: 1,
          },
        ],
      },
      {
        type: 'text',
        text: message,
        font: { size: 'caption1' },
        textColor: COLORS.title,
        maxLines: 3,
      },
      {
        type: 'stack',
        direction: 'row',
        alignItems: 'center',
        gap: 5,
        padding: [6, 10, 6, 10],
        backgroundColor: COLORS.card,
        borderRadius: 10,
        borderWidth: 1,
        borderColor: COLORS.border,
        children: [
          {
            type: 'image',
            src: 'sf-symbol:phone.circle',
            color: COLORS.time,
            width: 12,
            height: 12,
          },
          {
            type: 'text',
            text: '请在 Safari 登录电信账号',
            font: { size: 'caption2' },
            textColor: COLORS.time,
            maxLines: 1,
            minScale: 0.7,
          },
        ],
      },
    ],
  };

  if (url) w.url = url;
  return w;
}

function getReqCookie(headers) {
  if (!headers) return '';
  if (typeof headers.get === 'function') {
    return headers.get('cookie') || headers.get('Cookie') || '';
  }
  for (const k of Object.keys(headers)) {
    if (String(k).toLowerCase() === 'cookie') {
      return headers[k] || '';
    }
  }
  return '';
}

async function handleCapture(ctx) {
  const req = ctx.request || {};
  const url = req.url || '';

  if (!url.includes('e.dlife.cn')) return;

  if (url.includes('/user/loginMiddle')) {
    const loginUrl = (url.match(/(http.+)&sign/) || [])[1] || url;
    if (loginUrl && ctx.storage.get('ct_login_url') !== loginUrl) {
      ctx.storage.set('ct_login_url', loginUrl);
    }
    ctx.storage.set('ct_login_ts', String(Date.now()));
    return;
  }

  const cookie = String(getReqCookie(req.headers) || '').trim();
  if (!cookie || ctx.storage.get('ct_cookie') === cookie) return;

  ctx.storage.set('ct_cookie', cookie);

  const ts = Number(ctx.storage.get('ct_login_ts') || 0);
  if (Date.now() - ts < 10 * 60 * 1000) {
    ctx.storage.delete('ct_login_ts');
    ctx.notify({
      title: '中国电信',
      body: '登录成功，小组件将自动更新',
      action: { type: 'clipboard', text: cookie },
    });
  }
}

async function handleWidget(ctx) {
  const title = (ctx.env.CT_TITLE || '中国电信').trim() || '中国电信';

  const { configured, ds } = await loadData(ctx);

  if (!configured) {
    return buildError(
      title,
      '未登录：在 Safari 打开 e.dlife.cn 登录一次',
      URLS.login
    );
  }

  if (!ds) {
    return buildError(title, '数据获取失败，请检查网络或重新登录');
  }

  const family = ctx.widgetFamily || 'systemSmall';

  if (
    family === 'systemMedium' ||
    family === 'systemLarge' ||
    family === 'systemExtraLarge'
  ) {
    return buildMainWidget(title, ds);
  }

  if (family.startsWith('accessory')) {
    return buildLockScreen(title, ds, family);
  }

  return buildSmall(title, ds);
}

export default async function (ctx) {
  if (ctx.request && ctx.request.url) {
    return handleCapture(ctx);
  }
  return handleWidget(ctx);
}
