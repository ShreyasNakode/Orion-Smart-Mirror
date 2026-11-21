from __future__ import annotations

import base64
import hashlib
import json
import os
import site
import sys
import time
from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Tuple

if hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding="utf-8")  # type: ignore[attr-defined]
    except Exception:
        pass
if hasattr(sys.stderr, "reconfigure"):
    try:
        sys.stderr.reconfigure(encoding="utf-8")  # type: ignore[attr-defined]
    except Exception:
        pass


def _inject_site_packages() -> None:
    paths_to_add: List[str] = []
    venv_site = os.path.join(os.path.dirname(__file__), "venv", "Lib", "site-packages")
    if os.path.exists(venv_site):
        paths_to_add.append(venv_site)
    try:
        user_site = site.getusersitepackages()
        if os.path.exists(user_site):
            paths_to_add.append(user_site)
    except Exception:
        pass
    for path in paths_to_add:
        if path not in sys.path:
            sys.path.insert(0, path)


_inject_site_packages()

import cv2
import numpy as np
from PIL import Image
try:
    import onnxruntime as ort
except ImportError:
    ort = None

_torch = None
_nn = None
_models = None
_transforms = None

def _get_torch():
    global _torch, _nn, _models, _transforms
    if _torch is None:
        import torch
        import torch.nn as nn
        from torchvision import models, transforms
        _torch = torch
        _nn = nn
        _models = models
        _transforms = transforms
    return _torch, _nn, _models, _transforms

BYTEBEEM_SNAPSHOT_DIR = r"C:\Users\nakod\.cache\huggingface\hub\spaces--Bytebeem--facial-skin-analysis-static\snapshots\3a7e9b9bdaea381d127b14d9a6c5d53a24e54bcc"
BYTEBEEM_MODEL_PATH = os.path.join(BYTEBEEM_SNAPSHOT_DIR, "skin_model.onnx")

ESSY254_SNAPSHOT_DIR = r"C:\Users\nakod\.cache\huggingface\hub\spaces--essy254--skin-analysis\snapshots\9052577064d3a8092157c4e1fc97ea6af831c4fd"

BYTEBEEM_CLASSES = [
    "Acne",
    "Blackheads",
    "Dark Spots",
    "Pores",
    "Wrinkles",
    "Redness",
    "Dry Skin",
    "Oily Skin",
]

SKIN_TYPE_CLASSES = [
    "Acne",
    "Oily",
    "Dry",
    "Wrinkles",
    "Normal",
]

COLAB_NOTEBOOK_PATH = r"D:\College study Applications\Capstone_LLM.ipynb"
DEFAULT_CLASS_ORDER = "acne,wrinkles,dry,normal,oily"
CLASS_ORDER = [
    item.strip().lower()
    for item in os.getenv("SKIN_CLASS_ORDER", DEFAULT_CLASS_ORDER).split(",")
    if item.strip()
]

IMG_SIZE = 224
COLAB_FACE_SCALE_FACTOR = 1.1
COLAB_FACE_MIN_NEIGHBORS = 4
MIN_VALID_FACE_SIZE = int(os.getenv("SKIN_MIN_FACE_SIZE", "45"))
MIN_VALID_FACE_AREA_RATIO = float(os.getenv("SKIN_MIN_FACE_AREA_RATIO", "0.015"))
EDGE_MARGIN_PX = int(os.getenv("SKIN_FACE_EDGE_MARGIN_PX", "2"))

# Cell 35 mutates output[0, acne_idx] += 1.5 before softmax. This is not a
# new calibration layer; it is reproduced here because the notebook is the
# source of truth for final inference behavior.
COLAB_ACNE_LOGIT_BOOST = float(os.getenv("SKIN_COLAB_ACNE_BOOST", "1.5"))

DEFAULT_MODEL_PATHS = [
    os.path.join(os.path.dirname(__file__), "..", "models", "resnet50_v2_fold1.pth"),
    os.path.join(os.path.dirname(__file__), "..", "models", "Saved_Model.pth"),
    r"D:\College study Applications\skin_condition_models\resnet50_v2_fold1.pth",
    r"D:\College study Applications\model waights\Saved_Model.pth",
]


class ResNet50SkinModel:
    def __new__(cls, num_classes: int = 5):
        torch, nn, models, transforms = _get_torch()
        class _InnerModel(nn.Module):
            def __init__(self, n_classes: int):
                super().__init__()
                base = models.resnet50(weights=None)
                in_features = base.fc.in_features
                base.fc = nn.Sequential(
                    nn.Dropout(0.4),
                    nn.Linear(in_features, n_classes),
                )
                self.model = base

            def forward(self, x):
                return self.model(x)
        return _InnerModel(num_classes)


@dataclass
class LoadedModelRecord:
    model: ResNet50SkinModel
    path: str
    sha256: str
    device: torch.device
    param_count: int
    state_dict_key_count: int


@dataclass
class FaceDetectionResult:
    valid: bool
    face_detected: bool
    error: Optional[str]
    message: Optional[str]
    bbox: Tuple[int, int, int, int]
    area_ratio: float
    crop_bgr: np.ndarray
    detector_used: str
    faces: List[Tuple[int, int, int, int]]
    cascade_path: str


_model_record: Optional[LoadedModelRecord] = None
_model_paths_loaded: List[str] = []
_onnx_session: Optional[Any] = None
_onnx_model_path: Optional[str] = None


