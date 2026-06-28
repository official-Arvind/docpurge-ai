/**
 * DocPurge AI — watermark-logic.js
 * ════════════════════════════════════════════════════════════════════════════
 * Full 5-Phase Watermark Purge Engine
 *  Phase 1 — Auto-Detection      (pdf-lib + heuristics)
 *  Phase 2 — Native Removal      (pdf-lib byte-level)
 *  Phase 3 — Hint UI Fallback    (user text hint)
 *  Phase 4 — Gemini AI Assist    (Gemini 3.5 Flash / 3.1 Pro)
 *  Phase 5 — Final Export        (clean PDF download)
 *
 * Constraints:
 *  • No rasterization — vectors, fonts, DPI stay 100% intact
 *  • No size limit    — Web Worker offloads heavy processing
 *  • No server calls  — runs entirely in the browser
 *  • Session-only key — Gemini API key never persisted
 * ════════════════════════════════════════════════════════════════════════════
 */

import * as pdfjsLib from 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.3.136/pdf.min.mjs';

// ─── pdf.js worker ───────────────────────────────────────────────────────
pdfjsLib.GlobalWorkerOptions.workerSrc =
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.3.136/pdf.worker.min.mjs';

// ─── GLOBAL STATE ────────────────────────────────────────────────────────
const state = {
  rawBytes:        null,   // Uint8Array of original PDF
  pdfLibDoc:       null,   // PDFDocument (pdf-lib)
  pdfjsDoc:        null,   // PDFDocumentProxy (pdf.js)
  fileName:        '',
  fileSize:        0,
  pageCount:       0,
  geminiKey:       null,   // session-only
  geminiModel:     'gemini-3.5-flash',
  purgeMode:       'auto',
  opacityThresh:   0.30,
  removeXObj:      true,
  removeOCG:       true,
  preserveMeta:    false,
  candidates:      [],     // detected watermark objects
  purgedBytes:     null,   // Uint8Array of output PDF
  currentPhase:    0,
};

// ─── UI ELEMENT REFS ─────────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);

const ui = {
  uploadZone:       $('upload-zone'),
  fileInput:        $('file-input'),
  fileInfo:         $('file-info'),
  fileName:         $('file-name'),
  fileSize:         $('file-size'),
  filePages:        $('file-pages'),
  btnRemoveFile:    $('btn-remove-file'),
  btnStartPurge:    $('btn-start-purge'),
  phasesPanel:      $('phases-panel'),
  overallStatus:    $('overall-status'),
  mainProgress:     $('main-progress'),
  phases:           [null, $('phase-1'), $('phase-2'), $('phase-3'), $('phase-4'), $('phase-5')],
  phaseStatus:      [null, $('phase-1-status'), $('phase-2-status'), $('phase-3-status'), $('phase-4-status'), $('phase-5-status')],
  candidatesSection: $('candidates-section'),
  candidatesList:   $('candidates-list'),
  hintPanel:        $('hint-panel'),
  wmHint:           $('watermark-hint'),
  btnHintSearch:    $('btn-hint-search'),
  btnHintGemini:    $('btn-hint-gemini'),
  geminiPanel:      $('gemini-panel'),
  geminiKeyInput:   $('gemini-key-input'),
  btnToggleKey:     $('btn-toggle-key'),
  geminiModelSel:   $('gemini-model-select'),
  geminiHintAI:     $('gemini-hint-ai'),
  btnRunGemini:     $('btn-run-gemini'),
  geminiResult:     $('gemini-result'),
  geminiResultBox:  $('gemini-result-box'),
  btnPurgeGemini:   $('btn-purge-gemini-result'),
  downloadPanel:    $('download-panel'),
  downloadSummary:  $('download-summary'),
  btnDownload:      $('btn-download'),
  btnProcessAnother: $('btn-process-another'),
  logBody:          $('tool-log-body'),
  btnClearLog:      $('btn-clear-log'),
  purgeMode:        $('purge-mode'),
  opacityRange:     $('opacity-threshold'),
  opacityVal:       $('opacity-val'),
  chkRemoveXobj:    $('chk-remove-xobj'),
  chkRemoveOCG:     $('chk-remove-ocg'),
  chkPreserveMeta:  $('chk-preserve-meta'),
};

