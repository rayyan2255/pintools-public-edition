const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const TOOL_DEFS = [
  {id:'pinTitles', name:'Pinterest Title Generator', desc:'Create four click-worthy title options from your focus keyword.', category:'Pinterest', icon:'T', tint:'var(--accent-soft)', color:'var(--accent-2)'},
  {id:'ideas', name:'Ideas Generator', desc:'Turn your chosen article title into a numbered list of ideas.', category:'Content', icon:'✦', tint:'var(--green-soft)', color:'var(--green)'},
  {id:'imagePrompt', name:'Image Prompt Generator', desc:'Create a detailed visual prompt for one selected article idea.', category:'Images', icon:'◈', tint:'var(--rose-soft)', color:'var(--rose)'},
  {id:'imageGenerator', name:'Image Generator', desc:'Generate the actual image from your prompt and save it to a project.', category:'Images', icon:'▧', tint:'var(--amber-soft)', color:'var(--amber)'},
  {id:'article', name:'Article Writer', desc:'Write your complete SEO article and receive clean HTML.', category:'Content', icon:'¶', tint:'var(--accent-soft)', color:'var(--accent-2)'},
  {id:'featured', name:'Featured Image Generator', desc:'Create an article-specific featured image, not just an image prompt.', category:'Images', icon:'▣', tint:'var(--rose-soft)', color:'var(--rose)'},
  {id:'featuredPrompt', name:'Featured Image Prompt Generator', desc:'Create a detailed featured-image prompt without generating or paying for an image.', category:'Images', icon:'✧', tint:'var(--rose-soft)', color:'var(--rose)'},
  {id:'pinDescriptions', name:'Pin Description Generator', desc:'Write four Pinterest descriptions for your selected pin titles.', category:'Pinterest', icon:'≋', tint:'var(--green-soft)', color:'var(--green)'},
  {id:'pinterestPin', name:'Pinterest Pin Generator', desc:'Create a clean background and a finished pin with exact typography.', category:'Pinterest', icon:'▤', tint:'var(--amber-soft)', color:'var(--amber)'}
];

let SESSION_ID = (() => {
  try {
    let id = sessionStorage.getItem('pintools_session_id');
    if (!id) {
      id = `pt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`;
      sessionStorage.setItem('pintools_session_id', id);
    }
    return id;
  } catch {
    return `pt_ephemeral_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  }
})();
const TAB_NONCE = `tab_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
let sessionChannel = null;
let tabSessionForked = false;
let isEndingSession = false;
let DEFAULT_PROMPTS = {};
let prompts = {};
let projects = loadJSON('ld_projects', []);
let theme = loadJSON('ld_theme', 'light');
let activeFilter = 'All';
let activeTool = null;
let activeProjectId = null;
let currentOutput = null;
let apiSettings = {text_api_key_configured:false,image_api_key_configured:false};
let workflowProjectId = null;
let workflowStepIndex = 0;
let workflowMode = 'guided';
const imagePromptRuns = new Set();
const automatedWorkflowRuns = new Set();

async function ensureUniqueTabSession() {
  if (!('BroadcastChannel' in window)) return;
  try {
    sessionChannel = new BroadcastChannel('pintools-tab-session-check');
    let collision = false;
    sessionChannel.onmessage = event => {
      const message = event.data || {};
      if (message.type === 'hello' && message.sessionId === SESSION_ID && message.nonce !== TAB_NONCE) {
        sessionChannel.postMessage({type:'collision',sessionId:SESSION_ID,nonce:TAB_NONCE,replyTo:message.nonce});
      }
      if (message.type === 'collision' && message.sessionId === SESSION_ID && message.replyTo === TAB_NONCE) collision = true;
    };
    sessionChannel.postMessage({type:'hello',sessionId:SESSION_ID,nonce:TAB_NONCE});
    await new Promise(resolve => setTimeout(resolve, 220));
    if (collision) {
      const oldId = SESSION_ID;
      const prefix = `pintools:${oldId}:`;
      for (let i=sessionStorage.length-1;i>=0;i--) {
        const key=sessionStorage.key(i);
        if (key && key.startsWith(prefix)) sessionStorage.removeItem(key);
      }
      SESSION_ID = `pt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`;
      sessionStorage.setItem('pintools_session_id', SESSION_ID);
      tabSessionForked = true;
    }
  } catch (error) {
    console.warn('PinTools could not isolate a duplicated browser tab. The browser session remains tab-scoped where supported.', error);
  }
}
function sessionKey(key) { return `pintools:${SESSION_ID}:${key}`; }
function loadJSON(key, fallback) {
  try { const raw = sessionStorage.getItem(sessionKey(key)); return raw ? JSON.parse(raw) : structuredClone(fallback); }
  catch { return structuredClone(fallback); }
}
function saveLocal() {
  try {
    sessionStorage.setItem(sessionKey('ld_projects'), JSON.stringify(projects));
  } catch (error) {
    toast('This tab session is running low on browser storage. Export your project before continuing.');
    console.warn('PinTools session storage could not save the latest project state.', error);
  }
}
function uid(prefix='ld') { return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,8)}`; }
function esc(value='') { return String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function toast(message) {
  const el = $('#toast'); el.textContent = message; el.classList.add('show');
  clearTimeout(toast._timer); toast._timer = setTimeout(() => el.classList.remove('show'), 2600);
}
function setTheme(next) {
  theme = next; document.documentElement.dataset.theme = theme;
  $('#themeToggle').textContent = theme === 'dark' ? '☀' : '☾';
  $('#lightThemeChoice')?.classList.toggle('active', theme === 'light');
  $('#darkThemeChoice')?.classList.toggle('active', theme === 'dark');
  try { sessionStorage.setItem(sessionKey('ld_theme'), JSON.stringify(theme)); } catch {}
}
function switchView(name) {
  $$('.view').forEach(view => view.classList.toggle('active', view.id === `${name}View`));
  $$('.nav-btn').forEach(button => button.classList.toggle('active', button.dataset.view === name));
  if (name === 'projects') renderProjects();
  
  if (name === 'dashboard') renderDashboard();
  if (name === 'settings') loadApiSettings();
  window.scrollTo({top:0, behavior:'smooth'});
}
function getProject(id=activeProjectId) { return projects.find(project => project.id === id) || null; }
function createProject(name) {
  const project = {id:uid('project'), name:name.trim() || 'New content project', createdAt:Date.now(), updatedAt:Date.now(), keyword:'', articleTitle:'', ideaCount:0, ideas:[], imageAssets:[], workflowSkipped:{}, data:{}};
  projects.unshift(project); activeProjectId = project.id; saveLocal(); return project;
}
function updateProject(id, updater) {
  const project = getProject(id); if (!project) return;
  updater(project); project.updatedAt = Date.now(); saveLocal();
}
function askForProjectName(defaultName='New content project') {
  const name = window.prompt('Save this work in a project. Enter a project name:', defaultName);
  if (name === null) return null;
  return createProject(name || defaultName);
}
function ensureProject(defaultName) { return getProject() || askForProjectName(defaultName); }

function openAssetDB() {
  return new Promise((resolve,reject) => {
    const request = indexedDB.open('pintools-session-assets-v1', 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('assets')) {
        const assets = db.createObjectStore('assets', {keyPath:'id'});
        assets.createIndex('sessionId', 'sessionId', {unique:false});
      }
      if (!db.objectStoreNames.contains('sessions')) db.createObjectStore('sessions', {keyPath:'id'});
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
function assetKey(id) { return `${SESSION_ID}:${id}`; }
async function putAsset(id, dataUrl) {
  const db = await openAssetDB();
  return new Promise((resolve,reject) => {
    const tx = db.transaction('assets','readwrite');
    tx.objectStore('assets').put({id:assetKey(id), assetId:id, sessionId:SESSION_ID, dataUrl, updatedAt:Date.now()});
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
    tx.onabort = () => { db.close(); reject(tx.error || new Error('Image storage was interrupted.')); };
  });
}
async function getAsset(id) {
  const db = await openAssetDB();
  return new Promise((resolve,reject) => {
    const request = db.transaction('assets','readonly').objectStore('assets').get(assetKey(id));
    request.onsuccess = () => { db.close(); resolve(request.result?.dataUrl || null); };
    request.onerror = () => { db.close(); reject(request.error); };
  });
}
async function deleteSessionAssets(db, sessionId) {
  return new Promise(resolve => {
    try {
      const tx = db.transaction(['assets','sessions'],'readwrite');
      const index = tx.objectStore('assets').index('sessionId');
      const cursorRequest = index.openCursor(IDBKeyRange.only(sessionId));
      cursorRequest.onsuccess = event => {
        const cursor = event.target.result;
        if (cursor) { cursor.delete(); cursor.continue(); }
      };
      tx.objectStore('sessions').delete(sessionId);
      tx.oncomplete = resolve;
      tx.onerror = resolve;
      tx.onabort = resolve;
    } catch { resolve(); }
  });
}
async function touchSession() {
  try {
    const db = await openAssetDB();
    await new Promise(resolve => {
      const tx = db.transaction('sessions','readwrite');
      tx.objectStore('sessions').put({id:SESSION_ID,lastSeen:Date.now(),closedAt:null});
      tx.oncomplete = resolve; tx.onerror = resolve; tx.onabort = resolve;
    });
    db.close();
  } catch (error) {
    console.warn('PinTools could not update the temporary session marker.', error);
  }
}
async function cleanupExpiredSessions() {
  try {
    const db = await openAssetDB();
    const sessions = await new Promise((resolve,reject) => {
      const request = db.transaction('sessions','readonly').objectStore('sessions').getAll();
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
    const closedCutoff = Date.now() - 2 * 60 * 1000;
    const staleCutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
    for (const session of sessions) {
      if (session.id !== SESSION_ID && ((session.closedAt && session.closedAt < closedCutoff) || session.lastSeen < staleCutoff)) {
        await deleteSessionAssets(db, session.id);
      }
    }
    db.close();
  } catch (error) {
    console.warn('PinTools could not clean expired temporary image sessions.', error);
  }
}
async function markSessionClosing() {
  if (isEndingSession) return;
  try {
    const db = await openAssetDB();
    const tx = db.transaction('sessions','readwrite');
    const store = tx.objectStore('sessions');
    const request = store.get(SESSION_ID);
    request.onsuccess = () => {
      const record = request.result || {id:SESSION_ID,lastSeen:Date.now()};
      record.closedAt = Date.now();
      store.put(record);
    };
    tx.oncomplete = () => db.close();
    tx.onerror = () => db.close();
  } catch {}
}
async function clearAssetDB() {
  try {
    const db = await openAssetDB();
    await deleteSessionAssets(db, SESSION_ID);
    db.close();
  } catch {}
}
async function endSessionAndClear() {
  if (!window.confirm('End this PinTools session? All temporary projects, generated content, images and API keys for this tab will be cleared. Download your work first.')) return;
  isEndingSession = true;
  try {
    projects = [];
    await clearAssetDB();
    const prefix = `pintools:${SESSION_ID}:`;
    for (let i=sessionStorage.length-1;i>=0;i--) {
      const key=sessionStorage.key(i);
      if (key && key.startsWith(prefix)) sessionStorage.removeItem(key);
    }
    sessionStorage.removeItem('pintools_session_id');
  } catch {}
  toast('Session cleared. Starting a fresh workspace…');
  setTimeout(() => window.location.reload(), 250);
}
function providerDefaults(kind, provider) {
  const values = {
    text: {
      openai: {base:'https://api.openai.com/v1', model:'gpt-6-luna'},
      anthropic: {base:'https://api.anthropic.com', model:'claude-sonnet-5'},
      gemini: {base:'https://generativelanguage.googleapis.com/v1beta', model:'gemini-3.6-flash'}
    },
    image: {
      openai: {base:'https://api.openai.com/v1', model:'gpt-image-2.6-flare'},
      gemini: {base:'https://generativelanguage.googleapis.com/v1beta', model:'gemini-3.1-flash-image'}
    }
  };
  return values[kind][provider] || values[kind].openai;
}
function readProviderConfig(kind) {
  const provider = sessionStorage.getItem(sessionKey(`${kind}_provider`)) || (kind==='text'?'openai':'openai');
  const defaults = providerDefaults(kind, provider);
  return {
    provider,
    base: sessionStorage.getItem(sessionKey(`${kind}_base_url`)) || defaults.base,
    model: sessionStorage.getItem(sessionKey(`${kind}_model`)) || defaults.model,
    key: sessionStorage.getItem(sessionKey(`${kind}_api_key`)) || ''
  };
}
function updateConnectionPill() {
  const textReady = !!apiSettings.text_api_key_configured;
  const imageReady = !!apiSettings.image_api_key_configured;
  const pill = $('#connectionPill');
  if (!pill) return;
  pill.classList.toggle('connected', textReady || imageReady);
  pill.querySelector('span').textContent = textReady && imageReady ? 'Text + image ready' : textReady ? 'Text AI ready' : imageReady ? 'Image AI ready' : 'Connect AI';
}
async function refreshApiStatus() {
  const text = readProviderConfig('text');
  const image = readProviderConfig('image');
  apiSettings = {
    text_provider:text.provider, text_base_url:text.base, text_model:text.model,
    text_api_key_configured:!!text.key,
    image_provider:image.provider, image_base_url:image.base, image_model:image.model,
    image_api_key_configured:!!image.key
  };
  updateConnectionPill();
  return apiSettings;
}
function updateProviderDefaults(kind) {
  const providerEl = kind==='text' ? $('#textProvider') : $('#imageProvider');
  const baseEl = kind==='text' ? $('#textBaseUrl') : $('#imageBaseUrl');
  const modelEl = kind==='text' ? $('#textModelInput') : $('#imageModelInput');
  const defaults = providerDefaults(kind, providerEl.value);
  baseEl.value = defaults.base;
  modelEl.value = defaults.model;
  const keyEl = kind==='text' ? $('#textApiKey') : $('#imageApiKey');
  if (keyEl) keyEl.value = '';
  const feedback=kind==='text'?$('#textApiFeedback'):$('#imageApiFeedback');
  if (feedback) { feedback.className='inline-feedback'; feedback.textContent='Provider changed. Enter its matching API key, save the connection, then test it.'; }
}
async function loadApiSettings() {
  const settings = await refreshApiStatus();
  const text = readProviderConfig('text');
  const image = readProviderConfig('image');
  $('#textProvider').value = settings.text_provider || 'openai';
  $('#textBaseUrl').value = settings.text_base_url || providerDefaults('text', $('#textProvider').value).base;
  $('#textModelInput').value = settings.text_model || providerDefaults('text', $('#textProvider').value).model;
  $('#textApiKey').value = text.key;
  $('#textApiKeyHint').textContent = text.key ? 'Text key is stored in this tab session. It is not sent to PinTools servers, but browser scripts and extensions may be able to access it.' : 'No text key configured. Use a restricted key with a spending limit.';
  $('#textConnectionStatus').textContent = settings.text_api_key_configured ? 'Configured' : 'Not connected';
  $('#textConnectionStatus').classList.toggle('connected', !!settings.text_api_key_configured);

  $('#imageProvider').value = settings.image_provider || 'openai';
  $('#imageBaseUrl').value = settings.image_base_url || providerDefaults('image', $('#imageProvider').value).base;
  $('#imageModelInput').value = settings.image_model || providerDefaults('image', $('#imageProvider').value).model;
  $('#imageApiKey').value = image.key;
  $('#imageApiKeyHint').textContent = image.key ? 'Image key is stored in this tab session. It is not sent to PinTools servers, but browser scripts and extensions may be able to access it.' : 'No image key configured. Image generation can incur separate charges.';
  $('#imageConnectionStatus').textContent = settings.image_api_key_configured ? 'Configured' : 'Not connected';
  $('#imageConnectionStatus').classList.toggle('connected', !!settings.image_api_key_configured);
}
async function saveProviderSettings(kind, clearKey=false) {
  const isText = kind === 'text';
  const feedback = isText ? $('#textApiFeedback') : $('#imageApiFeedback');
  feedback.className = 'inline-feedback'; feedback.textContent = 'Saving settings in this tab session…';
  try {
    const provider = (isText ? $('#textProvider') : $('#imageProvider')).value;
    const base = (isText ? $('#textBaseUrl') : $('#imageBaseUrl')).value.trim();
    const model = (isText ? $('#textModelInput') : $('#imageModelInput')).value.trim();
    const input = isText ? $('#textApiKey') : $('#imageApiKey');
    const old = readProviderConfig(kind);
    const enteredKey = input.value.trim();
    if (!clearKey && provider !== old.provider && !enteredKey) {
      throw new Error(`Enter a new API key when switching the ${kind} provider.`);
    }
    if (!clearKey && !enteredKey && !old.key) throw new Error(`Enter your ${kind} API key first.`);
    if (enteredKey && sessionStorage.getItem(sessionKey('api_key_risk_acknowledged')) !== 'yes') {
      const accepted = window.confirm('API KEY SAFETY WARNING: PinTools is a public browser application. Your key is stored in this tab session and may be accessible to scripts or browser extensions. Use a restricted key with a spending limit. Do not use a master key. Continue?');
      if (!accepted) { feedback.className='inline-feedback';feedback.textContent='API key not saved. No API request was sent.';return; }
      sessionStorage.setItem(sessionKey('api_key_risk_acknowledged'), 'yes');
    }
    if (!base.startsWith('https://')) throw new Error('Provider API base URL must use HTTPS.');
    if (!model) throw new Error('Enter a model ID available to your provider account.');
    sessionStorage.setItem(sessionKey(`${kind}_provider`), provider);
    sessionStorage.setItem(sessionKey(`${kind}_base_url`), base.replace(/\/+$/,''));
    sessionStorage.setItem(sessionKey(`${kind}_model`), model);
    if (clearKey) sessionStorage.removeItem(sessionKey(`${kind}_api_key`));
    else if (enteredKey) sessionStorage.setItem(sessionKey(`${kind}_api_key`), enteredKey);
    await refreshApiStatus();
    feedback.className = 'inline-feedback success';
    feedback.textContent = `${isText ? 'Text' : 'Image'} settings saved in this tab session.`;
    await loadApiSettings();
    toast(`${isText ? 'Text' : 'Image'} AI settings saved for this session`);
  } catch (error) {
    feedback.className = 'inline-feedback error';
    feedback.textContent = error.message;
  }
}
function providerErrorMessage(data, response) {
  const error = data?.error;
  if (typeof error === 'string') return error;
  if (error?.message) return error.message;
  if (data?.message) return data.message;
  return `AI provider returned HTTP ${response.status}. Check your API key, model ID, account access and provider status.`;
}
async function postProviderJSON(url, headers, payload, timeoutMs=180000, providerLabel='AI provider') {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method:'POST',
      mode:'cors',
      credentials:'omit',
      cache:'no-store',
      referrerPolicy:'no-referrer',
      headers:{'Content-Type':'application/json', ...headers},
      body:JSON.stringify(payload),
      signal:controller.signal
    });
    const raw = await response.text();
    let data = {};
    try { data = raw ? JSON.parse(raw) : {}; }
    catch { throw new Error(`${providerLabel} returned an unreadable response. Check the selected endpoint and model.`); }
    if (!response.ok) throw new Error(providerErrorMessage(data,response));
    return data;
  } catch (error) {
    if (error.name === 'AbortError') throw new Error(`${providerLabel} request timed out. Try again or use a smaller request.`);
    if (error instanceof TypeError) throw new Error(`The browser could not reach ${providerLabel}. This may be a CORS or direct-browser-access restriction. Check the provider's browser-access policy; PinTools does not use a proxy.`);
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
function extractTextResponse(data, provider) {
  if (provider === 'openai') {
    if (typeof data.output_text === 'string' && data.output_text.trim()) return data.output_text.trim();
    const chunks=[];
    for (const item of data.output || []) {
      if (item.type !== 'message') continue;
      for (const part of item.content || []) if ((part.type==='output_text'||part.type==='text') && part.text) chunks.push(part.text);
    }
    if (chunks.length) return chunks.join('\n').trim();
  }
  if (provider === 'anthropic') {
    const chunks=(data.content||[]).filter(item=>item.type==='text'&&item.text).map(item=>item.text);
    if (chunks.length) return chunks.join('\n').trim();
  }
  if (provider === 'gemini') {
    const chunks=[];
    for (const candidate of data.candidates||[]) {
      for (const part of candidate.content?.parts||[]) if (part.text) chunks.push(part.text);
    }
    if (chunks.length) return chunks.join('\n').trim();
  }
  throw new Error('The selected model returned no readable text. Check the model ID and response permissions.');
}
async function requestText(prompt,maxTokens=9000) {
  const cfg=readProviderConfig('text');
  if(!cfg.key) throw new Error('No Text AI API key is configured. Open Settings and connect OpenAI, Claude or Gemini.');
  if(!cfg.model) throw new Error('Enter a Text AI model ID in Settings.');
  let url,headers,payload;
  if(cfg.provider==='openai') {
    url=cfg.base.replace(/\/+$/,'')+'/responses';
    headers={Authorization:`Bearer ${cfg.key}`};
    payload={model:cfg.model,input:prompt,max_output_tokens:maxTokens};
  } else if(cfg.provider==='anthropic') {
    url=cfg.base.replace(/\/+$/,'')+(cfg.base.replace(/\/+$/,'').endsWith('/v1')?'/messages':'/v1/messages');
    headers={
      'x-api-key':cfg.key,
      'anthropic-version':'2023-06-01',
      'anthropic-dangerous-direct-browser-access':'true'
    };
    payload={model:cfg.model,max_tokens:maxTokens,messages:[{role:'user',content:prompt}]};
  } else if(cfg.provider==='gemini') {
    url=cfg.base.replace(/\/+$/,'')+`/models/${encodeURIComponent(cfg.model)}:generateContent`;
    headers={'x-goog-api-key':cfg.key};
    payload={contents:[{role:'user',parts:[{text:prompt}]}],generationConfig:{maxOutputTokens:maxTokens}};
  } else {
    throw new Error('Choose OpenAI, Claude or Gemini for Text AI.');
  }
  const data=await postProviderJSON(url,headers,payload,360000,({openai:'OpenAI',anthropic:'Claude',gemini:'Gemini'})[cfg.provider]);
  return {text:extractTextResponse(data,cfg.provider),model:cfg.model,provider:cfg.provider,response_id:data.id||null,usage:data.usage||data.usageMetadata||null};
}
function extractGeminiImage(data) {
  if (data.output_image?.data) {
    return `data:${data.output_image.mime_type||'image/png'};base64,${data.output_image.data}`;
  }
  for (const step of data.steps||[]) {
    if (step.type !== 'model_output') continue;
    for (const part of step.content||[]) {
      if (part.type==='image' && part.data) return `data:${part.mime_type||'image/png'};base64,${part.data}`;
    }
  }
  for (const candidate of data.candidates||[]) {
    for (const part of candidate.content?.parts||[]) {
      const inline=part.inlineData||part.inline_data;
      if(inline?.data) return `data:${inline.mimeType||inline.mime_type||'image/png'};base64,${inline.data}`;
    }
  }
  throw new Error('Gemini returned no image data. Confirm that the selected model supports image generation.');
}
async function requestImage(prompt,size='1024x1536',quality='medium') {
  const cfg=readProviderConfig('image');
  if(!cfg.key) throw new Error('No Image AI API key is configured. Open Settings and connect OpenAI Images or Gemini Image.');
  if(!cfg.model) throw new Error('Enter an Image AI model ID in Settings.');
  if(cfg.provider==='openai') {
    const url=cfg.base.replace(/\/+$/,'')+'/images/generations';
    const data=await postProviderJSON(url,{Authorization:`Bearer ${cfg.key}`},{
      model:cfg.model,prompt,n:1,size,quality:quality==='auto'?'auto':quality,output_format:'png'
    },420000,'OpenAI Images');
    const item=data.data?.[0];
    if(item?.b64_json) return {image_data:`data:image/png;base64,${item.b64_json}`,model:cfg.model,provider:cfg.provider};
    if(item?.url) {
      const imageResponse=await fetch(item.url,{mode:'cors',credentials:'omit',referrerPolicy:'no-referrer'});
      if(!imageResponse.ok) throw new Error('The image provider returned a URL that the browser could not download. Try another model or output format.');
      const blob=await imageResponse.blob();
      const dataUrl=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=reject;reader.readAsDataURL(blob);});
      return {image_data:dataUrl,model:cfg.model,provider:cfg.provider};
    }
    throw new Error('OpenAI returned no image data. Check image model access and organization verification.');
  }
  if(cfg.provider==='gemini') {
    const url=cfg.base.replace(/\/+$/,'')+'/interactions';
    const ratio=({'1024x1024':'1:1','1536x1024':'3:2','1024x1536':'2:3'})[size]||'2:3';
    const imageSize=quality==='high'?'2K':'1K';
    const data=await postProviderJSON(url,{'x-goog-api-key':cfg.key},{
      model:cfg.model,
      input:[{type:'text',text:prompt}],
      response_format:{type:'image',mime_type:'image/png',aspect_ratio:ratio,image_size:imageSize}
    },420000,'Gemini Image');
    return {image_data:extractGeminiImage(data),model:cfg.model,provider:cfg.provider};
  }
  throw new Error('Choose OpenAI Images or Gemini Image for image generation.');
}
function providerFormMatchesSaved(kind) {
  const isText=kind==='text';
  const saved=readProviderConfig(kind);
  const provider=(isText?$('#textProvider'):$('#imageProvider')).value;
  const base=(isText?$('#textBaseUrl'):$('#imageBaseUrl')).value.trim().replace(/\/+$/,'');
  const model=(isText?$('#textModelInput'):$('#imageModelInput')).value.trim();
  const key=(isText?$('#textApiKey'):$('#imageApiKey')).value.trim();
  return !!saved.key && provider===saved.provider && base===saved.base && model===saved.model && key===saved.key;
}
async function testTextConnection() {
  const feedback=$('#textApiFeedback');
  if(!providerFormMatchesSaved('text')) { feedback.className='inline-feedback error';feedback.textContent='Save the current Text AI provider, model and API key before testing the connection.';return; }
  feedback.className='inline-feedback';feedback.textContent='Testing the selected Text AI model…';
  try {
    const result=await requestText('Reply with exactly this sentence and nothing else: PinTools text connection successful.',120);
    feedback.className='inline-feedback success';feedback.textContent=`Connection successful · ${result.provider} · ${result.model}`;
    toast('Text AI connection successful');await refreshApiStatus();
  } catch(error) { feedback.className='inline-feedback error';feedback.textContent=error.message; }
}
async function testImageConnection() {
  const feedback=$('#imageApiFeedback');
  if(!providerFormMatchesSaved('image')) { feedback.className='inline-feedback error';feedback.textContent='Save the current Image AI provider, model and API key before testing the connection.';return; }
  if(!window.confirm('This connection test generates one small image and may incur charges from your image provider. Continue?')) { toast('Image test cancelled. No image request was sent.'); return; }
  feedback.className='inline-feedback';feedback.textContent='Generating a small test image. Provider charges may apply…';
  try {
    await requestImage('A simple elegant cream-colored abstract paper texture with soft natural shadows. No text.', '1024x1024','low');
    feedback.className='inline-feedback success';feedback.textContent='Image connection successful.';
    toast('Image AI connection successful');await refreshApiStatus();
  } catch(error) { feedback.className='inline-feedback error';feedback.textContent=error.message; }
}
function renderDashboard() {
  const query = ($('#toolSearch')?.value || '').trim().toLowerCase();
  const tools = TOOL_DEFS.filter(tool => (activeFilter === 'All' || tool.category === activeFilter) && (!query || `${tool.name} ${tool.desc} ${tool.category}`.toLowerCase().includes(query)));
  $('#toolGrid').innerHTML = tools.map(tool => `
    <article class="tool-card" style="--tint:${tool.tint};--icon:${tool.color}">
      <div class="tool-icon">${tool.icon}</div><h3>${esc(tool.name)}</h3><p>${esc(tool.desc)}</p>
      <div class="tool-card-footer"><span class="tag">${esc(tool.category)}</span><button class="open-tool" data-open-tool="${tool.id}">Open tool →</button></div>
    </article>`).join('') || '<div class="empty-state">No generators match your search.</div>';
  $$('[data-open-tool]', $('#toolGrid')).forEach(button => button.addEventListener('click', () => openTool(button.dataset.openTool)));
  renderRecentProjects();
}
function renderRecentProjects() {
  const target = $('#recentProjects');
  if (!projects.length) { target.innerHTML = '<div class="empty-state"><strong>Your first content project starts here.</strong>Create a project to keep titles, ideas, articles and images together.</div>'; return; }
  target.innerHTML = projects.slice(0,3).map(project => `<div class="project-card"><div class="project-card-icon">▤</div><div class="project-card-copy"><strong>${esc(project.name)}</strong><small>Updated ${new Date(project.updatedAt).toLocaleDateString()} · ${projectProgress(project)} saved stages</small></div><button class="open-tool" data-open-project="${project.id}">Open →</button></div>`).join('');
  $$('[data-open-project]', target).forEach(button => button.addEventListener('click', () => openWorkflow(button.dataset.openProject)));
}
function projectProgress(project) { return Object.values(project.data || {}).filter(value => value && (value.result || value.assets?.length)).length; }
function renderProjects() {
  const target = $('#projectGrid');
  if (!projects.length) { target.innerHTML = '<div class="empty-state"><strong>No projects yet</strong>Create a content project to keep your generated content and images together.</div>'; return; }
  target.innerHTML = projects.map(project => `<div class="project-card"><div class="project-card-icon">▤</div><div class="project-card-copy"><strong>${esc(project.name)}</strong><small>${new Date(project.updatedAt).toLocaleString()} · ${projectProgress(project)} saved stages</small></div><div class="project-card-actions"><button class="button button-primary button-small" data-project-open="${project.id}">Open workflow</button><button class="button button-secondary button-small" data-project-rename="${project.id}">Rename</button><button class="button button-danger-ghost button-small" data-project-delete="${project.id}">Delete</button><button class="button button-secondary button-small" data-project-export="${project.id}">Export</button></div></div>`).join('');
  $$('[data-project-open]',target).forEach(b=>b.addEventListener('click',()=>openWorkflow(b.dataset.projectOpen)));
  $$('[data-project-rename]',target).forEach(b=>b.addEventListener('click',()=>renameProject(b.dataset.projectRename)));
  $$('[data-project-delete]',target).forEach(b=>b.addEventListener('click',()=>deleteProject(b.dataset.projectDelete)));
  $$('[data-project-export]',target).forEach(b=>b.addEventListener('click',()=>exportProject(b.dataset.projectExport)));
}
function renameProject(id) { const project=getProject(id); if(!project)return;const name=prompt('Rename project:',project.name);if(name===null)return;project.name=name.trim()||project.name;project.updatedAt=Date.now();saveLocal();renderProjects();renderRecentProjects(); }
function deleteProject(id) { const project=getProject(id);if(!project||!confirm(`Delete "${project.name}" from this browser?`))return;projects=projects.filter(p=>p.id!==id);saveLocal();renderProjects();renderRecentProjects();toast('Project deleted'); }
function createNewProject() { const name=prompt('Name your content project:','New blog article');if(name===null)return;const project=createProject(name||'New blog article');openWorkflow(project.id);renderDashboard(); }

