"""Smoke parity checks for the Colab-exact Orion skin inference path."""
import base64
import io
import os
from pathlib import Path
from unittest.mock import patch

import cv2
import numpy as np
from PIL import Image
import torch

sys_path_root = Path(__file__).resolve().parent
import sys
sys.path.insert(0, str(sys_path_root / "ada_backend"))
from skin_inference import analyze_skin_image, clear_model_cache, get_loaded_models, get_model_metadata

ROOT = Path(__file__).resolve().parent
FOLD1_MODEL = ROOT / "models" / "resnet50_v2_fold1.pth"
CLASS_NAMES = ["acne", "wrinkles", "dry", "normal", "oily"]


def configure_fold1():
    os.environ["SKIN_MODEL_PATH"] = str(FOLD1_MODEL)
    os.environ.pop("SKIN_MODEL_PATHS", None)
    os.environ["SKIN_COLAB_ACNE_BOOST"] = "1.5"
    clear_model_cache()


def image_to_b64(img_bgr: np.ndarray) -> str:
    ok, encoded = cv2.imencode(".jpg", img_bgr)
    assert ok
    return base64.b64encode(encoded.tobytes()).decode("utf-8")


def create_face_b64() -> tuple[str, tuple[int, int, int, int]]:
    img = np.full((640, 640, 3), (240, 240, 240), dtype=np.uint8)
    cv2.ellipse(img, (320, 320), (155, 205), 0, 0, 360, (184, 200, 228), -1)
    cv2.circle(img, (255, 270), 22, (50, 50, 50), -1)
    cv2.circle(img, (385, 270), 22, (50, 50, 50), -1)
    cv2.line(img, (320, 292), (314, 348), (100, 120, 150), 4)
    cv2.ellipse(img, (320, 410), (58, 23), 0, 0, 180, (60, 60, 175), 5)
    return image_to_b64(img), (160, 110, 320, 420)


def create_blank_b64() -> str:
    buf = io.BytesIO()
    Image.new("RGB", (640, 480), color=(120, 120, 120)).save(buf, format="JPEG")
    return base64.b64encode(buf.getvalue()).decode()


def main():
    configure_fold1()
    print("=" * 70)
    print("  ORION SMART MIRROR - COLAB-EXACT SKIN MODEL SMOKE TEST")
    print("=" * 70)

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    models = get_loaded_models()
    metadata = get_model_metadata()
    assert len(models) == 1
    assert not models[0].training
    assert metadata["filename"] == "resnet50_v2_fold1.pth"
    assert metadata["classOrder"] == CLASS_NAMES
    assert metadata["stateDictKeyCount"] == 320
    assert metadata["paramCount"] > 20_000_000
    print(f"[PASS] Fold-1 checkpoint loaded strictly on {device}: {metadata['sha256']}")

    blank_res = analyze_skin_image(create_blank_b64())
    assert blank_res["status"] == "error"
    assert blank_res["faceDetected"] is False
    assert blank_res["predictionsReturned"] is False
    assert blank_res["error"] == "FACE_NOT_DETECTED"
    assert blank_res["rawProbabilities"] == []
    print("[PASS] Non-face image rejected with no predictions.")

    face_b64, bbox = create_face_b64()
    with patch.object(cv2.CascadeClassifier, "detectMultiScale", return_value=np.array([list(bbox)])):
        res1 = analyze_skin_image(face_b64)
    with patch.object(cv2.CascadeClassifier, "detectMultiScale", return_value=np.array([list(bbox)])):
        res2 = analyze_skin_image(face_b64)

    assert res1["status"] == "success"
    assert res1["faceDetected"] is True
    assert res1["predictionsReturned"] is True
    assert res1["ensembleFolds"] == 1
    assert res1["classOrder"] == CLASS_NAMES
    assert abs(sum(res1["rawProbabilities"]) - 1.0) < 1e-6
    for left, right in zip(res1["rawProbabilities"], res2["rawProbabilities"]):
        assert abs(left - right) < 1e-7
    for left, right in zip(res1["logits"], res2["logits"]):
        assert abs(left - right) < 1e-7
    print("[PASS] Valid face inference is deterministic and returns a proper 5-class softmax.")

    print("=" * 70)
    print("  ALL COLAB-EXACT SMOKE TESTS PASSED")
    print("=" * 70)


if __name__ == "__main__":
    main()