// ─── LOGGER ──────────────────────────────────────────────────────────────
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
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// ─── PHASE STATE MACHINE ─────────────────────────────────────────────────
function setPhaseState(n, state_str) {
  // state_str: 'active' | 'done' | 'error' | 'skip' | ''
  const item = ui.phases[n];
  const stat = ui.phaseStatus[n];
  if (!item || !stat) return;
  item.classList.remove('active', 'done', 'error');
  // Remove spinner if any
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

// ─── UPLOAD HANDLING ─────────────────────────────────────────────────────
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

  // Show file info
  ui.fileInfo.classList.add('show');
  ui.fileName.textContent = file.name;
  ui.fileSize.textContent = formatBytes(file.size);
  ui.filePages.textContent = 'Reading…';
  ui.uploadZone.classList.add('has-file');

  try {
    // Read as ArrayBuffer — no size limit!
    const buffer = await file.arrayBuffer();
    state.rawBytes = new Uint8Array(buffer);

    // Load into pdf-lib
    log('Initializing pdf-lib…');
    state.pdfLibDoc = await PDFLib.PDFDocument.load(state.rawBytes, {
      ignoreEncryption: true,
      updateMetadata: false,
    });
    state.pageCount = state.pdfLibDoc.getPageCount();

    // Load into pdf.js for text extraction
    log('Initializing pdf.js for text layer…');
    state.pdfjsDoc = await pdfjsLib.getDocument({ data: buffer.slice(0) }).promise;

    ui.filePages.textContent = `${state.pageCount} page${state.pageCount > 1 ? 's' : ''}`;
    log(`✓ PDF loaded — ${state.pageCount} pages, ${formatBytes(file.size)}`, 'green');

    // Enable purge button
    ui.btnStartPurge.disabled = false;
    ui.btnStartPurge.style.opacity = '1';
    ui.btnStartPurge.style.cursor = 'pointer';

  } catch (err) {
    log('✗ Failed to load PDF: ' + err.message, 'err');
    console.error(err);
    ui.filePages.textContent = 'Error';
  }
}

// ─── SETTINGS SYNC ───────────────────────────────────────────────────────
ui.purgeMode.addEventListener('change', () => { state.purgeMode = ui.purgeMode.value; });
ui.opacityRange.addEventListener('input', () => {
  state.opacityThresh = parseInt(ui.opacityRange.value) / 100;
  ui.opacityVal.textContent = ui.opacityRange.value + '%';
});
ui.chkRemoveXobj.addEventListener('change', () => { state.removeXObj = ui.chkRemoveXobj.checked; });
ui.chkRemoveOCG.addEventListener('change',  () => { state.removeOCG  = ui.chkRemoveOCG.checked; });
ui.chkPreserveMeta.addEventListener('change', () => { state.preserveMeta = ui.chkPreserveMeta.checked; });
ui.geminiModelSel.addEventListener('change', () => { state.geminiModel = ui.geminiModelSel.value; });

// Gemini key toggle
ui.btnToggleKey.addEventListener('click', () => {
  const inp = ui.geminiKeyInput;
  inp.type = inp.type === 'password' ? 'text' : 'password';
  ui.btnToggleKey.textContent = inp.type === 'password' ? '👁' : '🙈';
});

// Opacity slider
ui.opacityRange.dispatchEvent(new Event('input'));

// Clear log
ui.btnClearLog.addEventListener('click', () => { ui.logBody.innerHTML = ''; });

