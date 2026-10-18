/*
 * 中国电信小组件（Egern 版，App RSA 登录）
 * 基于 IBL3ND/module CT_Widget.JS
 *
 * 本版仅优化：
 *   - 同步显示：话费余额、国内流量、本地流量、国内语音、专属语音
 *   - 小组件排版美化（中等 2×2 + 标题栏话费）
 * 登录 / 缓存 / 接口逻辑保持原版不变
 */

const URLS = {
  login: 'https://appgologin.189.cn:9031/login/client/userLoginNormal',
  query: 'https://appfuwu.189.cn:9021/query/qryImportantData',
  flux: 'https://appfuwu.189.cn:9021/query/userFluxPackage',
};

const FLOW_DOM_COLOR = '#0A84FF';
const FLOW_LOC_COLOR = '#64D2FF';
const VOICE_DOM_COLOR = '#34C759';
const VOICE_SPEC_COLOR = '#AF52DE';
const FEE_COLOR = '#FF9500';

const COLORS = {
  bg: { light: '#F7F9FC', dark: '#1C1C1E' },
  card: { light: '#FFFFFF', dark: '#2C2C2E' },
  border: { light: '#E5E5EA', dark: '#3A3A3C' },
  title: { light: '#666666', dark: '#8E8E93' },
  value: { light: '#1C1C1E', dark: '#FFFFFF' },
  time: { light: '#999999', dark: '#666666' },
  error: { light: '#FF3B30', dark: '#FF453A' },
  capsuleBg: { light: '#FFFFFF15', dark: '#FFFFFF10' },
  accent: { light: '#FF6620', dark: '#FF854D' },
};

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

function _safeN(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function transNumber(str, encode = true) {
  return [...String(str || '')]
    .map((c) => String.fromCharCode((c.charCodeAt(0) + (encode ? 2 : -2)) & 0xffff))
    .join('');
}

function getBeijingTimestamp() {
  const bjDate = new Date(Date.now() + 8 * 3600 * 1000);
  const yyyy = String(bjDate.getFullYear());
  const MM = String(bjDate.getMonth() + 1).padStart(2, '0');
  const dd = String(bjDate.getDate()).padStart(2, '0');
  const HH = String(bjDate.getHours()).padStart(2, '0');
  const mm = String(bjDate.getMinutes()).padStart(2, '0');
  const ss = String(bjDate.getSeconds()).padStart(2, '0');
  return `${yyyy}${MM}${dd}${HH}${mm}${ss}`;
}

const RSA_MOD_HEX =
  'c190b4f5e53855833ebf34e97ab3c18d3e87dd5b359b0a45a791a026eced8b8e43351fb74cbf3922a9dc54d368da9864472d7fd934c0971e73dc5bfb0386214204dd7ca85bf2f20e9561bf50b6ba08d3d7b5efab3e642b62bfb85b8a7d9c0938fdf625299c4968666d7d9701f2a3af6ee543223cca6ad3f5ca04ef2562137f83';

function _modPow(base, exp, mod) {
  let result = 1n;
  let b = base % mod;
  let e = exp;
  while (e > 0n) {
    if (e & 1n) result = (result * b) % mod;
    b = (b * b) % mod;
    e >>= 1n;
  }
  return result;
}

function _base64Encode(bytes) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const b2 = i + 2 < bytes.length ? bytes[i + 2] : 0;
    out += chars[b0 >> 2];
    out += chars[((b0 & 3) << 4) | (b1 >> 4)];
    out += i + 1 < bytes.length ? chars[((b1 & 15) << 2) | (b2 >> 6)] : '=';
    out += i + 2 < bytes.length ? chars[b2 & 63] : '=';
  }
  return out;
}

function rsaEncrypt(text) {
  const data = [...String(text)].map((c) => c.charCodeAt(0) & 0xff);
  const k = 128;
  if (data.length > k - 11) throw new Error('RSA 明文过长');
  const psLen = k - data.length - 3;
  const ps = [];
  while (ps.length < psLen) {
    const r = Math.floor(Math.random() * 255) + 1;
    if (r !== 0) ps.push(r);
  }
  const em = [0x00, 0x02, ...ps, 0x00, ...data];
  let hex = '';
  for (const b of em) hex += b.toString(16).padStart(2, '0');
  const m = BigInt('0x' + RSA_MOD_HEX);
  const c = _modPow(BigInt('0x' + hex), 65537n, m);
  let cHex = c.toString(16).padStart(256, '0');
  const out = [];
  for (let i = 0; i < cHex.length; i += 2) out.push(parseInt(cHex.slice(i, i + 2), 16));
  return _base64Encode(out);
}

