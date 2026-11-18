// 플레이어 상세 화면: 정보/관리 버튼, 인벤토리·엔더상자·셜커 상자 실시간 표시, 끌어서 옮기기, 아이템 편집.
//
// 칸 종류(type): "inventory", "ender", "shulker:<inventory|ender>:<칸번호>" (셜커 상자 안쪽)

import {
  renderItem, attachTooltip, hideTooltip, shortId, displayName, warmIcons, itemName, enchName, roman,
} from './items.js';

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
    this.shulker = null;      // { parentType, parentSlot } 열어 둔 셜커 상자
    this.paletteMode = 'items';

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
    this.offStats = null;     // 오프라인 플레이어의 저장 파일 상태 (체력, 배고픔 등)
    this.offStatsFor = null;
    this.closeEditor();
    this.closeShulker();
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
    this.closeShulker();
    hideTooltip();
  }

  /** 접속자 정보가 갱신될 때 app.js 가 호출 */
  updatePlayer(player) {
    if (!this.uuid || player.uuid !== this.uuid) return;
    // 방금 나갔으면 저장 파일 상태를 새로 읽는다
    if (this.player?.online && !player.online) { this.offStats = null; this.offStatsFor = null; }
    this.player = player;
    this.renderHeader();
  }

  /** 오프라인 플레이어의 체력/배고픔/게임모드 등을 저장 파일에서 읽어 온다 */
  async loadOfflineStats() {
    const p = this.player;
    if (!p || p.online) return;
    this.offStatsFor = p.uuid;
    try {
      const st = await this.client.request('player.offline', { uuid: p.uuid });
      if (this.player?.uuid !== p.uuid) return;
      this.offStats = st;
    } catch (e) {
      this.offStats = { hasData: false, error: e.message };
    }
    this.renderHeader();
  }

  async loadRegistry() {
    if (this.registry.items.length) return;
    try {
      this.registry = await this.client.request('registry.items');
      this.fillDatalist();
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

    // 열어 둔 셜커 상자 갱신
    if (this.shulker && this.shulker.parentType === snap.type) {
      if (!this.itemAt(snap.type, this.shulker.parentSlot)?.contents) {
        this.closeShulker();
        if (!initial) this.ui.toast('열어 둔 셜커 상자가 그 칸에서 사라졌습니다');
      } else {
        this.renderShulker(prev, initial);
      }
    }

    // 편집 중인 칸이 인게임에서 바뀐 경우
    if (this.selected && baseType(this.selected.type) === snap.type) {
      const now = this.itemAt(this.selected.type, this.selected.slot);
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

    make($('#sh-grid'), 'shulker:none:0', 0, 26);

    this.slotEls = [...document.querySelectorAll('#tab-player .inv-card .slot, #sh-grid .slot')];
    this.shulkerEls = [...document.querySelectorAll('#sh-grid .slot')];
    for (const el of this.slotEls) this.bindSlot(el);
  }

  itemAt(type, slot) {
    if (type.startsWith('shulker:')) {
      const [, pt, ps] = type.split(':');
      return this.itemAt(pt, +ps)?.contents?.[slot] || null;
    }
    return (this.items[type] || [])[slot] || null;
  }

  bindSlot(el) {
    // 셜커 칸은 어떤 상자를 여느냐에 따라 type 이 바뀌므로 매번 읽는다
    const type = () => el.dataset.type;
    const slot = +el.dataset.slot;
    attachTooltip(el, () => this.itemAt(type(), slot));

    el.addEventListener('click', () => this.openEditor(type(), slot));
    el.addEventListener('dragstart', (e) => {
      if (!this.itemAt(type(), slot)) { e.preventDefault(); return; }
      hideTooltip();
      e.dataTransfer.setData('text/plain', JSON.stringify({ src: 'slot', type: type(), slot }));
      e.dataTransfer.effectAllowed = 'move';
    });
    el.addEventListener('dragover', (e) => { e.preventDefault(); el.classList.add('drop-target'); });
    el.addEventListener('dragleave', () => el.classList.remove('drop-target'));
    el.addEventListener('drop', (e) => {
      e.preventDefault();
      el.classList.remove('drop-target');
      let src;
      try { src = JSON.parse(e.dataTransfer.getData('text/plain')); } catch { return; }
      this.handleDrop(src, type(), slot, e.shiftKey);
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
          uuid: this.uuid, type: toType, slot: toSlot, item: this.paletteItem(src.item, true),
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
        if (this.shulker && src.type === this.shulker.parentType && src.slot === this.shulker.parentSlot) this.closeShulker();
      } catch (err) { this.ui.toast(err.message, true); }
    });

    document.querySelectorAll('[data-clear]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const type = btn.dataset.clear === 'shulker' ? this.shulkerType() : btn.dataset.clear;
        if (!type) return;
        const label = type === 'ender' ? '엔더상자' : type === 'inventory' ? '인벤토리' : '셜커 상자';
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
    if (!p.online && this.offStatsFor !== p.uuid) this.loadOfflineStats();
    const st = p.online ? p : (this.offStats?.hasData ? this.offStats : null);
    const where = st && st.x !== undefined ? ` · ${st.world} (${st.x}, ${st.y}, ${st.z})` : '';
    const stText = st ? `체력 ${st.health}/${st.maxHealth} · 배고픔 ${st.food}/20 · 레벨 ${st.level} · ${GM_LABEL[st.gamemode] || st.gamemode}${where}` : '';
    $('#pd-info').textContent = p.online
      ? `${stText} · 핑 ${p.ping}ms ${tags.length ? '· ' + tags.join(', ') : ''}`
      : `오프라인${st ? ' · ' + stText : ''} ${tags.length ? '· ' + tags.join(', ') : ''}`;

    // 입력 중인 칸이 있으면 버튼을 다시 그리지 않는다 (입력 내용 보존)
    const box = $('#pd-actions');
    const key = `${p.uuid}|${p.online}|${p.op}|${p.whitelisted}|${p.banned}|${p.gamemode}|${st?.gamemode}|${this.ui.onlinePlayers().map((o) => o.uuid).join(',')}`;
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
    // 오프라인이면 저장 파일을 고친다 → 다음에 접속할 때 적용
    const act = (type, value, okMsg) => this.client.request('player.action', { uuid: p.uuid, type, value })
      .then(() => {
        if (okMsg) this.ui.toast(p.online ? okMsg : `${okMsg} (다음 접속 때 적용)`);
        if (!p.online) this.loadOfflineStats();
      })
      .catch((e) => this.ui.toast(e.message, true));

    if (st) {
      const gm = document.createElement('select');
      gm.innerHTML = Object.entries(GM_LABEL)
        .map(([v, l]) => `<option value="${v}" ${st.gamemode === v ? 'selected' : ''}>${l}</option>`).join('');
      gm.addEventListener('change', () => act('gamemode', gm.value, '게임모드 변경'));
      box.appendChild(gm);
      btn('회복', () => act('heal', null, '체력 회복'));
      btn('배고픔 채우기', () => act('feed', null, '배고픔 회복'));
      btn('레벨 설정', async () => {
        const v = await this.ui.prompt('설정할 레벨', String(st.level));
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
    }
    if (p.online) {
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
    $('#sh-close').addEventListener('click', () => this.closeShulker());
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
    if (item?.contents && !type.startsWith('shulker:')) this.openShulker(type, slot);
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
      this.sortedEnchants().map((e) => `<option value="${e.id}">${enchName(e.id)} (최대 ${roman(e.maxLevel)})</option>`).join('');
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
      const label = document.createElement('span');
      label.textContent = enchName(id);
      row.appendChild(label);
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
    $('#ed-id').textContent = id ? `${itemName(id)} (${shortId(id)})` : '(종류를 입력하세요)';
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

  // ------------------------------------------------------------ 셜커 상자

  shulkerType() {
    return this.shulker ? `shulker:${this.shulker.parentType}:${this.shulker.parentSlot}` : null;
  }

  openShulker(parentType, parentSlot) {
    const same = this.shulker && this.shulker.parentType === parentType && this.shulker.parentSlot === parentSlot;
    this.shulker = { parentType, parentSlot };
    const type = this.shulkerType();
    for (const el of this.shulkerEls) el.dataset.type = type;
    $('#shulker').classList.remove('hidden');
    if (!same) this.renderShulker(null, true);
  }

  closeShulker() {
    this.shulker = null;
    $('#shulker').classList.add('hidden');
    for (const el of this.shulkerEls) {
      el.dataset.type = 'shulker:none:0';
      renderItem(el, null);
      el.draggable = false;
    }
    if (this.selected && this.selected.type.startsWith('shulker:')) this.closeEditor();
  }

  /** prevItems: 바깥 칸(인벤토리/엔더상자)의 이전 스냅샷. 바뀐 칸만 깜빡이게 한다. */
  renderShulker(prevItems, initial) {
    if (!this.shulker) return;
    const { parentType, parentSlot } = this.shulker;
    const box = this.itemAt(parentType, parentSlot);
    const before = prevItems ? (prevItems[parentSlot]?.contents || []) : null;
    $('#sh-title').textContent = box ? displayName(box) : '셜커 상자';
    $('#sh-where').textContent = `${slotLabel(parentType, parentSlot)}에 있는 상자 · 안의 칸도 끌어서 옮길 수 있습니다`;
    for (const el of this.shulkerEls) {
      const i = +el.dataset.slot;
      const item = box?.contents?.[i] || null;
      const changed = !before || JSON.stringify(item) !== JSON.stringify(before[i] || null);
      if (!changed) continue;
      renderItem(el, item);
      el.draggable = !!item;
      if (!initial) {
        el.classList.remove('flash');
        void el.offsetWidth;
        el.classList.add('flash');
      }
    }
  }

  // ------------------------------------------------------------ 아이템 목록 (팔레트)

  bindPalette() {
    $('#pal-search').addEventListener('input', () => this.renderPalette());
    document.querySelectorAll('[data-pal]').forEach((b) => b.addEventListener('click', () => {
      this.paletteMode = b.dataset.pal;
      document.querySelectorAll('[data-pal]').forEach((x) => x.classList.toggle('on', x === b));
      this.renderPalette();
    }));
  }

  /** 한국어 이름이 늦게 도착했을 때 다시 그린다 (app.js 가 호출) */
  refreshNames() {
    this.fillDatalist();
    this.renderPalette();
    if (this.selected && !this.editorDirty) this.openEditor(this.selected.type, this.selected.slot);
    if (this.shulker) this.renderShulker(null, true);
  }

  fillDatalist() {
    const dl = $('#dl-items');
    dl.innerHTML = '';
    for (const id of this.registry.items) {
      const o = document.createElement('option');
      o.value = shortId(id);
      o.textContent = itemName(id);
      dl.appendChild(o);
    }
  }

  sortedEnchants() {
    return [...this.registry.enchants].sort((a, b) => enchName(a.id).localeCompare(enchName(b.id), 'ko'));
  }

  paletteAmount() {
    return Math.max(1, Math.min(99, parseInt($('#pal-amount').value, 10) || 1));
  }

  /** 팔레트 아이템 + 개수. 마법이 부여된 책은 한 칸에 1권만 (겹쳐지지 않는 아이템이라) */
  paletteItem(item, forSlot) {
    const book = !!item.enchants;
    return { ...item, amount: book && forSlot ? 1 : this.paletteAmount() };
  }

  /** 검색어가 아이템 id 또는 한국어 이름에 들어 있는지 */
  matches(q, id, name) {
    if (!q) return true;
    return id.includes(q.replace(/\s+/g, '_')) || name.toLowerCase().includes(q);
  }

  renderPalette() {
    const q = $('#pal-search').value.trim().toLowerCase();
    const grid = $('#pal-grid');
    grid.innerHTML = '';
    grid.classList.toggle('books', this.paletteMode === 'books');
    if (this.paletteMode === 'books') {
      this.renderBooks(grid, q);
      return;
    }
    const list = this.registry.items.filter((id) => this.matches(q, id, itemName(id))).slice(0, PALETTE_LIMIT);
    for (const id of list) {
      grid.appendChild(this.paletteSlot({ id, amount: 1 }));
    }
    if (!list.length) grid.innerHTML = '<div class="muted">결과 없음</div>';
  }

  /** 마법이 부여된 책: 마법부여 하나당 한 줄, 레벨 버튼을 누르거나 끌어서 꺼낸다 */
  renderBooks(grid, q) {
    const list = this.sortedEnchants().filter((e) => this.matches(q, e.id, enchName(e.id)));
    for (const e of list) {
      const row = document.createElement('div');
      row.className = 'book-row';
      const maxBook = { id: 'minecraft:enchanted_book', amount: 1, enchants: { [e.id]: e.maxLevel } };
      row.appendChild(this.paletteSlot(maxBook));
      const name = document.createElement('div');
      name.className = 'book-name';
      name.textContent = enchName(e.id);
      const sub = document.createElement('div');
      sub.className = 'muted book-id';
      sub.textContent = shortId(e.id);
      name.appendChild(sub);
      row.appendChild(name);
      const levels = document.createElement('div');
      levels.className = 'book-levels';
      for (let lv = 1; lv <= e.maxLevel; lv++) {
        const item = { id: 'minecraft:enchanted_book', amount: 1, enchants: { [e.id]: lv } };
        const b = document.createElement('button');
        b.className = 'btn small';
        b.textContent = roman(lv);
        b.title = `${enchName(e.id)} ${roman(lv)} 책 꺼내기 (끌어서 칸에 놓을 수도 있음)`;
        b.draggable = true;
        b.addEventListener('dragstart', (ev) => {
          ev.dataTransfer.setData('text/plain', JSON.stringify({ src: 'palette', item }));
          ev.dataTransfer.effectAllowed = 'copy';
        });
        b.addEventListener('click', () => this.paletteClick(item));
        levels.appendChild(b);
      }
      row.appendChild(levels);
      grid.appendChild(row);
    }
    if (!list.length) grid.innerHTML = '<div class="muted">결과 없음</div>';
  }

  paletteSlot(item) {
    const el = document.createElement('div');
    el.className = 'slot';
    el.draggable = true;
    renderItem(el, item, { lazy: true });
    attachTooltip(el, () => item);
    el.addEventListener('dragstart', (e) => {
      hideTooltip();
      e.dataTransfer.setData('text/plain', JSON.stringify({ src: 'palette', item }));
      e.dataTransfer.effectAllowed = 'copy';
    });
    el.addEventListener('click', () => this.paletteClick(item));
    return el;
  }

  async paletteClick(base) {
    if (!this.uuid) return;
    try {
      // 빈 칸을 선택해 둔 상태면 그 칸에, 아니면 인벤토리 빈 곳에 넣는다
      if (this.selected && !this.itemAt(this.selected.type, this.selected.slot)) {
        await this.client.request('inv.set', { uuid: this.uuid, ...this.selected, item: this.paletteItem(base, true) });
        this.openEditor(this.selected.type, this.selected.slot);
      } else {
        const item = this.paletteItem(base, false);
        await this.client.request('inv.give', { uuid: this.uuid, type: 'inventory', item });
        const label = item.enchants
          ? `${enchName(Object.keys(item.enchants)[0])} ${roman(Object.values(item.enchants)[0])} 책`
          : itemName(item.id);
        this.ui.toast(`${label} ×${item.amount} 지급`);
      }
    } catch (e) { this.ui.toast(e.message, true); }
  }
}

function normalizeId(v) {
  const s = String(v || '').trim().toLowerCase().replace(/\s+/g, '_');
  if (!s) return '';
  return s.includes(':') ? s : `minecraft:${s}`;
}

const GM_LABEL = { SURVIVAL: '서바이벌', CREATIVE: '크리에이티브', ADVENTURE: '모험', SPECTATOR: '관전' };

function baseType(type) {
  return type.startsWith('shulker:') ? type.split(':')[1] : type;
}

function slotLabel(type, slot) {
  if (type.startsWith('shulker:')) {
    const [, pt, ps] = type.split(':');
    return `${slotLabel(pt, +ps)}의 셜커 상자 ${slot + 1}번 칸`;
  }
  if (type === 'ender') return `엔더상자 ${slot + 1}번 칸`;
  if (slot <= 8) return `핫바 ${slot + 1}번 칸`;
  if (slot <= 35) return `가방 ${slot - 8}번 칸`;
  return { 36: '신발 칸', 37: '바지 칸', 38: '흉갑 칸', 39: '투구 칸', 40: '왼손 칸' }[slot];
}

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export { displayName };