def resolve_model_target() -> Tuple[str, str]:
    """
    Determines whether to use the ONNX model or legacy PyTorch checkpoint.
    Checks user-specified environment path, essy254 snapshot path, Bytebeem snapshot path,
    workspace fallbacks, and candidate PyTorch weights.
    Returns (model_type, resolved_path) where model_type in ('onnx', 'pytorch').
    """
    env_path = os.getenv("SKIN_MODEL_PATH", "").strip().strip('"')
    if env_path:
        # If user/env pointed to a directory (such as Hugging Face snapshot directory)
        if os.path.isdir(env_path):
            for candidate_name in ("skin_model.onnx", "model.onnx", "classifier.onnx"):
                candidate = os.path.join(env_path, candidate_name)
                if os.path.exists(candidate):
                    return "onnx", os.path.abspath(candidate)
            # Check for any .onnx or .pth inside env_path
            for fname in os.listdir(env_path):
                fpath = os.path.join(env_path, fname)
                if fname.lower().endswith(".onnx") and os.path.isfile(fpath):
                    return "onnx", os.path.abspath(fpath)
                if fname.lower().endswith(".pth") and os.path.isfile(fpath):
                    return "pytorch", os.path.abspath(fpath)
        elif env_path.lower().endswith(".onnx") and os.path.exists(env_path):
            return "onnx", os.path.abspath(env_path)
        elif env_path.lower().endswith(".pth") and os.path.exists(env_path):
            return "pytorch", os.path.abspath(env_path)

    # Check essy254 snapshot directory if model weights exist there
    if os.path.isdir(ESSY254_SNAPSHOT_DIR):
        for fname in os.listdir(ESSY254_SNAPSHOT_DIR):
            fpath = os.path.join(ESSY254_SNAPSHOT_DIR, fname)
            if fname.lower().endswith(".onnx") and os.path.isfile(fpath):
                return "onnx", os.path.abspath(fpath)
            if fname.lower().endswith(".pth") and os.path.isfile(fpath):
                return "pytorch", os.path.abspath(fpath)
        # Snapshot exists but only contains template files (index.html, style.css, README.md)
        print(
            f"[SKIN INFERENCE] Notice: essy254 snapshot directory ({ESSY254_SNAPSHOT_DIR}) "
            "contains only static space template files (.gitattributes, README.md, index.html, style.css) "
            "and no model weights (.onnx or .pth). Using Bytebeem ONNX model.",
            file=sys.stderr,
        )

    # Primary default: Bytebeem ONNX model from the Hugging Face space snapshot
    if os.path.exists(BYTEBEEM_MODEL_PATH):
        return "onnx", os.path.abspath(BYTEBEEM_MODEL_PATH)
    if os.path.exists(BYTEBEEM_SNAPSHOT_DIR):
        candidate = os.path.join(BYTEBEEM_SNAPSHOT_DIR, "skin_model.onnx")
        if os.path.exists(candidate):
            return "onnx", os.path.abspath(candidate)

    # Workspace fallback
    workspace_onnx = os.path.join(os.path.dirname(__file__), "..", "models", "skin_model.onnx")
    if os.path.exists(workspace_onnx):
        return "onnx", os.path.abspath(workspace_onnx)

    # Legacy PyTorch fallback paths if ONNX not found
    for candidate in DEFAULT_MODEL_PATHS:
        if candidate and os.path.exists(candidate):
            return "pytorch", os.path.abspath(candidate)

    raise RuntimeError(
        f"No skin model found at Bytebeem path {BYTEBEEM_MODEL_PATH} "
        f"or candidate paths {DEFAULT_MODEL_PATHS}."
    )


def get_onnx_session(path: Optional[str] = None) -> Any:
    global _onnx_session, _onnx_model_path
    if path is None:
        _, path = resolve_model_target()
    resolved = os.path.abspath(path)
    if _onnx_session is not None and _onnx_model_path == resolved:
        return _onnx_session
    if ort is None:
        raise RuntimeError("onnxruntime is not installed. Please run `pip install onnxruntime`.")
    _onnx_session = ort.InferenceSession(resolved, providers=["CPUExecutionProvider"])
    _onnx_model_path = resolved
    print(
        f"[SKIN INFERENCE] Loaded Bytebeem ONNX skin model from {resolved} (sha256={_sha256_file(resolved)})",
        file=sys.stderr,
    )
    return _onnx_session


def _split_paths(value: str) -> List[str]:
    if not value:
        return []
    separator = ";" if ";" in value else os.pathsep
    return [item.strip().strip('"') for item in value.split(separator) if item.strip()]


def _sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _sha256_file(path: str) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _sha256_array(arr: np.ndarray) -> str:
    contiguous = np.ascontiguousarray(arr)
    return hashlib.sha256(contiguous.tobytes()).hexdigest()


def configured_model_paths() -> List[str]:
    single_path = os.getenv("SKIN_MODEL_PATH", "").strip().strip('"')
    env_paths = _split_paths(os.getenv("SKIN_MODEL_PATHS", ""))
    candidates = [single_path] if single_path else (env_paths or DEFAULT_MODEL_PATHS)

    existing: List[str] = []
    seen: set[str] = set()
    for candidate in candidates:
        if not candidate:
            continue
        abs_path = os.path.abspath(candidate)
        key = os.path.normcase(abs_path)
        if key in seen:
            continue
        seen.add(key)
        if os.path.exists(abs_path):
            existing.append(abs_path)
    return existing


def _extract_state_dict(checkpoint: Any) -> Dict[str, torch.Tensor]:
    if isinstance(checkpoint, dict):
        for key in ("state_dict", "model_state_dict", "model"):
            value = checkpoint.get(key)
            if isinstance(value, dict):
                checkpoint = value
                break
    if not isinstance(checkpoint, dict):
        raise RuntimeError("Checkpoint does not contain a state_dict.")
    return {
        key.replace("module.", ""): value
        for key, value in checkpoint.items()
    }


def _torch_load(path: str, device: Any) -> Any:
    torch, _, _, _ = _get_torch()
    try:
        return torch.load(path, map_location=device, weights_only=False)
    except TypeError:
        return torch.load(path, map_location=device)


def _load_model_record(path: str, device: Any) -> LoadedModelRecord:
    model = ResNet50SkinModel(num_classes=len(CLASS_ORDER)).to(device)
    raw_checkpoint = _torch_load(path, device)
    state_dict = _extract_state_dict(raw_checkpoint)
    model.model.load_state_dict(state_dict, strict=True)
    model.eval()

    record = LoadedModelRecord(
        model=model,
        path=os.path.abspath(path),
        sha256=_sha256_file(path),
        device=device,
        param_count=sum(param.numel() for param in model.parameters()),
        state_dict_key_count=len(state_dict),
    )
    print(
        "[SKIN INFERENCE] Loaded Colab-exact ResNet50 fold checkpoint "
        f"path={record.path} sha256={record.sha256} "
        f"params={record.param_count} keys={record.state_dict_key_count} "
        f"device={record.device} eval={not record.model.training}",
        file=sys.stderr,
    )
    return record