async function _postJson(ctx, url, bodyObj) {
  let resp;
  try {
    resp = await ctx.http.post(url, {
      headers: { 'Content-Type': 'application/json; charset=UTF-8' },
      body: JSON.stringify(bodyObj),
      timeout: 15000,
    });
  } catch (e) {
    const err = new Error(`network: ${url}`);
    err.transient = true;
    throw err;
  }
  if (!resp || resp.status !== 200) {
    const err = new Error(`HTTP ${resp ? resp.status : 'no-response'}: ${url}`);
    err.transient = true;
    throw err;
  }
  try {
    return await resp.json();
  } catch (e) {
    const err = new Error(`not-json: ${url}`);
    err.transient = true;
    throw err;
  }
}

function _getAccount(ctx) {
  const env = ctx.env || {};
  const phone = String(env.CT_PHONE || '').trim();
  const password = String(env.CT_PASSWORD || env.CT_SERVICE_PASSWORD || '').trim();
  const deviceId = String(env.CT_DEVICE_ID || '').trim();
  return { phone, password, deviceId };
}

async function telecomLogin(ctx, account) {
  const { phone, password, deviceId } = account;
  const uuid = String(Math.floor(Math.random() * 9e15 + 1e15));
  const ts = getBeijingTimestamp();
  const encryptText = `iPhone 14 15.4.0${deviceId || uuid.slice(0, 12)}${phone}${ts}${password}0$$$0.`;
  const encrypted = rsaEncrypt(encryptText);
  const loginBody = {
    content: {
      fieldData: {
        loginType: '4',
        accountType: '',
        isChinatelecom: '',
        systemVersion: '15.4.0',
        deviceUid: uuid.slice(0, 16),
        phoneNum: transNumber(phone),
        authentication: transNumber(password),
        androidId: deviceId ? transNumber(deviceId) : '',
        loginAuthCipherAsymmertric: encrypted,
      },
      attach: 'iPhone',
    },
    headerInfos: {
      code: 'userLoginNormal',
      clientType: '#12.2.0#channel50#iPhone 14 Pro#',
      timestamp: ts,
      shopId: '20002',
      source: '110003',
      sourcePassword: 'Sid98s',
      userLoginName: transNumber(phone),
    },
  };
  const loginData = await _postJson(ctx, URLS.login, loginBody);
  const rd = loginData && loginData.responseData;
  if (!rd || rd.resultCode !== '0000') {
    const err = new Error(
      `登录失败 ${rd ? rd.resultCode : 'no-response'}：${(rd && rd.resultDesc) || '未知错误'}`
    );
    err.resultCode = rd ? rd.resultCode : '';
    err.resultDesc = rd ? rd.resultDesc : '';
    throw err;
  }
  const { token, cityCode, provinceCode } = rd.data.loginSuccessResult || {};
  if (!token) throw new Error('登录成功但未返回 token');
  try {
    ctx.storage.set('ct_app_token', token);
    ctx.storage.set('ct_app_city', String(cityCode || ''));
    ctx.storage.set('ct_app_province', String(provinceCode || ''));
    ctx.storage.set('ct_app_token_ts', String(Date.now()));
  } catch (_) {}
  return { token, cityCode, provinceCode };
}

async function fetchImportantData(ctx, account, token, cityCode, provinceCode) {
  const ts = getBeijingTimestamp();
  const dataBody = {
    content: {
      fieldData: {
        provinceCode,
        cityCode,
        shopId: '20002',
        isChinatelecom: '0',
        account: transNumber(account.phone),
      },
      attach: 'test',
    },
    headerInfos: {
      code: 'qryImportantData',
      clientType: '#12.2.0#channel50#iPhone 14 Pro#',
      timestamp: ts,
      shopId: '20002',
      source: '110003',
      sourcePassword: 'Sid98s',
      userLoginName: transNumber(account.phone),
      token,
    },
  };
  const dataResp = await _postJson(ctx, URLS.query, dataBody);
  if (!dataResp || !dataResp.responseData) {
    const err = new Error(
      `查数失败：${(dataResp && dataResp.headerInfos && dataResp.headerInfos.reason) || 'Token 失效'}`
    );
    err.authFailed = true;
    throw err;
  }
  return dataResp.responseData.data;
}

