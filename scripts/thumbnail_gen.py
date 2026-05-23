"""
thumbnail_gen.py — Clickbait YouTube Thumbnail Generator for ViralClip AI
Extracts best frame from video, adds dramatic viral text overlay with Pillow.

Usage:
  python thumbnail_gen.py <input_video> <output_jpg> <title_text> [hook_text]
Output:
  {"status": "ok", "output": "<output_jpg>"}
"""

import sys
import json
import cv2
import numpy as np
from pathlib import Path

try:
    from PIL import Image, ImageDraw, ImageFont, ImageFilter
    PIL_AVAILABLE = True
except ImportError:
    PIL_AVAILABLE = False


def get_best_frame(cap, total_frames):
    """Pick the most visually rich frame (prefer ones with faces, bright frames)."""
    # Check a few candidate frames
    candidates = [
        int(total_frames * 0.25),
        int(total_frames * 0.40),
        int(total_frames * 0.55),
    ]
    best_frame = None
    best_score = -1

    for fi in candidates:
        cap.set(cv2.CAP_PROP_POS_FRAMES, fi)
        ret, frame = cap.read()
        if not ret:
            continue
        # Score: brightness + edge density (more interesting frames = more edges)
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        brightness = gray.mean()
        edges = cv2.Laplacian(gray, cv2.CV_64F).var()
        score = brightness * 0.3 + edges * 0.7
        if score > best_score:
            best_score = score
            best_frame = frame

    return best_frame


def wrap_text(text, max_chars=18):
    """Break text into lines with max chars each."""
    words = text.split()
    lines = []
    current = []
    for word in words:
        test = ' '.join(current + [word])
        if len(test) <= max_chars:
            current.append(word)
        else:
            if current:
                lines.append(' '.join(current))
            current = [word]
    if current:
        lines.append(' '.join(current))
    return lines


def generate_thumbnail(input_video: str, output_jpg: str, title: str, hook: str = ''):
    cap = cv2.VideoCapture(input_video)
    if not cap.isOpened():
        print(json.dumps({"status": "error", "message": "Cannot open video"}))
        return

    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    frame = get_best_frame(cap, total)
    cap.release()

    if frame is None:
        print(json.dumps({"status": "error", "message": "Could not extract frame"}))
        return

    # Target thumbnail size: 1280x720 (YouTube standard)
    h, w = frame.shape[:2]
    # Crop to 16:9
    target_w, target_h = 1280, 720
    ratio = target_w / target_h

    if w / h > ratio:
        new_w = int(h * ratio)
        offset_x = (w - new_w) // 2
        frame = frame[:, offset_x:offset_x + new_w]
    else:
        new_h = int(w / ratio)
        offset_y = (h - new_h) // 2
        frame = frame[offset_y:offset_y + new_h, :]

    frame_resized = cv2.resize(frame, (target_w, target_h))

    if PIL_AVAILABLE:
        # Convert to PIL
        img = Image.fromarray(cv2.cvtColor(frame_resized, cv2.COLOR_BGR2RGB))
        draw = ImageDraw.Draw(img)

        # Dark gradient overlay at bottom (for text readability)
        overlay = Image.new('RGBA', (target_w, target_h), (0, 0, 0, 0))
        grad_draw = ImageDraw.Draw(overlay)
        for i in range(300):
            alpha = int(210 * (i / 300))
            grad_draw.line([(0, target_h - 300 + i), (target_w, target_h - 300 + i)],
                           fill=(0, 0, 0, alpha))
        img = Image.alpha_composite(img.convert('RGBA'), overlay).convert('RGB')
        draw = ImageDraw.Draw(img)

        # Try to load a font, fall back to default
        try:
            # Try common fonts on Windows
            for font_path in [
                'C:/Windows/Fonts/impact.ttf',
                'C:/Windows/Fonts/arialbd.ttf',
                'C:/Windows/Fonts/Arial.ttf',
            ]:
                if Path(font_path).exists():
                    title_font = ImageFont.truetype(font_path, 90)
                    hook_font  = ImageFont.truetype(font_path, 52)
                    break
            else:
                title_font = ImageFont.load_default()
                hook_font  = title_font
        except Exception:
            title_font = ImageFont.load_default()
            hook_font  = title_font

        # Draw hook text at top (yellow, smaller)
        if hook:
            hook_clean = hook.upper()[:60]
            hook_lines = wrap_text(hook_clean, max_chars=28)
            y_top = 30
            for line in hook_lines[:2]:
                # Shadow
                draw.text((22, y_top + 3), line, font=hook_font, fill=(0, 0, 0, 200))
                draw.text((20, y_top),     line, font=hook_font, fill=(255, 220, 0))
                y_top += 62

        # Draw title at bottom (big, white, bold)
        title_clean = title.upper()[:80]
        title_lines = wrap_text(title_clean, max_chars=18)
        y_pos = target_h - 60 - len(title_lines) * 100
        for line in title_lines[-3:]:  # max 3 lines
            # Black stroke
            for dx, dy in [(-3, -3), (3, -3), (-3, 3), (3, 3), (0, -3), (0, 3), (-3, 0), (3, 0)]:
                draw.text((42 + dx, y_pos + dy), line, font=title_font, fill=(0, 0, 0))
            draw.text((42, y_pos), line, font=title_font, fill=(255, 255, 255))
            y_pos += 100

        # Viral badge in top-right
        badge_text = "🔥 VIRAL"
        draw.rectangle([(target_w - 200, 20), (target_w - 20, 70)],
                        fill=(220, 30, 30), outline=(255, 255, 255), width=2)
        draw.text((target_w - 190, 28), "VIRAL CLIP", font=hook_font, fill=(255, 255, 255))

        img.save(output_jpg, 'JPEG', quality=95)
    else:
        # No Pillow — save raw frame with basic cv2 text
        frame_out = frame_resized.copy()

        # Dark gradient overlay
        overlay = np.zeros_like(frame_out)
        for i in range(300):
            alpha = i / 300
            frame_out[target_h - 300 + i, :] = (
                frame_out[target_h - 300 + i, :] * (1 - alpha * 0.8)
            ).astype(np.uint8)

        # Title text
        cv2.putText(frame_out, title.upper()[:40],
                    (40, target_h - 60), cv2.FONT_HERSHEY_IMPACT,
                    2.2, (0, 0, 0), 8, cv2.LINE_AA)
        cv2.putText(frame_out, title.upper()[:40],
                    (40, target_h - 60), cv2.FONT_HERSHEY_IMPACT,
                    2.2, (255, 255, 255), 3, cv2.LINE_AA)

        if hook:
            cv2.putText(frame_out, hook.upper()[:50],
                        (40, 70), cv2.FONT_HERSHEY_IMPACT,
                        1.5, (0, 200, 255), 4, cv2.LINE_AA)

        cv2.imwrite(output_jpg, frame_out, [cv2.IMWRITE_JPEG_QUALITY, 90])

    print(json.dumps({"status": "ok", "output": output_jpg}))


if __name__ == "__main__":
    if len(sys.argv) < 4:
        print(json.dumps({"status": "error", "message": "Usage: thumbnail_gen.py <video> <output_jpg> <title> [hook]"}))
        sys.exit(1)

    input_video = sys.argv[1]
    output_jpg  = sys.argv[2]
    title       = sys.argv[3]
    hook        = sys.argv[4] if len(sys.argv) > 4 else ''

    generate_thumbnail(input_video, output_jpg, title, hook)