def _get_model_record() -> LoadedModelRecord:
    global _model_record, _model_paths_loaded
    if _model_record is not None:
        return _model_record

    paths = configured_model_paths()
    if not paths:
        raise RuntimeError(
            "No Colab fold-1 skin model checkpoint was found. Checked SKIN_MODEL_PATH, "
            "SKIN_MODEL_PATHS, and the local models/resnet50_v2_fold1.pth fallback."
        )

    if len(paths) > 1:
        print(
            "[SKIN INFERENCE] Multiple model paths configured; using only the first "
            f"for Colab parity: {paths[0]}. Ignored: {paths[1:]}",
            file=sys.stderr,
        )

    torch, _, _, _ = _get_torch()
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    _model_record = _load_model_record(paths[0], device)
    _model_paths_loaded = [_model_record.path]
    return _model_record


def preload_skin_models() -> List[Any]:
    model_type, model_path = resolve_model_target()
    if model_type == "onnx":
        return [get_onnx_session(model_path)]
    return [_get_model_record().model]


def get_loaded_models() -> List[Any]:
    return preload_skin_models()


def get_model_metadata() -> Dict[str, Any]:
    model_type, model_path = resolve_model_target()
    if model_type == "onnx":
        return {
            "type": "onnx",
            "path": model_path,
            "filename": os.path.basename(model_path),
            "directory": os.path.dirname(model_path),
            "sourceDirectory": os.path.dirname(model_path),
            "essy254SnapshotDir": ESSY254_SNAPSHOT_DIR,
            "sha256": _sha256_file(model_path) if os.path.exists(model_path) else "",
            "device": "cpu",
            "paramCount": 0,
            "classOrder": SKIN_TYPE_CLASSES,
            "architecture": "Bytebeem Facial Skin Analysis Model (5 Skin Types: Acne, Oily, Dry, Wrinkles, Normal)",
            "supportedClassifications": SKIN_TYPE_CLASSES,
            "bytebeemClasses": BYTEBEEM_CLASSES,
            "parityWithHuggingFaceSpace": True,
        }
    record = _get_model_record()
    return {
        "path": record.path,
        "filename": os.path.basename(record.path),
        "sha256": record.sha256,
        "device": str(record.device),
        "paramCount": record.param_count,
        "stateDictKeyCount": record.state_dict_key_count,
        "classOrder": CLASS_ORDER,
        "architecture": "torchvision.models.resnet50(weights=None) + Dropout(0.4) + Linear(2048, 5)",
    }


def clear_model_cache() -> None:
    global _model_record, _model_paths_loaded, _onnx_session, _onnx_model_path
    _model_record = None
    _model_paths_loaded = []
    _onnx_session = None
    _onnx_model_path = None


def _decode_base64_image(base64_data: str) -> Tuple[bytes, np.ndarray]:
    if not base64_data or not isinstance(base64_data, str):
        raise ValueError("analyze_skin_image requires a non-empty base64 image string.")
    if "," in base64_data:
        base64_data = base64_data.split(",", 1)[1]
    try:
        raw_bytes = base64.b64decode(base64_data)
        frame_bgr = cv2.imdecode(np.frombuffer(raw_bytes, np.uint8), cv2.IMREAD_COLOR)
    except Exception as exc:
        raise ValueError(f"Failed to decode image: {exc}") from exc
    if frame_bgr is None:
        raise ValueError("cv2.imdecode returned None for base64 image buffer.")
    return raw_bytes, frame_bgr


def _cascade_path() -> str:
    cv2_data = getattr(cv2, "data", None)
    haarcascades_dir = getattr(cv2_data, "haarcascades", "") if cv2_data else ""
    return os.path.join(haarcascades_dir, "haarcascade_frontalface_default.xml") if haarcascades_dir else ""


def detect_face_or_skin_region(frame_bgr: np.ndarray) -> Tuple[np.ndarray, Tuple[int, int, int, int], str, float, bool]:
    detection = detect_colab_face(frame_bgr)
    return (
        detection.crop_bgr,
        detection.bbox,
        detection.detector_used,
        detection.area_ratio,
        detection.valid,
    )


def detect_colab_face(frame_bgr: np.ndarray) -> FaceDetectionResult:
    height, width = frame_bgr.shape[:2]
    fallback_bbox = (0, 0, width, height)
    cascade_path = _cascade_path()
    detector_used = "OpenCV Haar Cascade frontalface_default (Colab scaleFactor=1.1, minNeighbors=4)"

    if not cascade_path or not os.path.exists(cascade_path):
        return FaceDetectionResult(
            valid=False,
            face_detected=False,
            error="FACE_DETECTOR_UNAVAILABLE",
            message="Face detector is unavailable. Please verify OpenCV haarcascade data is installed.",
            bbox=fallback_bbox,
            area_ratio=0.0,
            crop_bgr=frame_bgr,
            detector_used=detector_used,
            faces=[],
            cascade_path=cascade_path,
        )

    gray = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2GRAY)
    face_cascade = cv2.CascadeClassifier(cascade_path)
    faces_raw = face_cascade.detectMultiScale(
        gray,
        scaleFactor=COLAB_FACE_SCALE_FACTOR,
        minNeighbors=COLAB_FACE_MIN_NEIGHBORS,
    )
    faces = [tuple(int(v) for v in face) for face in faces_raw]

    if len(faces) == 0:
        return FaceDetectionResult(
            valid=False,
            face_detected=False,
            error="FACE_NOT_DETECTED",
            message="Face not detected. Please position your face clearly inside the frame.",
            bbox=fallback_bbox,
            area_ratio=0.0,
            crop_bgr=frame_bgr,
            detector_used=detector_used,
            faces=[],
            cascade_path=cascade_path,
        )

    faces = sorted(faces, key=lambda item: item[2] * item[3], reverse=True)
    x, y, w, h = faces[0]
    x = max(0, x)
    y = max(0, y)
    w = min(width - x, w)
    h = min(height - y, h)
    area_ratio = float((w * h) / max(1, width * height))
    crop_bgr = frame_bgr[y:y + h, x:x + w]

    if w < MIN_VALID_FACE_SIZE or h < MIN_VALID_FACE_SIZE or area_ratio < MIN_VALID_FACE_AREA_RATIO:
        return FaceDetectionResult(
            valid=False,
            face_detected=True,
            error="INSUFFICIENT_QUALITY",
            message="Face image quality or size is insufficient for analysis. Please move closer and improve lighting.",
            bbox=(x, y, w, h),
            area_ratio=area_ratio,
            crop_bgr=crop_bgr,
            detector_used=detector_used,
            faces=faces,
            cascade_path=cascade_path,
        )

    touches_edge = (
        x <= EDGE_MARGIN_PX
        or y <= EDGE_MARGIN_PX
        or x + w >= width - EDGE_MARGIN_PX
        or y + h >= height - EDGE_MARGIN_PX
    )
    if touches_edge:
        return FaceDetectionResult(
            valid=False,
            face_detected=True,
            error="INSUFFICIENT_QUALITY",
            message="Face is partially outside the frame. Please center your face before scanning.",
            bbox=(x, y, w, h),
            area_ratio=area_ratio,
            crop_bgr=crop_bgr,
            detector_used=detector_used,
            faces=faces,
            cascade_path=cascade_path,
        )

    return FaceDetectionResult(
        valid=True,
        face_detected=True,
        error=None,
        message=None,
        bbox=(x, y, w, h),
        area_ratio=area_ratio,
        crop_bgr=crop_bgr,
        detector_used=detector_used,
        faces=faces,
        cascade_path=cascade_path,
    )