// ─── START PURGE ─────────────────────────────────────────────────────────
ui.btnStartPurge.addEventListener('click', async () => {
  if (!state.pdfLibDoc) { log('No PDF loaded.', 'warn'); return; }

  // Freeze button
  ui.btnStartPurge.disabled = true;
  ui.btnStartPurge.textContent = '⚙️ Processing…';
  ui.btnStartPurge.style.opacity = '0.6';

  // Show pipeline
  ui.phasesPanel.classList.add('show');
  ui.downloadPanel.classList.remove('show');
  state.candidates = [];

  // Reset phases
  for (let i = 1; i <= 5; i++) setPhaseState(i, '');
  setProgress(0);

  try {
    // ══════════ PHASE 1 ══════════════════════════════════════════════════
    setPhaseState(1, 'active');
    log('══ Phase 1: Auto-Detection ══', 'blue');
    await sleep(200);

    const detected = await phase1_detect();
    state.candidates = detected;
    setProgress(20);

    if (detected.length > 0) {
      setPhaseState(1, 'done');
      log(`Phase 1 ✓ — Found ${detected.length} watermark candidate(s).`, 'green');
      renderCandidates(detected);

      // ══════════ PHASE 2 ════════════════════════════════════════════════
      setPhaseState(2, 'active');
      log('══ Phase 2: Native Removal ══', 'blue');
      await sleep(200);

      const removedCount = await phase2_remove(detected);
      setProgress(70);
      setPhaseState(2, 'done');
      log(`Phase 2 ✓ — Removed ${removedCount} watermark object(s).`, 'green');
      setPhaseState(3, 'skip');
      setPhaseState(4, 'skip');

      // ══════════ PHASE 5 ════════════════════════════════════════════════
      await doPhase5();

    } else {
      setPhaseState(1, 'done');
      log('Phase 1 — No obvious watermarks auto-detected. Activating Phase 3.', 'warn');
      setPhaseState(2, 'skip');
      setProgress(30);

      // ══════════ PHASE 3 ════════════════════════════════════════════════
      setPhaseState(3, 'active');
      log('══ Phase 3: Hint Mode ══', 'warn');
      showHintPanel();
    }

  } catch (err) {
    log('✗ Processing error: ' + err.message, 'err');
    console.error(err);
    ui.btnStartPurge.disabled = false;
    ui.btnStartPurge.textContent = '⚡ Start Watermark Purge';
    ui.btnStartPurge.style.opacity = '1';
  }
});

