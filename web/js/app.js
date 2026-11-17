// 앱 진입점: 로그인, 탭 전환, 대시보드, 플레이어 목록, 콘솔, 서버 설정, server.properties

import { PanelClient } from './api.js';
import { InventoryView, escapeHtml } from './inventory.js';
import { loadKorean } from './items.js';

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const STORE_KEY = 'webpanel.login';

let client = null;
let invView = null;

// 아이템·마법부여 한국어 이름 (처음 한 번만 받고 브라우저에 기억)
loadKorean()
  .then((fresh) => { if (fresh && invView) invView.refreshNames(); })
  .catch(() => { /* 못 받으면 영어 이름으로 표시 */ });
let currentTab = 'dashboard';
let players = { online: [], offline: [] };
let settings = null;
let selectedWorld = null;
let propsOriginal = {};
const consoleLines = [];
const CONSOLE_MAX = 2000;
const cmdHistory = [];
let cmdIndex = -1;

// ================================================================ 공통 UI

function toast(msg, isError = false) {
  const t = document.createElement('div');
  t.className = 'toast' + (isError ? ' err' : '');
  t.textContent = msg;
  $('#toasts').appendChild(t);
  setTimeout(() => t.remove(), isError ? 5000 : 2500);
}

const ui = {
  toast,
  confirm: async (msg) => window.confirm(msg),
  prompt: async (msg, def) => window.prompt(msg, def),
  onlinePlayers: () => players.online,
};

async function req(action, data, okMsg) {
  try {
    const res = await client.request(action, data);
    if (okMsg) toast(okMsg);
    return res;
  } catch (e) {
    toast(e.message, true);
    throw e;
  }
}

// ================================================================ 로그인

function loadSaved() {
  try {
    return JSON.parse(localStorage.getItem(STORE_KEY) || sessionStorage.getItem(STORE_KEY) || 'null');
  } catch { return null; }
}

function save(url, token, remember) {
  try {
    const v = JSON.stringify({ url, token });
    localStorage.removeItem(STORE_KEY);
    sessionStorage.removeItem(STORE_KEY);
    (remember ? localStorage : sessionStorage).setItem(STORE_KEY, v);
  } catch { /* 저장 불가 환경이면 무시 */ }
}

function clearSaved() {
  try { localStorage.removeItem(STORE_KEY); sessionStorage.removeItem(STORE_KEY); } catch { /* 무시 */ }
}

function showLogin(error = '') {
  $('#app').classList.add('hidden');
  $('#login').classList.remove('hidden');
  $('#login-error').textContent = error;
  const saved = loadSaved();
  if (saved) {
    $('#login-url').value = saved.url;
    $('#login-token').value = saved.token;
  }
  try { $('#login-remember').checked = !!localStorage.getItem(STORE_KEY); } catch { /* 무시 */ }
}

