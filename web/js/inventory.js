// 플레이어 상세 화면: 정보/관리 버튼, 인벤토리·엔더상자 실시간 표시, 끌어서 옮기기, 아이템 편집.

import { renderItem, attachTooltip, hideTooltip, prettyName, shortId, displayName, warmIcons } from './items.js';

const $ = (s) => document.querySelector(s);
const PALETTE_LIMIT = 400;

export class InventoryView {
  constructor(client, ui) {
    this.client = client;
    this.ui = ui; // { toast, confirm, prompt, onlinePlayers() }
    this.uuid = null;
    this.player = null;
    this.items = { inventory: [], ender: [] };
    this.online = false;
    this.selected = null;     // { type, slot }
    this.editorOrig = null;   // 편집 시작 시점의 아이템
    this.editorDirty = false;
    this.edEnchants = {};
    this.registry = { items: [], enchants: [] };
    this.slotEls = [];

    this.buildGrids();
    this.bindEditor();
    this.bindPalette();
    this.bindMisc();
    client.on('inv', (snap) => this.onSnapshot(snap));
  }

  setClient(client) {
    this.client = client;
    client.on('inv', (snap) => this.onSnapshot(snap));
  }

  // ------------------------------------------------------------ 열기/닫기

  async open(player) {
    if (this.uuid && this.uuid !== player.uuid) this.unsubscribe();
    this.uuid = player.uuid;
    this.player = player;
    this.closeEditor();
    this.items = { inventory: [], ender: [] };
    this.renderAll();
    this.renderHeader();
    await this.loadRegistry();
    await this.subscribe();
  }

  async subscribe() {
    if (!this.uuid) return;
    try {
      const both = await this.client.request('inv.subscribe', { uuid: this.uuid });
      this.onSnapshot(both.inventory, true);
      this.onSnapshot(both.ender, true);
    } catch (e) {
      this.ui.toast(e.message, true);
    }
  }

  unsubscribe() {
    if (!this.uuid) return;
    this.client.request('inv.unsubscribe', { uuid: this.uuid }).catch(() => {});
  }

  close() {
    this.unsubscribe();
    this.uuid = null;
    this.closeEditor();
    hideTooltip();
  }

  /** 접속자 정보가 갱신될 때 app.js 가 호출 */
  updatePlayer(player) {
    if (!this.uuid || player.uuid !== this.uuid) return;
    this.player = player;
    this.renderHeader();
  }

  async loadRegistry() {
    if (this.registry.items.length) return;
    try {
      this.registry = await this.client.request('registry.items');
      $('#dl-items').innerHTML = this.registry.items.map((id) => `<option value="${shortId(id)}">`).join('');
      this.renderPalette();
      warmIcons(this.registry.items, 150);
    } catch (e) {
      this.ui.toast('아이템 목록을 불러오지 못했습니다: ' + e.message, true);
    }
  }

  // ------------------------------------------------------------ 실시간 반영

  onSnapshot(snap, initial = false) {
    if (!snap || snap.uuid !== this.uuid) return;
    const prev = this.items[snap.type] || [];
    this.items[snap.type] = snap.items;
    this.online = snap.online;
    this.hasData = snap.online || snap.hasData;
    const note = $('#inv-offline');
    note.classList.toggle('hidden', snap.online);
    note.textContent = snap.hasData
      ? '오프라인 플레이어입니다. 서버의 저장 파일을 직접 수정합니다. (접속하면 자동으로 실시간 모드로 바뀝니다)'
      : '이 플레이어의 저장 파일이 없어 표시할 수 없습니다. (한 번도 접속하지 않았을 수 있음)';
    $('#pd-live').classList.toggle('off', !snap.online);
    $('#pd-live').textContent = snap.online ? '실시간 동기화' : '오프라인 · 저장 파일 편집';

    for (const el of this.slotEls) {
      if (el.dataset.type !== snap.type) continue;
      const i = +el.dataset.slot;
      const item = snap.items[i] || null;
      const before = prev[i] || null;
      if (JSON.stringify(item) !== JSON.stringify(before)) {
        renderItem(el, item);
        el.draggable = !!item;
        if (!initial) {
          el.classList.remove('flash');
          void el.offsetWidth;
          el.classList.add('flash');
        }
      }
    }

    // 편집 중인 칸이 인게임에서 바뀐 경우
    if (this.selected && this.selected.type === snap.type) {
      const now = snap.items[this.selected.slot] || null;
      if (JSON.stringify(now) !== JSON.stringify(this.editorOrig)) {
        if (this.editorDirty) $('#ed-changed').classList.remove('hidden');
        else this.openEditor(this.selected.type, this.selected.slot);
      }
    }
  }

