// Claude Code Launcher — Stream Dock (AJAZZ / Mirabox) plugin.
// Stream Dock starts this file with its bundled Node 20 and passes:
//   -port <n> -pluginUUID <uuid> -registerEvent <event> -info <json>
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, execFile } = require('child_process');
const WebSocket = require('ws');

const argv = process.argv.slice(2);
const arg = (name) => { const i = argv.indexOf('-' + name); return i < 0 ? undefined : argv[i + 1]; };

const CLAUDE_DIR = path.join(os.homedir(), '.claude');
const PROJECTS_DIR = path.join(CLAUDE_DIR, 'projects');
const LOG_FILE = path.join(__dirname, 'plugin.log');

// English by default, Russian when Stream Dock runs in Russian.
const LANG = (() => {
  try { return /^ru/i.test(JSON.parse(arg('info')).application.language) ? 'ru' : 'en'; } catch { return 'en'; }
})();
const STRINGS = {
  en: { builtIn: 'built-in', folderNotFound: 'Project folder not found: ', pickFolder: 'Project folder for Claude Code' },
  ru: { builtIn: 'встроенный', folderNotFound: 'Папка проекта не найдена: ', pickFolder: 'Папка проекта для Claude Code' },
};
const t = (key) => STRINGS[LANG][key];

function log(...a) {
  try {
    fs.appendFileSync(LOG_FILE, `[${new Date().toISOString()}] ${a.map(x => typeof x === 'string' ? x : JSON.stringify(x)).join(' ')}\n`);
  } catch {}
}

// ---------- Claude Code sessions ----------

// Claude Code stores chats in ~/.claude/projects/<cwd with non-alphanumerics → '-'>/<sessionId>.jsonl
const encodeProject = (p) => p.replace(/[^a-zA-Z0-9]/g, '-');
const samePath = (a, b) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();

function readChunk(file, fromEnd, size) {
  const fd = fs.openSync(file, 'r');
  try {
    const total = fs.fstatSync(fd).size;
    const len = Math.min(size, total);
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, fromEnd ? total - len : 0);
    return buf.toString('utf8');
  } finally {
    fs.closeSync(fd);
  }
}

function parseLines(text) {
  const out = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try { out.push(JSON.parse(line)); } catch {} // partial line at chunk edge
  }
  return out;
}

function userText(e) {
  const c = e.message && e.message.content;
  let t = typeof c === 'string' ? c : Array.isArray(c) ? (c.find(x => x.type === 'text') || {}).text : '';
  t = (t || '').trim();
  if (!t || t.startsWith('<')) return ''; // slash-command wrappers, reminders, etc.
  return t.replace(/\s+/g, ' ');
}

function sessionInfo(file) {
  const head = parseLines(readChunk(file, false, 128 * 1024));
  const tail = parseLines(readChunk(file, true, 256 * 1024));
  const firstUser = head.find(e => e.type === 'user' && !e.isSidechain && userText(e));
  if (!firstUser) return null; // empty / aborted session

  let custom = '', ai = '', summary = '', lastPrompt = '';
  for (const e of [...head, ...tail]) {
    if (e.type === 'custom-title') custom = e.customTitle || e.title || custom;
    else if (e.type === 'ai-title') ai = e.aiTitle || ai;
    else if (e.type === 'summary') summary = e.summary || summary;
    else if (e.type === 'last-prompt') lastPrompt = e.lastPrompt || lastPrompt;
  }
  const first = userText(firstUser);
  return {
    id: path.basename(file, '.jsonl'),
    cwd: firstUser.cwd || '',
    title: custom || ai || summary || first.slice(0, 80),
    custom: !!custom,
    firstPrompt: first.slice(0, 200),
    lastPrompt: (lastPrompt || '').slice(0, 200),
    mtime: fs.statSync(file).mtimeMs,
  };
}

function jsonlFiles(dir) {
  try {
    return fs.readdirSync(dir)
      .filter(f => f.endsWith('.jsonl'))
      .map(f => path.join(dir, f))
      .map(f => ({ f, m: fs.statSync(f).mtimeMs }))
      .sort((a, b) => b.m - a.m)
      .map(x => x.f);
  } catch { return []; }
}