async function fetchUserFluxPackage(ctx, account, token) {
  const ts = getBeijingTimestamp();
  const body = {
    content: {
      fieldData: {
        queryFlag: '0',
        accessAuth: '1',
        account: transNumber(account.phone),
      },
      attach: 'test',
    },
    headerInfos: {
      code: 'userFluxPackage',
      clientType: '#12.2.0#channel50#iPhone 14 Pro#',
      timestamp: ts,
      shopId: '20002',
      source: '110003',
      sourcePassword: 'Sid98s',
      userLoginName: transNumber(account.phone),
      token,
    },
  };
  try {
    const resp = await _postJson(ctx, URLS.flux, body);
    return (resp && resp.responseData && resp.responseData.data) || null;
  } catch (_) {
    return null;
  }
}

function isLocalName(name = '') {
  return /本地|省内|本市|本省/.test(String(name));
}

// 专属/本地类语音名
function isSpecialVoiceName(name = '') {
  return /专属|专用|定向|本地|省内|本市|本省|区域/.test(String(name));
}

// 通用/国内类语音名
function isGeneralVoiceName(name = '') {
  return /国内|通用|全网|全国/.test(String(name));
}

// 递归收集对象里所有数组项
function _collectArrayItems(root) {
  const out = [];
  const walk = (node, depth) => {
    if (!node || depth > 10) return;
    if (Array.isArray(node)) {
      for (const it of node) {
        if (it && typeof it === 'object') {
          out.push(it);
          walk(it, depth + 1);
        }
      }
      return;
    }
    if (typeof node === 'object') {
      for (const k of Object.keys(node)) walk(node[k], depth + 1);
    }
  };
  walk(root, 0);
  return out;
}

function _itemName(it) {
  return String(
    it.ratableResourcename ||
      it.title ||
      it.name ||
      it.productOffName ||
      it.offerName ||
      it.flowName ||
      it.voiceName ||
      it.pkgName ||
      it.resourceName ||
      ''
  );
}

function _isVoiceItem(it) {
  const name = _itemName(it);
  const unit = String(it.unitTypeId ?? it.unitType ?? it.unit ?? it.unitName ?? '');
  // unitTypeId == 1 → 语音（与 e.dlife package_detail 一致）
  if (unit == 1 || unit === '1') return true;
  if (/分钟/.test(unit) && !/流量/.test(name)) return true;
  if (/语音|通话/.test(name) && !/流量|GB|MB|流量包/.test(name)) return true;
  return false;
}

function _voiceAmounts(it) {
  const u = _safeN(it.usageAmount ?? it.used ?? it.usedAmount);
  const b = _safeN(it.balanceAmount ?? it.balance ?? it.remainAmount);
  let t = _safeN(it.ratableAmount ?? it.total ?? it.totalAmount);
  if (!t) t = u + b;
  if (String(it.balanceAmount) === '999999999999') return null;
  if (!u && !b && !t) return null;
  return { used: u, balance: b, total: t };
}

function _pickFlow(obj) {
  return {
    used: _safeN(obj && obj.used),
    balance: _safeN(obj && obj.balance),
    total: _safeN(obj && (obj.total !== undefined ? obj.total : (_safeN(obj.used) + _safeN(obj.balance)))),
  };
}

function _mkFlowItem(title, used, bal, tot, showUsed, color) {
  const fmtB = formatFlow(bal);
  const fmtU = formatFlow(used);
  const item = {
    title,
    number: showUsed ? fmtU.amount : fmtB.amount,
    unit: showUsed ? fmtU.unit : fmtB.unit,
    percent: +(tot > 0 ? (((showUsed ? used : bal) / tot) * 100).toFixed(1) : '0'),
    color,
  };
  if (showUsed) item.title = title.replace('流量', '已用');
  return item;
}

function _mkVoiceItem(title, used, bal, tot, showUsed, color) {
  return {
    title: showUsed ? title.replace('语音', '已用') : title,
    number: `${showUsed ? used : bal}`,
    unit: '分钟',
    percent: +(tot > 0 ? (((showUsed ? used : bal) / tot) * 100).toFixed(1) : '0'),
    color,
  };
}

/**
 * 解析 qryImportantData：
 * - 话费余额
 * - 国内流量 ≈ commonFlow（通用）
 * - 本地流量 ≈ specialAmount（专用），或明细名含本地
 * - 国内语音：汇总语音；专属语音：明细名含专属/专用
 */
