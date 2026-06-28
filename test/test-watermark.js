/**
 * DocPurge AI — Node.js Test Script
 * ════════════════════════════════════════════════════════════════════════════
 * Tests the watermark removal logic against PDFs in ./samples/
 *
 * Usage:
 *   npm install pdf-lib
 *   node test-watermark.js
 *
 *   Or with a specific watermark text to remove:
 *   node test-watermark.js --text "CONFIDENTIAL"
 *
 *   Or with a specific file:
 *   node test-watermark.js --file ./samples/my-doc.pdf --text "DRAFT"
 * ════════════════════════════════════════════════════════════════════════════
 */

const { PDFDocument, PDFName, PDFArray, PDFDict, PDFRawStream } = require('pdf-lib');
const fs   = require('fs');
const path = require('path');

// ─── ANSI COLORS ──────────────────────────────────────────────────────────
const C = {
  reset:  '\x1b[0m',
  green:  '\x1b[32m',
  yellow: '\x1b[33m',
  red:    '\x1b[31m',
  cyan:   '\x1b[36m',
  dim:    '\x1b[2m',
  bold:   '\x1b[1m',
  blue:   '\x1b[34m',
};

function log(msg, color = '') { console.log(`${color}${msg}${C.reset}`); }
function logSuccess(msg)  { log(`  ✓ ${msg}`, C.green); }
function logWarn(msg)     { log(`  ⚠ ${msg}`, C.yellow); }
function logError(msg)    { log(`  ✗ ${msg}`, C.red); }
function logInfo(msg)     { log(`  · ${msg}`, C.dim); }

// ─── CLI ARGS ─────────────────────────────────────────────────────────────
const args      = process.argv.slice(2);
const argFile   = args.includes('--file')  ? args[args.indexOf('--file')  + 1] : null;
const argText   = args.includes('--text')  ? args[args.indexOf('--text')  + 1] : null;
const argStrict = args.includes('--strict');     // Fail if no watermark removed
const argDry    = args.includes('--dry-run');    // Don't write output files

// ─── SAMPLES DIRECTORY ────────────────────────────────────────────────────
const SAMPLES_DIR = path.join(__dirname, 'samples');
const OUTPUT_DIR  = path.join(__dirname, 'output');

if (!fs.existsSync(SAMPLES_DIR)) {
  fs.mkdirSync(SAMPLES_DIR, { recursive: true });
  logWarn(`Created samples/ directory. Drop PDF files there and re-run.`);
}
if (!fs.existsSync(OUTPUT_DIR) && !argDry) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

// ─── DISCOVER TEST FILES ──────────────────────────────────────────────────
let testFiles = [];
if (argFile) {
  if (!fs.existsSync(argFile)) {
    logError(`File not found: ${argFile}`);
    process.exit(1);
  }
  testFiles = [argFile];
} else {
  if (!fs.existsSync(SAMPLES_DIR)) {
    logError('No samples/ directory found.');
    process.exit(1);
  }
  testFiles = fs.readdirSync(SAMPLES_DIR)
    .filter(f => f.toLowerCase().endsWith('.pdf'))
    .map(f => path.join(SAMPLES_DIR, f));
}

if (!testFiles.length) {
  logWarn('No PDF files found. Add PDFs to ./samples/ or use --file flag.');
  log(`\nExample usage:`, C.cyan);
  log(`  node test-watermark.js --file ./samples/my.pdf --text "CONFIDENTIAL"`, C.dim);
  process.exit(0);
}

// ─── RESULTS TRACKER ─────────────────────────────────────────────────────
const results = {
  total:   0,
  passed:  0,
  failed:  0,
  skipped: 0,
  details: [],
};

// ═══════════════════════════════════════════════════════════════════════════
// MAIN TEST RUNNER
// ═══════════════════════════════════════════════════════════════════════════
async function runTests() {
  log(`\n${C.bold}╔══════════════════════════════════════════════════════╗${C.reset}`);
  log(`${C.bold}║         DocPurge AI — Watermark Test Suite           ║${C.reset}`);
  log(`${C.bold}╚══════════════════════════════════════════════════════╝${C.reset}\n`);

  log(`${C.cyan}Config:${C.reset}`);
  log(`  Files:      ${testFiles.length} PDF(s)`, C.dim);
  log(`  Text hint:  ${argText || '(auto-detect)'}`, C.dim);
  log(`  Dry run:    ${argDry ? 'YES — no files written' : 'NO'}`, C.dim);
  log(`  Output dir: ${OUTPUT_DIR}\n`, C.dim);

  for (const filePath of testFiles) {
    await testFile(filePath);
  }

  printSummary();
}

