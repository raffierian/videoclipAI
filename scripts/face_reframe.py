"""
face_reframe.py — Advanced Face Tracking + Video Reframing for ViralClip AI

Modes:
  python face_reframe.py detect <video>           -> JSON crop coords (legacy)
  python face_reframe.py track  <video> <output>  -> Smooth face-tracked portrait crop

Features:
  - Frame-by-frame face detection (MediaPipe, fallback to Haar)
  - Temporal smoothing to prevent jitter (Gaussian window)
  - Interpolated face trajectory for all frames
  - Optional split-screen: top-half content + bottom face track
"""

import sys
import json
import cv2
import numpy as np
from pathlib import Path


# ───────────────────────────────────────────────
# Helpers
# ───────────────────────────────────────────────

def smooth_signal(values, window=25):
    """Gaussian-weighted moving average for smooth camera pan."""
    if len(values) == 0:
        return values
    kernel_size = min(window, len(values))
    if kernel_size % 2 == 0:
        kernel_size += 1
    sigma = kernel_size / 6.0
    x = np.arange(kernel_size) - kernel_size // 2
    kernel = np.exp(-x**2 / (2 * sigma**2))
    kernel /= kernel.sum()
    padded = np.pad(values, kernel_size // 2, mode='edge')
    return np.convolve(padded, kernel, mode='valid')[:len(values)]


def build_detector():
    try:
        import mediapipe as mp
        mp_face = mp.solutions.face_detection
        det = mp_face.FaceDetection(model_selection=0, min_detection_confidence=0.45)
        return ('mediapipe', det)
    except ImportError:
        cascade = cv2.CascadeClassifier(
            cv2.data.haarcascades + 'haarcascade_frontalface_default.xml')
        return ('haar', cascade)


def detect_face_cx(frame, detector_tuple, frame_w):
    """Returns the center-x of the most prominent face, or None."""
    kind, det = detector_tuple
    if kind == 'mediapipe':
        rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        res = det.process(rgb)
        if res.detections:
            # pick the detection with highest confidence
            best = max(res.detections, key=lambda d: d.score[0])
            bb = best.location_data.relative_bounding_box
            return (bb.xmin + bb.width / 2) * frame_w
    else:
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        faces = det.detectMultiScale(gray, 1.1, 4)
        if len(faces) > 0:
            x, y, w, h = sorted(faces, key=lambda f: f[2]*f[3], reverse=True)[0]
            return x + w / 2
    return None


# ───────────────────────────────────────────────
# Mode 1: detect (legacy — single static crop)
# ───────────────────────────────────────────────

def detect_mode(input_path: str):
    cap = cv2.VideoCapture(input_path)
    if not cap.isOpened():
        print(json.dumps({"status": "error", "message": "Cannot open video"}))
        return

    width  = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    total  = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))

    step = max(1, total // 20)
    detector = build_detector()
    cx_list = []

    for i in range(0, total, step):
        cap.set(cv2.CAP_PROP_POS_FRAMES, i)
        ret, frame = cap.read()
        if not ret:
            continue
        cx = detect_face_cx(frame, detector, width)
        if cx is not None:
            cx_list.append(cx)

    cap.release()
    if hasattr(detector[1], 'close'):
        detector[1].close()

    if not cx_list:
        print(json.dumps({"status": "no_face"}))
        return

    median_cx = int(np.median(cx_list))
    crop_h = height
    crop_w = int(crop_h * 9 / 16)
    crop_x = int(median_cx - crop_w / 2)
    crop_x = max(0, min(crop_x, width - crop_w))

    print(json.dumps({"status": "ok", "crop_x": crop_x, "crop_w": crop_w, "crop_h": crop_h}))


# ───────────────────────────────────────────────
# Mode 2: track — smooth frame-by-frame tracking
# ───────────────────────────────────────────────

def track_mode(input_path: str, output_path: str, split_screen: bool = False):
    cap = cv2.VideoCapture(input_path)
    if not cap.isOpened():
        print(json.dumps({"status": "error", "message": "Cannot open video"}))
        return

    width  = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    fps    = cap.get(cv2.CAP_PROP_FPS) or 30.0
    total  = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))

    # Portrait 9:16
    crop_w = min(width, int(height * 9 / 16))
    crop_h = height

    # --- Phase 1: detect at keyframes (every ~1 second) ---
    detect_interval = max(1, int(fps))
    detector = build_detector()
    keyframe_cx = {}  # frame_idx -> cx

    for fi in range(0, total, detect_interval):
        cap.set(cv2.CAP_PROP_POS_FRAMES, fi)
        ret, frame = cap.read()
        if not ret:
            continue
        cx = detect_face_cx(frame, detector, width)
        if cx is not None:
            keyframe_cx[fi] = cx

    if hasattr(detector[1], 'close'):
        detector[1].close()

    # --- Phase 2: interpolate for all frames ---
    if keyframe_cx:
        kf = sorted(keyframe_cx.keys())
        kv = [keyframe_cx[f] for f in kf]
        all_idx = np.arange(total)
        cx_all = np.interp(all_idx, kf, kv)
        # Clamp early/late frames to nearest detected value
        cx_all[:kf[0]] = kv[0]
        cx_all[kf[-1]:] = kv[-1]
        # Smooth to remove jitter
        cx_all = smooth_signal(cx_all, window=int(fps * 1.5))
    else:
        # No face found → center crop
        cx_all = np.full(total, width / 2)

    # Compute per-frame crop_x
    crop_x_all = np.clip(cx_all - crop_w / 2, 0, width - crop_w).astype(int)

    # --- Phase 3: write output ---
    cap.set(cv2.CAP_PROP_POS_FRAMES, 0)

    if split_screen:
        # Top: original left-half of frame (review content, landscape)
        # Bottom: face-tracked portrait region
        # Output is portrait 9:16, split in half
        out_w = crop_w
        out_h = crop_h
        half_h = out_h // 2
        fourcc = cv2.VideoWriter_fourcc(*'mp4v')
        out = cv2.VideoWriter(output_path, fourcc, fps, (out_w, out_h))

        for fi in range(total):
            ret, frame = cap.read()
            if not ret:
                break
            cx = int(crop_x_all[fi]) if fi < len(crop_x_all) else int(crop_x_all[-1])

            # Bottom half: face tracked
            face_region = frame[0:crop_h, cx:cx + crop_w]
            face_half   = cv2.resize(face_region, (out_w, half_h))

            # Top half: center of original frame (the "content")
            content_cx  = max(0, min(width // 2 - crop_w // 2, width - crop_w))
            content_reg = frame[0:crop_h, content_cx:content_cx + crop_w]
            content_half = cv2.resize(content_reg, (out_w, half_h))

            # Dark divider line
            combined = np.vstack([content_half, face_half])
            cv2.line(combined, (0, half_h - 1), (out_w, half_h - 1), (30, 30, 30), 3)
            out.write(combined)
    else:
        fourcc = cv2.VideoWriter_fourcc(*'mp4v')
        out = cv2.VideoWriter(output_path, fourcc, fps, (crop_w, crop_h))

        for fi in range(total):
            ret, frame = cap.read()
            if not ret:
                break
            cx = int(crop_x_all[fi]) if fi < len(crop_x_all) else int(crop_x_all[-1])
            cropped = frame[0:crop_h, cx:cx + crop_w]
            if cropped.shape[1] != crop_w or cropped.shape[0] != crop_h:
                cropped = cv2.resize(cropped, (crop_w, crop_h))
            out.write(cropped)

    cap.release()
    out.release()
    print(json.dumps({"status": "ok", "output": output_path, "frames": total}))


# ───────────────────────────────────────────────
# Entry point
# ───────────────────────────────────────────────

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(json.dumps({"status": "error", "message": "Usage: face_reframe.py <detect|track> ..."}))
        sys.exit(1)

    mode = sys.argv[1]

    if mode == "track":
        if len(sys.argv) < 4:
            print(json.dumps({"status": "error", "message": "track mode needs: <input> <output>"}))
            sys.exit(1)
        split = len(sys.argv) > 4 and sys.argv[4] == "split"
        track_mode(sys.argv[2], sys.argv[3], split_screen=split)
    elif mode == "detect":
        if len(sys.argv) < 3:
            print(json.dumps({"status": "error", "message": "detect mode needs: <input>"}))
            sys.exit(1)
        detect_mode(sys.argv[2])
    else:
        # Legacy: first arg is a file path
        detect_mode(sys.argv[1])