function projectDirFor(projectPath) {
  const direct = path.join(PROJECTS_DIR, encodeProject(path.resolve(projectPath)));
  if (fs.existsSync(direct)) return direct;
  // Long paths get shortened by Claude Code — fall back to matching the recorded cwd.
  for (const p of listProjects()) if (samePath(p.path, projectPath)) return p.dir;
  return null;
}

function listSessions(projectPath, limit = 60) {
  const dir = projectPath && projectDirFor(projectPath);
  if (!dir) return [];
  const out = [];
  for (const f of jsonlFiles(dir)) {
    try {
      const s = sessionInfo(f);
      if (s) out.push(s);
    } catch (e) { log('session read failed', f, e.message); }
    if (out.length >= limit) break;
  }
  return out;
}

// Every chat of every known project, newest first — for picking a chat by its name.
function listAllSessions(perProject = 40) {
  const out = [];
  for (const p of listProjects()) {
    for (const s of listSessions(p.path, perProject)) {
      out.push({ ...s, projectPath: p.path, project: path.basename(p.path) });
    }
  }
  return out.sort((a, b) => b.mtime - a.mtime);
}

function listProjects() {
  let dirs = [];
  try { dirs = fs.readdirSync(PROJECTS_DIR); } catch { return []; }
  const out = [];
  for (const d of dirs) {
    const dir = path.join(PROJECTS_DIR, d);
    const files = jsonlFiles(dir);
    let cwd = '';
    for (const f of files.slice(0, 5)) {
      try {
        const e = parseLines(readChunk(f, false, 64 * 1024)).find(x => x.cwd);
        if (e) { cwd = e.cwd; break; }
      } catch {}
    }
    if (!cwd || !fs.existsSync(cwd)) continue;
    out.push({ path: cwd, dir, count: files.length, mtime: files.length ? fs.statSync(files[0]).mtimeMs : 0 });
  }
  return out.sort((a, b) => b.mtime - a.mtime);
}

// ---------- Launching ----------

function resolveClaude() {
  // Explicit override for unusual installs (and for the end-to-end test's fake claude).
  if (process.env.CCSD_CLAUDE) return process.env.CCSD_CLAUDE;
  const local = path.join(os.homedir(), '.local', 'bin', 'claude.exe');
  if (fs.existsSync(local)) return local;
  const npm = path.join(process.env.APPDATA || '', 'npm', 'claude.cmd');
  if (fs.existsSync(npm)) return npm;
  return 'claude';
}

// Split "--model opus --append-system-prompt \"be brief\"" into argv, honouring quotes.
function splitArgs(s) {
  const out = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let m;
  while ((m = re.exec(s || ''))) out.push(m[1] ?? m[2] ?? m[3]);
  return out;
}

function claudeArgs(s) {
  const a = [];
  if (s.mode === 'pick') a.push('--resume'); // Claude Code's own chat picker
  else if (s.mode === 'resume' && s.sessionId) a.push('--resume', s.sessionId);
  else if (s.mode === 'resume' || s.mode === 'continue') a.push('--continue');
  return a.concat(splitArgs(s.extraArgs));
}

// If Stream Dock was itself started from inside a Claude Code session, it inherits that
// session's markers (CLAUDE_CODE_CHILD_SESSION, ...). Passing them on makes the new
// Claude Code think it is a nested session and stop saving its transcript.
// NO_COLOR comes from the same place and would make it render without colours.
function cleanEnv() {
  const env = { ...process.env };
  for (const k of Object.keys(env)) {
    if (/^(CLAUDECODE$|CLAUDE_CODE_|CLAUDE_PID$|CLAUDE_EFFORT$|NO_COLOR$)/i.test(k)) delete env[k];
  }
  return env;
}

const cmdQuote = (x) => /[\s"&|<>^()]/.test(x) ? `"${x.replace(/"/g, '""')}"` : x;
// `start` treats its first quoted argument as the window title — it must always be quoted,
// otherwise a one-word title is taken for the program to run.
const startTitle = (t) => `"${t.replace(/["%^&|<>]/g, '')}"`;

// ---------- PowerShell discovery ----------

// lstat, not existsSync: Store app aliases (WindowsApps\pwsh.exe) are reparse points
// that existsSync reports as missing.
const present = (p) => { try { fs.lstatSync(p); return true; } catch { return false; } };

