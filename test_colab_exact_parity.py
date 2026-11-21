"""Exact Colab Cell 35 parity tests for Orion skin inference."""
import base64
import io
import os
from pathlib import Path
from unittest.mock import patch

import cv2
import numpy as np
import torch
import torch.nn as nn
from PIL import Image
from torchvision import models, transforms

from ada_backend.skin_inference import analyze_skin_image, clear_model_cache

ROOT = Path(__file__).resolve().parent
TMP = ROOT / ".tmp"
TMP.mkdir(exist_ok=True)
FOLD1_MODEL = ROOT / "models" / "resnet50_v2_fold1.pth"
CLASS_NAMES = ["acne", "wrinkles", "dry", "normal", "oily"]
BOOST = 1.5
TOL = 1e-5


def configure_fold1():
    os.environ["SKIN_MODEL_PATH"] = str(FOLD1_MODEL)
    os.environ.pop("SKIN_MODEL_PATHS", None)
    os.environ["SKIN_COLAB_ACNE_BOOST"] = str(BOOST)
    clear_model_cache()


def create_face_image(path: Path) -> tuple[str, tuple[int, int, int, int]]:
    img = np.full((640, 640, 3), (238, 232, 226), dtype=np.uint8)
    cv2.ellipse(img, (320, 320), (160, 210), 0, 0, 360, (186, 202, 226), -1)
    cv2.circle(img, (255, 270), 24, (46, 50, 58), -1)
    cv2.circle(img, (385, 270), 24, (46, 50, 58), -1)
    cv2.line(img, (320, 295), (312, 350), (105, 124, 150), 4)
    cv2.ellipse(img, (320, 420), (62, 22), 0, 0, 180, (70, 72, 170), 5)
    cv2.imwrite(str(path), img)
    with path.open("rb") as handle:
        b64 = base64.b64encode(handle.read()).decode("utf-8")
    return b64, (160, 110, 320, 420)


def create_blank_b64() -> str:
    buf = io.BytesIO()
    Image.new("RGB", (640, 480), color=(120, 120, 120)).save(buf, format="JPEG")
    return base64.b64encode(buf.getvalue()).decode("utf-8")


def run_colab_cell35_reference(image_path: Path, bbox: tuple[int, int, int, int]):
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    transform = transforms.Compose([
        transforms.ToPILImage(),
        transforms.Resize((224, 224)),
        transforms.ToTensor(),
        transforms.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225]),
    ])

    model = models.resnet50(weights=None)
    model.fc = nn.Sequential(
        nn.Dropout(0.4),
        nn.Linear(model.fc.in_features, len(CLASS_NAMES)),
    )
    state_dict = torch.load(str(FOLD1_MODEL), map_location=device, weights_only=False)
    if isinstance(state_dict, dict) and "state_dict" in state_dict:
        state_dict = state_dict["state_dict"]
    state_dict = {key.replace("module.", ""): value for key, value in state_dict.items()}
    model.load_state_dict(state_dict, strict=True)
    model.to(device)
    model.eval()

    img = cv2.imread(str(image_path))
    img_rgb = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
    x, y, w, h = bbox
    face_to_process = img_rgb[y:y + h, x:x + w]
    input_tensor = transform(face_to_process).unsqueeze(0).to(device)

    with torch.no_grad():
        output = model(input_tensor)
        raw_model_logits = output.clone()
        acne_idx = CLASS_NAMES.index("acne")
        output[0, acne_idx] += BOOST
        raw_model_probabilities = torch.softmax(raw_model_logits, dim=1)
        probabilities = torch.softmax(output, dim=1)
        top3_probs, top3_indices = torch.topk(probabilities, 3)

    return {
        "rawModelLogits": raw_model_logits.cpu().numpy()[0].tolist(),
        "logits": output.cpu().numpy()[0].tolist(),
        "rawModelProbabilities": raw_model_probabilities.cpu().numpy()[0].tolist(),
        "rawProbabilities": probabilities.cpu().numpy()[0].tolist(),
        "conditionScores": {CLASS_NAMES[i]: float(probabilities.cpu().numpy()[0][i]) for i in range(len(CLASS_NAMES))},
        "top3": [(CLASS_NAMES[top3_indices[0][i].item()], float(top3_probs[0][i].item())) for i in range(3)],
    }


def max_diff(left, right) -> float:
    return max(abs(float(a) - float(b)) for a, b in zip(left, right))


def run_side_by_side_parity_audit():
    configure_fold1()
    image_path = TMP / "colab_exact_face.jpg"
    b64, bbox = create_face_image(image_path)

    colab = run_colab_cell35_reference(image_path, bbox)
    with patch.object(cv2.CascadeClassifier, "detectMultiScale", return_value=np.array([list(bbox)])):
        orion = analyze_skin_image(b64, debug=True)

    assert orion["status"] == "success"
    assert orion["faceDetected"] is True
    assert orion["predictionsReturned"] is True
    assert orion["classOrder"] == CLASS_NAMES
    assert orion["ensembleFolds"] == 1
    assert orion["modelFilenames"] == ["resnet50_v2_fold1.pth"]
    assert abs(orion["acneLogitBoost"] - BOOST) < 1e-12

    raw_logit_diff = max_diff(colab["rawModelLogits"], orion["rawModelLogits"])
    adjusted_logit_diff = max_diff(colab["logits"], orion["logits"])
    probability_diff = max_diff(colab["rawProbabilities"], orion["rawProbabilities"])
    raw_probability_diff = max_diff(colab["rawModelProbabilities"], orion["rawModelProbabilities"])

    print("Raw model logits max diff:", raw_logit_diff)
    print("Adjusted Colab logits max diff:", adjusted_logit_diff)
    print("Raw model probabilities max diff:", raw_probability_diff)
    print("Colab final probabilities max diff:", probability_diff)
    print("Orion probabilities:", orion["conditionScores"])
    print("Debug first divergence:", orion["debug"]["comparison"]["firstDivergence"])

    assert raw_logit_diff <= TOL
    assert adjusted_logit_diff <= TOL
    assert raw_probability_diff <= TOL
    assert probability_diff <= TOL
    for class_name in CLASS_NAMES:
        assert abs(colab["conditionScores"][class_name] - orion["conditionScores"][class_name]) <= TOL
    assert orion["debug"]["comparison"]["matchesWithinTolerance"] is True
    assert orion["debug"]["comparison"]["firstDivergence"] is None

    blank = analyze_skin_image(create_blank_b64(), debug=True)
    assert blank["status"] == "error"
    assert blank["faceDetected"] is False
    assert blank["predictionsReturned"] is False
    assert blank["error"] == "FACE_NOT_DETECTED"
    assert blank["rawProbabilities"] == []
    assert blank["conditionScores"] == {}

    tiny_path = TMP / "tiny_quality.jpg"
    tiny_b64, _ = create_face_image(tiny_path)
    with patch.object(cv2.CascadeClassifier, "detectMultiScale", return_value=np.array([[50, 50, 10, 10]])):
        tiny = analyze_skin_image(tiny_b64)
    assert tiny["status"] == "error"
    assert tiny["faceDetected"] is False
    assert tiny["predictionsReturned"] is False
    assert tiny["error"] == "INSUFFICIENT_QUALITY"

    print("[PASS] Exact Colab Cell 35 parity and no-face/quality gates verified.")


if __name__ == "__main__":
    run_side_by_side_parity_audit()
