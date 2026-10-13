// Property Inspector for the Claude Code key. Stream Dock calls
// connectElgatoStreamDeckSocket (or connectSocket) with the PI connection info.
let ws, uuid, action;
let settings = {};
let sessions = [];
let allChats = [];

const $ = (id) => document.getElementById(id);
const FIELDS = ['projectPath', 'mode', 'sessionId', 'label', 'window', 'extraArgs'];
let shells = null; // PowerShells found on this PC, from the plugin

// The terminal <select> encodes a chosen PowerShell as "ps:<path to exe>".
const terminalValue = () =>
  settings.terminal === 'powershell' ? 'ps:' + (settings.shellPath || '') : (settings.terminal || 'wt');

function readTerminal() {
  const v = $('terminal').value;
  if (v.startsWith('ps:')) {
    settings.terminal = 'powershell';
    settings.shellPath = v.slice(3);
  } else {
    settings.terminal = v;
    settings.shellPath = '';
  }
}

function renderShells() {
  const group = $('shells');
  group.innerHTML = '';
  const add = (value, text, disabled) => {
    const o = document.createElement('option');
    o.value = value; o.textContent = text; o.disabled = !!disabled;
    group.appendChild(o);
  };
  if (!shells) add('', t('searching'), true);
  else if (!shells.length) add('', t('notFound'), true);
  else for (const s of shells) add('ps:' + s.exe, s.label);
  // Keep the saved choice visible even if that PowerShell is gone.
  const v = terminalValue();
  if (v.startsWith('ps:') && shells && !shells.some(s => 'ps:' + s.exe === v)) {
    add(v, t('shellMissing', settings.shellPath || 'PowerShell'));
  }
  $('terminal').value = v;
}

function send(obj) {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj));
}
const toPlugin = (payload) => send({ event: 'sendToPlugin', action, context: uuid, payload });

function save() {
  for (const f of FIELDS) settings[f] = $(f).value.trim();
  readTerminal();
  send({ event: 'setSettings', context: uuid, payload: settings });
  const pinned = settings.mode === 'resume' && allChats.some(c => c.id === settings.sessionId);
  $('chatPick').value = pinned ? settings.sessionId : '';
  updateVisibility();
}

function updateVisibility() {
  const resume = $('mode').value === 'resume';
  $('sessionRow').classList.toggle('hidden', !resume);
  $('sessionHint').classList.toggle('hidden', !resume);
  // PowerShell also opens as a Windows Terminal tab (with its own profile).
  const t = $('terminal').value;
  $('windowRow').classList.toggle('hidden', t !== 'wt' && !t.startsWith('ps:'));
  renderHint();
}

