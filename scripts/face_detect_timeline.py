"""
face_detect_timeline.py — Face position timeline for FFmpeg sendcmd-based dynamic crop.

Instead of encoding the full video in Python (which is slow and loses audio),
this script ONLY detects face positions and outputs an FFmpeg sendcmd file.
FFmpeg then does the crop itself — fast, audio preserved.

Usage:
  python face_detect_timeline.py <input_video> <output_cmds.txt>

Output (stdout JSON):
  {"status": "ok", "crop_w": 360, "crop_h": 640, "detected": 12, "out": "/tmp/cmds.txt"}
  {"status": "no_face"}
"""

import sys
import json
import cv2
import numpy as np


def smooth_signal(values, window=25):
    """Gaussian-weighted moving average."""
    if len(values) == 0:
        return values
    kernel_size = min(window, len(values))
    if kernel_size % 2 == 0:
        kernel_size -= 1
    if kernel_size < 1:
        kernel_size = 1
    sigma = kernel_size / 6.0
    x = np.arange(kernel_size) - kernel_size // 2
    kernel = np.exp(-x**2 / (2 * sigma**2))
    kernel /= kernel.sum()
    padded = np.pad(values, kernel_size // 2, mode='edge')
    result = np.convolve(padded, kernel, mode='valid')
    return result[:len(values)]


def main():
    if len(sys.argv) < 3:
        print(json.dumps({"status": "error", "message": "Need: <input_video> <output_cmds>"}))
        sys.exit(1)

    input_path = sys.argv[1]
    cmds_path  = sys.argv[2]

    cap = cv2.VideoCapture(input_path)
    if not cap.isOpened():
        print(json.dumps({"status": "error", "message": f"Cannot open: {input_path}"}))
        sys.exit(1)

    width  = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    fps    = cap.get(cv2.CAP_PROP_FPS) or 30.0
    total  = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    cap.release()

    # Portrait 9:16 target
    crop_w = min(width, int(height * 9 / 16))
    crop_h = height

    # --- Build detector ---
    # Try MediaPipe with two model_selection values for best coverage
    use_mediapipe = False
    mp_detector   = None
    try:
        import mediapipe as mp
        mp_face = mp.solutions.face_detection
        # model_selection=1 covers full-range (0–5m), better for YouTube-style talking-head
        mp_detector = mp_face.FaceDetection(model_selection=1, min_detection_confidence=0.25)
        use_mediapipe = True
    except ImportError:
        pass

    haar = cv2.CascadeClassifier(cv2.data.haarcascades + 'haarcascade_frontalface_default.xml')
    haar_profile = cv2.CascadeClassifier(cv2.data.haarcascades + 'haarcascade_profileface.xml')

    # --- Detect at every ~0.5 seconds ---
    interval = max(1, int(fps * 0.5))
    keyframes = {}  # frame_idx -> cx (face center x)

    cap = cv2.VideoCapture(input_path)
    for fi in range(0, total, interval):
        cap.set(cv2.CAP_PROP_POS_FRAMES, fi)
        ret, frame = cap.read()
        if not ret:
            continue

        cx = None

        if use_mediapipe and mp_detector is not None:
            rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            res = mp_detector.process(rgb)
            if res.detections:
                # Focus on the LARGEST face (main speaker), not just the highest confidence
                best = max(res.detections, key=lambda d: d.location_data.relative_bounding_box.width * d.location_data.relative_bounding_box.height)

                bb   = best.location_data.relative_bounding_box
                # clamp to frame
                bx = max(0.0, min(1.0, bb.xmin + bb.width / 2))
                cx = bx * width

        if cx is None:
            # Haar cascade fallback — try frontal + profile
            gray    = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
            gray    = cv2.equalizeHist(gray)
            faces   = haar.detectMultiScale(gray, 1.05, 3, minSize=(30, 30))
            if len(faces) == 0:
                faces = haar_profile.detectMultiScale(gray, 1.05, 3, minSize=(30, 30))
            if len(faces) > 0:
                fx, fy, fw, fh = sorted(faces, key=lambda f: f[2] * f[3], reverse=True)[0]
                cx = fx + fw / 2.0

        if cx is not None:
            keyframes[fi] = cx

    cap.release()
    if mp_detector is not None:
        try:
            mp_detector.close()
        except Exception:
            pass

    # --- Interpolate + smooth ---
    if keyframes:
        kf_list = sorted(keyframes.keys())
        kv_list = [keyframes[f] for f in kf_list]

        all_idx = np.arange(total, dtype=float)
        cx_all  = np.interp(all_idx, kf_list, kv_list)

        # Clamp edges to nearest detected value
        cx_all[:kf_list[0]]  = kv_list[0]
        cx_all[kf_list[-1]:] = kv_list[-1]

        # Gaussian smooth to suppress jitter (~1.5 sec window)
        cx_all = smooth_signal(cx_all, window=int(fps * 1.5))
    else:
        # No face detected — centre crop
        cx_all = np.full(total, width / 2.0)

    crop_x_all = np.clip(cx_all - crop_w / 2.0, 0, max(0, width - crop_w)).astype(int)

    # --- Write FFmpeg sendcmd file ---
    # Format: TIME crop x VALUE
    # Write at every 0.5-second interval; only when value changes significantly
    lines = []
    prev_x = -9999
    for fi in range(0, total, interval):
        cx = int(crop_x_all[fi])
        if abs(cx - prev_x) > 1:        # only emit changed entries
            t = fi / fps
            lines.append(f"{t:.3f} crop x {cx}")
            prev_x = cx

    # Always write the first entry at t=0
    if lines and not lines[0].startswith("0.000"):
        lines.insert(0, f"0.000 crop x {int(crop_x_all[0])}")

    with open(cmds_path, 'w', encoding='utf-8') as f:
        f.write('\n'.join(lines) + '\n')

    print(json.dumps({
        "status":   "ok",
        "crop_w":   crop_w,
        "crop_h":   crop_h,
        "detected": len(keyframes),
        "out":      cmds_path
    }))


main()
