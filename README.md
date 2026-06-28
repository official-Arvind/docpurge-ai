# DocPurge AI 🔥

> **Erase watermarks. Leave no trace. 100% Local.**  
> A PDF utility suite by **Jigar Corp** — built entirely in the browser.

[![Live Demo](https://img.shields.io/badge/Live%20Demo-GitHub%20Pages-00ff88?style=for-the-badge&logo=github)](https://official-arvind.github.io/docpurge-ai/)
[![No Backend](https://img.shields.io/badge/Backend-NONE-ff4444?style=for-the-badge)](.)
[![License](https://img.shields.io/badge/License-MIT-00c3ff?style=for-the-badge)](./LICENSE)

---

## ⚡ What Is This?

DocPurge AI is a **zero-server PDF utility suite** that runs entirely in your browser.  
No uploads. No cloud. No Python. No Node.js backend. Just raw browser-side PDF surgery.

### Flagship Tool: Watermark Purge

Surgically remove watermarks from any PDF using a **5-phase engine**:

| Phase | What Happens |
|-------|-------------|
| **1 — Auto-Detection** | Scans all PDF content streams for Form XObjects, text stamps (opacity heuristics), OCG layers |
| **2 — Native Removal** | Deletes watermark objects at the byte level — no rasterization, vectors stay crisp |
| **3 — Hint Mode** | If auto-detect fails, user types a text hint (e.g. `DRAFT`) and we search all streams |
| **4 — Gemini AI Assist** | Sends extracted page text to Gemini 3.5 Flash / 3.1 Pro via user's own API key |
| **5 — Export** | Assembles the clean PDF and downloads it — file never leaves the browser |

---

## 🛠 Tech Stack

| Layer | Technology |
|-------|-----------|
| PDF Manipulation | [`pdf-lib`](https://pdf-lib.js.org/) v1.17.1 |
| Text Extraction | [`pdf.js`](https://mozilla.github.io/pdf.js/) v4.3 |
| AI Engine | [Gemini API](https://aistudio.google.com/) — 3.5 Flash, 3.1 Pro, 3.1 Flash-Lite |
| Hosting | GitHub Pages (static, no server) |
| Backend | **None** |
| Data Uploads | **None** |

---

## 🔒 Privacy Guarantee

- Your PDF **never leaves your device**
- Gemini API key stored as a **session-only JS variable** — cleared on tab close
- Gemini call sends only **extracted text** (not your raw PDF) directly to Google's servers
- DocPurge AI has **zero infrastructure** — there is no server to leak to

---

## 🗂 Project Structure

```
/
├── index.html                     ← Splash redirect
├── 404.html                       ← Custom GitHub Pages 404
├── .nojekyll                      ← Skip Jekyll processing
│
├── /home/
│   └── home.html                  ← Dashboard + hero terminal
│
├── /watermark-purge/
│   ├── watermark.html             ← Tool UI
│   └── watermark-logic.js        ← 5-phase purge engine (ES Module)
│
├── /assets/
│   ├── /css/tailwind-output.css   ← Full design system
│   ├── /js/core-ui.js             ← Shared UI (nav, FAQ, terminal sim)
│   └── /img/                      ← Brand assets
│
└── /test/
    ├── test-watermark.js          ← Node.js test suite (no browser needed)
    └── package.json
```

---

## 🧪 Node.js Test Suite

Test watermark removal logic against real PDFs without opening a browser:

```bash
cd test
npm install

# Auto-detect + remove from all PDFs in ./samples/
node test-watermark.js

# Target a specific watermark text
node test-watermark.js --text "CONFIDENTIAL"

# Single file test
node test-watermark.js --file ./samples/my-doc.pdf --text "DRAFT"

# Dry run (no output files)
node test-watermark.js --dry-run
```

---

## 🚀 Deploy Your Own

```bash
# 1. Fork this repo on GitHub
# 2. Go to repo Settings → Pages → Source: main branch / (root)
# 3. Your live URL: https://<your-username>.github.io/<repo-name>/
```

---

## 📋 Coming Soon

- [ ] PDF Compressor (lossless + lossy)
- [ ] PDF Merger & Splitter  
- [ ] Metadata Scrubber (forensic-grade privacy)
- [ ] PDF to Image (high-DPI, no server)

---

## 👤 Credits

Built by **Arvind** · [Jigar Corp](https://official-arvind.github.io/jigar-tools/)  
AI assets generated with Google Gemini  
MIT License

---

> *"Zero rasterization. Zero cloud. Zero compromise."*