function parseImportantData(apiData, opts) {
  const { showUsedFlow, showUsedVoice, showGeneralFlow, showDirectionalFlow } = opts;

  // —— 话费 ——
  const balance = _safeN(
    apiData &&
      apiData.balanceInfo &&
      apiData.balanceInfo.indexBalanceDataInfo &&
      apiData.balanceInfo.indexBalanceDataInfo.balance
  );
  const feeBalance = balance !== 0 ? balance : _safeN(apiData && apiData.balance);
  const fee = {
    title: feeBalance < 0 ? '当前欠费' : '话费余额',
    number: Math.abs(feeBalance).toFixed(2),
    unit: '元',
    color: feeBalance < 0 ? COLORS.error : FEE_COLOR,
  };

  // —— 流量：通用 / 专用 / 总量 ——
  const common = _pickFlow((apiData && apiData.flowInfo && apiData.flowInfo.commonFlow) || {});
  const special = _pickFlow((apiData && apiData.flowInfo && apiData.flowInfo.specialAmount) || {});
  const total = _pickFlow((apiData && apiData.flowInfo && apiData.flowInfo.totalAmount) || {});

  // 尝试从明细列表拆本地
  let localFromList = { used: 0, balance: 0, total: 0 };
  let hasLocalInList = false;
  const lists = [];
  const fi = apiData && apiData.flowInfo;
  if (fi) {
    for (const k of Object.keys(fi)) {
      const v = fi[k];
      if (Array.isArray(v)) lists.push(...v);
    }
  }
  for (const it of lists) {
    const name = it.title || it.name || it.ratableResourcename || it.flowName || '';
    if (!isLocalName(name)) continue;
    hasLocalInList = true;
    localFromList.used += _safeN(it.used ?? it.usageAmount);
    localFromList.balance += _safeN(it.balance ?? it.balanceAmount);
    localFromList.total += _safeN(it.total ?? it.ratableAmount ?? (_safeN(it.used) + _safeN(it.balance)));
  }

  const hasCommon = common.used || common.balance || common.total;
  const hasSpecial = special.used || special.balance || special.total;

  // 国内流量：优先通用；若关闭通用则用总量
  let domFlow = hasCommon ? common : total;
  if (!showGeneralFlow && hasSpecial) {
    domFlow = {
      used: Math.max(0, total.used - special.used),
      balance: Math.max(0, total.balance - special.balance),
      total: Math.max(0, total.total - special.total),
    };
  }

  // 本地流量：明细本地 > 专用流量
  let locFlow = null;
  if (hasLocalInList) {
    locFlow = localFromList;
  } else if (hasSpecial && showDirectionalFlow !== false) {
    locFlow = special;
  }

  const flowDomestic = _mkFlowItem(
    '国内流量',
    domFlow.used,
    domFlow.balance,
    domFlow.total,
    showUsedFlow,
    FLOW_DOM_COLOR
  );

  let flowLocal = null;
  if (locFlow && (locFlow.used || locFlow.balance || locFlow.total)) {
    flowLocal = _mkFlowItem(
      '本地流量',
      locFlow.used,
      locFlow.balance,
      locFlow.total,
      showUsedFlow,
      FLOW_LOC_COLOR
    );
  }

  // —— 语音：通用 + 专属 ——
  // 1) 汇总（qryImportantData）
  const voiceInfo = (apiData && apiData.voiceInfo && apiData.voiceInfo.voiceDataInfo) || {};
  let vTotal = _safeN(voiceInfo.total !== undefined ? voiceInfo.total : apiData && apiData.totalVoice);
  let vUsed = _safeN(voiceInfo.used !== undefined ? voiceInfo.used : apiData && apiData.usedVoice);
  let vBalance = _safeN(
    voiceInfo.balance !== undefined ? voiceInfo.balance : Math.max(0, vTotal - vUsed)
  );

  let genVoice = { used: 0, balance: 0, total: 0 };
  let specVoice = { used: 0, balance: 0, total: 0 };
  let hasGen = false;
  let hasSpec = false;
  const pkgData = opts.packageData || null;

  // 2) 解析 userFluxPackage：productOFFRatable.ratableResourcePackages
  //    包 title 如「国内」「本地」「专用」；子项 leftHighlight=剩余数字
  const parseHighlightMinutes = (product, packTitle) => {
    const highlight = String(product.leftHighlight ?? product.rightHighlight ?? '').replace(/,/g, '');
    const n = parseFloat(highlight);
    if (!Number.isFinite(n)) return null;
    const unitStr = String(
      product.rightCommon || product.leftTitle || product.title || product.unit || packTitle || ''
    );
    if (/GB|MB|流量/.test(unitStr) && !/分钟/.test(unitStr)) return null;
    if (/分钟|语音|通话/.test(unitStr)) return Math.round(n);
    if (n <= 30000 && /语音|通话|分钟/.test(String(product.title || packTitle || ''))) {
      return Math.round(n);
    }
    // 父包标题含本地/专属且数值像分钟
    if (n <= 30000 && isSpecialVoiceName(packTitle) && !/流量|GB|MB/.test(unitStr)) {
      return Math.round(n);
    }
    return null;
  };

  const packages =
    (pkgData &&
      pkgData.productOFFRatable &&
      pkgData.productOFFRatable.ratableResourcePackages) ||
    (pkgData && pkgData.ratableResourcePackages) ||
    [];

  if (Array.isArray(packages) && packages.length) {
    for (const pack of packages) {
      const packTitle = String(pack.title || pack.name || '');
      const products = pack.productInfos || pack.products || [];
      for (const p of products) {
        const mins = parseHighlightMinutes(p, packTitle);
        if (mins === null) continue;
        const used = _safeN(p.used ?? p.usageAmount ?? p.usedValue);
        const total = _safeN(p.total ?? p.ratableAmount ?? p.totalValue) || used + mins;
        const name = `${packTitle} ${p.title || p.name || ''}`;
        if (isSpecialVoiceName(name) || isSpecialVoiceName(packTitle)) {
          hasSpec = true;
          specVoice.balance += mins;
          specVoice.used += used;
          specVoice.total += total || mins;
        } else if (
          isGeneralVoiceName(name) ||
          isGeneralVoiceName(packTitle) ||
          /语音|通话|分钟/.test(name)
        ) {
          hasGen = true;
          genVoice.balance += mins;
          genVoice.used += used;
          genVoice.total += total || mins;
        }
      }
    }
  }

  // 3) 回退：递归扫 unitTypeId==1
  if (!hasGen && !hasSpec) {
    const allItems = [..._collectArrayItems(apiData), ..._collectArrayItems(pkgData)];
    for (const it of allItems) {
      if (!_isVoiceItem(it)) continue;
      const name = _itemName(it);
      if (/流量|GB|MB/.test(name) && !/语音|通话/.test(name)) continue;
      const amt = _voiceAmounts(it);
      if (!amt) continue;
      if (isSpecialVoiceName(name)) {
        hasSpec = true;
        specVoice.used += amt.used;
        specVoice.balance += amt.balance;
        specVoice.total += amt.total;
      } else {
        hasGen = true;
        genVoice.used += amt.used;
        genVoice.balance += amt.balance;
        genVoice.total += amt.total;
      }
    }
  }

  // 4) 与汇总对齐
  if (hasGen && hasSpec) {
    // ok
  } else if (hasSpec && !hasGen) {
    genVoice = {
      used: Math.max(0, vUsed - specVoice.used),
      balance: Math.max(0, vBalance - specVoice.balance),
      total: Math.max(0, vTotal - specVoice.total),
    };
    hasGen = genVoice.used > 0 || genVoice.balance > 0 || genVoice.total > 0;
  } else if (hasGen && !hasSpec) {
    const diffBal = vBalance - genVoice.balance;
    const diffUsed = vUsed - genVoice.used;
    const diffTot = vTotal - genVoice.total;
    if (diffBal > 30 || diffUsed > 30 || diffTot > 30) {
      hasSpec = true;
      specVoice = {
        used: Math.max(0, diffUsed),
        balance: Math.max(0, diffBal),
        total: Math.max(0, diffTot),
      };
    }
  } else {
    hasGen = true;
    genVoice = { used: vUsed, balance: vBalance, total: vTotal };
  }

  const voiceDomestic = _mkVoiceItem(
    '通用语音',
    genVoice.used,
    genVoice.balance,
    genVoice.total || vTotal,
    showUsedVoice,
    VOICE_DOM_COLOR
  );

  let voiceSpecial = null;
  if (hasSpec && (specVoice.used || specVoice.balance || specVoice.total)) {
    voiceSpecial = _mkVoiceItem(
      '专属语音',
      specVoice.used,
      specVoice.balance,
      specVoice.total,
      showUsedVoice,
      VOICE_SPEC_COLOR
    );
  }

  return {
    fee,
    flowDomestic,
    flowLocal,
    voiceDomestic,
    voiceSpecial,
    // 兼容旧字段
    flow: flowDomestic,
    voice: voiceDomestic,
    hasLocalFlow: !!flowLocal,
    hasSpecialVoice: !!voiceSpecial,
    updatedAt: Date.now(),
  };
}