async function login(url, token, remember) {
  url = url.trim().replace(/\/+$/, '');
  // https://... 나 주소만 적어도 wss://.../panel 로 바꿔 준다
  if (/^https:\/\//i.test(url)) url = 'wss://' + url.slice(8);
  else if (/^http:\/\//i.test(url)) url = 'ws://' + url.slice(7);
  else if (!/^wss?:\/\//i.test(url)) url = 'wss://' + url;
  if (!/\/panel$/i.test(url)) url += '/panel';
  $('#login-btn').disabled = true;
  $('#login-error').textContent = '';
  const c = new PanelClient(url, token.trim());
  try {
    await c.connect();
  } catch (e) {
    $('#login-btn').disabled = false;
    showLogin(e.message);
    return;
  }
  $('#login-btn').disabled = false;
  save(url, token.trim(), remember);
  client = c;
  bindClient();
  $('#login').classList.add('hidden');
  $('#app').classList.remove('hidden');
  await loadInitial();
}

$('#login-form').addEventListener('submit', (e) => {
  e.preventDefault();
  login($('#login-url').value, $('#login-token').value, $('#login-remember').checked);
});

$('#logout').addEventListener('click', () => {
  if (client) client.close();
  client = null;
  clearSaved();
  $('#login-token').value = '';
  showLogin();
});

function bindClient() {
  if (!invView) invView = new InventoryView(client, ui);
  else invView.setClient(client);

  client.on('connection', (state) => {
    const dot = $('#conn-dot');
    dot.className = 'dot' + (state === 'open' ? ' ok' : state === 'closed' || state === 'reconnecting' ? ' bad' : '');
    $('#conn-text').textContent = { open: '연결됨', connecting: '연결 중', closed: '끊김', reconnecting: '재연결 중…' }[state] || state;
  });
  client.emit('connection', 'open');
  client.on('reconnected', async () => {
    toast('서버에 다시 연결되었습니다');
    await loadInitial();
    if (currentTab === 'player') invView.subscribe();
  });
  client.on('status', renderStatus);
  client.on('settings', (s) => { settings = s; renderSettings(); });
  client.on('players', (p) => { players = p; renderPlayers(); });
  client.on('players.online', (online) => { players.online = online; renderPlayers(); });
  client.on('console', ({ line }) => addConsoleLine(line));
}

async function loadInitial() {
  // 하나가 실패해도 나머지는 표시되도록 각각 처리
  const [status, sets, pl, hist] = await Promise.allSettled([
    client.request('server.status'),
    client.request('server.settings'),
    client.request('players.list'),
    client.request('console.history'),
  ]);
  const fail = (what, r) => toast(`${what}을(를) 불러오지 못했습니다: ${r.reason?.message || r.reason}`, true);
  if (status.status === 'fulfilled') renderStatus(status.value); else fail('서버 상태', status);
  if (sets.status === 'fulfilled') { settings = sets.value; renderSettings(); } else fail('서버 설정', sets);
  if (pl.status === 'fulfilled') { players = pl.value; renderPlayers(); } else fail('플레이어 목록', pl);
  if (hist.status === 'fulfilled') {
    consoleLines.length = 0;
    $('#con-log').textContent = '';
    hist.value.lines.forEach(addConsoleLine);
  } else fail('콘솔 기록', hist);
}

// ================================================================ 탭

function showTab(name) {
  if (currentTab === 'player' && name !== 'player' && invView) invView.close();
  currentTab = name;
  $$('.tab').forEach((t) => t.classList.toggle('active', t.id === `tab-${name}`));
  $$('#tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === name || (name === 'player' && b.dataset.tab === 'players')));
  if (name === 'properties') loadProperties();
  if (name === 'console') scrollConsole(true);
}

$$('#tabs button').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)));
$('#pd-back').addEventListener('click', () => showTab('players'));

// ================================================================ 대시보드

function fmtUptime(sec) {
  const d = Math.floor(sec / 86400), h = Math.floor(sec % 86400 / 3600), m = Math.floor(sec % 3600 / 60);
  return d ? `${d}일 ${h}시간` : h ? `${h}시간 ${m}분` : `${m}분`;
}

function renderStatus(s) {
  const tps = s.tps[0];
  const el = $('#st-tps');
  el.textContent = tps.toFixed(1);
  el.className = 'value ' + (tps >= 18 ? 'good' : tps >= 15 ? 'mid' : 'badv');
  $('#st-tps-sub').textContent = `5분 ${s.tps[1]} · 15분 ${s.tps[2]}`;
  $('#st-mspt').textContent = s.mspt.toFixed(1);
  $('#st-mspt').className = 'value ' + (s.mspt <= 40 ? 'good' : s.mspt <= 50 ? 'mid' : 'badv');
  $('#st-mem').textContent = `${(s.memoryUsed / 1024).toFixed(1)} / ${(s.memoryMax / 1024).toFixed(1)} GB`;
  $('#st-mem-bar').style.width = `${Math.min(100, s.memoryUsed / s.memoryMax * 100)}%`;
  $('#st-players').textContent = `${s.online} / ${s.maxPlayers}`;
  $('#st-version').textContent = `마인크래프트 ${s.version}`;
  $('#st-uptime').textContent = fmtUptime(s.uptimeSeconds);
  $('#st-software').textContent = s.software;
  $('#st-worlds').innerHTML = s.worlds.map((w) =>
    `<tr><td>${escapeHtml(w.name)}</td><td>${w.players}</td><td>${w.entities}</td><td>${w.chunks}</td></tr>`).join('');
}

$('#btn-save').addEventListener('click', () => req('server.save', {}, '월드를 저장했습니다').catch(() => {}));
$('#btn-stop').addEventListener('click', async () => {
  if (!confirm('서버를 종료할까요? 다시 켜려면 서버 컴퓨터에서 직접 실행해야 합니다.')) return;
  req('server.stop', {}, '서버를 종료합니다').catch(() => {});
});

// ================================================================ 플레이어

const GM = { SURVIVAL: '서바이벌', CREATIVE: '크리에이티브', ADVENTURE: '모험', SPECTATOR: '관전' };

function tagsHtml(p) {
  return (p.op ? '<span class="tag op">OP</span>' : '') +
    (p.whitelisted ? '<span class="tag wl">WL</span>' : '') +
    (p.banned ? '<span class="tag ban">차단</span>' : '');
}

function nameCell(p) {
  return `<div class="name"><img src="https://mc-heads.net/avatar/${p.uuid}/24" alt="" referrerpolicy="no-referrer" class="avatar">${escapeHtml(p.name)} ${tagsHtml(p)}</div>`;
}

function renderPlayers() {
  const on = players.online || [];
  $('#pl-online-count').textContent = on.length;
  $('#pl-online-empty').classList.toggle('hidden', on.length > 0);
  $('#pl-online').innerHTML = on.map((p) => `
    <tr class="clickable" data-uuid="${p.uuid}">
      <td>${nameCell(p)}</td>
      <td>${p.health} / ${p.maxHealth}</td>
      <td>${p.food} / 20</td>
      <td>${p.level}</td>
      <td>${GM[p.gamemode] || p.gamemode}</td>
      <td class="muted">${escapeHtml(p.world)} ${p.x}, ${p.y}, ${p.z}</td>
      <td>${p.ping}ms</td>
      <td><button class="btn small">인벤토리 ›</button></td>
    </tr>`).join('');

  const q = $('#pl-search').value.trim().toLowerCase();
  const off = (players.offline || []).filter((p) => !q || p.name.toLowerCase().includes(q));
  $('#pl-offline-count').textContent = (players.offline || []).length;
  $('#pl-offline').innerHTML = off.slice(0, 200).map((p) => `
    <tr class="clickable" data-uuid="${p.uuid}">
      <td>${nameCell(p)}</td>
      <td class="muted">${p.lastSeen ? new Date(p.lastSeen).toLocaleString('ko-KR') : '-'}</td>
      <td class="muted">오프라인</td>
      <td><button class="btn small">관리 ›</button></td>
    </tr>`).join('');

  if (invView && currentTab === 'player') {
    const all = [...on, ...(players.offline || [])];
    const p = all.find((x) => x.uuid === invView.uuid);
    if (p) invView.updatePlayer(p);
  }
}

function findPlayer(uuid) {
  return [...(players.online || []), ...(players.offline || [])].find((p) => p.uuid === uuid);
}

for (const id of ['#pl-online', '#pl-offline']) {
  $(id).addEventListener('click', (e) => {
    const tr = e.target.closest('tr[data-uuid]');
    if (!tr) return;
    const p = findPlayer(tr.dataset.uuid);
    if (!p) return;
    showTab('player');
    invView.open(p);
  });
}
$('#pl-search').addEventListener('input', renderPlayers);
// 머리 이미지가 없으면 숨김 (CSP 때문에 인라인 onerror 대신 여기서 처리)
document.addEventListener('error', (e) => {
  if (e.target instanceof HTMLImageElement && e.target.classList.contains('avatar')) e.target.style.visibility = 'hidden';
}, true);

// ================================================================ 콘솔

function addConsoleLine(line) {
  consoleLines.push(line);
  const log = $('#con-log');
  if (consoleLines.length > CONSOLE_MAX) {
    consoleLines.shift();
    if (log.firstChild) log.removeChild(log.firstChild);
  }
  const span = document.createElement('div');
  const lvl = (line.match(/^\[\d\d:\d\d:\d\d (\w+)\]/) || [])[1] || '';
  span.className = lvl + (line.includes('[웹 콘솔] >') ? ' cmd' : '');
  span.textContent = line;
  const f = $('#con-filter').value.trim().toLowerCase();
  if (f && !line.toLowerCase().includes(f)) span.hidden = true;
  log.appendChild(span);
  scrollConsole();
}

function scrollConsole(force = false) {
  const log = $('#con-log');
  if (force || $('#con-autoscroll').checked) log.scrollTop = log.scrollHeight;
}

$('#con-filter').addEventListener('input', () => {
  const f = $('#con-filter').value.trim().toLowerCase();
  for (const el of $('#con-log').children) el.hidden = !!f && !el.textContent.toLowerCase().includes(f);
});

$('#con-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const input = $('#con-input');
  const cmd = input.value.trim();
  if (!cmd) return;
  cmdHistory.unshift(cmd);
  if (cmdHistory.length > 50) cmdHistory.pop();
  cmdIndex = -1;
  input.value = '';
  try { await client.request('console.command', { command: cmd }); } catch (err) { toast(err.message, true); }
});

