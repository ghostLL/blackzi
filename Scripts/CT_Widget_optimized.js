/*
 * 中国电信 Egern 小组件 - 保活/缓存诊断优化版
 * 用法：替换原 CT_Widget.js；YAML 中 generic、http_request、schedule 均指向本文件。
 * 注意：主动访问接口不能保证服务端永久续期；如果登录会话被服务端撤销，仍需重新登录。
 */
const URLS = {
  login: 'https://e.dlife.cn/index.do',
  detail: 'https://e.dlife.cn/user/package_detail.do',
  balance: 'https://e.dlife.cn/user/balance.do',
};
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const COLORS = {
  bg: { light: '#F7F9FC', dark: '#1C1C1E' },
  card: { light: '#FFFFFF', dark: '#2C2C2E' },
  border: { light: '#E8EEF5', dark: '#3A3A3C' },
  title: { light: '#8A94A6', dark: '#8E8E93' },
  value: { light: '#1A1A2E', dark: '#FFFFFF' },
  time: { light: '#A0AAB8', dark: '#636366' },
  error: { light: '#FF3B30', dark: '#FF453A' },
  accent: { light: '#007AFF', dark: '#0A84FF' },
  flow: { light: '#FF6B35', dark: '#FF8A5B' },
  voice: { light: '#34C759', dark: '#30D158' },
  fee: { light: '#007AFF', dark: '#0A84FF' },
};
const MAX_CACHE_AGE = 60 * 60 * 1000;
const COOKIE_REFRESH_AGE = 25 * 60 * 1000;
const REQUEST_TIMEOUT = 15000;

function pad2(n) { return n < 10 ? `0${n}` : `${n}`; }
function fmtTime(ts) {
  if (!ts || !Number.isFinite(Number(ts))) return '--:--';
  const d = new Date(Number(ts));
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}
function fmtDateTime(ts) {
  if (!ts || !Number.isFinite(Number(ts))) return '从未成功';
  const d = new Date(Number(ts));
  return `${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${fmtTime(ts)}`;
}
function formatFlow(kb) {
  const mb = (Number(kb) || 0) / 1024;
  return mb < 1024 ? { amount: mb.toFixed(2), unit: 'MB' } : { amount: (mb / 1024).toFixed(2), unit: 'GB' };
}
function isLocalName(name = '') { return /本地|省内|本市|本省/.test(name); }
function isDirectional(name = '') { return /定向/.test(name); }
function mergeCookieString(oldStr, newStr) {
  const map = Object.create(null);
  const apply = (s) => String(s || '').split(';').forEach((part) => {
    const t = part.trim(); if (!t) return;
    const i = t.indexOf('='); if (i <= 0) return;
    const k = t.slice(0, i).trim(); const v = t.slice(i + 1).trim();
    if (k) map[k] = v;
  });
  apply(oldStr); apply(newStr);
  return Object.entries(map).map(([k, v]) => `${k}=${v}`).join('; ');
}
function extractSetCookies(resp) {
  if (!resp || !resp.headers) return [];
  try {
    if (typeof resp.headers.getAll === 'function') return resp.headers.getAll('set-cookie') || [];
    if (typeof resp.headers.get === 'function') {
      const v = resp.headers.get('set-cookie'); return v ? [v] : [];
    }
  } catch (_) {}
  return [];
}
function saveCookie(ctx, cookieStr) {
  const old = ctx.storage.get('ct_cookie') || '';
  const incoming = String(cookieStr || '').trim();
  if (!incoming) return old;
  const merged = mergeCookieString(old, incoming);
  if (merged) {
    ctx.storage.set('ct_cookie', merged);
    ctx.storage.set('ct_cookie_ts', String(Date.now()));
  }
  return merged || old;
}
function getReqCookie(headers) {
  if (!headers) return '';
  if (typeof headers.get === 'function') return headers.get('cookie') || headers.get('Cookie') || '';
  for (const k of Object.keys(headers)) if (String(k).toLowerCase() === 'cookie') return headers[k] || '';
  return '';
}
function errorText(e) {
  const s = String(e && e.message ? e.message : e || '未知错误');
  // 不把 Cookie、登录 URL 或完整响应内容写入诊断信息
  return s.replace(/https?:\/\/[^\s]+/g, '[接口]').slice(0, 180);
}
function setError(ctx, e) {
  ctx.storage.set('ct_last_error', errorText(e));
  ctx.storage.set('ct_last_attempt', String(Date.now()));
}
function setSuccess(ctx, ds) {
  const now = Date.now();
  ds.updatedAt = now;
  ctx.storage.setJSON('ct_datasource', ds);
  ctx.storage.set('ct_last_ok', String(now));
  ctx.storage.set('ct_last_attempt', String(now));
  ctx.storage.set('ct_last_error', '');
}

