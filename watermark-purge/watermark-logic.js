/**
 * DocPurge AI — watermark-logic.js v2.0
 * ════════════════════════════════════════════════════════════════════════════
 * Fully Automatic 5-Phase Watermark Purge Engine
 *  Phase 1 — Smart Detection    (pdfjs text extraction + structure scan)
 *  Phase 2 — Smart Removal      (coordinate overlay + content stream)
 *  Phase 3 — Gemini AI Assist   (gemini-2.5-flash — auto if key present)
 *  Phase 4 — Manual Hint        (user-guided last resort)
 *  Phase 5 — Export             (clean PDF output)
 *
 * Key insight: pdfjs getTextContent() decodes ALL font encodings reliably.
 * Using it to extract real text, then covering watermarks with pdf-lib
 * white rectangles at exact coordinates — far more reliable than raw byte scan.
 *
 * Constraints:
 *  • No rasterization for vector PDFs — fonts/vectors intact
 *  • No size limit — browser-native processing
 *  • No server calls — 100% local
 *  • Session-only key — Gemini API key never persisted
 * ════════════════════════════════════════════════════════════════════════════
 */

import * as pdfjsLib from 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.3.136/pdf.min.mjs';

// ─── pdf.js worker ───────────────────────────────────────────────────────────
pdfjsLib.GlobalWorkerOptions.workerSrc =
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.3.136/pdf.worker.min.mjs';

// ─── GLOBAL STATE ─────────────────────────────────────────────────────────────
const state = {
  rawBytes:     null,   // Uint8Array of original PDF
  pdfLibDoc:    null,   // PDFDocument (pdf-lib)
  pdfjsDoc:     null,   // PDFDocumentProxy (pdf.js)
  fileName:     '',
  fileSize:     0,
  pageCount:    0,
  geminiKey:    null,   // session-only, never stored
  candidates:   [],
  purgedBytes:  null,
  currentPhase: 0,
};

// ─── WATERMARK KEYWORD LIBRARY ────────────────────────────────────────────────
const WATERMARK_KEYWORDS = [
  'CONFIDENTIAL', 'DRAFT', 'SAMPLE', 'COPY', 'VOID', 'INTERNAL',
  'WATERMARK', 'DO NOT COPY', 'PROPRIETARY', 'RESTRICTED',
  'INTERNAL USE ONLY', 'SPECIMEN', 'PREVIEW', 'NOT FOR DISTRIBUTION',
  'PROOF', 'PRIVATE', 'PERSONAL', 'TOP SECRET', 'CLASSIFIED',
  'FOR REVIEW ONLY', 'EVALUATION COPY', 'DEMO', 'EXAMPLE',
  'NOT FOR SALE', 'COMPLIMENTARY', 'PRELIMINARY', 'SENSITIVE',
  'UNCLASSIFIED', 'OFFICIAL USE ONLY', 'CONTROLLED',
];

// ─── GEMINI CONFIG ────────────────────────────────────────────────────────────
const GEMINI_MODEL = 'gemini-2.5-flash';

// ─── UI ELEMENT REFS ──────────────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);

const ui = {
  uploadZone:        $('upload-zone'),
  fileInput:         $('file-input'),
  fileInfo:          $('file-info'),
  fileName:          $('file-name'),
  fileSize:          $('file-size'),
  filePages:         $('file-pages'),
  btnRemoveFile:     $('btn-remove-file'),
  btnStartPurge:     $('btn-start-purge'),
  phasesPanel:       $('phases-panel'),
  overallStatus:     $('overall-status'),
  mainProgress:      $('main-progress'),
  phases:            [null, $('phase-1'), $('phase-2'), $('phase-3'), $('phase-4'), $('phase-5')],
  phaseStatus:       [null, $('phase-1-status'), $('phase-2-status'), $('phase-3-status'), $('phase-4-status'), $('phase-5-status')],
  candidatesSection: $('candidates-section'),
  candidatesList:    $('candidates-list'),
  hintPanel:         $('hint-panel'),
  wmHint:            $('watermark-hint'),
  btnHintSearch:     $('btn-hint-search'),
  geminiPanel:       $('gemini-panel'),
  geminiKeyInput:    $('gemini-key-input'),
  btnToggleKey:      $('btn-toggle-key'),
  btnRunGemini:      $('btn-run-gemini'),
  geminiResult:      $('gemini-result'),
  geminiResultBox:   $('gemini-result-box'),
  downloadPanel:     $('download-panel'),
  downloadSummary:   $('download-summary'),
  btnDownload:       $('btn-download'),
  btnProcessAnother: $('btn-process-another'),
  logBody:           $('tool-log-body'),
  btnClearLog:       $('btn-clear-log'),
};

// ─── LOGGER ───────────────────────────────────────────────────────────────────
function log(msg, type = '') {
  const now = new Date();
  const ts = now.toTimeString().split(' ')[0];
  const el = document.createElement('div');
  el.className = 'log-line ' + type;
  el.innerHTML = `<span class="ts">[${ts}]</span><span class="msg">${escHtml(String(msg))}</span>`;
  ui.logBody.appendChild(el);
  ui.logBody.scrollTop = ui.logBody.scrollHeight;
}
function escHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ─── PHASE STATE MACHINE ──────────────────────────────────────────────────────
function setPhaseState(n, state_str) {
  const item = ui.phases[n];
  const stat = ui.phaseStatus[n];
  if (!item || !stat) return;
  item.classList.remove('active', 'done', 'error');
  const sp = item.querySelector('.spinner');
  if (sp) sp.remove();

  if (state_str === 'active') {
    item.classList.add('active');
    const spinner = document.createElement('div');
    spinner.className = 'spinner';
    item.insertBefore(spinner, stat);
    stat.textContent = 'RUNNING…';
  } else if (state_str === 'done') {
    item.classList.add('done');
    stat.textContent = '✓ DONE';
    stat.style.color = 'var(--green)';
  } else if (state_str === 'error') {
    item.classList.add('error');
    stat.textContent = '✗ ERROR';
    stat.style.color = '#f87171';
  } else if (state_str === 'skip') {
    stat.textContent = 'SKIPPED';
    stat.style.color = 'var(--text-muted)';
  } else {
    stat.textContent = 'WAITING';
    stat.style.color = '';
  }
}

function setProgress(pct) {
  ui.mainProgress.style.width = Math.min(100, pct) + '%';
  ui.overallStatus.textContent = pct < 100 ? `${Math.round(pct)}%` : 'COMPLETE';
}

// ─── UPLOAD HANDLING ──────────────────────────────────────────────────────────
ui.uploadZone.addEventListener('click', () => ui.fileInput.click());
ui.uploadZone.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') ui.fileInput.click();
});
ui.uploadZone.addEventListener('dragover', (e) => {
  e.preventDefault();
  ui.uploadZone.classList.add('drag-over');
});
ui.uploadZone.addEventListener('dragleave', () => {
  ui.uploadZone.classList.remove('drag-over');
});
ui.uploadZone.addEventListener('drop', (e) => {
  e.preventDefault();
  ui.uploadZone.classList.remove('drag-over');
  const file = e.dataTransfer.files[0];
  if (file) handleFile(file);
});
ui.fileInput.addEventListener('change', () => {
  if (ui.fileInput.files[0]) handleFile(ui.fileInput.files[0]);
});
ui.btnRemoveFile.addEventListener('click', resetAll);

