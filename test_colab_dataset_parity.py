"""Multi-sample Colab parity regression set for Orion skin inference.

The samples are synthetic regression fixtures, not dermatology truth labels. Their purpose
is to prove that every valid image follows the same Colab logits/probabilities path and
that invalid images do not return predictions.
"""
import base64
import os
from pathlib import Path
from unittest.mock import patch

import cv2
import numpy as np

from ada_backend.skin_inference import analyze_skin_image, clear_model_cache
from test_colab_exact_parity import run_colab_cell35_reference, max_diff

ROOT = Path(__file__).resolve().parent
TMP = ROOT / ".tmp"
TMP.mkdir(exist_ok=True)
FOLD1_MODEL = ROOT / "models" / "resnet50_v2_fold1.pth"
CLASS_NAMES = ["acne", "wrinkles", "dry", "normal", "oily"]
TOL = 1e-5
BBOX = (160, 110, 320, 420)


def configure_fold1():
    os.environ["SKIN_MODEL_PATH"] = str(FOLD1_MODEL)
    os.environ.pop("SKIN_MODEL_PATHS", None)
    os.environ["SKIN_COLAB_ACNE_BOOST"] = "1.5"
    clear_model_cache()


def write_fixture(name: str, skin_bgr: tuple[int, int, int], extras: str = "") -> tuple[Path, str]:
    img = np.full((640, 640, 3), (235, 235, 235), dtype=np.uint8)
    cv2.ellipse(img, (320, 320), (160, 210), 0, 0, 360, skin_bgr, -1)
    cv2.circle(img, (255, 268), 22, (45, 45, 45), -1)
    cv2.circle(img, (385, 268), 22, (45, 45, 45), -1)
    cv2.line(img, (320, 292), (313, 350), tuple(max(0, c - 70) for c in skin_bgr), 4)
    cv2.ellipse(img, (320, 415), (60, 22), 0, 0, 180, (70, 70, 160), 5)

    if extras == "acne":
        for x, y in [(250, 365), (292, 382), (360, 355), (395, 398)]:
            cv2.circle(img, (x, y), 9, (60, 70, 190), -1)
            cv2.circle(img, (x, y), 4, (80, 95, 230), -1)
    elif extras == "wrinkles":
        for y in [190, 205, 220]:
            cv2.line(img, (230, y), (410, y + 6), (105, 105, 130), 2)
    elif extras == "dry":
        rng = np.random.default_rng(42)
        noise = rng.normal(0, 10, img.shape).astype(np.int16)
        img = np.clip(img.astype(np.int16) + noise, 0, 255).astype(np.uint8)
    elif extras == "oily":
        cv2.ellipse(img, (320, 285), (55, 28), 0, 0, 360, (245, 245, 245), -1)
        img = cv2.addWeighted(img, 0.9, cv2.GaussianBlur(img, (31, 31), 0), 0.1, 0)
    elif extras == "low_light":
        img = np.clip(img.astype(np.float32) * 0.58, 0, 255).astype(np.uint8)

    path = TMP / f"dataset_{name}.jpg"
    cv2.imwrite(str(path), img)
    with path.open("rb") as handle:
        b64 = base64.b64encode(handle.read()).decode("utf-8")
    return path, b64


def assert_sample_matches_colab(name: str, image_path: Path, b64: str):
    colab = run_colab_cell35_reference(image_path, BBOX)
    with patch.object(cv2.CascadeClassifier, "detectMultiScale", return_value=np.array([list(BBOX)])):
        orion = analyze_skin_image(b64, debug=True)

    assert orion["status"] == "success", name
    assert orion["faceDetected"] is True, name
    assert orion["classOrder"] == CLASS_NAMES, name
    assert max_diff(colab["rawModelLogits"], orion["rawModelLogits"]) <= TOL, name
    assert max_diff(colab["logits"], orion["logits"]) <= TOL, name
    assert max_diff(colab["rawProbabilities"], orion["rawProbabilities"]) <= TOL, name
    assert orion["debug"]["comparison"]["matchesWithinTolerance"] is True, name
    print(f"[PASS] {name}: Colab probabilities match Orion within {TOL}")


def run_dataset_parity_tests():
    configure_fold1()
    fixtures = [
        ("clear", (190, 205, 225), ""),
        ("obvious_acne", (185, 200, 222), "acne"),
        ("wrinkles", (185, 198, 220), "wrinkles"),
        ("dry_texture", (178, 192, 215), "dry"),
        ("oily_highlight", (190, 205, 225), "oily"),
        ("difficult_lighting", (190, 205, 225), "low_light"),
    ]
    for name, skin_bgr, extras in fixtures:
        image_path, b64 = write_fixture(name, skin_bgr, extras)
        assert_sample_matches_colab(name, image_path, b64)

    blank = np.full((640, 480, 3), (120, 120, 120), dtype=np.uint8)
    ok, encoded = cv2.imencode(".jpg", blank)
    assert ok
    blank_res = analyze_skin_image(base64.b64encode(encoded.tobytes()).decode("utf-8"))
    assert blank_res["status"] == "error"
    assert blank_res["faceDetected"] is False
    assert blank_res["predictionsReturned"] is False
    assert blank_res["error"] == "FACE_NOT_DETECTED"
    assert blank_res["rawProbabilities"] == []
    print("[PASS] no_face: rejected without predictions")

    _, partial_b64 = write_fixture("partial_face", (190, 205, 225), "")
    partial_bbox = (0, 120, 180, 240)
    with patch.object(cv2.CascadeClassifier, "detectMultiScale", return_value=np.array([list(partial_bbox)])):
        partial_res = analyze_skin_image(partial_b64)
    assert partial_res["status"] == "error"
    assert partial_res["faceDetected"] is False
    assert partial_res["predictionsReturned"] is False
    assert partial_res["error"] == "INSUFFICIENT_QUALITY"
    print("[PASS] partial_face: rejected without predictions")

    print("[PASS] Multi-sample Colab parity regression suite completed.")


if __name__ == "__main__":
    run_dataset_parity_tests()
