"""In-process FastAPI route test for Orion skin model prediction handlers."""
import asyncio
import base64
import os
from pathlib import Path
from unittest.mock import patch

import cv2
import numpy as np

ROOT = Path(__file__).resolve().parent
os.environ["SKIN_MODEL_PATH"] = str(ROOT / "models" / "resnet50_v2_fold1.pth")
os.environ.pop("SKIN_MODEL_PATHS", None)
os.environ["SKIN_COLAB_ACNE_BOOST"] = "1.5"

try:
    from ada_backend.server import SkinAnalyzeReq, api_skin_analyze
except ModuleNotFoundError as exc:
    if exc.name == "socketio":
        print("[SKIP] FastAPI route test requires python-socketio; skin_inference parity tests cover the model path in this environment.")
        raise SystemExit(0) from exc
    raise

from ada_backend.skin_inference import clear_model_cache

CLASS_NAMES = ["acne", "wrinkles", "dry", "normal", "oily"]


def generate_test_face_b64() -> tuple[str, tuple[int, int, int, int]]:
    img = np.full((640, 640, 3), (240, 240, 240), dtype=np.uint8)
    cv2.ellipse(img, (320, 320), (160, 210), 0, 0, 360, (180, 200, 230), -1)
    cv2.circle(img, (255, 270), 22, (50, 50, 50), -1)
    cv2.circle(img, (385, 270), 22, (50, 50, 50), -1)
    cv2.line(img, (320, 292), (315, 350), (100, 120, 150), 4)
    cv2.ellipse(img, (320, 415), (58, 22), 0, 0, 180, (50, 50, 180), 5)
    ok, encoded = cv2.imencode(".jpg", img)
    assert ok
    return base64.b64encode(encoded.tobytes()).decode(), (160, 110, 320, 420)


async def test_predict_handler():
    clear_model_cache()
    img_b64, bbox = generate_test_face_b64()
    req = SkinAnalyzeReq(image=img_b64, debug=True)
    with patch.object(cv2.CascadeClassifier, "detectMultiScale", return_value=np.array([list(bbox)])):
        data = await api_skin_analyze(req)

    print("[OK] Response received from FastAPI handler:")
    print(f"  Status        : {data.get('status')}")
    print(f"  Score         : {data.get('score')}")
    print(f"  Classification: {data.get('classification')}")
    print(f"  Ensemble Folds: {data.get('ensembleFolds')}")
    print(f"  Model Files   : {data.get('modelFilenames')}")
    print(f"  Preprocessing : {data.get('preprocessing', {}).get('source')}")

    assert data.get("status") == "success"
    assert data.get("faceDetected") is True
    assert data.get("predictionsReturned") is True
    assert data.get("ensembleFolds") == 1
    assert data.get("classOrder") == CLASS_NAMES
    assert data.get("modelFilenames") == ["resnet50_v2_fold1.pth"]
    assert abs(sum(data.get("rawProbabilities", [])) - 1.0) < 1e-6
    assert data.get("debug", {}).get("comparison", {}).get("matchesWithinTolerance") is True
    print("[PASS] FastAPI handler works with Colab-exact inference and debug parity output.")


if __name__ == "__main__":
    asyncio.run(test_predict_handler())