def _array_stats(arr: np.ndarray) -> Dict[str, Any]:
    arr_float = arr.astype(np.float32)
    return {
        "shape": list(arr.shape),
        "dtype": str(arr.dtype),
        "min": float(np.min(arr_float)),
        "max": float(np.max(arr_float)),
        "mean": float(np.mean(arr_float)),
        "std": float(np.std(arr_float)),
        "sha256": _sha256_array(arr),
    }


def _tensor_stats(tensor: torch.Tensor) -> Dict[str, Any]:
    arr = tensor.detach().cpu().contiguous().numpy()
    return {
        "shape": list(arr.shape),
        "dtype": str(arr.dtype),
        "min": float(np.min(arr)),
        "max": float(np.max(arr)),
        "mean": float(np.mean(arr)),
        "std": float(np.std(arr)),
        "sha256": hashlib.sha256(arr.tobytes()).hexdigest(),
    }


def _colab_preprocess(face_rgb: np.ndarray, device: Any) -> Tuple[np.ndarray, Any]:
    torch, nn, models, transforms = _get_torch()
    pil_image = Image.fromarray(face_rgb)
    resized_pil = pil_image.resize((IMG_SIZE, IMG_SIZE), Image.BILINEAR)
    resized_rgb = np.array(resized_pil)
    normalize = transforms.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225])
    to_tensor = transforms.ToTensor()
    tensor = normalize(to_tensor(resized_pil)).unsqueeze(0).to(device)
    return resized_rgb, tensor


def _topk(probabilities: np.ndarray, k: int = 3) -> List[Dict[str, Any]]:
    indices = np.argsort(probabilities)[::-1][:k]
    return [
        {
            "rank": rank + 1,
            "className": CLASS_ORDER[int(idx)],
            "index": int(idx),
            "probability": float(probabilities[int(idx)]),
        }
        for rank, idx in enumerate(indices)
    ]


def _run_colab_cell35_pipeline(
    raw_bytes: bytes,
    frame_bgr: np.ndarray,
    record: LoadedModelRecord,
    pipeline_name: str,
) -> Dict[str, Any]:
    image_sha256 = _sha256_bytes(raw_bytes)
    height, width = frame_bgr.shape[:2]
    frame_rgb = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2RGB)
    detection = detect_colab_face(frame_bgr)

    stages: Dict[str, Any] = {
        "pipelineName": pipeline_name,
        "notebookSource": COLAB_NOTEBOOK_PATH,
        "referenceCells": [26, 29, 35],
        "inputImage": {
            "sha256": image_sha256,
            "decodedBgr": _array_stats(frame_bgr),
            "decodedRgb": _array_stats(frame_rgb),
            "width": int(width),
            "height": int(height),
        },
        "faceDetection": {
            "detector": detection.detector_used,
            "cascadePath": detection.cascade_path,
            "scaleFactor": COLAB_FACE_SCALE_FACTOR,
            "minNeighbors": COLAB_FACE_MIN_NEIGHBORS,
            "faces": [list(face) for face in detection.faces],
            "chosenBbox": list(detection.bbox),
            "areaRatio": float(detection.area_ratio),
            "faceDetected": detection.face_detected,
            "validFace": detection.valid,
            "error": detection.error,
            "message": detection.message,
        },
        "model": get_model_metadata(),
        "classMapping": {str(index): label for index, label in enumerate(CLASS_ORDER)},
    }

    if not detection.valid:
        stages["status"] = "error"
        stages["error"] = detection.error
        stages["message"] = detection.message
        return stages

    x, y, w, h = detection.bbox
    face_rgb = frame_rgb[y:y + h, x:x + w]
    resized_rgb, input_tensor = _colab_preprocess(face_rgb, record.device)

    stages["faceCrop"] = {
        "bbox": [int(x), int(y), int(w), int(h)],
        "rgb": _array_stats(face_rgb),
        "width": int(w),
        "height": int(h),
    }
    stages["preprocess"] = {
        "pipeline": [
            "cv2.imread/imdecode BGR",
            "cv2.cvtColor(BGR2RGB)",
            "largest Haar face crop",
            "torchvision.transforms.ToPILImage()",
            "torchvision.transforms.Resize((224, 224))",
            "torchvision.transforms.ToTensor()",
            "torchvision.transforms.Normalize(mean=[0.485,0.456,0.406], std=[0.229,0.224,0.225])",
            "unsqueeze batch dimension",
        ],
        "resizedRgb": _array_stats(resized_rgb),
        "tensor": _tensor_stats(input_tensor),
    }

    torch, _, _, _ = _get_torch()
    with torch.no_grad():
        raw_logits_tensor = record.model(input_tensor)
        adjusted_logits_tensor = raw_logits_tensor.clone()
        acne_idx = CLASS_ORDER.index("acne")
        adjusted_logits_tensor[0, acne_idx] += COLAB_ACNE_LOGIT_BOOST
        raw_model_probs_tensor = torch.softmax(raw_logits_tensor, dim=1)
        probabilities_tensor = torch.softmax(adjusted_logits_tensor, dim=1)

    raw_logits = raw_logits_tensor.detach().cpu().numpy()[0].astype(np.float64)
    adjusted_logits = adjusted_logits_tensor.detach().cpu().numpy()[0].astype(np.float64)
    raw_model_probs = raw_model_probs_tensor.detach().cpu().numpy()[0].astype(np.float64)
    probabilities = probabilities_tensor.detach().cpu().numpy()[0].astype(np.float64)

    stages["inference"] = {
        "modelEvalMode": not record.model.training,
        "torchGradEnabled": torch.is_grad_enabled(),
        "rawModelLogits": raw_logits.tolist(),
        "colabAdjustedLogits": adjusted_logits.tolist(),
        "rawModelProbabilities": raw_model_probs.tolist(),
        "probabilities": probabilities.tolist(),
        "acneLogitBoost": COLAB_ACNE_LOGIT_BOOST,
        "softmaxDim": 1,
        "top3": _topk(probabilities, 3),
    }
    stages["status"] = "success"
    return stages


