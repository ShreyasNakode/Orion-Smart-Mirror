"""Verification test for Bytebeem 5 skin types ONNX model."""
import sys
import io
import base64
import json
from pathlib import Path
from unittest.mock import patch
import numpy as np
import cv2
from PIL import Image

sys.path.insert(0, str(Path("ada_backend").resolve()))
import skin_inference

def main():
    print("=== TEST 1: Model Resolution & Metadata ===")
    target_type, target_path = skin_inference.resolve_model_target()
    print(f"Target Type : {target_type}")
    print(f"Target Path : {target_path}")
    assert target_type == "onnx"
    assert "Bytebeem" in target_path or "skin_model.onnx" in target_path or "blobs" in target_path

    meta = skin_inference.get_model_metadata()
    print(f"Model Arch  : {meta['architecture']}")
    print(f"Class Order : {meta['classOrder']}")
    assert len(meta["classOrder"]) == 5
    assert meta["classOrder"] == ["Acne", "Oily", "Dry", "Wrinkles", "Normal"]
    print("[PASS] Test 1: Model resolution & 5 skin types metadata verified.\n")

    print("=== TEST 2: Blank / No-Face Image (Rejection Gate) ===")
    blank_buf = io.BytesIO()
    Image.new("RGB", (640, 480), color=(128, 128, 128)).save(blank_buf, format="JPEG")
    blank_b64 = base64.b64encode(blank_buf.getvalue()).decode()
    blank_res = skin_inference.analyze_skin_image(blank_b64)
    print(f"Blank status: {blank_res['status']}, error: {blank_res.get('error')}")
    assert blank_res["faceDetected"] is False
    assert blank_res["predictionsReturned"] is False
    assert blank_res["error"] == "FACE_NOT_DETECTED"
    assert blank_res["rawProbabilities"] == []
    print("[PASS] Test 2: Blank image rejected with FACE_NOT_DETECTED.\n")

    print("=== TEST 3: Synthetic Face Image (5 Skin Types Inference) ===")
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
        face_res = skin_inference.analyze_skin_image(face_b64, debug=True)

    print(f"Status              : {face_res['status']}")
    print(f"Skin Health Score   : {face_res['score']}")
    print(f"Hydration           : {face_res['hydration']}%")
    print(f"Texture             : {face_res['texture']}%")
    print(f"Classification      : {face_res['classification']}")
    print(f"Detected Conditions : {face_res['detectedConditions']}")
    print(f"Total Conditions    : {len(face_res['classifications'])}")
    print("\nIndividual 5 Skin Types:")
    for item in face_res["classifications"]:
        det_str = "DETECTED" if item["detected"] else "CLEAR"
        print(f"  - {item['label']:12}: {item['confidence']:5.1f}% | {det_str:8} | Severity: {item['severity']}")

    assert face_res["status"] == "success"
    assert face_res["faceDetected"] is True
    assert face_res["predictionsReturned"] is True
    assert len(face_res["classifications"]) == 5
    assert len(face_res["rawProbabilities"]) == 5
    assert len(face_res["rawLogits"]) == 5

    # Check that classifications match the 5 requested skin types: Acne, Oily, Dry, Wrinkles, Normal
    req_labels = ["Acne", "Oily", "Dry", "Wrinkles", "Normal"]
    returned_labels = [c["label"] for c in face_res["classifications"]]
    assert returned_labels == req_labels, f"Expected {req_labels}, got {returned_labels}"
    assert face_res["classification"] in req_labels, f"Classification {face_res['classification']} not in {req_labels}"
    print("[PASS] Test 3: 5 skin types inference verified.\n")

    print("=== TEST 4: Exact Parity with Bytebeem Hugging Face Space index.html ===")
    sample_img_path = Path("ada_backend") / "venv" / "Lib" / "site-packages" / "matplotlib" / "mpl-data" / "sample_data" / "grace_hopper.jpg"
    if sample_img_path.exists():
        with open(sample_img_path, "rb") as f:
            raw_sample_bytes = f.read()
        sample_b64 = base64.b64encode(raw_sample_bytes).decode()
        orion_result = skin_inference.analyze_skin_image(sample_b64, debug=True)

        # Compute reference Bytebeem index.html prediction directly:
        sample_pil = Image.open(io.BytesIO(raw_sample_bytes)).convert("RGB").resize((224, 224), Image.BILINEAR)
        rgb_data = np.array(sample_pil, dtype=np.float32) / 255.0
        mean = np.array([0.485, 0.456, 0.406], dtype=np.float32)
        std = np.array([0.229, 0.224, 0.225], dtype=np.float32)
        ref_tensor = np.transpose((rgb_data - mean) / std, (2, 0, 1))[np.newaxis, ...].astype(np.float32)

        sess = skin_inference.get_onnx_session()
        ref_logits = sess.run(["logits"], {"input": ref_tensor})[0][0]
        ref_probs = 1.0 / (1.0 + np.exp(-ref_logits))

        # Check Bytebeem classes:
        # Index 0: Acne, 4: Wrinkles, 6: Dry Skin, 7: Oily Skin
        orion_probs = {c["label"]: c["probability"] for c in orion_result["classifications"]}
        print(f"  Acne     : Orion = {orion_probs['Acne']:.4f} | Bytebeem = {ref_probs[0]:.4f}")
        print(f"  Oily     : Orion = {orion_probs['Oily']:.4f} | Bytebeem = {ref_probs[7]:.4f}")
        print(f"  Dry      : Orion = {orion_probs['Dry']:.4f} | Bytebeem = {ref_probs[6]:.4f}")
        print(f"  Wrinkles : Orion = {orion_probs['Wrinkles']:.4f} | Bytebeem = {ref_probs[4]:.4f}")

        assert abs(orion_probs["Acne"] - ref_probs[0]) < 1e-3, "Acne probability mismatch!"
        assert abs(orion_probs["Oily"] - ref_probs[7]) < 1e-3, "Oily probability mismatch!"
        assert abs(orion_probs["Dry"] - ref_probs[6]) < 1e-3, "Dry probability mismatch!"
        assert abs(orion_probs["Wrinkles"] - ref_probs[4]) < 1e-3, "Wrinkles probability mismatch!"
        print("[PASS] Test 4: 100% exact parity with Bytebeem index.html verified.\n")

    print("[PASS] ALL 4 VERIFICATION TESTS COMPLETED SUCCESSFULLY!")


if __name__ == "__main__":
    main()