function inputField(label,name,value='',placeholder='',type='text',hint='',full=false) {
  return `<label class="field ${full?'field-full':''}"><span>${esc(label)}</span><input name="${name}" type="${type}" value="${esc(value)}" placeholder="${esc(placeholder)}">${hint?`<small>${esc(hint)}</small>`:''}</label>`;
}
function textareaField(label,name,value='',placeholder='',hint='',full=true) {
  return `<label class="field ${full?'field-full':''}"><span>${esc(label)}</span><textarea name="${name}" placeholder="${esc(placeholder)}">${esc(value)}</textarea>${hint?`<small>${esc(hint)}</small>`:''}</label>`;
}
function selectField(label,name,options,value,hint='') {
  return `<label class="field"><span>${esc(label)}</span><select name="${name}">${options.map(option=>`<option value="${esc(option.value)}" ${option.value===value?'selected':''}>${esc(option.label)}</option>`).join('')}</select>${hint?`<small>${esc(hint)}</small>`:''}</label>`;
}
function toolById(id) { return TOOL_DEFS.find(tool=>tool.id===id); }
function toolFormHTML(id, data={}, project=null, prefill={}) {
  const p = project || {};
  const pinTitles = p.data?.pinTitles?.titles || [];
  const ideas = p.ideas || [];
  const relatedIdea = ideas.find(item=>item.text===(prefill.idea||data.related_idea||''));
  if (id==='pinTitles') return `<div class="notice">Your original Title.txt prompt generates four Pinterest title variations. Select one to use as the blog article title. The same selected title flows into the article workflow.</div><div class="tool-form-grid">${selectField('Pin type','pin_type',[{value:'multi-idea',label:'Multi-idea'},{value:'recipe',label:'Recipe'}],data.pin_type||'multi-idea')}${inputField('Focus keyword','focus_keyword',data.focus_keyword||p.keyword||'','e.g. vintage entryway furniture')}${inputField('Number of ideas in the Pin','idea_count',data.idea_count||p.ideaCount||19,'e.g. 19','number')}${inputField('Tone / vibe','tone',data.tone||'Elegant, warm, timeless','e.g. cozy, elegant, minimalist')}</div>`;
  if (id==='ideas') return `<div class="notice">The Ideas.txt instruction is sent to your text model. The response is shown as a numbered idea list.</div><div class="tool-form-grid">${inputField('Article title','title',data.title||p.articleTitle||prefill.title||'','Use a title from the title generator', 'text','',true)}${inputField('Number of ideas','count',data.count||p.ideaCount||19,'e.g. 19','number')}</div>`;
  if (id==='imagePrompt') return `<div class="notice">Choose one idea at a time. The AI will return a detailed image-generation prompt, which you can send directly to the Image Generator.</div><div class="tool-form-grid">${inputField('Article title','title',data.title||p.articleTitle||'','Article title', 'text','',true)}${textareaField('Selected idea','idea',data.idea||prefill.idea||'','Paste one idea from your ideas list')}</div>`;
  if (id==='imageGenerator') return `<div class="notice">This generator creates the actual image using your configured image model. You can paste a prompt or send one from the Image Prompt Generator.</div><div class="tool-form-grid">${textareaField('Image-generation prompt','image_prompt',data.image_prompt||prefill.prompt||p.data?.imagePrompt?.result||'','Paste or select your final image prompt','This is sent to your configured image-generation model.')}${selectField('Image orientation','aspect_ratio',[{value:'portrait',label:'Portrait · 2:3'},{value:'square',label:'Square · 1:1'},{value:'landscape',label:'Landscape · 3:2'}],data.aspect_ratio||'portrait')}${selectField('Image quality','quality',[{value:'medium',label:'Medium'},{value:'high',label:'High'},{value:'low',label:'Low'}],data.quality||'medium')}${inputField('Image alt text','alt_text',data.alt_text||prefill.alt_text||relatedIdea?.altText||fallbackAltText(relatedIdea?.text||prefill.idea||''),'Describe the generated image')}${inputField('Related idea (optional)','related_idea',data.related_idea||prefill.idea||'','Matching article idea')}</div>`;
  if (id==='article') {
    const altDefaults = ideas.map((idea,i)=>idea.altText||fallbackAltText(idea.text)).join('\n');
    return `<div class="notice">Your Article.txt rules are retained: conversational SEO writing, one section per idea, clean HTML using h2, p and a tags, and no em dash. Add one image alt text per idea for the intended article structure.</div><div class="tool-form-grid">${inputField('Article title','title',data.title||p.articleTitle||'','Selected title', 'text','',true)}${inputField('Focus keyword','focus_keyword',data.focus_keyword||p.keyword||'','Main SEO keyword')}${textareaField('Researched keywords (comma-separated)','keywords',data.keywords||'','keyword 1, keyword 2, keyword 3')}${inputField('Number of ideas / subheadings','count',data.count||p.ideaCount||ideas.length||19,'Number of sections','number')}${textareaField('Image alt texts (one per idea, in order)','alt_texts',data.alt_texts||altDefaults,'One alt text per line. Keep the same order as your ideas.')}${textareaField('Internal links (one per line: anchor text | URL)','internal_links',data.internal_links||'','small bedroom ideas | https://example.com/small-bedroom')}</div>`;
  }
  if (id==='featured') return `<div class="notice">This runs your featured-image prompt through the text model, then sends the resulting image prompt to the image model. The output is a wide landscape featured image.</div><div class="tool-form-grid">${inputField('Article title','title',data.title||p.articleTitle||'','Article title','text','',true)}${textareaField('Article content or summary','article',data.article||p.data?.article?.result||'','Paste your article or a useful summary')}</div>`;
  if (id==='featuredPrompt') return `<div class="notice">Text-only tool. It creates a detailed featured-image prompt and does not call the image-generation API.</div><div class="tool-form-grid">${inputField('Article title','title',data.title||p.articleTitle||'','Article title','text','',true)}${inputField('Focus keyword','focus_keyword',data.focus_keyword||p.keyword||'','Main keyword')}${textareaField('Article content or summary','article',data.article||p.data?.article?.result||'','Paste the article or a useful summary')}${inputField('Visual style','style',data.style||'Elegant editorial home-decor photography','e.g. warm minimal, rustic, modern')}</div>`;
  if (id==='pinDescriptions') {
    const defaults = data.titles || pinTitles.map((title,i)=>`${i+1}. ${title.text}`).join('\n');
    return `<div class="notice">Your pin 4.txt prompt is used to generate four descriptions in the same order as the titles you provide.</div>${textareaField('Four Pinterest pin titles','titles',defaults,'Paste four titles, one per line')}`;
  }
  if (id==='pinterestPin') return `<div class="notice">One request creates two files: a clean AI-generated background and a finished 1000 × 1500 Pinterest pin. PinTools adds the exact title as editable-quality typography after image generation.</div><div class="tool-form-grid">${inputField('Pinterest pin title','title',data.title||p.articleTitle||prefill.title||'','Enter the exact title for the pin','text','',true)}${selectField('Design style','style',[{value:'editorial',label:'Elegant editorial'},{value:'minimal',label:'Minimal and clean'},{value:'cozy',label:'Warm and cozy'},{value:'bold',label:'Bold magazine style'}],data.style||'editorial')}${textareaField('Article / visual context','context',data.context||p.articleTitle||'','Describe the room, decor idea or article topic')}${inputField('Brand name (optional)','brand',data.brand||'PinTools','PinTools')}${inputField('Website (optional)','website',data.website||'','Your website (optional)')}</div>`;
  return '<div class="notice">This generator is not configured.</div>';
}
function openTool(id, projectId=null, prefill={}) {
  activeTool = id; activeProjectId = projectId || null;
  const project = getProject();
  const savedRecord = project?.data?.[id] || {};
  const saved = {...(savedRecord.inputs || {}), ...prefill};
  if(prefill.prompt && id==='imageGenerator') saved.image_prompt=prefill.prompt;
  if(prefill.idea && id==='imageGenerator') {
    const previousIdea=savedRecord.inputs?.related_idea||'';
    saved.related_idea=prefill.idea;
    if(previousIdea!==prefill.idea) saved.alt_text=prefill.alt_text||prefill.idea;
  }
  currentOutput = null;
  const tool = toolById(id); if (!tool) return;
  $('#toolModalCategory').textContent = `${tool.category.toUpperCase()} GENERATOR`;
  $('#toolModalTitle').textContent = tool.name;
  $('#toolModalSubtitle').textContent = 'Enter your details. PinTools runs the saved prompt and returns the finished result.';
  const batchAction=id==='pinterestPin'&&project&&getProjectPinPairs(project).length===4?'<button class="button button-secondary" type="button" id="generatePinBatchButton">Generate all 4 pins</button>':'';
  $('#toolModalBody').innerHTML = `<form id="toolForm" class="tool-form-grid">${toolFormHTML(id,saved,project,prefill)}</form><div class="modal-actions"><div class="modal-actions-left"><button class="button button-secondary button-small" type="button" id="previewPromptButton">Preview prompt</button><span class="muted-note" id="toolProjectNote">${project?`Saving to: ${esc(project.name)}`:'Save the result to a project when you are ready.'}</span></div><div class="modal-actions-right">${batchAction}<button class="button button-primary" type="button" id="generateToolButton">✦ Generate result</button></div></div><div id="promptPreviewMount"></div><div id="toolResultMount"></div>`;
  $('#toolModal').classList.add('show'); $('#toolModal').setAttribute('aria-hidden','false');
  $('#generateToolButton').addEventListener('click',generateCurrentTool);
  $('#generatePinBatchButton')?.addEventListener('click',()=>generatePinterestBatchFromProject(project.id));
  $('#previewPromptButton').addEventListener('click',togglePromptPreview);
  if (id==='ideas' && project?.data?.pinTitles?.selectedTitle && !saved.title) $('[name="title"]', $('#toolForm')).value=project.data.pinTitles.selectedTitle;
}
function closeTool() { $('#toolModal').classList.remove('show'); $('#toolModal').setAttribute('aria-hidden','true'); }
function collectFields() {
  const form = $('#toolForm'); const fields = {};
  $$('[name]',form).forEach(el => fields[el.name] = el.value.trim());
  return fields;
}
function fillTemplate(template, values) {
  return String(template||'').replace(/\{([a-zA-Z0-9_]+)\}/g,(match,key)=>Object.prototype.hasOwnProperty.call(values,key)?String(values[key]??''):match);
}
function buildPrompt(id, fields) {
  const template = prompts[id] || DEFAULT_PROMPTS[id] || '';
  if (id==='pinTitles') return fillTemplate(template,{pin_type:fields.pin_type,focus_keyword:fields.focus_keyword,idea_count:fields.idea_count,tone:fields.tone});
  if (id==='ideas') return fillTemplate(template,{title:fields.title,count:fields.count});
  if (id==='imagePrompt') return fillTemplate(template,{title:fields.title,idea:fields.idea})+'\n\nOUTPUT FORMAT: Return exactly two labeled sections: IMAGE PROMPT: followed by one detailed prompt, then ALT TEXT: followed by one concise, accurate accessibility description for this specific idea. Do not include other commentary.';
  if (id==='imageGenerator') return fillTemplate(prompts.imageGeneration,{image_prompt:fields.image_prompt,aspect_ratio:fields.aspect_ratio==='square'?'1:1 square':fields.aspect_ratio==='landscape'?'3:2 landscape':'2:3 portrait',quality:fields.quality});
  if (id==='article') {
    const projectIdeas=(fields.ideas||getProject()?.ideas?.map((idea,i)=>`${i+1}. ${idea.text}`).join('\n')||'');
    const ideaLines=String(projectIdeas).split(/\r?\n/).map(line=>line.replace(/^\s*\d+[.)-]?\s*/,'').trim()).filter(Boolean);
    const suppliedAltTextValue=String(fields.alt_texts||'').trim();
    const suppliedAltTexts=suppliedAltTextValue?suppliedAltTextValue.split(/\r?\n/):[];
    const requestedCount=Math.max(Number(fields.count)||0,ideaLines.length,suppliedAltTexts.length);
    const altTexts=requestedCount
      ? Array.from({length:requestedCount},(_,i)=>{
          const supplied=String(suppliedAltTexts[i]||'').trim();
          const fallback=fallbackAltText(ideaLines[i]||`Article section ${i+1}`);
          return `${i+1}. ${supplied||fallback}`;
        }).join('\n')
      : 'No image alt texts supplied.';
    const links = (fields.internal_links||'').split(/\r?\n/).map(x=>x.trim()).filter(Boolean).join('\n') || 'None provided.';
    const base=fillTemplate(template,{title:fields.title,focus_keyword:fields.focus_keyword,keywords:fields.keywords,count:fields.count,alt_texts:altTexts,internal_links:links});
    const ideaContext=projectIdeas?`\n\nARTICLE IDEAS IN THE REQUIRED ORDER (use these to guide one section per idea):\n${projectIdeas}`:'';
    return base+ideaContext;
  }
  if (id==='featured') return fillTemplate(template,{title:fields.title,article:fields.article});
  if (id==='featuredPrompt') return fillTemplate(prompts.featuredPromptOnly || DEFAULT_PROMPTS.featuredPromptOnly,{title:fields.title,focus_keyword:fields.focus_keyword,article:fields.article,style:fields.style});
  if (id==='pinDescriptions') return fillTemplate(template,{titles:fields.titles});
  if (id==='pinterestPin') {
    const layout = fillTemplate(prompts.pinLayout,{title:fields.title,style:fields.style,brand:fields.brand,website:fields.website});
    return fillTemplate(prompts.pinBackground,{title:fields.title,context:fields.context,style:fields.style,brand:fields.brand,website:fields.website,layout_instructions:layout});
  }
  return template;
}
function togglePromptPreview() {
  const fields=collectFields(); const promptText=buildPrompt(activeTool,fields);
  const mount=$('#promptPreviewMount');
  if (mount.innerHTML) { mount.innerHTML=''; $('#previewPromptButton').textContent='Preview prompt'; return; }
  mount.innerHTML=`<details class="prompt-preview" open><summary>Prompt sent to the AI model (optional preview)</summary><pre>${esc(promptText)}</pre></details>`;
  $('#previewPromptButton').textContent='Hide prompt preview';
}
function setGenerating(isBusy, label='Generating…') {
  const button=$('#generateToolButton'); if(!button)return;
  button.disabled=isBusy; button.innerHTML=isBusy?`<span class="spinner"></span> ${label}`:'✦ Generate result';
}
function showToolError(message) {
  $('#toolResultMount').innerHTML=`<div class="error-box"><strong>Generation could not be completed.</strong><br>${esc(message)}<br><br>${'Check the relevant Text AI or Image AI connection in Settings.'}</div>`;
}
async function generateCurrentTool() {
  const fields=collectFields(); const id=activeTool;
  if (id==='pinTitles' && !fields.focus_keyword) return showToolError('Enter a focus keyword first.');
  if (id==='ideas' && (!fields.title || !fields.count)) return showToolError('Enter an article title and number of ideas.');
  if (id==='imagePrompt' && (!fields.title || !fields.idea)) return showToolError('Enter the article title and one selected idea.');
  if (id==='imageGenerator' && !fields.image_prompt) return showToolError('Enter an image-generation prompt.');
  if (id==='article' && (!fields.title || !fields.focus_keyword)) return showToolError('Enter the article title and focus keyword.');
  if ((id==='featured' || id==='featuredPrompt') && !fields.title) return showToolError('Enter an article title.');
  if (id==='pinDescriptions' && !fields.titles) return showToolError('Enter the four Pinterest titles.');
  if (id==='pinDescriptions' && fields.titles.split(/\r?\n/).map(line=>line.trim()).filter(Boolean).length !== 4) return showToolError('Please enter exactly four Pinterest pin titles, one per line.');
  if (id==='pinterestPin' && !fields.title) return showToolError('Enter the Pinterest pin title.');
  const needsImage = ['imageGenerator','pinterestPin'].includes(id);
  const needsBoth = id === 'featured';
  if (needsImage && !apiSettings.image_api_key_configured) { showToolError('No image API key is configured. Open Settings → Image AI Connection and add your key.'); return; }
  if (needsBoth && (!apiSettings.text_api_key_configured || !apiSettings.image_api_key_configured)) { showToolError('Featured Image Generator needs both Text AI and Image AI connections. Configure both in Settings.'); return; }
  if (!needsImage && !needsBoth && !apiSettings.text_api_key_configured) { showToolError('No text API key is configured. Open Settings → Text AI Connection and add your key.'); return; }
  if (needsImage || needsBoth) {
    const description = id === 'imageGenerator' ? 'one article idea image' : id === 'featured' ? 'the featured image (including its text prompt)' : 'the Pinterest background and finished pin';
    const accepted = window.confirm(`Image generation uses your configured image API and may incur charges. This request will generate ${description}. Continue?`);
    if (!accepted) { toast('Image generation cancelled. No image API request was sent.'); return; }
  }
  setGenerating(true, id==='featured'?'Writing image prompt…':id==='pinterestPin'?'Creating pin background…':'Generating…');
  $('#toolResultMount').innerHTML='';
  const promptText=buildPrompt(id,fields);
  try {
    if (['imageGenerator','pinterestPin'].includes(id)) {
      const image = await requestImage(promptText, id==='pinterestPin'?'1024x1536':sizeFor(fields.aspect_ratio), fields.quality||'medium');
      if (id==='pinterestPin') {
        setGenerating(true,'Designing finished pin…');
        const pair=await composePinterestPin(image.image_data,fields);
        currentOutput={toolId:id,fields,prompt:promptText,images:[{name:'Pinterest background',dataUrl:pair.background,altText:`Background image for ${fields.title}`},{name:'Finished Pinterest pin',dataUrl:pair.finished,altText:fields.title}],result:'Pinterest background and finished pin generated.',model:image.model};
        renderPinResults(pair,fields,image.model);
      } else {
        currentOutput={toolId:id,fields,prompt:promptText,images:[{name:'Generated image',dataUrl:image.image_data,altText:fields.alt_text||fields.related_idea||'AI generated image'}],result:'Image generated.',model:image.model};
        renderSingleImageResult(image.image_data,'Generated image',image.model);
      }
    } else if (id==='featured') {
      setGenerating(true,'Creating featured image prompt…');
      const text=await requestText(promptText,6000);
      setGenerating(true,'Generating featured image…');
      const image=await requestImage(text.text,'1536x1024','high');
      currentOutput={toolId:id,fields,prompt:promptText,result:text.text,images:[{name:'Featured image',dataUrl:image.image_data,altText:fields.title}],model:image.model};
      renderFeaturedResult(text.text,image.image_data,image.model);
    } else {
      const result=await requestText(promptText,id==='article'?22000:9000);
      if(id==='article') {
        const normalized=normalizeArticleResult(result.text);
        currentOutput={toolId:id,fields,prompt:promptText,result:normalized.bodyHtml,metaDescription:normalized.metaDescription,model:result.model};
        renderTextResult(id,normalized.bodyHtml,result.model);
      } else if(id==='imagePrompt') {
        const parsed=parseImagePromptOutput(result.text,fields.idea);
        currentOutput={toolId:id,fields,prompt:promptText,result:parsed.imagePrompt,altText:parsed.altText,model:result.model};
        renderTextResult(id,parsed.imagePrompt,result.model);
      } else {
        currentOutput={toolId:id,fields,prompt:promptText,result:result.text,model:result.model};
        renderTextResult(id,result.text,result.model);
      }
    }
    if (getProject()) await persistCurrentOutput(false);
  } catch(error) { showToolError(error.message); }
  finally { setGenerating(false); }
}
function sizeFor(ratio) { return ratio==='square'?'1024x1024':ratio==='landscape'?'1536x1024':'1024x1536'; }