$('#con-input').addEventListener('keydown', (e) => {
  if (e.key === 'ArrowUp' && cmdIndex < cmdHistory.length - 1) {
    cmdIndex++;
    e.target.value = cmdHistory[cmdIndex];
    e.preventDefault();
  } else if (e.key === 'ArrowDown') {
    cmdIndex = Math.max(-1, cmdIndex - 1);
    e.target.value = cmdIndex >= 0 ? cmdHistory[cmdIndex] : '';
    e.preventDefault();
  }
});

// ================================================================ 서버 설정 (실시간)

function setIfIdle(el, value) {
  // 사용자가 지금 입력 중인 칸은 덮어쓰지 않는다
  if (document.activeElement === el) return;
  if (el.type === 'checkbox') el.checked = !!value;
  else el.value = value;
}

const WEATHER = { clear: '맑음', rain: '비', thunder: '뇌우' };

function renderSettings() {
  if (!settings) return;
  setIfIdle($('#set-motd'), settings.motd);
  setIfIdle($('#set-maxPlayers'), settings.maxPlayers);
  setIfIdle($('#set-defaultGameMode'), settings.defaultGameMode);
  setIfIdle($('#set-whitelist'), settings.whitelist);
  setIfIdle($('#set-whitelistEnforced'), settings.whitelistEnforced);
  $('#set-distance').textContent = `시야 거리 ${settings.viewDistance} · 시뮬레이션 거리 ${settings.simulationDistance} (server.properties 에서 변경)`;

  const sel = $('#set-world');
  const names = settings.worlds.map((w) => w.name);
  if (!selectedWorld || !names.includes(selectedWorld)) selectedWorld = names[0];
  if (sel.dataset.names !== names.join('|')) {
    sel.dataset.names = names.join('|');
    sel.innerHTML = names.map((n) => `<option>${escapeHtml(n)}</option>`).join('');
  }
  sel.value = selectedWorld;
  const w = settings.worlds.find((x) => x.name === selectedWorld);
  if (!w) return;
  setIfIdle($('#set-difficulty'), w.difficulty);
  setIfIdle($('#set-pvp'), w.pvp);
  const hh = Math.floor(((w.time + 6000) % 24000) / 1000);
  const mm = Math.floor(((w.time + 6000) % 1000) * 0.06);
  $('#set-time-now').textContent = `현재 ${w.time} (게임 시각 ${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}, ${Math.floor(w.fullTime / 24000) + 1}일째)`;
  $('#set-weather-now').textContent = `현재 ${WEATHER[w.weather]}`;
  $$('[data-weather]').forEach((b) => b.classList.toggle('on', b.dataset.weather === w.weather));
  renderGamerules(w);
}