// ─── TEST A SINGLE FILE ────────────────────────────────────────────────────
async function testFile(filePath) {
  const baseName = path.basename(filePath);
  results.total++;

  log(`\n${'─'.repeat(60)}`, C.dim);
  log(`${C.bold}Testing: ${baseName}${C.reset}`);

  const detail = {
    file:          baseName,
    status:        'unknown',
    originalSize:  0,
    outputSize:    0,
    detected:      0,
    removed:       0,
    errors:        [],
    timeTaken:     0,
  };

  const t0 = Date.now();

  try {
    // ── Load PDF ──────────────────────────────────────────────────────
    const rawBytes = fs.readFileSync(filePath);
    detail.originalSize = rawBytes.length;
    logInfo(`Loaded: ${formatBytes(rawBytes.length)}`);

    const doc = await PDFDocument.load(rawBytes, {
      ignoreEncryption: true,
      updateMetadata: false,
    });

    const pageCount = doc.getPageCount();
    logInfo(`Pages: ${pageCount}`);

    // ── Phase 1: Auto-detect ──────────────────────────────────────────
    log(`\n  ${C.blue}Phase 1 — Auto-Detection${C.reset}`);
    const candidates = await autoDetect(doc);
    detail.detected = candidates.length;

    if (candidates.length > 0) {
      logSuccess(`Detected ${candidates.length} watermark candidate(s):`);
      candidates.forEach(c => logInfo(`  • ${c.label}`));
    } else {
      logWarn('No watermarks auto-detected.');
    }

    // ── Phase 2: Remove detected ───────────────────────────────────────
    log(`\n  ${C.blue}Phase 2 — Native Removal${C.reset}`);
    let removedCount = 0;

    if (candidates.length > 0) {
      removedCount += await nativeRemove(doc, candidates);
    }

    // ── Phase 3: Text hint search ──────────────────────────────────────
    if (argText) {
      log(`\n  ${C.blue}Phase 3 — Hint Search: "${argText}"${C.reset}`);
      const hintCount = await searchAndRemoveByText(doc, argText);
      removedCount += hintCount;
      if (hintCount > 0) {
        logSuccess(`Removed ${hintCount} instance(s) of "${argText}"`);
      } else {
        logWarn(`"${argText}" not found in content streams.`);
      }
    }

    detail.removed = removedCount;

    // ── Phase 5: Save output ───────────────────────────────────────────
    log(`\n  ${C.blue}Phase 5 — Export${C.reset}`);
    const savedBytes = await doc.save({ addDefaultPage: false });
    detail.outputSize = savedBytes.length;

    const reduction = Math.round((1 - savedBytes.length / rawBytes.length) * 100);
    logInfo(`Original: ${formatBytes(rawBytes.length)} → Output: ${formatBytes(savedBytes.length)} (${reduction > 0 ? '-' + reduction + '%' : 'same'})`);

    if (!argDry) {
      const outName = baseName.replace(/\.pdf$/i, '_PURGED.pdf');
      const outPath = path.join(OUTPUT_DIR, outName);
      fs.writeFileSync(outPath, savedBytes);
      logSuccess(`Saved: ${outPath}`);
    }

    // ── Evaluate pass/fail ─────────────────────────────────────────────
    if (argStrict && removedCount === 0) {
      detail.status = 'failed';
      results.failed++;
      logError(`FAILED (strict mode: no watermarks removed)`);
    } else {
      detail.status = 'passed';
      results.passed++;
      logSuccess(`PASSED — ${removedCount} watermark object(s) removed.`);
    }

  } catch (err) {
    detail.status = 'error';
    detail.errors.push(err.message);
    results.failed++;
    logError(`ERROR: ${err.message}`);
    if (process.env.DEBUG) console.error(err);
  }

  detail.timeTaken = Date.now() - t0;
  logInfo(`Time: ${detail.timeTaken}ms`);
  results.details.push(detail);
}