function parseTitleOptions(text) {
  const lines=String(text).split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
  const parsed=[];
  for(const line of lines){
    const match=line.match(/^\s*\d+[.)\-:]?\s*(.*?)\s*\[(\d+)\]\s*$/);
    if(match) parsed.push({text:match[1].trim(),count:match[2]});
    else if(/^\d+[.)]/.test(line)) parsed.push({text:line.replace(/^\d+[.)]\s*/, '').replace(/\s*\[\d+\]\s*$/,'').trim(),count:''});
  }
  return parsed.filter(x=>x.text);
}
function parsePinterestDescriptions(text) {
  const source=String(text||'').replace(/^```(?:text|markdown)?\s*/i,'').replace(/\s*```$/,'').trim();
  const results=[];let current='';
  for(const line of source.split(/\r?\n/)){
    const match=line.trim().match(/^([1-4])[.)\-:]\s*(.*)$/);
    if(match){
      if(current.trim())results.push(current.trim());
      current=match[2].trim();
    }else if(current && line.trim()){
      current+=' '+line.trim();
    }
  }
  if(current.trim())results.push(current.trim());
  if(results.length===4)return results;
  const chunks=source.split(/(?:^|\n)\s*[1-4][.)\-:]\s*/).map(x=>x.trim()).filter(Boolean);
  return chunks.length===4?chunks:results;
}
function getProjectPinPairs(project) {
  if(!project)return [];
  const auto=project.data?.automatedTextWorkflow;
  const titles=auto?.pinTitles?.length?auto.pinTitles:(project.data?.pinTitles?.titles||[]);
  const descriptions=auto?.pinDescriptionItems?.length?auto.pinDescriptionItems:parsePinterestDescriptions(project.data?.pinDescriptions?.result||'');
  return titles.slice(0,4).map((item,i)=>({
    title:typeof item==='string'?item:String(item?.text||'').trim(),
    description:String(descriptions[i]||'').trim()
  })).filter(item=>item.title&&item.description);
}
function parseIdeas(text) {
  return String(text).split(/\r?\n/).map(line=>line.trim()).filter(Boolean).map(line=>line.replace(/^\s*(?:\d+|[-*•])\s*[.)-]?\s*/, '').trim()).filter(Boolean);
}
function fallbackAltText(idea='') {
  const clean=String(idea||'').replace(/\s+/g,' ').trim();
  return clean ? `Decor inspiration illustrating ${clean}` : 'Home decor inspiration for this article section';
}
function parseImagePromptOutput(raw,idea='') {
  const text=String(raw||'').replace(/^```(?:text|markdown)?\s*/i,'').replace(/\s*```$/,'').trim();
  const promptMatch=text.match(/(?:IMAGE\s+PROMPT|IMAGE\s+GENERATION\s+PROMPT)\s*:\s*([\s\S]*?)(?=\n\s*ALT\s+TEXT\s*:|$)/i);
  const altMatch=text.match(/ALT\s+TEXT\s*:\s*([\s\S]*)$/i);
  const imagePrompt=(promptMatch?.[1]||text).trim();
  const altText=(altMatch?.[1]||'').trim().replace(/^["']|["']$/g,'');
  return {imagePrompt,altText:altText||fallbackAltText(idea)};
}
async function generateImagePromptForIdea(title,idea) {
  const prompt=buildPrompt('imagePrompt',{title,idea});
  const result=await requestText(prompt,5000);
  return {...parseImagePromptOutput(result.text,idea),model:result.model,prompt};
}
function renderTextResult(id,text,model) {
  let content='';
  if(id==='pinTitles') {
    const options=parseTitleOptions(text);
    content=`<pre class="result-text">${esc(text)}</pre>`;
    if(options.length) content+=`<div class="divider-line"></div><strong class="result-subheading">Choose one title to use as your blog article title</strong><div class="title-choice-list">${options.map((item,i)=>`<label class="title-choice"><input type="radio" name="selectedArticleTitle" value="${esc(item.text)}"><span><b>${esc(item.text)}</b><small>${item.count?`${item.count} characters`:'Title option '+(i+1)}</small></span></label>`).join('')}</div><p class="muted-note">Select a title. In Complete Workflow, PinTools will automatically continue to the next stage.</p><button class="button button-primary button-small" id="useSelectedTitle">Use selected title</button>`;
  } else if(id==='ideas') {
    const ideas=parseIdeas(text);
    content=`<pre class="result-text">${esc(text)}</pre>`;
    if(ideas.length) content+=`<div class="divider-line"></div><strong class="result-subheading">Your ideas · ${ideas.length}</strong><div class="idea-list">${ideas.map((idea,i)=>`<div class="idea-row"><span>${i+1}</span><p>${esc(idea)}</p><button class="text-button" data-create-image-prompt="${i}">Create image prompt →</button></div>`).join('')}</div>`;
  } else if(id==='imagePrompt') {
    content=`<pre class="result-text">${esc(text)}</pre><div class="alt-text-preview"><strong>Suggested image alt text</strong><p>${esc(currentOutput?.altText||fallbackAltText(currentOutput?.fields?.idea))}</p></div><div class="result-actions"><button class="button button-primary button-small" id="useImagePromptButton">Generate image from this prompt</button></div>`;
  } else if(id==='article') {
    const meta=currentOutput?.metaDescription||'';
    content=`${meta?`<div class="meta-description-preview"><strong>Meta description</strong><p>${esc(meta)}</p></div>`:''}<div class="result-actions"><button class="button button-secondary button-small" id="copyArticleHtml">Copy HTML</button><button class="button button-secondary button-small" id="downloadArticleHtml">Download HTML</button></div><iframe class="article-preview" id="articlePreview" sandbox=""></iframe><details class="prompt-preview"><summary>View raw HTML</summary><pre class="result-text">${esc(text)}</pre></details>`;
  } else {
    content=`<pre class="result-text">${esc(text)}</pre>`;
  }
  $('#toolResultMount').innerHTML=`<section class="result-panel"><div class="result-heading"><strong>Generated result</strong><span class="tag">${esc(model||'AI model')}</span></div><div class="result-body">${content}<div class="result-actions"><button class="button button-secondary button-small" id="copyResultButton">Copy result</button><button class="button button-secondary button-small" id="downloadTextResultButton">Download TXT</button><button class="button button-primary button-small" id="saveResultButton">${getProject()?'Saved to project':'Save to project'}</button></div></div></section>`;
  if(id==='article') { const frame=$('#articlePreview'); frame.srcdoc=`<!doctype html><html><head><meta charset="utf-8"><link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700&display=swap" rel="stylesheet"><style>body{font:16px/1.7 Poppins,sans-serif;color:#242b38;max-width:760px;margin:30px auto;padding:0 22px}h2{margin-top:1.7em}a{color:#315f9b}</style></head><body>${text}</body></html>`; $('#copyArticleHtml').onclick=()=>copyText(text); $('#downloadArticleHtml').onclick=()=>downloadFile(`${slug(currentOutput?.fields?.title||'article')}.html`,wrapArticleHtml(text,currentOutput?.fields?.title,currentOutput?.metaDescription||''),'text/html'); }
  if(id==='imagePrompt') $('#useImagePromptButton').onclick=()=>openTool('imageGenerator',getProject()?.id||null,{prompt:text,idea:currentOutput?.fields?.idea||''});
  $('#copyResultButton').onclick=()=>copyText(text);
  $('#downloadTextResultButton').onclick=()=>{
    const plain = id==='article' ? htmlToPlainText(text) : text;
    downloadFile(`${slug(currentOutput?.fields?.title||toolById(id)?.name||'generated-result')}.txt`,plain,'text/plain;charset=utf-8');
  };
  $('#saveResultButton').onclick=()=>saveCurrentOutput();
  $('#useSelectedTitle')?.addEventListener('click',useSelectedTitle);
  $$('input[name="selectedArticleTitle"]').forEach(radio=>radio.addEventListener('change',()=>{if($('#workflowModal').classList.contains('show'))useSelectedTitle();}));
  $$('[data-create-image-prompt]').forEach(button=>button.addEventListener('click',()=>{const index=Number(button.dataset.createImagePrompt);const ideas=parseIdeas(text);const project=getProject();openTool('imagePrompt',project?.id||null,{title:project?.articleTitle||currentOutput?.fields?.title||'',idea:ideas[index]||''});}));
}
function useSelectedTitle() {
  const selected=$('input[name="selectedArticleTitle"]:checked'); if(!selected)return;
  const project=ensureProject(selected.value); if(!project)return;
  updateProject(project.id,p=>{
    p.articleTitle=selected.value;
    p.keyword=currentOutput?.fields?.focus_keyword||p.keyword;
    p.ideaCount=Number(currentOutput?.fields?.idea_count)||p.ideaCount;
    p.data.pinTitles={...(p.data.pinTitles||{}),inputs:currentOutput?.fields||{},prompt:currentOutput?.prompt||'',result:currentOutput?.result||'',selectedTitle:selected.value,titles:parseTitleOptions(currentOutput?.result||''),updatedAt:Date.now()};
  });
  if(currentOutput) currentOutput.savedProjectId=project.id;
  if($('#saveResultButton')) $('#saveResultButton').textContent='Saved to project';
  toast('Selected title saved as the article title');
  renderDashboard();renderProjects();
  if($('#workflowModal').classList.contains('show')) {
    workflowProjectId=project.id; workflowStepIndex=1; closeTool(); renderWorkflow(project.id);
    window.setTimeout(()=>openTool('ideas',project.id,{title:selected.value}),90);
  }
}

function renderSingleImageResult(dataUrl,label,model) {
  $('#toolResultMount').innerHTML=`<section class="result-panel"><div class="result-heading"><strong>${esc(label)}</strong><span class="tag">${esc(model||'Image model')}</span></div><div class="result-body"><img class="result-image" src="${dataUrl}" alt="${esc(label)}"><div class="result-actions"><button class="button button-secondary button-small" id="downloadGeneratedImage">Download image</button><button class="button button-primary button-small" id="saveResultButton">${getProject()?'Saved to project':'Save to project'}</button></div></div></section>`;
  $('#downloadGeneratedImage').onclick=()=>downloadDataUrl(dataUrl,`${slug(currentOutput?.fields?.related_idea||currentOutput?.fields?.title||'pintools-image')}.${dataUrlExtension(dataUrl)}`);
  $('#saveResultButton').onclick=()=>saveCurrentOutput();
}
function renderFeaturedResult(promptText,imageData,model) {
  $('#toolResultMount').innerHTML=`<section class="result-panel"><div class="result-heading"><strong>Generated featured image</strong><span class="tag">${esc(model||'Image model')}</span></div><div class="result-body"><img class="result-image" src="${imageData}" alt="Featured image for ${esc(currentOutput.fields.title)}"><div class="result-actions"><button class="button button-secondary button-small" id="downloadGeneratedImage">Download image</button><button class="button button-primary button-small" id="saveResultButton">${getProject()?'Saved to project':'Save to project'}</button></div><details class="prompt-preview"><summary>View the AI-created image prompt</summary><pre>${esc(promptText)}</pre></details></div></section>`;
  $('#downloadGeneratedImage').onclick=()=>downloadDataUrl(imageData,`${slug(currentOutput.fields.title||'featured-image')}.${dataUrlExtension(imageData)}`);
  $('#saveResultButton').onclick=()=>saveCurrentOutput();
}
function renderPinResults(pair,fields,model) {
  $('#toolResultMount').innerHTML=`<section class="result-panel"><div class="result-heading"><strong>Two Pinterest pin outputs</strong><span class="tag">${esc(model||'Image model')}</span></div><div class="result-body"><div class="image-result-grid"><div class="image-result-card"><img src="${pair.background}" alt="Clean Pinterest background"><strong>01 · Background only</strong><button class="button button-secondary button-small" data-download="background">Download background</button></div><div class="image-result-card"><img src="${pair.finished}" alt="Finished Pinterest pin for ${esc(fields.title)}"><strong>02 · Finished pin</strong><button class="button button-secondary button-small" data-download="finished">Download finished pin</button></div></div><div class="result-actions"><button class="button button-primary button-small" id="saveResultButton">${getProject()?'Saved to project':'Save both to project'}</button></div></div></section>`;
  $('[data-download="background"]').onclick=()=>downloadDataUrl(pair.background,`${slug(fields.title)}-background.${dataUrlExtension(pair.background)}`);
  $('[data-download="finished"]').onclick=()=>downloadDataUrl(pair.finished,`${slug(fields.title)}-pinterest-pin.png`);
  $('#saveResultButton').onclick=()=>saveCurrentOutput();
}

function renderPinterestBatchResults(items,projectId) {
  const toolVisible=$('#toolModal')?.classList.contains('show');
  const workflowVisible=$('#workflowModal')?.classList.contains('show')&&workflowProjectId===projectId;
  const target=toolVisible?$('#toolResultMount'):workflowVisible?($('#workflowBatchResults')||$('#toolResultMount')):($('#toolResultMount')||$('#workflowBatchResults'));
  if(!target)return;
  const cards=items.map((item,index)=>`<article class="image-result-card"><img src="${item.dataUrl}" alt="${esc(item.altText||item.name)}"><strong>${esc(item.name)}</strong><small>${esc(item.title||'')}</small><button class="button button-secondary button-small" data-batch-download="${index}">Download PNG</button></article>`).join('');
  target.innerHTML=`<section class="result-panel"><div class="result-heading"><strong>Four Pinterest pins</strong><span class="tag">Background + finished versions</span></div><div class="result-body"><p class="muted-note">Each pin has its own clean background and finished design. All completed files are saved to this project.</p><div class="image-result-grid batch-pin-grid">${cards}</div></div></section>`;
  $$('[data-batch-download]',target).forEach(button=>button.addEventListener('click',()=>{const item=items[Number(button.dataset.batchDownload)];if(item?.dataUrl)downloadDataUrl(item.dataUrl,`${slug(item.name)}.${dataUrlExtension(item.dataUrl)}`);}));
}
async function generatePinterestBatchFromProject(projectId) {
  const project=getProject(projectId);
  if(!project){toast('Open or create a project before generating a pin batch.');return;}
  const pairs=getProjectPinPairs(project);
  if(pairs.length!==4){toast('A batch needs four Pinterest titles and four matching descriptions.');return;}
  if(!apiSettings.image_api_key_configured){showToolError('No image API key is configured. Open Settings → Image AI and add your provider key.');return;}
  const accepted=window.confirm('This batch makes up to 4 image-generation API requests and creates up to 8 image files (4 clean backgrounds + 4 finished pins). Your image provider may charge for each request. Continue?');
  if(!accepted){toast('Pinterest batch cancelled. No image requests were sent.');return;}
  const button=$('#generatePinBatchButton')||$('#workflowGenerateAllPins')||$('#autoGenerateAllPins');
  if(button){button.disabled=true;button.textContent='Generating 4 Pinterest pins…';}
  const toolVisible=$('#toolModal')?.classList.contains('show');
  const workflowVisible=$('#workflowModal')?.classList.contains('show')&&workflowProjectId===projectId;
  const target=toolVisible?$('#toolResultMount'):workflowVisible?($('#workflowBatchResults')||$('#toolResultMount')):($('#toolResultMount')||$('#workflowBatchResults'));
  if(target)target.innerHTML='<div class="notice notice-cost">Preparing Pinterest batch… 0 of 4 pins completed. The four image requests will run one at a time.</div>';
  const resultItems=[];
  let completed=0;
  try{
    for(let i=0;i<4;i++){
      const pair=pairs[i];
      const signature=`${pair.title}\n${pair.description}`;
      const latest=getProject(projectId);
      const previous=latest?.data?.pinterestBatch?.items?.[i];
      if(previous?.status==='completed'&&previous.signature===signature&&Array.isArray(previous.assets)&&previous.assets.length===2){
        const cachedFiles=[];
        for(const assetId of previous.assets){
          const asset=(latest.imageAssets||[]).find(item=>item.id===assetId);
          const dataUrl=await getAsset(assetId);
          if(asset&&dataUrl)cachedFiles.push({name:asset.name,dataUrl,altText:asset.altText,title:pair.title});
        }
        if(cachedFiles.length===2){
          resultItems.push(...cachedFiles);
          completed++;
          continue;
        }
      }
      const progressTarget=toolVisible?($('#toolResultMount')||target):workflowVisible?($('#workflowBatchResults')||target):($('#toolResultMount')||target);if(progressTarget)progressTarget.innerHTML=`<div class="notice notice-cost">Generating Pinterest pin ${i+1} of 4. One image API request per pin. Completed: ${completed} of 4.</div>`;
      const fields={title:pair.title,style:'editorial',context:`Article: ${project.articleTitle||''}\nPinterest description: ${pair.description}`,brand:'PinTools',website:''};
      const prompt=buildPrompt('pinterestPin',fields);
      const image=await requestImage(prompt,'1024x1536','medium');
      const composed=await composePinterestPin(image.image_data,fields);
      const files=[
        {name:`Pin ${i+1} background`,dataUrl:composed.background,altText:`Clean Pinterest background for ${pair.title}`},
        {name:`Pin ${i+1} finished design`,dataUrl:composed.finished,altText:pair.title}
      ];
      const savedAssets=[];
      for(const file of files){
        const id=uid('asset');
        await putAsset(id,file.dataUrl);
        savedAssets.push({id,name:file.name,altText:file.altText,createdAt:Date.now(),tool:'pinterestBatch',relatedIdea:pair.title});
        resultItems.push({...file,title:pair.title});
      }
      updateProject(projectId,p=>{
        p.imageAssets=p.imageAssets||[];
        p.imageAssets.push(...savedAssets);
        p.data.pinterestBatch=p.data.pinterestBatch||{items:[]};
        p.data.pinterestBatch.items=p.data.pinterestBatch.items||[];
        p.data.pinterestBatch.items[i]={status:'completed',signature,title:pair.title,description:pair.description,assets:savedAssets.map(a=>a.id),updatedAt:Date.now()};
        p.data.pinterestBatch.updatedAt=Date.now();
      });
      completed++;
      const completionTarget=toolVisible?($('#toolResultMount')||target):workflowVisible?($('#workflowBatchResults')||target):($('#toolResultMount')||target);if(completionTarget)completionTarget.innerHTML=`<div class="notice notice-cost">Pinterest batch progress: ${completed} of 4 pins completed. Completed files are already saved to your project.</div>`;
    }
    const finalProject=getProject(projectId);
    const allItems=[];
    for(let i=0;i<4;i++){
      const saved=finalProject?.data?.pinterestBatch?.items?.[i];
      if(!saved?.assets)continue;
      for(const assetId of saved.assets){
        const asset=(finalProject.imageAssets||[]).find(item=>item.id===assetId);
        const dataUrl=await getAsset(assetId);
        if(asset&&dataUrl)allItems.push({name:asset.name,dataUrl,altText:asset.altText,title:saved.title});
      }
    }
    toast('Pinterest batch finished. Generated files are saved in the project gallery.');
    if($('#workflowModal').classList.contains('show')&&workflowProjectId===projectId){
      if(workflowMode==='guided'){workflowStepIndex=WORKFLOW_STAGES.length;renderWorkflow(projectId);}
      else renderWorkflow(projectId);
    }
    renderPinterestBatchResults(allItems,projectId);
  }catch(error){
    const errorTarget=toolVisible?($('#toolResultMount')||target):workflowVisible?($('#workflowBatchResults')||target):($('#toolResultMount')||target);if(errorTarget)errorTarget.innerHTML=`<div class="error-box">Pinterest batch stopped after ${completed} completed pins. Those files are saved. Error: ${esc(error.message)}</div>`;
    toast('Pinterest batch stopped. Completed pins were saved; retry to generate the remaining pins.');
  }finally{
    if(button){button.disabled=false;button.textContent='Generate all 4 pins';}
  }
}
function normalizeArticleResult(raw) {
  let source=String(raw||'').trim().replace(/^```(?:html)?\s*/i,'').replace(/\s*```$/,'');
  let metaDescription='';
  const firstLine=source.split(/\r?\n/).find(line=>line.trim());
  if(firstLine && !firstLine.trim().startsWith('<')) {
    metaDescription=firstLine.trim().replace(/^meta description\s*:?\s*/i,'').slice(0,300);
    source=source.replace(firstLine,'').trim();
  } else {
    const match=source.match(/<meta\s+name=["']description["']\s+content=["']([^"']*)["']\s*\/?\s*>/i);
    if(match) metaDescription=match[1].trim().slice(0,300);
  }
  const parsed=new DOMParser().parseFromString(source,'text/html');
  const allowed=new Set(['H2','P','A','BR','UL','OL','LI','STRONG','EM']);
  const cleanNode=(node)=>{
    if(node.nodeType===Node.TEXT_NODE)return document.createTextNode(node.nodeValue||'');
    if(node.nodeType!==Node.ELEMENT_NODE)return document.createDocumentFragment();
    const tag=node.tagName;
    const fragment=document.createDocumentFragment();
    [...node.childNodes].forEach(child=>fragment.appendChild(cleanNode(child)));
    if(!allowed.has(tag))return fragment;
    const clean=document.createElement(tag.toLowerCase());
    if(tag==='A'){
      const href=node.getAttribute('href')||'';
      if(/^https?:\/\//i.test(href)){clean.setAttribute('href',href);clean.setAttribute('rel','noopener noreferrer');}
    }
    clean.appendChild(fragment);
    return clean;
  };
  const container=document.createElement('div');
  [...parsed.body.childNodes].forEach(node=>container.appendChild(cleanNode(node)));
  return {bodyHtml:container.innerHTML.trim(),metaDescription};
}
function wrapArticleHtml(html,title='',metaDescription='') {
  const description=metaDescription?`<meta name="description" content="${esc(metaDescription)}">`:'';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title>${description}</head><body>${html}</body></html>`;
}
function slug(value='content') { return String(value).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,70)||'content'; }
function downloadFile(name,content,type='text/plain') { const blob=new Blob([content],{type});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=name;a.style.display='none';document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1500); }
function dataUrlExtension(dataUrl) { return /^data:image\/(?:jpe?g|webp)/i.test(String(dataUrl||'')) ? 'jpg' : 'png'; }
function downloadDataUrl(dataUrl,name) {
  if(!dataUrl || !String(dataUrl).startsWith('data:image/')) { toast('This image is not available to download.'); return; }
  const a=document.createElement('a');a.href=dataUrl;a.download=name;a.style.display='none';document.body.appendChild(a);a.click();a.remove();
}
function htmlToPlainText(html) {
  const doc=new DOMParser().parseFromString(String(html||''),'text/html');
  const blockTags=new Set(['P','H1','H2','H3','H4','LI','DIV','SECTION','BLOCKQUOTE']);
  const walk=node=>{
    if(node.nodeType===Node.TEXT_NODE)return node.nodeValue||'';
    if(node.nodeType!==Node.ELEMENT_NODE)return [...(node.childNodes||[])].map(walk).join('');
    if(node.tagName==='BR')return '\n';
    const content=[...node.childNodes].map(walk).join('');
    return blockTags.has(node.tagName)?`\n${content.trim()}\n`:content;
  };
  return walk(doc.body).replace(/[\t ]+\n/g,'\n').replace(/\n[ \t]+/g,'\n').replace(/\n{3,}/g,'\n\n').trim();
}
async function copyText(text) { try { await navigator.clipboard.writeText(text);toast('Copied to clipboard'); } catch { const area=document.createElement('textarea');area.value=text;document.body.appendChild(area);area.select();document.execCommand('copy');area.remove();toast('Copied to clipboard'); } }

async function composePinterestPin(backgroundData,fields) {
  if(document.fonts?.ready) await document.fonts.ready;
  const image=await loadImage(backgroundData);
  const canvas=document.createElement('canvas');canvas.width=1000;canvas.height=1500;
  const ctx=canvas.getContext('2d');
  // Fill the 2:3 frame without distortion.
  const scale=Math.max(canvas.width/image.width,canvas.height/image.height);
  const sw=canvas.width/scale,sh=canvas.height/scale,sx=(image.width-sw)/2,sy=(image.height-sh)/2;
  ctx.drawImage(image,sx,sy,sw,sh,0,0,canvas.width,canvas.height);
  const style=fields.style||'editorial';
  let panel={x:80,y:style==='minimal'?1030:style==='bold'?880:120,w:840,h:style==='bold'?500:390};
  let panelFill='rgba(250,247,239,.91)', textColor='#263142', kickerColor='#8c7656', font='Poppins, sans-serif', align='center';
  if(style==='minimal'){panel={x:65,y:1000,w:870,h:405};panelFill='rgba(255,255,255,.92)';font='Poppins, sans-serif';}
  if(style==='cozy'){panel={x:72,y:125,w:856,h:440};panelFill='rgba(247,235,215,.93)';textColor='#493b2d';kickerColor='#98734d';}
  if(style==='bold'){panel={x:60,y:920,w:880,h:470};panelFill='rgba(24,32,43,.91)';textColor='#fffaf1';kickerColor='#e8c995';font='Poppins, sans-serif';align='left';}
  roundedRect(ctx,panel.x,panel.y,panel.w,panel.h,20,panelFill);
  const brand=(fields.brand||'').trim();
  const website=(fields.website||'').trim();
  ctx.textAlign=align;ctx.fillStyle=kickerColor;ctx.font='700 18px Poppins, sans-serif';
  const centerX=align==='left'?panel.x+54:panel.x+panel.w/2;
  if(brand)ctx.fillText(brand.toUpperCase(),centerX,panel.y+58, panel.w-100);
  const title=fields.title||'';
  const maxWidth=panel.w-108;
  const lines=wrapCanvasText(ctx,title,maxWidth,font,64,36);
  const lineHeight=lines.fontSize*1.12;
  const titleHeight=lines.lines.length*lineHeight;
  let y=panel.y+(brand?110:90)+(panel.h-(brand?120:100)-titleHeight)/2+lines.fontSize*.82;
  ctx.fillStyle=textColor;ctx.textAlign=align;ctx.font=`700 ${lines.fontSize}px ${font}`;
  for(const line of lines.lines){ctx.fillText(line,centerX,y,maxWidth);y+=lineHeight;}
  if(website){ctx.font='600 15px Poppins, sans-serif';ctx.fillStyle=kickerColor;ctx.fillText(website,centerX,panel.y+panel.h-38,maxWidth);}
  // Fine border and small decorative rule add a deliberate editorial finish.
  ctx.strokeStyle=style==='bold'?'rgba(255,255,255,.28)':'rgba(95,79,56,.22)';ctx.lineWidth=1.5;roundedRectStroke(ctx,panel.x+13,panel.y+13,panel.w-26,panel.h-26,14);
  const finished=canvas.toDataURL('image/png');
  const bgCanvas=document.createElement('canvas');bgCanvas.width=1000;bgCanvas.height=1500;bgCanvas.getContext('2d').drawImage(image,sx,sy,sw,sh,0,0,1000,1500);
  return {background:bgCanvas.toDataURL('image/png'),finished};
}
function loadImage(src){return new Promise((resolve,reject)=>{const img=new Image();img.onload=()=>resolve(img);img.onerror=()=>reject(new Error('Could not load the generated image for pin layout.'));img.src=src;});}
function roundedRect(ctx,x,y,w,h,r,fill){ctx.beginPath();ctx.roundRect(x,y,w,h,r);ctx.fillStyle=fill;ctx.fill();}
function roundedRectStroke(ctx,x,y,w,h,r){ctx.beginPath();ctx.roundRect(x,y,w,h,r);ctx.stroke();}
function wrapCanvasText(ctx,text,maxWidth,font,maxSize,minSize){let size=maxSize,lines=[];while(size>=minSize){ctx.font=`700 ${size}px ${font}`;lines=[];let line='';for(const word of String(text).split(/\s+/)){const test=line?line+' '+word:word;if(ctx.measureText(test).width>maxWidth&&line){lines.push(line);line=word;}else line=test;}if(line)lines.push(line);if(lines.length<=5&&lines.every(item=>ctx.measureText(item).width<=maxWidth))return {lines,fontSize:size};size-=2;}ctx.font=`700 ${minSize}px ${font}`;lines=[];let line='';for(const word of String(text).split(/\s+/)){const test=line?line+' '+word:word;if(ctx.measureText(test).width>maxWidth&&line){lines.push(line);line=word;}else line=test;}if(line)lines.push(line);return {lines,fontSize:minSize};}

async function persistCurrentOutput(ask=true) {
  if(!currentOutput)return;
  let project=getProject();
  if(!project && ask){project=askForProjectName(currentOutput.fields?.title||currentOutput.fields?.focus_keyword||'New content project');if(!project)return;}
  if(!project)return;
  const output=currentOutput;
  if(output.savedProjectId===project.id) { if(ask) toast('This result is already saved in the project'); return; }
  if(output.images?.length){
    const savedAssets=[];
    for(const image of output.images){
      const id=uid('asset');
      await putAsset(id,image.dataUrl);
      savedAssets.push({id,name:image.name,altText:image.altText||'',createdAt:Date.now(),tool:output.toolId,relatedIdea:output.fields?.related_idea||''});
    }
    updateProject(project.id,p=>{
      p.imageAssets=p.imageAssets||[];p.imageAssets.push(...savedAssets);
      p.data[output.toolId]={...(p.data[output.toolId]||{}),inputs:output.fields,prompt:output.prompt,result:output.result,assets:savedAssets.map(a=>a.id),updatedAt:Date.now()};
      if(output.toolId==='pinterestPin')p.data.pinterestPin={...p.data.pinterestPin,inputs:output.fields,result:output.result,assets:savedAssets.map(a=>a.id),updatedAt:Date.now()};
      if(output.toolId==='featured')p.data.featured={...p.data.featured,inputs:output.fields,result:output.result,assets:savedAssets.map(a=>a.id),updatedAt:Date.now()};
      if(output.toolId==='imageGenerator'&&output.fields.related_idea){
        const idea=p.ideas?.find(item=>item.text===output.fields.related_idea);
        if(idea){idea.altText=output.fields.alt_text||idea.altText||fallbackAltText(idea.text);idea.imageAssetId=savedAssets[0]?.id||idea.imageAssetId||'';}
      }
    });
  } else {
    updateProject(project.id,p=>{
      p.data[output.toolId]={...(p.data[output.toolId]||{}),inputs:output.fields,prompt:output.prompt,result:output.result,metaDescription:output.metaDescription||'',updatedAt:Date.now()};
      if(output.toolId==='pinTitles'){
        p.keyword=output.fields.focus_keyword||p.keyword;p.ideaCount=Number(output.fields.idea_count)||p.ideaCount;
        p.data.pinTitles.titles=parseTitleOptions(output.result);
      }
      if(output.toolId==='ideas'){
        p.articleTitle=output.fields.title||p.articleTitle;p.ideaCount=Number(output.fields.count)||p.ideaCount;
        p.ideas=parseIdeas(output.result).map((text,i)=>({id:`idea_${i+1}`,text,altText:'',imagePrompt:'',imageAssetId:'',createdAt:Date.now()}));
      }
      if(output.toolId==='imagePrompt'){
        const idea=p.ideas?.find(item=>item.text===output.fields.idea);
        if(idea){idea.imagePrompt=output.result;idea.altText=output.altText||idea.altText||fallbackAltText(idea.text);}
        p.data.imagePrompt.lastIdea=output.fields.idea;
      }
      if(output.toolId==='featuredPrompt'){
        p.data.featuredPromptOnly={...(p.data.featuredPromptOnly||{}),inputs:output.fields,prompt:output.prompt,result:output.result,updatedAt:Date.now()};
      }
      if(output.toolId==='article')p.articleTitle=output.fields.title||p.articleTitle;
    });
  }
  output.savedProjectId=project.id;
  renderDashboard();renderProjects();
  if($('#workflowModal').classList.contains('show') && workflowProjectId===project.id) {
    await handleWorkflowOutputSaved(project.id, output);
  }
  if(ask)toast('Result saved to project');
}

async function saveCurrentOutput() { await persistCurrentOutput(true); }

async function runImagePromptSequence(projectId) {
  if(imagePromptRuns.has(projectId)) return;
  const initial=getProject(projectId);
  if(!initial || !(initial.ideas||[]).length){toast('Generate article ideas before creating image prompts.');return;}
  imagePromptRuns.add(projectId);
  workflowStepIndex=2;
  updateProject(projectId,p=>{p.data.imagePromptSequence={...(p.data.imagePromptSequence||{}),status:'running',total:p.ideas.length,startedAt:p.data.imagePromptSequence?.startedAt||Date.now(),error:''};});
  renderWorkflow(projectId);
  try {
    const total=getProject(projectId).ideas.length;
    for(let i=0;i<total;i++){
      const latest=getProject(projectId);
      const idea=latest.ideas[i];
      if(idea.imagePrompt && idea.altText) continue;
      updateProject(projectId,p=>{p.data.imagePromptSequence={...(p.data.imagePromptSequence||{}),status:'running',currentIndex:i+1,total:p.ideas.length};});
      renderWorkflow(projectId);
      const generated=await generateImagePromptForIdea(latest.articleTitle,idea.text);
      updateProject(projectId,p=>{
        const target=p.ideas.find(item=>item.id===idea.id);
        if(target){target.imagePrompt=generated.imagePrompt;target.altText=generated.altText||fallbackAltText(target.text);}
        p.data.imagePromptSequence={...(p.data.imagePromptSequence||{}),status:'running',completedCount:(p.ideas||[]).filter(item=>item.imagePrompt&&item.altText).length,total:p.ideas.length};
      });
      renderWorkflow(projectId);
    }
    updateProject(projectId,p=>{p.data.imagePromptSequence={...(p.data.imagePromptSequence||{}),status:'completed',completedCount:p.ideas.length,total:p.ideas.length,error:'',completedAt:Date.now()};});
    workflowStepIndex=3;
    renderWorkflow(projectId);
    toast('All idea image prompts and alt texts are ready. No images were generated.');
  } catch(error) {
    updateProject(projectId,p=>{p.data.imagePromptSequence={...(p.data.imagePromptSequence||{}),status:'error',error:error.message||'Image prompt generation failed.'};});
    renderWorkflow(projectId);
    toast('Image prompt sequence stopped. You can retry the remaining prompts.');
  } finally {
    imagePromptRuns.delete(projectId);
  }
}

const WORKFLOW_STAGES = [
  {key:'pinTitles',tool:'pinTitles',title:'Choose your article title',short:'Title',description:'Enter your focus keyword, generate four Pinterest title options, then select the title you want to use for the blog article.'},
  {key:'ideas',tool:'ideas',title:'Generate article ideas',short:'Ideas',description:'Create the numbered ideas that will become the sections of your article.'},
  {key:'imagePrompt',tool:'imagePrompt',title:'Create image prompts',short:'Prompts',description:'PinTools creates one detailed image prompt for each article idea.'},
  {key:'imageGenerator',tool:'imageGenerator',title:'Generate article images',short:'Images',description:'Generate an image for each idea and add its alt text. Image requests may incur provider charges.'},
  {key:'article',tool:'article',title:'Write your article',short:'Article',description:'Create the complete SEO article using the title, keyword, ideas, alt texts and internal links.'},
  {key:'featured',tool:'featured',title:'Create the featured image',short:'Featured',description:'Generate a featured-image prompt from your article, then create the actual image.'},
  {key:'pinDescriptions',tool:'pinDescriptions',title:'Write Pinterest descriptions',short:'Descriptions',description:'Generate four descriptions for the four Pinterest title options.'},
  {key:'pinterestPin',tool:'pinterestPin',title:'Create your Pinterest pin',short:'Pin design',description:'Create both the clean background and the finished 1000 × 1500 Pinterest pin.'}
];
function workflowStageDone(project,key) {
  if(key==='pinTitles')return !!project.data?.pinTitles?.selectedTitle;
  if(key==='ideas')return (project.ideas||[]).length>0;
  if(key==='imagePrompt')return (project.ideas||[]).length>0 && project.ideas.every(idea=>!!idea.imagePrompt&&!!idea.altText);
  if(key==='imageGenerator')return (project.ideas||[]).length>0 && project.ideas.every(idea=>!!idea.imageAssetId);
  if(key==='article')return !!project.data?.article?.result;
  if(key==='featured')return !!project.data?.featured?.assets?.length;
  if(key==='pinDescriptions')return !!project.data?.pinDescriptions?.result;
  if(key==='pinterestPin')return !!project.data?.pinterestPin?.assets?.length || (project.data?.pinterestBatch?.items||[]).filter(item=>item.status==='completed').length===4;
  return false;
}
function firstIncompleteWorkflowStep(project) {
  const skipped=project.workflowSkipped||{};
  const index=WORKFLOW_STAGES.findIndex(stage=>!workflowStageDone(project,stage.key)&&!skipped[stage.key]);
  return index<0?WORKFLOW_STAGES.length:index;
}
function openWorkflow(projectId) {
  workflowProjectId=projectId;activeProjectId=projectId;
  workflowMode=getProject(projectId)?.data?.automatedTextWorkflow?'automated':'guided';
  const project=getProject(projectId);workflowStepIndex=project?firstIncompleteWorkflowStep(project):0;
  renderWorkflow(projectId);
  $('#workflowModal').classList.add('show');$('#workflowModal').setAttribute('aria-hidden','false');
}
function closeWorkflow() {
  closeTool();$('#workflowModal').classList.remove('show');$('#workflowModal').setAttribute('aria-hidden','true');
}
function workflowStageAction(stage,project) {
  if(stage.key==='imagePrompt') {
    const missing=(project.ideas||[]).some(idea=>!idea.imagePrompt||!idea.altText);
    const rows=(project.ideas||[]).map((idea,i)=>`<div class="workflow-idea-row"><span class="workflow-stage-icon">${i+1}</span><div class="idea-copy">${esc(idea.text)}<div class="idea-status">${idea.imagePrompt&&idea.altText?'Prompt + alt text ready':idea.imagePrompt?'Alt text needed':'Prompt needed'}</div></div><button class="button button-secondary button-small" data-workflow-idea-prompt="${i}">${idea.imagePrompt?'Edit prompt':'Create prompt'}</button></div>`).join('');
    const sequence=project.data?.imagePromptSequence||{};
    const progress=sequence.status==='running'?`<div class="notice notice-cost">Automatically generating prompts and alt text: ${sequence.completedCount||0} of ${sequence.total||project.ideas.length} completed. Actual images are not generated in this stage.</div>`:sequence.status==='error'?`<div class="error-box">${esc(sequence.error||'A prompt failed. Retry the remaining prompts.')}</div>`:'';
    return `${progress}${rows||'<div class="empty-state">Generate article ideas first.</div>'}<div class="workflow-footer-actions"><span class="muted-note">${(project.ideas||[]).filter(x=>x.imagePrompt&&x.altText).length} of ${(project.ideas||[]).length} prompts ready</span>${missing?`<button class="button button-primary" id="workflowRunAllPrompts" ${sequence.status==='running'?'disabled':''}>${sequence.status==='error'?'Retry remaining prompts':'Generate all prompts automatically'} →</button>`:''}</div>`;
  }
  if(stage.key==='imageGenerator') {
    const rows=(project.ideas||[]).map((idea,i)=>`<div class="workflow-idea-row"><span class="workflow-stage-icon">${i+1}</span><div class="idea-copy">${esc(idea.text)}<div class="idea-status">${idea.imageAssetId?'Image saved':idea.imagePrompt?'Ready to generate':'Image prompt missing'}</div></div><button class="button button-secondary button-small" data-workflow-idea-image="${i}" ${idea.imagePrompt?'':'disabled'}>${idea.imageAssetId?'Regenerate image':'Generate image'}</button></div>`).join('');
    const generated=(project.ideas||[]).filter(x=>x.imageAssetId).length;
    const total=(project.ideas||[]).length;
    return `<div class="notice notice-cost"><strong>Optional image generation</strong><br>Generate only the idea images you want. Each image request may incur charges from your image provider. No image API request is made until you click a Generate image button and confirm.</div>${rows||'<div class="empty-state">Create image prompts first.</div>'}<div class="workflow-footer-actions"><span class="muted-note">${generated} of ${total} images saved</span><button class="button button-primary" id="workflowContinueImages">${generated===total&&total?'Continue to article →':'Skip remaining images and continue →'}</button></div>`;
  }
  if(stage.key==='featured' || stage.key==='pinterestPin') {
    const existing=workflowStageDone(project,stage.key);
    const label=stage.key==='featured'?'featured image':'Pinterest backgrounds and finished pins';
    const skipLabel=stage.key==='featured'?'Skip featured image':'Skip Pinterest pin generation';
    const batchReady=stage.key==='pinterestPin'&&getProjectPinPairs(project).length===4;
    return `<div class="workflow-current-card"><div class="eyebrow">STEP ${workflowStepIndex+1} OF ${WORKFLOW_STAGES.length}</div><h3>${esc(stage.title)}</h3><p>${esc(stage.description)}</p>${existing?'<div class="success-box">This stage has been completed and saved in your project. You can reopen it to make changes.</div>':''}<div class="notice notice-cost"><strong>Optional image generation</strong><br>Generating the ${label} uses your configured image API and may incur provider charges. Skipping this stage sends no image-generation request.</div></div><div class="workflow-footer-actions"><button class="button button-secondary" id="workflowSkipStage">${skipLabel} (no image charge)</button>${batchReady?'<button class="button button-secondary" id="workflowGenerateAllPins">Generate all 4 pins</button>':''}<button class="button button-primary" id="workflowOpenCurrent">${existing?'Regenerate':'Generate'} ${stage.key==='featured'?'featured image':'one Pinterest pin'} →</button></div>`;
  }
  const existing=workflowStageDone(project,stage.key);
  return `<div class="workflow-current-card"><div class="eyebrow">STEP ${workflowStepIndex+1} OF ${WORKFLOW_STAGES.length}</div><h3>${esc(stage.title)}</h3><p>${esc(stage.description)}</p>${existing?'<div class="success-box">This stage has been completed and saved in your project. You can reopen it to make changes.</div>':''}</div><div class="workflow-footer-actions"><button class="button button-secondary" id="workflowSkipStage">Skip this stage</button><button class="button button-primary" id="workflowOpenCurrent">${existing?'Open this generator again':'Open '+esc(toolById(stage.tool)?.name||'generator')} →</button></div>`;
}

const AUTOMATED_TEXT_STAGES = [
  {key:'analysis',label:'Analyse the topic and plan article sections'},
  {key:'ideas',label:'Generate each article idea'},
  {key:'imagePrompts',label:'Generate each image prompt and alt text'},
  {key:'article',label:'Write the complete SEO article'},
  {key:'featuredPrompt',label:'Create the featured-image prompt'},
  {key:'pinTitles',label:'Generate four Pinterest titles'},
  {key:'pinDescriptions',label:'Generate four Pinterest descriptions'}
];

function automatedState(project) {
  return project?.data?.automatedTextWorkflow || {
    status:'setup',
    keyword:'',
    pinType:'multi-idea',
    ideaCount:19,
    tone:'Elegant, warm, timeless',
    titleOptions:[],
    stages:{}
  };
}
function saveAutomatedState(projectId, updater) {
  updateProject(projectId,p=>{
    p.data=p.data||{};
    const state=p.data.automatedTextWorkflow || {
      status:'setup',
      keyword:'',
      pinType:'multi-idea',
      ideaCount:19,
      tone:'Elegant, warm, timeless',
      titleOptions:[],
      stages:{}
    };
    updater(state,p);
    p.data.automatedTextWorkflow=state;
  });
}
function normalizeAutomatedIdeaCount(value){
  const n=Number(value);
  return Math.max(1,Math.min(99,Number.isFinite(n)?Math.floor(n):19));
}
function automatedIdeaKey(value){
  return String(value||'').toLowerCase().replace(/[^a-z0-9\s]/g,' ').replace(/\s+/g,' ').trim();
}
function mergeAutomatedPlanIdeas(baseIdeas, additions, limit=99){
  const merged=[];
  const seen=new Set();
  for(const item of [...(baseIdeas||[]),...(additions||[])]){
    const topic=String(item?.topic||'').trim();
    if(!topic)continue;
    const key=automatedIdeaKey(topic);
    if(!key||seen.has(key))continue;
    seen.add(key);
    merged.push({topic,angle:String(item?.angle||'').trim()});
    if(merged.length>=limit)break;
  }
  return merged;
}
function parseAutomatedPlan(raw, expectedCount=null) {
  const text=String(raw||'').replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'').trim();
  let parsed=null;
  const first=text.indexOf('{'),last=text.lastIndexOf('}');
  if(first>=0&&last>first){
    try{parsed=JSON.parse(text.slice(first,last+1));}catch(_error){}
  }
  let rawIdeas=Array.isArray(parsed?.ideas)?parsed.ideas:[];
  if(!rawIdeas.length){
    rawIdeas=text.split(/\r?\n/).map(line=>line.trim()).filter(line=>/^(?:\d+[.)]|[-*•])\s+/.test(line)).map(line=>line.replace(/^(?:\d+[.)]|[-*•])\s+/,''));
  }
  const ideas=mergeAutomatedPlanIdeas(rawIdeas.map(item=>{
    if(typeof item==='string')return {topic:item.trim(),angle:''};
    return {topic:String(item?.topic||item?.heading||item?.idea||'').trim(),angle:String(item?.angle||item?.description||'').trim()};
  }));
  if(expectedCount!==null){
    if(ideas.length<expectedCount)throw new Error(`The planning response returned ${ideas.length} distinct article ideas, but exactly ${expectedCount} are required.`);
  }else if(ideas.length<5){
    throw new Error('The planning response did not contain enough distinct article ideas. Retry this stage.');
  }
  const related=Array.isArray(parsed?.related_keywords)?parsed.related_keywords.map(x=>String(x).trim()).filter(Boolean):[];
  return {ideas:expectedCount===null?ideas:ideas.slice(0,expectedCount),related_keywords:related.slice(0,12)};
}
function parseSingleAutomatedIdea(raw,topic,angle='') {
  const text=String(raw||'').trim().replace(/^```(?:text|markdown)?\s*/i,'').replace(/\s*```$/,'');
  const ideaMatch=text.match(/IDEA\s*:\s*([\s\S]*?)(?=\n\s*ANGLE\s*:|$)/i);
  const angleMatch=text.match(/ANGLE\s*:\s*([\s\S]*)$/i);
  const heading=(ideaMatch?.[1]||text.split(/\r?\n/).find(line=>line.trim())||topic).trim().replace(/^["']|["']$/g,'');
  return {text:heading,angle:(angleMatch?.[1]||angle||'').trim()};
}
function autoStageStatus(state,key) {
  if(key==='analysis')return state.plan?'completed':state.currentStage===key?'running':'pending';
  if(key==='ideas')return (state.ideas||[]).length>0&&(state.ideas||[]).length===(state.plan?.ideas||[]).length?'completed':state.currentStage===key?'running':'pending';
  if(key==='imagePrompts')return (state.ideas||[]).length>0&&state.ideas.every(item=>item.imagePrompt&&item.altText)?'completed':state.currentStage===key?'running':'pending';
  if(key==='article')return state.articleHtml?'completed':state.currentStage===key?'running':'pending';
  if(key==='featuredPrompt')return state.featuredPrompt?'completed':state.currentStage===key?'running':'pending';
  if(key==='pinTitles')return (state.pinTitles||[]).length===4?'completed':state.currentStage===key?'running':'pending';
  if(key==='pinDescriptions')return state.pinDescriptions?'completed':state.currentStage===key?'running':'pending';
  return 'pending';
}
function renderAutomatedWorkflow(projectId) {
  const project=getProject(projectId);if(!project)return;
  const state=automatedState(project);
  $('#workflowTitle').textContent='Automated Article Creator';
  $('#workflowSubtitle').textContent=project.articleTitle?`Article title: ${project.articleTitle}`:'Enter a keyword, select a title, then let the text-only workflow run automatically.';
  let main='';
  if(state.status==='setup'||state.status==='generating_titles'||(state.status==='error'&&!state.selectedTitle)){
    const savedPinType=state.pinType||project.data?.pinTitles?.inputs?.pin_type||'multi-idea';
    const savedIdeaCount=Number(state.ideaCount||project.data?.pinTitles?.inputs?.idea_count||project.ideaCount||19)||19;
    const savedTone=state.tone||project.data?.pinTitles?.inputs?.tone||'Elegant, warm, timeless';
    main=`<section class="automated-start-panel"><span class="eyebrow">TEXT-ONLY ARTICLE PRODUCTION</span><h3>Start with your focus keyword</h3><p>After you choose a title, all remaining text stages run automatically. No image-generation API requests are made.</p>${state.titleError?`<div class="error-box">${esc(state.titleError)}</div>`:''}<div class="tool-form-grid automated-start-fields"><label class="field field-full"><span>Focus keyword</span><input id="autoKeywordInput" value="${esc(state.keyword||project.keyword||'')}" placeholder="e.g. small bedroom decor"></label><label class="field"><span>Pin type</span><select id="autoPinType"><option value="multi-idea" ${savedPinType==='multi-idea'?'selected':''}>Multi-idea</option><option value="recipe" ${savedPinType==='recipe'?'selected':''}>Recipe</option></select></label><label class="field"><span>Number of ideas in the Pin</span><input id="autoIdeaCount" type="number" min="1" max="99" step="1" value="${esc(savedIdeaCount)}" placeholder="e.g. 19"><small>Used as the number in multi-idea title variations.</small></label><label class="field field-full"><span>Tone / vibe</span><input id="autoTone" value="${esc(savedTone)}" placeholder="e.g. Elegant, warm, timeless"></label></div><div class="automated-start-actions"><button class="button button-primary" id="autoGenerateTitles" ${state.status==='generating_titles'?'disabled':''}>${state.status==='generating_titles'?'Generating titles…':'Generate title options →'}</button></div></section>`;
  } else if(state.status==='select_title'){
    const options=state.titleOptions||[];
    main=`<section class="automated-start-panel"><span class="eyebrow">SELECT YOUR BLOG TITLE</span><h3>Choose one title to start automatic production</h3><p>Select a title below. The complete text-only production will start automatically and continue through Pinterest descriptions.</p><div class="title-choice-list">${options.map((item,i)=>`<label class="title-choice"><input type="radio" name="automatedArticleTitle" value="${esc(item.text)}"><span><b>${esc(item.text)}</b><small>${item.count?`${item.count} characters`:`Title option ${i+1}`}</small></span></label>`).join('')}</div><div class="automated-start-actions"><button class="button button-secondary" id="autoBackToKeyword">Change keyword</button></div><div class="muted-note">No image-generation API is used in this workflow.</div></section>`;
  } else {
    const completed=AUTO_STAGE_COUNT(state);
    const total=AUTOMATED_TEXT_STAGES.length;
    const pct=Math.round(completed/total*100);
    const rows=AUTOMATED_TEXT_STAGES.map((stage,i)=>{
      const status=autoStageStatus(state,stage.key);
      const label=status==='completed'?'Completed':status==='running'?'In progress':'Waiting';
      return `<div class="automated-stage-row ${status}"><span class="automated-stage-number">${status==='completed'?'✓':String(i+1).padStart(2,'0')}</span><div class="automated-stage-copy"><strong>${esc(stage.label)}</strong><small>${label}${state.currentStage===stage.key&&state.currentDetail?` · ${esc(state.currentDetail)}`:''}</small></div><span class="automated-stage-status">${label}</span></div>`;
    }).join('');
    const error=state.status==='error'?`<div class="error-box"><strong>Workflow paused</strong><br>${esc(state.error||'A stage could not be completed.')}<br>Completed outputs are saved. Resume to continue from the unfinished stage.</div><button class="button button-primary" id="autoResumeProduction">Resume workflow →</button>`:'';
    const batchReady=getProjectPinPairs(project).length===4;
    const complete=state.status==='completed'?`<div class="success-box"><strong>All text content is ready.</strong><br>No image-generation API was used. Review and download each text output below.</div>${renderWorkflowExportCenter(project)}${batchReady?'<div class="workflow-footer-actions"><button class="button button-secondary" id="autoGenerateAllPins">Generate all 4 Pinterest pins (optional)</button></div>':''}`:'';
    const running=state.status==='running'?`<div class="notice notice-cost">Automatically processing text stages. You can close this window; completed stages are saved as they finish. No image-generation requests are made.</div>`:'';
    main=`<section class="automated-progress-panel"><div class="automated-progress-heading"><div><span class="eyebrow">AUTOMATED TEXT WORKFLOW</span><h3>${esc(state.selectedTitle||project.articleTitle)}</h3><p>Keyword: ${esc(state.keyword||project.keyword||'')}</p></div><span class="tag">${completed}/${total} stages</span></div><div class="workflow-progress"><span style="width:${pct}%"></span></div><div class="automated-stage-list">${rows}</div>${running}${error}${complete}</section>`;
  }
  $('#workflowBody').innerHTML=`<div class="workflow-summary"><span class="tag">Text-only workflow</span><span class="tag">${project.ideas?.length||0} ideas</span><span class="tag">${project.imageAssets?.length||0} saved images</span><span class="tag">${esc(state.status||'setup')}</span></div>${main}<div class="modal-actions"><div class="modal-actions-left"><button class="button button-secondary button-small" id="exportThisProject">Export project</button></div><div class="modal-actions-right"><button class="button button-secondary button-small" id="exportThisArticle" ${project.data?.article?.result?'':'disabled'}>Export article HTML</button></div></div><div id="workflowBatchResults"></div><div id="workflowAssetGallery"></div>`;
  $('#autoGenerateTitles')?.addEventListener('click',()=>generateAutomatedTitleOptions(projectId));
  $$('input[name="automatedArticleTitle"]').forEach(input=>input.addEventListener('change',()=>{
    if(!input.checked)return;
    const selectedTitle=input.value;
    saveAutomatedState(projectId,(s,p)=>{
      s.selectedTitle=selectedTitle;s.status='running';s.currentStage='analysis';s.error='';s.titleError='';
      s.plan=null;s.ideas=[];s.articleHtml='';s.metaDescription='';s.featuredPrompt='';
      s.pinTitles=[];s.pinTitlesResult='';s.pinDescriptions='';s.pinDescriptionItems=[];
      s.stages={};
      p.articleTitle=selectedTitle;p.keyword=s.keyword;p.ideaCount=Number(s.ideaCount)||19;
      p.ideas=[];
      p.data.article=null;
    });
    runAutomatedTextWorkflow(projectId);
  }));
  $('#autoBackToKeyword')?.addEventListener('click',()=>{saveAutomatedState(projectId,s=>{s.status='setup';s.titleOptions=[];});renderWorkflow(projectId);});
  $('#autoResumeProduction')?.addEventListener('click',()=>runAutomatedTextWorkflow(projectId));
  $('#autoGenerateAllPins')?.addEventListener('click',()=>generatePinterestBatchFromProject(projectId));
  $('#exportThisProject')?.addEventListener('click',()=>exportProject(project.id));
  $('#exportThisArticle')?.addEventListener('click',()=>exportArticle(project.id));
  $('#exportCompleteArticleHtml')?.addEventListener('click',()=>exportArticle(project.id));
  $('#exportCompleteProjectJson')?.addEventListener('click',()=>exportProject(project.id));
  $$('[data-export-text]').forEach(button=>button.addEventListener('click',()=>exportWorkflowText(project.id,button.dataset.exportText)));
  renderWorkflowGallery(project.id);
  if(state.status==='running'&&!automatedWorkflowRuns.has(projectId)) {
    Promise.resolve().then(()=>runAutomatedTextWorkflow(projectId));
  }
}
function AUTO_STAGE_COUNT(state) {
  return AUTOMATED_TEXT_STAGES.filter(stage=>autoStageStatus(state,stage.key)==='completed').length;
}
async function generateAutomatedTitleOptions(projectId) {
  const keyword=$('#autoKeywordInput')?.value.trim()||'';
  if(!keyword){toast('Enter a focus keyword first.');return;}
  const pinType=$('#autoPinType')?.value||'multi-idea';
  const parsedIdeaCount=parseInt($('#autoIdeaCount')?.value,10);
  const ideaCount=Math.max(1,Math.min(99,Number.isFinite(parsedIdeaCount)?parsedIdeaCount:19));
  const tone=$('#autoTone')?.value.trim()||'Elegant, warm, timeless';
  saveAutomatedState(projectId,(s,p)=>{
    s.keyword=keyword;
    s.pinType=pinType;
    s.ideaCount=ideaCount;
    s.tone=tone;
    s.status='generating_titles';
    s.error='';
    s.titleError='';
    p.keyword=keyword;
  });
  renderWorkflow(projectId);
  try{
    const fields={pin_type:pinType,focus_keyword:keyword,idea_count:String(ideaCount),tone};
    const result=await requestText(buildPrompt('pinTitles',fields),9000);
    let options=parseTitleOptions(result.text);
    if(options.length<2){
      options=String(result.text).split(/\r?\n/).map(line=>line.trim()).filter(Boolean).map(line=>({text:line.replace(/^\d+[.)]\s*/,''),count:''})).filter(item=>item.text).slice(0,4);
    }
    if(!options.length)throw new Error('The text model did not return usable title options. Retry title generation.');
    saveAutomatedState(projectId,(s,p)=>{s.titleOptions=options.slice(0,4);s.status='select_title';s.titleModel=result.model;s.titleResult=result.text;p.keyword=keyword;p.data.pinTitles={...(p.data.pinTitles||{}),inputs:fields,result:result.text,titles:parseTitleOptions(result.text),updatedAt:Date.now()};});
    renderWorkflow(projectId);
  }catch(error){
    saveAutomatedState(projectId,s=>{s.status='setup';s.titleError=error.message;s.currentStage='';});
    renderWorkflow(projectId);
  }
}
async function runAutomatedTextWorkflow(projectId) {
  if(automatedWorkflowRuns.has(projectId))return;
  const initial=getProject(projectId);if(!initial)return;
  const initialState=automatedState(initial);
  if(!initialState.selectedTitle){toast('Select a blog title before starting.');return;}
  automatedWorkflowRuns.add(projectId);
  const updateStage=(key,detail='')=>{
    saveAutomatedState(projectId,(s)=>{s.status='running';s.currentStage=key;s.currentDetail=detail;s.error='';s.stages=s.stages||{};s.stages[key]='running';});
    renderWorkflow(projectId);
  };
  const completeStage=(key)=>{
    saveAutomatedState(projectId,s=>{s.stages=s.stages||{};s.stages[key]='completed';s.currentDetail='';});
    renderWorkflow(projectId);
  };
  try{
    let project=getProject(projectId),state=automatedState(project);
    const title=state.selectedTitle,keyword=state.keyword||project.keyword;
    if(!state.plan){
      const requestedIdeaCount=normalizeAutomatedIdeaCount(state.ideaCount);
      updateStage('analysis',`Planning exactly ${requestedIdeaCount} distinct article ideas`);
      const planningPrompt=fillTemplate(prompts.automatedPlan||DEFAULT_PROMPTS.automatedPlan,{title,keyword,idea_count:String(requestedIdeaCount)});
      let result=await requestText(planningPrompt,9000);
      let firstPlan=parseAutomatedPlan(result.text,null);
      let combinedIdeas=mergeAutomatedPlanIdeas([],firstPlan.ideas,requestedIdeaCount);
      let relatedKeywords=firstPlan.related_keywords||[];
      let planningOutputs=[result.text];
      let planningModel=result.model;
      let repairAttempt=0;
      while(combinedIdeas.length<requestedIdeaCount && repairAttempt<3){
        const remaining=requestedIdeaCount-combinedIdeas.length;
        repairAttempt++;
        updateStage('analysis',`Planning ideas ${combinedIdeas.length+1}–${requestedIdeaCount} (${remaining} remaining)`);
        const repairPrompt=fillTemplate(prompts.automatedPlanRepair||DEFAULT_PROMPTS.automatedPlanRepair,{
          title,
          keyword,
          total_idea_count:String(requestedIdeaCount),
          existing_idea_count:String(combinedIdeas.length),
          remaining_count:String(remaining),
          existing_ideas:combinedIdeas.map((item,i)=>`${i+1}. ${item.topic}`).join('\n')||'None yet'
        });
        const repairResult=await requestText(repairPrompt,9000);
        const repairPlan=parseAutomatedPlan(repairResult.text,null);
        const before=combinedIdeas.length;
        combinedIdeas=mergeAutomatedPlanIdeas(combinedIdeas,repairPlan.ideas,requestedIdeaCount);
        relatedKeywords=[...new Set([...relatedKeywords,...(repairPlan.related_keywords||[])])].slice(0,12);
        planningOutputs.push(repairResult.text);
        planningModel=repairResult.model||planningModel;
        if(combinedIdeas.length===before){
          throw new Error(`The planning model could not add the remaining ${remaining} distinct article ideas. Resume the workflow to retry.`);
        }
      }
      if(combinedIdeas.length<requestedIdeaCount){
        throw new Error(`The planning stage produced ${combinedIdeas.length} of ${requestedIdeaCount} required article ideas. Resume the workflow to retry.`);
      }
      const plan={ideas:combinedIdeas.slice(0,requestedIdeaCount),related_keywords:relatedKeywords};
      const combinedPlanResult=planningOutputs.join('\n\n--- PLANNING CONTINUATION ---\n\n');
      saveAutomatedState(projectId,(s,p)=>{
        s.plan=plan;
        s.planResult=combinedPlanResult;
        s.planModel=planningModel;
        s.ideaTopics=plan.ideas;
        s.ideaCount=requestedIdeaCount;
        p.ideaCount=requestedIdeaCount;
      });
      completeStage('analysis');
    }
    project=getProject(projectId);state=automatedState(project);
    const topics=state.plan.ideas||[];
    if((state.ideas||[]).length<topics.length){
      for(let i=0;i<topics.length;i++){
        project=getProject(projectId);state=automatedState(project);
        if(state.ideas?.[i]?.text)continue;
        const topic=topics[i];
        updateStage('ideas',`Idea ${i+1} of ${topics.length}`);
        const previous=(state.ideas||[]).map(item=>item.text).join('\n');
        const ideaPrompt=fillTemplate(prompts.automatedIdea||DEFAULT_PROMPTS.automatedIdea,{title,keyword,topic:topic.topic,angle:topic.angle,previous_ideas:previous||'None yet'});
        const result=await requestText(ideaPrompt,1800);
        const parsed=parseSingleAutomatedIdea(result.text,topic.topic,topic.angle);
        saveAutomatedState(projectId,(s,p)=>{
          s.ideas=s.ideas||[];
          s.ideas[i]={id:s.ideas[i]?.id||`auto_idea_${i+1}`,text:parsed.text,angle:parsed.angle,imagePrompt:'',altText:'',imageAssetId:''};
          p.ideas=structuredClone(s.ideas);
          p.ideaCount=topics.length;
        });
        renderWorkflow(projectId);
      }
      completeStage('ideas');
    }
    project=getProject(projectId);state=automatedState(project);
    for(let i=0;i<(state.ideas||[]).length;i++){
      project=getProject(projectId);state=automatedState(project);
      const idea=state.ideas[i];
      if(idea.imagePrompt&&idea.altText)continue;
      updateStage('imagePrompts',`Idea ${i+1} of ${state.ideas.length}`);
      const generated=await generateImagePromptForIdea(title,`${idea.text}${idea.angle?`: ${idea.angle}`:''}`);
      saveAutomatedState(projectId,(s,p)=>{
        s.ideas[i].imagePrompt=generated.imagePrompt;
        s.ideas[i].altText=generated.altText||fallbackAltText(s.ideas[i].text);
        p.ideas=structuredClone(s.ideas);
      });
      renderWorkflow(projectId);
    }
    completeStage('imagePrompts');
    project=getProject(projectId);state=automatedState(project);
    if(!state.articleHtml){
      updateStage('article','Writing the full article using all approved text inputs');
      const ideaList=state.ideas.map((idea,i)=>`${i+1}. ${idea.text}${idea.angle?`: ${idea.angle}`:''}`).join('\n');
      const altTexts=state.ideas.map(idea=>idea.altText||fallbackAltText(idea.text)).join('\n');
      const fields={title,focus_keyword:keyword,keywords:(state.plan.related_keywords||[]).join(', '),count:String(state.ideas.length),alt_texts:altTexts,internal_links:'',ideas:ideaList};
      const articlePrompt=buildPrompt('article',fields);
      const result=await requestText(articlePrompt,24000);
      const normalized=normalizeArticleResult(result.text);
      saveAutomatedState(projectId,(s,p)=>{
        s.articleHtml=normalized.bodyHtml;s.metaDescription=normalized.metaDescription;s.articleModel=result.model;
        p.data.article={inputs:fields,prompt:articlePrompt,result:normalized.bodyHtml,metaDescription:normalized.metaDescription,updatedAt:Date.now()};
        p.articleTitle=title;
      });
      renderWorkflow(projectId);
    }
    completeStage('article');
    project=getProject(projectId);state=automatedState(project);
    if(!state.featuredPrompt){
      updateStage('featuredPrompt','Creating a text-only featured-image prompt');
      const articleText=htmlToPlainText(state.articleHtml||project.data?.article?.result||'');
      const fields={title,focus_keyword:keyword,article:articleText,style:'Elegant editorial home-decor photography'};
      const prompt=buildPrompt('featuredPrompt',fields);
      const result=await requestText(prompt,5000);
      saveAutomatedState(projectId,(s,p)=>{
        s.featuredPrompt=result.text;s.featuredPromptModel=result.model;
        p.data.featuredPromptOnly={inputs:fields,prompt,result:result.text,updatedAt:Date.now()};
      });
      renderWorkflow(projectId);
    }
    completeStage('featuredPrompt');
    project=getProject(projectId);state=automatedState(project);
    if(!state.pinTitles||state.pinTitles.length!==4){
      updateStage('pinTitles','Creating four Pinterest title variations');
      const fields={pin_type:'multi-idea',focus_keyword:keyword,idea_count:String(state.ideas.length),tone:'Pinterest-optimized, editorial, varied'};
      const prompt=buildPrompt('pinTitles',fields)+`\n\nUse this selected blog article title as additional context: ${title}\nCreate four distinct pin titles for this article, not alternative blog titles.`;
      const result=await requestText(prompt,9000);
      const titles=parseTitleOptions(result.text);
      if(titles.length!==4)throw new Error('Pinterest title generation did not return exactly four usable titles. Resume to retry this stage.');
      saveAutomatedState(projectId,(s,p)=>{s.pinTitles=titles;s.pinTitlesResult=result.text;s.pinTitlesModel=result.model;p.data.automatedTextWorkflow=s;});
      renderWorkflow(projectId);
    }
    completeStage('pinTitles');
    project=getProject(projectId);state=automatedState(project);
    if(!state.pinDescriptions){
      updateStage('pinDescriptions','Writing four descriptions in the same title order');
      const titlesText=state.pinTitles.map((item,i)=>`${i+1}. ${item.text}`).join('\n');
      const prompt=buildPrompt('pinDescriptions',{titles:titlesText});
      const result=await requestText(prompt,9000);
      const descriptions=parsePinterestDescriptions(result.text);
      if(descriptions.length!==4)throw new Error('Pinterest description generation did not return exactly four descriptions. Resume to retry this stage.');
      saveAutomatedState(projectId,(s,p)=>{s.pinDescriptions=result.text;s.pinDescriptionItems=descriptions;s.pinDescriptionsModel=result.model;});
      renderWorkflow(projectId);
    }
    saveAutomatedState(projectId,s=>{s.status='completed';s.currentStage='';s.currentDetail='';s.completedAt=Date.now();s.error='';});
    renderWorkflow(projectId);
    toast('Automated text-only article workflow completed. No image API calls were made.');
  }catch(error){
    saveAutomatedState(projectId,s=>{s.status='error';s.error=error.message||'The workflow stopped unexpectedly.';});
    renderWorkflow(projectId);
    toast('Automated workflow paused. Your completed stages have been saved.');
  }finally{
    automatedWorkflowRuns.delete(projectId);
  }
}
async function createAutomatedArticleWorkflow() {
  const name=prompt('Name your automated article project:','New automated blog article');
  if(name===null)return;
  const project=createProject(name||'New automated blog article');
  project.data.automatedTextWorkflow={status:'setup',keyword:'',titleOptions:[],stages:{}};
  saveLocal();
  workflowMode='automated';workflowProjectId=project.id;
  openWorkflow(project.id);
  renderDashboard();
}
function renderWorkflow(projectId=workflowProjectId) {
  if(workflowMode==='automated'){renderAutomatedWorkflow(projectId);return;}
  const project=getProject(projectId);if(!project)return;
  $('#workflowTitle').textContent=project.name;
  $('#workflowSubtitle').textContent=project.articleTitle?`Article title: ${project.articleTitle}`:'Your content project, guided from title selection to Pinterest graphics.';
  const completed=WORKFLOW_STAGES.filter(stage=>workflowStageDone(project,stage.key)||(project.workflowSkipped||{})[stage.key]).length;
  const progress=Math.round(completed/WORKFLOW_STAGES.length*100);
  const stepper=WORKFLOW_STAGES.map((stage,i)=>{
    const done=workflowStageDone(project,stage.key);
    const skipped=!!(project.workflowSkipped||{})[stage.key];
    const active=i===workflowStepIndex;
    const disabled=i>firstIncompleteWorkflowStep(project)&&!done;
    return `<button type="button" class="${active?'active ':''}${done||skipped?'done':''}" data-workflow-jump="${i}" ${disabled?'disabled':''}><b>${done?'✓':skipped?'–':String(i+1).padStart(2,'0')}</b><br>${esc(stage.short)}</button>`;
  }).join('');
  let main='';
  if(workflowStepIndex>=WORKFLOW_STAGES.length) {
    main=`<div class="workflow-complete"><div class="workflow-stage-icon" style="margin:0 auto">✓</div><h3>Your content project is complete!</h3><p>Your generated content is ready. Download each text section separately, export the article HTML, and download your saved images below.</p></div>${renderWorkflowExportCenter(project)}`;
  } else {
    const stage=WORKFLOW_STAGES[workflowStepIndex];
    main=`<div class="workflow-current-card"><div class="eyebrow">STEP ${workflowStepIndex+1} OF ${WORKFLOW_STAGES.length}</div><h3>${esc(stage.title)}</h3><p>${esc(stage.description)}</p><div class="workflow-summary" style="margin-top:12px"><span class="tag">${project.keyword?`Keyword: ${esc(project.keyword)}`:'Keyword not set'}</span><span class="tag">${project.ideas?.length||0} ideas</span><span class="tag">${project.imageAssets?.length||0} saved images</span></div></div>${workflowStageAction(stage,project)}<div class="workflow-footer-actions"><button class="button button-secondary button-small" id="workflowBack" ${workflowStepIndex===0?'disabled':''}>← Previous step</button>${workflowStageDone(project,stage.key)&&stage.key!=='imageGenerator'?`<button class="button button-primary" id="workflowContinue">Continue to next step →</button>`:''}</div>`;
  }
  $('#workflowBody').innerHTML=`<div class="workflow-summary"><span class="tag">${project.keyword?`Keyword: ${esc(project.keyword)}`:'Keyword not set'}</span><span class="tag">${project.ideas?.length||0} ideas</span><span class="tag">${project.imageAssets?.length||0} saved images</span><span class="tag">${completed}/${WORKFLOW_STAGES.length} complete</span></div><div class="workflow-progress"><span style="width:${progress}%"></span></div><div class="workflow-stepper">${stepper}</div>${main}<div class="modal-actions"><div class="modal-actions-left"><button class="button button-secondary button-small" id="exportThisProject">Export project</button></div><div class="modal-actions-right"><button class="button button-secondary button-small" id="exportThisArticle" ${project.data?.article?.result?'':'disabled'}>Export article HTML</button></div></div><div id="workflowBatchResults"></div><div id="workflowAssetGallery"></div>`;
  $$('[data-workflow-jump]').forEach(button=>button.addEventListener('click',()=>{workflowStepIndex=Number(button.dataset.workflowJump);renderWorkflow(project.id);}));
  $('#workflowOpenCurrent')?.addEventListener('click',()=>launchWorkflowStage(project.id,WORKFLOW_STAGES[workflowStepIndex]));
  $('#workflowGenerateAllPins')?.addEventListener('click',()=>generatePinterestBatchFromProject(project.id));
  $('#workflowOpenNextPrompt')?.addEventListener('click',()=>launchNextWorkflowIdea(project.id,'imagePrompt'));
  $('#workflowRunAllPrompts')?.addEventListener('click',()=>runImagePromptSequence(project.id));
  $('#workflowOpenNextImage')?.addEventListener('click',()=>launchNextWorkflowIdea(project.id,'imageGenerator'));
  $$('[data-workflow-idea-prompt]').forEach(button=>button.addEventListener('click',()=>{const idea=project.ideas[Number(button.dataset.workflowIdeaPrompt)];if(idea)openTool('imagePrompt',project.id,{title:project.articleTitle,idea:idea.text});}));
  $$('[data-workflow-idea-image]').forEach(button=>button.addEventListener('click',()=>{const idea=project.ideas[Number(button.dataset.workflowIdeaImage)];if(idea?.imagePrompt)openTool('imageGenerator',project.id,{prompt:idea.imagePrompt,idea:idea.text});}));
  $('#workflowContinueImages')?.addEventListener('click',()=>{
    const allDone=(project.ideas||[]).length>0&&(project.ideas||[]).every(idea=>!!idea.imageAssetId);
    updateProject(project.id,p=>{p.workflowSkipped=p.workflowSkipped||{};if(!allDone)p.workflowSkipped.imageGenerator=true;else delete p.workflowSkipped.imageGenerator;});
    workflowStepIndex=firstIncompleteWorkflowStep(getProject(project.id));renderWorkflow(project.id);
  });
  $('#workflowSkipStage')?.addEventListener('click',()=>{updateProject(project.id,p=>{p.workflowSkipped=p.workflowSkipped||{};p.workflowSkipped[WORKFLOW_STAGES[workflowStepIndex].key]=true;});workflowStepIndex=firstIncompleteWorkflowStep(getProject(project.id));renderWorkflow(project.id);});
  $$('[data-export-text]').forEach(button=>button.addEventListener('click',()=>exportWorkflowText(project.id,button.dataset.exportText)));
  $('#workflowBack')?.addEventListener('click',()=>{workflowStepIndex=Math.max(0,workflowStepIndex-1);renderWorkflow(project.id);});
  $('#workflowContinue')?.addEventListener('click',()=>{workflowStepIndex=Math.min(WORKFLOW_STAGES.length,workflowStepIndex+1);renderWorkflow(project.id);});
  $('#exportThisProject').onclick=()=>exportProject(project.id);
  $('#exportThisArticle').onclick=()=>exportArticle(project.id);
  $('#exportCompleteArticleHtml')?.addEventListener('click',()=>exportArticle(project.id));
  $('#exportCompleteProjectJson')?.addEventListener('click',()=>exportProject(project.id));
  $$('[data-export-text]').forEach(button=>button.addEventListener('click',()=>exportWorkflowText(project.id,button.dataset.exportText)));
  renderWorkflowGallery(project.id);
}
function launchNextWorkflowIdea(projectId,kind) {
  const project=getProject(projectId);if(!project)return;
  if(kind==='imagePrompt'){
    const idea=project.ideas.find(item=>!item.imagePrompt);
    if(idea)openTool('imagePrompt',project.id,{title:project.articleTitle,idea:idea.text});
  } else {
    const idea=project.ideas.find(item=>!item.imageAssetId&&item.imagePrompt);
    if(idea)openTool('imageGenerator',project.id,{prompt:idea.imagePrompt,idea:idea.text});
  }
}
function launchWorkflowStage(projectId,stage) {
  const project=getProject(projectId);if(!project||!stage)return;
  if(stage.key==='imagePrompt')return runImagePromptSequence(projectId);
  if(stage.key==='imageGenerator')return launchNextWorkflowIdea(projectId,'imageGenerator');
  const prefill={};
  if(stage.key==='ideas')prefill.title=project.articleTitle;
  if(stage.key==='featured')prefill.title=project.articleTitle;
  if(stage.key==='pinDescriptions')prefill.titles=(project.data?.pinTitles?.titles||[]).map(item=>item.text).join('\n');
  if(stage.key==='pinterestPin'){
    prefill.title=project.data?.pinTitles?.selectedTitle||project.articleTitle;
    prefill.context=project.articleTitle;
  }
  openTool(stage.tool,project.id,prefill);
}
async function handleWorkflowOutputSaved(projectId,output) {
  const project=getProject(projectId);if(!project||!$('#workflowModal').classList.contains('show'))return;
  const id=output.toolId;
  if(id==='pinTitles') { workflowStepIndex=0;renderWorkflow(projectId);return; }
  closeTool();
  if(id==='ideas') { workflowStepIndex=2;renderWorkflow(projectId);runImagePromptSequence(projectId);return; }
  if(id==='imagePrompt') {
    workflowStepIndex=2;
    renderWorkflow(projectId);
    runImagePromptSequence(projectId);
    return;
  }
  if(id==='imageGenerator') {
    workflowStepIndex=3;
    renderWorkflow(projectId);
    return;
  }
  const nextByTool={article:5,featured:6,pinDescriptions:7,pinterestPin:8};
  if(Object.prototype.hasOwnProperty.call(nextByTool,id)){
    workflowStepIndex=nextByTool[id];renderWorkflow(projectId);
    if(id==='article')openTool('featured',projectId,{title:project.articleTitle});
    else if(id==='featured')openTool('pinDescriptions',projectId,{titles:(project.data?.pinTitles?.titles||[]).map(item=>item.text).join('\n')});
    else if(id==='pinDescriptions')openTool('pinterestPin',projectId,{title:project.data?.pinTitles?.selectedTitle||project.articleTitle,context:project.articleTitle});
    return;
  }
  renderWorkflow(projectId);
}

function getWorkflowTextExports(project) {
  const data=project.data||{};
  const auto=data.automatedTextWorkflow||{};
  const exports=[];
  const add=(key,name,content)=>{const value=String(content||'').trim();if(value)exports.push({key,name,content:value});};
  const ideas=auto.ideas?.length?auto.ideas:(project.ideas||[]);
  const pinTitleText=auto.pinTitlesResult||data.pinTitles?.result||auto.pinTitles?.map((item,i)=>`${i+1}. ${item.text||item}`).join('\n');
  const pinDescriptionText=auto.pinDescriptions||data.pinDescriptions?.result;
  const featuredPromptText=auto.featuredPrompt||data.featuredPromptOnly?.result||data.featured?.result;
  add('blogTitle','Blog title.txt',project.articleTitle);
  add('keyword','Focus keyword.txt',project.keyword);
  add('articlePlan','Article plan and related keywords.txt',auto.plan?`ARTICLE IDEAS PLAN\n${(auto.plan.ideas||[]).map((item,i)=>`${i+1}. ${item.topic}${item.angle?`: ${item.angle}`:''}`).join('\n')}\n\nRELATED KEYWORDS\n${(auto.plan.related_keywords||[]).join('\n')}`:'');
  add('pinTitles','Pinterest titles.txt',pinTitleText);
  add('ideas','Article ideas.txt',data.ideas?.result||(ideas||[]).map((idea,i)=>`${i+1}. ${idea.text}${idea.angle?`: ${idea.angle}`:''}`).join('\n'));
  add('imagePrompts','Image prompts.txt',(ideas||[]).map((idea,i)=>`${i+1}. ${idea.text}\nImage prompt: ${idea.imagePrompt||'Not generated'}`).join('\n\n'));
  add('imageAltTexts','Image alt texts.txt',(ideas||[]).map((idea,i)=>`${i+1}. ${idea.text}\nAlt text: ${idea.altText||fallbackAltText(idea.text)}`).join('\n\n'));
  add('article','Complete article.txt',data.article?.result?htmlToPlainText(data.article.result):'');
  add('metaDescription','Meta description.txt',data.article?.metaDescription||auto.metaDescription);
  add('featuredPrompt','Featured image prompt.txt',featuredPromptText);
  add('pinDescriptions','Pinterest descriptions.txt',pinDescriptionText);
  add('pinPrompt','Pinterest pin background prompt.txt',data.pinterestPin?.prompt);
  return exports;
}
function renderWorkflowExportCenter(project) {
  const items=getWorkflowTextExports(project);
  if(!items.length)return '<div class="export-center"><h3>Download your content</h3><p>No text outputs have been saved yet.</p></div>';
  return `<section class="export-center"><div class="export-center-heading"><div><span class="eyebrow">YOUR CONTENT FILES</span><h3>Download each part separately</h3><p>Each item downloads as a plain .txt file. The article HTML and images are available separately below.</p></div><span class="tag">${items.length} text files</span></div><div class="export-file-grid">${items.map(item=>`<div class="export-file-row"><span class="export-file-icon">TXT</span><div class="export-file-copy"><strong>${esc(item.name)}</strong><small>Plain text file</small></div><button class="button button-secondary button-small" data-export-text="${esc(item.key)}">Download TXT</button></div>`).join('')}</div><div class="export-extra-actions"><button class="button button-secondary button-small" id="exportCompleteArticleHtml" ${project.data?.article?.result?'':'disabled'}>Download article HTML</button><button class="button button-secondary button-small" id="exportCompleteProjectJson">Download project JSON</button></div></section>`;
}
function exportWorkflowText(projectId,key) {
  const project=getProject(projectId);if(!project)return;
  const item=getWorkflowTextExports(project).find(entry=>entry.key===key);if(!item){toast('This text output is not available yet.');return;}
  downloadFile(`${slug(item.name.replace(/\.txt$/,''))}.txt`,item.content,'text/plain;charset=utf-8');
}

async function renderWorkflowGallery(projectId) {
  const project=getProject(projectId);const target=$('#workflowAssetGallery');if(!project||!target)return;
  const assets=project.imageAssets||[];if(!assets.length){target.innerHTML='';return;}
  const loaded=await Promise.all(assets.map(async asset=>({asset,data:await getAsset(asset.id)})));
  if(!$('#workflowAssetGallery'))return;
  target.innerHTML=`<div class="divider-line"></div><strong class="result-subheading">Saved images (${assets.length})</strong><div class="saved-image-grid">${loaded.map(({asset,data})=>`<div class="saved-image-card"><div class="saved-image-preview">${data?`<img src="${data}" alt="${esc(asset.altText||asset.name)}">`:'<span>Image unavailable</span>'}</div><div class="saved-image-info"><strong>${esc(asset.name)}</strong><small>${esc(asset.altText||'No alt text')}</small><button class="button button-secondary button-small" data-download-asset="${esc(asset.id)}" ${data?'':'disabled'}>↓ Download image</button></div></div>`).join('')}</div>`;
  $$('[data-download-asset]',target).forEach(button=>button.addEventListener('click',async()=>{const asset=assets.find(item=>item.id===button.dataset.downloadAsset);if(!asset)return;const data=await getAsset(asset.id);if(data)downloadDataUrl(data,`${slug(asset.name)}.${dataUrlExtension(data)}`);else toast('Image file is not available in local storage.');}));
}

function exportArticle(projectId) {
  const project=getProject(projectId);const html=project?.data?.article?.result;if(!html){toast('No article has been generated yet.');return;}
  const meta=project?.data?.article?.metaDescription||'';
  downloadFile(`${slug(project.articleTitle||project.name)}.html`,wrapArticleHtml(html,project.articleTitle||project.name,meta),'text/html');
}
async function exportProject(projectId) {
  const project=getProject(projectId);if(!project)return;const copy=structuredClone(project);
  for(const asset of copy.imageAssets||[])asset.dataUrl=await getAsset(asset.id);
  downloadFile(`${slug(project.name)}-project.json`,JSON.stringify(copy,null,2),'application/json');
}
async function exportBackup() {
  const copies=structuredClone(projects);for(const project of copies){for(const asset of project.imageAssets||[])asset.dataUrl=await getAsset(asset.id);}
  downloadFile(`pintools-session-backup-${new Date().toISOString().slice(0,10)}.json`,JSON.stringify({app:'PinTools',version:'1.5.0',exportedAt:new Date().toISOString(),projects:copies,prompts},null,2),'application/json');toast('Session backup exported');
}
function importBackup(file) {
  const reader=new FileReader();reader.onload=async()=>{try{const backup=JSON.parse(reader.result);if(!Array.isArray(backup.projects))throw new Error('Invalid backup');if(!confirm('Import this session backup? It will replace the projects currently held in this tab session.'))return;for(const project of backup.projects){for(const asset of project.imageAssets||[]){if(asset.dataUrl){await putAsset(asset.id,asset.dataUrl);delete asset.dataUrl;}}}projects=backup.projects;prompts=structuredClone(DEFAULT_PROMPTS);saveLocal();renderDashboard();renderProjects();toast('Session backup imported');}catch(error){toast('Could not import this backup file');}};reader.readAsText(file);
}
async function clearWorkspace() { return endSessionAndClear(); }

function renderThemeChoices(){ $('#lightThemeChoice')?.classList.toggle('active',theme==='light');$('#darkThemeChoice')?.classList.toggle('active',theme==='dark'); }
async function initialize() {
  await ensureUniqueTabSession();
  try { const response=await fetch('./prompts.json');const data=await response.json();DEFAULT_PROMPTS=data.templates||{}; }
  catch(error) { DEFAULT_PROMPTS={}; console.error('Could not load prompt templates',error); }
  prompts=structuredClone(DEFAULT_PROMPTS);
  projects=loadJSON('ld_projects', []);
  theme=loadJSON('ld_theme', 'light');
  prompts=structuredClone(DEFAULT_PROMPTS);
  await cleanupExpiredSessions();
  await touchSession();
  setInterval(touchSession, 30000);
  window.addEventListener('pagehide',()=>{markSessionClosing();sessionChannel?.close();});
  setTheme(theme);renderThemeChoices();renderDashboard();
  await refreshApiStatus();
  if (tabSessionForked) toast('Separate tab detected. A fresh private session was started for this tab.');
  const privacyNotice=$('#privacyNotice');
  if(privacyNotice && sessionStorage.getItem(sessionKey('privacy_notice_dismissed'))==='yes') privacyNotice.hidden=true;
  $('#dismissPrivacyNotice')?.addEventListener('click',()=>{privacyNotice.hidden=true;sessionStorage.setItem(sessionKey('privacy_notice_dismissed'),'yes');});
  $('#toolSearch').addEventListener('input',renderDashboard);
  $('#filterRow').addEventListener('click',event=>{const button=event.target.closest('[data-filter]');if(!button)return;activeFilter=button.dataset.filter;$$('.filter-chip').forEach(chip=>chip.classList.toggle('active',chip===button));renderDashboard();});
  $$('.nav-btn').forEach(button=>button.addEventListener('click',()=>switchView(button.dataset.view)));
  $('#themeToggle').addEventListener('click',()=>{setTheme(theme==='dark'?'light':'dark');renderThemeChoices();});
  $('#lightThemeChoice').addEventListener('click',()=>setTheme('light'));
  $('#darkThemeChoice').addEventListener('click',()=>setTheme('dark'));
  $('#newProjectButton').addEventListener('click',createNewProject);$('#newProjectButton2').addEventListener('click',createNewProject);
  $('#projectsShortcut').addEventListener('click',()=>switchView('projects'));$('#viewAllProjects').addEventListener('click',()=>switchView('projects'));
  $('#startWorkflowButton').addEventListener('click',createNewProject);$('#startAutomatedWorkflowButton').addEventListener('click',createAutomatedArticleWorkflow);
  $('#closeToolModal').addEventListener('click',closeTool);$('#closeWorkflowModal').addEventListener('click',closeWorkflow);
  $('#toolModal').addEventListener('click',event=>{if(event.target.id==='toolModal')closeTool();});$('#workflowModal').addEventListener('click',event=>{if(event.target.id==='workflowModal')closeWorkflow();});
  document.addEventListener('keydown',event=>{if(event.key==='Escape'){closeTool();closeWorkflow();}});
  $('#saveTextSettings').addEventListener('click',()=>saveProviderSettings('text',false));
  $('#saveImageSettings').addEventListener('click',()=>saveProviderSettings('image',false));
  $('#testTextConnection').addEventListener('click',testTextConnection);
  $('#testImageConnection').addEventListener('click',testImageConnection);
  $('#removeTextKey').addEventListener('click',()=>{if(confirm('Remove the Text AI key from this tab session?'))saveProviderSettings('text',true);});
  $('#removeImageKey').addEventListener('click',()=>{if(confirm('Remove the Image AI key from this tab session?'))saveProviderSettings('image',true);});
  $('#textProvider').addEventListener('change',()=>updateProviderDefaults('text'));
  $('#imageProvider').addEventListener('change',()=>updateProviderDefaults('image'));
  $$('[data-toggle-secret]').forEach(button=>button.addEventListener('click',()=>{const input=$(`#${button.dataset.toggleSecret}`);input.type=input.type==='password'?'text':'password';button.textContent=input.type==='password'?'Show':'Hide';}));
  $('#exportBackupButton').addEventListener('click',exportBackup);$('#importBackupInput').addEventListener('change',event=>{if(event.target.files?.[0])importBackup(event.target.files[0]);event.target.value='';});$('#endSessionButton').addEventListener('click',endSessionAndClear);
}
initialize();