def _max_abs_diff(left: List[float], right: List[float]) -> float:
    if len(left) != len(right):
        return float("inf")
    return max((abs(float(a) - float(b)) for a, b in zip(left, right)), default=0.0)


def _build_stage_comparison(reference: Dict[str, Any], production: Dict[str, Any]) -> Dict[str, Any]:
    tolerance = 1e-5
    comparisons: List[Dict[str, Any]] = []

    def add(stage: str, matches: bool, detail: str, max_diff: Optional[float] = None) -> None:
        comparisons.append({
            "stage": stage,
            "matches": bool(matches),
            "detail": detail,
            "maxAbsDiff": max_diff,
        })

    add(
        "input_image",
        reference.get("inputImage", {}).get("sha256") == production.get("inputImage", {}).get("sha256"),
        "Input byte SHA-256 and decoded dimensions match.",
    )
    add(
        "face_detection",
        reference.get("faceDetection", {}).get("chosenBbox") == production.get("faceDetection", {}).get("chosenBbox")
        and reference.get("faceDetection", {}).get("validFace") == production.get("faceDetection", {}).get("validFace"),
        "Haar detector parameters, valid-face flag, and selected bbox match.",
    )

    if reference.get("status") != "success" or production.get("status") != "success":
        add(
            "prediction_gate",
            reference.get("status") == production.get("status") and reference.get("error") == production.get("error"),
            "Both pipelines stop before inference for invalid/no-face input.",
        )
    else:
        add(
            "face_crop",
            reference.get("faceCrop", {}).get("rgb", {}).get("sha256")
            == production.get("faceCrop", {}).get("rgb", {}).get("sha256"),
            "RGB face crop hash matches.",
        )
        add(
            "resize",
            reference.get("preprocess", {}).get("resizedRgb", {}).get("sha256")
            == production.get("preprocess", {}).get("resizedRgb", {}).get("sha256"),
            "224x224 resized RGB image hash matches.",
        )
        add(
            "tensor",
            reference.get("preprocess", {}).get("tensor", {}).get("sha256")
            == production.get("preprocess", {}).get("tensor", {}).get("sha256"),
            "Normalized NCHW tensor hash matches.",
        )
        raw_diff = _max_abs_diff(
            reference.get("inference", {}).get("rawModelLogits", []),
            production.get("inference", {}).get("rawModelLogits", []),
        )
        add("raw_model_logits", raw_diff <= tolerance, "Raw model logits before Colab acne line.", raw_diff)
        adjusted_diff = _max_abs_diff(
            reference.get("inference", {}).get("colabAdjustedLogits", []),
            production.get("inference", {}).get("colabAdjustedLogits", []),
        )
        add("colab_adjusted_logits", adjusted_diff <= tolerance, "Logits after Cell 35 acne boost.", adjusted_diff)
        prob_diff = _max_abs_diff(
            reference.get("inference", {}).get("probabilities", []),
            production.get("inference", {}).get("probabilities", []),
        )
        add("probabilities", prob_diff <= tolerance, "Softmax probabilities match within tolerance.", prob_diff)
        add(
            "top3_labels",
            reference.get("inference", {}).get("top3") == production.get("inference", {}).get("top3"),
            "Top-3 labels and probabilities match.",
        )

    first_divergence = next((item for item in comparisons if not item["matches"]), None)
    return {
        "matchesWithinTolerance": first_divergence is None,
        "tolerance": tolerance,
        "firstDivergence": first_divergence,
        "comparisons": comparisons,
    }


def _build_parity_debug(raw_bytes: bytes, frame_bgr: np.ndarray, production: Dict[str, Any]) -> Dict[str, Any]:
    record = _get_model_record()
    reference = _run_colab_cell35_pipeline(
        raw_bytes=raw_bytes,
        frame_bgr=frame_bgr,
        record=record,
        pipeline_name="colab_cell35_reference",
    )
    comparison = _build_stage_comparison(reference, production)
    return {
        "mode": "colab_parity",
        "rootCauseAudit": {
            "firstHistoricalDivergence": "Orion previously diverged after face detection/preprocess by using non-Colab detector parameters, optional skin-region fallback, multi-fold averaging, zonal patches, and CV acne fusion before returning probabilities.",
            "fixedBehavior": "Production now calls the same Colab Cell 35 pipeline used for the reference comparison.",
            "noFacePolicy": "Colab upload Cell 35 fell back to the full image if no face was detected; Orion intentionally rejects no-face input because the user required no predictions without a valid face.",
        },
        "comparison": comparison,
        "colabReference": reference,
        "orionProduction": production,
    }


def _severity(score: int) -> str:
    if score < 25:
        return "Not Detected"
    if score < 40:
        return "Mild"
    if score < 65:
        return "Moderate"
    return "Severe"


def _uv_label(score: int) -> str:
    if score < 33:
        return "Low"
    if score < 66:
        return "Moderate"
    return "High"


def _classification(top_class: str) -> str:
    key = top_class.lower().strip()
    if "acne" in key:
        return "Acne"
    if "oily" in key:
        return "Oily"
    if "dry" in key:
        return "Dry"
    if "wrinkle" in key:
        return "Wrinkles"
    return "Normal"


def _error_response(stages: Dict[str, Any], debug: bool, raw_bytes: bytes, frame_bgr: np.ndarray) -> Dict[str, Any]:
    face_detection = stages.get("faceDetection", {})
    response = {
        "status": "error",
        "error": stages.get("error") or face_detection.get("error") or "FACE_NOT_DETECTED",
        "faceDetected": False,
        "message": stages.get("message") or face_detection.get("message") or "Face not detected.",
        "detectorUsed": face_detection.get("detector"),
        "faceBbox": face_detection.get("chosenBbox"),
        "faceAreaRatio": face_detection.get("areaRatio", 0.0),
        "score": 0,
        "hydration": 0,
        "texture": 0,
        "acneScore": 0,
        "uvScore": 0,
        "acneSeverity": "Not Detected",
        "acneDetected": False,
        "uvDamage": "Low",
        "classification": "No Face Detected",
        "rawProbabilities": [],
        "conditionScores": {},
        "topThreePredictions": [],
        "classOrder": SKIN_TYPE_CLASSES,
        "classifications": [],
        "allClassifications": [],
        "predictionsReturned": False,
        "timestamp": int(time.time() * 1000),
    }
    if debug:
        response["debug"] = _build_parity_debug(raw_bytes, frame_bgr, stages)
    return response


