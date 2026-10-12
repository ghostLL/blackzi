/*
 * 中国电信小组件（Egern 版 · 优化）
 * 基于 xccverse/egern-widgets china-telecom.js
 *
 * 优化：
 *   - 流量/语音区分「国内」与「本地」
 *   - 界面美化（卡片、配色、布局）
 *   - 保留原版登录捕获 / Cookie 续期 / 缓存兜底
 *
 * 用法：同一文件双模式
 *   1. generic → 小组件
 *   2. request → 登录捕获
 *
 * 环境变量：
 *   CT_LOGIN_URL / CT_COOKIE
 *   CT_SHOW_USED_FLOW / CT_SHOW_USED_VOICE
 *   CT_SHOW_DIRECT   是否单独显示定向流量（默认有数据才显示）
 *   CT_TITLE
 */

const URLS = {
  login: 'https://e.dlife.cn/index.do',
  detail: 'https://e.dlife.cn/user/package_detail.do',
  balance: 'https://e.dlife.cn/user/balance.do',
};

const UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

/* ---------- 配色 ---------- */
const COLORS = {
  fee: '#FF9500',
  flowDom: '#0A84FF',
  flowLocal: '#64D2FF',
  voiceDom: '#34C759',
  voiceLocal: '#30D158',
  direct: '#AF52DE',
  ok: '#30D158',
  warn: '#FF3B30',
  cache: '#8E8E93',
  cardBg: { light: '#F2F2F7', dark: '#2C2C2E' },
  border: { light: '#E5E5EA', dark: '#3A3A3C' },
};

const ICONS = {
  fee: 'yensign.circle.fill',
  flowDom: 'antenna.radiowaves.left.and.right',
  flowLocal: 'wifi',
  voiceDom: 'phone.circle.fill',
  voiceLocal: 'phone.fill',
  direct: 'bolt.fill',
};

/* ---------- 工具 ---------- */