function _notifyAuthFailedOnce(ctx, account, err) {
  try {
    const marker = `${account.phone.slice(-4)}:${err && err.resultCode ? err.resultCode : (err && err.message) || ''}`;
    if (ctx.storage.get('ct_auth_notified') === marker) return;
    ctx.storage.set('ct_auth_notified', marker);
    ctx.notify({
      title: '中国电信',
      body: `登录失败：${(err && err.message) || '请检查手机号/服务密码/设备ID'}`,
    });
  } catch (_) {}
}

function _clearAuthFlag(ctx) {
  try {
    ctx.storage.delete('ct_auth_notified');
  } catch (_) {}
}

async function loadData(ctx) {
  const settings = {
    showUsedFlow: ctx.env.CT_SHOW_USED_FLOW === 'true',
    showUsedVoice: ctx.env.CT_SHOW_USED_VOICE === 'true',
    showGeneralFlow: ctx.env.CT_SHOW_GENERAL_FLOW !== 'false',
    showDirectionalFlow: ctx.env.CT_SHOW_DIRECTIONAL_FLOW !== 'false',
  };
  const account = _getAccount(ctx);
  const configured = !!(account.phone && account.password);
  if (!configured) {
    return { configured: false, ds: null, fromCache: false, authFailed: false, authError: '' };
  }

  try {
    const rawCache = ctx.storage.getJSON('ct_raw');
    const dsCache = ctx.storage.getJSON('ct_datasource');
    const at = (rawCache && rawCache.at) || (dsCache && dsCache.updatedAt) || 0;
    // 旧缓存没有 packageData 时强制刷新，以便拆出专属语音
    if (at && Date.now() - at < 30 * 60 * 1000 && rawCache && rawCache.apiData && rawCache.packageData) {
      const ds = parseImportantData(rawCache.apiData, {
        ...settings,
        packageData: rawCache.packageData,
      });
      ds.updatedAt = at;
      return { configured, ds, fromCache: false, authFailed: false, authError: '' };
    }
  } catch (_) {}

  let token = '';
  let cityCode = '';
  let provinceCode = '';
  try {
    token = ctx.storage.get('ct_app_token') || '';
    cityCode = ctx.storage.get('ct_app_city') || '';
    provinceCode = ctx.storage.get('ct_app_province') || '';
  } catch (_) {}

  const _tryFetch = async (tok, city, prov) => {
    const apiData = await fetchImportantData(ctx, account, tok, city, prov);
    // 套餐明细：用于拆分专属语音（qryImportantData 往往只有汇总）
    const packageData = await fetchUserFluxPackage(ctx, account, tok);
    const ds = parseImportantData(apiData, { ...settings, packageData });
    try {
      ctx.storage.setJSON('ct_datasource', ds);
      ctx.storage.setJSON('ct_raw', {
        apiData,
        packageData,
        at: ds.updatedAt || Date.now(),
      });
    } catch (_) {}
    _clearAuthFlag(ctx);
    return ds;
  };

  if (token) {
    try {
      const ds = await _tryFetch(token, cityCode, provinceCode);
      return { configured, ds, fromCache: false, authFailed: false, authError: '' };
    } catch (e) {
      if (e && e.transient) {
        return _fromCache(ctx, configured, settings, false, '');
      }
    }
  }

  try {
    const login = await telecomLogin(ctx, account);
    const ds = await _tryFetch(login.token, login.cityCode, login.provinceCode);
    return { configured, ds, fromCache: false, authFailed: false, authError: '' };
  } catch (e) {
    if (e && e.transient) {
      return _fromCache(ctx, configured, settings, false, '');
    }
    _notifyAuthFailedOnce(ctx, account, e);
    return {
      configured,
      ds: null,
      fromCache: false,
      authFailed: true,
      authError: (e && e.message) || '登录失败',
    };
  }
}