function renderGamerules(w) {
  const box = $('#gamerules');
  const q = $('#gr-search').value.trim().toLowerCase();
  const entries = Object.entries(w.gamerules).filter(([k]) => !q || k.toLowerCase().includes(q)).sort(([a], [b]) => a.localeCompare(b));
  const key = w.name + '|' + q + '|' + entries.map(([k]) => k).join(',');
  if (box.dataset.key !== key) {
    box.dataset.key = key;
    box.innerHTML = '';
    for (const [name, value] of entries) {
      const row = document.createElement('div');
      row.className = 'gr-item';
      row.innerHTML = `<span class="gr-name" title="${name}">${name}</span>`;
      let input;
      if (typeof value === 'boolean') {
        const label = document.createElement('label');
        label.className = 'switch';
        input = document.createElement('input');
        input.type = 'checkbox';
        label.append(input, document.createElement('i'));
        input.addEventListener('change', () => setGamerule(name, String(input.checked)));
        row.appendChild(label);
      } else {
        input = document.createElement('input');
        input.type = 'number';
        input.addEventListener('change', () => setGamerule(name, input.value));
        input.addEventListener('keydown', (e) => { if (e.key === 'Enter') input.blur(); });
        row.appendChild(input);
      }
      input.dataset.rule = name;
      box.appendChild(row);
    }
  }
  for (const input of box.querySelectorAll('input[data-rule]')) setIfIdle(input, w.gamerules[input.dataset.rule]);
}

