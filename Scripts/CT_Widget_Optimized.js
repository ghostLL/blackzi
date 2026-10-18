/*
 * 中国电信 Egern 中号小组件 - 美化版
 * 功能：话费余额 + 本地/全国通话 + 本地/全国流量
 *
 * 保留原版 App RSA 登录、Token 缓存、30 分钟数据缓存和失败时回退缓存。
 * 重要：电信 qryImportantData 的部分账号只返回汇总语音/流量。
 * 本脚本仅在接口返回可识别的资源明细时拆分本地/全国；无法判定的显示“--”，
 * 不会把全国汇总伪装成本地余量，也不会重复累计资源。
 *
 * 环境变量：
 * CT_PHONE               手机号（必填）
 * CT_PASSWORD            6 位服务密码（必填；或 CT_SERVICE_PASSWORD）
 * CT_SERVICE_PASSWORD    服务密码别名
 * CT_DEVICE_ID           可选设备 ID
 * CT_TITLE               标题，默认中国电信
 */

const URLS = {
  login: 'https://appgologin.189.cn:9031/login/client/userLoginNormal',
  query: 'https://appfuwu.189.cn:9021/query/qryImportantData',
};

const C = {
  light: {
    bg: '#FFFFFF', border: '#E5E5EA', title: '#737373',
    value: '#202124', muted: '#8E8E93', accent: '#F36B2B',
    feeBg: '#FFF0E6', fee: '#B84B16',
    localVoiceBg: '#EAF2FF', localVoice: '#2563C9',
    nationalVoiceBg: '#E7F7EC', nationalVoice: '#168047',
    localFlowBg: '#FFF3DD', localFlow: '#A85D08',
    nationalFlowBg: '#F3E9FF', nationalFlow: '#7938B5',
    error: '#D92D20',
  },
  dark: {
    bg: '#1C1C1E', border: '#39393D', title: '#A1A1AA',
    value: '#F5F5F7', muted: '#8E8E93', accent: '#FF854D',
    feeBg: '#3D2921', fee: '#FFAD82',
    localVoiceBg: '#202F46', localVoice: '#91BFFF',
    nationalVoiceBg: '#1F382B', nationalVoice: '#8AE0AE',
    localFlowBg: '#3B3020', localFlow: '#FFD08A',
    nationalFlowBg: '#332641', nationalFlow: '#D8B5FF',
    error: '#FF6961',
  },
};

function n(v) {
  if (v === null || v === undefined || v === '') return null;
  const x = Number(String(v).replace(/,/g, '').trim());
  return Number.isFinite(x) ? x : null;
}
function str(v, fallback = '') {
  return v === null || v === undefined ? fallback : String(v);
}
function transNumber(value, encode = true) {
  return [...String(value || '')]
    .map(ch => String.fromCharCode((ch.charCodeAt(0) + (encode ? 2 : -2)) & 0xffff))
    .join('');
}
function getBeijingTimestamp() {
  const d = new Date(Date.now() + 8 * 3600 * 1000);
  return `${d.getUTCFullYear()}${String(d.getUTCMonth()+1).padStart(2,'0')}${String(d.getUTCDate()).padStart(2,'0')}${String(d.getUTCHours()).padStart(2,'0')}${String(d.getUTCMinutes()).padStart(2,'0')}${String(d.getUTCSeconds()).padStart(2,'0')}`;
}
const RSA_MOD_HEX = 'c190b4f5e53855833ebf34e97ab3c18d3e87dd5b359b0a45a791a026eced8b8e43351fb74cbf3922a9dc54d368da9864472d7fd934c0971e73dc5bfb0386214204dd7ca85bf2f20e9561bf50b6ba08d3d7b5efab3e642b62bfb85b8a7d9c0938fdf625299c4968666d7d9701f2a3af6ee543223cca6ad3f5ca04ef2562137f83';