  // ------------------------------------------------------------ 칸 만들기

  buildGrids() {
    const make = (parent, type, from, to) => {
      for (let i = from; i <= to; i++) {
        const d = document.createElement('div');
        d.className = 'slot';
        d.dataset.type = type;
        d.dataset.slot = i;
        parent.appendChild(d);
      }
    };
    make($('#inv-main'), 'inventory', 9, 35);
    make($('#inv-hotbar'), 'inventory', 0, 8);
    make($('#inv-ender'), 'ender', 0, 26);

    this.slotEls = [...document.querySelectorAll('#tab-player .inv-card .slot')];
    for (const el of this.slotEls) this.bindSlot(el);
  }

  itemAt(type, slot) {
    return (this.items[type] || [])[slot] || null;
  }

  bindSlot(el) {
    const type = el.dataset.type;
    const slot = +el.dataset.slot;
    attachTooltip(el, () => this.itemAt(type, slot));

    el.addEventListener('click', () => this.openEditor(type, slot));
    el.addEventListener('dragstart', (e) => {
      if (!this.itemAt(type, slot)) { e.preventDefault(); return; }
      hideTooltip();
      e.dataTransfer.setData('text/plain', JSON.stringify({ src: 'slot', type, slot }));
      e.dataTransfer.effectAllowed = 'move';
    });
    el.addEventListener('dragover', (e) => { e.preventDefault(); el.classList.add('drop-target'); });
    el.addEventListener('dragleave', () => el.classList.remove('drop-target'));
    el.addEventListener('drop', (e) => {
      e.preventDefault();
      el.classList.remove('drop-target');
      let src;
      try { src = JSON.parse(e.dataTransfer.getData('text/plain')); } catch { return; }
      this.handleDrop(src, type, slot, e.shiftKey);
    });
  }

  async handleDrop(src, toType, toSlot, half) {
    if (!this.uuid) return;
    try {
      if (src.src === 'slot') {
        if (src.type === toType && src.slot === toSlot) return;
        const item = this.itemAt(src.type, src.slot);
        const amount = half && item && item.amount > 1 ? Math.ceil(item.amount / 2) : -1;
        await this.client.request('inv.move', {
          uuid: this.uuid, fromType: src.type, fromSlot: src.slot, toType, toSlot, amount,
        });
      } else if (src.src === 'palette') {
        await this.client.request('inv.set', {
          uuid: this.uuid, type: toType, slot: toSlot, item: { id: src.id, amount: this.paletteAmount() },
        });
      }
    } catch (e) {
      this.ui.toast(e.message, true);
    }
  }

  renderAll() {
    for (const el of this.slotEls) {
      const item = this.itemAt(el.dataset.type, +el.dataset.slot);
      renderItem(el, item);
      el.draggable = !!item;
      el.classList.remove('selected');
    }
  }

  // ------------------------------------------------------------ 기타 버튼

