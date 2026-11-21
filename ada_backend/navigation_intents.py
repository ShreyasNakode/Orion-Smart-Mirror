import json
import re
import time
from pathlib import Path

ROUTES_FILE = Path(__file__).resolve().parents[1] / "dashboard_routes.json"
NAVIGATION_PREFIXES = [
    "go to",
    "go",
    "open",
    "show",
    "show me",
    "take me to",
    "take me",
    "switch to",
    "navigate to",
    "bring up",
    "pull up",
    "launch",
    "display",
    "view",
]
TARGET_SUFFIXES = ["screen", "dashboard", "page", "module", "tab", "view", "section"]
OPTIONAL_FILLERS = ["the", "my", "orion"]
TRAILING_WORDS = ["please", "now", "for me"]

def _load_routes():
    try:
        with ROUTES_FILE.open("r", encoding="utf-8") as f:
            data = json.load(f)
        return data.get("routes", [])
    except Exception as exc:
        print(f"[NAV] Failed to load dashboard routes: {exc}")
        return []

DASHBOARD_ROUTES = _load_routes()

def normalize_voice_text(value):
    text = str(value or "").lower()
    text = text.replace("'", "").replace("?", "")
    text = re.sub(r"[^a-z0-9]+", " ", text)
    return re.sub(r"\s+", " ", text).strip()

def _route_aliases(route):
    aliases = [route.get("label", ""), route.get("id", "").replace("_", " ")]
    aliases.extend(route.get("aliases") or [])
    seen = []
    for alias in aliases:
        normalized = normalize_voice_text(alias)
        if normalized and normalized not in seen:
            seen.append(normalized)
    return seen

def resolve_dashboard_route(value):
    normalized = normalize_voice_text(value)
    if not normalized:
        return None

    for route in DASHBOARD_ROUTES:
        route_id = route.get("id")
        if value == route_id or normalize_voice_text(route_id) == normalized:
            return {"view": route_id, "label": route.get("label", route_id), "matched_alias": normalized}

    for route in DASHBOARD_ROUTES:
        if normalized in _route_aliases(route):
            route_id = route.get("id")
            return {"view": route_id, "label": route.get("label", route_id), "matched_alias": normalized}
    return None

_SUFFIX_PATTERN = r"(?:\s+(?:" + "|".join(re.escape(s) for s in TARGET_SUFFIXES) + r"))*"
_FILLER_PATTERN = r"(?:(?:" + "|".join(re.escape(f) for f in OPTIONAL_FILLERS) + r")\s+)*"
_PREFIX_PATTERN = r"(?:" + "|".join(re.escape(normalize_voice_text(prefix)) for prefix in NAVIGATION_PREFIXES) + r")"
_TRAILING_PATTERN = r"(?:\s+(?:" + "|".join(re.escape(t) for t in TRAILING_WORDS) + r"))*"

def detect_dashboard_navigation(text):
    normalized = normalize_voice_text(text)
    if not normalized:
        return None

    candidates = []
    for route in DASHBOARD_ROUTES:
        for alias in _route_aliases(route):
            candidates.append((route, alias))
    candidates.sort(key=lambda item: len(item[1]), reverse=True)

    for route, alias in candidates:
        target = re.escape(alias)
        commanded = re.compile(rf"(?:^|\b){_PREFIX_PATTERN}\s+{_FILLER_PATTERN}{target}{_SUFFIX_PATTERN}{_TRAILING_PATTERN}(?:\b|$)")
        if commanded.search(normalized):
            route_id = route.get("id")
            return {
                "view": route_id,
                "label": route.get("label", route_id),
                "matched_alias": alias,
                "confidence": 0.96,
                "timestamp": time.time(),
            }

        bare = re.compile(rf"^{_FILLER_PATTERN}{target}{_SUFFIX_PATTERN}{_TRAILING_PATTERN}$")
        if len(normalized) <= len(alias) + 16 and bare.search(normalized):
            route_id = route.get("id")
            return {
                "view": route_id,
                "label": route.get("label", route_id),
                "matched_alias": alias,
                "confidence": 0.82,
                "timestamp": time.time(),
            }

    return None