function formatFlow(flow) {
  const remain = flow / 1024;
  if (remain < 1024) return { amount: remain.toFixed(2), unit: 'MB' };
  return { amount: (remain / 1024).toFixed(2), unit: 'GB' };
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

function mergeCookies(oldCookie, newPairs) {
  const map = new Map();
  for (const p of String(oldCookie || '').split(';')) {
    const i = p.indexOf('=');
    if (i > 0) map.set(p.slice(0, i).trim(), p.slice(i + 1).trim());
  }
  for (const p of String(newPairs || '').split(';')) {
    const i = p.indexOf('=');
    if (i > 0) map.set(p.slice(0, i).trim(), p.slice(i + 1).trim());
  }
  return [...map].map(([k, v]) => `${k}=${v}`).join('; ');
}

/* ---------- 数据层 ---------- */

async function refreshCookie(ctx) {
  const loginUrl =
    (ctx.env.CT_LOGIN_URL || '').trim() || ctx.storage.get('ct_login_url') || '';
  if (!loginUrl) return ctx.storage.get('ct_cookie') || '';
  const url = (loginUrl.match(/(http.+)&sign/) || [])[1] || loginUrl;
  try {
    const resp = await ctx.http.get(url, {
      redirect: 'manual',
      timeout: 15000,
      credentials: 'omit',
      headers: { 'User-Agent': UA },
    });
    const setCookies = (resp.headers && resp.headers.getAll('set-cookie')) || [];
    const pairs = setCookies
      .map((c) => String(c).split(';')[0].trim())
      .filter(Boolean);
    if (pairs.length > 0) {
      const merged = mergeCookies(ctx.storage.get('ct_cookie'), pairs.join('; '));
      if (merged) {
        ctx.storage.set('ct_cookie', merged);
        ctx.storage.set('ct_cookie_ts', String(Date.now()));
      }
    }
  } catch (_) {}
  return ctx.storage.get('ct_cookie') || '';
}

function harvestSetCookie(ctx, resp, cookie) {
  try {
    const setCookies = (resp.headers && resp.headers.getAll('set-cookie')) || [];
    const pairs = setCookies
      .map((c) => String(c).split(';')[0].trim())
      .filter(Boolean);
    if (pairs.length > 0) {
      const merged = mergeCookies(cookie, pairs.join('; '));
      if (merged && merged !== cookie) {
        ctx.storage.set('ct_cookie', merged);
        ctx.storage.set('ct_cookie_ts', String(Date.now()));
      }
      return merged || cookie;
    }
  } catch (_) {}
  return cookie;
}

async function fetchJson(ctx, url, cookie) {
  const resp = await ctx.http.get(url, {
    headers: {
      Cookie: cookie,
      'User-Agent': UA,
      Accept: 'application/json, text/plain, */*',
      Referer: 'https://e.dlife.cn/',
    },
    timeout: 15000,
    credentials: 'omit',
  });
  if (!resp || resp.status !== 200) {
    const err = new Error(`HTTP ${resp ? resp.status : 'no-response'}: ${url}`);
    if (resp && (resp.status === 401 || resp.status === 403)) err.authDead = true;
    throw err;
  }
  let data;
  try {
    data = await resp.json();
  } catch (_) {
    const err = new Error(`登录失效（接口未返回 JSON）：${url}`);
    err.authDead = true;
    throw err;
  }
  harvestSetCookie(ctx, resp, cookie);
  return data;
}

function parseTelecom(detail, balance, opts) {
  const { showUsedFlow, showUsedVoice } = opts || {};

  // 流量：国内 / 本地 / 定向
  let domFlowT = 0,
    domFlowB = 0,
    domFlowU = 0;
  let locFlowT = 0,
    locFlowB = 0,
    locFlowU = 0;
  let dirFlowT = 0,
    dirFlowB = 0,
    dirFlowU = 0;

  // 语音：国内 / 本地
  let domVoiceT = 0,
    domVoiceB = 0;
  let locVoiceT = 0,
    locVoiceB = 0;

  let hasLocalFlow = false;
  let hasLocalVoice = false;
  let isUnlimitedFlow = false;

  for (const data of detail?.items || []) {
    if (data.offerType === 19) continue;
    for (const item of data.items || []) {
      const name = item.ratableResourcename || '';
      const unitType = item.unitTypeId;

      // 流量
      if (unitType == 3) {
        const isInvalid = item.balanceAmount == '999999999999';
        const t = parseFloat(item.ratableAmount) || 0;
        const b = parseFloat(item.balanceAmount) || 0;
        const u = parseFloat(item.usageAmount) || 0;
        const directional = isDirectional(name);
        const local = isLocalName(name);

        if (!(item.usageAmount == 0 && item.balanceAmount == 0) && !isInvalid) {
          if (directional) {
            dirFlowT += t;
            dirFlowB += b;
          } else if (local) {
            hasLocalFlow = true;
            locFlowT += t;
            locFlowB += b;
          } else {
            domFlowT += t;
            domFlowB += b;
          }
        }
        if (directional) dirFlowU += u;
        else if (local) {
          hasLocalFlow = true;
          locFlowU += u;
        } else domFlowU += u;

        if (data.offerType == 21 && item.ratableAmount == '0') {
          isUnlimitedFlow = true;
        }
      }

      // 语音
      else if (!detail.voiceBalance && unitType == 1) {
        const t = parseInt(item.ratableAmount, 10) || 0;
        const b = parseInt(item.balanceAmount, 10) || 0;
        if (isLocalName(name)) {
          hasLocalVoice = true;
          locVoiceT += t;
          locVoiceB += b;
        } else {
          domVoiceT += t;
          domVoiceB += b;
        }
      }
    }
  }

  if (detail.voiceAmount && detail.voiceBalance) {
    domVoiceT = detail.voiceAmount;
    domVoiceB = detail.voiceBalance;
  }

  const mkFlow = (remainTitle, total, balAmt, usedAmt, color) => {
    const bal = formatFlow(balAmt);
    const used = formatFlow(usedAmt);
    const f = {
      title: remainTitle,
      number: bal.amount,
      unit: bal.unit,
      percent: +(((balAmt / (total || 1)) * 100).toFixed(1)),
      color,
    };
    if (showUsedFlow || isUnlimitedFlow) {
      f.title = remainTitle.replace('剩余', '已用').replace('流量', '已用');
      if (!/已用/.test(f.title)) f.title = remainTitle.replace('流量', '已用');
      f.number = used.amount;
      f.unit = used.unit;
    }
    return f;
  };

  const flowDomestic = mkFlow('国内流量', domFlowT, domFlowB, domFlowU, COLORS.flowDom);
  if (isUnlimitedFlow && !showUsedFlow) {
    const used = formatFlow(domFlowU);
    flowDomestic.title = '国内已用';
    flowDomestic.number = used.amount;
    flowDomestic.unit = used.unit;
  }

  let flowLocal = null;
  if (hasLocalFlow) {
    flowLocal = mkFlow('本地流量', locFlowT, locFlowB, locFlowU, COLORS.flowLocal);
  }

  let flowDirect = null;
  if (dirFlowT + dirFlowB + dirFlowU > 0) {
    flowDirect = mkFlow('定向流量', dirFlowT, dirFlowB, dirFlowU, COLORS.direct);
  }

  const mkVoice = (title, total, bal, color) => {
    const used = Math.max(0, total - bal);
    return {
      title: showUsedVoice ? title.replace('剩余', '已用') : title,
      number: `${showUsedVoice ? used : bal}`,
      unit: '分钟',
      percent: +(((bal / (total || 1)) * 100).toFixed(1)),
      color,
    };
  };

  const voiceDomestic = mkVoice('国内语音', domVoiceT, domVoiceB, COLORS.voiceDom);
  let voiceLocal = null;
  if (hasLocalVoice) {
    voiceLocal = mkVoice('本地语音', locVoiceT, locVoiceB, COLORS.voiceLocal);
  }

  // 话费
  const feeNum = Number(balance?.totalBalanceAvailable);
  let feeTitle = '话费余额';
  let feeNumber = '0.00';
  let feeColor = COLORS.fee;
  if (Number.isFinite(feeNum)) {
    if (feeNum < 0) {
      feeTitle = '当前欠费';
      feeNumber = (Math.abs(feeNum) / 100).toFixed(2);
      feeColor = COLORS.warn;
    } else {
      feeNumber = (feeNum / 100).toFixed(2);
    }
  }
  // 欠费字段兜底
  const oweRaw =
    balance?.oweFee ?? balance?.oweAmount ?? balance?.data?.oweFee ?? null;
  if ((!Number.isFinite(feeNum) || feeNum === 0) && oweRaw != null) {
    const owe = Math.abs(Number(oweRaw));
    if (Number.isFinite(owe) && owe > 0) {
      feeTitle = '当前欠费';
      feeNumber = (owe / 100).toFixed(2);
      feeColor = COLORS.warn;
    }
  }

  const fee = {
    title: feeTitle,
    number: feeNumber,
    unit: '元',
    color: feeColor,
  };

  return {
    fee,
    flowDomestic,
    flowLocal,
    flowDirect,
    voiceDomestic,
    voiceLocal,
    hasLocalFlow,
    hasLocalVoice,
    hasDirectFlow: !!flowDirect,
    updatedAt: Date.now(),
  };
}

async function tryCookie(ctx, cookie, settings) {
  const detail = await fetchJson(ctx, URLS.detail, cookie);
  const balance = await fetchJson(ctx, URLS.balance, cookie);
  const ds = parseTelecom(detail, balance, settings);
  const feeRaw = balance?.totalBalanceAvailable;
  if (feeRaw === undefined || feeRaw === null || feeRaw === '') {
    const cached = ctx.storage.getJSON('ct_datasource');
    if (cached?.fee?.number) ds.fee = cached.fee;
  }
  ctx.storage.setJSON('ct_datasource', ds);
  try {
    ctx.storage.setJSON('ct_raw', { detail, balance, at: ds.updatedAt || Date.now() });
  } catch (_) {}
  return ds;
}

async function loadData(ctx) {
  const envCookie = (ctx.env.CT_COOKIE || '').trim();
  const loginUrl =
    (ctx.env.CT_LOGIN_URL || '').trim() || ctx.storage.get('ct_login_url') || '';
  const settings = {
    showUsedFlow: String(ctx.env.CT_SHOW_USED_FLOW || '').toLowerCase() === 'true',
    showUsedVoice: String(ctx.env.CT_SHOW_USED_VOICE || '').toLowerCase() === 'true',
  };
  const storedCookie = ctx.storage.get('ct_cookie') || '';
  const configured = !!(envCookie || loginUrl || storedCookie);

  const firstCookie = envCookie || storedCookie;
  let cookieDead = false;

  // 超过 2 小时预刷新
  const cookieTs = Number(ctx.storage.get('ct_cookie_ts') || 0);
  if (!envCookie && loginUrl && Date.now() - cookieTs > 2 * 60 * 60 * 1000) {
    try {
      await refreshCookie(ctx);
    } catch (_) {}
  }

  if (firstCookie || ctx.storage.get('ct_cookie')) {
    try {
      const ds = await tryCookie(ctx, ctx.storage.get('ct_cookie') || firstCookie, settings);
      ctx.storage.set('ct_cookie_ts', String(Date.now()));
      return { configured, ds, fromCache: false };
    } catch (e) {
      if (e && e.authDead) cookieDead = true;
    }
  }

  if (!envCookie && loginUrl) {
    try {
      const fresh = await refreshCookie(ctx);
      if (fresh) {
        const ds = await tryCookie(ctx, fresh, settings);
        return { configured, ds, fromCache: false };
      }
    } catch (e) {
      if (e && e.authDead) cookieDead = true;
    }
  }

  const raw = ctx.storage.getJSON('ct_raw');
  if (raw && raw.detail) {
    try {
      const ds = parseTelecom(raw.detail, raw.balance, settings);
      ds.updatedAt = raw.at || ds.updatedAt;
      return { configured, ds, fromCache: true, cookieDead };
    } catch (_) {}
  }
  const cached = ctx.storage.getJSON('ct_datasource');
  return { configured, ds: cached || null, fromCache: !!cached, cookieDead };
}

/* ---------- 渲染 ---------- */

function showDirectCard(ctx, ds) {
  const v = String(ctx?.env?.CT_SHOW_DIRECT || '').toLowerCase();
  if (v === 'false') return false;
  if (v === 'true') return true;
  return !!ds.hasDirectFlow;
}

/** 美化卡片：图标 + 标题 + 数值(单位) */
function prettyCard(icon, color, data, compact) {
  const numText = `${data.number ?? '0'}${data.unit ? ' ' + data.unit : ''}`;
  return {
    type: 'stack',
    direction: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    flex: 1,
    gap: compact ? 2 : 3,
    padding: compact ? [8, 6, 8, 6] : [10, 8, 10, 8],
    backgroundColor: COLORS.cardBg,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    children: [
      {
        type: 'image',
        src: `sf-symbol:${icon}`,
        width: compact ? 16 : 22,
        height: compact ? 16 : 22,
        color: color || data.color || COLORS.flowDom,
      },
      {
        type: 'text',
        text: data.title,
        font: { size: 'caption2', weight: 'medium' },
        opacity: 0.65,
        maxLines: 1,
        minScale: 0.8,
      },
      {
        type: 'text',
        text: numText,
        font: {
          size: compact ? 'footnote' : 'body',
          weight: 'bold',
        },
        maxLines: 1,
        minScale: 0.7,
      },
    ],
  };
}

/** 话费横条（整行） */
function feeBar(ds) {
  return {
    type: 'stack',
    direction: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    padding: [10, 12, 10, 12],
    backgroundColor: COLORS.cardBg,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    children: [
      {
        type: 'image',
        src: `sf-symbol:${ICONS.fee}`,
        width: 20,
        height: 20,
        color: ds.fee.color || COLORS.fee,
      },
      {
        type: 'text',
        text: ds.fee.title,
        font: { size: 'caption1', weight: 'medium' },
        opacity: 0.65,
      },
      {
        type: 'text',
        text: `${ds.fee.number} ${ds.fee.unit}`,
        font: { size: 'title2', weight: 'bold' },
        color: ds.fee.color || COLORS.fee,
      },
    ],
  };
}

function headerRow(title, ds, fromCache, cookieDead) {
  const t = ds && ds.updatedAt ? fmtTime(ds.updatedAt) : '--:--';
  const dotColor = cookieDead ? COLORS.warn : fromCache ? COLORS.cache : COLORS.ok;
  return {
    type: 'stack',
    direction: 'row',
    alignItems: 'center',
    gap: 5,
    children: [
      {
        type: 'image',
        src: 'sf-symbol:circle.fill',
        width: 8,
        height: 8,
        color: dotColor,
      },
      {
        type: 'text',
        text: title,
        font: { size: 'footnote', weight: 'semibold' },
      },
      { type: 'spacer' },
      {
        type: 'text',
        text: cookieDead
          ? '登录失效，点我重登'
          : fromCache
            ? `缓存 ${t}`
            : `更新 ${t}`,
        font: { size: 'caption2' },
        opacity: cookieDead ? 1 : 0.55,
      },
    ],
  };
}

function buildMedium(title, ds, fromCache, ctx, cookieDead) {
  // 上行：国内流量 + 本地流量（无本地则单卡）
  const flowRow = [
    prettyCard(ICONS.flowDom, COLORS.flowDom, ds.flowDomestic, false),
  ];
  if (ds.flowLocal) {
    flowRow.push(prettyCard(ICONS.flowLocal, COLORS.flowLocal, ds.flowLocal, false));
  }
  if (showDirectCard(ctx, ds) && ds.flowDirect) {
    flowRow.push(prettyCard(ICONS.direct, COLORS.direct, ds.flowDirect, false));
  }

  // 下行：国内语音 + 本地语音
  const voiceRow = [
    prettyCard(ICONS.voiceDom, COLORS.voiceDom, ds.voiceDomestic, false),
  ];
  if (ds.voiceLocal) {
    voiceRow.push(prettyCard(ICONS.voiceLocal, COLORS.voiceLocal, ds.voiceLocal, false));
  }

  return {
    type: 'widget',
    padding: 12,
    gap: 8,
    refreshAfter: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
    children: [
      headerRow(title, ds, fromCache, cookieDead),
      feeBar(ds),
      {
        type: 'stack',
        direction: 'row',
        gap: 8,
        children: flowRow,
      },
      {
        type: 'stack',
        direction: 'row',
        gap: 8,
        children: voiceRow,
      },
    ],
  };
}

function buildSmall(title, ds, fromCache, ctx, cookieDead) {
  // 小尺寸：话费 + 国内流量 / 国内语音，底部提示本地
  const children = [
    headerRow(title, ds, fromCache, cookieDead),
    {
      type: 'stack',
      direction: 'row',
      gap: 6,
      children: [
        prettyCard(ICONS.fee, ds.fee.color || COLORS.fee, ds.fee, true),
      ],
    },
    {
      type: 'stack',
      direction: 'row',
      gap: 6,
      children: [
        prettyCard(ICONS.flowDom, COLORS.flowDom, ds.flowDomestic, true),
        prettyCard(ICONS.voiceDom, COLORS.voiceDom, ds.voiceDomestic, true),
      ],
    },
  ];

  if (ds.hasLocalFlow || ds.hasLocalVoice) {
    const tips = [];
    if (ds.flowLocal) tips.push(`本地流量 ${ds.flowLocal.number}${ds.flowLocal.unit}`);
    if (ds.voiceLocal) tips.push(`本地语音 ${ds.voiceLocal.number}分`);
    children.push({
      type: 'text',
      text: tips.join(' · '),
      font: { size: 'caption2' },
      opacity: 0.55,
      textAlign: 'center',
      maxLines: 1,
      minScale: 0.7,
    });
  }

  return {
    type: 'widget',
    padding: 10,
    gap: 6,
    refreshAfter: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
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
  const parts = [
    `¥${ds.fee.number}`,
    `${ds.flowDomestic.number}${ds.flowDomestic.unit}`,
    `${ds.voiceDomestic.number}分`,
  ];
  if (ds.flowLocal) parts.push(`本${ds.flowLocal.number}${ds.flowLocal.unit}`);
  return {
    type: 'widget',
    padding: 8,
    gap: 4,
    children: [
      { type: 'text', text: title, font: { size: 'caption2', weight: 'semibold' } },
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
    padding: 14,
    gap: 6,
    children: [
      { type: 'text', text: title, font: { size: 'footnote', weight: 'semibold' } },
      {
        type: 'image',
        src: 'sf-symbol:exclamationmark.triangle',
        width: 22,
        height: 22,
        color: '#FF9500',
      },
      { type: 'text', text: message, font: { size: 'caption1' }, opacity: 0.7 },
    ],
  };
  if (url) w.url = url;
  return w;
}

/* ---------- 捕获 ---------- */

function getReqCookie(headers) {
  if (!headers) return '';
  if (typeof headers.get === 'function') {
    return headers.get('cookie') || headers.get('Cookie') || '';
  }
  for (const k of Object.keys(headers)) {
    if (String(k).toLowerCase() === 'cookie') return headers[k] || '';
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
  if (!cookie) return;
  const merged = mergeCookies(ctx.storage.get('ct_cookie'), cookie);
  if (merged && merged !== ctx.storage.get('ct_cookie')) {
    ctx.storage.set('ct_cookie', merged);
    ctx.storage.set('ct_cookie_ts', String(Date.now()));
  }

  const ts = Number(ctx.storage.get('ct_login_ts') || 0);
  if (Date.now() - ts < 10 * 60 * 1000) {
    ctx.storage.delete('ct_login_ts');
    ctx.notify({
      title: '中国电信',
      body: '登录成功，小组件将自动更新',
      action: { type: 'clipboard', text: merged || cookie },
    });
  }
}

/* ---------- 小组件入口 ---------- */

async function handleWidget(ctx) {
  const title = (ctx.env.CT_TITLE || '中国电信').trim() || '中国电信';
  const { configured, ds, fromCache, cookieDead } = await loadData(ctx);

  if (!configured) {
    return buildError(title, '未登录：在 Safari 打开 e.dlife.cn 登录一次', URLS.login);
  }
  if (!ds) {
    return buildError(
      title,
      cookieDead ? '登录已失效，请重新登录' : '数据获取失败，请检查网络或重新登录',
      URLS.login
    );
  }

  const family = ctx.widgetFamily || 'systemSmall';
  let w;
  if (
    family === 'systemMedium' ||
    family === 'systemLarge' ||
    family === 'systemExtraLarge'
  ) {
    w = buildMedium(title, ds, fromCache, ctx, cookieDead);
  } else if (family.startsWith('accessory')) {
    w = buildLockScreen(title, ds, family);
  } else {
    w = buildSmall(title, ds, fromCache, ctx, cookieDead);
  }
  if (cookieDead) w.url = URLS.login;
  return w;
}

export default async function (ctx) {
  if (ctx.request && ctx.request.url) {
    return handleCapture(ctx);
  }
  if (!ctx.widgetFamily) {
    const keep = String(ctx.env?.CT_KEEPALIVE || '').toLowerCase();
    if (keep === 'false' || keep === '0') return { type: 'text', text: 'keepalive disabled' };
    try {
      await loadData(ctx);
    } catch (_) {}
    return { type: 'text', text: 'keepalive done' };
  }
  return handleWidget(ctx);
}