function _fromCache(ctx, configured, settings, authFailed, authError) {
  try {
    const raw = ctx.storage.getJSON('ct_raw');
    if (raw && raw.apiData) {
      const ds = parseImportantData(raw.apiData, {
        ...settings,
        packageData: raw.packageData || null,
      });
      ds.updatedAt = raw.at || ds.updatedAt;
      return { configured, ds, fromCache: true, authFailed, authError };
    }
  } catch (_) {}
  try {
    const cached = ctx.storage.getJSON('ct_datasource');
    if (cached) return { configured, ds: cached, fromCache: true, authFailed, authError };
  } catch (_) {}
  return { configured, ds: null, fromCache: false, authFailed, authError };
}

/* ---------- UI ---------- */

function mediumCell(icon, color, data) {
  const numText = `${data.number ?? '0'}${data.unit || ''}`;
  return {
    type: 'stack',
    direction: 'row',
    alignItems: 'center',
    flex: 1,
    gap: 8,
    padding: [8, 10, 8, 10],
    backgroundColor: COLORS.card,
    borderRadius: 12,
    children: [
      {
        type: 'image',
        src: `sf-symbol:${icon}`,
        width: 22,
        height: 22,
        color: color || data.color || FLOW_DOM_COLOR,
      },
      {
        type: 'stack',
        direction: 'column',
        alignItems: 'center',
        gap: 1,
        children: [
          {
            type: 'text',
            text: data.title,
            font: { size: 'caption2', weight: 'medium' },
            textColor: COLORS.title,
            maxLines: 1,
          },
          {
            type: 'text',
            text: numText,
            font: { size: 'body', weight: 'bold' },
            textColor: COLORS.value,
            maxLines: 1,
            minScale: 0.7,
          },
        ],
      },
    ],
  };
}

