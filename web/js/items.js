// 아이템 아이콘, 이름, 툴팁 표시.
//
// 아이콘을 빠르고 부드럽게 보여 주기 위한 방법
//  1. 후보 이미지 주소들을 동시에 시도하고, 우선순위가 높은 것부터 성공한 것을 쓴다
//  2. 어떤 아이템이 어떤 주소에서 성공했는지 브라우저에 기억해서 다음부터는 바로 그 주소를 쓴다
//  3. 아이템 목록(팔레트)은 화면에 보이는 칸만 불러온다 (400개를 한꺼번에 받지 않음)
//  4. 같은 아이템이면 개수만 바뀌어도 그림을 다시 그리지 않는다 (깜빡임 없음)

const MC_VERSION = '26.3';
const iconSources = (name) => [
  `https://assets.mcasset.cloud/${MC_VERSION}/assets/minecraft/textures/item/${name}.png`, // 빠름 (일반 아이템)
  `https://mc.nerothe.com/img/1.21.4/minecraft_${name}.png`,                              // 블록도 입체 렌더
  `https://assets.mcasset.cloud/${MC_VERSION}/assets/minecraft/textures/block/${name}.png`,
];

const CACHE_KEY = 'webpanel.icons.v2';
const resolved = new Map(loadCache()); // id → url, 또는 '' (이미지 없음)
const waiting = new Map();
let saveTimer = null;

function loadCache() {
  try { return Object.entries(JSON.parse(localStorage.getItem(CACHE_KEY) || '{}')); } catch { return []; }
}

function saveCacheSoon() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(Object.fromEntries(resolved))); } catch { /* 저장 불가 무시 */ }
  }, 1000);
}

export function shortId(id) {
  return String(id || '').replace(/^minecraft:/, '');
}

export function prettyName(id) {
  return shortId(id).split('_').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

// ---------------------------------------------------------------- 한국어 이름
// 마인크래프트 공식 한국어 파일(ko_kr.json)에서 아이템/블록/마법부여 이름만 골라 브라우저에 기억한다.

const LANG_URL = `https://assets.mcasset.cloud/${MC_VERSION}/assets/minecraft/lang/ko_kr.json`;
const LANG_KEY = `webpanel.ko.${MC_VERSION}`;
let ko = null;
try { ko = JSON.parse(localStorage.getItem(LANG_KEY) || 'null'); } catch { ko = null; }

/** 한국어 이름을 불러온다. 이미 있으면 바로 끝. 새로 받았으면 true. */
export async function loadKorean() {
  if (ko) return false;
  const res = await fetch(LANG_URL);
  if (!res.ok) throw new Error('한국어 이름 파일을 받지 못했습니다');
  const all = await res.json();
  const picked = {};
  for (const [k, v] of Object.entries(all)) {
    if (k.startsWith('item.minecraft.') || k.startsWith('block.minecraft.') || k.startsWith('enchantment.minecraft.')) {
      picked[k] = v;
    }
  }
  ko = picked;
  try { localStorage.setItem(LANG_KEY, JSON.stringify(picked)); } catch { /* 저장 불가면 이번만 사용 */ }
  return true;
}

/** 아이템 한국어 이름 (없으면 영어 이름) */
export function itemName(id) {
  const n = shortId(id);
  return (ko && (ko[`item.minecraft.${n}`] || ko[`block.minecraft.${n}`])) || prettyName(id);
}

/** 마법부여 한국어 이름 */
export function enchName(id) {
  return (ko && ko[`enchantment.minecraft.${shortId(id)}`]) || prettyName(id);
}

const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];
export function roman(n) {
  return ROMAN[n] || String(n);
}

/** &a 같은 색 코드를 지운 순수 텍스트 */
export function plain(text) {
  return String(text || '').replace(/&[0-9a-fk-orx]/gi, '');
}

export function displayName(item) {
  return item.name ? plain(item.name) : itemName(item.id);
}

function tryLoad(url) {
  return new Promise((resolve) => {
    const img = new Image();
    img.referrerPolicy = 'no-referrer';
    img.decoding = 'async';
    img.onload = () => resolve(img.naturalWidth > 0);
    img.onerror = () => resolve(false);
    img.src = url;
  });
}

/** 아이콘 주소 찾기. 이미 알면 즉시, 아니면 후보를 동시에 시도. */
function findIcon(id) {
  if (resolved.has(id)) return Promise.resolve(resolved.get(id));
  if (waiting.has(id)) return waiting.get(id);
  const p = (async () => {
    const name = shortId(id);
    if (!/^[a-z0-9_]+$/.test(name)) return '';
    const urls = iconSources(name);
    const attempts = urls.map(tryLoad); // 동시에 시작
    for (let i = 0; i < urls.length; i++) {
      if (await attempts[i]) return urls[i];
    }
    return '';
  })().then((url) => {
    resolved.set(id, url);
    waiting.delete(id);
    saveCacheSoon();
    return url;
  });
  waiting.set(id, p);
  return p;
}

