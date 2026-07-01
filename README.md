<div align="center">

<a href="https://github.com/official-Arvind/docpurge-ai">
  <img src="https://capsule-render.vercel.app/api?type=waving&color=0:080b14,50:003322,100:001a2e&height=220&section=header&text=DocPurge%20AI&fontSize=72&fontColor=00ff88&fontAlignY=38&desc=Surgical%20Watermark%20Removal%20%E2%80%94%20Zero%20Rasterization&descAlignY=58&descSize=20&animation=fadeIn" width="100%"/>
</a>

<br/>

[![Typing SVG](https://readme-typing-svg.herokuapp.com?font=JetBrains+Mono&weight=700&size=20&duration=3000&pause=800&color=00FF88&center=true&vCenter=true&multiline=false&width=750&lines=Erase+Watermarks.+Leave+No+Trace.+%E2%9A%A1;5-Phase+Purge+Engine+%E2%80%94+Zero+Rasterization+%F0%9F%94%A5;Gemini+3.5+Flash+%2B+3.1+Pro+AI+Assist+%F0%9F%A4%96;200MB%2B+PDFs+%E2%80%94+No+Size+Limit+%F0%9F%90%98;100%25+Local+%E2%80%94+Zero+Uploads+%E2%80%94+Zero+Backend+%F0%9F%94%92)](https://github.com/official-Arvind/docpurge-ai)

<br/>

<a href="https://official-arvind.github.io/docpurge-ai/">
  <img src="https://img.shields.io/badge/Live%20Demo-GitHub%20Pages-00ff88?style=for-the-badge&logo=github&logoColor=white" alt="Live Demo"/>
</a>
&nbsp;
<a href="https://github.com/official-Arvind/docpurge-ai/stargazers">
  <img src="https://img.shields.io/github/stars/official-Arvind/docpurge-ai?style=for-the-badge&logo=starship&logoColor=white&color=f7c948" alt="Stars"/>
</a>
&nbsp;
<a href="https://github.com/official-Arvind/docpurge-ai/graphs/contributors">
  <img src="https://img.shields.io/github/contributors/official-Arvind/docpurge-ai?style=for-the-badge&logo=handshake&logoColor=white&color=22c55e" alt="Contributors"/>
</a>
&nbsp;
<a href="LICENSE">
  <img src="https://img.shields.io/badge/License-MIT-00c3ff?style=for-the-badge&logo=opensourceinitiative&logoColor=white" alt="License"/>
</a>
&nbsp;
<a href="https://github.com/official-Arvind/docpurge-ai/releases">
  <img src="https://img.shields.io/badge/Version-1.0-a855f7?style=for-the-badge&logo=rocket&logoColor=white" alt="Version"/>
</a>

<br/><br/>

> **The world's most aggressive browser-native PDF watermark removal engine.**  
> No server. No rasterization. No compromises. 100% free, forever.

<br/>

<a href="https://official-arvind.github.io/docpurge-ai/">
  <img src="https://img.shields.io/badge/Launch_DocPurge_AI-%E2%9A%A1_Purge_Now-00ff88?style=for-the-badge&logo=googlechrome&logoColor=black" alt="Launch App"/>
</a>

</div>

---

<div align="center">
  <img src="https://capsule-render.vercel.app/api?type=rect&color=gradient&customColorList=12,20,28&height=4&section=header" width="100%"/>
</div>

## 🛡️ Privacy & Stability Policy

> [!IMPORTANT]
> **DocPurge AI processes your PDFs entirely inside your browser.**  
> Your files are **never uploaded** to any server — not even ours (we don't have one).  
> The Gemini API key you enter is stored as a plain JavaScript variable in the current tab session only.  
> It is **never** written to `localStorage`, cookies, IndexedDB, or any remote endpoint.  
> Closing or refreshing the tab permanently clears it.

*This is not a marketing claim. This is the architecture.*

---

<div align="center">
  <img src="https://capsule-render.vercel.app/api?type=rect&color=gradient&customColorList=12,20,28&height=3&section=header" width="100%"/>
</div>

## ⚡ What Is This?

DocPurge AI is a **zero-backend PDF utility suite** that runs entirely in your browser using [`pdf-lib`](https://pdf-lib.js.org/) and [`pdf.js`](https://mozilla.github.io/pdf.js/). It surgically removes watermarks at the **byte level** — no page-to-image conversion, no quality loss, no rasterization. Your vectors stay crisp. Your fonts stay embedded. Your DPI stays untouched.

<div align="center">

```text
Phase 1 — Auto-Detect    →  Scan all content streams, XObjects & OCG layers
Phase 2 — Native Remove  →  Delete watermark objects at raw PDF byte level
Phase 3 — Hint Mode      →  User provides text hint → targeted stream search
Phase 4 — Gemini AI      →  AI identifies exact watermark string from page text
Phase 5 — Export         →  Clean PDF assembled & downloaded — never stored
```

</div>

---

## 🗂️ The Arsenal

<table>
<tr>
<td width="50%" valign="top">

### 🔥 `Watermark Purge`
**Flagship Tool — LIVE**

- ⚡ **Zero Rasterization** — Operates on raw PDF stream operators (`Tj`, `TJ`, `Do`, XObjects). Vectors, fonts, and DPI 100% preserved.
- 🔍 **5-Phase Engine** — Auto-detect → Native remove → Hint mode → Gemini AI → Clean export. Every scenario covered.
- 🧠 **Gemini AI Assist** — Sends only extracted page text (not your PDF) to Gemini 3.5 Flash / 3.1 Pro via your own API key.
- 🐘 **No Size Limit** — Handles 200 MB+ PDFs via direct `ArrayBuffer` reads. Web Workers keep the UI alive.
- 🔒 **Session-Only Key** — Your Gemini API key lives only in a JS variable. Gone on tab close.
- 📥 **Instant Download** — Output assembled in-memory and downloaded directly. Never stored.

</td>
<td width="50%" valign="top">

### 📦 `PDF Compressor`
**Coming Soon**

- 🗜️ **Lossless + Lossy** — Dual compression modes with configurable quality targets.
- 🖼️ **Smart Image Downsampling** — JPEG re-encoding with DPI-aware quality settings.
- 📉 **Up to 80% Reduction** — Proven on real-world document types.
- ⚡ **Text Layers Untouched** — Only image streams are compressed.

---

### 🔗 `PDF Merger & Splitter`
**Coming Soon**

- 🔗 **Merge N PDFs** — Drag to reorder before merging.
- ✂️ **Split to Pages** — Custom page range extraction.
- 🖱️ **Visual Page Organiser** — Drag-and-drop page thumbnails.

</td>
</tr>
<tr>
<td width="50%" valign="top">

### 🕵️ `Metadata Scrubber`
**Coming Soon**

- 🧹 **XMP Metadata Wipe** — Author, creation date, GPS, software fingerprints — gone.
- 🔍 **Forensic-Grade** — Removes fields most tools miss (custom schema namespaces).
- 🔒 **Zero Fingerprints** — Leave no trace of origin software or author.

</td>
<td width="50%" valign="top">

### 🤖 `Gemini AI Model Lineup`
**2026 Production Stack**

| Model | Best For | Speed |
|-------|----------|-------|
| `gemini-3.5-flash` | Most watermarks · Default | ⚡ Fastest |
| `gemini-3.1-pro` | Complex marks · 2M context | 🎯 Highest accuracy |
| `gemini-3.1-flash-lite` | Simple hints · Budget | 💰 Cheapest |

</td>
</tr>
</table>

---

## 🚀 Getting Started

### Step 1 — Open the App

```
https://official-arvind.github.io/docpurge-ai/
```

No installation. No download. Works in Chrome, Edge, and Firefox on HTTPS.

### Step 2 — Drop Your PDF

Drag and drop any PDF into the upload zone — or click to browse.  
**No size limit enforced.** 200 MB, 500 MB — the engine handles it with Web Workers.

### Step 3 — Watch the 5-Phase Engine Run

Auto-detection kicks in immediately. If a watermark is found, it's natively removed and your clean PDF is ready for download.

### Step 4 — Stuck? Use Gemini AI Assist

```
1. Type a hint →  CONFIDENTIAL  or  DRAFT  in the Hint field
2. Enter your Gemini API key (free at aistudio.google.com)
3. Select model → gemini-3.5-flash (recommended)
4. Hit "Identify with Gemini" → AI returns the exact watermark string
5. Hit "Purge" → download your clean file
```

---

## 🗂️ Project Structure

```
/
├── index.html                     ← Branded splash + redirect
├── 404.html                       ← Custom GitHub Pages 404
├── .nojekyll                      ← Skip Jekyll — serve raw HTML
│
├── /home/
│   └── home.html                  ← Dashboard — hero terminal, tools, FAQ
│
├── /watermark-purge/
│   ├── watermark.html             ← Full tool interface
│   └── watermark-logic.js        ← 5-phase purge engine (ES Module, 41 KB)
│
├── /assets/
│   ├── /css/tailwind-output.css   ← Full custom design system (23 KB)
│   ├── /js/core-ui.js             ← Shared UI — nav, FAQ accordion, terminal sim
│   └── /img/                      ← AI-generated brand assets
│
└── /test/
    ├── test-watermark.js          ← Node.js test suite (no browser needed)
    └── package.json               ← pdf-lib dependency
```

---

## 🧪 Node.js Test Suite

Test watermark removal logic against real PDFs — no browser required:

```bash
cd test
npm install

# Auto-detect and remove from all PDFs in ./samples/
node test-watermark.js

# Target a specific watermark text
node test-watermark.js --text "CONFIDENTIAL"

# Single file
node test-watermark.js --file ./samples/my-doc.pdf --text "DRAFT"

# Dry run — no output files written
node test-watermark.js --dry-run

# Strict mode — exits non-zero if nothing removed (CI-friendly)
node test-watermark.js --strict
```

Output files written to `test/output/` with `_PURGED` suffix. Styled table printed to console with per-file status, detection count, removal count, and timing.

---

## 🛠 Tech Stack

| Layer | Technology | Notes |
|-------|-----------|-------|
| PDF Manipulation | `pdf-lib` v1.17.1 | Native object-level surgery — no rasterization |
| Text Extraction | `pdf.js` v4.3 | ES Module import via cdnjs |
| AI Engine | Gemini API (REST) | 3.5 Flash · 3.1 Pro · 3.1 Flash-Lite |
| Hosting | GitHub Pages | Static, no server, HTTPS — ES modules work perfectly |
| Backend | **None** | 🚫 |
| File Uploads | **None** | 🚫 |
| Analytics / Tracking | **None** | 🚫 |

---

## 👤 Credits

Built by **Arvind** · [Jigar Corp](https://official-arvind.github.io/jigar-tools/)  
AI brand assets generated with Google Gemini  
MIT License — Free forever.

---

<div align="center">
  <img src="https://capsule-render.vercel.app/api?type=waving&color=0:001a2e,50:003322,100:080b14&height=120&section=footer&animation=fadeIn" width="100%"/>
</div>
