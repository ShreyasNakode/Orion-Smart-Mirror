"""Smoke test for strict no-face gate and Colab-exact PyTorch inference."""
import base64
import io
import json
import os
from pathlib import Path
from unittest.mock import patch

import cv2
import numpy as np
from PIL import Image

sys_path_root = Path(__file__).resolve().parent
import sys
sys.path.insert(0, str(sys_path_root / "ada_backend"))
from skin_inference import analyze_skin_image, clear_model_cache

ROOT = Path(__file__).resolve().parent
os.environ["SKIN_MODEL_PATH"] = str(ROOT / "models" / "resnet50_v2_fold1.pth")
os.environ.pop("SKIN_MODEL_PATHS", None)
os.environ["SKIN_COLAB_ACNE_BOOST"] = "1.5"
clear_model_cache()

print("=== TEST 1: Blank / Cover Image (Must fail face detection) ===")
blank_buf = io.BytesIO()
Image.new("RGB", (640, 480), color=(100, 100, 100)).save(blank_buf, format="JPEG")
blank_b64 = base64.b64encode(blank_buf.getvalue()).decode()

blank_res = analyze_skin_image(blank_b64)
print(blank_res)

assert blank_res["faceDetected"] is False
assert blank_res["predictionsReturned"] is False
assert blank_res["error"] == "FACE_NOT_DETECTED"
assert blank_res["rawProbabilities"] == []
print("[PASS] TEST 1: Blank/covered frame correctly rejected without predictions.\n")

print("=== TEST 2: Valid Face Crop Via Colab BBox ===")
face_img = np.full((640, 640, 3), (240, 240, 240), dtype=np.uint8)
cv2.ellipse(face_img, (320, 320), (160, 210), 0, 0, 360, (180, 200, 230), -1)
cv2.circle(face_img, (255, 270), 22, (50, 50, 50), -1)
cv2.circle(face_img, (385, 270), 22, (50, 50, 50), -1)
cv2.line(face_img, (320, 292), (315, 350), (100, 120, 150), 4)
cv2.ellipse(face_img, (320, 415), (58, 22), 0, 0, 180, (50, 50, 180), 5)

ok, encoded = cv2.imencode(".jpg", face_img)
assert ok
face_b64 = base64.b64encode(encoded.tobytes()).decode()
bbox = np.array([[160, 110, 320, 420]])
with patch.object(cv2.CascadeClassifier, "detectMultiScale", return_value=bbox):
    face_res = analyze_skin_image(face_b64, debug=True)
print(json.dumps({k: face_res[k] for k in ["status", "faceDetected", "classOrder", "rawProbabilities", "topThreePredictions"]}, indent=2))

assert face_res["status"] == "success"
assert face_res["faceDetected"] is True
assert face_res["predictionsReturned"] is True
assert abs(sum(face_res["rawProbabilities"]) - 1.0) < 1e-6
assert face_res["debug"]["comparison"]["matchesWithinTolerance"] is True

print("\nALL FACE DETECTION TESTS PASSED.")
