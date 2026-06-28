/**
 * DocPurge AI — core-ui.js
 * Shared UI logic: nav, scroll animations, terminal simulator, utilities
 */

/* ─── NAV SCROLL EFFECT ───────────────────────────────── */
(function initNav() {
  const header = document.getElementById('site-header');
  if (!header) return;
  const onScroll = () => {
    header.classList.toggle('scrolled', window.scrollY > 20);
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();
})();

/* ─── HAMBURGER MENU ──────────────────────────────────── */
(function initHamburger() {
  const btn = document.getElementById('hamburger');
  const nav = document.getElementById('mobile-nav');
  if (!btn || !nav) return;
  btn.addEventListener('click', () => {
    const open = btn.classList.toggle('open');
    nav.classList.toggle('open', open);
    btn.setAttribute('aria-expanded', String(open));
  });
  // Close on nav link click
  nav.querySelectorAll('a').forEach(a => {
    a.addEventListener('click', () => {
      btn.classList.remove('open');
      nav.classList.remove('open');
      btn.setAttribute('aria-expanded', 'false');
    });
  });
})();

/* ─── REVEAL ON SCROLL ────────────────────────────────── */
(function initReveal() {
  const els = document.querySelectorAll('.reveal');
  if (!els.length) return;
  const io = new IntersectionObserver((entries) => {
    entries.forEach(e => {
      if (e.isIntersecting) {
        e.target.classList.add('visible');
        io.unobserve(e.target);
      }
    });
  }, { threshold: 0.12 });
  els.forEach(el => io.observe(el));
})();

/* ─── FAQ ACCORDION ───────────────────────────────────── */
(function initFaq() {
  document.querySelectorAll('.faq-q').forEach(q => {
    q.addEventListener('click', () => {
      const item = q.closest('.faq-item');
      const isOpen = item.classList.contains('open');
      // Close all
      document.querySelectorAll('.faq-item.open').forEach(el => el.classList.remove('open'));
      // Toggle clicked
      if (!isOpen) item.classList.add('open');
    });
  });
})();

/* ─── TERMINAL SIMULATOR ──────────────────────────────── */
/**
 * @param {string}   containerId  - ID of .terminal-body element
 * @param {Array}    lines        - [{text, type, delay}] type: green|blue|warn|err|dim|''
 * @param {boolean}  loop         - whether to loop
 */
function runTerminal(containerId, lines, loop = false) {
  const container = document.getElementById(containerId);
  if (!container) return;

  let index = 0;
  let timeouts = [];

  function clear() {
    timeouts.forEach(clearTimeout);
    timeouts = [];
    container.innerHTML = '';
    index = 0;
  }

  function printLine(line) {
    const now = new Date();
    const ts = now.toTimeString().split(' ')[0];
    const el = document.createElement('div');
    el.className = 'log-line ' + (line.type || '');
    el.innerHTML = `<span class="ts">[${ts}]</span><span class="msg">${escHtml(line.text)}</span>`;
    container.appendChild(el);
    container.scrollTop = container.scrollHeight;
  }

  function addCursor() {
    const cur = document.createElement('span');
    cur.className = 'cursor';
    cur.id = 'term-cursor';
    container.appendChild(cur);
  }

  function removeCursor() {
    const cur = document.getElementById('term-cursor');
    if (cur) cur.remove();
  }

  function step() {
    if (index >= lines.length) {
      addCursor();
      if (loop) {
        const t = setTimeout(() => {
          clear();
          step();
        }, 2400);
        timeouts.push(t);
      }
      return;
    }
    const line = lines[index++];
    removeCursor();
    printLine(line);
    addCursor();
    const t = setTimeout(step, line.delay ?? 600);
    timeouts.push(t);
  }

  step();
  return { clear };
}

/* ─── HERO TERMINAL SEQUENCE ──────────────────────────── */
const HERO_LINES = [
  { text: '$ docpurge --target invoice_draft.pdf --mode auto', type: 'green', delay: 800 },
  { text: 'Parsing PDF structure (v1.7 compliant)…', type: '',     delay: 700 },
  { text: 'Phase 1 → Scanning 24 content streams…', type: 'blue', delay: 750 },
  { text: 'Phase 1 → Detected watermark layer: /Subtype /Form @ obj 47 0', type: 'warn', delay: 900 },
  { text: 'Phase 1 → Detected text stamp: "CONFIDENTIAL" (opacity 0.15)', type: 'warn', delay: 800 },
  { text: 'Phase 2 → Initiating native object removal…', type: 'green', delay: 700 },
  { text: 'Phase 2 → Deleted Form XObject @ obj 47 0 R', type: 'green', delay: 600 },
  { text: 'Phase 2 → Stripped text operator Tj @ page 1, stream 3', type: 'green', delay: 650 },
  { text: 'Phase 2 → Stripped text operator Tj @ page 2, stream 3', type: 'green', delay: 600 },
  { text: 'Phase 2 → Stripped text operator Tj @ page 3, stream 3', type: 'green', delay: 550 },
  { text: 'Verifying vector integrity… OK', type: '',     delay: 800 },
  { text: 'Text layer intact. DPI: 300 → 300 (unchanged).', type: '',     delay: 600 },
  { text: '✓ PURGE COMPLETE — 3 pages cleaned in 1.24s', type: 'green', delay: 900 },
  { text: 'Output: invoice_draft_PURGED.pdf (2.1 MB)', type: 'blue', delay: 700 },
  { text: '', type: 'dim', delay: 1200 },
];

/* Auto-start hero terminal if element exists */
document.addEventListener('DOMContentLoaded', () => {
  if (document.getElementById('hero-terminal-body')) {
    runTerminal('hero-terminal-body', HERO_LINES, true);
  }
});

/* ─── UTILITY: Escape HTML ────────────────────────────── */
function escHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/* ─── UTILITY: Format file size ───────────────────────── */
function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

/* ─── UTILITY: Debounce ───────────────────────────────── */
function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

/* ─── EXPORT GLOBALS ──────────────────────────────────── */
window.DocPurgeUI = { runTerminal, formatBytes, debounce, escHtml };