function headerRow(title, ds, fromCache) {
  const time = ds && ds.updatedAt ? fmtTime(ds.updatedAt) : '--:--';
  const feeText = `¥${ds?.fee?.number ?? '0.00'}`;
  return {
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
        font: { size: 'footnote', weight: 'semibold' },
        textColor: COLORS.value,
        maxLines: 1,
        minScale: 0.8,
      },
      {
        type: 'text',
        text: feeText,
        font: { size: 'footnote', weight: 'bold' },
        color: ds?.fee?.color || FEE_COLOR,
        maxLines: 1,
      },
      { type: 'spacer' },
      {
        type: 'text',
        text: fromCache ? `缓存 ${time}` : `更新 ${time}`,
        font: { size: 'caption2' },
        textColor: COLORS.time,
        maxLines: 1,
      },
    ],
  };
}

function buildMainWidget(title, ds, fromCache) {
  const flowRow = [
    mediumCell('antenna.radiowaves.left.and.right', FLOW_DOM_COLOR, ds.flowDomestic || ds.flow),
  ];
  if (ds.flowLocal) {
    flowRow.push(mediumCell('wifi', FLOW_LOC_COLOR, ds.flowLocal));
  }

  const voiceRow = [
    mediumCell('phone.circle.fill', VOICE_DOM_COLOR, ds.voiceDomestic || ds.voice),
  ];
  if (ds.voiceSpecial) {
    voiceRow.push(mediumCell('phone.fill', VOICE_SPEC_COLOR, ds.voiceSpecial));
  }

  return {
    type: 'widget',
    backgroundColor: COLORS.bg,
    padding: [10, 12, 10, 12],
    gap: 8,
    refreshAfter: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    children: [
      headerRow(title, ds, fromCache),
      { type: 'stack', direction: 'row', gap: 8, children: flowRow },
      { type: 'stack', direction: 'row', gap: 8, children: voiceRow },
    ],
  };
}

function smallRow(color, symbol, glyph, value, unit, label) {
  const iconChild = symbol
    ? {
        type: 'image',
        src: symbol,
        color: '#FFFFFF',
        width: 16,
        height: 16,
      }
    : {
        type: 'text',
        text: glyph,
        font: { size: 'headline', weight: 'bold' },
        textColor: '#FFFFFF',
      };

  return {
    type: 'stack',
    direction: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
    padding: [4, 8, 4, 8],
    backgroundColor: { light: color + '40', dark: color + '33' },
    borderRadius: 14,
    children: [
      {
        type: 'stack',
        direction: 'row',
        alignItems: 'center',
        width: 30,
        height: 30,
        borderRadius: 15,
        backgroundColor: { light: color, dark: color + '60' },
        children: [iconChild],
      },
      {
        type: 'stack',
        direction: 'column',
        flex: 1,
        children: [
          {
            type: 'stack',
            direction: 'row',
            alignItems: 'center',
            gap: 3,
            children: [
              {
                type: 'text',
                text: String(value),
                font: { size: 'title3', weight: 'bold' },
                textColor: color,
                maxLines: 1,
                minScale: 0.5,
              },
              {
                type: 'text',
                text: String(unit),
                font: { size: 'caption1', weight: 'semibold' },
                textColor: color,
                maxLines: 1,
              },
              { type: 'spacer' },
            ],
          },
          {
            type: 'text',
            text: String(label),
            font: { size: 'caption2', weight: 'medium' },
            textColor: color + 'B3',
            maxLines: 1,
            minScale: 0.7,
          },
        ],
      },
    ],
  };
}

