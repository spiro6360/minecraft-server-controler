// 아이템 아이콘, 이름, 툴팁 표시.

const MC_VERSION = '26.3';
const iconSources = (name) => [
  `https://mc.nerothe.com/img/1.21.4/minecraft_${name}.png`,              // 블록도 입체로 보이는 렌더 이미지
  `https://assets.mcasset.cloud/${MC_VERSION}/assets/minecraft/textures/item/${name}.png`,
  `https://assets.mcasset.cloud/${MC_VERSION}/assets/minecraft/textures/block/${name}.png`,
];

const resolved = new Map();   // id → url 또는 null(이미지 없음)
const waiting = new Map();    // id → Promise

export function shortId(id) {
  return String(id || '').replace(/^minecraft:/, '');
}

export function prettyName(id) {
  return shortId(id).split('_').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

/** &a 같은 색 코드를 지운 순수 텍스트 */
export function plain(text) {
  return String(text || '').replace(/&[0-9a-fk-orx]/gi, '');
}

export function displayName(item) {
  return item.name ? plain(item.name) : prettyName(item.id);
}

function tryLoad(url) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img.naturalWidth > 0);
    img.onerror = () => resolve(false);
    img.referrerPolicy = 'no-referrer';
    img.src = url;
  });
}

async function findIcon(id) {
  if (resolved.has(id)) return resolved.get(id);
  if (waiting.has(id)) return waiting.get(id);
  const p = (async () => {
    const name = shortId(id);
    if (!/^[a-z0-9_]+$/.test(name)) return null;
    for (const url of iconSources(name)) {
      if (await tryLoad(url)) return url;
    }
    return null;
  })();
  waiting.set(id, p);
  const url = await p;
  resolved.set(id, url);
  waiting.delete(id);
  return url;
}

/** slot 요소 안에 아이템 그림/개수/내구도를 그린다. item 이 null 이면 비운다. */
export function renderItem(el, item) {
  el.innerHTML = '';
  el.classList.remove('ench');
  el.dataset.has = item ? '1' : '';
  if (!item) return;

  const txt = document.createElement('div');
  txt.className = 'txt';
  txt.textContent = prettyName(item.id);
  el.appendChild(txt);

  const token = (el._iconToken = Symbol());
  findIcon(item.id).then((url) => {
    if (!url || el._iconToken !== token) return;
    const img = document.createElement('img');
    img.src = url;
    img.alt = '';
    img.referrerPolicy = 'no-referrer';
    img.draggable = false;
    txt.replaceWith(img);
  });

  if (item.amount > 1) {
    const c = document.createElement('span');
    c.className = 'cnt';
    c.textContent = item.amount;
    el.appendChild(c);
  }
  if (item.maxDamage && item.damage > 0) {
    const left = Math.max(0, 1 - item.damage / item.maxDamage);
    const bar = document.createElement('div');
    bar.className = 'dur';
    const fill = document.createElement('i');
    fill.style.width = `${Math.round(left * 100)}%`;
    fill.style.background = `hsl(${Math.round(left * 120)}, 90%, 45%)`;
    bar.appendChild(fill);
    el.appendChild(bar);
  }
  if (item.enchants && Object.keys(item.enchants).length) el.classList.add('ench');
}

// ---------------------------------------------------------------- 툴팁

let tip;
export function attachTooltip(el, getItem) {
  el.addEventListener('mouseenter', () => {
    const item = getItem();
    if (!item) return;
    tip = tip || Object.assign(document.createElement('div'), { className: 'tooltip' });
    tip.innerHTML = '';
    const add = (cls, text) => {
      const d = document.createElement('div');
      d.className = cls;
      d.textContent = text;
      tip.appendChild(d);
    };
    add('t-name', displayName(item) + (item.amount > 1 ? ` ×${item.amount}` : ''));
    for (const [k, lv] of Object.entries(item.enchants || {})) add('t-ench', `${prettyName(k)} ${lv}`);
    for (const line of item.lore || []) add('t-lore', plain(line));
    if (item.maxDamage) add('t-id', `내구도 ${item.maxDamage - (item.damage || 0)} / ${item.maxDamage}`);
    add('t-id', item.id);
    document.body.appendChild(tip);
  });
  el.addEventListener('mousemove', (e) => {
    if (!tip) return;
    const x = Math.min(e.clientX + 14, window.innerWidth - tip.offsetWidth - 8);
    tip.style.left = `${x}px`;
    tip.style.top = `${e.clientY + 14}px`;
  });
  el.addEventListener('mouseleave', hideTooltip);
}

export function hideTooltip() {
  if (tip) tip.remove();
}