// 登录中间 URL 有时是短时签名 URL；这里只尝试一次，不把访问首页误认为续期成功。
async function refreshCookie(ctx) {
  const loginUrl = (ctx.env.CT_LOGIN_URL || '').trim() || ctx.storage.get('ct_login_url') || '';
  if (!loginUrl) return ctx.storage.get('ct_cookie') || '';
  const url = (loginUrl.match(/(http.+)&sign/) || [])[1] || loginUrl;
  const resp = await ctx.http.get(url, {
    redirect: 'manual', timeout: REQUEST_TIMEOUT, credentials: 'omit',
    headers: { 'User-Agent': UA, Accept: 'text/html,application/json,*/*' },
  });
  const pairs = extractSetCookies(resp).map((c) => String(c).split(';')[0].trim()).filter(Boolean);
  if (pairs.length) saveCookie(ctx, pairs.join('; '));
  let location = '';
  try { location = resp && resp.headers && resp.headers.get ? (resp.headers.get('location') || '') : ''; } catch (_) {}
  if (location) {
    const abs = /^https?:\/\//i.test(location) ? location : `https://e.dlife.cn${location.startsWith('/') ? '' : '/'}${location}`;
    const resp2 = await ctx.http.get(abs, {
      redirect: 'manual', timeout: 12000, credentials: 'omit',
      headers: { 'User-Agent': UA, Cookie: ctx.storage.get('ct_cookie') || '' },
    });
    const pairs2 = extractSetCookies(resp2).map((c) => String(c).split(';')[0].trim()).filter(Boolean);
    if (pairs2.length) saveCookie(ctx, pairs2.join('; '));
  }
  return ctx.storage.get('ct_cookie') || '';
}

async function fetchJson(ctx, url, cookie) {
  const resp = await ctx.http.get(url, {
    headers: { Cookie: cookie, 'User-Agent': UA, Accept: 'application/json, text/plain, */*', Referer: 'https://e.dlife.cn/' },
    timeout: REQUEST_TIMEOUT, credentials: 'omit',
  });
  if (!resp) throw new Error('请求无响应');
  if (resp.status === 401 || resp.status === 403 || resp.status === 302 || resp.status === 301) throw new Error(`登录状态可能失效（HTTP ${resp.status}）`);
  if (resp.status !== 200) throw new Error(`接口 HTTP ${resp.status}`);
  const pairs = extractSetCookies(resp).map((c) => String(c).split(';')[0].trim()).filter(Boolean);
  if (pairs.length) saveCookie(ctx, pairs.join('; '));
  let json;
  try { json = await resp.json(); } catch (_) { throw new Error('接口返回的不是 JSON，可能跳转到登录页'); }
  if (!json || typeof json !== 'object') throw new Error('接口数据格式异常');
  if (json.result === -1 || json.result === '-1' || json.result === 30015 || json.code === 401 || json.code === '401') throw new Error('接口提示登录失效');
  return json;
}