function fmtDate(ms) {
  const d = new Date(ms);
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function renderSessions() {
  const sel = $('sessionId');
  sel.innerHTML = '';
  const add = (value, text) => {
    const o = document.createElement('option');
    o.value = value; o.textContent = text;
    sel.appendChild(o);
  };
  add('', sessions.length ? t('latestChat') : t('noChats'));
  for (const s of sessions) add(s.id, `${s.custom ? '★ ' : ''}${s.title}  ·  ${fmtDate(s.mtime)}`);
  // Keep a pinned session even if it fell outside the list.
  if (settings.sessionId && !sessions.some(s => s.id === settings.sessionId)) {
    add(settings.sessionId, settings.sessionId);
  }
  sel.value = settings.sessionId || '';
  renderHint();
}

function renderHint() {
  const s = sessions.find(x => x.id === $('sessionId').value);
  $('sessionHint').textContent = s
    ? t('lastPrompt', s.lastPrompt || s.firstPrompt)
    : t('noSelection');
}

function loadSessions() {
  const p = $('projectPath').value.trim();
  sessions = [];
  renderSessions();
  if (p) toPlugin({ cmd: 'sessions', path: p });
}

// All chats of all projects, grouped by project folder and labelled by chat name.
function renderChatPick() {
  const sel = $('chatPick');
  sel.innerHTML = '';
  const first = document.createElement('option');
  first.value = '';
  first.textContent = allChats.length ? t('pickChat') : t('noChats');
  sel.appendChild(first);
  const groups = new Map();
  for (const c of allChats) {
    if (!groups.has(c.projectPath)) {
      const g = document.createElement('optgroup');
      g.label = c.project;
      groups.set(c.projectPath, g);
      sel.appendChild(g);
    }
    const o = document.createElement('option');
    o.value = c.id;
    o.textContent = `${c.custom ? '★ ' : ''}${c.title}  ·  ${fmtDate(c.mtime)}`;
    o.title = c.projectPath;
    groups.get(c.projectPath).appendChild(o);
  }
  sel.value = settings.mode === 'resume' && allChats.some(c => c.id === settings.sessionId) ? settings.sessionId : '';
}

function showError(msg) {
  $('error').textContent = msg || '';
  $('error').classList.toggle('hidden', !msg);
}

function onMessage(evt) {
  const m = JSON.parse(evt.data);
  if (m.event === 'didReceiveSettings') {
    settings = m.payload.settings || {};
    fill();
  }
  if (m.event !== 'sendToPropertyInspector') return;
  const p = m.payload || {};
  if (p.cmd === 'shells') {
    shells = p.items;
    renderShells();
  } else if (p.cmd === 'allSessions') {
    allChats = p.items;
    renderChatPick();
  } else if (p.cmd === 'sessions' && p.path === $('projectPath').value.trim()) {
    sessions = p.items;
    renderSessions();
  } else if (p.cmd === 'browse' && p.path) {
    $('projectPath').value = p.path;
    settings.sessionId = '';
    save();
    loadSessions();
  } else if (p.cmd === 'error') {
    showError(p.message);
  }
}

function fill() {
  const defaults = { mode: 'resume', terminal: 'wt', window: 'tab' };
  for (const f of FIELDS) $(f).value = settings[f] ?? defaults[f] ?? '';
  renderShells();
  updateVisibility();
  loadSessions();
}

function bindUI() {
  $('chatPick').addEventListener('change', (e) => {
    const c = allChats.find(x => x.id === e.target.value);
    if (!c) return;
    settings.sessionId = c.id;
    $('projectPath').value = c.projectPath;
    $('mode').value = 'resume';
    save();
    loadSessions(); // re-renders the session list and keeps settings.sessionId selected
  });
  $('projectPath').addEventListener('change', () => {
    settings.sessionId = '';
    $('sessionId').value = '';
    save();
    loadSessions();
  });
  $('browse').addEventListener('click', () => toPlugin({ cmd: 'browse', path: $('projectPath').value.trim() }));
  $('reload').addEventListener('click', loadSessions);
  $('rescan').addEventListener('click', () => {
    shells = null;
    renderShells();
    toPlugin({ cmd: 'shells', refresh: true });
  });
  for (const f of ['mode', 'sessionId', 'terminal', 'window']) $(f).addEventListener('change', save);
  for (const f of ['label', 'extraArgs']) $(f).addEventListener('input', save);
  $('test').addEventListener('click', () => {
    showError('');
    save();
    toPlugin({ cmd: 'launch', settings });
  });
}

function connectElgatoStreamDeckSocket(port, propertyInspectorUUID, registerEvent, info, actionInfo) {
  uuid = propertyInspectorUUID;
  try {
    const app = (typeof info === 'string' ? JSON.parse(info) : info).application || {};
    setLanguage(app.language);
  } catch {}
  try {
    const ai = typeof actionInfo === 'string' ? JSON.parse(actionInfo) : actionInfo;
    action = ai.action;
    settings = (ai.payload && ai.payload.settings) || {};
  } catch {}
  ws = new WebSocket('ws://127.0.0.1:' + port);
  ws.onopen = () => {
    send({ event: registerEvent, uuid });
    fill();
    toPlugin({ cmd: 'allSessions' });
    toPlugin({ cmd: 'shells' });
  };
  ws.onmessage = onMessage;
}
window.connectElgatoStreamDeckSocket = connectElgatoStreamDeckSocket;
window.connectSocket = connectElgatoStreamDeckSocket;

bindUI();