// ─── AUTO-DETECT LOGIC ────────────────────────────────────────────────────
async function autoDetect(doc) {
  const candidates = [];
  const context = doc.context;

  // Strategy A: Form XObjects
  try {
    context.enumerateIndirectObjects().forEach(([ref, obj]) => {
      try {
        if (obj instanceof PDFDict) {
          const subtype = obj.get(PDFName.of('Subtype'));
          if (subtype && subtype.toString() === '/Form') {
            candidates.push({
              type:  'xobject',
              ref,
              label: `Form XObject @ obj ${ref.objectNumber} ${ref.generationNumber}`,
            });
          }
        }
      } catch (_) {}
    });
  } catch (_) {}

  // Strategy B: Text stamps in content streams
  const pages = doc.getPages();
  for (let pi = 0; pi < pages.length; pi++) {
    const page = pages[pi];
    try {
      const contentRef = page.node.get(PDFName.of('Contents'));
      if (!contentRef) continue;

      const rawStream = getStreamBytes(context, contentRef);
      if (!rawStream) continue;

      const streamText = Buffer.from(rawStream).toString('latin1');

      // Common watermark text patterns
      const PATTERNS = [
        /\(\s*(CONFIDENTIAL|DRAFT|SAMPLE|COPY|VOID|PROPRIETARY|INTERNAL USE ONLY|RESTRICTED|SPECIMEN|DO NOT COPY)\s*\)\s*T[jJ]/i,
        /\/Watermark\b/i,
        /ca\s+0\.(0[0-9]|1\d)\s/,  // Very low opacity (< 20%)
      ];

      for (const pat of PATTERNS) {
        if (pat.test(streamText)) {
          candidates.push({
            type:  'text-stream',
            page:  pi,
            label: `Text stamp on page ${pi + 1}`,
          });
          break;
        }
      }
    } catch (_) {}
  }

  // Strategy C: OCG Layers
  try {
    const catalog = doc.catalog;
    const ocProps = catalog.get(PDFName.of('OCProperties'));
    if (ocProps) {
      const ocgArr = ocProps.get(PDFName.of('OCGs'));
      if (ocgArr instanceof PDFArray) {
        ocgArr.asArray().forEach((ocgRef, i) => {
          try {
            const ocg     = context.lookup(ocgRef, PDFDict);
            const name    = ocg.get(PDFName.of('Name'));
            const nameStr = name ? name.decodeText() : `OCG ${i}`;
            if (/watermark|draft|confidential|stamp/i.test(nameStr)) {
              candidates.push({
                type:  'ocg',
                ref:   ocgRef,
                label: `OCG Layer: "${nameStr}"`,
              });
            }
          } catch (_) {}
        });
      }
    }
  } catch (_) {}

  return candidates;
}

// ─── NATIVE REMOVE ────────────────────────────────────────────────────────
async function nativeRemove(doc, candidates) {
  let count = 0;

  for (const c of candidates) {
    try {
      if (c.type === 'xobject') {
        // Remove from page Resources
        const pages = doc.getPages();
        for (const page of pages) {
          const resources = page.node.get(PDFName.of('Resources'));
          if (!resources) continue;
          const xObjDict = resources.get(PDFName.of('XObject'));
          if (!xObjDict) continue;
          const resolved = doc.context.lookup(xObjDict, PDFDict);
          if (!resolved) continue;
          resolved.keys().forEach(key => {
            try {
              const val = resolved.get(key);
              if (val && val.objectNumber === c.ref.objectNumber) {
                resolved.delete(key);
                logSuccess(`  Removed XObject ref from page Resources`);
              }
            } catch (_) {}
          });
        }
        count++;
      }

      if (c.type === 'text-stream') {
        const page = doc.getPages()[c.page];
        if (!page) continue;

        const contentRef = page.node.get(PDFName.of('Contents'));
        if (!contentRef) continue;

        const stream = doc.context.lookup(contentRef, PDFRawStream);
        if (!stream) continue;

        let text = Buffer.from(stream.contents).toString('latin1');
        const CLEAN_PATTERNS = [
          /q[\s\S]*?ca\s+0\.\d+[\s\S]*?T[jJ][\s\S]*?Q\s*/g,
          /\(\s*(CONFIDENTIAL|DRAFT|SAMPLE|COPY|VOID|PROPRIETARY|INTERNAL|RESTRICTED|SPECIMEN)\s*\)\s*T[jJ]\s*/gi,
          /q\s+[\s\S]{0,50}?ca\s+0\.(0[0-9]|1\d)\s+[\s\S]*?Q\s*/g,
        ];

        let changed = false;
        for (const pat of CLEAN_PATTERNS) {
          const cleaned = text.replace(pat, ' ');
          if (cleaned !== text) { text = cleaned; changed = true; }
        }

        if (changed) {
          stream.contents = Buffer.from(text, 'latin1');
          logSuccess(`  Cleaned text stamp from page ${c.page + 1}`);
          count++;
        }
      }

      if (c.type === 'ocg') {
        // Mark as OFF
        const catalog = doc.catalog;
        const ocProps = catalog.get(PDFName.of('OCProperties'));
        if (ocProps) {
          const d = ocProps.get(PDFName.of('D'));
          if (d) {
            let off = d.get(PDFName.of('OFF'));
            if (!off) { off = doc.context.obj([]); d.set(PDFName.of('OFF'), off); }
            if (off instanceof PDFArray) { off.push(c.ref); }
            logSuccess(`  Disabled OCG layer: ${c.label}`);
            count++;
          }
        }
      }
    } catch (err) {
      logWarn(`  Failed to remove ${c.label}: ${err.message}`);
    }
  }

  return count;
}