function parseTelecom(detail, balance, opts) {
  const showUsedFlow = opts.showUsedFlow;
  const filterOrientateFlow = opts.filterOrientateFlow;
  let dTotal = 0, dBalance = 0, dUsed = 0, lTotal = 0, lBalance = 0, lUsed = 0;
  let dvTotal = 0, dvBalance = 0, lvTotal = 0, lvBalance = 0;
  let hasLocalFlow = false, hasLocalVoice = false, unlimited = false;
  for (const data of (Array.isArray(detail.items) ? detail.items : [])) {
    if (data.offerType === 19) continue;
    for (const item of (Array.isArray(data.items) ? data.items : [])) {
      const name = item.ratableResourcename || '';
      if (item.unitTypeId == 3) {
        if (String(item.balanceAmount) === '999999999999') continue;
        const total = Number.parseFloat(item.ratableAmount) || 0;
        const bal = Number.parseFloat(item.balanceAmount) || 0;
        const used = Number.parseFloat(item.usageAmount) || 0;
        if (filterOrientateFlow && isDirectional(name)) { dUsed += used; continue; }
        if (isLocalName(name)) { hasLocalFlow = true; lTotal += total; lBalance += bal; lUsed += used; }
        else { dTotal += total; dBalance += bal; dUsed += used; }
        if (data.offerType == 21 && String(item.ratableAmount) === '0') unlimited = true;
      } else if (item.unitTypeId == 1) {
        const total = Number.parseInt(item.ratableAmount, 10) || 0;
        const bal = Number.parseInt(item.balanceAmount, 10) || 0;
        if (isLocalName(name)) { hasLocalVoice = true; lvTotal += total; lvBalance += bal; }
        else { dvTotal += total; dvBalance += bal; }
      }
    }
  }
  if (detail.voiceAmount != null && detail.voiceBalance != null) { dvTotal = Number(detail.voiceAmount) || dvTotal; dvBalance = Number(detail.voiceBalance) || dvBalance; }
  const mkFlow = (title, amount, unit, pct) => ({ title, number: amount, unit, percent: Math.max(0, Math.min(100, pct)), color: COLORS.flow });
  const df = formatFlow(showUsedFlow || unlimited ? dUsed : dBalance);
  const lf = formatFlow(showUsedFlow || unlimited ? lUsed : lBalance);
  const flowDomestic = mkFlow(showUsedFlow || unlimited ? '国内已用' : '国内流量', df.amount, df.unit, dTotal > 0 ? ((showUsedFlow || unlimited ? dUsed : dBalance) / dTotal) * 100 : 0);
  const flowLocal = hasLocalFlow ? mkFlow(showUsedFlow || unlimited ? '本地已用' : '本地流量', lf.amount, lf.unit, lTotal > 0 ? ((showUsedFlow || unlimited ? lUsed : lBalance) / lTotal) * 100 : 0) : null;
  const voiceDomestic = { title: '国内语音', number: String(dvBalance), unit: '分钟', percent: dvTotal > 0 ? dvBalance / dvTotal * 100 : 100, color: COLORS.voice };
  const voiceLocal = hasLocalVoice ? { title: '本地语音', number: String(lvBalance), unit: '分钟', percent: lvTotal > 0 ? lvBalance / lvTotal * 100 : 100, color: COLORS.voice } : null;
  const candidates = [balance.totalBalanceAvailable, balance.balanceAvailable, balance.availableBalance, balance.totalBalance, balance.balance, balance.acctBalance, balance.realBalance, balance.data && balance.data.totalBalanceAvailable, balance.data && balance.data.balance, balance.result && balance.result.totalBalanceAvailable];
  let availableFen = NaN;
  for (const v of candidates) { if (v === undefined || v === null || v === '') continue; const n = Number(v); if (Number.isFinite(n)) { availableFen = n; break; } }
  const oweCandidates = [balance.oweFee, balance.oweAmount, balance.historyOweFee, balance.balanceDue, balance.dueAmount, balance.arrears, balance.oweBalance, balance.data && balance.data.oweFee, balance.data && balance.data.oweAmount, balance.result && balance.result.oweFee];
  let oweFen = NaN;
  for (const v of oweCandidates) { if (v === undefined || v === null || v === '') continue; const n = Number(v); if (Number.isFinite(n) && n !== 0) { oweFen = Math.abs(n); break; } }
  if ((!Number.isFinite(availableFen) || availableFen === 0) && !Number.isFinite(oweFen)) {
    outer: for (const data of (Array.isArray(detail.items) ? detail.items : [])) for (const item of (Array.isArray(data.items) ? data.items : [])) {
      if (item.unitTypeId == 0) { const b = Number.parseFloat(item.balanceAmount); const u = Number.parseFloat(item.usageAmount); if (Number.isFinite(b) && b !== 0) { availableFen = b; break outer; } if (Number.isFinite(u) && u !== 0) oweFen = Math.abs(u); }
    }
  }
  let fee = { title: '剩余话费', number: '0.00', unit: '元', color: COLORS.fee };
  if (Number.isFinite(availableFen) && availableFen < 0) fee = { title: '当前欠费', number: (Math.abs(availableFen) / 100).toFixed(2), unit: '元', color: COLORS.error };
  else if (Number.isFinite(oweFen) && oweFen > 0) fee = { title: '当前欠费', number: (oweFen / 100).toFixed(2), unit: '元', color: COLORS.error };
  else if (Number.isFinite(availableFen) && availableFen !== 0) fee = { title: '剩余话费', number: (availableFen / 100).toFixed(2), unit: '元', color: COLORS.fee };
  else fee.title = '账户余额';
  return { fee, flowDomestic, flowLocal, voiceDomestic, voiceLocal, hasLocalFlow, hasLocalVoice, updatedAt: Date.now() };
}
async function tryCookie(ctx, cookie, settings) {
  if (!cookie) throw new Error('没有可用 Cookie');
  const detail = await fetchJson(ctx, URLS.detail, cookie);
  const balance = await fetchJson(ctx, URLS.balance, cookie);
  if (!Array.isArray(detail.items)) throw new Error('套餐接口数据结构异常，未更新缓存');
  const ds = parseTelecom(detail, balance, settings);
  setSuccess(ctx, ds);
  return ds;
}
async function loadData(ctx) {
  const envCookie = String(ctx.env.CT_COOKIE || '').trim();
  const loginUrl = String(ctx.env.CT_LOGIN_URL || '').trim() || ctx.storage.get('ct_login_url') || '';
  const settings = { showUsedFlow: ctx.env.CT_SHOW_USED_FLOW === 'true', filterOrientateFlow: ctx.env.CT_FILTER_ORIENTATE_FLOW === 'true' };
  const configured = !!(envCookie || loginUrl || ctx.storage.get('ct_cookie'));
  let cookie = envCookie || ctx.storage.get('ct_cookie') || '';
  const cookieTs = Number(ctx.storage.get('ct_cookie_ts') || 0);
  let lastError = '';

  // 定时任务优先尝试刷新捕获到的 Cookie；固定 CT_COOKIE 由用户自行更新。
  if (!envCookie && loginUrl && (!cookie || !cookieTs || Date.now() - cookieTs > COOKIE_REFRESH_AGE)) {
    try { cookie = await refreshCookie(ctx) || cookie; } catch (e) { lastError = errorText(e); setError(ctx, e); }
  }
  if (cookie) {
    try {
      const ds = await tryCookie(ctx, cookie, settings);
      return { configured, ds, fromCache: false, lastOk: Date.now(), lastError: '' };
    } catch (e) {
      lastError = errorText(e); setError(ctx, e);
    }
  }
  // 登录态失败时只在非固定 Cookie 模式尝试续期并重试一次，避免无意义的密集请求。
  if (!envCookie && loginUrl) {
    try {
      const fresh = await refreshCookie(ctx);
      if (fresh) {
        const ds = await tryCookie(ctx, fresh, settings);
        return { configured, ds, fromCache: false, lastOk: Date.now(), lastError: '' };
      }
    } catch (e) { lastError = errorText(e); setError(ctx, e); }
  }
  const cached = ctx.storage.getJSON('ct_datasource') || null;
  const lastOk = Number(ctx.storage.get('ct_last_ok') || (cached && cached.updatedAt) || 0);
  if (lastError) ctx.storage.set('ct_last_error', lastError);
  return { configured, ds: cached, fromCache: !!cached, lastOk, lastError: lastError || ctx.storage.get('ct_last_error') || '' };
}