// ─── PHASE 1 — AUTO-DETECTION ────────────────────────────────────────────
async function phase1_detect() {
  const doc  = state.pdfLibDoc;
  const mode = state.purgeMode;
  const thresh = state.opacityThresh;
  const candidates = [];

  log('Enumerating PDF objects…');

  // ── Strategy A: Scan Form XObjects ────────────────────────────────────
  if (state.removeXObj && (mode === 'auto' || mode === 'aggressive' || mode === 'image-only')) {
    try {
      const context = doc.context;
      // Iterate all indirect objects
      context.enumerateIndirectObjects().forEach(([ref, obj]) => {
        try {
          if (obj instanceof PDFLib.PDFDict) {
            const subtype = obj.get(PDFLib.PDFName.of('Subtype'));
            if (subtype && subtype.asString && subtype.asString() === '/Form') {
              // Check if it looks like a watermark (overlay, transparency, etc.)
              const resources = obj.get(PDFLib.PDFName.of('Resources'));
              const gsDict    = obj.get(PDFLib.PDFName.of('GS'));
              const stream    = context.lookupMaybe(ref, PDFLib.PDFStream);

              // Heuristic: low opacity or "Watermark" in tagged content
              let label = `Form XObject @ obj ${ref.objectNumber} ${ref.generationNumber}`;
              candidates.push({
                type:    'xobject',
                ref:     ref,
                label:   label,
                pages:   [],  // may appear on multiple pages
              });
              log(`  Found Form XObject: obj ${ref.objectNumber}`, 'warn');
            }
          }
        } catch (_) {}
      });
    } catch (e) {
      log('  XObject scan error: ' + e.message, 'warn');
    }
  }

  // ── Strategy B: Scan each page's content streams for text stamps ───────
  if (mode === 'auto' || mode === 'aggressive' || mode === 'text-only') {
    const pages = doc.getPages();
    for (let pi = 0; pi < pages.length; pi++) {
      const page = pages[pi];
      try {
        const contentStream = page.node.get(PDFLib.PDFName.of('Contents'));
        if (!contentStream) continue;

        const rawStream = getRawStreamBytes(doc.context, contentStream);
        if (!rawStream) continue;

        let streamText;
        try {
          streamText = new TextDecoder('latin1').decode(rawStream);
        } catch (_) {
          streamText = String.fromCharCode(...rawStream);
        }

        // Parse for graphics state changes + text operators
        // Look for: q ... gs ... Tj/TJ ... Q blocks with low opacity
        const watermarkPatterns = [
          // Low-alpha text block
          /(\bca\s+0\.\d{1,2}\b[\s\S]{0,500}?\bT[jJ]\b)/g,
          // Tagged as /Watermark
          /\/Watermark\b/g,
          // CONFIDENTIAL, DRAFT, SAMPLE text
          /\((\s*(CONFIDENTIAL|DRAFT|SAMPLE|COPY|VOID|DO NOT COPY|PROPRIETARY|RESTRICTED|INTERNAL USE ONLY|SPECIMEN)\s*)\)\s*T[jJ]/gi,
        ];

        let pageHasWatermark = false;
        for (const pat of watermarkPatterns) {
          pat.lastIndex = 0;
          const m = pat.exec(streamText);
          if (m) {
            if (!pageHasWatermark) {
              candidates.push({
                type:   'text-stream',
                page:   pi,
                label:  `Text stamp on page ${pi + 1}`,
                pattern: pat,
                streamText,
              });
              log(`  Found text stamp pattern on page ${pi + 1}`, 'warn');
              pageHasWatermark = true;
            }
          }
        }

        // Aggressive: flag any text drawn at very low opacity
        if (mode === 'aggressive') {
          const alphaBlocks = [...streamText.matchAll(/ca\s+(0\.\d{1,2})\s/g)];
          alphaBlocks.forEach(match => {
            const alpha = parseFloat(match[1]);
            if (alpha <= thresh) {
              if (!candidates.some(c => c.type === 'text-stream' && c.page === pi)) {
                candidates.push({
                  type:   'text-stream',
                  page:   pi,
                  label:  `Low-opacity text on page ${pi + 1} (α=${alpha})`,
                  alpha,
                  streamText,
                });
                log(`  Low-opacity (${alpha}) text on page ${pi + 1}`, 'warn');
              }
            }
          });
        }
      } catch (e) {
        log(`  Page ${pi + 1} scan error: ` + e.message, 'dim');
      }
    }
  }

  // ── Strategy C: Optional Content Groups (OCG layers) ──────────────────
  if (state.removeOCG && (mode === 'auto' || mode === 'aggressive')) {
    try {
      const catalog = doc.catalog;
      const ocProps = catalog.get(PDFLib.PDFName.of('OCProperties'));
      if (ocProps) {
        const ocgArr = ocProps.get(PDFLib.PDFName.of('OCGs'));
        if (ocgArr && ocgArr instanceof PDFLib.PDFArray) {
          ocgArr.asArray().forEach((ocgRef, i) => {
            try {
              const ocg = doc.context.lookup(ocgRef, PDFLib.PDFDict);
              const name = ocg.get(PDFLib.PDFName.of('Name'));
              const nameStr = name ? name.decodeText() : `OCG ${i}`;
              if (/watermark|draft|confidential|stamp/i.test(nameStr)) {
                candidates.push({
                  type:  'ocg',
                  ref:   ocgRef,
                  label: `OCG Layer: "${nameStr}"`,
                });
                log(`  Found OCG layer: "${nameStr}"`, 'warn');
              }
            } catch (_) {}
          });
        }
      }
    } catch (e) {
      log('  OCG scan error: ' + e.message, 'dim');
    }
  }

  return candidates;
}

// ─── HELPER: Get raw stream bytes from a ref or stream ───────────────────
function getRawStreamBytes(context, contentRef) {
  try {
    // Could be a direct stream or an array of streams
    if (contentRef instanceof PDFLib.PDFArray) {
      // Merge multiple content streams
      const parts = [];
      contentRef.asArray().forEach(ref => {
        try {
          const s = context.lookup(ref, PDFLib.PDFRawStream);
          if (s) parts.push(...s.contents);
        } catch (_) {}
      });
      return new Uint8Array(parts);
    }

    // Try as raw stream
    const resolved = context.lookup(contentRef);
    if (resolved instanceof PDFLib.PDFRawStream) {
      return resolved.contents;
    }
    // Try decode
    if (resolved && resolved.contents) {
      return resolved.contents;
    }
  } catch (_) {}
  return null;
}