// ─── SEARCH & REMOVE BY TEXT ──────────────────────────────────────────────
async function searchAndRemoveByText(doc, targetText) {
  const pages = doc.getPages();
  let count   = 0;
  const escaped = targetText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  for (let pi = 0; pi < pages.length; pi++) {
    const page = pages[pi];
    try {
      const contentRef = page.node.get(PDFName.of('Contents'));
      if (!contentRef) continue;

      const stream = doc.context.lookup(contentRef, PDFRawStream);
      if (!stream) continue;

      let text = Buffer.from(stream.contents).toString('latin1');

      const pats = [
        new RegExp(`\\(${escaped}\\)\\s*T[jJ]`, 'g'),
        new RegExp(`\\(${escaped}\\)\\s*T[jJ]`, 'gi'),
        new RegExp(`q[\\s\\S]{0,300}?\\(${escaped}\\)[\\s\\S]{0,300}?T[jJ][\\s\\S]{0,300}?Q`, 'g'),
      ];

      let changed = false;
      for (const pat of pats) {
        const cleaned = text.replace(pat, ' ');
        if (cleaned !== text) { text = cleaned; changed = true; }
      }

      if (changed) {
        stream.contents = Buffer.from(text, 'latin1');
        logSuccess(`  Removed "${targetText}" from page ${pi + 1}`);
        count++;
      }
    } catch (_) {}
  }

  return count;
}

// ─── UTILITIES ────────────────────────────────────────────────────────────
function getStreamBytes(context, ref) {
  try {
    if (ref instanceof PDFArray) {
      const parts = [];
      ref.asArray().forEach(r => {
        try {
          const s = context.lookup(r, PDFRawStream);
          if (s) parts.push(...s.contents);
        } catch (_) {}
      });
      return Buffer.from(parts);
    }
    const stream = context.lookup(ref, PDFRawStream);
    return stream ? Buffer.from(stream.contents) : null;
  } catch (_) {
    return null;
  }
}

function formatBytes(bytes) {
  if (!bytes) return '0 B';
  const k = 1024, s = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + s[i];
}

// ─── SUMMARY ──────────────────────────────────────────────────────────────
function printSummary() {
  log(`\n${'═'.repeat(60)}`, C.dim);
  log(`${C.bold}TEST SUMMARY${C.reset}`);
  log(`${'═'.repeat(60)}`, C.dim);

  const pad = (s, n) => String(s).padEnd(n);

  // Table header
  log(`\n${pad('File', 32)} ${pad('Status', 10)} ${pad('Detected', 10)} ${pad('Removed', 10)} ${pad('Time', 8)}`, C.dim);
  log(`${'-'.repeat(72)}`, C.dim);

  results.details.forEach(d => {
    const statusColor = d.status === 'passed' ? C.green : d.status === 'skipped' ? C.yellow : C.red;
    const fname = d.file.length > 30 ? d.file.slice(0, 27) + '…' : d.file;
    log(
      `${pad(fname, 32)} ${statusColor}${pad(d.status.toUpperCase(), 10)}${C.reset} ` +
      `${pad(d.detected, 10)} ${pad(d.removed, 10)} ${d.timeTaken}ms`
    );
    if (d.errors.length > 0) {
      d.errors.forEach(e => log(`  ↳ ${e}`, C.red));
    }
  });

  log(`${'-'.repeat(72)}`, C.dim);
  log(`\nTotal: ${results.total}  ` +
    `${C.green}Passed: ${results.passed}${C.reset}  ` +
    `${C.red}Failed: ${results.failed}${C.reset}  ` +
    `${C.yellow}Skipped: ${results.skipped}${C.reset}`
  );

  if (!argDry && results.passed > 0) {
    log(`\nOutput files written to: ${OUTPUT_DIR}`, C.cyan);
  }

  log('\n');

  // Exit code
  process.exit(results.failed > 0 ? 1 : 0);
}

// ─── ENTRYPOINT ───────────────────────────────────────────────────────────
runTests().catch(err => {
  logError('Unhandled error: ' + err.message);
  console.error(err);
  process.exit(1);
});