// ---------------------------------------------------------------- 보이는 칸만 불러오기

const visible = new WeakSet();
const pendingIcon = new WeakMap();
const observer = 'IntersectionObserver' in window
  ? new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      visible.add(e.target);
      observer.unobserve(e.target);
      const id = pendingIcon.get(e.target);
      if (id) loadIconInto(e.target, id);
    }
  }, { rootMargin: '200px' })
  : null;

function loadIconInto(el, id) {
  pendingIcon.delete(el);
  const known = resolved.get(id);
  if (known !== undefined) {
    showIcon(el, id, known);
    return;
  }
  findIcon(id).then((url) => showIcon(el, id, url));
}

function showIcon(el, id, url) {
  if (el._iconId !== id) return; // 그 사이 다른 아이템으로 바뀜
  const holder = el.querySelector('.icon');
  if (!holder) return;
  holder.classList.remove('loading');
  if (!url) {
    holder.innerHTML = '';
    const txt = document.createElement('div');
    txt.className = 'txt';
    txt.textContent = itemName(id);
    holder.appendChild(txt);
    return;
  }
  const img = document.createElement('img');
  img.alt = '';
  img.draggable = false;
  img.referrerPolicy = 'no-referrer';
  img.decoding = 'async';
  img.onload = () => img.classList.add('ready');
  img.src = url;
  if (img.complete) img.classList.add('ready');
  holder.innerHTML = '';
  holder.appendChild(img);
}

/**
 * slot 요소 안에 아이템 그림/개수/내구도를 그린다. item 이 null 이면 비운다.
 * lazy: true 면 화면에 보일 때 아이콘을 불러온다 (긴 아이템 목록용)
 */
export function renderItem(el, item, { lazy = false } = {}) {
  el.dataset.has = item ? '1' : '';
  el.classList.toggle('ench', !!(item && item.enchants && Object.keys(item.enchants).length));

  if (!item) {
    el._iconId = null;
    el.innerHTML = '';
    return;
  }

  // 같은 아이템이면 그림은 그대로 두고 개수/내구도만 갱신
  if (el._iconId !== item.id || !el.querySelector('.icon')) {
    el._iconId = item.id;
    el.innerHTML = '';
    const holder = document.createElement('div');
    holder.className = 'icon loading';
    el.appendChild(holder);
    const known = resolved.get(item.id);
    if (!lazy || known !== undefined || !observer || visible.has(el)) {
      loadIconInto(el, item.id);
    } else {
      pendingIcon.set(el, item.id);
      observer.observe(el);
    }
  }

  let cnt = el.querySelector('.cnt');
  if (item.amount > 1) {
    if (!cnt) {
      cnt = document.createElement('span');
      cnt.className = 'cnt';
      el.appendChild(cnt);
    }
    cnt.textContent = item.amount;
  } else if (cnt) {
    cnt.remove();
  }

  let bar = el.querySelector('.dur');
  if (item.maxDamage && item.damage > 0) {
    if (!bar) {
      bar = document.createElement('div');
      bar.className = 'dur';
      bar.appendChild(document.createElement('i'));
      el.appendChild(bar);
    }
    const left = Math.max(0, 1 - item.damage / item.maxDamage);
    const fill = bar.firstChild;
    fill.style.width = `${Math.round(left * 100)}%`;
    fill.style.background = `hsl(${Math.round(left * 120)}, 90%, 45%)`;
  } else if (bar) {
    bar.remove();
  }
}

/** 아이템 목록(팔레트)에 쓸 아이콘들을 미리 조금씩 받아 둔다 (첫 화면 이후 여유 있을 때). */
export function warmIcons(ids, limit = 120) {
  const todo = ids.filter((id) => !resolved.has(id)).slice(0, limit);
  let i = 0;
  const step = () => {
    const batch = todo.slice(i, i + 6);
    i += 6;
    if (!batch.length) return;
    Promise.all(batch.map(findIcon)).then(() => {
      (window.requestIdleCallback || setTimeout)(step);
    });
  };
  (window.requestIdleCallback || setTimeout)(step);
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
    for (const [k, lv] of Object.entries(item.enchants || {})) add('t-ench', `${enchName(k)} ${roman(lv)}`);
    if (item.contents) {
      const inside = item.contents.filter(Boolean);
      add('t-lore', inside.length ? `안에 ${inside.length}칸 들어 있음 (클릭해서 보기)` : '비어 있음 (클릭해서 열기)');
    }
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
