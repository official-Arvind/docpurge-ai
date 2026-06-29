"""
DocPurge AI - Precise visual template-matching watermark remover.
Uses CV template-mask matching to target ONLY the specific shapes of
the watermarks and blue banners, leaving student annotations and
blue formula boxes untouched.
"""
import fitz
import cv2
import numpy as np
import time
import sys
import os

PDF_IN  = r"D:\Desktop\DOC-20260627-WA0012..pdf"
PDF_OUT = r"D:\Desktop\DOC-20260627-WA0012_PURGED.pdf"

# Load Master templates (extracted from page 5 and page 94)
T_WC_PATH = r"template_wc.png"
T_JC_PATH = r"template_jc.png"
T_BB_PATH = r"template_bb.png"

for path in [T_WC_PATH, T_JC_PATH, T_BB_PATH]:
    if not os.path.exists(path):
        print(f"[FATAL] Template file not found: {path}")
        sys.exit(1)

t_wc = cv2.imread(T_WC_PATH)
t_jc = cv2.imread(T_JC_PATH)
t_bb = cv2.imread(T_BB_PATH)

def get_red_mask(img_bgr):
    hsv = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2HSV)
    mask1 = cv2.inRange(hsv, np.array([0,  40, 40]), np.array([10, 255, 255]))
    mask2 = cv2.inRange(hsv, np.array([168, 40, 40]), np.array([180, 255, 255]))
    return cv2.bitwise_or(mask1, mask2)

def get_blue_mask(img_bgr):
    hsv = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2HSV)
    return cv2.inRange(hsv, np.array([95, 50, 80]), np.array([135, 255, 255]))

mask_t_wc = get_red_mask(t_wc)
mask_t_jc = get_red_mask(t_jc)
mask_t_bb = get_blue_mask(t_bb)

def sample_bg_color(img_bgr, mask):
    """Sample average background color from non-masked pixels inside the target region."""
    ys, xs = np.where(mask == 0)
    if len(ys) > 0:
        samples = img_bgr[ys, xs]
        return np.mean(samples, axis=0).astype(np.uint8)
    return np.array([255, 255, 255], dtype=np.uint8)

def remove_watermarks_precision(img_bgr):
    h, w = img_bgr.shape[:2]
    
    # Generate BGR-independent red mask
    target_red = get_red_mask(img_bgr)
    
    # Determine scale factor relative to template source width (1462)
    scale = w / 1462.0
    
    # Resize template shapes using nearest-neighbor to keep masks sharp
    resized_wc = cv2.resize(mask_t_wc, (0,0), fx=scale, fy=scale, interpolation=cv2.INTER_NEAREST)
    resized_jc = cv2.resize(mask_t_jc, (0,0), fx=scale, fy=scale, interpolation=cv2.INTER_NEAREST)
    
    output = img_bgr.copy()
    wiped_wm = False
    
    # ----------------------------------------------------
    # 1. Match Main Watermark (WC) - top 35%, right 45%
    # ----------------------------------------------------
    search_h_wc = min(h, max(int(h * 0.35), resized_wc.shape[0]))
    search_w_wc = min(w, max(int(w * 0.45), resized_wc.shape[1]))
    
    # ROI region to search
    roi_wc = target_red[0:search_h_wc, w - search_w_wc:w]
    
    if roi_wc.shape[0] >= resized_wc.shape[0] and roi_wc.shape[1] >= resized_wc.shape[1]:
        res_wc = cv2.matchTemplate(roi_wc, resized_wc, cv2.TM_CCOEFF_NORMED)
        _, max_val, _, max_loc = cv2.minMaxLoc(res_wc)
        
        if max_val >= 0.45:
            bx = max_loc[0] + (w - search_w_wc)
            by = max_loc[1]
            bw, bh = resized_wc.shape[1], resized_wc.shape[0]
            
            # Project shape mask onto image coordinates
            proj_mask = np.zeros((h, w), dtype=np.uint8)
            proj_mask[by:by+bh, bx:bx+bw] = resized_wc
            
            # Dilate shape slightly to cover anti-aliased edges/compression halos
            proj_mask = cv2.dilate(proj_mask, np.ones((5,5), np.uint8), iterations=1)
            
            # Sample background and fill
            bg = sample_bg_color(img_bgr[by:by+bh, bx:bx+bw], proj_mask[by:by+bh, bx:bx+bw])
            output[proj_mask > 0] = bg
            wiped_wm = True
            
    # ----------------------------------------------------
    # 2. Match J* Stamp (JC) - top 55%, right 45%
    # ----------------------------------------------------
    search_h_jc = min(h, max(int(h * 0.55), resized_jc.shape[0]))
    search_w_jc = min(w, max(int(w * 0.45), resized_jc.shape[1]))
    
    roi_jc = target_red[0:search_h_jc, w - search_w_jc:w]
    
    if roi_jc.shape[0] >= resized_jc.shape[0] and roi_jc.shape[1] >= resized_jc.shape[1]:
        res_jc = cv2.matchTemplate(roi_jc, resized_jc, cv2.TM_CCOEFF_NORMED)
        _, max_val2, _, max_loc2 = cv2.minMaxLoc(res_jc)
        
        if max_val2 >= 0.45:
            bx = max_loc2[0] + (w - search_w_jc)
            by = max_loc2[1]
            bw, bh = resized_jc.shape[1], resized_jc.shape[0]
            
            proj_mask = np.zeros((h, w), dtype=np.uint8)
            proj_mask[by:by+bh, bx:bx+bw] = resized_jc
            proj_mask = cv2.dilate(proj_mask, np.ones((5,5), np.uint8), iterations=1)
            
            bg = sample_bg_color(img_bgr[by:by+bh, bx:bx+bw], proj_mask[by:by+bh, bx:bx+bw])
            output[proj_mask > 0] = bg
            wiped_wm = True
            
    return output, 1 if wiped_wm else 0