  bindMisc() {
    const trash = $('#trash');
    trash.addEventListener('dragover', (e) => { e.preventDefault(); trash.classList.add('drop-target'); });
    trash.addEventListener('dragleave', () => trash.classList.remove('drop-target'));
    trash.addEventListener('drop', async (e) => {
      e.preventDefault();
      trash.classList.remove('drop-target');
      let src;
      try { src = JSON.parse(e.dataTransfer.getData('text/plain')); } catch { return; }
      if (src.src !== 'slot') return;
      try {
        await this.client.request('inv.set', { uuid: this.uuid, type: src.type, slot: src.slot, item: null });
        if (this.selected && this.selected.type === src.type && this.selected.slot === src.slot) this.closeEditor();
      } catch (err) { this.ui.toast(err.message, true); }
    });

    document.querySelectorAll('[data-clear]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const type = btn.dataset.clear;
        const label = type === 'ender' ? '엔더상자' : '인벤토리';
        if (!(await this.ui.confirm(`${this.player?.name} 의 ${label}를 전부 비울까요? 되돌릴 수 없습니다.`))) return;
        try {
          await this.client.request('inv.clear', { uuid: this.uuid, type });
          this.closeEditor();
          this.ui.toast(`${label}를 비웠습니다`);
        } catch (e) { this.ui.toast(e.message, true); }
      });
    });
  }

  // ------------------------------------------------------------ 상단 정보 + 관리 버튼

  renderHeader() {
    const p = this.player;
    if (!p) return;
    $('#pd-name').textContent = p.name;
    const face = $('#pd-face');
    face.src = `https://mc-heads.net/avatar/${p.uuid}/48`;
    face.onerror = () => { face.removeAttribute('src'); };
    const tags = [p.op ? 'OP' : null, p.whitelisted ? '화이트리스트' : null, p.banned ? '차단됨' : null].filter(Boolean);
    $('#pd-info').textContent = p.online
      ? `체력 ${p.health}/${p.maxHealth} · 배고픔 ${p.food}/20 · 레벨 ${p.level} · ${p.world} (${p.x}, ${p.y}, ${p.z}) · 핑 ${p.ping}ms ${tags.length ? '· ' + tags.join(', ') : ''}`
      : `오프라인 ${tags.length ? '· ' + tags.join(', ') : ''}`;

    // 입력 중인 칸이 있으면 버튼을 다시 그리지 않는다 (입력 내용 보존)
    const box = $('#pd-actions');
    const key = `${p.uuid}|${p.online}|${p.op}|${p.whitelisted}|${p.banned}|${p.gamemode}|${this.ui.onlinePlayers().map((o) => o.uuid).join(',')}`;
    if (box.dataset.key === key) return;
    if (box.contains(document.activeElement) && document.activeElement.tagName === 'INPUT') return;
    box.dataset.key = key;
    box.innerHTML = '';

    const btn = (label, fn, cls = '') => {
      const b = document.createElement('button');
      b.className = `btn small ${cls}`;
      b.textContent = label;
      b.addEventListener('click', fn);
      box.appendChild(b);
      return b;
    };
    const act = (type, value, okMsg) => this.client.request('player.action', { uuid: p.uuid, type, value })
      .then(() => okMsg && this.ui.toast(okMsg))
      .catch((e) => this.ui.toast(e.message, true));

    if (p.online) {
      const gm = document.createElement('select');
      gm.innerHTML = [['SURVIVAL', '서바이벌'], ['CREATIVE', '크리에이티브'], ['ADVENTURE', '모험'], ['SPECTATOR', '관전']]
        .map(([v, l]) => `<option value="${v}" ${p.gamemode === v ? 'selected' : ''}>${l}</option>`).join('');
      gm.addEventListener('change', () => act('gamemode', gm.value, '게임모드 변경'));
      box.appendChild(gm);
      btn('회복', () => act('heal', null, '체력 회복'));
      btn('배고픔 채우기', () => act('feed', null, '배고픔 회복'));
      btn('레벨 설정', async () => {
        const v = await this.ui.prompt('설정할 레벨', String(p.level));
        if (v !== null) act('level', v, '레벨 변경');
      });
      btn('스폰으로 이동', () => act('tpspawn', null, '스폰으로 이동'));
      const others = this.ui.onlinePlayers().filter((o) => o.uuid !== p.uuid);
      if (others.length) {
        const sel = document.createElement('select');
        sel.innerHTML = '<option value="">플레이어에게 이동…</option>' +
          others.map((o) => `<option value="${o.uuid}">${escapeHtml(o.name)}</option>`).join('');
        sel.addEventListener('change', () => { if (sel.value) act('tpto', sel.value, '텔레포트'); sel.value = ''; });
        box.appendChild(sel);
      }
      btn('메시지', async () => {
        const v = await this.ui.prompt(`${p.name} 에게 보낼 메시지 (&색코드 가능)`, '');
        if (v) act('message', v, '메시지 전송');
      });
      btn('킬', async () => {
        if (await this.ui.confirm(`${p.name} 를 죽일까요? (아이템이 떨어질 수 있음)`)) act('kill', null, '처리됨');
      }, 'danger');
      btn('추방', async () => {
        const v = await this.ui.prompt('추방 사유 (비워도 됨)', '');
        if (v !== null) act('kick', v, '추방했습니다');
      }, 'danger');
    }
    btn(p.op ? 'OP 해제' : 'OP 주기', () => act(p.op ? 'deop' : 'op', null, p.op ? 'OP 해제' : 'OP 지급'));
    btn(p.whitelisted ? '화이트리스트 제거' : '화이트리스트 추가', () => act(p.whitelisted ? 'unwhitelist' : 'whitelist', null, '화이트리스트 변경'));
    if (p.banned) btn('차단 해제', () => act('unban', null, '차단 해제'));
    else btn('차단(밴)', async () => {
      const v = await this.ui.prompt(`${p.name} 차단 사유 (비워도 됨)`, '');
      if (v !== null) act('ban', v, '차단했습니다');
    }, 'danger');
  }

  // ------------------------------------------------------------ 편집기

  bindEditor() {
    $('#ed-close').addEventListener('click', () => this.closeEditor());
    for (const id of ['#ed-type', '#ed-amount', '#ed-name', '#ed-lore', '#ed-damage']) {
      $(id).addEventListener('input', () => { this.editorDirty = true; this.previewEditor(); });
    }
    $('#ed-ench-btn').addEventListener('click', () => {
      const id = $('#ed-ench-add').value;
      const lv = Math.max(1, Math.min(255, +$('#ed-ench-level').value || 1));
      if (!id) return;
      this.edEnchants[id] = lv;
      this.editorDirty = true;
      this.renderEnchants();
    });
    $('#ed-save').addEventListener('click', () => this.saveEditor());
    $('#ed-delete').addEventListener('click', async () => {
      if (!this.selected) return;
      try {
        await this.client.request('inv.set', { uuid: this.uuid, ...this.selected, item: null });
        this.closeEditor();
      } catch (e) { this.ui.toast(e.message, true); }
    });
    $('#ed-dup').addEventListener('click', async () => {
      const item = this.editorItem();
      if (!item) return;
      try {
        await this.client.request('inv.give', { uuid: this.uuid, type: 'inventory', item });
        this.ui.toast('인벤토리에 하나 더 넣었습니다');
      } catch (e) { this.ui.toast(e.message, true); }
    });
  }

  openEditor(type, slot) {
    this.selected = { type, slot };
    this.slotEls.forEach((el) => el.classList.toggle('selected', el.dataset.type === type && +el.dataset.slot === slot));
    const item = this.itemAt(type, slot);
    this.editorOrig = item;
    this.editorDirty = false;
    $('#editor').classList.remove('hidden');
    $('#ed-changed').classList.add('hidden');
    $('#ed-title').textContent = item ? '아이템 편집' : '빈 칸에 아이템 넣기';
    $('#ed-where').textContent = slotLabel(type, slot);
    $('#ed-type').value = item ? shortId(item.id) : '';
    $('#ed-amount').value = item ? item.amount : 1;
    $('#ed-name').value = item?.name || '';
    $('#ed-lore').value = (item?.lore || []).join('\n');
    $('#ed-damage-wrap').classList.toggle('hidden', !item?.maxDamage);
    $('#ed-damage').value = item?.damage || 0;
    $('#ed-damage-max').textContent = item?.maxDamage ? `(0 = 새것, 최대 ${item.maxDamage})` : '';
    this.edEnchants = { ...(item?.enchants || {}) };
    $('#ed-ench-add').innerHTML = '<option value="">마법부여 선택</option>' +
      this.registry.enchants.map((e) => `<option value="${e.id}">${prettyName(e.id)} (최대 ${e.maxLevel})</option>`).join('');
    $('#ed-delete').disabled = !item;
    $('#ed-dup').disabled = !item;
    this.renderEnchants();
    this.previewEditor();
  }

  closeEditor() {
    this.selected = null;
    this.editorOrig = null;
    $('#editor').classList.add('hidden');
    this.slotEls.forEach((el) => el.classList.remove('selected'));
  }

  renderEnchants() {
    const box = $('#ed-enchants');
    box.innerHTML = '';
    const entries = Object.entries(this.edEnchants);
    if (!entries.length) box.innerHTML = '<div class="muted">없음</div>';
    for (const [id, lv] of entries) {
      const row = document.createElement('div');
      row.className = 'ench-item';
      row.innerHTML = `<span>${prettyName(id)}</span>`;
      const right = document.createElement('div');
      right.className = 'row';
      const input = document.createElement('input');
      input.type = 'number'; input.min = 1; input.max = 255; input.value = lv;
      input.addEventListener('input', () => { this.edEnchants[id] = Math.max(1, Math.min(255, +input.value || 1)); this.editorDirty = true; });
      const del = document.createElement('button');
      del.className = 'btn small ghost';
      del.textContent = '삭제';
      del.addEventListener('click', () => { delete this.edEnchants[id]; this.editorDirty = true; this.renderEnchants(); });
      right.append(input, del);
      row.appendChild(right);
      box.appendChild(row);
    }
  }

  previewEditor() {
    const id = normalizeId($('#ed-type').value);
    const amount = +$('#ed-amount').value || 1;
    $('#ed-id').textContent = id || '(종류를 입력하세요)';
    renderItem($('#ed-icon'), id ? { id, amount, enchants: this.edEnchants } : null);
  }

  /** 편집기 내용 → 서버로 보낼 아이템 JSON */
  editorItem() {
    const id = normalizeId($('#ed-type').value);
    if (!id) { this.ui.toast('아이템 종류를 입력하세요', true); return null; }
    if (this.registry.items.length && !this.registry.items.includes(id)) {
      this.ui.toast('알 수 없는 아이템입니다: ' + id, true);
      return null;
    }
    const amount = parseInt($('#ed-amount').value, 10);
    if (!(amount >= 1 && amount <= 99)) { this.ui.toast('개수는 1~99', true); return null; }
    const item = {
      id,
      amount,
      name: $('#ed-name').value,
      lore: $('#ed-lore').value.split('\n').map((s) => s.trimEnd()).filter((s) => s.length),
      enchants: this.edEnchants,
    };
    const orig = this.editorOrig;
    if (orig && orig.data) item.data = orig.data; // 원본 정보(포션 효과, 염료 등) 보존
    if (orig?.maxDamage && orig.id === id) item.damage = Math.max(0, parseInt($('#ed-damage').value, 10) || 0);
    return item;
  }

  async saveEditor() {
    if (!this.selected) return;
    const item = this.editorItem();
    if (!item) return;
    try {
      const snap = await this.client.request('inv.set', { uuid: this.uuid, ...this.selected, item });
      this.editorDirty = false;
      this.onSnapshot(snap);
      this.openEditor(this.selected.type, this.selected.slot);
      this.ui.toast('저장했습니다');
    } catch (e) { this.ui.toast(e.message, true); }
  }

  // ------------------------------------------------------------ 아이템 목록 (팔레트)

  bindPalette() {
    $('#pal-search').addEventListener('input', () => this.renderPalette());
  }

  paletteAmount() {
    return Math.max(1, Math.min(99, parseInt($('#pal-amount').value, 10) || 1));
  }

  renderPalette() {
    const q = $('#pal-search').value.trim().toLowerCase().replace(/\s+/g, '_');
    const grid = $('#pal-grid');
    grid.innerHTML = '';
    const list = this.registry.items.filter((id) => !q || id.includes(q)).slice(0, PALETTE_LIMIT);
    for (const id of list) {
      const el = document.createElement('div');
      el.className = 'slot';
      el.draggable = true;
      const item = { id, amount: 1 };
      renderItem(el, item, { lazy: true });
      attachTooltip(el, () => item);
      el.addEventListener('dragstart', (e) => {
        hideTooltip();
        e.dataTransfer.setData('text/plain', JSON.stringify({ src: 'palette', id }));
        e.dataTransfer.effectAllowed = 'copy';
      });
      el.addEventListener('click', () => this.paletteClick(id));
      grid.appendChild(el);
    }
    if (!list.length) grid.innerHTML = '<div class="muted">결과 없음</div>';
  }

  async paletteClick(id) {
    if (!this.uuid) return;
    const amount = this.paletteAmount();
    try {
      // 빈 칸을 선택해 둔 상태면 그 칸에, 아니면 인벤토리 빈 곳에 넣는다
      if (this.selected && !this.itemAt(this.selected.type, this.selected.slot)) {
        await this.client.request('inv.set', { uuid: this.uuid, ...this.selected, item: { id, amount } });
        this.openEditor(this.selected.type, this.selected.slot);
      } else {
        await this.client.request('inv.give', { uuid: this.uuid, type: 'inventory', item: { id, amount } });
        this.ui.toast(`${prettyName(id)} ×${amount} 지급`);
      }
    } catch (e) { this.ui.toast(e.message, true); }
  }
}

function normalizeId(v) {
  const s = String(v || '').trim().toLowerCase().replace(/\s+/g, '_');
  if (!s) return '';
  return s.includes(':') ? s : `minecraft:${s}`;
}

function slotLabel(type, slot) {
  if (type === 'ender') return `엔더상자 ${slot + 1}번 칸`;
  if (slot <= 8) return `핫바 ${slot + 1}번 칸`;
  if (slot <= 35) return `가방 ${slot - 8}번 칸`;
  return { 36: '신발 칸', 37: '바지 칸', 38: '흉갑 칸', 39: '투구 칸', 40: '왼손 칸' }[slot];
}

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export { displayName };