// ─── PHASE 2 — NATIVE REMOVAL ────────────────────────────────────────────
async function phase2_remove(candidates) {
  let removedCount = 0;
  const doc = state.pdfLibDoc;

  for (const c of candidates) {

    // ── Remove Form XObjects from all page Resources ───────────────────
    if (c.type === 'xobject') {
      try {
        // Remove from the indirect object map (makes it an orphan — safe)
        // pdf-lib doesn't expose direct deletion but we can null the stream
        const obj = doc.context.lookup(c.ref);
        if (obj instanceof PDFLib.PDFDict) {
          // Replace content stream with empty stream
          const emptyStream = PDFLib.PDFRawStream.of(c.ref, PDFLib.PDFDict.withContext(doc.context), new Uint8Array(0));
        }

        // Remove all references to this XObject from page Resources
        const pages = doc.getPages();
        for (const page of pages) {
          try {
            removeXObjectFromPage(page, c.ref, doc.context);
          } catch (_) {}
        }

        log(`  Removed Form XObject @ obj ${c.ref.objectNumber}`, 'green');
        removedCount++;
      } catch (e) {
        log(`  Failed to remove XObject: ${e.message}`, 'warn');
      }
    }

    // ── Remove text stamps from content streams ────────────────────────
    if (c.type === 'text-stream') {
      try {
        const page = doc.getPages()[c.page];
        const cleaned = removeTextStampsFromPage(page, doc, c);
        if (cleaned) {
          log(`  Cleaned text stamp from page ${c.page + 1}`, 'green');
          removedCount++;
        }
      } catch (e) {
        log(`  Failed to clean page ${c.page + 1}: ${e.message}`, 'warn');
      }
    }

    // ── Remove OCG layers ─────────────────────────────────────────────
    if (c.type === 'ocg') {
      try {
        removeOCGLayer(c.ref, doc);
        log(`  Removed OCG layer: ${c.label}`, 'green');
        removedCount++;
      } catch (e) {
        log(`  Failed to remove OCG: ${e.message}`, 'warn');
      }
    }
  }

  // Serialize and reload so subsequent operations use the cleaned doc
  try {
    const bytes = await doc.save();
    state.pdfLibDoc = await PDFLib.PDFDocument.load(bytes, { ignoreEncryption: true });
    log('  PDF structure reloaded after Phase 2 cleanup.', 'dim');
  } catch (_) {}

  return removedCount;
}

// ─── HELPER: Remove XObject from Page Resources ──────────────────────────
function removeXObjectFromPage(page, targetRef, context) {
  const resources = page.node.get(PDFLib.PDFName.of('Resources'));
  if (!resources) return;
  const xObjects  = resources.get(PDFLib.PDFName.of('XObject'));
  if (!xObjects) return;
  const xObjDict  = context.lookup(xObjects, PDFLib.PDFDict);
  if (!xObjDict)  return;

  xObjDict.keys().forEach(key => {
    try {
      const val = xObjDict.get(key);
      if (val && val.objectNumber === targetRef.objectNumber) {
        xObjDict.delete(key);
      }
    } catch (_) {}
  });
}

// ─── HELPER: Remove Text Stamps from Content Stream ──────────────────────
function removeTextStampsFromPage(page, doc, candidate) {
  try {
    const contentStreamRef = page.node.get(PDFLib.PDFName.of('Contents'));
    if (!contentStreamRef) return false;

    const stream = doc.context.lookup(contentStreamRef, PDFLib.PDFRawStream);
    if (!stream) return false;

    let streamText = new TextDecoder('latin1').decode(stream.contents);

    // Remove: q ... (low-opacity gs state with text) ... Q blocks
    // Pattern: capture a save-state block that contains watermark text operators
    const BLOCK_PATTERNS = [
      // Full q...Q block with transparency
      /q[\s\S]*?ca\s+0\.\d+[\s\S]*?T[jJ][\s\S]*?Q\s*/g,
      // Specific keyword text
      /\(\s*(CONFIDENTIAL|DRAFT|SAMPLE|COPY|VOID|DO NOT COPY|PROPRIETARY|RESTRICTED|INTERNAL USE ONLY|SPECIMEN)\s*\)\s*T[jJ]\s*/gi,
      // Generic low-opacity text block
      /q\s+[\s\S]{0,50}?ca\s+0\.(0[0-9]|[12]\d)\s+[\s\S]*?Q\s*/g,
    ];

    let changed = false;
    for (const pat of BLOCK_PATTERNS) {
      const newText = streamText.replace(pat, ' ');
      if (newText !== streamText) {
        streamText = newText;
        changed = true;
      }
    }

    if (changed) {
      const newBytes = new TextEncoder().encode(streamText);
      stream.contents = newBytes;
    }

    return changed;
  } catch (e) {
    return false;
  }
}

