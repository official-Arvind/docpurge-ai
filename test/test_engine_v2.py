"""
Quick test: verify pdfjs-equivalent Python text extraction correctly detects
watermark keywords in the 3 test PDFs — simulating what the new browser
engine's detectWatermarkKeywords() will do via getTextContent().
"""
import fitz
import sys
import os

WATERMARK_KEYWORDS = [
    'CONFIDENTIAL', 'DRAFT', 'SAMPLE', 'COPY', 'VOID', 'INTERNAL',
    'WATERMARK', 'DO NOT COPY', 'PROPRIETARY', 'RESTRICTED',
    'INTERNAL USE ONLY', 'SPECIMEN', 'PREVIEW', 'NOT FOR DISTRIBUTION',
    'PROOF', 'PRIVATE', 'PERSONAL', 'TOP SECRET', 'CLASSIFIED',
    'FOR REVIEW ONLY', 'EVALUATION COPY', 'DEMO', 'EXAMPLE',
    'NOT FOR SALE', 'COMPLIMENTARY', 'PRELIMINARY', 'SENSITIVE',
    'UNCLASSIFIED', 'OFFICIAL USE ONLY', 'CONTROLLED', 'DRAFT COPY',
    'SAMPLE WATERMARK',
]

def test_pdf(path, label):
    print(f"\n{'='*60}")
    print(f"Testing: {label}")
    print(f"File:    {path}")
    print('='*60)

    if not os.path.exists(path):
        print(f"  ❌  File not found: {path}")
        return False

    doc = fitz.open(path)
    num_pages = doc.page_count
    total_text_items = 0
    all_text = []

    for i in range(num_pages):
        page = doc[i]
        blocks = page.get_text("words")  # closest to pdfjs getTextContent items
        words = [b[4] for b in blocks]   # b[4] is the word string
        total_text_items += len(words)
        page_text = ' '.join(words).upper()
        all_text.append(page_text)

    doc.close()

    # Simulate detectPDFType()
    pages_checked = min(num_pages, 5)
    items_first_5 = sum(
        len([b[4] for b in fitz.open(path)[i].get_text("words")])
        for i in range(pages_checked)
    )
    pdf_type = 'scanned' if items_first_5 < 10 else 'vector'
    print(f"  PDF type:       {pdf_type} ({items_first_5} text items across first {pages_checked} pages)")

    # Simulate detectWatermarkKeywords()
    found = {}
    for page_text in all_text:
        for kw in WATERMARK_KEYWORDS:
            if kw in page_text:
                found[kw] = found.get(kw, 0) + 1

    if found:
        print(f"  [PASS] Watermarks detected by keyword scan:")
        for kw, count in found.items():
            print(f"       * \"{kw}\" -- found on {count} page(s)")
        return True
    else:
        print(f"  [WARN] No watermark keywords found in text layer.")
        if pdf_type == 'scanned':
            print(f"       -> Correct: scanned PDF will use CV Image Engine automatically.")
            return True
        else:
            print(f"       -> PROBLEM: vector PDF but no keywords found!")
            print(f"  All text extracted:")
            for i, t in enumerate(all_text):
                print(f"    Page {i+1}: {t[:200]!r}")
            return False

if __name__ == "__main__":
    base = r"d:\Desktop\DocPurge AI"

    results = [
        test_pdf(os.path.join(base, "watermark_test_vector.pdf"),   "Vector PDF — CONFIDENTIAL + DRAFT COPY"),
        test_pdf(os.path.join(base, "watermark_test_scanned_image.pdf"), "Scanned Image PDF — CV Engine auto-trigger"),
        test_pdf(os.path.join(base, "watermark_test_overlay.pdf"),  "Overlay PDF — SAMPLE WATERMARK"),
    ]

    print(f"\n{'='*60}")
    passed = sum(1 for r in results if r)
    print(f"RESULT: {passed}/{len(results)} tests passed")
    if passed == len(results):
        print("✅  All tests PASSED — engine will detect correctly in browser!")
    else:
        print("❌  Some tests FAILED — detection issues found.")
    sys.exit(0 if passed == len(results) else 1)