function shellVersion(exe) {
  return new Promise((resolve) => {
    execFile(exe, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', '$PSVersionTable.PSVersion.ToString()'],
      { timeout: 8000, windowsHide: true, encoding: 'utf8', env: cleanEnv() },
      (err, stdout) => resolve(err ? '' : stdout.trim()));
  });
}

function shellCandidates() {
  const home = os.homedir();
  const local = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
  const out = [
    { exe: path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'), source: t('builtIn') },
  ];
  for (const base of [process.env.ProgramFiles, process.env['ProgramFiles(x86)']].filter(Boolean)) {
    const root = path.join(base, 'PowerShell');
    let dirs = [];
    try { dirs = fs.readdirSync(root); } catch {}
    for (const d of dirs) out.push({ exe: path.join(root, d, 'pwsh.exe'), source: d.includes('preview') ? 'Preview' : 'MSI' });
  }
  let aliases = [];
  try { aliases = fs.readdirSync(path.join(local, 'Microsoft', 'WindowsApps')).filter(f => /^pwsh.*\.exe$/i.test(f)); } catch {}
  for (const f of aliases) out.push({ exe: path.join(local, 'Microsoft', 'WindowsApps', f), source: 'Microsoft Store' });
  out.push({ exe: path.join(home, '.dotnet', 'tools', 'pwsh.exe'), source: 'dotnet tool' });
  out.push({ exe: path.join(home, 'scoop', 'apps', 'pwsh', 'current', 'pwsh.exe'), source: 'Scoop' });
  for (const dir of (process.env.PATH || '').split(';').filter(Boolean)) {
    // Store packages' own folders can't be launched directly — their alias above is used instead.
    if (/\\WindowsApps\\Microsoft\.PowerShell/i.test(dir)) continue;
    out.push({ exe: path.join(dir, 'pwsh.exe'), source: 'PATH' });
  }
  const seen = new Set();
  return out.filter(c => {
    const key = c.exe.toLowerCase();
    if (seen.has(key) || !present(c.exe)) return false;
    seen.add(key);
    return true;
  });
}

let shellCache = null;
// Every PowerShell installed on this PC, with its real version.
async function listShells(refresh = false) {
  if (shellCache && !refresh) return shellCache;
  const found = await Promise.all(shellCandidates().map(async c => ({ ...c, version: await shellVersion(c.exe) })));
  const seen = new Set();
  shellCache = found
    .filter(s => s.version)
    // The same install is often reachable twice (e.g. via PATH and via its own folder);
    // candidates are ordered so the more specific source wins.
    .filter(s => { if (seen.has(s.version)) return false; seen.add(s.version); return true; })
    .map(s => ({
      exe: s.exe,
      version: s.version,
      label: `${s.version.startsWith('5.') ? 'Windows PowerShell' : 'PowerShell'} ${s.version} (${s.source})`,
    }))
    .sort((a, b) => b.version.localeCompare(a.version, undefined, { numeric: true }));
  return shellCache;
}

function launch(s) {
  const cwd = path.resolve((s.projectPath || '').trim() || os.homedir());
  if (!fs.existsSync(cwd)) throw new Error(t('folderNotFound') + cwd);

  const claude = resolveClaude();
  const args = claudeArgs(s);
  const title = s.label || (s.projectPath ? path.basename(cwd) : 'Claude Code');
  log('launch', { cwd, terminal: s.terminal, shell: s.shellPath, args });

  if (s.terminal === 'powershell') {
    const exe = s.shellPath && present(s.shellPath) ? s.shellPath : 'powershell.exe';
    launchPowerShell(exe, cwd, title, claude, args, s.window === 'window');
    return;
  }
  if (s.terminal !== 'cmd') {
    // Windows Terminal. ';' is wt's command separator, so escape it inside arguments.
    const esc = (x) => x.replace(/;/g, '\\;');
    const wtArgs = ['-w', s.window === 'window' ? 'new' : '0', 'new-tab',
      '-d', cwd, '--title', esc(title), esc(claude), ...args.map(esc)];
    const child = spawn('wt.exe', wtArgs, { detached: true, stdio: 'ignore', env: cleanEnv() });
    child.on('error', (e) => {
      log('wt failed, falling back to cmd', e.message);
      launchCmd(cwd, title, claude, args);
    });
    child.unref();
    return;
  }
  launchCmd(cwd, title, claude, args);
}

function launchCmd(cwd, title, claude, args) {
  const line = ['start', startTitle(title), '/D', cmdQuote(cwd), cmdQuote(claude), ...args.map(cmdQuote)].join(' ');
  spawn('cmd.exe', ['/d', '/s', '/c', `"${line}"`], {
    detached: true, stdio: 'ignore', windowsVerbatimArguments: true, env: cleanEnv(),
  }).unref();
}

// A standalone window of the chosen PowerShell that stays open after Claude Code exits.
// Windows Terminal profile (guid) that runs this PowerShell — so the tab gets the
// PowerShell icon, colours and font instead of a bare console.
function wtProfileFor(exe) {
  const local = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  const files = [
    path.join(local, 'Packages', 'Microsoft.WindowsTerminal_8wekyb3d8bbwe', 'LocalState', 'settings.json'),
    path.join(local, 'Packages', 'Microsoft.WindowsTerminalPreview_8wekyb3d8bbwe', 'LocalState', 'settings.json'),
    path.join(local, 'Microsoft', 'Windows Terminal', 'settings.json'), // unpackaged install
  ];
  const isCore = /pwsh/i.test(path.basename(exe));
  for (const f of files) {
    let profiles;
    try {
      // settings.json may contain // comments
      const text = fs.readFileSync(f, 'utf8').replace(/^\s*\/\/.*$/gm, '');
      const j = JSON.parse(text);
      profiles = Array.isArray(j.profiles) ? j.profiles : (j.profiles && j.profiles.list) || [];
    } catch { continue; }
    const match = profiles.find(p => !p.hidden && (isCore
      ? p.source === 'Windows.Terminal.PowershellCore' || /pwsh/i.test(p.commandline || '')
      : !p.source && /powershell\.exe/i.test(p.commandline || '')));
    if (match) return match.guid;
  }
  return null;
}

function launchPowerShell(exe, cwd, title, claude, args, newWindow) {
  const psq = (x) => `'${x.replace(/'/g, "''")}'`;
  const profile = wtProfileFor(exe);
  // ';' separates commands in wt, so escape it inside arguments.
  const esc = (x) => x.replace(/;/g, '\\;');
  const wtArgs = ['-w', newWindow ? 'new' : '0', 'new-tab', ...(profile ? ['-p', profile] : []),
    '-d', cwd, '--title', esc(title), exe, '-NoLogo', '-NoExit', '-Command',
    esc(`& ${[claude, ...args].map(psq).join(' ')}`)];
  const child = spawn('wt.exe', wtArgs, { detached: true, stdio: 'ignore', env: cleanEnv() });
  child.on('error', (e) => {
    log('wt failed, opening a plain PowerShell window', e.message);
    launchPowerShellWindow(exe, cwd, title, claude, args);
  });
  child.unref();
}

// Fallback without Windows Terminal: a standalone console window.
function launchPowerShellWindow(exe, cwd, title, claude, args) {
  const psq = (x) => `'${x.replace(/'/g, "''")}'`;
  const script = `$Host.UI.RawUI.WindowTitle = ${psq(title)}; & ${[claude, ...args].map(psq).join(' ')}`;
  const line = ['start', startTitle(title), '/D', cmdQuote(cwd), cmdQuote(exe),
    '-NoLogo', '-NoExit', '-Command', `"${script.replace(/"/g, '\\"')}"`].join(' ');
  spawn('cmd.exe', ['/d', '/s', '/c', `"${line}"`], {
    detached: true, stdio: 'ignore', windowsVerbatimArguments: true, env: cleanEnv(),
  }).unref();
}

function browseFolder(start) {
  const ps = `
Add-Type -AssemblyName System.Windows.Forms
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$d = New-Object System.Windows.Forms.FolderBrowserDialog
$d.Description = $env:CC_TITLE
$d.ShowNewFolderButton = $true
$p = $env:CC_START
if ($p -and (Test-Path $p)) { $d.SelectedPath = $p }
$owner = New-Object System.Windows.Forms.Form -Property @{ TopMost = $true }
if ($d.ShowDialog($owner) -eq 'OK') { $d.SelectedPath }`;
  return new Promise((resolve) => {
    execFile('powershell.exe', ['-NoProfile', '-STA', '-Command', ps],
      { env: { ...process.env, CC_START: start || '', CC_TITLE: t('pickFolder') }, encoding: 'utf8', windowsHide: true },
      (err, stdout) => resolve(err ? '' : stdout.trim()));
  });
}

// ---------- Stream Dock connection ----------

const contexts = new Map(); // context -> settings
let ws;

function send(obj) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
}