function makeCapsule(title, value, unit) {
  return { type: 'stack', direction: 'column', alignItems: 'center', justifyContent: 'center', flex: 1, padding: [8, 8, 8, 8], backgroundColor: COLORS.card, borderRadius: 14, borderWidth: 1, borderColor: COLORS.border, children: [
    { type: 'text', text: title, font: { size: 'caption2', weight: 'medium' }, textColor: COLORS.title, textAlign: 'center', maxLines: 1, minScale: 0.7 },
    { type: 'stack', direction: 'row', alignItems: 'center', justifyContent: 'center', gap: 3, children: [
      { type: 'text', text: String(value ?? '0'), font: { size: 'title2', weight: 'semibold' }, textColor: COLORS.value, textAlign: 'center', maxLines: 1, minScale: 0.65 },
      { type: 'text', text: unit || '', font: { size: 'caption2' }, textColor: COLORS.title, maxLines: 1 },
    ] },
  ] };
}
function headerRow(title, ds, status) {
  const time = ds && ds.updatedAt ? fmtTime(ds.updatedAt) : '--:--';
  const stale = status && status.fromCache;
  return { type: 'stack', direction: 'row', alignItems: 'center', children: [
    { type: 'stack', direction: 'row', alignItems: 'center', gap: 6, children: [
      { type: 'image', src: 'sf-symbol:antenna.radiowaves.left.and.right', color: COLORS.accent, width: 16, height: 16 },
      { type: 'text', text: title, font: { size: 'headline', weight: 'semibold' }, textColor: COLORS.value, maxLines: 1, minScale: 0.75 },
    ] }, { type: 'spacer' },
    { type: 'text', text: `${stale ? '缓存 ' : ''}${time}`, font: { size: 'caption2' }, textColor: stale ? COLORS.error : COLORS.time, maxLines: 1 },
  ] };
}
function statusText(status) {
  if (!status || !status.fromCache) return '数据已更新';
  const age = status.lastOk ? Date.now() - status.lastOk : Infinity;
  if (age > MAX_CACHE_AGE) return `数据已过期 · 上次成功 ${fmtDateTime(status.lastOk)}`;
  return `接口更新失败，显示缓存 · ${fmtDateTime(status.lastOk)}`;
}
function statusNode(status) {
  const stale = !!(status && status.fromCache);
  return { type: 'text', text: statusText(status), font: { size: 'caption2' }, textColor: stale ? COLORS.error : COLORS.time, maxLines: 1, minScale: 0.65 };
}
function buildMainWidget(title, ds, status) {
  const top = [makeCapsule(ds.fee.title, ds.fee.number, ds.fee.unit), makeCapsule(ds.voiceDomestic.title, ds.voiceDomestic.number, ds.voiceDomestic.unit)];
  if (ds.voiceLocal) top.push(makeCapsule(ds.voiceLocal.title, ds.voiceLocal.number, ds.voiceLocal.unit));
  const bottom = [makeCapsule(ds.flowDomestic.title, ds.flowDomestic.number, ds.flowDomestic.unit)];
  if (ds.flowLocal) bottom.push(makeCapsule(ds.flowLocal.title, ds.flowLocal.number, ds.flowLocal.unit));
  return { type: 'widget', backgroundColor: COLORS.bg, padding: [10, 14, 10, 14], gap: 8, refreshAfter: new Date(Date.now() + 15 * 60 * 1000).toISOString(), children: [headerRow(title, ds, status), { type: 'stack', direction: 'row', gap: 9, children: top }, { type: 'stack', direction: 'row', gap: 9, children: bottom }, statusNode(status)] };
}
function buildSmall(title, ds, status) {
  const children = [headerRow(title, ds, status),
    { type: 'stack', direction: 'column', alignItems: 'center', justifyContent: 'center', padding: [8, 12, 8, 12], backgroundColor: COLORS.card, borderRadius: 14, borderWidth: 1, borderColor: COLORS.border, children: [
      { type: 'text', text: ds.fee.title, font: { size: 'caption2', weight: 'medium' }, textColor: COLORS.title },
      { type: 'stack', direction: 'row', alignItems: 'center', gap: 2, children: [ { type: 'text', text: ds.fee.number, font: { size: 'title2', weight: 'bold' }, textColor: COLORS.fee }, { type: 'text', text: ds.fee.unit, font: { size: 'caption2' }, textColor: COLORS.title } ] },
    ] },
    { type: 'stack', direction: 'row', gap: 6, children: [makeCapsule(ds.voiceDomestic.title, ds.voiceDomestic.number, ds.voiceDomestic.unit), makeCapsule(ds.flowDomestic.title, ds.flowDomestic.number, ds.flowDomestic.unit)] },
    statusNode(status),
  ];
  if (ds.hasLocalFlow || ds.hasLocalVoice) {
    const tips = []; if (ds.voiceLocal) tips.push(`本地语音 ${ds.voiceLocal.number}分`); if (ds.flowLocal) tips.push(`本地流量 ${ds.flowLocal.number}${ds.flowLocal.unit}`);
    children.splice(children.length - 1, 0, { type: 'text', text: tips.join(' · '), font: { size: 'caption2' }, textColor: COLORS.time, textAlign: 'center', maxLines: 1, minScale: 0.7 });
  }
  return { type: 'widget', backgroundColor: COLORS.bg, padding: [10, 12, 10, 12], gap: 7, refreshAfter: new Date(Date.now() + 15 * 60 * 1000).toISOString(), children };
}
function buildLockScreen(title, ds, family, status) {
  if (family === 'accessoryCircular' || family === 'accessoryInline') return { type: 'widget', children: [{ type: 'text', text: `${status && status.fromCache ? '~' : ''}¥${ds.fee.number}`, font: { size: 'body', weight: 'semibold' }, textAlign: 'center' }] };
  return { type: 'widget', padding: 8, gap: 3, children: [ { type: 'text', text: title, font: { size: 'caption2', weight: 'semibold' } }, { type: 'text', text: `¥${ds.fee.number} · ${ds.flowDomestic.number}${ds.flowDomestic.unit} · ${ds.voiceDomestic.number}分${status && status.fromCache ? ' · 缓存' : ''}`, font: { size: 'footnote' }, maxLines: 1, minScale: 0.55 } ] };
}
function buildError(title, message, url) {
  const w = { type: 'widget', backgroundColor: COLORS.bg, padding: 14, gap: 9, children: [
    { type: 'text', text: title, font: { size: 'headline', weight: 'bold' }, textColor: COLORS.error, maxLines: 1 },
    { type: 'text', text: message, font: { size: 'caption1' }, textColor: COLORS.title, maxLines: 4 },
    { type: 'text', text: '请检查网络，或在 Safari 登录电信账号后刷新', font: { size: 'caption2' }, textColor: COLORS.time, maxLines: 2 },
  ] };
  if (url) w.url = url;
  return w;
}

