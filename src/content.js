import { pinyin } from 'pinyin-pro';
import cnchar from 'cnchar';
import radicalPlugin from 'cnchar-radical';
import orderPlugin from 'cnchar-order';

cnchar.use(radicalPlugin, orderPlugin);

// 触发选区必须包含的中文字符范围（含简繁，CJK 基本区 + 扩展A + 兼容区）
const CJK = /[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]/;
const isCjk = (ch) => CJK.test(ch);
const MAX_CHARS = 30; // 选区规模上限，超出截断

const HOST_ID = 'pinyin-popup-host';

const CSS = `
:host { all: initial; position: fixed; z-index: 2147483647; font-family: "PingFang SC", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif; }
.card {
  position: relative; background: #fffdf7; color: #2b2b2b;
  border: 1px solid #e0d9c8; border-radius: 10px;
  box-shadow: 0 6px 24px rgba(0,0,0,.18);
  padding: 12px 16px; max-width: 420px; font-size: 15px; line-height: 1.9;
}
ruby { ruby-align: center; margin: 0 1px; }
rt { font-size: 11px; color: #b0413e; font-weight: 600; }
.pass { color: #999; }
.big { font-size: 40px; text-align: center; line-height: 1.3; }
.main-pinyin { font-size: 22px; text-align: center; color: #b0413e; font-weight: 700; }
.num { font-size: 13px; color: #8a8a8a; font-weight: 400; }
.numeric-line { font-size: 12px; color: #8a8a8a; text-align: center; margin-top: 4px; }
.section { margin-top: 8px; padding-top: 8px; border-top: 1px dashed #e0d9c8; font-size: 13px; color: #555; }
.section-title { font-size: 11px; color: #999; margin-bottom: 2px; }
.reading .common { color: #b0413e; font-weight: 700; }
.reading .tag { font-size: 11px; background: #b0413e; color: #fff; border-radius: 4px; padding: 0 4px; margin-left: 4px; }
.info-line { display: flex; gap: 16px; justify-content: center; }
.truncated { font-size: 12px; color: #b58900; margin-top: 4px; }
`;

let host = null;
let shadow = null;

function ensureHost() {
  if (host && document.getElementById(HOST_ID)) return;
  host = document.createElement('div');
  host.id = HOST_ID;
  shadow = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = CSS;
  shadow.appendChild(style);
  document.documentElement.appendChild(host);
}

function closePopup() {
  if (host) {
    host.remove();
    host = null;
    shadow = null;
  }
}

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

// ---- 单字卡片 ----
function buildCharCard(ch) {
  const card = el('div', 'card');

  card.appendChild(el('div', 'big', ch));

  // pinyin-pro 默认读音 = 最常用读音
  const main = pinyin(ch, { type: 'array' })[0];
  const mainNum = pinyin(ch, { type: 'array', toneType: 'num' })[0];
  const mainLine = el('div', 'main-pinyin');
  mainLine.appendChild(el('span', null, main));
  mainLine.appendChild(el('span', 'num', ` (${mainNum})`));
  card.appendChild(mainLine);

  // 多音列表：列出全部读音，标注常用
  const readings = pinyin(ch, { multiple: true, type: 'array' });
  if (readings.length > 1) {
    const sec = el('div', 'section');
    sec.appendChild(el('div', 'section-title', '多音'));
    readings.forEach((r) => {
      const row = el('div', 'reading');
      const isCommon = r === main;
      row.appendChild(el('span', isCommon ? 'common' : null, r));
      if (isCommon) row.appendChild(el('span', 'tag', '常用'));
      sec.appendChild(row);
    });
    card.appendChild(sec);
  }

  // 部首 / 笔画基础信息
  try {
    const [info] = cnchar.radical(ch) || [];
    const strokeCount = cnchar.stroke(ch, 'count');
    if (info || strokeCount) {
      const sec = el('div', 'section');
      const line = el('div', 'info-line');
      if (info?.radical) line.appendChild(el('span', null, `部首：${info.radical}（${info.radicalCount}画）`));
      if (strokeCount) line.appendChild(el('span', null, `总笔画：${strokeCount}`));
      sec.appendChild(line);
      card.appendChild(sec);
    }
  } catch { /* cnchar 词典未覆盖的字直接跳过 */ }

  return card;
}

// ---- 多字卡片：逐字注音，词级消歧，非中文透传 ----
function buildTextCard(text, truncated) {
  const card = el('div', 'card');
  const symbols = pinyin(text, { type: 'array' }); // 词级消歧后的调号拼音
  const nums = pinyin(text, { type: 'array', toneType: 'num' });

  const line = el('div');
  [...text].forEach((ch, i) => {
    if (isCjk(ch)) {
      const ruby = document.createElement('ruby');
      ruby.appendChild(document.createTextNode(ch));
      const rt = document.createElement('rt');
      rt.textContent = symbols[i];
      ruby.appendChild(rt);
      line.appendChild(ruby);
    } else {
      const span = el('span', 'pass', ch);
      span.setAttribute('data-num', nums[i]); // 数字调行里跳过
      line.appendChild(span);
    }
  });
  card.appendChild(line);

  const numeric = nums
    .map((n, i) => (isCjk([...text][i]) ? n : ''))
    .filter(Boolean)
    .join(' ');
  if (numeric) card.appendChild(el('div', 'numeric-line', numeric));

  if (truncated) card.appendChild(el('div', 'truncated', '…已截断'));
  return card;
}

// ---- 定位 ----
function positionPopup(rect) {
  const pad = 8;
  host.style.visibility = 'hidden';
  const pw = host.offsetWidth || 200;
  const ph = host.offsetHeight || 120;
  let x = rect.left;
  let y = rect.bottom + 6;
  if (y + ph > window.innerHeight - pad) y = Math.max(pad, rect.top - ph - 6);
  if (x + pw > window.innerWidth - pad) x = Math.max(pad, window.innerWidth - pad - pw);
  host.style.left = `${Math.max(pad, x)}px`;
  host.style.top = `${Math.max(pad, y)}px`;
  host.style.visibility = 'visible';
}

function showPopup() {
  const sel = document.getSelection();
  if (!sel || sel.isCollapsed) return;
  const text = sel.toString().trim();
  if (!text || !CJK.test(text)) return;

  const truncated = [...text].length > MAX_CHARS;
  const shown = truncated ? [...text].slice(0, MAX_CHARS).join('') : text;

  closePopup();
  ensureHost();
  const card = [...shown].length === 1 && isCjk(shown)
    ? buildCharCard(shown)
    : buildTextCard(shown, truncated);

  const range = sel.getRangeAt(0).cloneRange();
  const rect = range.getBoundingClientRect();
  shadow.appendChild(card);
  positionPopup(rect);
}

document.addEventListener('mouseup', () => setTimeout(showPopup));

document.addEventListener('mousedown', (e) => {
  if (host && !host.contains(e.target)) closePopup();
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closePopup();
});