function pinnedChatTitle(s) {
  if (s.mode !== 'resume' || !s.sessionId || !s.projectPath) return '';
  const dir = projectDirFor(s.projectPath);
  const file = dir && path.join(dir, s.sessionId + '.jsonl');
  try { return (file && fs.existsSync(file) && (sessionInfo(file) || {}).title) || ''; } catch { return ''; }
}

// Fit text into two short lines of a key.
function wrapKey(text, width = 9) {
  const words = text.split(/\s+/).filter(Boolean);
  const lines = [''];
  for (const w of words) {
    const cur = lines[lines.length - 1];
    if (!cur) lines[lines.length - 1] = w;
    else if ((cur + ' ' + w).length <= width) lines[lines.length - 1] = cur + ' ' + w;
    else if (lines.length < 2) lines.push(w);
    else { lines[1] += ' ' + w; break; }
  }
  return lines.map(l => l.length > width ? l.slice(0, width - 1) + '…' : l).join('\n');
}

function keyTitle(s) {
  if (s.label) return s.label;
  if (!s.projectPath) return 'Claude';
  return wrapKey(pinnedChatTitle(s) || path.basename(s.projectPath));
}

function refreshKey(context, s) {
  send({ event: 'setTitle', context, payload: { title: keyTitle(s), target: 0 } });
}