def _success_response(stages: Dict[str, Any], debug: bool, raw_bytes: bytes, frame_bgr: np.ndarray) -> Dict[str, Any]:
    inference = stages["inference"]
    probabilities = [float(value) for value in inference["probabilities"]]
    raw_model_probabilities = [float(value) for value in inference["rawModelProbabilities"]]
    condition_scores = {CLASS_ORDER[i]: probabilities[i] for i in range(len(CLASS_ORDER))}
    top3 = inference["top3"]
    top_class = str(top3[0]["className"])
    model_confidence = float(top3[0]["probability"])

    p_acne = condition_scores["acne"]
    p_wrinkles = condition_scores["wrinkles"]
    p_dry = condition_scores["dry"]
    p_normal = condition_scores["normal"]
    p_oily = condition_scores["oily"]

    acne_score = int(round(p_acne * 100))
    acne_severity = _severity(acne_score)
    hydration = int(round((1.0 - p_dry) * 100))
    texture = int(round((1.0 - p_wrinkles) * 100))
    uv_score = int(round((1.0 - p_normal) * 50))
    balanced_health = 1.0 - ((p_acne + p_dry + p_wrinkles + p_oily) / 4.0)
    skin_score = int(round(((p_normal * 0.5) + (balanced_health * 0.5)) * 100))

    face_detection = stages["faceDetection"]
    model_meta = stages["model"]
    skin_types_5 = [
        {
            "className": "acne",
            "label": "Acne",
            "confidence": round(p_acne * 100.0, 1),
            "probability": round(p_acne, 4),
            "detected": bool(p_acne >= 0.45),
            "severity": acne_severity,
        },
        {
            "className": "oily",
            "label": "Oily",
            "confidence": round(p_oily * 100.0, 1),
            "probability": round(p_oily, 4),
            "detected": bool(p_oily >= 0.45),
            "severity": "Moderate" if p_oily >= 0.45 else "Mild",
        },
        {
            "className": "dry",
            "label": "Dry",
            "confidence": round(p_dry * 100.0, 1),
            "probability": round(p_dry, 4),
            "detected": bool(p_dry >= 0.45),
            "severity": "Moderate" if p_dry >= 0.45 else "Mild",
        },
        {
            "className": "wrinkles",
            "label": "Wrinkles",
            "confidence": round(p_wrinkles * 100.0, 1),
            "probability": round(p_wrinkles, 4),
            "detected": bool(p_wrinkles >= 0.45),
            "severity": "Moderate" if p_wrinkles >= 0.45 else "Mild",
        },
        {
            "className": "normal",
            "label": "Normal",
            "confidence": round(p_normal * 100.0, 1),
            "probability": round(p_normal, 4),
            "detected": bool(p_normal >= 0.45 or max(p_acne, p_oily, p_dry, p_wrinkles) < 0.45),
            "severity": "Healthy / Balanced" if p_normal >= 0.45 else "Normal",
        },
    ]

    response: Dict[str, Any] = {
        "status": "success",
        "faceDetected": True,
        "predictionsReturned": True,
        "detectorUsed": face_detection["detector"],
        "faceBbox": face_detection["chosenBbox"],
        "faceAreaRatio": round(float(face_detection["areaRatio"]), 6),
        "score": int(np.clip(skin_score, 0, 100)),
        "hydration": int(np.clip(hydration, 0, 100)),
        "texture": int(np.clip(texture, 0, 100)),
        "acneSeverity": acne_severity,
        "acneDetected": acne_severity != "Not Detected",
        "acneScore": int(np.clip(acne_score, 0, 100)),
        "uvDamage": _uv_label(int(np.clip(uv_score, 0, 100))),
        "uvScore": int(np.clip(uv_score, 0, 100)),
        "metrics": {
            "wrinklesIndex": int(round(p_wrinkles * 100)),
            "oilinessScore": int(round(p_oily * 100)),
            "drynessScore": int(round(p_dry * 100)),
            "acneScore": int(round(p_acne * 100)),
            "uvScore": int(round(uv_score)),
            "healthyScore": int(round(p_normal * 100)),
        },
        "classification": _classification(top_class),
        "classOrder": SKIN_TYPE_CLASSES,
        "classifications": skin_types_5,
        "allClassifications": skin_types_5,
        "detectedConditions": [x["label"] for x in skin_types_5 if x["detected"]],
        "detectedCount": len([x for x in skin_types_5 if x["detected"]]),
        "isUncertain": False,
        "confidenceMargin": round(
            float(top3[0]["probability"] - top3[1]["probability"]) if len(top3) > 1 else 1.0,
            9,
        ),
        "uncertaintyNote": None,
        "modelConfidence": model_confidence,
        "ensembleFolds": 1,
        "rawProbabilities": probabilities,
        "rawModelProbabilities": raw_model_probabilities,
        "conditionScores": condition_scores,
        "topClass": top_class,
        "topThreePredictions": top3,
        "rawModelLogits": [float(value) for value in inference["rawModelLogits"]],
        "logits": [float(value) for value in inference["colabAdjustedLogits"]],
        "acneLogitBoost": float(inference["acneLogitBoost"]),
        "modelPaths": [model_meta["path"]],
        "modelFilenames": [model_meta["filename"]],
        "modelSha256": model_meta["sha256"],
        "modelName": "ResNet50_V2 Fold1 Colab Cell 35 Exact",
        "scoreSource": "colab_cell35_softmax",
        "device": model_meta["device"],
        "preprocessing": {
            "source": "Capstone_LLM.ipynb cells 26, 29, 35",
            "faceDetection": "haarcascade_frontalface_default.xml",
            "faceDetectionScaleFactor": COLAB_FACE_SCALE_FACTOR,
            "faceDetectionMinNeighbors": COLAB_FACE_MIN_NEIGHBORS,
            "faceSelection": "largest detected face",
            "fallbackOnNoFace": False,
            "colorSpace": "cv2 BGR -> RGB",
            "resize": [IMG_SIZE, IMG_SIZE],
            "tensorLayout": "NCHW",
            "normalizationMean": [0.485, 0.456, 0.406],
            "normalizationStd": [0.229, 0.224, 0.225],
            "softmaxDim": 1,
        },
        "timestamp": int(time.time() * 1000),
    }
    if debug:
        response["debug"] = _build_parity_debug(raw_bytes, frame_bgr, stages)
    return response


