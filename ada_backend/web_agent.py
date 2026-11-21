import os
import time
import asyncio
import base64
import json
import traceback
import urllib.parse
from pathlib import Path

from dotenv import load_dotenv
from playwright.async_api import async_playwright, TimeoutError as PlaywrightTimeoutError
from google import genai
from google.genai import types

load_dotenv()
load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env.local"), override=True)
API_KEY = os.getenv("GEMINI_API_KEY")

# Direct Playwright browser cache & temp files to E: drive workspace to prevent C: drive disk space bottlenecks
PW_CACHE_DIR = (Path(__file__).parent / ".playwright_browsers").resolve()
PW_TMP_DIR = (Path(__file__).parent.parent / ".tmp").resolve()
PW_CACHE_DIR.mkdir(parents=True, exist_ok=True)
PW_TMP_DIR.mkdir(parents=True, exist_ok=True)

os.environ["PLAYWRIGHT_BROWSERS_PATH"] = str(PW_CACHE_DIR)
os.environ["TEMP"] = str(PW_TMP_DIR)
os.environ["TMP"] = str(PW_TMP_DIR)
os.environ["TMPDIR"] = str(PW_TMP_DIR)

SCREEN_WIDTH = int(os.getenv("ORION_WEB_AGENT_WIDTH", "1440"))
SCREEN_HEIGHT = int(os.getenv("ORION_WEB_AGENT_HEIGHT", "900"))
_configured_model = os.getenv("ORION_WEB_AGENT_MODEL")
_default_models = ["gemini-2.5-computer-use-preview-10-2025", "gemini-2.0-flash"]
WEB_AGENT_MODEL_CANDIDATES = [m.strip() for m in (_configured_model.split(",") if _configured_model else _default_models) if m.strip()]
MODEL_ID = WEB_AGENT_MODEL_CANDIDATES[0]
MAX_TURNS = int(os.getenv("ORION_WEB_AGENT_MAX_TURNS", "20"))
ACTION_TIMEOUT_MS = int(os.getenv("ORION_WEB_AGENT_ACTION_TIMEOUT_MS", "4000"))
NAVIGATION_TIMEOUT_MS = int(os.getenv("ORION_WEB_AGENT_NAVIGATION_TIMEOUT_MS", "9000"))
ACTION_SETTLE_TIMEOUT_MS = int(os.getenv("ORION_WEB_AGENT_SETTLE_TIMEOUT_MS", "800"))
MODEL_TIMEOUT_SECONDS = float(os.getenv("ORION_WEB_AGENT_MODEL_TIMEOUT_SECONDS", "30"))
STREAM_INTERVAL_SECONDS = float(os.getenv("ORION_WEB_AGENT_STREAM_INTERVAL_SECONDS", "0.08"))
HEADLESS = os.getenv("ORION_WEB_AGENT_HEADLESS", "0").lower() in {"1", "true", "yes"}
PROFILE_DIR = Path(os.getenv("ORION_WEB_AGENT_PROFILE_DIR", str(Path(__file__).with_name(".orion_browser_profile"))))
DEFAULT_START_URL = os.getenv("ORION_WEB_AGENT_START_URL", "https://www.google.com")

SYSTEM_INSTRUCTION = """
## RULE 1: Seek User Confirmation (USER_CONFIRMATION)

This is your first and most important check. If the next required action falls
into any of the following categories, you MUST stop immediately, and seek the
user's explicit permission.

Procedure for seeking confirmation:
* For consequential actions: Perform all preparatory steps, then ask for
  confirmation BEFORE the final irreversible action, such as Send, Submit,
  Confirm Purchase, or Share.
* For prohibited actions: If the action is forbidden or requires human control,
  ask the user to take over.

USER_CONFIRMATION categories:
* Consent and agreements: Terms of Service, privacy policies, cookie consent,
  EULAs, or other legally significant agreements.
* Robot detection: CAPTCHAs and other anti-robot or human verification checks.
* Financial transactions: purchases, transfers, payments, regulated goods, or gambling.
* Sending communications: emails, messages, posts, or comments.
* Accessing or modifying sensitive information.
* User data management: downloading, saving, sharing, or transferring files/data.
* Browser data usage: Chrome history, bookmarks, autofill, or saved passwords.
* Security and identity: logging into accounts or impersonation.
* Insurmountable obstacles: If stuck, ask the user to take over.

## RULE 2: Default Behavior (ACTUATE)
If an action does NOT fall under USER_CONFIRMATION, act immediately and keep
moving until the non-consequential task is complete or a confirmation condition
is encountered. Prefer direct navigation, concise steps, and reliable actions.
"""