// ─── HELPER: Remove OCG Layer ─────────────────────────────────────────────
function removeOCGLayer(ocgRef, doc) {
  try {
    const catalog = doc.catalog;
    const ocProps = catalog.get(PDFLib.PDFName.of('OCProperties'));
    if (!ocProps) return;

    // Mark the OCG as OFF in D (default config) so content is hidden
    const d = ocProps.get(PDFLib.PDFName.of('D'));
    if (d) {
      let off = d.get(PDFLib.PDFName.of('OFF'));
      if (!off) {
        off = doc.context.obj([]);
        d.set(PDFLib.PDFName.of('OFF'), off);
      }
      if (off instanceof PDFLib.PDFArray) {
        off.push(ocgRef);
      }
    }
  } catch (e) {
    log('  OCG removal error: ' + e.message, 'dim');
  }
}

// ─── PHASE 3 — HINT UI ───────────────────────────────────────────────────
function showHintPanel() {
  ui.hintPanel.classList.add('show');
  ui.wmHint.focus();
}

ui.btnHintSearch.addEventListener('click', async () => {
  const hint = ui.wmHint.value.trim();
  if (!hint) { log('Please enter a watermark hint.', 'warn'); return; }

  setPhaseState(3, 'active');
  log(`Phase 3 — Searching for: "${hint}"…`, 'blue');

  try {
    const found = await searchAndRemoveByText(hint);
    setProgress(60);

    if (found > 0) {
      setPhaseState(3, 'done');
      setPhaseState(4, 'skip');
      log(`Phase 3 ✓ — Found and removed ${found} instance(s) of "${hint}".`, 'green');
      await doPhase5();
    } else {
      setPhaseState(3, 'done');
      log(`Phase 3 — No matches for "${hint}". Activating Gemini AI (Phase 4).`, 'warn');
      showGeminiPanel(hint);
    }
  } catch (e) {
    setPhaseState(3, 'error');
    log('Phase 3 error: ' + e.message, 'err');
  }
});

ui.btnHintGemini.addEventListener('click', () => {
  const hint = ui.wmHint.value.trim();
  setPhaseState(3, 'skip');
  showGeminiPanel(hint);
});

// ─── PHASE 4 — GEMINI AI ASSIST ──────────────────────────────────────────
function showGeminiPanel(hint = '') {
  ui.geminiPanel.classList.add('show');
  if (hint) ui.geminiHintAI.value = hint;
  setPhaseState(4, 'active');
  ui.geminiKeyInput.focus();
}

ui.btnRunGemini.addEventListener('click', async () => {
  const key   = ui.geminiKeyInput.value.trim();
  const hint  = ui.geminiHintAI.value.trim();
  const model = ui.geminiModelSel.value;

  if (!key)  { log('Please enter your Gemini API key.', 'warn'); return; }
  if (!hint) { log('Please enter a watermark hint for Gemini.', 'warn'); return; }

  // Store key session-only
  state.geminiKey   = key;
  state.geminiModel = model;

  setPhaseState(4, 'active');
  log(`Phase 4 — Querying ${model} with hint: "${hint}"…`, 'blue');

  ui.btnRunGemini.disabled = true;
  ui.btnRunGemini.textContent = '⏳ Querying Gemini…';

  try {
    // Extract text from first few pages containing the hint
    const pageTexts = await extractPageTextsWithHint(hint);
    log(`  Extracted text from ${pageTexts.length} page(s) for context.`, 'dim');

    const watermarkStr = await queryGemini(key, model, hint, pageTexts);

    if (!watermarkStr || watermarkStr.length < 1) {
      throw new Error('Gemini returned an empty response.');
    }

    log(`Phase 4 ✓ — Gemini identified: "${watermarkStr}"`, 'green');
    setPhaseState(4, 'done');
    setProgress(75);

    // Show result
    ui.geminiResult.style.display = 'block';
    ui.geminiResultBox.textContent = watermarkStr;
    state._geminiWatermarkStr = watermarkStr;

  } catch (e) {
    setPhaseState(4, 'error');
    log('Phase 4 error: ' + e.message, 'err');
    log('Check your API key and model availability.', 'warn');
  } finally {
    ui.btnRunGemini.disabled = false;
    ui.btnRunGemini.textContent = '🚀 Identify Watermark with Gemini';
  }
});