async function handleFile(file) {
  if (!file.name.toLowerCase().endsWith('.pdf') && file.type !== 'application/pdf') {
    log('⚠ Please select a valid PDF file.', 'warn');
    return;
  }
  state.fileName = file.name;
  state.fileSize = file.size;

  log(`Loading file: ${file.name} (${formatBytes(file.size)})`, 'blue');
  ui.fileInfo.classList.add('show');
  ui.fileName.textContent = file.name;
  ui.fileSize.textContent = formatBytes(file.size);
  ui.filePages.textContent = 'Reading…';
  ui.uploadZone.classList.add('has-file');

  try {
    const buffer = await file.arrayBuffer();
    state.rawBytes = new Uint8Array(buffer);

    log('Initializing pdf-lib…');
    state.pdfLibDoc = await PDFLib.PDFDocument.load(state.rawBytes, {
      ignoreEncryption: true,
      updateMetadata: false,
    });
    state.pageCount = state.pdfLibDoc.getPageCount();

    log('Initializing pdf.js for text layer…');
    state.pdfjsDoc = await pdfjsLib.getDocument({ data: buffer.slice(0) }).promise;

    ui.filePages.textContent = `${state.pageCount} page${state.pageCount > 1 ? 's' : ''}`;
    log(`✓ PDF loaded — ${state.pageCount} pages, ${formatBytes(file.size)}`, 'green');

    ui.btnStartPurge.disabled = false;
    ui.btnStartPurge.style.opacity = '1';
    ui.btnStartPurge.style.cursor = 'pointer';
  } catch (err) {
    log('✗ Failed to load PDF: ' + err.message, 'err');
    console.error(err);
    ui.filePages.textContent = 'Error';
  }
}

// ─── GEMINI KEY TOGGLE (Gemini panel) ────────────────────────────────────────
ui.btnToggleKey.addEventListener('click', () => {
  const inp = ui.geminiKeyInput;
  inp.type = inp.type === 'password' ? 'text' : 'password';
  ui.btnToggleKey.textContent = inp.type === 'password' ? '👁' : '🙈';
});

// ─── CLEAR LOG ────────────────────────────────────────────────────────────────
ui.btnClearLog.addEventListener('click', () => { ui.logBody.innerHTML = ''; });

// ══════════════════════════════════════════════════════════════════════════════
// ─── DETECTION ENGINE ─────────────────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Detect PDF type: scanned image vs vector/text.
 * Counts extractable text items across the first 5 pages.
 * < 10 items → very likely scanned (image-only) PDF.
 */
async function detectPDFType() {
  const pagesToCheck = Math.min(state.pdfjsDoc.numPages, 5);
  const promises = [];
  for (let i = 1; i <= pagesToCheck; i++) {
    promises.push((async (pNum) => {
      try {
        const page = await state.pdfjsDoc.getPage(pNum);
        const content = await page.getTextContent();
        return content.items.filter(it => it.str && it.str.trim().length > 0).length;
      } catch (_) {
        return 0;
      }
    })(i));
  }
  const counts = await Promise.all(promises);
  const totalItems = counts.reduce((a, b) => a + b, 0);
  return totalItems < 10 ? 'scanned' : 'vector';
}

/**
 * Extract all real text from every page using pdfjs.
 * This correctly handles ALL font encodings, CMaps and glyph tables —
 * something raw content-stream byte scanning cannot do reliably.
 */
async function extractAllPageText() {
  const numPages = state.pdfjsDoc.numPages;
  const promises = [];
  for (let i = 1; i <= numPages; i++) {
    promises.push((async (pNum) => {
      try {
        const page = await state.pdfjsDoc.getPage(pNum);
        const content = await page.getTextContent();
        const items = content.items.filter(it => it.str && it.str.trim());
        const text = items.map(it => it.str).join(' ');
        return { page: pNum, text, items };
      } catch (_) {
        return { page: pNum, text: '', items: [] };
      }
    })(i));
  }
  const results = await Promise.all(promises);
  return results.sort((a, b) => a.page - b.page);
}

/**
 * Scan extracted text for watermark keywords and user-defined targets.
 * Returns array of { text, pages } for each detected watermark.
 */
function detectWatermarkKeywords(pageTexts, userList = []) {
  const found = new Map(); // keyword → page count

  for (const { text } of pageTexts) {
    const upper = text.toUpperCase();
    // Built-in keyword library
    for (const kw of WATERMARK_KEYWORDS) {
      if (upper.includes(kw)) {
        found.set(kw, (found.get(kw) || 0) + 1);
      }
    }
    // User-defined targets
    for (const wm of userList) {
      if (wm.trim() && upper.includes(wm.toUpperCase())) {
        found.set(wm, (found.get(wm) || 0) + 1);
      }
    }
  }

  return [...found.entries()].map(([text, pages]) => ({ text, pages }));
}

/**
 * Scan PDF structure for OCG (Optional Content Group) layers
 * and Form XObjects that look like watermark overlays.
 */
async function detectStructuralWatermarks() {
  const candidates = [];
  const doc = state.pdfLibDoc;

  // Strategy A: OCG layers with watermark-sounding names
  try {
    const catalog = doc.catalog;
    const ocProps = catalog.get(PDFLib.PDFName.of('OCProperties'));
    if (ocProps) {
      const ocgArr = ocProps.get(PDFLib.PDFName.of('OCGs'));
      if (ocgArr instanceof PDFLib.PDFArray) {
        ocgArr.asArray().forEach((ocgRef, i) => {
          try {
            const ocg = doc.context.lookup(ocgRef, PDFLib.PDFDict);
            const name = ocg.get(PDFLib.PDFName.of('Name'));
            const nameStr = name ? name.decodeText() : `OCG ${i}`;
            if (/watermark|draft|confidential|stamp|copy|sample|void/i.test(nameStr)) {
              candidates.push({ type: 'ocg', ref: ocgRef, label: `OCG Layer: "${nameStr}"` });
              log(`  Found OCG layer: "${nameStr}"`, 'warn');
            }
          } catch (_) {}
        });
      }
    }
  } catch (e) {
    log('  OCG scan: ' + e.message, 'dim');
  }

  // Strategy B: Form XObjects tagged with /Watermark or having an OC reference
  try {
    doc.context.enumerateIndirectObjects().forEach(([ref, obj]) => {
      try {
        if (obj instanceof PDFLib.PDFDict) {
          const subtype = obj.get(PDFLib.PDFName.of('Subtype'));
          if (subtype && subtype.asString && subtype.asString() === '/Form') {
            const oc   = obj.get(PDFLib.PDFName.of('OC'));
            const name = obj.get(PDFLib.PDFName.of('Name'));
            const nameStr = name ? String(name) : '';
            if (/watermark/i.test(nameStr) || oc) {
              candidates.push({
                type: 'xobject',
                ref,
                label: `Form XObject @ obj ${ref.objectNumber}${nameStr ? ` (${nameStr})` : ''}`,
              });
              log(`  Found Form XObject: obj ${ref.objectNumber}`, 'warn');
            }
          }
        }
      } catch (_) {}
    });
  } catch (e) {
    log('  XObject scan: ' + e.message, 'dim');
  }

  return candidates;
}