async function handleCapture(ctx) {
  const req = ctx.request || {}; const url = req.url || '';
  if (!url.includes('e.dlife.cn') && !url.includes('e.189.cn')) return;
  if (url.includes('loginMiddle')) {
    const loginUrl = (url.match(/(http.+)&sign/) || [])[1] || url;
    if (loginUrl) { ctx.storage.set('ct_login_url', loginUrl); ctx.storage.set('ct_login_ts', String(Date.now())); }
  }
  const cookie = String(getReqCookie(req.headers) || '').trim();
  if (cookie) {
    const before = ctx.storage.get('ct_cookie') || '';
    const merged = saveCookie(ctx, cookie);
    const ts = Number(ctx.storage.get('ct_login_ts') || 0);
    if (merged && merged !== before && ts > 0 && Date.now() - ts < 10 * 60 * 1000) {
      ctx.storage.delete('ct_login_ts');
      ctx.notify({ title: '中国电信', body: '已捕获登录 Cookie；小组件将尝试更新数据' });
    }
  }
}
async function handleWidget(ctx) {
  const title = String(ctx.env.CT_TITLE || '中国电信').trim() || '中国电信';
  const status = await loadData(ctx);
  if (!status.configured) return buildError(title, '尚未检测到登录信息。请在 Safari 打开 e.dlife.cn 登录一次。', URLS.login);
  if (!status.ds) {
    const extra = status.lastError ? `原因：${status.lastError}` : '接口暂时没有返回有效数据';
    return buildError(title, `数据获取失败。${extra}`, URLS.login);
  }
  const family = ctx.widgetFamily || 'systemSmall';
  if (family === 'systemMedium' || family === 'systemLarge' || family === 'systemExtraLarge') return buildMainWidget(title, status.ds, status);
  if (family.startsWith('accessory')) return buildLockScreen(title, status.ds, family, status);
  return buildSmall(title, status.ds, status);
}
export default async function (ctx) {
  if (ctx.request && ctx.request.url) return handleCapture(ctx);
  // schedule 上下文通常没有 widgetFamily；真实结果写入 storage，不再无条件返回 keepalive ok。
  if (!ctx.widgetFamily) {
    const status = await loadData(ctx);
    if (!status.ds || status.fromCache) {
      const msg = status.lastError || '接口未更新，当前仍使用缓存';
      ctx.storage.set('ct_last_error', msg);
      return { type: 'text', text: `keepalive failed: ${msg}` };
    }
    return { type: 'text', text: `keepalive ok: ${fmtDateTime(status.lastOk)}` };
  }
  return handleWidget(ctx);
}