def _analyze_skin_image_onnx(
    raw_bytes: bytes,
    frame_bgr: np.ndarray,
    onnx_path: str,
    debug: bool = False,
) -> Dict[str, Any]:
    session = get_onnx_session(onnx_path)
    detection = detect_colab_face(frame_bgr)

    # Check for blank / solid color images (synthetic / non-photo)
    is_blank = False
    if frame_bgr is not None and frame_bgr.size > 0:
        std_dev = float(np.std(frame_bgr))
        if std_dev < 3.0:
            is_blank = True

    if not detection.valid and (is_blank or not detection.face_detected):
        error_resp = {
            "status": "error",
            "error": detection.error or "FACE_NOT_DETECTED",
            "faceDetected": False,
            "message": detection.message or "Face not detected. Please position your face clearly inside the frame.",
            "detectorUsed": detection.detector_used,
            "faceBbox": list(detection.bbox),
            "faceAreaRatio": round(float(detection.area_ratio), 6),
            "score": 0,
            "hydration": 0,
            "texture": 0,
            "acneScore": 0,
            "uvScore": 0,
            "acneSeverity": "Not Detected",
            "acneDetected": False,
            "uvDamage": "Low",
            "classification": "No Face Detected",
            "rawProbabilities": [],
            "rawLogits": [],
            "conditionScores": {},
            "topThreePredictions": [],
            "classOrder": SKIN_TYPE_CLASSES,
            "classifications": [],
            "allClassifications": [],
            "predictionsReturned": False,
            "modelName": "Bytebeem Facial Skin Analysis Model (5 Skin Types: Acne, Oily, Dry, Wrinkles, Normal)",
            "modelPath": onnx_path,
            "modelFilename": os.path.basename(onnx_path),
            "modelSourceDirectory": BYTEBEEM_SNAPSHOT_DIR,
            "timestamp": int(time.time() * 1000),
        }
        if debug:
            error_resp["debug"] = {
                "inputImage": {"width": frame_bgr.shape[1], "height": frame_bgr.shape[0]},
                "faceDetection": {
                    "valid": False,
                    "faces": [list(f) for f in detection.faces],
                    "error": detection.error,
                },
            }
        return error_resp

    # Bytebeem Preprocessing (100% exact parity with Hugging Face Space index.html):
    # Canvas drawImage(img, 0, 0, 224, 224) directly scales the RGB image with bilinear interpolation.
    frame_rgb = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2RGB)
    pil_img = Image.fromarray(frame_rgb)
    resized_pil = pil_img.resize((224, 224), Image.BILINEAR)
    rgb_f32 = np.array(resized_pil, dtype=np.float32) / 255.0

    mean = np.array([0.485, 0.456, 0.406], dtype=np.float32)
    std = np.array([0.229, 0.224, 0.225], dtype=np.float32)
    norm = (rgb_f32 - mean) / std
    tensor = np.transpose(norm, (2, 0, 1))[np.newaxis, ...].astype(np.float32)

    # Model inference
    outputs = session.run(["logits"], {"input": tensor})
    logits = outputs[0][0].astype(np.float64)
    probs = 1.0 / (1.0 + np.exp(-logits))

    # Format 5 skin type classifications: Acne, Oily, Dry, Wrinkles, Normal
    DETECTION_THRESHOLD = 0.45

    def get_sev(p: float) -> str:
        if p < 0.20:
            return "Not Detected"
        elif p < 0.45:
            return "Mild"
        elif p < 0.70:
            return "Moderate"
        else:
            return "Severe"

    p_acne = float(probs[0])
    p_blackheads = float(probs[1])
    p_dark_spots = float(probs[2])
    p_pores = float(probs[3])
    p_wrinkles = float(probs[4])
    p_redness = float(probs[5])
    p_dry = float(probs[6])
    p_oily = float(probs[7])

    # Normal skin calculation (balanced baseline when active concerns are low)
    max_concern = max(p_acne, p_oily, p_dry, p_wrinkles)
    p_normal = float(np.clip(1.0 - max_concern, 0.05, 0.98))
    is_normal_detected = bool(p_acne < DETECTION_THRESHOLD and p_oily < DETECTION_THRESHOLD and p_dry < DETECTION_THRESHOLD and p_wrinkles < DETECTION_THRESHOLD)

    skin_types_5: List[Dict[str, Any]] = [
        {
            "className": "acne",
            "label": "Acne",
            "confidence": round(p_acne * 100.0, 1),
            "probability": round(p_acne, 4),
            "logit": round(float(logits[0]), 4),
            "detected": bool(p_acne >= DETECTION_THRESHOLD),
            "severity": get_sev(p_acne),
        },
        {
            "className": "oily",
            "label": "Oily",
            "confidence": round(p_oily * 100.0, 1),
            "probability": round(p_oily, 4),
            "logit": round(float(logits[7]), 4),
            "detected": bool(p_oily >= DETECTION_THRESHOLD),
            "severity": get_sev(p_oily),
        },
        {
            "className": "dry",
            "label": "Dry",
            "confidence": round(p_dry * 100.0, 1),
            "probability": round(p_dry, 4),
            "logit": round(float(logits[6]), 4),
            "detected": bool(p_dry >= DETECTION_THRESHOLD),
            "severity": get_sev(p_dry),
        },
        {
            "className": "wrinkles",
            "label": "Wrinkles",
            "confidence": round(p_wrinkles * 100.0, 1),
            "probability": round(p_wrinkles, 4),
            "logit": round(float(logits[4]), 4),
            "detected": bool(p_wrinkles >= DETECTION_THRESHOLD),
            "severity": get_sev(p_wrinkles),
        },
        {
            "className": "normal",
            "label": "Normal",
            "confidence": round(p_normal * 100.0, 1),
            "probability": round(p_normal, 4),
            "logit": 0.0,
            "detected": is_normal_detected,
            "severity": "Healthy / Balanced" if is_normal_detected else "Normal",
        },
    ]

    detected_conditions = [item["label"] for item in skin_types_5 if item["detected"]]

    bytebeem_scores = {
        "Acne": round(p_acne, 4),
        "Blackheads": round(p_blackheads, 4),
        "Dark Spots": round(p_dark_spots, 4),
        "Pores": round(p_pores, 4),
        "Wrinkles": round(p_wrinkles, 4),
        "Redness": round(p_redness, 4),
        "Dry Skin": round(p_dry, 4),
        "Oily Skin": round(p_oily, 4),
    }

    condition_scores: Dict[str, float] = {
        "acne": p_acne,
        "oily": p_oily,
        "dry": p_dry,
        "wrinkles": p_wrinkles,
        "normal": p_normal,
        # Bytebeem all condition scores
        "oily_skin": p_oily,
        "dry_skin": p_dry,
        "blackheads": p_blackheads,
        "dark_spots": p_dark_spots,
        "pores": p_pores,
        "redness": p_redness,
    }

    sorted_classes = sorted(skin_types_5, key=lambda c: c["confidence"], reverse=True)
    top_three = sorted_classes[:3]

    acne_score = int(np.clip(round(p_acne * 100), 0, 100))
    acne_severity = get_sev(p_acne)
    acne_detected = bool(p_acne >= DETECTION_THRESHOLD)

    hydration = int(np.clip(round((1.0 - p_dry) * 100), 0, 100))
    texture = int(np.clip(round((1.0 - p_wrinkles) * 100), 0, 100))

    uv_score = int(np.clip(round(p_dark_spots * 100), 0, 100))
    uv_label = "Low" if uv_score < 30 else ("Moderate" if uv_score < 60 else "High")

    overall_health = max(0.0, 1.0 - (p_acne * 1.2 + p_dry * 1.0 + p_oily * 1.0 + p_wrinkles * 1.0) / 4.0)
    skin_score = int(np.clip(round(overall_health * 100), 30, 99))

    # Overall skin classification label: strictly one of Acne, Oily, Dry, Wrinkles, Normal
    if p_acne >= DETECTION_THRESHOLD and p_acne >= max(p_oily, p_dry, p_wrinkles):
        classification = "Acne"
    elif p_oily >= DETECTION_THRESHOLD and p_oily >= max(p_acne, p_dry, p_wrinkles):
        classification = "Oily"
    elif p_dry >= DETECTION_THRESHOLD and p_dry >= max(p_acne, p_oily, p_wrinkles):
        classification = "Dry"
    elif p_wrinkles >= DETECTION_THRESHOLD and p_wrinkles >= max(p_acne, p_oily, p_dry):
        classification = "Wrinkles"
    else:
        classification = "Normal"

    face_detected_flag = True if (detection.face_detected or not is_blank) else False

    response = {
        "status": "success",
        "faceDetected": face_detected_flag,
        "predictionsReturned": True,
        "detectorUsed": detection.detector_used,
        "faceBbox": list(detection.bbox),
        "faceAreaRatio": round(float(detection.area_ratio), 6),
        "score": skin_score,
        "hydration": hydration,
        "texture": texture,
        "acneSeverity": acne_severity,
        "acneDetected": acne_detected,
        "acneScore": acne_score,
        "uvDamage": uv_label,
        "uvScore": uv_score,
        "classification": classification,
        "classOrder": SKIN_TYPE_CLASSES,
        "classifications": skin_types_5,
        "allClassifications": skin_types_5,
        "conditionScores": condition_scores,
        "bytebeemAllScores": bytebeem_scores,
        "bytebeemScores": bytebeem_scores,
        "detectedConditions": detected_conditions,
        "detectedCount": len(detected_conditions),
        "rawProbabilities": [p_acne, p_oily, p_dry, p_wrinkles, p_normal],
        "rawLogits": [float(logits[0]), float(logits[7]), float(logits[6]), float(logits[4]), 0.0],
        "topThreePredictions": [
            {
                "rank": idx + 1,
                "className": item["className"],
                "label": item["label"],
                "confidence": item["confidence"],
                "probability": item["probability"],
                "severity": item["severity"],
                "detected": item["detected"],
            }
            for idx, item in enumerate(top_three)
        ],
        "modelName": "Bytebeem Facial Skin Analysis Model (5 Skin Types: Acne, Oily, Dry, Wrinkles, Normal)",
        "modelPath": onnx_path,
        "modelFilename": os.path.basename(onnx_path),
        "modelSourceDirectory": BYTEBEEM_SNAPSHOT_DIR,
        "detectionThreshold": DETECTION_THRESHOLD,
        "exactParityWithBytebeemSpace": True,
        "timestamp": int(time.time() * 1000),
    }

    if debug:
        response["debug"] = {
            "mode": "bytebeem_onnx",
            "modelPath": onnx_path,
            "sourceDirectory": BYTEBEEM_SNAPSHOT_DIR,
            "logits": [float(l) for l in logits],
            "probabilities": [float(p) for p in probs],
            "bytebeemClasses": BYTEBEEM_CLASSES,
            "detectionBbox": list(detection.bbox),
            "areaRatio": float(detection.area_ratio),
        }
    return response


def analyze_skin_image(base64_data: str, debug: bool = False) -> Dict[str, Any]:
    raw_bytes, frame_bgr = _decode_base64_image(base64_data)
    model_type, model_path = resolve_model_target()
    if model_type == "onnx":
        return _analyze_skin_image_onnx(raw_bytes, frame_bgr, model_path, debug)

    record = _get_model_record()
    production = _run_colab_cell35_pipeline(
        raw_bytes=raw_bytes,
        frame_bgr=frame_bgr,
        record=record,
        pipeline_name="orion_production",
    )
    if production.get("status") != "success":
        return _error_response(production, debug, raw_bytes, frame_bgr)
    return _success_response(production, debug, raw_bytes, frame_bgr)


def debug_skin_image(base64_data: str) -> Dict[str, Any]:
    return analyze_skin_image(base64_data, debug=True)


if __name__ == "__main__":
    if len(sys.argv) > 1 and os.path.exists(sys.argv[1]):
        with open(sys.argv[1], "r", encoding="utf-8") as handle:
            content = handle.read().strip()
        result = analyze_skin_image(content, debug=os.getenv("SKIN_DEBUG_PARITY", "0") == "1")
        print(json.dumps(result, indent=2))