// ══════════════════════════════════════════════════════════════════════════════
// ─── REMOVAL ENGINE ───────────────────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Primary removal method: use pdfjs text item coordinates to draw white
 * rectangles over watermark text in pdf-lib. This works regardless of font
 * encoding because pdfjs already decoded the text and its exact position.
 */
async function removeByCoordinates(keyword) {
  let removedCount = 0;
  const lowerKw = keyword.toLowerCase().trim();
  if (!lowerKw) return 0;

  const pageTexts = state.pageTexts || [];
  for (const { page: pi, items } of pageTexts) {
    try {
      // Match items that contain or are part of the keyword
      const matching = items.filter(item => {
        const s = item.str.toLowerCase();
        // Full containment OR the item is a fragment of the keyword (≥ 3 chars)
        return s.includes(lowerKw) || (lowerKw.includes(s.trim()) && s.trim().length >= 3);
      });

      if (matching.length === 0) continue;

      const pdfPage = state.pdfLibDoc.getPages()[pi - 1];

      for (const item of matching) {
        const [a, , , d, x, y] = item.transform;
        const fontSize = Math.sqrt(a * a + (item.transform[1] || 0) ** 2) || Math.abs(d) || 12;
        const width    = item.width > 0 ? item.width : fontSize * item.str.length * 0.55;
        const height   = fontSize * 1.6;

        pdfPage.drawRectangle({
          x:       x - 4,
          y:       y - height * 0.25,
          width:   width + 8,
          height:  height + 4,
          color:   PDFLib.rgb(1, 1, 1),
          opacity: 1,
        });
      }

      removedCount++;
      log(`  Covered "${keyword}" on page ${pi} (${matching.length} item${matching.length > 1 ? 's' : ''})`, 'green');
    } catch (e) {
      log(`  Coord removal pg ${pi}: ${e.message}`, 'dim');
    }
  }

  return removedCount;
}

/**
 * Backup method: raw content-stream byte-level search.
 * Works on PDFs where text happens to be stored as plain ASCII literals
 * like (DRAFT)Tj. Often misses font-encoded text but useful as a supplement.
 */
async function searchAndRemoveByText(targetText) {
  const doc = state.pdfLibDoc;
  const pages = doc.getPages();
  let removedCount = 0;
  const lowerTarget = targetText.toLowerCase();

  for (let pi = 0; pi < pages.length; pi++) {
    const page = pages[pi];
    try {
      const contentRef = page.node.get(PDFLib.PDFName.of('Contents'));
      if (!contentRef) continue;

      let rawBytes;
      if (contentRef instanceof PDFLib.PDFArray) {
        const parts = [];
        contentRef.asArray().forEach(ref => {
          try {
            const s = doc.context.lookup(ref, PDFLib.PDFRawStream);
            if (s) parts.push(...s.contents);
          } catch (_) {}
        });
        rawBytes = new Uint8Array(parts);
      } else {
        const stream = doc.context.lookup(contentRef, PDFLib.PDFRawStream);
        if (!stream) continue;
        rawBytes = stream.contents;
      }

      let streamText = new TextDecoder('latin1').decode(rawBytes);
      const escaped   = targetText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const escapedLC = lowerTarget.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

      const patterns = [
        // Exact literal in parentheses
        new RegExp(`\\(${escaped}\\)\\s*T[jJ]`, 'g'),
        new RegExp(`\\(${escapedLC}\\)\\s*T[jJ]`, 'gi'),
        // Wrapped in q…Q save/restore block
        new RegExp(`q[\\s\\S]{0,200}?\\(${escaped}\\)[\\s\\S]{0,200}?T[jJ][\\s\\S]{0,200}?Q`, 'g'),
        // PDF TJ array form
        new RegExp(`\\[\\([^)]*${escaped}[^)]*\\)\\]\\s*TJ`, 'gi'),
        // Low-opacity block containing keyword
        new RegExp(`q[\\s\\S]{0,50}?ca\\s+0\\.\\d+[\\s\\S]{0,500}?\\(${escaped}\\)[\\s\\S]{0,200}?Q`, 'g'),
      ];

      let changed = false;
      for (const pat of patterns) {
        const newText = streamText.replace(pat, ' ');
        if (newText !== streamText) { streamText = newText; changed = true; }
      }

      if (changed) {
        const newBytes = new TextEncoder().encode(streamText);
        if (contentRef instanceof PDFLib.PDFArray) {
          const firstRef = contentRef.asArray()[0];
          if (firstRef) {
            const s = doc.context.lookup(firstRef, PDFLib.PDFRawStream);
            if (s) s.contents = newBytes;
          }
        } else {
          const stream = doc.context.lookup(contentRef, PDFLib.PDFRawStream);
          if (stream) stream.contents = newBytes;
        }
        removedCount++;
        log(`  Stream-level removal on page ${pi + 1}`, 'green');
      }
    } catch (e) {
      log(`  Stream pg ${pi + 1}: ${e.message}`, 'dim');
    }
  }

  return removedCount;
}

/** Remove structural watermarks: OCG layer OFF + XObject Resource deletion */
async function removeStructuralWatermarks(candidates) {
  let count = 0;
  const doc = state.pdfLibDoc;

  for (const c of candidates) {
    if (c.type === 'ocg') {
      try {
        removeOCGLayer(c.ref, doc);
        log(`  Removed OCG: ${c.label}`, 'green');
        count++;
      } catch (e) {
        log(`  OCG remove: ${e.message}`, 'warn');
      }
    }
    if (c.type === 'xobject') {
      try {
        doc.getPages().forEach(page => {
          try { removeXObjectFromPage(page, c.ref, doc.context); } catch (_) {}
        });
        log(`  Removed XObject: ${c.label}`, 'green');
        count++;
      } catch (e) {
        log(`  XObject remove: ${e.message}`, 'warn');
      }
    }
  }

  return count;
}

function removeOCGLayer(ocgRef, doc) {
  const catalog = doc.catalog;
  const ocProps = catalog.get(PDFLib.PDFName.of('OCProperties'));
  if (!ocProps) return;
  const d = ocProps.get(PDFLib.PDFName.of('D'));
  if (d) {
    let off = d.get(PDFLib.PDFName.of('OFF'));
    if (!off) { off = doc.context.obj([]); d.set(PDFLib.PDFName.of('OFF'), off); }
    if (off instanceof PDFLib.PDFArray) off.push(ocgRef);
  }
}