class WebAgent:
    def __init__(self):
        self.client = genai.Client(api_key=API_KEY)
        self.playwright = None
        self.browser = None
        self.context = None
        self.page = None
        self.remote_executor = None
        self.remote_cancel_executor = None
        self.browser_backend = "playwright"
        self.remote_state = {
            "url": DEFAULT_START_URL,
            "title": "Browser",
            "width": SCREEN_WIDTH,
            "height": SCREEN_HEIGHT,
        }
        self.contents = []
        self.pending_yield_call_id = None
        self.pending_yield_name = None
        self._task_lock = asyncio.Lock()
        self._active_run_task = None
        self._cancel_requested = False
        self._cancel_reason = ""
        self._last_update_at = 0.0
        self._last_screenshot_at = 0.0
        self._interaction_model = None
        self._run_started_at = None
        self._first_action_at = None
        self._stream_task = None
        self._active_update_callback = None
        self._update_callback_ref = None
        self._cursor_pos = {"x": 720, "y": 450, "clicking": False}

    def set_remote_executor(self, executor, cancel_executor=None):
        self.remote_executor = executor
        self.remote_cancel_executor = cancel_executor
        print("[WEB] Orion live webview executor registered.")

    def _profile(self, stage, **details):
        if not self._run_started_at:
            return
        elapsed_ms = int((time.perf_counter() - self._run_started_at) * 1000)
        suffix = " ".join(f"{key}={value}" for key, value in details.items() if value is not None)
        print(f"[WEB PROFILE] {stage} +{elapsed_ms}ms {suffix}".rstrip())

    def _update_remote_state(self, state):
        if not isinstance(state, dict):
            return
        url = state.get("url") or state.get("website")
        title = state.get("title") or state.get("activeTab")
        if url:
            self.remote_state["url"] = url
        if title:
            self.remote_state["title"] = title
        if state.get("width"):
            self.remote_state["width"] = state.get("width")
        if state.get("height"):
            self.remote_state["height"] = state.get("height")

    def request_cancel(self, reason="user interruption"):
        self._cancel_requested = True
        self._cancel_reason = reason
        try:
            current_task = asyncio.current_task()
        except RuntimeError:
            current_task = None

        if self._active_run_task and not self._active_run_task.done() and self._active_run_task is not current_task:
            print(f"[WEB] Preempting active browser task: {reason}")
            self._active_run_task.cancel()
        if self.remote_cancel_executor:
            try:
                loop = asyncio.get_running_loop()
                loop.create_task(self.remote_cancel_executor(reason))
            except RuntimeError:
                pass

    def _raise_if_cancelled(self):
        if self._cancel_requested:
            raise asyncio.CancelledError(self._cancel_reason or "browser task cancelled")

    async def init_browser(self):
        if self.remote_executor:
            try:
                state = await self.remote_executor({"action": "ensure", "args": {"url": DEFAULT_START_URL}}, timeout=6.0)
                self.browser_backend = "orion_webview"
                self._update_remote_state(state)
                return
            except Exception as e:
                print(f"[WEB] Remote webview unavailable; falling back to Playwright: {e}")

        self.browser_backend = "playwright"
        if not self.playwright:
            self.playwright = await async_playwright().start()

        if self.context and self.page and not self.page.is_closed():
            return

        PROFILE_DIR.mkdir(parents=True, exist_ok=True)
        channels = ["chrome", "msedge", None]
        launched = False

        for ch in channels:
            try:
                launch_kwargs = {
                    "headless": HEADLESS,
                    "viewport": {"width": SCREEN_WIDTH, "height": SCREEN_HEIGHT},
                    "user_agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                    "args": [
                        "--no-sandbox",
                        "--disable-setuid-sandbox",
                        "--disable-blink-features=AutomationControlled",
                        "--disable-dev-shm-usage",
                        "--disable-background-timer-throttling",
                        "--disable-backgrounding-occluded-windows",
                        "--disable-renderer-backgrounding",
                    ],
                }
                if ch:
                    launch_kwargs["channel"] = ch

                self.context = await self.playwright.chromium.launch_persistent_context(
                    str(PROFILE_DIR),
                    **launch_kwargs
                )
                print(f"[WEB] Playwright persistent context launched successfully with channel='{ch}'!")
                launched = True
                break
            except Exception as e:
                print(f"[WEB] Persistent context launch with channel='{ch}' failed: {e}")

        if not launched:
            print("[WEB] Fallback to non-persistent browser launch...")
            for ch in channels:
                try:
                    launch_kwargs = {"headless": HEADLESS}
                    if ch:
                        launch_kwargs["channel"] = ch
                    self.browser = await self.playwright.chromium.launch(**launch_kwargs)
                    self.context = await self.browser.new_context(viewport={"width": SCREEN_WIDTH, "height": SCREEN_HEIGHT})
                    print(f"[WEB] Non-persistent browser launched successfully with channel='{ch}'!")
                    break
                except Exception as e:
                    print(f"[WEB] Non-persistent launch with channel='{ch}' failed: {e}")

        self.context.set_default_timeout(ACTION_TIMEOUT_MS)
        self.context.set_default_navigation_timeout(NAVIGATION_TIMEOUT_MS)
        open_pages = [p for p in self.context.pages if not p.is_closed()]
        self.page = open_pages[-1] if open_pages else await self.context.new_page()

    async def _recover_playwright(self):
        print("[WEB] Recovering Playwright browser session...")
        try:
            if self.context:
                await self.context.close()
        except Exception:
            pass
        self.context = None
        self.page = None
        await self.init_browser()

    def denormalize_x(self, x: int, width: int = SCREEN_WIDTH) -> int:
        return int((max(0, min(999, int(x))) / 999) * width)

    def denormalize_y(self, y: int, height: int = SCREEN_HEIGHT) -> int:
        return int((max(0, min(999, int(y))) / 999) * height)

    async def execute_manual_action(self, action_data: dict):
        """Execute instant manual click/type/scroll from the UI touchscreen or virtual keyboard."""
        if not self.page or self.page.is_closed():
            print("[WEB] Cannot execute manual action; page is closed.")
            return

        action_type = action_data.get("action", "click")
        print(f"[WEB] Executing manual action '{action_type}': {action_data}")

        try:
            if action_type == "click":
                norm_x = action_data.get("x", 500)
                norm_y = action_data.get("y", 500)
                actual_x = self.denormalize_x(norm_x, SCREEN_WIDTH)
                actual_y = self.denormalize_y(norm_y, SCREEN_HEIGHT)
                self._cursor_pos = {"x": actual_x, "y": actual_y, "clicking": True}
                await self.page.mouse.click(actual_x, actual_y)
                self._cursor_pos["clicking"] = False
            elif action_type == "type" and action_data.get("text"):
                await self.page.keyboard.insert_text(action_data["text"])
            elif action_type == "key" and action_data.get("key"):
                key_name = action_data["key"]
                if key_name == "Backspace":
                    await self.page.keyboard.press("Backspace")
                elif key_name == "Enter":
                    await self.page.keyboard.press("Enter")
                else:
                    await self.page.keyboard.press(key_name)
            elif action_type == "scroll":
                dy = action_data.get("deltaY", 300)
                await self.page.mouse.wheel(0, dy)

            # Broadcast updated screenshot frame after manual action — capture once, emit once.
            if self._update_callback_ref:
                try:
                    screenshot_bytes = await self._screenshot_bytes()
                    image_b64 = base64.b64encode(screenshot_bytes).decode("utf-8")
                    url = await self._url()
                    title = await self._title()
                    state = {
                        "status": "running",
                        "website": url,
                        "liveUrl": url,
                        "activeTab": title,
                        "backend": self.browser_backend,
                        "cursor": self._cursor_pos,
                        "message": "Manual User Action",
                    }
                    await self._update_callback_ref(image_b64, "Manual User Action", state)
                    self._last_update_at = time.perf_counter()
                except Exception as e:
                    print(f"[WEB] Manual action emit failed: {e}")
        except Exception as e:
            print(f"[WEB] Manual action failed: {e}")

    async def _title(self):
        if self.browser_backend == "orion_webview":
            return self.remote_state.get("title") or "Browser"
        try:
            return await asyncio.wait_for(self.page.title(), timeout=1.0)
        except Exception:
            return "Browser"

    async def _url(self):
        if self.browser_backend == "orion_webview":
            return self.remote_state.get("url") or DEFAULT_START_URL
        try:
            return self.page.url
        except Exception:
            return DEFAULT_START_URL

    async def _screenshot_b64(self):
        if self.browser_backend == "orion_webview":
            state = await self.remote_executor({"action": "snapshot", "args": {"includeImage": True}}, timeout=4.0)
            image = state.get("image")
            if not image:
                raise RuntimeError("Live browser returned no image")
            return image

        screenshot_bytes = await self.page.screenshot(type="jpeg", quality=65)
        return base64.b64encode(screenshot_bytes).decode("utf-8")

    async def _screenshot_bytes(self):
        if self.browser_backend == "orion_webview":
            image_b64 = await self._screenshot_b64()
            return base64.b64decode(image_b64)
        return await self.page.screenshot(type="jpeg", quality=65)

    async def _start_stream(self, update_callback):
        self._active_update_callback = update_callback
        if self._stream_task and not self._stream_task.done():
            return

        async def stream_loop():
            while True:
                try:
                    if self._active_update_callback and self.page and not self.page.is_closed():
                        image_b64 = await self._screenshot_b64()
                        url = await self._url()
                        title = await self._title()
                        state = {
                            "status": "running",
                            "website": url,
                            "liveUrl": url,
                            "activeTab": title,
                            "backend": self.browser_backend,
                            "cursor": self._cursor_pos,
                        }
                        await self._active_update_callback(image_b64, "Live Stream", state)
                except asyncio.CancelledError:
                    break
                except Exception:
                    pass
                await asyncio.sleep(STREAM_INTERVAL_SECONDS)

        self._stream_task = asyncio.create_task(stream_loop())

    def _stop_stream(self):
        if self._stream_task and not self._stream_task.done():
            self._stream_task.cancel()
            self._stream_task = None
        self._active_update_callback = None

    async def _emit_update(
        self,
        update_callback,
        log_text,
        status="running",
        action=None,
        target="",
        typed_text="",
        step=0,
        total_steps=MAX_TURNS,
        message=None,
        force=False,
    ):
        if not update_callback:
            return

        # Throttle: skip non-forced emits if we emitted less than 100ms ago to avoid
        # redundant JPEG encodes and socket writes on rapid sequential action steps.
        now = time.perf_counter()
        if not force and (now - self._last_update_at) < 0.10:
            return
        self._last_update_at = now

        image_b64 = None
        try:
            image_b64 = await self._screenshot_b64()
        except Exception as e:
            print(f"[WEB] Screenshot emit skipped: {e}")

        url = await self._url()
        title = await self._title()
        state = {
            "status": status,
            "website": url,
            "liveUrl": url,
            "activeTab": title,
            "action": action,
            "target": target,
            "typedText": typed_text,
            "step": step,
            "totalSteps": total_steps,
            "message": message or log_text,
            "backend": self.browser_backend,
            "cursor": self._cursor_pos,
        }
        await update_callback(image_b64, log_text, state)

    async def _settle_after_action(self, fname):
        if self.browser_backend == "orion_webview":
            return
        try:
            if fname in {"navigate", "go_back", "go_forward", "click", "double_click", "press_key", "hotkey"}:
                await self.page.wait_for_load_state("domcontentloaded", timeout=ACTION_SETTLE_TIMEOUT_MS)
        except Exception:
            pass
        await asyncio.sleep(0.05)

    def _build_tools(self):
        yield_declaration = types.FunctionDeclaration(
            name="yield_to_user",
            description="Yields control back to the user for assistance or verification when an automated action is unsafe or ambiguous.",
            parameters=types.Schema(
                type="OBJECT",
                properties={
                    "reason": types.Schema(
                        type="STRING",
                        description="The reason why the agent is yielding control to the human."
                    )
                },
                required=["reason"]
            )
        )
        return [
            types.Tool(
                computer_use=types.ComputerUse(
                    environment=types.Environment.ENVIRONMENT_BROWSER,
                    enable_prompt_injection_detection=True,
                )
            ),
            types.Tool(function_declarations=[yield_declaration])
        ]

    def _action_details(self, fname, args):
        intent = args.get("intent", "N/A")
        details = intent if intent != "N/A" else f"Executing {fname}"
        target = ""
        typed_text = ""
        if fname == "navigate":
            target = args.get("url", "")
        elif fname in {"click", "double_click", "right_click", "middle_click", "move", "type", "scroll"}:
            target = f"({args.get('x', '')}, {args.get('y', '')})"
            if "text" in args:
                typed_text = args.get("text", "")
        return details, target, typed_text

    async def _execute_playwright_action(self, fname, args):
        if not self.page or self.page.is_closed():
            await self._recover_playwright()

        if fname in ("open_web_browser", "open_app"):
            return {}

        if fname == "navigate":
            url = args.get("url", "")
            if url and not url.startswith(("http://", "https://", "about:")):
                url = "https://" + url
            await self.page.goto(url, wait_until="domcontentloaded", timeout=NAVIGATION_TIMEOUT_MS)
            return {}

        if fname == "go_back":
            await self.page.go_back(wait_until="domcontentloaded", timeout=NAVIGATION_TIMEOUT_MS)
            return {}

        if fname == "go_forward":
            await self.page.go_forward(wait_until="domcontentloaded", timeout=NAVIGATION_TIMEOUT_MS)
            return {}

        if fname == "reload":
            await self.page.reload(wait_until="domcontentloaded", timeout=NAVIGATION_TIMEOUT_MS)
            return {}

        if fname in ("click", "click_at", "double_click", "triple_click", "middle_click", "right_click", "move", "long_press", "mouse_down", "mouse_up"):
            actual_x = self.denormalize_x(args.get("x", 500), SCREEN_WIDTH)
            actual_y = self.denormalize_y(args.get("y", 500), SCREEN_HEIGHT)
            self._cursor_pos = {"x": actual_x, "y": actual_y, "clicking": fname in {"click", "click_at", "double_click", "triple_click", "mouse_down"}}

            if fname in ("click", "click_at"):
                await self.page.mouse.click(actual_x, actual_y)
            elif fname == "double_click":
                await self.page.mouse.dblclick(actual_x, actual_y)
            elif fname == "triple_click":
                await self.page.mouse.click(actual_x, actual_y, click_count=3)
            elif fname == "right_click":
                await self.page.mouse.click(actual_x, actual_y, button="right")
            elif fname == "middle_click":
                await self.page.mouse.click(actual_x, actual_y, button="middle")
            elif fname == "move":
                await self.page.mouse.move(actual_x, actual_y)
            elif fname == "long_press":
                await self.page.mouse.move(actual_x, actual_y)
                await self.page.mouse.down()
                await asyncio.sleep(min(float(args.get("seconds", 0.7)), 1.8))
                await self.page.mouse.up()
            elif fname == "mouse_down":
                await self.page.mouse.move(actual_x, actual_y)
                await self.page.mouse.down()
            elif fname == "mouse_up":
                await self.page.mouse.move(actual_x, actual_y)
                await self.page.mouse.up()

            self._cursor_pos["clicking"] = False
            return {}

        if fname in ("type", "type_text_at"):
            if "x" in args and "y" in args:
                actual_x = self.denormalize_x(args["x"], SCREEN_WIDTH)
                actual_y = self.denormalize_y(args["y"], SCREEN_HEIGHT)
                self._cursor_pos = {"x": actual_x, "y": actual_y, "clicking": True}
                await self.page.mouse.click(actual_x, actual_y)
                self._cursor_pos["clicking"] = False

            if args.get("clear_before_typing", True):
                await self.page.keyboard.press("Control+A")
                await self.page.keyboard.press("Backspace")
            await self.page.keyboard.insert_text(args.get("text", ""))
            if args.get("press_enter", False):
                await self.page.keyboard.press("Enter")
            return {}

        if fname in ("press_key", "key_down", "key_up"):
            key = args.get("key")
            if fname == "key_down":
                await self.page.keyboard.down(key)
            elif fname == "key_up":
                await self.page.keyboard.up(key)
            else:
                await self.page.keyboard.press(key)
            return {}

        if fname in ("hotkey", "key_combination"):
            keys = args.get("keys") or args.get("key") or ""
            if isinstance(keys, list):
                keys = "+".join(keys)
            if keys:
                await self.page.keyboard.press(keys)
            return {}

        if fname in ("scroll", "scroll_at", "scroll_document"):
            direction = args.get("direction", "down")
            magnitude = args.get("magnitude_in_pixels", args.get("magnitude", 450))
            if "x" in args and "y" in args:
                actual_x = self.denormalize_x(args["x"], SCREEN_WIDTH)
                actual_y = self.denormalize_y(args["y"], SCREEN_HEIGHT)
                await self.page.mouse.move(actual_x, actual_y)
                self._cursor_pos = {"x": actual_x, "y": actual_y, "clicking": False}
            dx, dy = 0, 0
            if direction == "down":
                dy = magnitude
            elif direction == "up":
                dy = -magnitude
            elif direction == "right":
                dx = magnitude
            elif direction == "left":
                dx = -magnitude
            await self.page.mouse.wheel(dx, dy)
            return {}

        if fname == "drag_and_drop":
            start_x = self.denormalize_x(args.get("start_x", args.get("x", 500)), SCREEN_WIDTH)
            start_y = self.denormalize_y(args.get("start_y", args.get("y", 500)), SCREEN_HEIGHT)
            end_x = self.denormalize_x(args.get("end_x", args.get("destination_x", 500)), SCREEN_WIDTH)
            end_y = self.denormalize_y(args.get("end_y", args.get("destination_y", 500)), SCREEN_HEIGHT)
            self._cursor_pos = {"x": start_x, "y": start_y, "clicking": True}
            await self.page.mouse.move(start_x, start_y)
            await self.page.mouse.down()
            await self.page.mouse.move(end_x, end_y, steps=8)
            await self.page.mouse.up()
            self._cursor_pos = {"x": end_x, "y": end_y, "clicking": False}
            return {}

        if fname in {"wait", "wait_5_seconds"}:
            await asyncio.sleep(min(float(args.get("seconds", 0.4 if fname == "wait" else 1.2)), 2.0))
            return {}

        if fname == "take_screenshot":
            return {}

        raise RuntimeError(f"Unsupported browser function: {fname}")

    async def _execute_browser_action(self, fname, args):
        if self._first_action_at is None:
            self._first_action_at = time.perf_counter()
            self._profile("first_action", action=fname)
        started_at = time.perf_counter()
        try:
            result = await self._execute_playwright_action(fname, args)
            await self._settle_after_action(fname)
            elapsed_ms = int((time.perf_counter() - started_at) * 1000)
            self._profile("action", action=fname, elapsed_ms=elapsed_ms)
            return {"ok": True, "elapsed_ms": elapsed_ms, **(result or {})}
        except asyncio.CancelledError:
            raise
        except Exception as e:
            elapsed_ms = int((time.perf_counter() - started_at) * 1000)
            self._profile("action_error", action=fname, elapsed_ms=elapsed_ms, error=type(e).__name__)
            await self._recover_playwright()
            raise

    async def execute_function_calls(self, candidate, update_callback=None, current_turn=0, max_turns=MAX_TURNS):
        results = []
        function_calls = []

        if hasattr(candidate, "function_calls") and candidate.function_calls:
            function_calls = candidate.function_calls
        elif hasattr(candidate, "content") and candidate.content and hasattr(candidate.content, "parts"):
            for part in candidate.content.parts or []:
                if hasattr(part, "function_call") and part.function_call:
                    function_calls.append(part.function_call)

        for function_call in function_calls:
            self._raise_if_cancelled()
            fname = function_call.name
            args = function_call.args or {}
            details, target, typed_text = self._action_details(fname, args)
            print(f"  -> Executing: {fname} (Intent: {args.get('intent', 'N/A')})")

            if fname == "yield_to_user":
                reason = args.get("reason", "Needs user confirmation")
                print(f"   [YIELD] {reason}")
                return [{"type": "yield", "reason": reason, "call_id": function_call.id, "name": fname}]

            if "safety_decision" in args:
                decision = args["safety_decision"]
                if isinstance(decision, dict) and decision.get("decision") == "require_confirmation":
                    explanation = decision.get("explanation", "Safety check")
                    print(f"   [SAFETY] Safety Alert: {explanation}")
                    return [{"type": "yield", "reason": explanation, "call_id": function_call.id, "name": fname}]

            # Skip pre-action emit — the 80ms streaming loop already pushes live frames.
            # Only emit once after the action settles (handled in run_task after build_function_response_parts).

            try:
                action_result = await self._execute_browser_action(fname, args)
            except asyncio.CancelledError:
                raise
            except Exception as e:
                print(f"[ERR] Error executing {fname}: {e}")
                action_result = {"error": str(e)}

            results.append((fname, function_call.id, action_result))

        return results

    async def build_function_response_parts(self, results):
        self._raise_if_cancelled()
        screenshot_bytes = await self._screenshot_bytes()
        current_url = await self._url()
        title = await self._title()

        parts = []
        for fname, call_id, result in results:
            compact_result = {k: v for k, v in (result or {}).items() if k != "image"}
            response_payload = {"url": current_url, "title": title, **compact_result}
            parts.append(
                types.Part(
                    function_response=types.FunctionResponse(
                        name=fname,
                        id=call_id,
                        response=response_payload
                    )
                )
            )
        parts.append(types.Part.from_bytes(data=screenshot_bytes, mime_type="image/jpeg"))
        return parts

    async def _plan_fallback_action(self, prompt, turn, update_callback=None):
        print(f"[WEB] Falling back to Gemini 2.5 Flash Vision & Playwright JSON action planner for turn {turn + 1}")
        screenshot_bytes = await self._screenshot_bytes()
        current_url = await self._url()
        title = await self._title()

        fallback_prompt = f"""You are Orion's personal AI browser automation agent driving Playwright.
The user wants to achieve this goal: "{prompt}".

Current Page URL: {current_url}
Current Page Title: {title}

Respond ONLY with a valid JSON object describing the single best next action on this web page:
{{
  "action": "navigate" | "click" | "type" | "scroll" | "wait" | "finish",
  "url": "https://...",            // required if action is navigate
  "x": 500,                        // required if action is click (normalized 0-999)
  "y": 300,                        // required if action is click (normalized 0-999)
  "text": "search query or text",  // required if action is type
  "direction": "down" | "up",      // required if action is scroll
  "explanation": "Short 1-sentence reason for this action"
}}"""

        try:
            resp = await self.client.aio.models.generate_content(
                model="gemini-2.5-flash",
                contents=[
                    types.Content(role="user", parts=[
                        types.Part(text=fallback_prompt),
                        types.Part.from_bytes(data=screenshot_bytes, mime_type="image/jpeg")
                    ])
                ],
                config=types.GenerateContentConfig(
                    temperature=0.2,
                    response_mime_type="application/json"
                )
            )
            raw_text = (resp.text or "{}").strip()
            raw_text = raw_text.replace("```json", "").replace("```", "").strip()
            action_data = json.loads(raw_text)
            action_name = action_data.get("action", "scroll")
            explanation = action_data.get("explanation", f"Executing {action_name}")

            await self._emit_update(
                update_callback,
                f"Action: {explanation}",
                status="running",
                action=action_name,
                step=turn + 1,
                total_steps=MAX_TURNS,
                message=explanation,
                force=True,
            )

            if action_name == "navigate":
                target_url = action_data.get("url", DEFAULT_START_URL)
                if not target_url.startswith(("http://", "https://")):
                    target_url = "https://" + target_url
                await self.page.goto(target_url, wait_until="domcontentloaded", timeout=NAVIGATION_TIMEOUT_MS)
            elif action_name in ("click", "type"):
                norm_x = action_data.get("x", 500)
                norm_y = action_data.get("y", 500)
                actual_x = self.denormalize_x(norm_x, SCREEN_WIDTH)
                actual_y = self.denormalize_y(norm_y, SCREEN_HEIGHT)
                self._cursor_pos = {"x": actual_x, "y": actual_y, "clicking": True}
                await self.page.mouse.click(actual_x, actual_y)
                self._cursor_pos["clicking"] = False

                if action_name == "type" and action_data.get("text"):
                    await self.page.keyboard.insert_text(action_data["text"])
                    await self.page.keyboard.press("Enter")
            elif action_name == "scroll":
                direction = action_data.get("direction", "down")
                dy = 450 if direction == "down" else -450
                await self.page.mouse.wheel(0, dy)
            elif action_name == "finish":
                return True, f"Completed: {explanation}"

            return False, explanation
        except Exception as fallback_err:
            err_str = str(fallback_err)
            print(f"[WEB] Fallback action planner failed: {err_str}")
            if "429" in err_str or "RESOURCE_EXHAUSTED" in err_str:
                print("[WEB] Fallback planner quota hit. Backing off 3.5s...")
                await asyncio.sleep(3.5)
            if self.page and not self.page.is_closed():
                try:
                    await self.page.mouse.wheel(0, 350)
                except Exception:
                    pass
            return False, "Scrolling page..."

    async def run_task(self, prompt, update_callback=None):
        if self._active_run_task and not self._active_run_task.done():
            self.request_cancel("new browser instruction")

        async with self._task_lock:
            current_task = asyncio.current_task()
            self._active_run_task = current_task
            self._cancel_requested = False
            self._cancel_reason = ""
            self._run_started_at = time.perf_counter()
            self._first_action_at = None
            started_at = self._run_started_at
            print(f"[START] WebAgent started. Goal: {prompt}")

            try:
                await self.init_browser()
                if self.browser_backend == "playwright" and self.page.url == "about:blank":
                    await self.page.goto(DEFAULT_START_URL, wait_until="domcontentloaded", timeout=NAVIGATION_TIMEOUT_MS)

                await self._start_stream(update_callback)

                initial_bytes = await self._screenshot_bytes()
                self._profile("ready", backend=self.browser_backend)

                await self._emit_update(
                    update_callback,
                    "Web Agent Running...",
                    status="starting",
                    step=1,
                    total_steps=MAX_TURNS,
                    message="Web Agent Running...",
                    force=True,
                )

                config = types.GenerateContentConfig(
                    system_instruction=SYSTEM_INSTRUCTION,
                    tools=self._build_tools(),
                    thinking_config=types.ThinkingConfig(include_thoughts=True),
                    automatic_function_calling=types.AutomaticFunctionCallingConfig(disable=True),
                )

                if not self.contents:
                    self.contents = [
                        types.Content(role="user", parts=[
                            types.Part(text=prompt),
                            types.Part.from_bytes(data=initial_bytes, mime_type="image/jpeg")
                        ])
                    ]
                else:
                    input_parts = []
                    if self.pending_yield_call_id:
                        input_parts.append(
                            types.Part(
                                function_response=types.FunctionResponse(
                                    name=self.pending_yield_name,
                                    id=self.pending_yield_call_id,
                                    response={"user_confirmation": prompt}
                                )
                            )
                        )
                        self.pending_yield_call_id = None
                        self.pending_yield_name = None
                    else:
                        input_parts.append(types.Part(text=prompt))

                    input_parts.append(types.Part.from_bytes(data=initial_bytes, mime_type="image/jpeg"))
                    self.contents.append(types.Content(role="user", parts=input_parts))

                for turn in range(MAX_TURNS):
                    self._raise_if_cancelled()
                    print(f"\n--- Turn {turn + 1} ---")
                    
                    last_error = None
                    response = None
                    for model_id in WEB_AGENT_MODEL_CANDIDATES:
                        self._raise_if_cancelled()
                        try:
                            response = await asyncio.wait_for(
                                self.client.aio.models.generate_content(
                                    model=model_id,
                                    contents=self.contents,
                                    config=config,
                                ),
                                timeout=MODEL_TIMEOUT_SECONDS
                            )
                            self._interaction_model = model_id
                            break
                        except asyncio.CancelledError:
                            raise
                        except Exception as e:
                            last_error = e
                            err_str = str(e)
                            print(f"[WEB] Model candidate failed ({model_id}): {err_str}")
                            if "429" in err_str or "RESOURCE_EXHAUSTED" in err_str:
                                print("[WEB] Quota rate limit detected. Backing off for 3 seconds...")
                                await asyncio.sleep(3.0)

                    if not response or not response.candidates:
                        print(f"[WEB] Computer Use candidate loop returned no candidates ({last_error}). Triggering Vision JSON Fallback...")
                        finished, msg = await self._plan_fallback_action(prompt, turn, update_callback=update_callback)
                        if finished:
                            await self._emit_update(
                                update_callback,
                                "Task Finished",
                                status="success",
                                action="complete",
                                step=turn + 1,
                                total_steps=MAX_TURNS,
                                message=msg,
                                force=True,
                            )
                            self.contents = []
                            return msg
                        continue

                    candidate = response.candidates[0]
                    self.contents.append(candidate.content)

                    has_function_calls = any(
                        hasattr(part, "function_call") and part.function_call
                        for part in (candidate.content.parts if candidate.content else [])
                    )

                    if not has_function_calls:
                        text_response = " ".join([
                            part.text
                            for part in (candidate.content.parts if candidate.content else [])
                            if hasattr(part, "text") and part.text
                        ]).strip() or "Task complete."

                        print("[DONE] Agent finished:", text_response)
                        await self._emit_update(
                            update_callback,
                            "Task Finished",
                            status="success",
                            action="complete",
                            step=turn + 1,
                            total_steps=MAX_TURNS,
                            message=text_response,
                            force=True,
                        )
                        self.contents = []
                        elapsed_ms = int((time.perf_counter() - started_at) * 1000)
                        self._profile("completed", elapsed_ms=elapsed_ms)
                        return text_response

                    results = await self.execute_function_calls(
                        candidate,
                        update_callback=update_callback,
                        current_turn=turn,
                        max_turns=MAX_TURNS,
                    )

                    if results and isinstance(results[0], dict) and results[0].get("type") == "yield":
                        reason = results[0].get("reason")
                        call_id = results[0].get("call_id")
                        name = results[0].get("name")
                        print(f"[YIELD] Yielding to user: {reason}")
                        await self._emit_update(
                            update_callback,
                            f"Needs confirmation: {reason}",
                            status="paused",
                            action="Yielding to user",
                            step=turn + 1,
                            total_steps=MAX_TURNS,
                            message=f"Waiting for confirmation: {reason}",
                            force=True,
                        )
                        self.pending_yield_call_id = call_id
                        self.pending_yield_name = name
                        return f"Requires Confirmation: {reason}"

                    function_response_parts = await self.build_function_response_parts(results)
                    self.contents.append(types.Content(role="user", parts=function_response_parts))

                    actions_log = ", ".join([r[0] for r in results if isinstance(r, tuple)]) or "action"
                    await self._emit_update(
                        update_callback,
                        f"Executed: {actions_log}",
                        status="running",
                        action="settled",
                        step=turn + 1,
                        total_steps=MAX_TURNS,
                        message=f"Settled after: {actions_log}",
                        force=True,
                    )

                print("[WARN] Turn limit reached.")
                self.contents = []
                await self._emit_update(
                    update_callback,
                    "Browser task hit step limit.",
                    status="failed",
                    action="step_limit",
                    step=MAX_TURNS,
                    total_steps=MAX_TURNS,
                    message="Browser task hit step limit.",
                    force=True,
                )
                return "Agent stopped because it reached maximum steps."

            except asyncio.CancelledError:
                self._cancel_requested = False
                print(f"[WEB] Browser task paused: {self._cancel_reason or 'interrupted'}")
                await self._emit_update(
                    update_callback,
                    "Browser task paused by voice interruption.",
                    status="paused",
                    action="paused",
                    step=0,
                    total_steps=MAX_TURNS,
                    message="Paused by voice interruption.",
                    force=True,
                )
                return "Browser task paused because you interrupted."
            except Exception as e:
                print(f"[WEB] Browser task failed: {e}")
                traceback.print_exc()
                await self._emit_update(
                    update_callback,
                    f"Browser task failed: {e}",
                    status="failed",
                    action="error",
                    step=0,
                    total_steps=MAX_TURNS,
                    message=str(e),
                    force=True,
                )
                return f"Browser task failed: {e}"
            finally:
                self._stop_stream()
                if self._active_run_task is current_task:
                    self._active_run_task = None


if __name__ == "__main__":
    agent = WebAgent()
    asyncio.run(agent.run_task("Go to google.com and search for 'Gemini API' pricing."))
