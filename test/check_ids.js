const fs = require('fs');
const html = fs.readFileSync('watermark-purge/watermark.html', 'utf8');
const js   = fs.readFileSync('watermark-purge/watermark-logic.js', 'utf8');

// Extract all id="..." from HTML
const htmlIds = new Set();
const htmlMatches = html.matchAll(/id="([^"]+)"/g);
for (const m of htmlMatches) htmlIds.add(m[1]);

// Extract all $('...') calls from JS
const jsRefs = [];
const jsMatches = js.matchAll(/\$\(['"]([^'"]+)['"]\)/g);
for (const m of jsMatches) jsRefs.push(m[1]);

let ok = true;
for (const id of jsRefs) {
  if (!htmlIds.has(id)) {
    console.error('MISSING in HTML: #' + id);
    ok = false;
  }
}
if (ok) {
  console.log('All ' + jsRefs.length + ' element IDs verified - HTML and JS are in sync!');
} else {
  process.exit(1);
}
