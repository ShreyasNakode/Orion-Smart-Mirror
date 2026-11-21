import sys
import asyncio

# Fix for asyncio subprocess support on Windows
# MUST BE SET BEFORE OTHER IMPORTS
if sys.platform == 'win32':
    asyncio.set_event_loop_policy(asyncio.WindowsProactorEventLoopPolicy())

import socketio
import uvicorn
from fastapi import FastAPI
import asyncio
import threading
import sys
import os
import json
import time
from datetime import datetime
from pathlib import Path



# Ensure we can import ada
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

import ada
from authenticator import FaceAuthenticator
from kasa_agent import KasaAgent

from fastapi.middleware.cors import CORSMiddleware

# Create a Socket.IO server
sio = socketio.AsyncServer(async_mode='asgi', cors_allowed_origins='*', ping_timeout=60, ping_interval=20, max_http_buffer_size=50_000_000)
app = FastAPI(title="Orion Smart Mirror Skin Inference Backend", version="2.0.0")

# ---------------------------------------------------------------------------
# Explicit CORS Middleware Configuration
# Production Note: For production, replace wildcard/local origins with your
# exact production domain (e.g. https://your-mirror.domain.com) or set via ALLOWED_ORIGINS env var.
# ---------------------------------------------------------------------------
raw_origins = os.getenv(
    "ALLOWED_ORIGINS",
    "http://localhost:3000,http://localhost:3001,http://localhost:5173,http://127.0.0.1:3000,http://127.0.0.1:3001,http://127.0.0.1:5173,http://localhost:8001,http://127.0.0.1:8001"
)
allowed_origins = [o.strip() for o in raw_origins.split(",") if o.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins if os.getenv("NODE_ENV") == "production" else ["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# YouCam MCP Skin Analysis Engine Configuration
@app.on_event("startup")
async def startup_event():
    print("[FASTAPI STARTUP] Orion Skin Analysis configured to use YouCam AI Skin Analysis via MCP Server.", flush=True)

app_socketio = socketio.ASGIApp(sio, app)

import signal

# --- SHUTDOWN HANDLER ---
def signal_handler(sig, frame):
    print(f"\n[SERVER] Caught signal {sig}. Exiting gracefully...")
    # Clean up audio loop
    if audio_loop:
        try:
            print("[SERVER] Stopping Audio Loop...")
            audio_loop.stop() 
        except:
            pass
    # Force kill
    print("[SERVER] Force exiting...")
    os._exit(0)

signal.signal(signal.SIGINT, signal_handler)
signal.signal(signal.SIGTERM, signal_handler)

# Global state
audio_loop = None
loop_task = None
authenticator = None
kasa_agent = KasaAgent()
latest_events_cache = []
latest_tasks_cache = []
latest_sync_signature = ""
browser_command_sid = None
browser_command_counter = 0
browser_command_pending = {}
BROWSER_COMMAND_TIMEOUT_SECONDS = float(os.getenv("ORION_BROWSER_COMMAND_TIMEOUT_SECONDS", "10"))
SETTINGS_FILE = "settings.json"

DEFAULT_SETTINGS = {
    "face_auth_enabled": False, # Default OFF as requested
    "tool_permissions": {
        "generate_cad": True,
        "run_web_agent": False,
        "write_file": True,
        "read_directory": True,
        "read_file": True,
        "create_project": True,
        "switch_project": True,
        "list_projects": True
    },
    "printers": [], # List of {host, port, name, type}
    "kasa_devices": [], # List of {ip, alias, model}
    "camera_flipped": False # Invert cursor horizontal direction
}

SETTINGS = DEFAULT_SETTINGS.copy()

def load_settings():
    global SETTINGS
    if os.path.exists(SETTINGS_FILE):
        try:
            with open(SETTINGS_FILE, 'r') as f:
                loaded = json.load(f)
                # Merge with defaults to ensure new keys exist
                # Deep merge for tool_permissions would be better but shallow merge of top keys + tool_permissions check is okay for now
                for k, v in loaded.items():
                    if k == "tool_permissions" and isinstance(v, dict):
                         SETTINGS["tool_permissions"].update(v)
                    else:
                        SETTINGS[k] = v
            print(f"Loaded settings: {SETTINGS}")
        except Exception as e:
            print(f"Error loading settings: {e}")

def save_settings():
    try:
        with open(SETTINGS_FILE, 'w') as f:
            json.dump(SETTINGS, f, indent=4)
        print("Settings saved.")
    except Exception as e:
        print(f"Error saving settings: {e}")

# Load on startup
load_settings()

authenticator = None
kasa_agent = KasaAgent(known_devices=SETTINGS.get("kasa_devices"))
# tool_permissions is now SETTINGS["tool_permissions"]

@app.on_event("startup")
async def startup_debug_and_kasa():
    import sys
    print(f"[SERVER DEBUG] Startup Event Triggered")
    print(f"[SERVER DEBUG] Python Version: {sys.version}")
    try:
        loop = asyncio.get_running_loop()
        print(f"[SERVER DEBUG] Running Loop: {type(loop)}")
        policy = asyncio.get_event_loop_policy()
        print(f"[SERVER DEBUG] Current Policy: {type(policy)}")
    except Exception as e:
        print(f"[SERVER DEBUG] Error checking loop: {e}")

    print("[SERVER] Startup: Initializing Kasa Agent...")
    await kasa_agent.initialize()

@app.get("/status")
async def status():
    return {"status": "running", "service": "Orion Backend"}

@app.get("/health")
async def health():
    """Detailed health check for the voice pipeline and all backend services."""
    import time as _time
    result = {
        "status": "running",
        "service": "Orion Backend",
        "audio_loop_active": audio_loop is not None,
        "gemini_session_active": bool(audio_loop and audio_loop.session),
        "session_uptime_seconds": None,
        "last_receive_seconds_ago": None,
        "reconnect_attempts": None,
        "kasa_devices_loaded": len(kasa_agent.devices) if kasa_agent else 0,
    }
    if audio_loop:
        if hasattr(audio_loop, '_session_connected_at') and audio_loop._session_connected_at:
            result["session_uptime_seconds"] = round(_time.perf_counter() - audio_loop._session_connected_at, 1)
        if hasattr(audio_loop, '_last_receive_at') and audio_loop._last_receive_at:
            result["last_receive_seconds_ago"] = round(_time.perf_counter() - audio_loop._last_receive_at, 1)
        result["reconnect_attempts"] = getattr(audio_loop, '_reconnect_attempts', 0)
        result["paused"] = audio_loop.paused
        if hasattr(audio_loop, 'printer_agent') and audio_loop.printer_agent:
            result["printers_loaded"] = len(audio_loop.printer_agent.printers)
    return result

from pydantic import BaseModel
from typing import Optional, List, Dict, Any

class SkinAnalyzeReq(BaseModel):
    image: str
    debug: Optional[bool] = False

class SkinExplainReq(BaseModel):
    metrics: Dict[str, Any]
    previousScans: Optional[List[Dict[str, Any]]] = []

class SkinAssistantReq(BaseModel):
    question: str
    latestScan: Optional[Dict[str, Any]] = None
    history: Optional[List[Dict[str, Any]]] = []

@app.post("/predict")
@app.post("/api/skin/analyze")
@app.post("/api/skin/debug")
async def api_skin_analyze(req: SkinAnalyzeReq):
    try:
        import urllib.request
        import json
        node_port = os.getenv("PORT", os.getenv("ORION_PORT", "3001"))
        node_url = f"http://127.0.0.1:{node_port}/api/skin/analyze"
        
        payload = json.dumps({"image": req.image, "debug": bool(req.debug)}).encode("utf-8")
        req_obj = urllib.request.Request(node_url, data=payload, headers={"Content-Type": "application/json"})
        
        with urllib.request.urlopen(req_obj, timeout=60) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            return data
    except Exception as e:
        print(f"[SERVER] Error delegating skin analysis to YouCam MCP backend: {e}")
        from fastapi import HTTPException
        raise HTTPException(status_code=500, detail=f"YouCam MCP skin analysis failed: {str(e)}")

@app.post("/api/skin/explain")
async def api_skin_explain(req: SkinExplainReq):
    metrics = req.metrics
    score = metrics.get("score", 85)
    classification = metrics.get("classification", "Normal")
    hydration = metrics.get("hydration", 80)
    acne = metrics.get("acneSeverity", "Clear")
    explanation = f"Your skin score is {score}% with {classification} skin type. Hydration level is {hydration}% and acne severity is rated as {acne}. Maintain daily sunscreen and hydrating serums for best skin barrier protection."
    return {"ok": True, "explanation": explanation}

@app.post("/api/skin/assistant")
async def api_skin_assistant(req: SkinAssistantReq):
    latest = req.latestScan or {}
    ans = f"Based on your latest scan (Score: {latest.get('score', 85)}%, Hydration: {latest.get('hydration', 80)}%), maintaining consistent hydration and SPF 50+ sun protection will keep your skin health optimal."
    return {"ok": True, "answer": ans}

@sio.event
async def orion_analyze_skin(sid, data):
    try:
        from skin_inference import analyze_skin_image
        img_b64 = data.get("image", "")
        metrics = analyze_skin_image(img_b64)
        await sio.emit("skin_analysis_result", {"ok": True, "metrics": metrics}, room=sid)
    except Exception as e:
        print(f"[SERVER] SocketIO orion_analyze_skin error: {e}")
        await sio.emit("skin_analysis_result", {"ok": False, "error": str(e)}, room=sid)


@sio.event
async def connect(sid, environ):
    global authenticator, browser_command_sid
    browser_command_sid = sid
    print(f"Client connected: {sid}")
    await sio.emit('status', {'msg': 'Connected to Orion Backend'}, room=sid)
    await sio.emit('browser_log', {'msg': 'Browser bridge connected.'}, room=sid)

    
    # Callback for Auth Status
    async def on_auth_status(is_auth):
        print(f"[SERVER] Auth status change: {is_auth}")
        await sio.emit('auth_status', {'authenticated': is_auth})

    # Callback for Auth Camera Frames
    async def on_auth_frame(frame_b64):
        await sio.emit('auth_frame', {'image': frame_b64})

    # Initialize Authenticator if not already done
    if authenticator is None:
        authenticator = FaceAuthenticator(
            reference_image_path="reference.jpg",
            on_status_change=on_auth_status,
            on_frame=on_auth_frame
        )
    
    # Check if already authenticated or needs to start
    if authenticator.authenticated:
        await sio.emit('auth_status', {'authenticated': True})
    else:
        # Check Settings for Auth
        if SETTINGS.get("face_auth_enabled", False):
            await sio.emit('auth_status', {'authenticated': False})
            # Start the auth loop in background
            asyncio.create_task(authenticator.start_authentication_loop())
        else:
            # Bypass Auth
            print("Face Auth Disabled. Auto-authenticating.")
            # We don't change authenticator state to true to avoid confusion if re-enabled? 
            # Or we should just tell client it's auth'd.
            await sio.emit('auth_status', {'authenticated': True})

@sio.event
async def disconnect(sid):
    global browser_command_sid
    print(f"Client disconnected: {sid}")
    if browser_command_sid == sid:
        browser_command_sid = None
        for request_id, future in list(browser_command_pending.items()):
            if not future.done():
                future.set_exception(ConnectionError("Orion browser UI disconnected"))
            browser_command_pending.pop(request_id, None)

async def execute_browser_command(command, timeout=None):
    """Send one browser command to the live Orion webview and wait for its result."""
    global browser_command_counter
    if not browser_command_sid:
        raise RuntimeError("No Orion browser UI is connected")

    browser_command_counter += 1
    request_id = f"browser-{int(time.time() * 1000)}-{browser_command_counter}"
    payload = {**command, "id": request_id}
    loop = asyncio.get_running_loop()
    future = loop.create_future()
    browser_command_pending[request_id] = future

    try:
        await sio.emit('browser_command', payload, room=browser_command_sid)
        return await asyncio.wait_for(future, timeout=timeout or BROWSER_COMMAND_TIMEOUT_SECONDS)
    except asyncio.CancelledError:
        browser_command_pending.pop(request_id, None)
        try:
            await sio.emit('browser_command_cancel', {'id': request_id, 'reason': 'backend task cancelled'}, room=browser_command_sid)
        except Exception as cancel_error:
            print(f"[BROWSER BRIDGE] Failed to notify browser cancellation: {cancel_error}")
        raise
    except Exception:
        browser_command_pending.pop(request_id, None)
        raise

async def cancel_browser_commands(reason="interrupted"):
    """Flush pending browser bridge requests and ask the UI executor to stop its current action."""
    if browser_command_sid:
        await sio.emit('browser_command_cancel', {'reason': reason}, room=browser_command_sid)

    for request_id, future in list(browser_command_pending.items()):
        if not future.done():
            future.cancel()
        browser_command_pending.pop(request_id, None)

@sio.event
async def browser_command_result(sid, data):
    request_id = data.get('id')
    future = browser_command_pending.pop(request_id, None)
    if not future:
        print(f"[BROWSER BRIDGE] Late or unknown browser command result: {request_id}")
        return

    if data.get('ok', False):
        future.set_result(data.get('result') or {})
    else:
        future.set_exception(RuntimeError(data.get('error') or 'Browser command failed'))

@sio.event
async def audio_chunk(sid, data):
    global audio_loop
    if audio_loop and hasattr(audio_loop, 'enqueue_user_audio'):
        # data is raw PCM bytes sent from frontend; keep the newest chunks if overloaded.
        audio_loop.enqueue_user_audio(data)

@sio.event
async def manual_browser_action(sid, data):
    """Receive instant manual touch click/type/scroll from frontend UI."""
    global audio_loop
    if audio_loop and hasattr(audio_loop, 'web_agent') and audio_loop.web_agent:
        try:
            await audio_loop.web_agent.execute_manual_action(data)
        except Exception as e:
            print(f"[SERVER] Failed to execute manual browser action: {e}")

@sio.event
async def sync_data(sid, data):
    """Cache dashboard calendar/task state for voice tool reads and ID resolution."""
    global latest_events_cache, latest_tasks_cache, latest_sync_signature, audio_loop
    next_events = data.get('events') or []
    next_tasks = data.get('tasks') or []
    signature = json.dumps({"events": next_events, "tasks": next_tasks}, sort_keys=True, default=str)
    if signature == latest_sync_signature:
        return

    latest_sync_signature = signature
    latest_events_cache = next_events
    latest_tasks_cache = next_tasks
    if audio_loop:
        audio_loop.cached_events = latest_events_cache
        audio_loop.cached_tasks = latest_tasks_cache
    print(f"[SERVER] Synced {len(latest_events_cache)} events and {len(latest_tasks_cache)} tasks from frontend.")

@sio.event
async def skin_analysis_stage(sid, data):
    """Forward skin-analysis workflow progress into the live voice session."""
    global audio_loop
    if not audio_loop or not audio_loop.session:
        return

    stage = data.get('stage', 'unknown')
    details = data.get('details') or {}
    score = details.get('score')

    if stage == 'aligning':
        message = "Skin analysis has started. Guide the user to align their face in the frame."
    elif stage == 'analyzing':
        message = "The skin photo was captured and analysis is running. Tell the user to hold on briefly."
    elif stage == 'results':
        if not details:
            message = 'Skin analysis results are ready, but no model metrics were provided. Tell the user the scan did not return usable model data.'
        else:
            model_json = json.dumps(details, ensure_ascii=False)[:3500]
            message = 'Skin analysis results are ready. Use only this PyTorch model JSON to discuss the scan; do not invent values or perform vision: ' + model_json
    else:
        message = f"Skin analysis stage changed to {stage}."

    try:
        await audio_loop.send_client_text(f"System Notification: {message}", turn_complete=True)
    except Exception as e:
        print(f"[SERVER] Failed to send skin analysis stage update: {e}")

@sio.event
async def start_audio(sid, data=None):
    global audio_loop, loop_task
    
    # Optional: Block if not authenticated
    # Only block if auth is ENABLED and not authenticated
    if SETTINGS.get("face_auth_enabled", False):
        if authenticator and not authenticator.authenticated:
            print("Blocked start_audio: Not authenticated.")
            await sio.emit('error', {'msg': 'Authentication Required'})
            return

    print("Starting Audio Loop...")
    
    if audio_loop:
        if loop_task and (loop_task.done() or loop_task.cancelled()):
             print("Audio loop task appeared finished/cancelled. Clearing and restarting...")
             audio_loop = None
             loop_task = None
        else:
             print("Audio loop already running. Re-connecting client to session.")
             await sio.emit('status', {'msg': 'Orion Already Running'})
             return


    # Callback to send audio data to frontend
    def on_audio_data(data_bytes):
        # We need to schedule this on the event loop
        # Pass raw bytes so python-socketio handles it natively as binary frames (Zero overhead)
        asyncio.create_task(sio.emit('audio_data', {'data': data_bytes}))

    # Callback to send CAL data to frontend
    def on_cad_data(data):
        info = f"{len(data.get('vertices', []))} vertices" if 'vertices' in data else f"{len(data.get('data', ''))} bytes (STL)"
        print(f"Sending CAD data to frontend: {info}")
        asyncio.create_task(sio.emit('cad_data', data))

    # Callback to send Browser data to frontend
    def on_web_data(data):
        print(f"Sending Browser data to frontend: {len(data.get('log', ''))} chars logs")
        asyncio.create_task(sio.emit('browser_frame', data))
        
    # Callback to send Transcription data to frontend
    def on_transcription(data):
        # data = {"sender": "User"|"Orion", "text": "..."}
        asyncio.create_task(sio.emit('transcription', data))

    # Callback to send Confirmation Request to frontend
    def on_tool_confirmation(data):
        # data = {"id": "uuid", "tool": "tool_name", "args": {...}}
        print(f"Requesting confirmation for tool: {data.get('tool')}")
        asyncio.create_task(sio.emit('tool_confirmation_request', data))

    # Callback to send CAD status to frontend
    def on_cad_status(status):
        # status can be: 
        # - a string like "generating" (from ada.py handle_cad_request)
        # - a dict with {status, attempt, max_attempts, error} (from CadAgent)
        if isinstance(status, dict):
            print(f"Sending CAD Status: {status.get('status')} (attempt {status.get('attempt')}/{status.get('max_attempts')})")
            asyncio.create_task(sio.emit('cad_status', status))
        else:
            # Legacy: simple string
            print(f"Sending CAD Status: {status}")
            asyncio.create_task(sio.emit('cad_status', {'status': status}))

    # Callback to send CAD thoughts to frontend (streaming)
    def on_cad_thought(thought_text):
        asyncio.create_task(sio.emit('cad_thought', {'text': thought_text}))

    # Callback to send Project Update to frontend
    def on_project_update(project_name):
        print(f"Sending Project Update: {project_name}")
        asyncio.create_task(sio.emit('project_update', {'project': project_name}))

    # Callback to send Device Update to frontend
    def on_device_update(devices):
        # devices is a list of dicts
        print(f"Sending Kasa Device Update: {len(devices)} devices")
        asyncio.create_task(sio.emit('kasa_devices', devices))

    # Callback to send Error to frontend
    def on_error(msg):
        print(f"Sending Error to frontend: {msg}")
        asyncio.create_task(sio.emit('error', {'msg': msg}))

    # Callback to send Home Assistant command to frontend
    def on_ha_command(data):
        print(f"Sending ha_command to frontend: {data}")
        asyncio.create_task(sio.emit('ha_command', data))

    # Callback to handle interruption
    last_stop_playback_at = 0.0

    def on_interruption():
        nonlocal last_stop_playback_at
        now = time.monotonic()
        if now - last_stop_playback_at < 0.6:  # Raised from 0.35s to 0.6s to eliminate stop_playback floods
            return
        last_stop_playback_at = now
        print("Model interrupted. Sending stop_playback to client.")
        asyncio.create_task(sio.emit('stop_playback'))

    # Callback to trigger frontend actions (calendar, tasks, skin analysis)
    def on_frontend_action(data):
        print(f"Sending frontend_action: {data}")
        asyncio.create_task(sio.emit('frontend_action', data))

    # Initialize Orion
    try:
        _init_t0 = time.perf_counter()
        print(f"Initializing AudioLoop")
        audio_loop = ada.AudioLoop(
            video_mode="none", 
            on_audio_data=on_audio_data,
            on_cad_data=on_cad_data,
            on_web_data=on_web_data,
            on_transcription=on_transcription,
            on_tool_confirmation=on_tool_confirmation,
            on_cad_status=on_cad_status,
            on_cad_thought=on_cad_thought,
            on_project_update=on_project_update,
            on_device_update=on_device_update,
            on_error=on_error,
            on_ha_command=on_ha_command,
            kasa_agent=kasa_agent,
            on_interruption=on_interruption,
            on_frontend_action=on_frontend_action
        )
        if hasattr(audio_loop.web_agent, 'set_remote_executor'):
            audio_loop.web_agent.set_remote_executor(execute_browser_command, cancel_browser_commands)
        _init_elapsed = int((time.perf_counter() - _init_t0) * 1000)
        print(f"[ORION LATENCY] AudioLoop initialized in {_init_elapsed}ms")
        audio_loop.cached_events = latest_events_cache
        audio_loop.cached_tasks = latest_tasks_cache

        # Apply current permissions
        audio_loop.update_permissions(SETTINGS["tool_permissions"])
        
        # Check initial mute state
        if data and data.get('muted', False):
            print("Starting with Audio Paused")
            audio_loop.set_paused(True)

        print("Creating asyncio task for AudioLoop.run()")
        loop_task = asyncio.create_task(audio_loop.run())
        
        # Add a done callback to catch silent failures in the loop
        def handle_loop_exit(task):
            try:
                task.result()
            except asyncio.CancelledError:
                print("Audio Loop Cancelled")
            except Exception as e:
                print(f"Audio Loop Crashed: {e}")
                import traceback
                traceback.print_exception(e)
                asyncio.create_task(sio.emit('error', {'msg': f"Orion voice loop crashed: {e}"}))
        
        loop_task.add_done_callback(handle_loop_exit)
        
        print("Emitting 'Orion Started'")
        await sio.emit('status', {'msg': 'Orion Started'})

        # Load saved printers
        saved_printers = SETTINGS.get("printers", [])
        if saved_printers and audio_loop.printer_agent:
            print(f"[SERVER] Loading {len(saved_printers)} saved printers...")
            for p in saved_printers:
                audio_loop.printer_agent.add_printer_manually(
                    name=p.get("name", p["host"]),
                    host=p["host"],
                    port=p.get("port", 80),
                    printer_type=p.get("type", "moonraker"),
                    camera_url=p.get("camera_url")
                )
        
        # Start Printer Monitor
        asyncio.create_task(monitor_printers_loop())
        
    except Exception as e:
        print(f"CRITICAL ERROR STARTING ORION: {e}")
        import traceback
        traceback.print_exc()
        await sio.emit('error', {'msg': f"Failed to start: {str(e)}"})
        audio_loop = None # Ensure we can try again


async def monitor_printers_loop():
    """Background task to query printer status periodically."""
    print("[SERVER] Starting Printer Monitor Loop")
    offline_backoffs = {}
    while audio_loop and audio_loop.printer_agent:
        try:
            agent = audio_loop.printer_agent
            if not agent.printers:
                await asyncio.sleep(5)
                continue
                
            now = time.monotonic()
            tasks = []
            hosts_polled = []
            for host, printer in agent.printers.items():
                if printer.printer_type.value != "unknown":
                    last_check = offline_backoffs.get(host, 0)
                    # If printer was offline, poll every 10s instead of 2s
                    if host in agent._error_tracker and (now - last_check < 10.0):
                        continue
                    offline_backoffs[host] = now
                    hosts_polled.append(host)
                    # Wrap each status call with a strict 3s timeout so offline printers
                    # don't block the event loop (avoids Windows semaphore timeout errors)
                    tasks.append(asyncio.wait_for(agent.get_print_status(host), timeout=3.0))
            
            if tasks:
                results = await asyncio.gather(*tasks, return_exceptions=True)
                for host, res in zip(hosts_polled, results):
                    if isinstance(res, (Exception, asyncio.TimeoutError)):
                        if not isinstance(res, asyncio.TimeoutError) or host not in agent._error_tracker:
                            print(f"[SERVER] Printer {host} status failed: {type(res).__name__}")
                        agent._error_tracker.add(host)
                    elif res:
                        if "offline" in res.state.lower() or "error" in res.state.lower():
                            agent._error_tracker.add(host)
                        else:
                            agent._error_tracker.discard(host)
                        await sio.emit('print_status_update', res.to_dict())
                        
        except asyncio.CancelledError:
            print("[SERVER] Printer Monitor Cancelled")
            break
        except Exception as e:
            print(f"[SERVER] Monitor Loop Error: {e}")
            
        await asyncio.sleep(2) # Update every 2 seconds for responsiveness

@sio.event
async def stop_audio(sid):
    global audio_loop, loop_task
    if audio_loop:
        audio_loop.stop()
        print("Stopping Audio Loop")
        if loop_task and not loop_task.done():
            loop_task.cancel()
        loop_task = None
        audio_loop = None
        await sio.emit('status', {'msg': 'Orion Stopped'})

@sio.event
async def pause_audio(sid):
    global audio_loop
    if audio_loop:
        audio_loop.set_paused(True)
        print("Pausing Audio")
        await sio.emit('status', {'msg': 'Audio Paused'})

@sio.event
async def resume_audio(sid):
    global audio_loop
    if audio_loop:
        audio_loop.set_paused(False)
        print("Resuming Audio")
        await sio.emit('status', {'msg': 'Audio Resumed'})

@sio.event
async def confirm_tool(sid, data):
    # data: { "id": "...", "confirmed": True/False }
    request_id = data.get('id')
    confirmed = data.get('confirmed', False)
    
    print(f"[SERVER DEBUG] Received confirmation response for {request_id}: {confirmed}")
    
    if audio_loop:
        audio_loop.resolve_tool_confirmation(request_id, confirmed)
    else:
        print("Audio loop not active, cannot resolve confirmation.")

@sio.event
async def shutdown(sid, data=None):
    """Gracefully shutdown the server when the application closes."""
    global audio_loop, loop_task, authenticator
    
    print("[SERVER] ========================================")
    print("[SERVER] SHUTDOWN SIGNAL RECEIVED FROM FRONTEND")
    print("[SERVER] ========================================")
    
    # Stop audio loop
    if audio_loop:
        print("[SERVER] Stopping Audio Loop...")
        audio_loop.stop()
        audio_loop = None
    
    # Cancel the loop task if running
    if loop_task and not loop_task.done():
        print("[SERVER] Cancelling loop task...")
        loop_task.cancel()
        loop_task = None
    
    # Stop authenticator if running
    if authenticator:
        print("[SERVER] Stopping Authenticator...")
        authenticator.stop()
    
    print("[SERVER] Graceful shutdown complete. Terminating process...")
    
    # Force exit immediately - os._exit bypasses cleanup but ensures termination
    os._exit(0)

@sio.event
async def user_input(sid, data):
    text = data.get('text')
    print(f"[SERVER DEBUG] User input received: '{text}'")
    
    if not audio_loop:
        print("[SERVER DEBUG] [Error] Audio loop is None. Cannot send text.")
        return

    if not audio_loop.session:
        print("[SERVER DEBUG] [Error] Session is None. Cannot send text.")
        return

    if text:
        print(f"[SERVER DEBUG] Sending message to model: '{text}'")
        
        # Log User Input to Project History
        if audio_loop and audio_loop.project_manager:
            audio_loop.project_manager.log_chat("User", text)
            
        audio_loop.clear_audio_queue()
        await sio.emit('stop_playback')

        # Inject the latest camera/browser frame first if one is available.
        if audio_loop and audio_loop._latest_image_payload:
            print(f"[SERVER DEBUG] Piggybacking video frame with text input.")
            try:
                await audio_loop.queue_latest_image()
            except Exception as e:
                print(f"[SERVER DEBUG] Failed to send piggyback frame: {e}")
                
        await audio_loop.send_client_text(text, turn_complete=True)
        print(f"[SERVER DEBUG] Message sent to model successfully.")

import json
from datetime import datetime
from pathlib import Path

# ... (imports)

@sio.event
async def video_frame(sid, data):
    # data should contain 'image' which is binary (blob) or base64 encoded
    image_data = data.get('image')
    if image_data and audio_loop:
        # We don't await this because we don't want to block the socket handler
        # But send_frame is async, so we create a task
        asyncio.create_task(audio_loop.send_frame(image_data))

@sio.event
async def save_memory(sid, data):
    try:
        messages = data.get('messages', [])
        if not messages:
            print("No messages to save.")
            return

        # Ensure directory exists
        memory_dir = Path("long_term_memory")
        memory_dir.mkdir(exist_ok=True)

        # Generate filename
        # Use provided filename if available, else timestamp
        provided_name = data.get('filename')
        
        if provided_name:
            # Simple sanitization
            if not provided_name.endswith('.txt'):
                provided_name += '.txt'
            # Prevent directory traversal
            filename = memory_dir / Path(provided_name).name 
        else:
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            filename = memory_dir / f"memory_{timestamp}.txt"

        # Write to file
        with open(filename, 'w', encoding='utf-8') as f:
            for msg in messages:
                sender = msg.get('sender', 'Unknown')
                text = msg.get('text', '')
        print(f"Conversation saved to {filename}")
        await sio.emit('status', {'msg': 'Memory Saved Successfully'})

    except Exception as e:
        print(f"Error saving memory: {e}")
        await sio.emit('error', {'msg': f"Failed to save memory: {str(e)}"})

@sio.event
async def upload_memory(sid, data):
    print(f"Received memory upload request")
    try:
        memory_text = data.get('memory', '')
        if not memory_text:
            print("No memory data provided.")
            return

        if not audio_loop:
             print("[SERVER DEBUG] [Error] Audio loop is None. Cannot load memory.")
             await sio.emit('error', {'msg': "System not ready (Audio Loop inactive)"})
             return
        
        if not audio_loop.session:
             print("[SERVER DEBUG] [Error] Session is None. Cannot load memory.")
             await sio.emit('error', {'msg': "System not ready (No active session)"})
             return

        # Send to model
        print("Sending memory context to model...")
        context_msg = f"System Notification: The user has uploaded a long-term memory file. Please load the following context into your understanding. The format is a text log of previous conversations:\n\n{memory_text}"
        
        await audio_loop.send_client_text(context_msg, turn_complete=True)
        print("Memory context sent successfully.")
        await sio.emit('status', {'msg': 'Memory Loaded into Context'})

    except Exception as e:
        print(f"Error uploading memory: {e}")
        await sio.emit('error', {'msg': f"Failed to upload memory: {str(e)}"})

@sio.event
async def discover_kasa(sid):
    print(f"Received discover_kasa request")
    try:
        devices = await kasa_agent.discover_devices()
        await sio.emit('kasa_devices', devices)
        await sio.emit('status', {'msg': f"Found {len(devices)} Kasa devices"})
        
        # Save to settings
        # devices is a list of full device info dicts. minimizing for storage.
        saved_devices = []
        for d in devices:
            saved_devices.append({
                "ip": d["ip"],
                "alias": d["alias"],
                "model": d["model"]
            })
        
        # Merge with existing to preserve any manual overrides? 
        # For now, just overwrite with latest scan result + previously known if we want to be fancy,
        # but user asked for "Any new devices that are scanned are added there".
        # A simple full persistence of current state is safest.
        SETTINGS["kasa_devices"] = saved_devices
        save_settings()
        print(f"[SERVER] Saved {len(saved_devices)} Kasa devices to settings.")
        
    except Exception as e:
        print(f"Error discovering kasa: {e}")
        await sio.emit('error', {'msg': f"Kasa Discovery Failed: {str(e)}"})

@sio.event
async def iterate_cad(sid, data):
    # data: { prompt: "make it bigger" }
    prompt = data.get('prompt')
    print(f"Received iterate_cad request: '{prompt}'")
    
    if not audio_loop or not audio_loop.cad_agent:
        await sio.emit('error', {'msg': "CAD Agent not available"})
        return

    try:
        # Notify user work has started
        await sio.emit('status', {'msg': 'Iterating design...'})
        await sio.emit('cad_status', {'status': 'generating'})
        
        # Call the agent with project path
        cad_output_dir = str(audio_loop.project_manager.get_current_project_path() / "cad")
        result = await audio_loop.cad_agent.iterate_prototype(prompt, output_dir=cad_output_dir)
        
        if result:
            info = f"{len(result.get('data', ''))} bytes (STL)"
            print(f"Sending updated CAD data: {info}")
            await sio.emit('cad_data', result)
            # Save to Project
            if 'file_path' in result:
                saved_path = audio_loop.project_manager.save_cad_artifact(result['file_path'], prompt)
                if saved_path:
                    print(f"[SERVER] Saved iterated CAD to {saved_path}")

            await sio.emit('status', {'msg': 'Design updated'})
        else:
            await sio.emit('error', {'msg': 'Failed to update design'})
            
    except Exception as e:
        print(f"Error iterating CAD: {e}")
        await sio.emit('error', {'msg': f"Iteration Error: {str(e)}"})

@sio.event
async def generate_cad(sid, data):
    # data: { prompt: "make a cube" }
    prompt = data.get('prompt')
    print(f"Received generate_cad request: '{prompt}'")
    
    if not audio_loop or not audio_loop.cad_agent:
        await sio.emit('error', {'msg': "CAD Agent not available"})
        return

    try:
        await sio.emit('status', {'msg': 'Generating new design...'})
        await sio.emit('cad_status', {'status': 'generating'})
        
        # Use generate_prototype based on prompt with project path
        cad_output_dir = str(audio_loop.project_manager.get_current_project_path() / "cad")
        result = await audio_loop.cad_agent.generate_prototype(prompt, output_dir=cad_output_dir)
        
        if result:
            info = f"{len(result.get('data', ''))} bytes (STL)"
            print(f"Sending newly generated CAD data: {info}")
            await sio.emit('cad_data', result)


            # Save to Project
            if 'file_path' in result:
                saved_path = audio_loop.project_manager.save_cad_artifact(result['file_path'], prompt)
                if saved_path:
                    print(f"[SERVER] Saved generated CAD to {saved_path}")

            await sio.emit('status', {'msg': 'Design generated'})
        else:
            await sio.emit('error', {'msg': 'Failed to generate design'})
            
    except Exception as e:
        print(f"Error generating CAD: {e}")
        await sio.emit('error', {'msg': f"Generation Error: {str(e)}"})

from web_agent import WebAgent
global_web_agent = WebAgent()

@sio.event
async def prompt_web_agent(sid, data):
    prompt = data.get('prompt')
    print(f"[SERVER] Received web agent prompt: '{prompt}'")
    
    agent = (audio_loop.web_agent if (audio_loop and hasattr(audio_loop, 'web_agent') and audio_loop.web_agent) else global_web_agent)

    try:
        await sio.emit('status', {'msg': 'Web Agent running...'})
        
        async def on_web_data_callback(image_b64, log_text, state_dict=None):
            payload = {"image": image_b64, "log": log_text}
            if state_dict:
                payload["state"] = state_dict
            await sio.emit('browser_frame', payload)

        result = await agent.run_task(prompt, update_callback=on_web_data_callback)
        if isinstance(result, str) and result.lower().startswith('browser task paused'):
            await sio.emit('status', {'msg': 'Web Agent paused'})
        else:
            await sio.emit('status', {'msg': 'Web Agent finished'})
        
    except Exception as e:
        print(f"[SERVER] Error running Web Agent: {e}")
        await sio.emit('error', {'msg': f"Web Agent Error: {str(e)}"})

@sio.event
async def discover_printers(sid):
    print("Received discover_printers request")
    
    # If audio_loop isn't ready yet, return saved printers from settings
    if not audio_loop or not audio_loop.printer_agent:
        saved_printers = SETTINGS.get("printers", [])
        if saved_printers:
            # Convert saved printers to the expected format
            printer_list = []
            for p in saved_printers:
                printer_list.append({
                    "name": p.get("name", p["host"]),
                    "host": p["host"],
                    "port": p.get("port", 80),
                    "printer_type": p.get("type", "unknown"),
                    "camera_url": p.get("camera_url")
                })
            print(f"[SERVER] Returning {len(printer_list)} saved printers (audio_loop not ready)")
            await sio.emit('printer_list', printer_list)
            return
        else:
            await sio.emit('printer_list', [])
            await sio.emit('status', {'msg': "Connect to Orion to enable printer discovery"})
            return
        
    try:
        printers = await audio_loop.printer_agent.discover_printers()
        await sio.emit('printer_list', printers)
        await sio.emit('status', {'msg': f"Found {len(printers)} printers"})
    except Exception as e:
        print(f"Error discovering printers: {e}")
        await sio.emit('error', {'msg': f"Printer Discovery Failed: {str(e)}"})

@sio.event
async def add_printer(sid, data):
    # data: { host: "192.168.1.50", name: "My Printer", type: "moonraker" }
    raw_host = data.get('host')
    name = data.get('name') or raw_host
    ptype = data.get('type', "moonraker")
    
    # Parse port if present
    if ":" in raw_host:
        host, port_str = raw_host.split(":")
        port = int(port_str)
    else:
        host = raw_host
        port = 80
    
    print(f"Received add_printer request: {host}:{port} ({ptype})")
    
    if not audio_loop or not audio_loop.printer_agent:
        await sio.emit('error', {'msg': "Printer Agent not available"})
        return
        
    try:
        # Add manually
        camera_url = data.get('camera_url')
        printer = audio_loop.printer_agent.add_printer_manually(name, host, port=port, printer_type=ptype, camera_url=camera_url)
        
        # Save to settings
        new_printer_config = {
            "name": name,
            "host": host,
            "port": port,
            "type": ptype,
            "camera_url": camera_url
        }
        
        # Check if already exists to avoid duplicates
        exists = False
        for p in SETTINGS.get("printers", []):
            if p["host"] == host and p["port"] == port:
                exists = True
                break
        
        if not exists:
            if "printers" not in SETTINGS:
                SETTINGS["printers"] = []
            SETTINGS["printers"].append(new_printer_config)
            save_settings()
            print(f"[SERVER] Saved printer {name} to settings.")
        
        # Probe to confirm/correct type
        print(f"Probing {host} to confirm type...")
        # Try port 7125 (Moonraker) and 4408 (Fluidd/K1) 
        ports_to_try = [80, 7125, 4408]
        
        actual_type = "unknown"
        for port in ports_to_try:
             found_type = await audio_loop.printer_agent._probe_printer_type(host, port)
             if found_type.value != "unknown":
                 actual_type = found_type
                 # Update port if different
                 if port != 80:
                     printer.port = port
                 break
        
        if actual_type != "unknown" and actual_type != printer.printer_type:
             printer.printer_type = actual_type
             print(f"Corrected type to {actual_type.value} on port {printer.port}")
             
        # Refresh list for everyone
        printers = [p.to_dict() for p in audio_loop.printer_agent.printers.values()]
        await sio.emit('printer_list', printers)
        await sio.emit('status', {'msg': f"Added printer: {name}"})
        
    except Exception as e:
        print(f"Error adding printer: {e}")
        await sio.emit('error', {'msg': f"Failed to add printer: {str(e)}"})

@sio.event
async def print_stl(sid, data):
    print(f"Received print_stl request: {data}")
    # data: { stl_path: "path/to.stl" | "current", printer: "name_or_ip", profile: "optional" }
    
    if not audio_loop or not audio_loop.printer_agent:
        await sio.emit('error', {'msg': "Printer Agent not available"})
        return
        
    try:
        stl_path = data.get('stl_path', 'current')
        printer_name = data.get('printer')
        profile = data.get('profile')
        
        if not printer_name:
             await sio.emit('error', {'msg': "No printer specified"})
             return
             
        await sio.emit('status', {'msg': f"Preparing print for {printer_name}..."})
        
        # Get current project path for resolution
        current_project_path = None
        if audio_loop and audio_loop.project_manager:
            current_project_path = str(audio_loop.project_manager.get_current_project_path())
            print(f"[SERVER DEBUG] Using project path: {current_project_path}")

        # Resolve STL path before slicing so we can preview it
        resolved_stl = audio_loop.printer_agent._resolve_file_path(stl_path, current_project_path)
        
        if resolved_stl and os.path.exists(resolved_stl):
            # Open the STL in the CAD module for preview
            try:
                import base64
                with open(resolved_stl, 'rb') as f:
                    stl_data = f.read()
                stl_b64 = base64.b64encode(stl_data).decode('utf-8')
                stl_filename = os.path.basename(resolved_stl)
                
                print(f"[SERVER] Opening STL in CAD module: {stl_filename}")
                await sio.emit('cad_data', {
                    'format': 'stl',
                    'data': stl_b64,
                    'filename': stl_filename
                })
            except Exception as e:
                print(f"[SERVER] Warning: Could not preview STL: {e}")
        
        # Progress Callback
        async def on_slicing_progress(percent, message):
            await sio.emit('slicing_progress', {
                'printer': printer_name,
                'percent': percent,
                'message': message
            })
            if percent < 100:
                 await sio.emit('status', {'msg': f"Slicing: {percent}%"})

        result = await audio_loop.printer_agent.print_stl(
            stl_path, 
            printer_name, 
            profile,
            progress_callback=on_slicing_progress,
            root_path=current_project_path
        )
        
        await sio.emit('print_result', result)
        await sio.emit('status', {'msg': f"Print Job: {result.get('status', 'unknown')}"})
        
    except Exception as e:
        print(f"Error printing STL: {e}")
        await sio.emit('error', {'msg': f"Print Failed: {str(e)}"})

@sio.event
async def get_slicer_profiles(sid):
    """Get available OrcaSlicer profiles for manual selection."""
    print("Received get_slicer_profiles request")
    if not audio_loop or not audio_loop.printer_agent:
        await sio.emit('error', {'msg': "Printer Agent not available"})
        return
    
    try:
        profiles = audio_loop.printer_agent.get_available_profiles()
        await sio.emit('slicer_profiles', profiles)
    except Exception as e:
        print(f"Error getting slicer profiles: {e}")
        await sio.emit('error', {'msg': f"Failed to get profiles: {str(e)}"})

@sio.event
async def control_kasa(sid, data):
    # data: { ip, action: "on"|"off"|"brightness"|"color", value: ... }
    ip = data.get('ip')
    action = data.get('action')
    print(f"Kasa Control: {ip} -> {action}")
    
    try:
        success = False
        if action == "on":
            success = await kasa_agent.turn_on(ip)
        elif action == "off":
            success = await kasa_agent.turn_off(ip)
        elif action == "brightness":
            val = data.get('value')
            success = await kasa_agent.set_brightness(ip, val)
        elif action == "color":
            # value is {h, s, v} - convert to tuple for set_color
            h = data.get('value', {}).get('h', 0)
            s = data.get('value', {}).get('s', 100)
            v = data.get('value', {}).get('v', 100)
            success = await kasa_agent.set_color(ip, (h, s, v))
        
        if success:
            await sio.emit('kasa_update', {
                'ip': ip,
                'is_on': True if action == "on" else (False if action == "off" else None),
                'brightness': data.get('value') if action == "brightness" else None,
            })
 
        else:
             await sio.emit('error', {'msg': f"Failed to control device {ip}"})

    except Exception as e:
         print(f"Error controlling kasa: {e}")
         await sio.emit('error', {'msg': f"Kasa Control Error: {str(e)}"})

@sio.event
async def get_settings(sid):
    await sio.emit('settings', SETTINGS)

@sio.event
async def update_settings(sid, data):
    # Generic update
    print(f"Updating settings: {data}")
    
    # Handle specific keys if needed
    if "tool_permissions" in data:
        SETTINGS["tool_permissions"].update(data["tool_permissions"])
        if audio_loop:
            audio_loop.update_permissions(SETTINGS["tool_permissions"])
            
    if "face_auth_enabled" in data:
        SETTINGS["face_auth_enabled"] = data["face_auth_enabled"]
        # If turned OFF, maybe emit auth status true?
        if not data["face_auth_enabled"]:
             await sio.emit('auth_status', {'authenticated': True})
             # Stop auth loop if running?
             if authenticator:
                 authenticator.stop() 

    if "camera_flipped" in data:
        SETTINGS["camera_flipped"] = data["camera_flipped"]
        print(f"[SERVER] Camera flip set to: {data['camera_flipped']}")

    save_settings()
    # Broadcast new full settings
    await sio.emit('settings', SETTINGS)


# Deprecated/Mapped for compatibility if frontend still uses specific events
@sio.event
async def get_tool_permissions(sid):
    await sio.emit('tool_permissions', SETTINGS["tool_permissions"])

@sio.event
async def update_tool_permissions(sid, data):
    print(f"Updating permissions (legacy event): {data}")
    SETTINGS["tool_permissions"].update(data)
    save_settings()
    
    if audio_loop:
        audio_loop.update_permissions(SETTINGS["tool_permissions"])
    # Broadcast update to all
    await sio.emit('tool_permissions', SETTINGS["tool_permissions"])

if __name__ == "__main__":
    uvicorn.run(
        "server:app_socketio", 
        host="0.0.0.0", 
        port=int(os.getenv("PORT", 8001)), 
        reload=False, # Reload enabled causes spawn of worker which might miss the event loop policy patch
        loop="asyncio",
        reload_excludes=["temp_cad_gen.py", "output.stl", "*.stl"]
    )