def remove_blue_banner_precision(img_bgr):
    h, w = img_bgr.shape[:2]
    
    target_blue = get_blue_mask(img_bgr)
    scale = w / 1462.0
    
    resized_bb = cv2.resize(mask_t_bb, (0,0), fx=scale, fy=scale, interpolation=cv2.INTER_NEAREST)
    
    # Match in bottom 15% of the image
    search_h = min(h, max(int(h * 0.15), resized_bb.shape[0]))
    roi = target_blue[h - search_h:h, :]
    
    output = img_bgr.copy()
    wiped_bb = False
    
    if roi.shape[0] >= resized_bb.shape[0] and roi.shape[1] >= resized_bb.shape[1]:
        res = cv2.matchTemplate(roi, resized_bb, cv2.TM_CCOEFF_NORMED)
        _, max_val, _, max_loc = cv2.minMaxLoc(res)
        
        if max_val >= 0.45:
            by = max_loc[1] + (h - search_h)
            
            # Wiping:
            # Main banner: from by - 3 to bottom
            output[by - 3:h, :] = [255, 255, 255]
            # Left banner curve: from by - 45 to bottom for the leftmost 120 (scaled) pixels
            curve_width = int(120 * scale)
            output[max(0, by - 45):h, 0:curve_width] = [255, 255, 255]
            wiped_bb = True
            
    return output, 1 if wiped_bb else 0

def get_image_filter(doc, xref):
    obj_str = doc.xref_object(xref)
    if "DCTDecode" in obj_str:
        return "DCTDecode"
    if "FlateDecode" in obj_str:
        return "FlateDecode"
    if "JPXDecode" in obj_str:
        return "JPXDecode"
    return "FlateDecode"

def update_image_stream(doc, xref, cleaned_bgr, original_ext):
    try:
        orig_filter = get_image_filter(doc, xref)

        if orig_filter == "FlateDecode":
            rgb = cv2.cvtColor(cleaned_bgr, cv2.COLOR_BGR2RGB)
            raw_pixels = rgb.tobytes()
            doc.update_stream(xref, raw_pixels, compress=True)
            doc.xref_set_key(xref, "Filter", "/FlateDecode")
        else:
            ok, buf = cv2.imencode(".jpg", cleaned_bgr, [cv2.IMWRITE_JPEG_QUALITY, 95])
            if not ok:
                return False
            doc.update_stream(xref, buf.tobytes(), compress=False)
            doc.xref_set_key(xref, "Filter", "/DCTDecode")
        return True
    except Exception as e:
        print(f"    stream-update error for xref {xref}: {e}")
        return False

def main():
    print(f"[INIT] Loading: {PDF_IN}")
    sys.stdout.flush()
    doc = fitz.open(PDF_IN)
    total_pages = len(doc)
    print(f"[INIT] Pages: {total_pages}")
    sys.stdout.flush()

    total_wm = 0
    total_bb = 0
    total_errors = 0
    seen = set()

    t0 = time.time()

    for pg in range(total_pages):
        page = doc[pg]
        imgs = page.get_images(full=True)

        for info in imgs:
            xref = info[0]
            if xref in seen:
                continue
            seen.add(xref)

            try:
                bi = doc.extract_image(xref)
                raw = bi["image"]
                ext = bi.get("ext", "jpeg")

                nparr = np.frombuffer(raw, np.uint8)
                img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
                if img is None:
                    continue

                h, w = img.shape[:2]
                if w < 200 or h < 50:
                    continue

                modified = img.copy()
                changed  = False

                # --- Watermark removal ---
                cleaned_wm, wm_found = remove_watermarks_precision(modified)
                if wm_found > 0:
                    modified = cleaned_wm
                    changed  = True
                    total_wm += 1
                    print(f"  [WM]   Page {pg+1} xref {xref}: Wiped watermark shape")
                    sys.stdout.flush()

                # --- Blue banner removal ---
                cleaned_bb, bb_found = remove_blue_banner_precision(modified)
                if bb_found > 0:
                    modified = cleaned_bb
                    changed  = True
                    total_bb += 1
                    print(f"  [BB]   Page {pg+1} xref {xref}: Wiped bottom blue banner")
                    sys.stdout.flush()

                if changed:
                    ok = update_image_stream(doc, xref, modified, ext)
                    if not ok:
                        total_errors += 1

            except Exception as e:
                total_errors += 1
                print(f"  [ERR]  Page {pg+1} xref {xref}: {e}")
                sys.stdout.flush()

        if (pg + 1) % 10 == 0:
            elapsed = time.time() - t0
            print(f"  [PROG] {pg+1}/{total_pages} pages | {elapsed:.0f}s | "
                  f"WM={total_wm} BB={total_bb} ERR={total_errors}")
            sys.stdout.flush()

    elapsed = time.time() - t0
    print(f"\n[DONE] {elapsed:.1f}s | WM={total_wm} | BB={total_bb} | ERR={total_errors}")
    print(f"[SAVE] Saving to {PDF_OUT} ...")
    sys.stdout.flush()

    doc.save(PDF_OUT, deflate=True, garbage=4)
    print("[DONE] Saved!")

if __name__ == "__main__":
    main()