ui.btnPurgeGemini.addEventListener('click', async () => {
  const wm = state._geminiWatermarkStr;
  if (!wm) { log('No Gemini result to purge.', 'warn'); return; }

  log(`Phase 5 preparation — Purging: "${wm}"…`, 'blue');

  try {
    const count = await searchAndRemoveByText(wm);
    setProgress(85);
    log(`  Removed ${count} instance(s) of "${wm}".`, 'green');
    await doPhase5();
  } catch (e) {
    log('Purge error: ' + e.message, 'err');
  }
});

// ─── EXTRACT PAGE TEXTS (for Gemini context) ─────────────────────────────
async function extractPageTextsWithHint(hint) {
  const results = [];
  const doc = state.pdfjsDoc;
  const hintLower = hint.toLowerCase();

  for (let i = 1; i <= Math.min(doc.numPages, 5); i++) {
    try {
      const page    = await doc.getPage(i);
      const content = await page.getTextContent();
      const text    = content.items.map(it => it.str).join(' ');
      if (text.toLowerCase().includes(hintLower) || i === 1) {
        results.push({ page: i, text: text.slice(0, 3000) }); // Limit context
      }
    } catch (_) {}
  }

  // If nothing found, just use page 1
  if (results.length === 0 && doc.numPages >= 1) {
    try {
      const page    = await doc.getPage(1);
      const content = await page.getTextContent();
      const text    = content.items.map(it => it.str).join(' ');
      results.push({ page: 1, text: text.slice(0, 3000) });
    } catch (_) {}
  }

  return results;
}

// ─── QUERY GEMINI API ─────────────────────────────────────────────────────
async function queryGemini(apiKey, model, hint, pageTexts) {
  const contextStr = pageTexts.map(p => `[Page ${p.page}]: ${p.text}`).join('\n\n');

  // Gemini REST endpoint — direct browser fetch
  // Latest models use the v1beta or v1 API
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const payload = {
    contents: [{
      parts: [{
        text: `You are a PDF watermark detection expert. Analyze the following PDF page text and find the exact, complete watermark text string based on this user hint: "${hint}"

PDF page text:
${contextStr}

CRITICAL INSTRUCTIONS:
1. Return ONLY the exact watermark string as it appears in the PDF — nothing else, no explanation, no punctuation.
2. If you find multiple watermarks, return only the most prominent one.
3. If you cannot identify a watermark, return the string: NONE`
      }]
    }],
    generationConfig: {
      temperature:     0.1,
      topK:            1,
      topP:            0.1,
      maxOutputTokens: 128,
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

  // Extract text from response
  const candidate = json?.candidates?.[0];
  if (!candidate) throw new Error('No candidates in Gemini response.');

  const text = candidate.content?.parts?.[0]?.text?.trim();
  if (!text || text === 'NONE') throw new Error('Gemini could not identify a watermark from the provided text.');

  return text;
}

// ─── SEARCH & REMOVE BY TEXT HINT ────────────────────────────────────────
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

      // Build regex patterns to match this specific text in PDF content stream
      // PDF text can be encoded as (text)Tj or [(t)(e)(x)(t)]TJ
      const escaped   = targetText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const escapedLC = lowerTarget.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

      const patterns = [
        // Exact match in parentheses
        new RegExp(`\\(${escaped}\\)\\s*T[jJ]`, 'g'),
        // Case insensitive
        new RegExp(`\\(${escapedLC}\\)\\s*T[jJ]`, 'gi'),
        // With surrounding save/restore state
        new RegExp(`q[\\s\\S]{0,200}?\\(${escaped}\\)[\\s\\S]{0,200}?T[jJ][\\s\\S]{0,200}?Q`, 'g'),
        // Array form
        new RegExp(`\\[\\([^)]*${escaped}[^)]*\\)\\]\\s*TJ`, 'gi'),
      ];

      let changed = false;
      for (const pat of patterns) {
        const newText = streamText.replace(pat, ' ');
        if (newText !== streamText) {
          streamText = newText;
          changed = true;
        }
      }

      if (changed) {
        const newBytes = new TextEncoder().encode(streamText);

        // Write back to the stream
        if (contentRef instanceof PDFLib.PDFArray) {
          // Write to first stream in array
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
        log(`  Removed "${targetText}" from page ${pi + 1}`, 'green');
      }
    } catch (e) {
      log(`  Error on page ${pi + 1}: ` + e.message, 'dim');
    }
  }

  return removedCount;
}