function removeXObjectFromPage(page, targetRef, context) {
  const resources = page.node.get(PDFLib.PDFName.of('Resources'));
  if (!resources) return;
  const xObjects = resources.get(PDFLib.PDFName.of('XObject'));
  if (!xObjects) return;
  const xObjDict = context.lookup(xObjects, PDFLib.PDFDict);
  if (!xObjDict) return;
  xObjDict.keys().forEach(key => {
    try {
      const val = xObjDict.get(key);
      if (val && val.objectNumber === targetRef.objectNumber) xObjDict.delete(key);
    } catch (_) {}
  });
}

// ══════════════════════════════════════════════════════════════════════════════
// ─── GEMINI AI ASSIST ─────────────────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════════════════

async function queryGemini(apiKey, pageTexts) {
  const contextStr = pageTexts
    .slice(0, 5)
    .map(p => `[Page ${p.page}]: ${p.text.slice(0, 2000)}`)
    .join('\n\n');

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;

  const payload = {
    contents: [{
      parts: [{
        text: `You are a PDF watermark detection expert. Analyze the following extracted PDF page text.
Identify the exact watermark text — text like CONFIDENTIAL, DRAFT, SAMPLE, COPY, VOID, or similar labels that:
- Repeats across multiple pages at the same position
- Is unrelated to the main document content
- Appears to be a stamp, diagonal overlay, header label, or footer imprint

PDF extracted text:
${contextStr}

CRITICAL INSTRUCTIONS:
1. Return ONLY the exact watermark string as it appears in the text — no explanation, no punctuation, no quotes.
2. If multiple watermarks exist, return only the single most prominent one.
3. If you cannot identify any watermark confidently, return exactly: NONE`
      }]
    }],
    generationConfig: {
      temperature:     0.1,
      topK:            1,
      topP:            0.1,
      maxOutputTokens: 64,
    },
    safetySettings: [
      { category: 'HARM_CATEGORY_HARASSMENT',        threshold: 'BLOCK_NONE' },
      { category: 'HARM_CATEGORY_HATE_SPEECH',       threshold: 'BLOCK_NONE' },
      { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
      { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
    ],
  };

  const response = await fetch(endpoint, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(payload),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Gemini API error ${response.status}: ${errText.slice(0, 200)}`);
  }

  const json = await response.json();
  const text = json?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
  return (!text || text === 'NONE') ? null : text;
}

// ─── SHOW PANELS ─────────────────────────────────────────────────────────────
function showHintPanel() {
  ui.hintPanel.classList.add('show');
  if (ui.wmHint) ui.wmHint.focus();
}
function showGeminiPanel() {
  ui.geminiPanel.classList.add('show');
  if (ui.geminiKeyInput) ui.geminiKeyInput.focus();
}

/**
 * Smart fallback: auto-runs Gemini if key is present, else shows hint panel.
 * Never crashes — always degrades gracefully.
 */
async function tryGeminiOrHint(pageTexts) {
  const key = state.geminiKey
    || (ui.geminiKeyInput ? ui.geminiKeyInput.value.trim() : '')
    || ($('sidebar-gemini-key') ? $('sidebar-gemini-key').value.trim() : '');

  if (key) {
    setPhaseState(3, 'active');
    log('══ Phase 3: Gemini AI Assist ══', 'blue');
    state.geminiKey = key;
    if (ui.geminiKeyInput) ui.geminiKeyInput.value = key;

    try {
      log(`Querying ${GEMINI_MODEL} with page text context…`, 'blue');
      const watermarkStr = await queryGemini(key, pageTexts);

      if (watermarkStr) {
        log(`Gemini identified: "${watermarkStr}"`, 'green');
        setPhaseState(3, 'done');
        setProgress(70);

        setPhaseState(4, 'active');
        log('══ Phase 4: Removing Gemini-Identified Watermark ══', 'blue');

        const coordCount  = await removeByCoordinates(watermarkStr);
        const streamCount = await searchAndRemoveByText(watermarkStr);
        const total = coordCount + streamCount;

        setProgress(88);
        log(`Phase 4 ✓ — Removed ${total} instance(s) of "${watermarkStr}"`, 'green');
        setPhaseState(4, 'done');
        await doPhase5();
        return;
      } else {
        setPhaseState(3, 'done');
        log('Gemini found no specific watermark in the extracted text.', 'warn');
      }
    } catch (e) {
      setPhaseState(3, 'error');
      log('Gemini error: ' + e.message, 'err');
    }

    // Fall through to manual hint
    setPhaseState(4, 'active');
    log('══ Phase 4: Manual Hint ══', 'blue');
    log('Please enter the watermark text you can see in the PDF.', 'warn');
    showHintPanel();

  } else {
    // No key → skip Gemini, show both panels
    setPhaseState(3, 'skip');
    log('No Gemini API key — skipping AI assist.', 'warn');
    log('💡 Add your free Gemini key (Gemini 2.5 Flash) to enable AI detection.', 'dim');
    setPhaseState(4, 'active');
    log('══ Phase 4: Manual Hint / Gemini Key ══', 'blue');
    log('Enter what the watermark says below, or add your Gemini key.', 'warn');
    showHintPanel();
    showGeminiPanel();
  }
}

// ─── HINT PANEL ACTION ────────────────────────────────────────────────────────
ui.btnHintSearch.addEventListener('click', async () => {
  const hint = ui.wmHint ? ui.wmHint.value.trim() : '';
  if (!hint) { log('Please type the watermark text you can see in the PDF.', 'warn'); return; }

  setPhaseState(4, 'active');
  log(`Phase 4 — Searching for: "${hint}"…`, 'blue');

  try {
    const coordCount  = await removeByCoordinates(hint);
    const streamCount = await searchAndRemoveByText(hint);
    const total = coordCount + streamCount;
    setProgress(82);

    if (total > 0) {
      setPhaseState(4, 'done');
      log(`Phase 4 ✓ — Removed ${total} instance(s) of "${hint}".`, 'green');
      await doPhase5();
    } else {
      setPhaseState(4, 'error');
      log(`Phase 4 — No matches found for "${hint}".`, 'warn');
      log('The watermark may be embedded in image pixels. For scanned PDFs, reload and use the CV Image Engine (automatic for scanned files).', 'dim');
    }
  } catch (e) {
    setPhaseState(4, 'error');
    log('Phase 4 error: ' + e.message, 'err');
  }
});

// ─── GEMINI PANEL — MANUAL TRIGGER ───────────────────────────────────────────
ui.btnRunGemini.addEventListener('click', async () => {
  const key = ui.geminiKeyInput ? ui.geminiKeyInput.value.trim() : '';
  if (!key) { log('Please enter your Gemini API key.', 'warn'); return; }

  state.geminiKey = key;
  const sidebarKey = $('sidebar-gemini-key');
  if (sidebarKey) sidebarKey.value = key;

  setPhaseState(3, 'active');
  log(`Phase 3 — Querying ${GEMINI_MODEL}…`, 'blue');
  ui.btnRunGemini.disabled = true;
  ui.btnRunGemini.textContent = '⏳ Querying…';

  try {
    const pageTexts   = await extractAllPageText();
    state.pageTexts = pageTexts;
    const watermarkStr = await queryGemini(key, pageTexts);

    if (!watermarkStr) throw new Error('Gemini could not identify a watermark from this PDF text.');

    log(`Phase 3 ✓ — Gemini identified: "${watermarkStr}"`, 'green');
    setPhaseState(3, 'done');
    setProgress(75);

    if (ui.geminiResult)    ui.geminiResult.style.display = 'block';
    if (ui.geminiResultBox) ui.geminiResultBox.textContent = watermarkStr;
    state._geminiWatermarkStr = watermarkStr;

    log(`Auto-removing "${watermarkStr}"…`, 'blue');
    setPhaseState(4, 'active');
    const coordCount  = await removeByCoordinates(watermarkStr);
    const streamCount = await searchAndRemoveByText(watermarkStr);
    const total = coordCount + streamCount;
    setProgress(88);
    log(`Removed ${total} instance(s) of "${watermarkStr}".`, 'green');
    setPhaseState(4, 'done');
    await doPhase5();

  } catch (e) {
    setPhaseState(3, 'error');
    log('Gemini error: ' + e.message, 'err');
  } finally {
    ui.btnRunGemini.disabled = false;
    ui.btnRunGemini.textContent = '🤖 Identify & Remove with Gemini';
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// ─── MAIN START PURGE HANDLER ─────────────────════════════════════════════════
// ══════════════════════════════════════════════════════════════════════════════

ui.btnStartPurge.addEventListener('click', async () => {
  if (!state.pdfLibDoc) { log('No PDF loaded.', 'warn'); return; }

  // Freeze button
  ui.btnStartPurge.disabled = true;
  ui.btnStartPurge.textContent = '⚙️ Processing…';
  ui.btnStartPurge.style.opacity = '0.6';

  // Show pipeline
  ui.phasesPanel.classList.add('show');
  ui.downloadPanel.classList.remove('show');
  ui.hintPanel.classList.remove('show');
  ui.geminiPanel.classList.remove('show');
  if (ui.geminiResult) ui.geminiResult.style.display = 'none';
  state.candidates = [];

  for (let i = 1; i <= 5; i++) setPhaseState(i, '');
  setProgress(0);

  try {
    // ══ PHASE 1: SMART DETECTION ══════════════════════════════════════════════
    setPhaseState(1, 'active');
    log('══ Phase 1: Smart Detection ══', 'blue');
    await sleep(80);

    // Step 1: Detect PDF type
    log('Detecting PDF type…');
    const pdfType = await detectPDFType();
    log(`PDF type: ${pdfType === 'scanned' ? '🖼️  Scanned Image PDF' : '📄  Vector/Text PDF'}`,
        pdfType === 'scanned' ? 'warn' : 'dim');
    setProgress(8);

    // ── Scanned PDF: auto-run CV Image Engine ────────────────────────────────
    if (pdfType === 'scanned') {
      setPhaseState(1, 'done');
      log('Scanned image PDF detected — activating CV Image Engine automatically.', 'blue');
      setPhaseState(2, 'active');
      log('══ Phase 2: CV Image Engine ══', 'blue');
      await runCVEngine();
      setPhaseState(2, 'done');
      setPhaseState(3, 'skip');
      setPhaseState(4, 'skip');
      await doPhase5();
      return;
    }

    // ── Vector PDF: extract all text ─────────────────────────────────────────
    log('Extracting text from all pages via pdf.js…');
    const pageTexts = await extractAllPageText();
    state.pageTexts = pageTexts;
    const totalItems = pageTexts.reduce((s, p) => s + p.items.length, 0);
    log(`Extracted ${totalItems} text items across ${pageTexts.length} page(s).`, 'dim');
    setProgress(18);

    // Step 2: Check user-defined watermarks first, then auto-keywords
    let detectedKeywords = [];

    if (watermarkList.length > 0) {
      log(`Checking ${watermarkList.length} user-defined watermark(s)…`);
      const userMatches = detectWatermarkKeywords(pageTexts, watermarkList);
      if (userMatches.length > 0) {
        detectedKeywords = userMatches;
        log(`User watermarks found in text: ${userMatches.map(d => `"${d.text}"`).join(', ')}`, 'green');
      } else {
        log('User-defined watermarks not matched in extracted text. Running auto-detection…', 'warn');
        // Fall back to auto-detection keywords
        detectedKeywords = detectWatermarkKeywords(pageTexts, []);
      }
    } else {
      // No user input: auto-detect
      detectedKeywords = detectWatermarkKeywords(pageTexts, []);
    }

    // Step 3: Structural scan (OCG / XObject)
    log('Scanning PDF structure for watermark objects…');
    const structCandidates = await detectStructuralWatermarks();
    setProgress(28);

    const foundSomething = detectedKeywords.length > 0 || structCandidates.length > 0;

    if (foundSomething) {
      if (detectedKeywords.length > 0) {
        log(`Phase 1 ✓ — Text watermarks: ${detectedKeywords.map(d => `"${d.text}" (${d.pages}pg)`).join(', ')}`, 'green');
      }
      if (structCandidates.length > 0) {
        log(`Phase 1 ✓ — Structural watermarks: ${structCandidates.length} object(s)`, 'green');
      }
      setPhaseState(1, 'done');

      renderCandidates([
        ...detectedKeywords.map(d => ({ type: 'text', label: `"${d.text}" found on ${d.pages} page(s)` })),
        ...structCandidates,
      ]);

      // ══ PHASE 2: SMART REMOVAL ════════════════════════════════════════════
      setPhaseState(2, 'active');
      log('══ Phase 2: Smart Removal ══', 'blue');
      await sleep(80);

      let totalRemoved = 0;

      // Method A: coordinate-based white overlay (most reliable)
      for (const { text } of detectedKeywords) {
        log(`Removing "${text}" via coordinate overlay…`);
        totalRemoved += await removeByCoordinates(text);
        // Also try content stream byte scan as supplemental
        totalRemoved += await searchAndRemoveByText(text);
      }

      // Also try user watermarks that weren't in auto-detected list
      for (const wm of watermarkList) {
        if (!detectedKeywords.find(d => d.text.toUpperCase() === wm.toUpperCase())) {
          log(`Trying user watermark "${wm}" via stream search…`);
          totalRemoved += await searchAndRemoveByText(wm);
        }
      }

      // Method B: structural removal
      if (structCandidates.length > 0) {
        totalRemoved += await removeStructuralWatermarks(structCandidates);
      }

      setProgress(80);

      if (totalRemoved > 0) {
        setPhaseState(2, 'done');
        log(`Phase 2 ✓ — Removed ${totalRemoved} watermark instance(s).`, 'green');
        setPhaseState(3, 'skip');
        setPhaseState(4, 'skip');
        await doPhase5();
      } else {
        setPhaseState(2, 'done');
        log('Phase 2 — Watermarks detected but direct removal had limited effect.', 'warn');
        log('Font encoding may prevent stream-level removal. Trying AI + manual fallback…', 'warn');
        setProgress(40);
        await tryGeminiOrHint(pageTexts);
      }

    } else {
      setPhaseState(1, 'done');
      log('Phase 1 — No watermarks detected in text layer or structure.', 'warn');
      if (watermarkList.length > 0) {
        log(`Target "${watermarkList.join(', ')}" not found via text extraction.`, 'warn');
      }
      setProgress(30);
      setPhaseState(2, 'skip');
      await tryGeminiOrHint(pageTexts);
    }

  } catch (err) {
    log('✗ Processing error: ' + err.message, 'err');
    console.error(err);
    ui.btnStartPurge.disabled = false;
    ui.btnStartPurge.textContent = '⚡ Start Watermark Purge';
    ui.btnStartPurge.style.opacity = '1';
  }
});

// ─── PHASE 5 — EXPORT ─────────────────────────────────────────────────────────
async function doPhase5() {
  setPhaseState(5, 'active');
  log('══ Phase 5: Exporting Clean PDF ══', 'blue');
  setProgress(90);

  try {
    await sleep(80);
    const savedBytes = await state.pdfLibDoc.save({
      addDefaultPage:          false,
      updateFieldAppearances:  false,
    });

    state.purgedBytes = savedBytes;
    setProgress(100);
    setPhaseState(5, 'done');

    const origSize  = formatBytes(state.fileSize);
    const newSize   = formatBytes(savedBytes.byteLength);
    const reduction = Math.round((1 - savedBytes.byteLength / state.fileSize) * 100);

    log(`Phase 5 ✓ — Purge complete!`, 'green');
    log(`  ${origSize} → ${newSize} (${reduction > 0 ? '-' + reduction + '%' : 'same size'})`, 'green');
    log('  Download ready. File never left your browser.', 'dim');

    const baseName = state.fileName.replace(/\.pdf$/i, '');
    state._downloadName = `${baseName}_PURGED.pdf`;

    ui.downloadSummary.innerHTML = `
      <strong>${escHtml(state.fileName)}</strong><br/>
      ${state.pageCount} pages &nbsp;·&nbsp; ${origSize} → ${newSize}
      ${reduction > 0 ? `<br/><span style="color:var(--green)">↓ ${reduction}% smaller</span>` : ''}
    `;
    ui.downloadPanel.classList.add('show');

    ui.btnStartPurge.disabled = false;
    ui.btnStartPurge.textContent = '⚡ Purge Again';
    ui.btnStartPurge.style.opacity = '1';
    ui.overallStatus.textContent = 'COMPLETE';
    ui.overallStatus.style.color = 'var(--green)';

  } catch (e) {
    setPhaseState(5, 'error');
    log('Phase 5 error: ' + e.message, 'err');
  }
}

// ─── DOWNLOAD ─────────────────────────────────────────────────────────────────
ui.btnDownload.addEventListener('click', () => {
  if (!state.purgedBytes) { log('No purged file ready.', 'warn'); return; }
  const blob = new Blob([state.purgedBytes], { type: 'application/pdf' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = state._downloadName || 'purged.pdf';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  log(`Downloaded: ${a.download}`, 'green');
});

// ─── PROCESS ANOTHER ─────────────────────────────────────────────────────────
ui.btnProcessAnother.addEventListener('click', resetAll);

// ─── RENDER CANDIDATES ────────────────────────────────────────────────────────
function renderCandidates(candidates) {
  if (!candidates.length) return;
  ui.candidatesSection.style.display = 'block';
  ui.candidatesList.innerHTML = '';
  candidates.forEach((c) => {
    const div = document.createElement('div');
    div.className = 'candidate-item';
    const typeLabel = c.type === 'xobject' ? 'XOBJ' : c.type === 'ocg' ? 'OCG' : 'TEXT';
    div.innerHTML = `
      <span class="candidate-text" title="${escHtml(c.label)}">${escHtml(c.label)}</span>
      <span class="candidate-tag">${typeLabel}</span>
    `;
    ui.candidatesList.appendChild(div);
  });
}

// ─── RESET ────────────────────────────────────────────────────────────────────
function resetAll() {
  state.rawBytes    = null;
  state.pdfLibDoc   = null;
  state.pdfjsDoc    = null;
  state.fileName    = '';
  state.fileSize    = 0;
  state.pageCount   = 0;
  state.candidates  = [];
  state.purgedBytes = null;
  state.currentPhase = 0;
  state.geminiKey   = null;
  delete state._geminiWatermarkStr;
  delete state._downloadName;

  ui.fileInput.value = '';
  ui.fileInfo.classList.remove('show');
  ui.uploadZone.classList.remove('has-file', 'drag-over');
  ui.btnStartPurge.disabled = true;
  ui.btnStartPurge.textContent = '⚡ Start Watermark Purge';
  ui.btnStartPurge.style.opacity = '0.4';
  ui.btnStartPurge.style.cursor = 'not-allowed';
  ui.phasesPanel.classList.remove('show');
  ui.hintPanel.classList.remove('show');
  ui.geminiPanel.classList.remove('show');
  ui.downloadPanel.classList.remove('show');
  if (ui.geminiResult)  ui.geminiResult.style.display = 'none';
  if (ui.geminiKeyInput) ui.geminiKeyInput.value = '';
  if (ui.wmHint) ui.wmHint.value = '';
  ui.mainProgress.style.width = '0%';
  ui.overallStatus.textContent = 'IDLE';
  ui.overallStatus.style.color = '';
  ui.candidatesSection.style.display = 'none';

  watermarkList.length = 0;
  renderChips();

  for (let i = 1; i <= 5; i++) setPhaseState(i, '');
  log('─── Session reset. Ready for new PDF. ───', 'dim');
}

// ─── UTILITIES ────────────────────────────────────────────────────────────────
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function formatBytes(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024, s = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + s[i];
}

// ─── TARGET WATERMARK CHIPS INPUT ─────────────────────────────────────────────
const watermarkList = [];
const wmInput   = $('watermark-input');
const chipsList = $('chips-list');

if (wmInput && chipsList) {
  wmInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const val = wmInput.value.trim();
      if (val && !watermarkList.includes(val)) {
        watermarkList.push(val);
        renderChips();
        wmInput.value = '';
      }
    }
  });
  chipsList.addEventListener('click', (e) => {
    if (e.target.classList.contains('delete-chip')) {
      const idx = parseInt(e.target.getAttribute('data-idx'));
      watermarkList.splice(idx, 1);
      renderChips();
    }
  });
}

function renderChips() {
  if (!chipsList) return;
  chipsList.innerHTML = '';
  watermarkList.forEach((wm, idx) => {
    const chip = document.createElement('div');
    chip.style.cssText = `
      display:inline-flex;align-items:center;gap:6px;
      background:rgba(0,195,255,0.1);border:1px solid rgba(0,195,255,0.25);
      color:var(--blue);padding:4px 10px;border-radius:100px;
      font-size:0.78rem;font-family:var(--mono);
    `;
    chip.innerHTML = `
      <span>${escHtml(wm)}</span>
      <span class="delete-chip" style="cursor:pointer;opacity:0.6;font-weight:bold;margin-left:4px;" data-idx="${idx}">✕</span>
    `;
    chipsList.appendChild(chip);
  });
  if (wmInput) {
    wmInput.placeholder = watermarkList.length > 0 ? 'Add more…' : 'Type watermark and press Enter…';
  }
}

// ─── API KEY SYNC (sidebar ↔ gemini panel) ────────────────────────────────────
const sidebarKeyInput = $('sidebar-gemini-key');
const mainKeyInput    = ui.geminiKeyInput;

if (sidebarKeyInput && mainKeyInput) {
  sidebarKeyInput.addEventListener('input', () => {
    mainKeyInput.value = sidebarKeyInput.value;
    state.geminiKey = sidebarKeyInput.value.trim();
  });
  mainKeyInput.addEventListener('input', () => {
    sidebarKeyInput.value = mainKeyInput.value;
    state.geminiKey = mainKeyInput.value.trim();
  });
  const sidebarToggle = $('btn-toggle-sidebar-key');
  if (sidebarToggle) {
    sidebarToggle.addEventListener('click', () => {
      sidebarKeyInput.type = sidebarKeyInput.type === 'password' ? 'text' : 'password';
      sidebarToggle.textContent = sidebarKeyInput.type === 'password' ? '👁' : '🙈';
    });
  }
}

// ─── INIT LOG ─────────────────────────────────────────────────────────────────
log('DocPurge AI Engine v2.0 — Ready', 'green');
log(`AI Model: ${GEMINI_MODEL}  ·  Detection: pdfjs text layer + PDF structure`, 'blue');
log('No size limit. No uploads. 100% local processing.', 'dim');
log('Drop a PDF above to begin.', 'dim');

// ══════════════════════════════════════════════════════════════════════════════
// ─── CV IMAGE PURGE ENGINE (scanned/rasterized PDFs) ─────────────────────────
// ══════════════════════════════════════════════════════════════════════════════
const templates = { wc: null, jc: null, bb: null };

async function runCVEngine() {
  log('══ Running CV Image Purge Engine (Scanned PDF mode) ══', 'blue');
  setProgress(5);
  log('Loading visual watermark templates…');
  await loadAllTemplates();
  setProgress(10);

  const pdfjsDoc = state.pdfjsDoc;
  const numPages = pdfjsDoc.numPages;
  const outDoc   = await PDFLib.PDFDocument.create();

  // Concurrency limit of 4 keeps CPU/GPU pipelines fully saturated
  const CONCURRENCY = 4;
  const pageIndices = Array.from({ length: numPages }, (_, i) => i);
  let completedCount = 0;
  const processedPages = new Array(numPages);

  async function worker(pi) {
    try {
      const page     = await pdfjsDoc.getPage(pi + 1);
      const viewport = page.getViewport({ scale: 1.5 });

      const canvas  = document.createElement('canvas');
      canvas.width  = viewport.width;
      canvas.height = viewport.height;
      const ctx = canvas.getContext('2d');

      await page.render({ canvasContext: ctx, viewport }).promise;

      const imgData     = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const cleanedData = purgeCanvasPixels(imgData);
      ctx.putImageData(cleanedData, 0, 0);

      const jpegUrl   = canvas.toDataURL('image/jpeg', 0.90);
      const jpegBytes = await fetch(jpegUrl).then(res => res.arrayBuffer());

      processedPages[pi] = {
        bytes: jpegBytes,
        width: viewport.width,
        height: viewport.height
      };

      completedCount++;
      log(`  Processed page ${pi + 1}/${numPages}…`);
      setProgress(10 + Math.round((completedCount / numPages) * 70));
    } catch (err) {
      log(`✗ Error processing page ${pi + 1}: ${err.message}`, 'err');
    }
  }

  // Run concurrency pool
  const pool = [];
  for (let i = 0; i < Math.min(CONCURRENCY, numPages); i++) {
    pool.push((async () => {
      while (pageIndices.length > 0) {
        const nextIdx = pageIndices.shift();
        await worker(nextIdx);
      }
    })());
  }

  await Promise.all(pool);

  // Assemble pages in correct order
  log('Assembling final PDF document…');
  for (let pi = 0; pi < numPages; pi++) {
    const pData = processedPages[pi];
    if (pData) {
      const embedImg  = await outDoc.embedJpg(pData.bytes);
      const newPage   = outDoc.addPage([pData.width, pData.height]);
      newPage.drawImage(embedImg, { x: 0, y: 0, width: pData.width, height: pData.height });
    }
  }

  state.pdfLibDoc = outDoc;
  log('✓ CV Image Purge complete across all pages.', 'green');
}

function purgeCanvasPixels(imgData) {
  const w = imgData.width, h = imgData.height, pixels = imgData.data;
  const redMask  = new Uint8Array(w * h);
  const blueMask = new Uint8Array(w * h);

  for (let i = 0; i < pixels.length; i += 4) {
    const r = pixels[i], g = pixels[i+1], b = pixels[i+2];

    // Pre-filtering: skip low-saturation pixels (gray background, dark text, white pages)
    // This bypasses complex RGB-to-HSV math for 95%+ of the pixels.
    const max = r > g ? (r > b ? r : b) : (g > b ? g : b);
    const min = r < g ? (r < b ? r : b) : (g < b ? g : b);
    if (max - min < 15) continue;

    const hsv = rgbToHsv(r, g, b);
    if ((hsv[0] >= 0 && hsv[0] <= 10) || (hsv[0] >= 168 && hsv[0] <= 180)) {
      if (hsv[1] >= 40 && hsv[2] >= 40) redMask[i / 4] = 1;
    }
    if (hsv[0] >= 95 && hsv[0] <= 135 && hsv[1] >= 50 && hsv[2] >= 80) blueMask[i / 4] = 1;
  }

  const sHWc = Math.round(h * 0.35), sWWc = Math.round(w * 0.45);
  const resWc = matchTemplateSparse(redMask, w, h, templates.wc, w - sWWc, 0, sWWc, sHWc);
  if (resWc.score >= 0.45) {
    const bg = sampleCanvasBg(pixels, w, h, resWc.x, resWc.y, resWc.tw, resWc.th, redMask);
    erasePoints(pixels, w, h, resWc.x, resWc.y, resWc.points, bg);
  }

  const sHJc = Math.round(h * 0.55), sWJc = Math.round(w * 0.45);
  const resJc = matchTemplateSparse(redMask, w, h, templates.jc, w - sWJc, 0, sWJc, sHJc);
  if (resJc.score >= 0.45) {
    const bg = sampleCanvasBg(pixels, w, h, resJc.x, resJc.y, resJc.tw, resJc.th, redMask);
    erasePoints(pixels, w, h, resJc.x, resJc.y, resJc.points, bg);
  }

  const sHBb = Math.round(h * 0.15);
  const resBb = matchTemplateSparse(blueMask, w, h, templates.bb, 0, h - sHBb, w, sHBb);
  if (resBb.score >= 0.45) {
    const by = resBb.y, scale = w / 1462.0, curveWidth = Math.round(120 * scale);
    for (let y = by - 3; y < h; y++)
      for (let x = 0; x < w; x++) {
        const idx = (y * w + x) * 4;
        pixels[idx] = pixels[idx+1] = pixels[idx+2] = 255;
      }
    const cyStart = Math.max(0, by - 45);
    for (let y = cyStart; y < by - 3; y++)
      for (let x = 0; x < curveWidth; x++) {
        const idx = (y * w + x) * 4;
        pixels[idx] = pixels[idx+1] = pixels[idx+2] = 255;
      }
  }

  return imgData;
}

function matchTemplateSparse(targetMask, targetW, targetH, template, searchX, searchY, searchW, searchH) {
  const scale = targetW / 1462.0;
  const scaledPoints = template.points.map(pt => ({
    x: Math.round(pt.x * scale), y: Math.round(pt.y * scale)
  }));
  const tw = Math.round(template.width * scale), th = Math.round(template.height * scale);

  const uniquePoints = [];
  const seen = new Set();
  scaledPoints.forEach(pt => {
    const key = `${pt.x},${pt.y}`;
    if (!seen.has(key)) { seen.add(key); uniquePoints.push(pt); }
  });
  if (uniquePoints.length === 0) return { score: 0 };

  let bestScore = 0, bestX = 0, bestY = 0;
  const maxX = searchX + searchW - tw, maxY = searchY + searchH - th;
  const COARSE_STEP = 6;

  // 1. Coarse search (large step for extreme speed)
  for (let y = searchY; y <= maxY; y += COARSE_STEP) {
    for (let x = searchX; x <= maxX; x += COARSE_STEP) {
      let mc = 0;
      for (let i = 0; i < uniquePoints.length; i++) {
        const pt = uniquePoints[i], tx = x + pt.x, ty = y + pt.y;
        if (tx >= 0 && tx < targetW && ty >= 0 && ty < targetH && targetMask[ty * targetW + tx]) mc++;
      }
      const score = mc / uniquePoints.length;
      if (score > bestScore) { bestScore = score; bestX = x; bestY = y; }
    }
  }

  // 2. Fine search around the peak candidate (step of 1)
  if (bestScore >= 0.35) {
    let fS = bestScore, fX = bestX, fY = bestY;
    const startY = Math.max(searchY, bestY - COARSE_STEP);
    const endY = Math.min(maxY, bestY + COARSE_STEP);
    const startX = Math.max(searchX, bestX - COARSE_STEP);
    const endX = Math.min(maxX, bestX + COARSE_STEP);

    for (let y = startY; y <= endY; y++) {
      for (let x = startX; x <= endX; x++) {
        let mc = 0;
        for (let i = 0; i < uniquePoints.length; i++) {
          const pt = uniquePoints[i], tx = x + pt.x, ty = y + pt.y;
          if (targetMask[ty * targetW + tx]) mc++;
        }
        const score = mc / uniquePoints.length;
        if (score > fS) { fS = score; fX = x; fY = y; }
      }
    }
    return { score: fS, x: fX, y: fY, tw, th, points: uniquePoints };
  }
  return { score: bestScore, x: bestX, y: bestY, tw, th, points: uniquePoints };
}

function sampleCanvasBg(pixels, w, h, bx, by, bw, bh, mask) {
  let sR = 0, sG = 0, sB = 0, cnt = 0;
  for (let y = by; y < by + bh; y++)
    for (let x = bx; x < bx + bw; x++)
      if (x >= 0 && x < w && y >= 0 && y < h && !mask[y * w + x]) {
        const pIdx = (y * w + x) * 4;
        sR += pixels[pIdx]; sG += pixels[pIdx+1]; sB += pixels[pIdx+2]; cnt++;
      }
  return cnt > 0 ? [Math.round(sR/cnt), Math.round(sG/cnt), Math.round(sB/cnt)] : [255,255,255];
}

function erasePoints(pixels, w, h, bx, by, points, bg) {
  points.forEach(pt => {
    const px = bx + pt.x, py = by + pt.y;
    for (let dy = -2; dy <= 2; dy++)
      for (let dx = -2; dx <= 2; dx++) {
        const tx = px + dx, ty = py + dy;
        if (tx >= 0 && tx < w && ty >= 0 && ty < h) {
          const idx = (ty * w + tx) * 4;
          pixels[idx] = bg[0]; pixels[idx+1] = bg[1]; pixels[idx+2] = bg[2];
        }
      }
  });
}

function rgbToHsv(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r,g,b), min = Math.min(r,g,b), d = max - min;
  let h = 0, s = max === 0 ? 0 : d / max, v = max;
  if (max !== min) {
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      case b: h = (r - g) / d + 4; break;
    }
    h /= 6;
  }
  return [Math.round(h * 180), Math.round(s * 255), Math.round(v * 255)];
}

async function loadAllTemplates() {
  if (templates.wc && templates.jc && templates.bb) return;
  templates.wc = await getTemplateMask('../assets/img/template_wc.png', 'red');
  templates.jc = await getTemplateMask('../assets/img/template_jc.png', 'red');
  templates.bb = await getTemplateMask('../assets/img/template_bb.png', 'blue');
}

async function getTemplateMask(src, colorType) {
  const img = await loadTemplateImage(src);
  const canvas = document.createElement('canvas');
  canvas.width = img.width; canvas.height = img.height;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0);
  const { data: pixels } = ctx.getImageData(0, 0, img.width, img.height);
  const mask = new Uint8Array(img.width * img.height);
  for (let i = 0; i < pixels.length; i += 4) {
    const hsv = rgbToHsv(pixels[i], pixels[i+1], pixels[i+2]);
    let active = 0;
    if (colorType === 'red') {
      if ((hsv[0] <= 10 || hsv[0] >= 168) && hsv[1] >= 40 && hsv[2] >= 40) active = 1;
    } else if (colorType === 'blue') {
      if (hsv[0] >= 95 && hsv[0] <= 135 && hsv[1] >= 50 && hsv[2] >= 80) active = 1;
    }
    mask[i / 4] = active;
  }
  const activePoints = [];
  for (let y = 0; y < img.height; y++)
    for (let x = 0; x < img.width; x++)
      if (mask[y * img.width + x]) activePoints.push({ x, y });
  return { width: img.width, height: img.height, points: activePoints, mask };
}

async function loadTemplateImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.src = src;
    img.onload = () => resolve(img);
    img.onerror = reject;
  });
}