function modPow(base, exp, mod) {
  let result = 1n, b = base % mod, e = exp;
  while (e > 0n) {
    if (e & 1n) result = (result * b) % mod;
    b = (b * b) % mod;
    e >>= 1n;
  }
  return result;
}
function base64Encode(bytes) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let out = '';
  for (let i=0; i<bytes.length; i+=3) {
    const a=bytes[i], b=i+1<bytes.length?bytes[i+1]:0, c=i+2<bytes.length?bytes[i+2]:0;
    out += chars[a>>2] + chars[((a&3)<<4)|(b>>4)];
    out += i+1<bytes.length ? chars[((b&15)<<2)|(c>>6)] : '=';
    out += i+2<bytes.length ? chars[c&63] : '=';
  }
  return out;
}
function rsaEncrypt(value) {
  const data = [...String(value)].map(ch => ch.charCodeAt(0) & 0xff);
  const k = 128;
  if (data.length > k - 11) throw new Error('RSA 明文过长');
  const ps = [];
  while (ps.length < k-data.length-3) {
    const r = Math.floor(Math.random()*255)+1;
    if (r !== 0) ps.push(r);
  }
  const em = [0,2,...ps,0,...data];
  const hex = em.map(b=>b.toString(16).padStart(2,'0')).join('');
  const cipher = modPow(BigInt('0x'+hex),65537n,BigInt('0x'+RSA_MOD_HEX));
  const outHex = cipher.toString(16).padStart(256,'0');
  const bytes = [];
  for (let i=0;i<outHex.length;i+=2) bytes.push(parseInt(outHex.slice(i,i+2),16));
  return base64Encode(bytes);
}
async function postJSON(ctx, url, body) {
  let resp;
  try {
    resp = await ctx.http.post(url, {
      headers: {'Content-Type':'application/json; charset=UTF-8'},
      body: JSON.stringify(body),
      timeout: 15000,
    });
  } catch (_) {
    const e = new Error('网络请求失败'); e.transient = true; throw e;
  }
  if (!resp || resp.status !== 200) {
    const e = new Error(`HTTP ${resp ? resp.status : '无响应'}`); e.transient = true; throw e;
  }
  try { return await resp.json(); }
  catch (_) { const e = new Error('接口返回非 JSON'); e.transient = true; throw e; }
}
function getAccount(ctx) {
  const env = ctx.env || {};
  return {
    phone: str(env.CT_PHONE).trim(),
    password: str(env.CT_PASSWORD || env.CT_SERVICE_PASSWORD).trim(),
    deviceId: str(env.CT_DEVICE_ID).trim(),
  };
}
async function telecomLogin(ctx, account) {
  const {phone,password,deviceId} = account;
  const uuid = String(Math.floor(Math.random()*9e15+1e15));
  const ts = getBeijingTimestamp();
  const encryptText = `iPhone 14 15.4.0${deviceId || uuid.slice(0,12)}${phone}${ts}${password}0$$$0.`;
  const encrypted = rsaEncrypt(encryptText);
  const body = {
    content: {fieldData: {
      loginType:'4', accountType:'', isChinatelecom:'', systemVersion:'15.4.0',
      deviceUid:uuid.slice(0,16), phoneNum:transNumber(phone),
      authentication:transNumber(password), androidId:deviceId?transNumber(deviceId):'',
      loginAuthCipherAsymmertric:encrypted,
    }, attach:'iPhone'},
    headerInfos: {
      code:'userLoginNormal', clientType:'#12.2.0#channel50#iPhone 14 Pro#',
      timestamp:ts, shopId:'20002', source:'110003', sourcePassword:'Sid98s',
      userLoginName:transNumber(phone),
    },
  };
  const data = await postJSON(ctx, URLS.login, body);
  const rd = data && data.responseData;
  if (!rd || rd.resultCode !== '0000') throw new Error(`登录失败：${(rd&&rd.resultDesc)|| (rd&&rd.resultCode)||'未知错误'}`);
  const result = (rd.data && rd.data.loginSuccessResult) || {};
  if (!result.token) throw new Error('登录成功但未返回 Token');
  try {
    ctx.storage.set('ct_app_token',result.token);
    ctx.storage.set('ct_app_city',String(result.cityCode||''));
    ctx.storage.set('ct_app_province',String(result.provinceCode||''));
    ctx.storage.set('ct_app_token_ts',String(Date.now()));
  } catch (_) {}
  return {token:result.token,cityCode:result.cityCode,provinceCode:result.provinceCode};
}
async function fetchImportantData(ctx, account, token, cityCode, provinceCode) {
  const ts = getBeijingTimestamp();
  const body = {
    content: {fieldData: {
      provinceCode, cityCode, shopId:'20002', isChinatelecom:'0',
      account:transNumber(account.phone),
    }, attach:'test'},
    headerInfos: {
      code:'qryImportantData', clientType:'#12.2.0#channel50#iPhone 14 Pro#',
      timestamp:ts, shopId:'20002', source:'110003', sourcePassword:'Sid98s',
      userLoginName:transNumber(account.phone), token,
    },
  };
  const response = await postJSON(ctx,URLS.query,body);
  if (!response || !response.responseData) {
    const e = new Error(`查询失败：${(response&&response.headerInfos&&response.headerInfos.reason)||'Token 可能失效'}`);
    e.authFailed = true; throw e;
  }
  return response.responseData.data || {};
}
function formatFlow(raw) {
  if (raw === null || raw === undefined || !Number.isFinite(Number(raw))) return {number:'--',unit:'GB'};
  // 电信 qryImportantData 的流量数值在原版中按 KB 处理
  const mb = Number(raw) / 1024;
  return mb < 1024
    ? {number:mb.toFixed(0),unit:'MB'}
    : {number:(mb/1024).toFixed(2),unit:'GB'};
}
function balanceFromObject(obj) {
  if (!obj || typeof obj !== 'object') return null;
  for (const key of ['balance','remain','remaining','remainAmount','balanceAmount','surplus','leftAmount']) {
    const val = n(obj[key]);
    if (val !== null) return val;
  }
  if (obj.total !== undefined && obj.used !== undefined) {
    const total=n(obj.total), used=n(obj.used);
    if (total!==null && used!==null) return Math.max(0,total-used);
  }
  return null;
}
function resourceName(obj) {
  return str(obj && (obj.ratableResourcename || obj.resourceName || obj.resName ||
    obj.name || obj.resource_name || obj.productName || obj.offerName || obj.itemName));
}
function category(name) {
  const s = String(name||'').replace(/\s+/g,'');
  if (/定向|专属|专用|视频流量|免流/.test(s)) return 'other';
  const local = /本地|省内|市内|区内/.test(s);
  const national = /全国|国内/.test(s);
  if (local && !national) return 'local';
  if (national && !local) return 'national';
  return 'unknown';
}
function isVoice(name,obj) {
  const s = (String(name||'')+' '+JSON.stringify(obj||{})).toLowerCase();
  return /语音|通话|分钟|voice/.test(s) || /unitTypeId["']?\s*:\s*["']?(2|3)\b/.test(s);
}
function isFlow(name,obj) {
  const s = (String(name||'')+' '+JSON.stringify(obj||{})).toLowerCase();
  return /流量|flux|traffic|gprs|mb|gb/.test(s);
}
function collectResourceRows(root) {
  const rows=[], seen=new Set();
  function walk(node,depth) {
    if (!node || depth>8 || typeof node!=='object') return;
    if (Array.isArray(node)) { for (const item of node) walk(item,depth+1); return; }
    const name=resourceName(node);
    const bal=balanceFromObject(node);
    if (name && bal!==null && (isVoice(name,node)||isFlow(name,node))) {
      const id = `${name}|${bal}|${str(node.unitTypeId)}|${str(node.ratableResourceId)}`;
      if (!seen.has(id)) {seen.add(id);rows.push({name,balance:bal,voice:isVoice(name,node),flow:isFlow(name,node),unitTypeId:str(node.unitTypeId)});}
    }
    for (const [key,value] of Object.entries(node)) {
      if (value && typeof value==='object') walk(value,depth+1);
    }
  }
  walk(root,0);
  return rows;
}
function parseData(api) {
  const balance = n(api && api.balanceInfo && api.balanceInfo.indexBalanceDataInfo && api.balanceInfo.indexBalanceDataInfo.balance);
  const feeN = balance !== null && balance !== 0 ? balance : n(api && api.balance);
  const fee = {title:'话费余额',number:feeN===null?'--':feeN.toFixed(2),unit:'元'};

  const rows=collectResourceRows(api);
  const sum=(kind,loc)=> {
    const matches=rows.filter(r=>r[kind] && category(r.name)===loc);
    if (!matches.length) return null;
    // 仅将不同资源名的余额相加；接口重复记录已去重
    return matches.reduce((acc,r)=>acc+r.balance,0);
  };
  const lv=sum('voice','local'), nv=sum('voice','national');
  const lf=sum('flow','local'), nf=sum('flow','national');

  // 只有明确名称的本地/全国资源才显示独立值；不从总量反推。
  const localVoice={title:'本地通话',number:lv===null?'--':String(Math.round(lv)),unit:'分钟'};
  const nationalVoice={title:'全国通话',number:nv===null?'--':String(Math.round(nv)),unit:'分钟'};
  const localFlow=lf===null?{title:'本地流量',number:'--',unit:'GB'}:{title:'本地流量',...formatFlow(lf)};
  const nationalFlow=nf===null?{title:'全国流量',number:'--',unit:'GB'}:{title:'全国流量',...formatFlow(nf)};

  // 原版汇总字段保留，供小组件兼容和锁屏组件使用
  const flowInfo=(api&&api.flowInfo&&api.flowInfo.commonFlow)||{};
  const total=(api&&api.flowInfo&&api.flowInfo.totalAmount)||{};
  const flowRaw=n(flowInfo.balance) ?? n(total.balance);
  const voiceInfo=(api&&api.voiceInfo&&api.voiceInfo.voiceDataInfo)||{};
  const voiceRaw=n(voiceInfo.balance) ?? ((n(voiceInfo.total)!==null&&n(voiceInfo.used)!==null)?Math.max(0,n(voiceInfo.total)-n(voiceInfo.used)):null);
  const flow=flowRaw===null?{title:'剩余流量',number:'--',unit:'GB'}:{title:'剩余流量',...formatFlow(flowRaw)};
  const voice={title:'剩余语音',number:voiceRaw===null?'--':String(Math.round(voiceRaw)),unit:'分钟'};
  return {fee,localVoice,nationalVoice,localFlow,nationalFlow,flow,voice,updatedAt:Date.now()};
}
async function loadData(ctx) {
  const account=getAccount(ctx);
  const configured=!!(account.phone&&account.password);
  if (!configured) return {configured,ds:null,fromCache:false,error:'请在模块设置中填写手机号和服务密码'};
  try {
    const raw=ctx.storage.getJSON('ct_raw');
    const dsCache=ctx.storage.getJSON('ct_datasource');
    const at=(raw&&raw.at)||(dsCache&&dsCache.updatedAt)||0;
    if (at && Date.now()-at<30*60*1000) {
      if (raw&&raw.apiData) {
        const ds=parseData(raw.apiData); ds.updatedAt=at;
        return {configured,ds,fromCache:true};
      }
      if (dsCache) return {configured,ds:dsCache,fromCache:true};
    }
  } catch (_) {}
  let token='',city='',province='';
  try {
    token=ctx.storage.get('ct_app_token')||'';
    city=ctx.storage.get('ct_app_city')||'';
    province=ctx.storage.get('ct_app_province')||'';
  } catch (_) {}
  const fetchWith=async (tok,c,p)=>{
    const api=await fetchImportantData(ctx,account,tok,c,p);
    const ds=parseData(api);
    try {ctx.storage.setJSON('ct_datasource',ds);ctx.storage.setJSON('ct_raw',{apiData:api,at:ds.updatedAt});} catch (_) {}
    return ds;
  };
  if (token) {
    try {return {configured,ds:await fetchWith(token,city,province),fromCache:false};}
    catch(e) {if (e&&e.transient) return cacheFallback(ctx,configured); }
  }
  try {
    const login=await telecomLogin(ctx,account);
    return {configured,ds:await fetchWith(login.token,login.cityCode,login.provinceCode),fromCache:false};
  } catch(e) {
    if (e&&e.transient) return cacheFallback(ctx,configured);
    return {configured,ds:null,fromCache:false,error:(e&&e.message)||'登录失败，请检查账号'};
  }
}
function cacheFallback(ctx,configured) {
  try {
    const raw=ctx.storage.getJSON('ct_raw');
    if (raw&&raw.apiData) {
      const ds=parseData(raw.apiData);ds.updatedAt=raw.at||ds.updatedAt;
      return {configured,ds,fromCache:true};
    }
    const ds=ctx.storage.getJSON('ct_datasource');
    if (ds) return {configured,ds,fromCache:true};
  } catch (_) {}
  return {configured,ds:null,fromCache:false,error:'网络请求失败，且没有可用缓存'};
}
function timeText(ts) {
  if (!ts) return '--:--';
  const d=new Date(ts);
  return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
}
function makeText(text,size,color,weight='regular') {
  return {type:'text',text:String(text),font:{size,weight},textColor:color,maxLines:1,minScale:0.55};
}
function card(label,value,unit,bg,color) {
  return {
    type:'stack',direction:'column',alignItems:'start',flex:1,
    padding:[7,8,7,8],backgroundColor:bg,borderRadius:11,gap:3,
    children:[
      makeText(label,'caption2',color,'medium'),
      {type:'stack',direction:'row',alignItems:'center',gap:3,children:[
        makeText(value,'title3',color,'bold'),
        makeText(unit,'caption2',color,'regular'),
      ]},
    ],
  };
}
function buildMedium(title,ds,fromCache) {
  const c=C;
  const fee=ds.fee||{number:'--',unit:'元'};
  const lv=ds.localVoice||{number:'--',unit:'分钟'};
  const nv=ds.nationalVoice||{number:'--',unit:'分钟'};
  const lf=ds.localFlow||{number:'--',unit:'GB'};
  const nf=ds.nationalFlow||{number:'--',unit:'GB'};

  const txt=(text,size,color,weight='regular') => ({
    type:'text',text:String(text),font:{size,weight},textColor:color,
    maxLines:1,minScale:0.6
  });
  const card=(label,value,unit,bg,color,symbol)=>({
    type:'stack',direction:'column',alignItems:'start',
    width:'100%',padding:[6,9,6,9],backgroundColor:bg,borderRadius:11,gap:3,
    children:[
      {type:'stack',direction:'row',alignItems:'center',gap:5,children:[
        {type:'image',src:`sf-symbol:${symbol}`,color,width:12,height:12},
        txt(label,'caption2',color,'medium')
      ]},
      {type:'stack',direction:'row',alignItems:'center',gap:4,children:[
        txt(value,'title3',color,'bold'),txt(unit,'caption2',color)
      ]}
    ]
  });

  return {
    type:'widget',
    padding:[10,12,10,12],
    gap:7,
    refreshAfter:new Date(Date.now()+60*60*1000).toISOString(),
    children:[
      // Header
      {type:'stack',direction:'row',alignItems:'center',gap:6,width:'100%',children:[
        {type:'image',src:'sf-symbol:antenna.radiowaves.left.and.right',
         color:{light:c.light.accent,dark:c.dark.accent},width:17,height:17},
        txt(title,'headline',{light:c.light.value,dark:c.dark.value},'semibold'),
        {type:'spacer'},
        txt(`${fromCache?'缓存':'更新'} ${timeText(ds.updatedAt)}`,'caption2',
          {light:c.light.muted,dark:c.dark.muted})
      ]},

      // Full-width balance banner; explicit width prevents intrinsic-size shrink.
      {type:'stack',direction:'row',alignItems:'center',gap:10,
       width:'100%',padding:[8,12,8,12],
       backgroundColor:{light:c.light.feeBg,dark:c.dark.feeBg},borderRadius:11,
       children:[
         {type:'image',src:'sf-symbol:creditcard.fill',
          color:{light:c.light.fee,dark:c.dark.fee},width:22,height:22},
         {type:'stack',direction:'column',alignItems:'start',gap:1,flex:1,children:[
           txt('话费余额','caption2',{light:c.light.fee,dark:c.dark.fee},'medium'),
           txt(fee.number==='--'?'--':`¥ ${fee.number}`,'title2',
             {light:c.light.fee,dark:c.dark.fee},'bold')
         ]},
         {type:'image',src:'sf-symbol:wallet.bifold',
          color:{light:c.light.fee,dark:c.dark.fee},width:19,height:19}
       ]},

      // Fixed compact two-column rows avoid card overlap in medium widget.
      {type:'stack',direction:'row',alignItems:'center',gap:7,width:'100%',children:[
        {type:'stack',direction:'column',alignItems:'start',flex:1,width:'50%',
         children:[card('本地通话',lv.number,'分钟',
           {light:c.light.localVoiceBg,dark:c.dark.localVoiceBg},
           {light:c.light.localVoice,dark:c.dark.localVoice},'phone')]},
        {type:'stack',direction:'column',alignItems:'start',flex:1,width:'50%',
         children:[card('全国通话',nv.number,'分钟',
           {light:c.light.nationalVoiceBg,dark:c.dark.nationalVoiceBg},
           {light:c.light.nationalVoice,dark:c.dark.nationalVoice},'phone.fill')]}
      ]},

      {type:'stack',direction:'row',alignItems:'center',gap:7,width:'100%',children:[
        {type:'stack',direction:'column',alignItems:'start',flex:1,width:'50%',
         children:[card('本地流量',lf.number,lf.unit||'GB',
           {light:c.light.localFlowBg,dark:c.dark.localFlowBg},
           {light:c.light.localFlow,dark:c.dark.localFlow},'antenna.radiowaves.left.and.right')]},
        {type:'stack',direction:'column',alignItems:'start',flex:1,width:'50%',
         children:[card('全国流量',nf.number,nf.unit||'GB',
           {light:c.light.nationalFlowBg,dark:c.dark.nationalFlowBg},
           {light:c.light.nationalFlow,dark:c.dark.nationalFlow},'globe')] }
      ]}
    ]
  };
}
function buildError(title,message) {
  return {type:'widget',padding:14,gap:8,children:[
    {type:'stack',direction:'row',alignItems:'center',gap:6,children:[
      {type:'image',src:'sf-symbol:exclamationmark.triangle.fill',color:'#FF453A',width:16,height:16},
      {type:'text',text:title,font:{size:'headline',weight:'bold'},maxLines:1},
    ]},
    {type:'text',text:message,font:{size:'caption1'},maxLines:4},
    {type:'text',text:'请检查模块参数、网络连接和电信服务密码。',font:{size:'caption2'},maxLines:2},
  ]};
}
async function handleWidget(ctx) {
  const env=(ctx&&ctx.env)||{};
  const title=str(env.CT_TITLE,'中国电信').trim()||'中国电信';
  let result;
  try {result=await loadData(ctx||{});}
  catch (_) {return buildError(title,'数据获取失败');}
  if (!result.configured) return buildError(title,'未配置手机号或服务密码');
  if (!result.ds) return buildError(title,result.error||'登录或查询失败');
  return buildMedium(title,result.ds,result.fromCache);
}
export default async function(ctx) {
  if (ctx&&ctx.request&&ctx.request.url) return {type:'text',text:'China Telecom widget'};
  return handleWidget(ctx||{});
}