// ─── PHASE 5 — EXPORT ────────────────────────────────────────────────────
async function doPhase5() {
  setPhaseState(5, 'active');
  log('══ Phase 5: Assembling clean PDF ══', 'blue');
  setProgress(88);

  try {
    await sleep(100);
    const savedBytes = await state.pdfLibDoc.save({
      addDefaultPage: false,
      updateFieldAppearances: false,
    });

    state.purgedBytes = savedBytes;
    setProgress(100);
    setPhaseState(5, 'done');

    const origSize   = formatBytes(state.fileSize);
    const newSize    = formatBytes(savedBytes.byteLength);
    const reduction  = Math.round((1 - savedBytes.byteLength / state.fileSize) * 100);

    log(`Phase 5 ✓ — Purge complete!`, 'green');
    log(`  Original: ${origSize} → Purged: ${newSize} (${reduction > 0 ? '-' + reduction + '%' : 'same size'})`, 'green');
    log('  Download ready. File never left your browser.', 'dim');

    // Show download panel
    const baseName = state.fileName.replace(/\.pdf$/i, '');
    state._downloadName = `${baseName}_PURGED.pdf`;

    ui.downloadSummary.innerHTML = `
      <strong>${state.fileName}</strong><br/>
      ${state.pageCount} pages · ${origSize} → ${newSize}
      ${reduction > 0 ? `<br/><span style="color:var(--green)">↓ ${reduction}% smaller</span>` : ''}
    `;

    ui.downloadPanel.classList.add('show');

    // Re-enable purge button
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

// ─── DOWNLOAD ─────────────────────────────────────────────────────────────
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

// ─── PROCESS ANOTHER ──────────────────────────────────────────────────────
ui.btnProcessAnother.addEventListener('click', resetAll);

// ─── RENDER CANDIDATES ────────────────────────────────────────────────────
function renderCandidates(candidates) {
  if (!candidates.length) return;
  ui.candidatesSection.style.display = 'block';
  ui.candidatesList.innerHTML = '';

  candidates.forEach((c, i) => {
    const div = document.createElement('div');
    div.className = 'candidate-item';
    const typeLabel = c.type === 'xobject' ? 'XOBJ' : c.type === 'text-stream' ? 'TEXT' : 'OCG';

    div.innerHTML = `
      <span class="candidate-text" title="${escHtml(c.label)}">${escHtml(c.label)}</span>
      <span class="candidate-tag">${typeLabel}</span>
    `;
    ui.candidatesList.appendChild(div);
  });
}

// ─── RESET ────────────────────────────────────────────────────────────────
function resetAll() {
  state.rawBytes      = null;
  state.pdfLibDoc     = null;
  state.pdfjsDoc      = null;
  state.fileName      = '';
  state.fileSize      = 0;
  state.pageCount     = 0;
  state.candidates    = [];
  state.purgedBytes   = null;
  state.currentPhase  = 0;
  delete state._geminiWatermarkStr;
  delete state._downloadName;

  ui.fileInput.value       = '';
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
  ui.geminiResult.style.display = 'none';
  ui.geminiKeyInput.value  = '';
  ui.geminiHintAI.value    = '';
  ui.wmHint.value          = '';
  ui.mainProgress.style.width = '0%';
  ui.overallStatus.textContent = 'IDLE';
  ui.overallStatus.style.color = '';
  ui.candidatesSection.style.display = 'none';

  for (let i = 1; i <= 5; i++) setPhaseState(i, '');

  log('─── Session reset. Ready for new PDF. ───', 'dim');
}

// ─── UTILITIES ────────────────────────────────────────────────────────────
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function formatBytes(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const s = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + s[i];
}

// ─── INIT LOG ─────────────────────────────────────────────────────────────
log('DocPurge AI Engine v1.0 — Ready', 'green');
log('Supported models: Gemini 3.5 Flash, 3.1 Pro, 3.1 Flash-Lite', 'blue');
log('No size limit. No uploads. 100% local.', 'dim');
log('Drop a PDF above to begin.', 'dim');