async function reloadSettings() {
  try {
    settings = await client.request('server.settings');
    renderSettings();
  } catch (e) { toast('서버 설정을 불러오지 못했습니다: ' + e.message, true); }
}

async function setGamerule(rule, value) {
  if (!selectedWorld) { reloadSettings(); return; }
  try {
    settings = await client.request('server.gamerule', { world: selectedWorld, rule, value });
    toast(`${rule} = ${value}`);
    renderSettings();
  } catch (e) { toast(e.message, true); renderSettings(); }
}

async function applySetting(key, value, world) {
  if (arguments.length >= 3 && !world) {
    toast('월드 목록을 아직 받지 못했습니다. 잠시 후 다시 시도하거나 새로고침하세요', true);
    reloadSettings();
    return;
  }
  try {
    settings = await client.request('server.setting', { key, value, world });
    toast('적용했습니다');
    renderSettings();
  } catch (e) { toast(e.message, true); }
}

$$('[data-apply]').forEach((b) => b.addEventListener('click', () => {
  const key = b.dataset.apply;
  const el = $(`#set-${key}`);
  applySetting(key, el.type === 'number' ? Number(el.value) : el.value);
}));
$$('[data-auto]').forEach((el) => el.addEventListener('change', () => {
  applySetting(el.dataset.auto, el.type === 'checkbox' ? el.checked : el.value);
}));
$$('[data-world-auto]').forEach((el) => el.addEventListener('change', () => {
  applySetting(el.dataset.worldAuto, el.type === 'checkbox' ? el.checked : el.value, selectedWorld);
}));
$$('[data-time]').forEach((b) => b.addEventListener('click', () => applySetting('time', b.dataset.time, selectedWorld)));
$('#set-time-btn').addEventListener('click', () => applySetting('time', $('#set-time-custom').value, selectedWorld));
$$('[data-weather]').forEach((b) => b.addEventListener('click', () => applySetting('weather', b.dataset.weather, selectedWorld)));
$('#set-world').addEventListener('change', (e) => { selectedWorld = e.target.value; $('#gamerules').dataset.key = ''; renderSettings(); });
$('#gr-search').addEventListener('input', () => renderSettings());

// ================================================================ server.properties

async function loadProperties() {
  try {
    const res = await client.request('server.properties.get');
    propsOriginal = {};
    const box = $('#props');
    box.innerHTML = '';
    for (const { key, value } of res.properties.sort((a, b) => a.key.localeCompare(b.key))) {
      propsOriginal[key] = value;
      const row = document.createElement('div');
      row.className = 'prop';
      row.dataset.key = key;
      const span = document.createElement('span');
      span.textContent = key;
      span.title = key;
      const input = document.createElement('input');
      input.value = value;
      input.spellcheck = false;
      if (/password|secret/i.test(key)) input.type = 'password';
      input.addEventListener('input', () => row.classList.toggle('changed', input.value !== propsOriginal[key]));
      row.append(span, input);
      box.appendChild(row);
    }
    filterProps();
  } catch (e) { toast(e.message, true); }
}

function filterProps() {
  const q = $('#prop-search').value.trim().toLowerCase();
  for (const row of $('#props').children) row.hidden = !!q && !row.dataset.key.includes(q);
}

$('#prop-search').addEventListener('input', filterProps);
$('#prop-reload').addEventListener('click', loadProperties);
$('#prop-save').addEventListener('click', async () => {
  const values = {};
  for (const row of $('#props').children) {
    const v = row.querySelector('input').value;
    if (v !== propsOriginal[row.dataset.key]) values[row.dataset.key] = v;
  }
  if (!Object.keys(values).length) { toast('바뀐 항목이 없습니다'); return; }
  if (!confirm(`${Object.keys(values).length}개 항목을 저장할까요?\n${Object.keys(values).join(', ')}\n\n서버 재시작 후 적용됩니다.`)) return;
  try {
    await client.request('server.properties.set', { values });
    toast('저장했습니다. 서버를 재시작하면 적용됩니다');
    loadProperties();
  } catch (e) { toast(e.message, true); }
});

// ================================================================ 시작

const saved = loadSaved();
if (saved && saved.url && saved.token) {
  showLogin();
  login(saved.url, saved.token, (() => { try { return !!localStorage.getItem(STORE_KEY); } catch { return false; } })());
} else {
  showLogin();
}