function buildSmall(title, ds, fromCache) {
  const children = [
    smallRow(
      '#E8651F',
      null,
      '¥',
      ds.fee.number,
      ds.fee.unit,
      ds.fee.title
    ),
    smallRow(
      '#4DA6F0',
      'sf-symbol:antenna.radiowaves.left.and.right',
      '',
      (ds.flowDomestic || ds.flow).number,
      (ds.flowDomestic || ds.flow).unit,
      (ds.flowDomestic || ds.flow).title
    ),
    smallRow(
      '#55C759',
      'sf-symbol:phone.and.waveform.fill',
      '',
      (ds.voiceDomestic || ds.voice).number,
      (ds.voiceDomestic || ds.voice).unit,
      (ds.voiceDomestic || ds.voice).title
    ),
  ];

  if (ds.flowLocal || ds.voiceSpecial) {
    const tips = [];
    if (ds.flowLocal) tips.push(`本地流量 ${ds.flowLocal.number}${ds.flowLocal.unit}`);
    if (ds.voiceSpecial) tips.push(`专属语音 ${ds.voiceSpecial.number}分`);
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
    padding: [10, 10, 10, 10],
    gap: 6,
    refreshAfter: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    children,
  };
}

function buildLockScreen(title, ds, family) {
  const SUB = { light: '#FFFFFFB3', dark: '#FFFFFFB3' };
  const flow = ds.flowDomestic || ds.flow;
  const voice = ds.voiceDomestic || ds.voice;

  if (family === 'accessoryInline') {
    return {
      type: 'widget',
      children: [
        {
          type: 'text',
          text: `${title} ${ds.fee.number}${ds.fee.unit} · ${flow.number}${flow.unit}`,
          font: { size: 'caption1', weight: 'medium' },
          maxLines: 1,
          minScale: 0.5,
        },
      ],
    };
  }

  if (family === 'accessoryCircular') {
    return {
      type: 'widget',
      padding: 2,
      children: [
        { type: 'spacer' },
        {
          type: 'text',
          text: `${flow.number}`,
          font: { size: 'headline', weight: 'bold' },
          textAlign: 'center',
          maxLines: 1,
          minScale: 0.5,
        },
        {
          type: 'text',
          text: flow.unit,
          font: { size: 'caption2' },
          textColor: SUB,
          textAlign: 'center',
          maxLines: 1,
        },
        { type: 'spacer' },
      ],
    };
  }

  const line = (label, value, unit) => ({
    type: 'stack',
    direction: 'row',
    alignItems: 'center',
    gap: 4,
    children: [
      {
        type: 'text',
        text: label,
        font: { size: 'caption2', weight: 'medium' },
        textColor: SUB,
        maxLines: 1,
      },
      { type: 'spacer' },
      {
        type: 'text',
        text: String(value),
        font: { size: 'caption1', weight: 'bold' },
        maxLines: 1,
        minScale: 0.6,
      },
      {
        type: 'text',
        text: String(unit),
        font: { size: 'caption2' },
        textColor: SUB,
        maxLines: 1,
      },
    ],
  });

  return {
    type: 'widget',
    padding: 2,
    gap: 2,
    children: [
      line('话费', ds.fee.number, ds.fee.unit),
      line('流量', flow.number, flow.unit),
      line('语音', voice.number, voice.unit),
    ],
  };
}

function buildError(title, message, url) {
  const w = {
    type: 'widget',
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
        backgroundColor: COLORS.capsuleBg,
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
            text: '请在模块设置里检查账号',
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

async function handleWidget(ctx) {
  const safeCtx = ctx || {};
  const env = safeCtx.env || {};
  const title = (env.CT_TITLE || '中国电信').trim() || '中国电信';

  let result;
  try {
    result = await loadData(safeCtx);
  } catch (e) {
    return buildError(title, '数据获取失败', '');
  }

  const { configured, ds, fromCache, authFailed, authError } = result;

  if (!configured) {
    return buildError(title, '未配置：请在模块设置里填手机号和服务密码', '');
  }
  if (authFailed || !ds) {
    return buildError(title, authError || '登录失败，请检查手机号/服务密码/设备ID', '');
  }

  const family = safeCtx.widgetFamily || '';
  if (family === 'systemSmall') return buildSmall(title, ds, fromCache);
  if (family.startsWith('accessory')) return buildLockScreen(title, ds, family);
  return buildMainWidget(title, ds, fromCache);
}

export default async function (ctx) {
  const safeCtx = ctx || {};
  if (safeCtx.request && safeCtx.request.url) {
    return { type: 'text', text: 'app login mode, no capture' };
  }
  return handleWidget(safeCtx);
}