const toPI = (action, context, payload) =>
  send({ event: 'sendToPropertyInspector', action, context, payload });

async function onPIMessage(action, context, p) {
  try {
    if (p.cmd === 'projects') toPI(action, context, { cmd: 'projects', items: listProjects() });
    else if (p.cmd === 'allSessions') toPI(action, context, { cmd: 'allSessions', items: listAllSessions() });
    else if (p.cmd === 'shells') toPI(action, context, { cmd: 'shells', items: await listShells(p.refresh) });
    else if (p.cmd === 'sessions') toPI(action, context, { cmd: 'sessions', path: p.path, items: listSessions(p.path) });
    else if (p.cmd === 'browse') toPI(action, context, { cmd: 'browse', path: await browseFolder(p.path) });
    else if (p.cmd === 'launch') launch(p.settings || contexts.get(context) || {});
  } catch (e) {
    log('PI message failed', p.cmd, e.message);
    toPI(action, context, { cmd: 'error', message: e.message });
  }
}

function connect() {
  ws = new WebSocket('ws://127.0.0.1:' + arg('port'));
  ws.on('open', () => {
    send({ event: arg('registerEvent'), uuid: arg('pluginUUID') });
    log('connected');
  });
  ws.on('message', (raw) => {
    let m;
    try { m = JSON.parse(raw); } catch { return; }
    const { event, action, context, payload = {} } = m;
    switch (event) {
      case 'willAppear':
      case 'didReceiveSettings':
        contexts.set(context, payload.settings || {});
        refreshKey(context, payload.settings || {});
        break;
      case 'willDisappear':
        contexts.delete(context);
        break;
      case 'keyUp': {
        const s = payload.settings || contexts.get(context) || {};
        try {
          launch(s);
          send({ event: 'showOk', context });
        } catch (e) {
          log('launch failed', e.message);
          send({ event: 'showAlert', context });
        }
        break;
      }
      case 'sendToPlugin':
        onPIMessage(action, context, payload);
        break;
    }
  });
  ws.on('close', () => { log('socket closed'); process.exit(0); });
  ws.on('error', (e) => log('socket error', e.message));
}

module.exports = { listProjects, listSessions, listAllSessions, listShells, claudeArgs, splitArgs, launch };

if (require.main === module) {
  process.on('uncaughtException', (e) => log('uncaught', e.stack || e.message));
  if (arg('port')) connect();
}
