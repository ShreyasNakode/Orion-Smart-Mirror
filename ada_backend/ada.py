import asyncio
import base64
from collections import deque
import io
import os
import sys
import traceback
from dotenv import load_dotenv
import cv2
import PIL.Image
import mss
import argparse
import math
import random
import re
import struct
import time
from datetime import datetime, timedelta, timezone
from urllib.parse import quote_plus
import requests
import xml.etree.ElementTree as ET
import json
from pathlib import Path

from google import genai
from google.genai import types

if sys.version_info < (3, 11, 0):
    import taskgroup, exceptiongroup
    asyncio.TaskGroup = taskgroup.TaskGroup
    asyncio.ExceptionGroup = exceptiongroup.ExceptionGroup

from tools import tools_list
from navigation_intents import detect_dashboard_navigation, resolve_dashboard_route

FORMAT = 8
CHANNELS = 1
SEND_SAMPLE_RATE = 16000
RECEIVE_SAMPLE_RATE = 24000
CHUNK_SIZE = 1024
USER_AUDIO_QUEUE_MAX = 96
REALTIME_QUEUE_MAX = 96
PLAYBACK_QUEUE_MAX = 64
HTTP_TIMEOUT = (1.5, 3.5)
NEWS_CACHE_TTL = 60
TOOL_TIMEOUT_SECONDS = 5.0
_NEWS_CACHE = {}

MODEL = "gemini-2.5-flash-native-audio-latest"
DEFAULT_MODE = "camera"

load_dotenv()
load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env.local"), override=True)
VOICE_PROFILE_ENABLED = os.getenv("ORION_PROFILE_VOICE", "1").lower() not in {"0", "false", "no"}
LOCAL_VAD_MIN_RMS = int(os.getenv("ORION_LOCAL_VAD_MIN_RMS", "1200"))
LOCAL_VAD_NOISE_MULTIPLIER = float(os.getenv("ORION_LOCAL_VAD_NOISE_MULTIPLIER", "2.2"))
LOCAL_VAD_START_FRAMES = int(os.getenv("ORION_LOCAL_VAD_START_FRAMES", "2"))
LOCAL_VAD_END_FRAMES = int(os.getenv("ORION_LOCAL_VAD_END_FRAMES", "4"))
LOCAL_VAD_END_SECONDS = float(os.getenv("ORION_LOCAL_VAD_END_SECONDS", "0.28"))
LOCAL_VAD_PREROLL_CHUNKS = int(os.getenv("ORION_LOCAL_VAD_PREROLL_CHUNKS", "12"))
LOCAL_VAD_POST_SILENCE_CHUNKS = int(os.getenv("ORION_LOCAL_VAD_POST_SILENCE_CHUNKS", "3"))
INTERRUPTION_MIN_INTERVAL_SECONDS = float(os.getenv("ORION_INTERRUPTION_MIN_INTERVAL_SECONDS", "1.2"))
client = genai.Client(http_options={"api_version": "v1beta"}, api_key=os.getenv("GEMINI_API_KEY"))

# Function definitions
generate_cad = {
    "name": "generate_cad",
    "description": "Generates a 3D CAD model based on a prompt.",
    "parameters": {
        "type": "OBJECT",
        "properties": {
            "prompt": {"type": "STRING", "description": "The description of the object to generate."}
        },
        "required": ["prompt"]
    },
    "behavior": "NON_BLOCKING"
}

run_web_agent = {
    "name": "run_web_agent",
    "description": "Executes a web browser automation task. Use ONLY when the user's request explicitly requires browsing, searching, or automating actions on websites (e.g., booking a cab, ordering food/groceries, or searching the web). Also use this tool to relay the user's confirmation to proceed if the web agent previously paused to ask for permission. Do NOT call this tool for general questions, weather, time, calendar events, Spotify music, or smart home commands. You must respond in voice only for these things.",
    "parameters": {
        "type": "OBJECT",
        "properties": {
            "prompt": {"type": "STRING", "description": "The detailed instructions for the web browser agent."}
        },
        "required": ["prompt"]
    },
    "behavior": "NON_BLOCKING"
}

navigate_dashboard_tool = {
    "name": "navigate_dashboard",
    "description": "Instantly navigates the Orion Smart Mirror interface to a dashboard. Use for phrases such as go home, open skin analysis, take me to home control, open health, or open settings.",
    "parameters": {
        "type": "OBJECT",
        "properties": {
            "view": {"type": "STRING", "description": "Dashboard route id or name: dashboard/home, skin_analysis/skin analysis, home_control/home control, health, or settings."}
        },
        "required": ["view"]
    },
    "behavior": "NON_BLOCKING"
}

create_project_tool = {
    "name": "create_project",
    "description": "Creates a new project folder to organize files.",
    "parameters": {
        "type": "OBJECT",
        "properties": {
            "name": {"type": "STRING", "description": "The name of the new project."}
        },
        "required": ["name"]
    }
}

switch_project_tool = {
    "name": "switch_project",
    "description": "Switches the current active project context.",
    "parameters": {
        "type": "OBJECT",
        "properties": {
            "name": {"type": "STRING", "description": "The name of the project to switch to."}
        },
        "required": ["name"]
    }
}

list_projects_tool = {
    "name": "list_projects",
    "description": "Lists all available projects.",
    "parameters": {
        "type": "OBJECT",
        "properties": {},
    }
}

list_smart_devices_tool = {
    "name": "list_smart_devices",
    "description": "Lists all available smart home devices (lights, plugs, etc.) on the network.",
    "parameters": {
        "type": "OBJECT",
        "properties": {},
    }
}

control_smart_home_device = {
    "name": "control_smart_home_device",
    "description": "Controls a smart home device via Home Assistant.",
    "parameters": {
        "type": "OBJECT",
        "properties": {
            "domain": {
                "type": "STRING",
                "description": "The Home Assistant domain (e.g. 'light', 'climate', 'switch', 'media_player')."
            },
            "service": {
                "type": "STRING",
                "description": "The service to call (e.g. 'turn_on', 'turn_off')."
            },
            "data": {
                "type": "OBJECT",
                "description": "Optional service data, e.g. {'entity_id': 'light.living_room'} or {'entity_id': 'climate.ac', 'temperature': 72}."
            }
        },
        "required": ["domain", "service"]
    }
}

discover_printers_tool = {
    "name": "discover_printers",
    "description": "Discovers 3D printers available on the local network.",
    "parameters": {
        "type": "OBJECT",
        "properties": {},
    }
}

print_stl_tool = {
    "name": "print_stl",
    "description": "Prints an STL file to a 3D printer. Handles slicing the STL to G-code and uploading to the printer.",
    "parameters": {
        "type": "OBJECT",
        "properties": {
            "stl_path": {"type": "STRING", "description": "Path to STL file, or 'current' for the most recent CAD model."},
            "printer": {"type": "STRING", "description": "Printer name or IP address."},
            "profile": {"type": "STRING", "description": "Optional slicer profile name."}
        },
        "required": ["stl_path", "printer"]
    }
}

get_print_status_tool = {
    "name": "get_print_status",
    "description": "Gets the current status of a 3D printer including progress, time remaining, and temperatures.",
    "parameters": {
        "type": "OBJECT",
        "properties": {
            "printer": {"type": "STRING", "description": "Printer name or IP address."}
        },
        "required": ["printer"]
    }
}

iterate_cad_tool = {
    "name": "iterate_cad",
    "description": "Modifies or iterates on the current CAD design based on user feedback. Use this when the user asks to adjust, change, modify, or iterate on the existing 3D model (e.g., 'make it taller', 'add a handle', 'reduce the thickness').",
    "parameters": {
        "type": "OBJECT",
        "properties": {
            "prompt": {"type": "STRING", "description": "The changes or modifications to apply to the current design."}
        },
        "required": ["prompt"]
    },
    "behavior": "NON_BLOCKING"
}

get_weather_tool = {
    "name": "get_weather",
    "description": "Retrieves real current weather and today's forecast for the user's current location or a named city.",
    "parameters": {
        "type": "OBJECT",
        "properties": {
            "location": {"type": "STRING", "description": "The city or location to get weather for, if specified. Use 'current location' when the user says here or my location."}
        }
    }
}

get_news_tool = {
    "name": "get_news",
    "description": "Retrieves fresh news headlines from a configured realtime news API, including topic-specific requests, with RSS fallback.",
    "parameters": {
        "type": "OBJECT",
        "properties": {
            "topic": {"type": "STRING", "description": "Optional topic, keyword, company, person, place, team, or phrase to search news for."},
            "category": {"type": "STRING", "description": "Optional news category such as general, business, technology, entertainment, sports, science, health, world, or nation."},
            "country": {"type": "STRING", "description": "Two-letter country code for headlines. Default is us."},
            "language": {"type": "STRING", "description": "Two-letter language code. Default is en."},
            "limit": {"type": "INTEGER", "description": "Number of headlines to return, usually 3 to 5."}
        }
    }
}

manage_calendar_tool = {
    "name": "manage_calendar",
    "description": "Adds, deletes, edits, moves, or lists calendar events on the Orion dashboard. For delete/edit/move, provide an id if known; otherwise provide title and date so the frontend can resolve the correct event.",
    "parameters": {
        "type": "OBJECT",
        "properties": {
            "action": {"type": "STRING", "description": "The action to perform: 'add', 'delete', 'edit', 'move', or 'list'."},
            "title": {"type": "STRING", "description": "The title of the event to add, delete, or old title to edit/move."},
            "id": {"type": "STRING", "description": "The ID of the event to delete, edit, or move (if known)."},
            "type": {"type": "STRING", "description": "The type of the event, e.g., 'meeting', 'birthday', 'reminder', 'anniversary', 'deadline'."},
            "day": {"type": "INTEGER", "description": "Day of the month (1-31). For add/list this is the target date. For move, this is the new day."},
            "month": {"type": "INTEGER", "description": "Month of the year (0-11). For add/list this is the target month. For move, this is the new month."},
            "year": {"type": "INTEGER", "description": "Year. For add/list this is the target year. For move, this is the new year."},
            "new_title": {"type": "STRING", "description": "The new title of the event for edit or move actions."},
            "new_type": {"type": "STRING", "description": "The new type of the event for edit action."},
            "new_day": {"type": "INTEGER", "description": "New day of month for edit/move if distinct from lookup date."},
            "new_month": {"type": "INTEGER", "description": "New zero-based month for edit/move if distinct from lookup date."},
            "new_year": {"type": "INTEGER", "description": "New year for edit/move if distinct from lookup date."}
        },
        "required": ["action"]
    }
}

manage_tasks_tool = {
    "name": "manage_tasks",
    "description": "Adds, removes, edits, completes, reopens, or lists tasks on the Daily Tasks dashboard.",
    "parameters": {
        "type": "OBJECT",
        "properties": {
            "action": {"type": "STRING", "description": "The action to perform: 'add', 'remove', 'delete', 'toggle', 'complete', 'reopen', 'edit', 'remind', or 'list'."},
            "title": {"type": "STRING", "description": "The task title to add, find, remove, complete, reopen, or edit."},
            "id": {"type": "STRING", "description": "The ID of the task to remove, toggle, complete, reopen, or edit."},
            "new_title": {"type": "STRING", "description": "The replacement title for edit action."},
            "done": {"type": "BOOLEAN", "description": "Whether the task should be marked complete."}
        },
        "required": ["action"]
    }
}

analyze_skin_tool = {
    "name": "analyze_skin",
    "description": "Automatically opens the Skin Analysis dashboard and starts the skin analysis process.",
    "parameters": {
        "type": "OBJECT",
        "properties": {}
    }
}

get_skin_analysis_tool = {
    "name": "get_skin_analysis",
    "description": "Retrieves the user's latest saved skin analysis diagnostic report, including detected concerns, all 5 classifications (Acne, Oily, Dryness, Wrinkles, Normal Skin) with confidence scores, overall health score, personalized Gemini morning and night skincare routines, and nutritional recommendations. Call this when the user asks 'how is my skin today?', 'what are my main skin concerns?', 'what should I apply this morning/night?', 'explain my latest skin report', or questions about their skin health.",
    "parameters": {
        "type": "OBJECT",
        "properties": {
            "query_type": {
                "type": "STRING",
                "description": "Optional focus: 'overview', 'morning_routine', 'night_routine', 'concerns', or 'products'."
            }
        }
    }
}

refresh_skin_report_tool = {
    "name": "refresh_skin_report_qr",
    "description": "Refreshes the QR Skin Report and its associated QR code on the Orion Smart Mirror. Call when the user asks to 'refresh my skin report QR code', 'refresh the QR code', or 'reload my skin report'.",
    "parameters": {
        "type": "OBJECT",
        "properties": {}
    }
}

manage_music_tool = {
    "name": "manage_music",
    "description": "Controls the Orion Music Player/Spotify with low-latency voice actions: play songs, artists, moods, playlists, pause, resume, next, previous, volume, shuffle, and repeat.",
    "parameters": {
        "type": "OBJECT",
        "properties": {
            "action": {"type": "STRING", "description": "play, pause, resume, toggle, next, previous, volume, shuffle, repeat, or stop."},
            "query": {"type": "STRING", "description": "Song, artist, playlist, genre, or mood to search for when action is play."},
            "media_type": {"type": "STRING", "description": "track, artist, album, playlist, or auto."},
            "volume": {"type": "INTEGER", "description": "Volume percent from 0 to 100 for volume action."},
            "shuffle": {"type": "BOOLEAN", "description": "True to enable shuffle, false to disable."},
            "repeat": {"type": "STRING", "description": "Repeat mode: off, track, or context."}
        },
        "required": ["action"]
    }
}

manage_alarm_tool = {
    "name": "manage_alarm",
    "description": "Sets, cancels, stops, or turns on/off an alarm on the Orion Smart Mirror. Use when user says set an alarm, cancel alarm, or stop alarm.",
    "parameters": {
        "type": "OBJECT",
        "properties": {
            "action": {"type": "STRING", "description": "The action to perform: 'set', 'cancel', 'stop', 'enable', 'disable', or 'list'."},
            "time": {"type": "STRING", "description": "Alarm time string e.g. '07:30', '18:45', '7:30 AM', '6:00 PM'."},
            "ringtone": {"type": "STRING", "description": "Optional ringtone audio filename or choice."}
        },
        "required": ["action"]
    }
}

manage_timer_tool = {
    "name": "manage_timer",
    "description": "Starts, pauses, resumes, stops, or resets a countdown timer on the Orion Smart Mirror. Use when user says start a timer, set timer for 5 minutes, pause timer, or stop timer.",
    "parameters": {
        "type": "OBJECT",
        "properties": {
            "action": {"type": "STRING", "description": "The action: 'start', 'pause', 'resume', 'stop', 'reset'."},
            "duration_seconds": {"type": "INTEGER", "description": "Total duration in seconds (e.g. 300 for 5 minutes)."},
            "minutes": {"type": "INTEGER", "description": "Duration in minutes."},
            "seconds": {"type": "INTEGER", "description": "Duration in seconds."}
        },
        "required": ["action"]
    }
}

manage_stopwatch_tool = {
    "name": "manage_stopwatch",
    "description": "Starts, pauses, resumes, stops, or resets the live stopwatch on the Orion Smart Mirror. Use when user says start a stopwatch, pause stopwatch, or reset stopwatch.",
    "parameters": {
        "type": "OBJECT",
        "properties": {
            "action": {"type": "STRING", "description": "The action: 'start', 'pause', 'resume', 'stop', 'reset'."}
        },
        "required": ["action"]
    }
}

tools = [{'google_search': {}}, {"function_declarations": [generate_cad, run_web_agent, navigate_dashboard_tool, create_project_tool, switch_project_tool, list_projects_tool, list_smart_devices_tool, control_smart_home_device, discover_printers_tool, print_stl_tool, get_print_status_tool, iterate_cad_tool, get_weather_tool, get_news_tool, manage_calendar_tool, manage_tasks_tool, analyze_skin_tool, get_skin_analysis_tool, refresh_skin_report_tool, manage_music_tool, manage_alarm_tool, manage_timer_tool, manage_stopwatch_tool] + tools_list[0]['function_declarations'][1:]}]

# --- CONFIG UPDATE: Enabled Transcription ---
config = types.LiveConnectConfig(
    response_modalities=["AUDIO"],
    # We switch these from [] to {} to enable them with default settings
    output_audio_transcription={}, 
    input_audio_transcription={},
    realtime_input_config=types.RealtimeInputConfig(
        automatic_activity_detection=types.AutomaticActivityDetection(
            disabled=False,
            start_of_speech_sensitivity=types.StartSensitivity.START_SENSITIVITY_HIGH,
            end_of_speech_sensitivity=types.EndSensitivity.END_SENSITIVITY_HIGH,
            prefix_padding_ms=20,
            silence_duration_ms=400,  # Increased from 300ms: prevents premature turn cut-off
        ),
        activity_handling=types.ActivityHandling.START_OF_ACTIVITY_INTERRUPTS,
        turn_coverage=types.TurnCoverage.TURN_INCLUDES_ONLY_ACTIVITY,
    ),
    context_window_compression=types.ContextWindowCompressionConfig(
        trigger_tokens=24000,
        sliding_window=types.SlidingWindow(target_tokens=16000),
    ),
    system_instruction="You are Orion, the voice-activated AI assistant on the Orion Smart Mirror. "
        "If asked your name, answer exactly: My name is Orion. "
        "You must engage in a natural, low-latency voice-to-voice conversation with the user. "
        "Always respond using your voice via audio response. "
        "Start speaking as soon as you have enough context; keep turns short and low-latency. "
        "If the user whispers or speaks softly, answer gently and quietly in tone when the selected voice supports it. "
        "You have a witty and charming personality. Your creator is Naz, and you address him as 'Sir'. "
        "Keep responses complete, concise, and action-oriented. "
        "Use get_weather for current weather or forecast requests, and get_news for live or topic-specific news requests. Use navigate_dashboard for dashboard navigation commands, including home, skin analysis, home control, health, and settings. "
        "Use manage_calendar for adding, deleting, editing, moving, or reading calendar events. "
        "Use manage_tasks for Daily Tasks commands including add, remove, edit, complete, reopen, reminders, and list. "
        "Use analyze_skin whenever the user asks to analyze, analyse, scan, or check their skin. "
        "Use manage_music for music requests including play, pause, resume, next, previous, volume, shuffle, and repeat. "
        "Use manage_alarm when the user asks to set an alarm, cancel an alarm, or stop an alarm. "
        "Use manage_timer when the user asks to start a timer, set a countdown, pause, resume, or stop a timer. "
        "Use manage_stopwatch when the user asks to start, pause, resume, or reset a stopwatch. "
        "Call control_smart_home_device to control lights, climate/AC, fans, media players, locks, and covers. "
        "Call run_web_agent whenever the user asks to browse, search the web, shop (e.g., Amazon, Flipkart), book a cab or ride, order food or groceries, open a website, or perform web automation tasks. Pass the detailed user request prompt directly to run_web_agent. "
        "Do not call run_web_agent for weather, time, music, calendar, tasks, or smart home control.",
    tools=tools,
    speech_config=types.SpeechConfig(
        voice_config=types.VoiceConfig(
            prebuilt_voice_config=types.PrebuiltVoiceConfig(
                voice_name="Kore"
            )
        )
    )
)

# Module-level persistent HTTP session for connection pooling (TCP keep-alive)
_HTTP_SESSION = requests.Session()
_HTTP_SESSION.headers.update({"User-Agent": "OrionSmartMirror/1.0 (+https://localhost)"})

def fetch_real_weather(location=None):
    requested = (location or "").strip()
    current_aliases = {"", "current", "current location", "my location", "here", "the current location"}
    lat = lon = None
    city = requested or "your location"

    weather_codes = {
        0: "clear sky", 1: "mainly clear", 2: "partly cloudy", 3: "overcast",
        45: "fog", 48: "rime fog", 51: "light drizzle", 53: "moderate drizzle",
        55: "dense drizzle", 61: "slight rain", 63: "moderate rain", 65: "heavy rain",
        71: "slight snow", 73: "moderate snow", 75: "heavy snow", 77: "snow grains",
        80: "slight rain showers", 81: "moderate rain showers", 82: "violent rain showers",
        85: "slight snow showers", 86: "heavy snow showers", 95: "thunderstorms",
        96: "thunderstorms with slight hail", 99: "thunderstorms with heavy hail",
    }

    _weather_t0 = time.perf_counter()
    try:
        if requested.lower() in current_aliases:
            geo = _HTTP_SESSION.get("https://ipapi.co/json/", timeout=4)
            geo.raise_for_status()
            geo_data = geo.json()
            lat = geo_data.get("latitude")
            lon = geo_data.get("longitude")
            city = geo_data.get("city") or city
        else:
            geo = _HTTP_SESSION.get(
                "https://geocoding-api.open-meteo.com/v1/search",
                params={"name": requested, "count": 1, "language": "en", "format": "json"},
                timeout=4,
            )
            geo.raise_for_status()
            results = geo.json().get("results", [])
            if results:
                lat = results[0].get("latitude")
                lon = results[0].get("longitude")
                city = results[0].get("name") or requested

        if lat is None or lon is None:
            return f"I could not resolve a location for {city}."

        weather = _HTTP_SESSION.get(
            "https://api.open-meteo.com/v1/forecast",
            params={
                "latitude": lat,
                "longitude": lon,
                "current_weather": "true",
                "daily": "temperature_2m_max,temperature_2m_min,weathercode",
                "timezone": "auto",
            },
            timeout=5,
        )
        weather.raise_for_status()
        data = weather.json()
        current = data.get("current_weather") or {}
        temp_c = current.get("temperature")
        if temp_c is None:
            return f"I reached the weather service for {city}, but it did not return a current temperature."

        temp_f = round((temp_c * 9 / 5) + 32, 1)
        condition = weather_codes.get(current.get("weathercode"), "unknown conditions")
        daily = data.get("daily") or {}
        max_c = (daily.get("temperature_2m_max") or [temp_c])[0]
        min_c = (daily.get("temperature_2m_min") or [temp_c])[0]
        max_f = round((max_c * 9 / 5) + 32, 1)
        min_f = round((min_c * 9 / 5) + 32, 1)

        _weather_elapsed = int((time.perf_counter() - _weather_t0) * 1000)
        print(f"[ORION LATENCY] fetch_real_weather({city}) completed in {_weather_elapsed}ms")

        return (
            f"The current weather in {city} is {temp_f} F ({temp_c} C) with {condition}. "
            f"Today's forecast is a high of {max_f} F ({max_c} C) and a low of {min_f} F ({min_c} C)."
        )
    except Exception as e:
        _weather_elapsed = int((time.perf_counter() - _weather_t0) * 1000)
        print(f"[WEATHER] Error fetching weather in {_weather_elapsed}ms: {e}")
        return "I could not fetch live weather right now. Please try again in a moment."

def _http_get(url, params=None, headers=None, timeout=HTTP_TIMEOUT, retries=1, as_json=True):
    merged_headers = {**(headers or {})}
    last_error = None

    for attempt in range(retries + 1):
        _t0 = time.perf_counter()
        try:
            response = _HTTP_SESSION.get(url, params=params, headers=merged_headers, timeout=timeout)
            response.raise_for_status()
            _elapsed = int((time.perf_counter() - _t0) * 1000)
            print(f"[ORION LATENCY] HTTP GET {url.split('?')[0]} -> {response.status_code} in {_elapsed}ms")
            return response.json() if as_json else response.text
        except requests.HTTPError:
            raise
        except Exception as e:
            last_error = e
            _elapsed = int((time.perf_counter() - _t0) * 1000)
            print(f"[ORION LATENCY] HTTP GET {url.split('?')[0]} -> FAILED in {_elapsed}ms: {e}")
            if attempt < retries:
                time.sleep(0.15 * (attempt + 1))

    raise last_error


def _clean_news_title(title):
    title = (title or "").strip()
    if " - " in title:
        title = title.rsplit(" - ", 1)[0]
    return re.sub(r"\s+", " ", title)


def _normalize_news_category(category, provider):
    value = (category or "").strip().lower()
    if not value:
        return None

    newsapi_categories = {"business", "entertainment", "general", "health", "science", "sports", "technology"}
    gnews_categories = {"general", "world", "nation", "business", "technology", "entertainment", "sports", "science", "health"}
    aliases = {
        "tech": "technology",
        "finance": "business",
        "medical": "health",
        "politics": "nation",
        "international": "world",
    }
    value = aliases.get(value, value)
    allowed = newsapi_categories if provider == "newsapi" else gnews_categories
    return value if value in allowed else None


def _format_news_response(articles, provider, topic=None, category=None, limit=5):
    headlines = []
    seen = set()
    for article in articles or []:
        title = _clean_news_title(article.get("title"))
        if not title or title.lower() in seen or title == "[Removed]":
            continue
        seen.add(title.lower())

        source = article.get("source") or {}
        if isinstance(source, dict):
            source_name = source.get("name") or ""
        else:
            source_name = str(source or "")

        if source_name:
            headlines.append(f"{title} ({source_name})")
        else:
            headlines.append(title)

        if len(headlines) >= max(1, min(int(limit or 5), 8)):
            break

    if not headlines:
        return None

    if topic:
        intro = f"Latest {topic} news"
    elif category:
        intro = f"Latest {category} headlines"
    else:
        intro = "Latest headlines"

    return f"{intro}: " + "; ".join(headlines) + "."


def _fetch_newsapi(topic=None, category=None, country="us", language="en", limit=5):
    api_key = os.getenv("NEWS_API_KEY")
    if not api_key:
        return None

    topic = (topic or "").strip()
    country = (country or "us").strip().lower()[:2]
    language = (language or "en").strip().lower()[:2]
    page_size = max(1, min(int(limit or 5), 10))

    if topic:
        data = _http_get(
            "https://newsapi.org/v2/top-headlines",
            params={"q": topic, "country": country, "pageSize": page_size, "apiKey": api_key},
            retries=1,
        )
        articles = data.get("articles") or []
        if not articles:
            since = (datetime.now(timezone.utc) - timedelta(days=2)).date().isoformat()
            data = _http_get(
                "https://newsapi.org/v2/everything",
                params={
                    "q": topic,
                    "from": since,
                    "language": language,
                    "sortBy": "publishedAt",
                    "pageSize": page_size,
                    "apiKey": api_key,
                },
                retries=1,
            )
            articles = data.get("articles") or []
        return _format_news_response(articles, "newsapi", topic=topic, limit=page_size)

    params = {"country": country, "pageSize": page_size, "apiKey": api_key}
    normalized_category = _normalize_news_category(category, "newsapi")
    if normalized_category:
        params["category"] = normalized_category

    data = _http_get("https://newsapi.org/v2/top-headlines", params=params, retries=1)
    return _format_news_response(data.get("articles") or [], "newsapi", category=normalized_category, limit=page_size)


def _fetch_gnews(topic=None, category=None, country="us", language="en", limit=5):
    api_key = os.getenv("GNEWS_API_KEY")
    if not api_key:
        return None

    topic = (topic or "").strip()
    country = (country or "us").strip().lower()[:2]
    language = (language or "en").strip().lower()[:2]
    max_results = max(1, min(int(limit or 5), 10))

    if topic:
        data = _http_get(
            "https://gnews.io/api/v4/search",
            params={"q": topic, "lang": language, "country": country, "max": max_results, "apikey": api_key},
            retries=1,
        )
        return _format_news_response(data.get("articles") or [], "gnews", topic=topic, limit=max_results)

    normalized_category = _normalize_news_category(category, "gnews") or "general"
    data = _http_get(
        "https://gnews.io/api/v4/top-headlines",
        params={"category": normalized_category, "lang": language, "country": country, "max": max_results, "apikey": api_key},
        retries=1,
    )
    return _format_news_response(data.get("articles") or [], "gnews", category=normalized_category, limit=max_results)


def _fetch_google_news_rss(topic=None, category=None, country="us", language="en", limit=5):
    country = (country or "us").strip().upper()[:2]
    language = (language or "en").strip().lower()[:2]
    query = (topic or category or "").strip()

    if query:
        url = "https://news.google.com/rss/search"
        params = {"q": f"{query} when:1d", "hl": f"{language}-{country}", "gl": country, "ceid": f"{country}:{language}"}
    else:
        url = "https://news.google.com/rss"
        params = {"hl": f"{language}-{country}", "gl": country, "ceid": f"{country}:{language}"}

    xml_text = _http_get(url, params=params, retries=1, as_json=False)
    root = ET.fromstring(xml_text)
    articles = []
    for item in root.findall(".//item")[: max(1, min(int(limit or 5), 8))]:
        title_el = item.find("title")
        source_el = item.find("source")
        articles.append({
            "title": title_el.text if title_el is not None else "",
            "source": {"name": source_el.text if source_el is not None else "Google News"},
        })

    return _format_news_response(articles, "rss", topic=query or None, category=None, limit=limit)


def fetch_real_news(topic=None, category=None, country="us", language="en", limit=5):
    topic = (topic or "").strip()
    category = (category or "").strip().lower()
    country = (country or "us").strip().lower()[:2]
    language = (language or "en").strip().lower()[:2]
    try:
        limit = max(1, min(int(limit or 5), 8))
    except (TypeError, ValueError):
        limit = 5
    cache_key = (topic.lower(), category, country, language, limit)
    now = time.time()

    cached = _NEWS_CACHE.get(cache_key)
    if cached and now - cached[0] < NEWS_CACHE_TTL:
        return cached[1]

    providers = (_fetch_newsapi, _fetch_gnews, _fetch_google_news_rss)
    last_error = None
    for provider in providers:
        try:
            result = provider(topic=topic, category=category, country=country, language=language, limit=limit)
            if result:
                _NEWS_CACHE[cache_key] = (now, result)
                return result
        except Exception as e:
            last_error = e
            print(f"[NEWS] {provider.__name__} failed: {e}")

    if cached:
        return "I could not refresh live news, but the latest cached headlines are: " + cached[1].split(": ", 1)[-1]

    if last_error:
        print(f"[NEWS] Error fetching news: {last_error}")
    return "I could not fetch live news right now. Please try again in a moment."


from cad_agent import CadAgent
from web_agent import WebAgent
from kasa_agent import KasaAgent
from printer_agent import PrinterAgent

class AudioLoop:
    def __init__(self, video_mode=DEFAULT_MODE, on_audio_data=None, on_video_frame=None, on_cad_data=None, on_web_data=None, on_transcription=None, on_tool_confirmation=None, on_cad_status=None, on_cad_thought=None, on_project_update=None, on_device_update=None, on_error=None, on_ha_command=None, input_device_index=None, input_device_name=None, output_device_index=None, kasa_agent=None, on_interruption=None, on_frontend_action=None):
        self.video_mode = video_mode
        self.on_audio_data = on_audio_data
        self.on_video_frame = on_video_frame
        self.on_cad_data = on_cad_data
        self.on_web_data = on_web_data
        self.on_transcription = on_transcription
        self.on_tool_confirmation = on_tool_confirmation 
        self.on_cad_status = on_cad_status
        self.on_cad_thought = on_cad_thought
        self.on_project_update = on_project_update
        self.on_device_update = on_device_update
        self.on_error = on_error
        self.on_ha_command = on_ha_command
        self.input_device_index = input_device_index
        self.input_device_name = input_device_name
        self.output_device_index = output_device_index
        self.on_interruption = on_interruption
        self.on_frontend_action = on_frontend_action

        self.audio_in_queue = None
        self.out_queue = None
        self.user_audio_queue = asyncio.Queue(maxsize=USER_AUDIO_QUEUE_MAX)
        self.paused = False

        self.chat_buffer = {"sender": None, "text": ""} # For aggregating chunks
        
        # Track last transcription text to calculate deltas (Gemini sends cumulative text)
        self._last_input_transcription = ""
        self._last_output_transcription = ""

        self.session = None
        self._dropped_user_audio_chunks = 0
        self._dropped_realtime_chunks = 0
        self._dropped_playback_chunks = 0
        self._voice_turn_started_at = None
        self._first_input_transcription_at = None
        self._first_output_audio_at = None
        
        # Create CadAgent with thought callback
        def handle_cad_thought(thought_text):
            if self.on_cad_thought:
                self.on_cad_thought(thought_text)
        
        def handle_cad_status(status_info):
            if self.on_cad_status:
                self.on_cad_status(status_info)
        
        self.cad_agent = CadAgent(on_thought=handle_cad_thought, on_status=handle_cad_status)
        self.web_agent = WebAgent()
        self.kasa_agent = kasa_agent if kasa_agent else KasaAgent()
        self.printer_agent = PrinterAgent()

        self.send_text_task = None
        self.stop_event = asyncio.Event()
        self._session_connected_at = None  # Track connection uptime
        self._last_receive_at = None  # Track last successful receive
        
        self.permissions = {} # Default Empty (Will treat unset as True)
        self._pending_confirmations = {}

        # Video buffering state
        self._latest_image_payload = None
        # VAD State
        self._is_speaking = False
        self._silence_start_time = None
        self._speech_started_at = None
        self._audio_preroll = deque(maxlen=LOCAL_VAD_PREROLL_CHUNKS)
        self._vad_voiced_frames = 0
        self._vad_silent_frames = 0
        self._noise_floor_rms = 250.0
        self._last_interruption_at = 0.0
        self._last_input_transcription_interrupt_at = 0.0  # Separate debounce for input_transcription
        self._last_navigation_intent_view = None
        self._last_navigation_intent_at = 0.0
        
        # Initialize ProjectManager
        from project_manager import ProjectManager
        # Assuming we are running from backend/ or root? 
        # Using abspath of current file to find root
        current_dir = os.path.dirname(os.path.abspath(__file__))
        # If ada.py is in backend/, project root is one up
        project_root = os.path.dirname(current_dir)
        self.project_manager = ProjectManager(project_root)
        self.cached_events = []
        self.cached_tasks = []
        
        # Sync Initial Project State
        if self.on_project_update:
            # We need to defer this slightly or just call it. 
            # Since this is init, loop might not be running, but on_project_update in server.py uses asyncio.create_task which needs a loop.
            # We will handle this by calling it in run() or just print for now.
            pass

    def flush_chat(self):
        """Forces the current chat buffer to be written to log."""
        if self.chat_buffer["sender"] and self.chat_buffer["text"].strip():
            self.project_manager.log_chat(self.chat_buffer["sender"], self.chat_buffer["text"])
            self.chat_buffer = {"sender": None, "text": ""}
        # Reset transcription tracking for new turn
        self._last_input_transcription = ""
        self._last_output_transcription = ""

    def update_permissions(self, new_perms):
        print(f"[ORION DEBUG] [CONFIG] Updating tool permissions: {new_perms}")
        self.permissions.update(new_perms)

    def set_paused(self, paused):
        self.paused = paused

    def stop(self):
        self.stop_event.set()
        
    def resolve_tool_confirmation(self, request_id, confirmed):
        print(f"[ORION DEBUG] [RESOLVE] resolve_tool_confirmation called. ID: {request_id}, Confirmed: {confirmed}")
        if request_id in self._pending_confirmations:
            future = self._pending_confirmations[request_id]
            if not future.done():
                print(f"[ORION DEBUG] [RESOLVE] Future found and pending. Setting result to: {confirmed}")
                future.set_result(confirmed)
            else:
                 print(f"[ORION DEBUG] [WARN] Request {request_id} future already done. Result: {future.result()}")
        else:
            print(f"[ORION DEBUG] [WARN] Confirmation Request {request_id} not found in pending dict. Keys: {list(self._pending_confirmations.keys())}")

    def _start_voice_profile_turn(self, reason):
        self._voice_turn_started_at = time.perf_counter()
        self._first_input_transcription_at = None
        self._first_output_audio_at = None
        self._last_navigation_intent_view = None
        self._last_navigation_intent_at = 0.0
        self._profile_voice("turn_start", reason=reason)

    def _profile_voice(self, stage, **details):
        if not VOICE_PROFILE_ENABLED:
            return
        now = time.perf_counter()
        base = self._voice_turn_started_at or now
        elapsed_ms = int((now - base) * 1000)
        suffix = " ".join(f"{key}={value}" for key, value in details.items() if value is not None)
        print(f"[ORION PROFILE] {stage} +{elapsed_ms}ms {suffix}".rstrip())

    async def run_timed_tool(self, tool_name, awaitable, timeout=TOOL_TIMEOUT_SECONDS):
        start = time.perf_counter()
        self._profile_voice("tool_start", tool=tool_name)
        try:
            return await asyncio.wait_for(awaitable, timeout=timeout)
        except asyncio.TimeoutError:
            self._profile_voice("tool_timeout", tool=tool_name, timeout_s=timeout)
            return f"{tool_name.replace('_', ' ').title()} took too long to respond. Please try again in a moment."
        except Exception as e:
            self._profile_voice("tool_error", tool=tool_name, error=type(e).__name__)
            print(f"[ORION DEBUG] [TOOL] {tool_name} failed: {e}")
            return f"I had trouble using {tool_name.replace('_', ' ')} just now."
        finally:
            elapsed_ms = int((time.perf_counter() - start) * 1000)
            self._profile_voice("tool_end", tool=tool_name, elapsed_ms=elapsed_ms)

    def _record_queue_drop(self, label):
        if label == "mic":
            self._dropped_user_audio_chunks += 1
            dropped = self._dropped_user_audio_chunks
        elif label == "realtime":
            self._dropped_realtime_chunks += 1
            dropped = self._dropped_realtime_chunks
        else:
            self._dropped_playback_chunks += 1
            dropped = self._dropped_playback_chunks

        if dropped % 50 == 0:
            print(f"[ORION DEBUG] [AUDIO] Dropped {dropped} stale {label} chunks to keep realtime audio current.")

    def _put_drop_oldest(self, queue, item, label):
        if queue is None:
            return False

        try:
            queue.put_nowait(item)
            return True
        except asyncio.QueueFull:
            try:
                queue.get_nowait()
                self._record_queue_drop(label)
            except asyncio.QueueEmpty:
                pass

            try:
                queue.put_nowait(item)
                return True
            except asyncio.QueueFull:
                return False

    def enqueue_user_audio(self, data):
        return self._put_drop_oldest(self.user_audio_queue, data, "mic")

    def queue_realtime_input(self, payload):
        return self._put_drop_oldest(self.out_queue, payload, "realtime")

    def _drain_queue(self, queue):
        if not queue:
            return 0
        count = 0
        try:
            while not queue.empty():
                queue.get_nowait()
                count += 1
        except Exception as e:
            print(f"[ORION DEBUG] [ERR] Failed to drain queue: {e}")
        return count

    def clear_audio_queue(self):
        """Clears pending output audio so barge-in stops playback immediately."""
        count = self._drain_queue(self.audio_in_queue)
        if count > 0:
            print(f"[ORION DEBUG] [AUDIO] Cleared {count} chunks from playback queue due to interruption.")

    def reset_vad_state(self):
        self._is_speaking = False
        self._silence_start_time = None
        self._speech_started_at = None
        self._audio_preroll.clear()
        self._vad_voiced_frames = 0
        self._vad_silent_frames = 0

    def clear_pending_input_queues(self):
        mic_count = self._drain_queue(self.user_audio_queue)
        realtime_count = self._drain_queue(self.out_queue)
        self.reset_vad_state()
        if mic_count or realtime_count:
            print(f"[ORION DEBUG] [AUDIO] Dropped stale input queues after reconnect/error. mic={mic_count} realtime={realtime_count}")

    def notify_interruption(self, reason="barge_in", force=False):
        now = time.time()
        if not force and now - self._last_interruption_at < INTERRUPTION_MIN_INTERVAL_SECONDS:
            return False

        # Only trigger interruption if playback queue is active or forced
        has_active_playback = bool(self.audio_in_queue and not self.audio_in_queue.empty())

        if reason == "input_transcription":
            # Strong guard: input_transcription events are frequent cumulative updates.
            # Only interrupt if playback is genuinely happening AND enough time has passed
            # since the LAST input-transcription-sourced interruption (2s independent debounce).
            if not force:
                if not has_active_playback:
                    return False
                INPUT_TRANSCRIPTION_DEBOUNCE = 2.0
                if now - self._last_input_transcription_interrupt_at < INPUT_TRANSCRIPTION_DEBOUNCE:
                    return False
            self._last_input_transcription_interrupt_at = now
        elif not force and not has_active_playback:
            # For local_vad and server_interruption: allow even without active playback
            # (user started talking before model began, still valid barge-in)
            pass

        self._last_interruption_at = now
        self.clear_audio_queue()
        try:
            if self.web_agent:
                self.web_agent.request_cancel(reason)
        except Exception as e:
            print(f"[ORION DEBUG] [WEB] Failed to preempt browser task: {e}")

        if hasattr(self, 'on_interruption') and self.on_interruption:
            self.on_interruption()
        return True

    def _pcm_rms(self, data):
        count = len(data) // 2
        if count <= 0:
            return 0
        shorts = struct.unpack(f"<{count}h", data)
        sum_squares = sum(s**2 for s in shorts)
        return int(math.sqrt(sum_squares / count))

    def _image_blob_from_payload(self, frame_data):
        mime_type = "image/jpeg"
        raw_data = frame_data

        if isinstance(frame_data, types.Blob):
            return frame_data

        if isinstance(frame_data, dict):
            mime_type = frame_data.get("mime_type") or frame_data.get("mimeType") or mime_type
            raw_data = frame_data.get("data")

        if isinstance(raw_data, bytes):
            return types.Blob(data=raw_data, mime_type=mime_type)

        if isinstance(raw_data, str):
            if raw_data.startswith("data:") and "," in raw_data:
                header, raw_data = raw_data.split(",", 1)
                mime_type = header[5:].split(";", 1)[0] or mime_type

            try:
                return types.Blob(data=base64.b64decode(raw_data), mime_type=mime_type)
            except Exception as e:
                print(f"[ORION DEBUG] [VIDEO] Could not decode video frame for realtime input: {e}")
                return None

        return None

    def _dispatch_dashboard_navigation(self, intent, source, transcript=None):
        if not intent or not self.on_frontend_action:
            return False

        view = intent.get("view")
        if not view:
            return False

        now = time.monotonic()
        if self._last_navigation_intent_view == view and now - self._last_navigation_intent_at < 1.2:
            return True

        self._last_navigation_intent_view = view
        self._last_navigation_intent_at = now
        payload = {
            "tool": "navigate_dashboard",
            "view": view,
            "label": intent.get("label") or view,
            "matched_alias": intent.get("matched_alias"),
            "confidence": intent.get("confidence", 1.0),
            "source": source,
        }
        if transcript:
            payload["transcript"] = transcript[-180:]
        self.on_frontend_action(payload)
        self._profile_voice("dashboard_nav", view=view, source=source)
        return True

    def _maybe_dispatch_dashboard_navigation(self, transcript):
        intent = detect_dashboard_navigation(transcript)
        if not intent:
            return False
        return self._dispatch_dashboard_navigation(intent, "streaming_transcript", transcript)

    async def send_frame(self, frame_data):
        blob = self._image_blob_from_payload(frame_data)
        if blob:
            self._latest_image_payload = blob

    async def queue_latest_image(self):
        if not self._latest_image_payload:
            return False
        return self.queue_realtime_input({"type": "video", "blob": self._latest_image_payload})

    async def send_client_text(self, text, turn_complete=True):
        if not self.session:
            return
        content = types.Content(role="user", parts=[types.Part(text=text)])
        await self.session.send_client_content(turns=content, turn_complete=turn_complete)

    async def send_realtime(self):
        while True:
            msg = await self.out_queue.get()
            try:
                msg_type = msg.get("type") if isinstance(msg, dict) else None

                if msg_type == "audio":
                    await self.session.send_realtime_input(
                        audio=types.Blob(
                            data=msg["data"],
                            mime_type=f"audio/pcm;rate={SEND_SAMPLE_RATE}",
                        )
                    )
                elif msg_type == "video":
                    await self.session.send_realtime_input(video=msg["blob"])
                elif isinstance(msg, types.Blob):
                    await self.session.send_realtime_input(media=msg)
                else:
                    print(f"[ORION DEBUG] [WARN] Ignoring unknown realtime payload: {type(msg)}")
            except asyncio.CancelledError:
                raise
            except Exception as e:
                print(f"[ORION DEBUG] [ERR] Realtime send failed: {e}")
                self.clear_pending_input_queues()
                # Break gracefully instead of raising so TaskGroup can close cleanly without crashing active background agents
                break

    async def listen_audio(self):
        # Frontend streams 16 kHz PCM chunks into user_audio_queue. Local VAD gates
        # audio before Gemini so background noise cannot create endless turns.
        while True:
            if self.paused:
                self.clear_pending_input_queues()
                await asyncio.sleep(0.05)
                continue

            try:
                data = await self.user_audio_queue.get()
                rms = self._pcm_rms(data)
                now = time.time()
                
                # Check if audio output is currently playing
                has_active_playback = bool(self.audio_in_queue and not self.audio_in_queue.empty())
                
                # Elevate threshold and required voiced frames if model audio is currently playing
                if has_active_playback:
                    dynamic_threshold = max(int(LOCAL_VAD_MIN_RMS * 2.2), int(self._noise_floor_rms * LOCAL_VAD_NOISE_MULTIPLIER * 2.2))
                    required_start_frames = LOCAL_VAD_START_FRAMES + 2
                else:
                    dynamic_threshold = max(LOCAL_VAD_MIN_RMS, int(self._noise_floor_rms * LOCAL_VAD_NOISE_MULTIPLIER))
                    required_start_frames = LOCAL_VAD_START_FRAMES

                silence_threshold = max(300, int(dynamic_threshold * 0.45))

                if not self._is_speaking:
                    self._audio_preroll.append(data)
                    if rms < silence_threshold and not has_active_playback:
                        self._noise_floor_rms = (self._noise_floor_rms * 0.98) + (max(rms, 1) * 0.02)

                    if rms >= dynamic_threshold:
                        self._vad_voiced_frames += 1
                    else:
                        self._vad_voiced_frames = 0

                    if self._vad_voiced_frames >= required_start_frames:
                        self._is_speaking = True
                        self._speech_started_at = now
                        self._silence_start_time = None
                        self._vad_silent_frames = 0
                        print(f"[ORION DEBUG] [VAD] Speech confirmed (RMS: {rms}, threshold: {dynamic_threshold}). Interrupting playback once.")
                        self._start_voice_profile_turn("local_vad")
                        self.notify_interruption("local_vad", force=False)

                        if self._latest_image_payload:
                            self.queue_realtime_input({"type": "video", "blob": self._latest_image_payload})

                        for chunk in list(self._audio_preroll):
                            self.queue_realtime_input({"type": "audio", "data": chunk})
                        self._audio_preroll.clear()
                    continue

                self.queue_realtime_input({"type": "audio", "data": data})

                if rms < silence_threshold:
                    self._vad_silent_frames += 1
                    if self._silence_start_time is None:
                        self._silence_start_time = now
                    elif (now - self._silence_start_time) >= LOCAL_VAD_END_SECONDS and self._vad_silent_frames >= LOCAL_VAD_END_FRAMES:
                        print(f"[ORION DEBUG] [VAD] Speech ended after {now - (self._speech_started_at or now):.2f}s. Waiting for model turn.")
                        silent_chunk = b"\x00" * len(data)
                        for _ in range(LOCAL_VAD_POST_SILENCE_CHUNKS):
                            self.queue_realtime_input({"type": "audio", "data": silent_chunk})
                        self.reset_vad_state()
                else:
                    self._silence_start_time = None
                    self._vad_silent_frames = 0

            except asyncio.CancelledError:
                raise
            except Exception as e:
                print(f"Error processing user audio: {e}")
                await asyncio.sleep(0.1)

    async def handle_cad_request(self, prompt):
        print(f"[ORION DEBUG] [CAD] Background Task Started: handle_cad_request('{prompt}')")
        if self.on_cad_status:
            self.on_cad_status("generating")
            
        if self.project_manager.current_project == "temp":
            import datetime
            timestamp = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
            new_project_name = f"Project_{timestamp}"
            print(f"[ORION DEBUG] [CAD] Auto-creating project: {new_project_name}")
            
            success, msg = self.project_manager.create_project(new_project_name)
            if success:
                self.project_manager.switch_project(new_project_name)
                try:
                    await self.send_client_text(f"System Notification: Automatic Project Creation. Switched to new project '{new_project_name}'.", turn_complete=False)
                    if self.on_project_update:
                         self.on_project_update(new_project_name)
                except Exception as e:
                    print(f"[ORION DEBUG] [ERR] Failed to notify auto-project: {e}")

        cad_output_dir = str(self.project_manager.get_current_project_path() / "cad")
        
        cad_data = await self.cad_agent.generate_prototype(prompt, output_dir=cad_output_dir)
        
        if cad_data:
            print(f"[ORION DEBUG] [OK] CadAgent returned data successfully.")
            print(f"[ORION DEBUG] [INFO] Data Check: {len(cad_data.get('vertices', []))} vertices, {len(cad_data.get('edges', []))} edges.")
            
            if self.on_cad_data:
                print(f"[ORION DEBUG] [SEND] Dispatching data to frontend callback...")
                self.on_cad_data(cad_data)
                print(f"[ORION DEBUG] [SENT] Dispatch complete.")
            
            if 'file_path' in cad_data:
                self.project_manager.save_cad_artifact(cad_data['file_path'], prompt)
            else:
                 self.project_manager.save_cad_artifact("output.stl", prompt)

            completion_msg = "System Notification: CAD generation is complete! The 3D model is now displayed for the user. Let them know it's ready."
            try:
                await self.send_client_text(completion_msg, turn_complete=True)
                print(f"[ORION DEBUG] [NOTE] Sent completion notification to model.")
            except Exception as e:
                 print(f"[ORION DEBUG] [ERR] Failed to send completion notification: {e}")

        else:
            print(f"[ORION DEBUG] [ERR] CadAgent returned None.")
            try:
                await self.send_client_text("System Notification: CAD generation failed.", turn_complete=True)
            except Exception:
                pass

    async def handle_write_file(self, path, content):
        print(f"[ORION DEBUG] [FS] Writing file: '{path}'")
        
        if self.project_manager.current_project == "temp":
            import datetime
            timestamp = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
            new_project_name = f"Project_{timestamp}"
            print(f"[ORION DEBUG] [FS] Auto-creating project: {new_project_name}")
            
            success, msg = self.project_manager.create_project(new_project_name)
            if success:
                self.project_manager.switch_project(new_project_name)
                try:
                    await self.send_client_text(f"System Notification: Automatic Project Creation. Switched to new project '{new_project_name}'.", turn_complete=False)
                    if self.on_project_update:
                         self.on_project_update(new_project_name)
                except Exception as e:
                    print(f"[ORION DEBUG] [ERR] Failed to notify auto-project: {e}")
        
        filename = os.path.basename(path)
        current_project_path = self.project_manager.get_current_project_path()
        final_path = current_project_path / filename 
        
        if not os.path.isabs(path):
             final_path = current_project_path / path
        
        print(f"[ORION DEBUG] [FS] Resolved path: '{final_path}'")

        try:
            os.makedirs(os.path.dirname(final_path), exist_ok=True)
            with open(final_path, 'w', encoding='utf-8') as f:
                f.write(content)
            result = f"File '{final_path.name}' written successfully to project '{self.project_manager.current_project}'."
        except Exception as e:
            result = f"Failed to write file '{path}': {str(e)}"

        print(f"[ORION DEBUG] [FS] Result: {result}")
        try:
             await self.send_client_text(f"System Notification: {result}", turn_complete=True)
        except Exception as e:
             print(f"[ORION DEBUG] [ERR] Failed to send fs result: {e}")

    async def handle_read_directory(self, path):
        print(f"[ORION DEBUG] [FS] Reading directory: '{path}'")
        try:
            if not os.path.exists(path):
                result = f"Directory '{path}' does not exist."
            else:
                items = os.listdir(path)
                result = f"Contents of '{path}': {', '.join(items)}"
        except Exception as e:
            result = f"Failed to read directory '{path}': {str(e)}"

        print(f"[ORION DEBUG] [FS] Result: {result}")
        try:
             await self.send_client_text(f"System Notification: {result}", turn_complete=True)
        except Exception as e:
             print(f"[ORION DEBUG] [ERR] Failed to send fs result: {e}")

    async def handle_read_file(self, path):
        print(f"[ORION DEBUG] [FS] Reading file: '{path}'")
        try:
            if not os.path.exists(path):
                result = f"File '{path}' does not exist."
            else:
                with open(path, 'r', encoding='utf-8') as f:
                    content = f.read()
                result = f"Content of '{path}':\n{content}"
        except Exception as e:
            result = f"Failed to read file '{path}': {str(e)}"

        print(f"[ORION DEBUG] [FS] Result: {result}")
        try:
             await self.send_client_text(f"System Notification: {result}", turn_complete=True)
        except Exception as e:
             print(f"[ORION DEBUG] [ERR] Failed to send fs result: {e}")

    async def handle_web_agent_request(self, prompt):
        print(f"[ORION DEBUG] [WEB] Web Agent Task: '{prompt}'")
        
        async def update_frontend(image_b64, log_text, state_dict=None):
            if self.on_web_data:
                 payload = {"image": image_b64, "log": log_text}
                 if state_dict:
                     payload["state"] = state_dict
                 self.on_web_data(payload)
                 
        result = await self.web_agent.run_task(prompt, update_callback=update_frontend)
        print(f"[ORION DEBUG] [WEB] Web Agent Task Returned: {result}")

        if isinstance(result, str) and result.lower().startswith("browser task paused"):
             print("[ORION DEBUG] [WEB] Browser task paused by interruption; suppressing completion injection into the live voice turn.")
             return
        
        try:
             await self.send_client_text(f"System Notification: Web Agent has finished.\nResult: {result}", turn_complete=True)
        except Exception as e:
             print(f"[ORION DEBUG] [ERR] Failed to send web agent result to model: {e}")

    async def handle_discover_printers(self):
        """Background task: runs 5-second mDNS printer discovery and injects result into the voice session."""
        print(f"[ORION DEBUG] [PRINTER] Background printer discovery started.")
        try:
            printers = await self.printer_agent.discover_printers()
            if printers:
                printer_list = [
                    f"{p['name']} ({p['host']}:{p['port']}, type: {p['printer_type']})"
                    for p in printers
                ]
                result_str = "Printer discovery complete. Found printers:\n" + "\n".join(printer_list)
            else:
                result_str = "Printer discovery complete. No printers were found on the network. Ensure they are powered on and running OctoPrint or Moonraker."
        except Exception as e:
            result_str = f"Printer discovery failed: {e}"
        print(f"[ORION DEBUG] [PRINTER] Discovery result: {result_str}")
        try:
            await self.send_client_text(f"System Notification: {result_str}", turn_complete=True)
        except Exception as e:
            print(f"[ORION DEBUG] [ERR] Failed to inject printer discovery result: {e}")

    async def handle_print_stl_request(self, stl_path, printer, profile, root_path):
        """Background task: slices STL and uploads to printer, then injects result."""
        print(f"[ORION DEBUG] [PRINTER] Background print_stl started for '{stl_path}' on '{printer}'")
        try:
            result = await self.printer_agent.print_stl(
                stl_path, printer, profile, root_path=root_path
            )
            result_str = result.get("message", "Print job submitted.") if isinstance(result, dict) else str(result)
        except Exception as e:
            result_str = f"Print job failed: {e}"
        print(f"[ORION DEBUG] [PRINTER] print_stl result: {result_str}")
        try:
            await self.send_client_text(f"System Notification: {result_str}", turn_complete=True)
        except Exception as e:
            print(f"[ORION DEBUG] [ERR] Failed to inject print_stl result: {e}")

    async def handle_iterate_cad_request(self, prompt, cad_output_dir):
        """Background task: runs CAD iteration and dispatches new model to frontend, then injects result."""
        print(f"[ORION DEBUG] [CAD] Background iterate_cad started: '{prompt}'")
        try:
            cad_data = await self.cad_agent.iterate_prototype(prompt, output_dir=cad_output_dir)
            if cad_data:
                print(f"[ORION DEBUG] [CAD] Iteration returned data. Dispatching to frontend.")
                if self.on_cad_data:
                    self.on_cad_data(cad_data)
                self.project_manager.save_cad_artifact("output.stl", f"Iteration: {prompt}")
                result_str = f"CAD iteration complete: {prompt}. The updated 3D model is now displayed."
            else:
                print(f"[ORION DEBUG] [CAD] Iteration returned None.")
                result_str = "CAD iteration did not produce an output. Please try a more specific description."
        except Exception as e:
            result_str = f"CAD iteration failed: {e}"
        try:
            await self.send_client_text(f"System Notification: {result_str}", turn_complete=True)
        except Exception as e:
            print(f"[ORION DEBUG] [ERR] Failed to inject iterate_cad result: {e}")

    def load_latest_skin_context(self):
        scans_path = Path(__file__).resolve().parents[1] / ".tmp" / "saved_skin_scans.json"
        if not scans_path.exists():
            return "No skin scan records found yet. Advise the user to perform a skin scan on the Skin Analysis dashboard first."
        try:
            with scans_path.open("r", encoding="utf-8") as f:
                data = json.load(f)
            scan = data.get("latest") or (list(data.values())[-1] if data else None)
            if not scan:
                return "No skin scan records found yet. Advise the user to perform a skin scan first."
            
            score = scan.get("score", 85)
            skin_type = scan.get("finalSkinType") or scan.get("classification", "Normal Skin Type")
            summary = scan.get("aiExplanation", "")
            hydration = scan.get("hydration", 50)
            texture = scan.get("texture", 50)
            acne_sev = scan.get("acneSeverity", "Clear")
            
            routine = scan.get("routine", {})
            am_steps = routine.get("morning", [])
            pm_steps = routine.get("night", [])
            
            am_text = "; ".join([f"Step {s.get('step')}: {s.get('title')} ({s.get('productName')})" for s in am_steps]) if am_steps else "Gentle cleanser, hydrating moisturizer, and broad-spectrum sunscreen."
            pm_text = "; ".join([f"Step {s.get('step')}: {s.get('title')} ({s.get('productName')})" for s in pm_steps]) if pm_steps else "Gentle cleanser and barrier repair moisturizer."

            classes = scan.get("allClassifications", [])
            class_summary = ", ".join([f"{c.get('label', c.get('className'))}: {c.get('confidence', 0)}% ({'Detected' if c.get('detected') else 'Clear'})" for c in classes]) if classes else "Acne, Oily, Dryness, Wrinkles, Normal evaluated."

            return (
                f"Latest Skin Analysis Results:\n"
                f"- Primary Diagnosis: {skin_type}\n"
                f"- Overall Health Score: {score}%\n"
                f"- 5 Classifications: {class_summary}\n"
                f"- Hydration: {hydration}%, Texture: {texture}%, Acne Severity: {acne_sev}\n"
                f"- Morning Routine (AM): {am_text}\n"
                f"- Night Routine (PM): {pm_text}\n"
                f"- Gemini AI Diagnostic Summary: {summary}\n"
                f"Use this authentic data to answer the user's question accurately, concisely, and with a friendly tone."
            )
        except Exception as e:
            return f"Error reading skin analysis data: {e}"

    async def receive_audio(self):
        "Background task to reads from the websocket and write pcm chunks to the output queue"
        try:
            while True:
                turn = self.session.receive()
                async for response in turn:
                    if data := response.data:
                        if self._voice_turn_started_at and self._first_output_audio_at is None:
                            self._first_output_audio_at = time.perf_counter()
                            self._profile_voice("first_output_audio")
                        self._put_drop_oldest(self.audio_in_queue, data, "playback")

                    if response.server_content:
                        if response.server_content.interrupted:
                            print("[ORION DEBUG] [INTERRUPTION] Model was interrupted by server!")
                            self.notify_interruption("server_interruption")

                        if response.server_content.input_transcription:
                            transcript = response.server_content.input_transcription.text
                            if transcript:
                                if transcript != self._last_input_transcription:
                                    delta = transcript
                                    if transcript.startswith(self._last_input_transcription):
                                        delta = transcript[len(self._last_input_transcription):]
                                    self._last_input_transcription = transcript
                                    
                                    if delta:
                                        if self._voice_turn_started_at and self._first_input_transcription_at is None:
                                            self._first_input_transcription_at = time.perf_counter()
                                            self._profile_voice("first_input_transcript", chars=len(transcript))
                                        self.notify_interruption("input_transcription")
                                        self._maybe_dispatch_dashboard_navigation(transcript)

                                        if self.on_transcription:
                                             self.on_transcription({"sender": "User", "text": delta})
                                        
                                        if self.chat_buffer["sender"] != "User":
                                            if self.chat_buffer["sender"] and self.chat_buffer["text"].strip():
                                                self.project_manager.log_chat(self.chat_buffer["sender"], self.chat_buffer["text"])
                                            self.chat_buffer = {"sender": "User", "text": delta}
                                        else:
                                            self.chat_buffer["text"] += delta
                        
                        if response.server_content.output_transcription:
                            transcript = response.server_content.output_transcription.text
                            if transcript:
                                if transcript != self._last_output_transcription:
                                    delta = transcript
                                    if transcript.startswith(self._last_output_transcription):
                                        delta = transcript[len(self._last_output_transcription):]
                                    self._last_output_transcription = transcript
                                    
                                    if delta:
                                        if self.on_transcription:
                                             self.on_transcription({"sender": "Orion", "text": delta})
                                        
                                        if self.chat_buffer["sender"] != "Orion":
                                            if self.chat_buffer["sender"] and self.chat_buffer["text"].strip():
                                                self.project_manager.log_chat(self.chat_buffer["sender"], self.chat_buffer["text"])
                                            self.chat_buffer = {"sender": "Orion", "text": delta}
                                        else:
                                            self.chat_buffer["text"] += delta
                        
                    if response.tool_call:
                        print("The tool was called")
                        function_responses = []
                        for fc in response.tool_call.function_calls:
                            if fc.name in ["generate_cad", "run_web_agent", "navigate_dashboard", "write_file", "read_directory", "read_file", "create_project", "switch_project", "list_projects", "list_smart_devices", "control_light", "control_smart_home_device", "discover_printers", "print_stl", "get_print_status", "iterate_cad", "get_weather", "get_news", "manage_calendar", "manage_tasks", "analyze_skin", "get_skin_analysis", "refresh_skin_report_qr", "manage_music", "manage_alarm", "manage_timer", "manage_stopwatch"]:
                                self._profile_voice("tool_call", tool=fc.name)
                                prompt = fc.args.get("prompt", "") 
                                
                                confirmation_required = self.permissions.get(fc.name, False) if fc.name != "run_web_agent" else False
                                
                                if not confirmation_required:
                                    print(f"[ORION DEBUG] [TOOL] Permission check: '{fc.name}' -> AUTO-ALLOW")
                                    pass
                                else:
                                    if self.on_tool_confirmation:
                                        import uuid
                                        request_id = str(uuid.uuid4())
                                    print(f"[ORION DEBUG] [STOP] Requesting confirmation for '{fc.name}' (ID: {request_id})")
                                    
                                    future = asyncio.Future()
                                    self._pending_confirmations[request_id] = future
                                    
                                    self.on_tool_confirmation({
                                        "id": request_id, 
                                        "tool": fc.name, 
                                        "args": fc.args
                                    })
                                    
                                    try:
                                        confirmed = await future

                                    finally:
                                        self._pending_confirmations.pop(request_id, None)

                                    print(f"[ORION DEBUG] [CONFIRM] Request {request_id} resolved. Confirmed: {confirmed}")

                                    if not confirmed:
                                        print(f"[ORION DEBUG] [DENY] Tool call '{fc.name}' denied by user.")
                                        function_response = types.FunctionResponse(
                                            id=fc.id,
                                            name=fc.name,
                                            response={
                                                "result": "User denied the request to use this tool.",
                                            }
                                        )
                                        function_responses.append(function_response)
                                        continue

                                if fc.name == "navigate_dashboard":
                                    raw_view = fc.args.get("view") or fc.args.get("dashboard") or fc.args.get("target") or ""
                                    print(f"[ORION DEBUG] [TOOL] Tool Call: 'navigate_dashboard' View='{raw_view}'")
                                    intent = resolve_dashboard_route(raw_view) or detect_dashboard_navigation(raw_view)
                                    if intent and self._dispatch_dashboard_navigation(intent, "model_tool", raw_view):
                                        result_str = f"Opened {intent.get('label') or intent.get('view')} dashboard."
                                    else:
                                        result_str = f"I could not find a dashboard named '{raw_view}'."
                                    function_response = types.FunctionResponse(
                                        id=fc.id, name=fc.name, response={"result": result_str}
                                    )
                                    function_responses.append(function_response)

                                elif fc.name == "generate_cad":
                                    print(f"\n[ORION DEBUG] --------------------------------------------------")
                                    print(f"[ORION DEBUG] [TOOL] Tool Call Detected: 'generate_cad'")
                                    print(f"[ORION DEBUG] [IN] Arguments: prompt='{prompt}'")
                                    
                                    asyncio.create_task(self.handle_cad_request(prompt))
                                    function_response = types.FunctionResponse(
                                        id=fc.id, name=fc.name, response={"result": "CAD generation started."}
                                    )
                                    function_responses.append(function_response)
                                
                                elif fc.name == "run_web_agent":
                                    print(f"[ORION DEBUG] [TOOL] Tool Call: 'run_web_agent' with prompt='{prompt}'")
                                    asyncio.create_task(self.handle_web_agent_request(prompt))
                                    
                                    result_text = "Web Navigation started. Do not reply to this message."
                                    function_response = types.FunctionResponse(
                                        id=fc.id,
                                        name=fc.name,
                                        response={
                                            "result": result_text,
                                        }
                                    )
                                    print(f"[ORION DEBUG] [RESPONSE] Sending function response: {function_response}")
                                    function_responses.append(function_response)

                                elif fc.name == "write_file":
                                    path = fc.args["path"]
                                    content = fc.args["content"]
                                    print(f"[ORION DEBUG] [TOOL] Tool Call: 'write_file' path='{path}'")
                                    asyncio.create_task(self.handle_write_file(path, content))
                                    function_response = types.FunctionResponse(
                                        id=fc.id, name=fc.name, response={"result": "Writing file..."}
                                    )
                                    function_responses.append(function_response)

                                elif fc.name == "read_directory":
                                    path = fc.args["path"]
                                    print(f"[ORION DEBUG] [TOOL] Tool Call: 'read_directory' path='{path}'")
                                    asyncio.create_task(self.handle_read_directory(path))
                                    function_response = types.FunctionResponse(
                                        id=fc.id, name=fc.name, response={"result": "Reading directory..."}
                                    )
                                    function_responses.append(function_response)

                                elif fc.name == "read_file":
                                    path = fc.args["path"]
                                    print(f"[ORION DEBUG] [TOOL] Tool Call: 'read_file' path='{path}'")
                                    asyncio.create_task(self.handle_read_file(path))
                                    function_response = types.FunctionResponse(
                                        id=fc.id, name=fc.name, response={"result": "Reading file..."}
                                    )
                                    function_responses.append(function_response)

                                elif fc.name == "create_project":
                                    name = fc.args["name"]
                                    print(f"[ORION DEBUG] [TOOL] Tool Call: 'create_project' name='{name}'")
                                    success, msg = self.project_manager.create_project(name)
                                    if success:
                                        self.project_manager.switch_project(name)
                                        msg += f" Switched to '{name}'."
                                        if self.on_project_update:
                                            self.on_project_update(name)
                                    function_response = types.FunctionResponse(
                                        id=fc.id, name=fc.name, response={"result": msg}
                                    )
                                    function_responses.append(function_response)

                                elif fc.name == "switch_project":
                                    name = fc.args["name"]
                                    print(f"[ORION DEBUG] [TOOL] Tool Call: 'switch_project' name='{name}'")
                                    success, msg = self.project_manager.switch_project(name)
                                    if success:
                                        if self.on_project_update:
                                            self.on_project_update(name)
                                        context = self.project_manager.get_project_context()
                                        print(f"[ORION DEBUG] [PROJECT] Sending project context to AI ({len(context)} chars)")
                                        try:
                                            await self.send_client_text(f"System Notification: {msg}\n\n{context}", turn_complete=False)
                                        except Exception as e:
                                            print(f"[ORION DEBUG] [ERR] Failed to send project context: {e}")
                                    function_response = types.FunctionResponse(
                                        id=fc.id, name=fc.name, response={"result": msg}
                                    )
                                    function_responses.append(function_response)
                                
                                elif fc.name == "list_projects":
                                    print(f"[ORION DEBUG] [TOOL] Tool Call: 'list_projects'")
                                    projects = self.project_manager.list_projects()
                                    function_response = types.FunctionResponse(
                                        id=fc.id, name=fc.name, response={"result": f"Available projects: {', '.join(projects)}"}
                                    )
                                    function_responses.append(function_response)

                                elif fc.name == "list_smart_devices":
                                    print(f"[ORION DEBUG] [TOOL] Tool Call: 'list_smart_devices'")
                                    dev_summaries = []
                                    frontend_list = []
                                    
                                    for ip, d in self.kasa_agent.devices.items():
                                        dev_type = "unknown"
                                        if d.is_bulb: dev_type = "bulb"
                                        elif d.is_plug: dev_type = "plug"
                                        elif d.is_strip: dev_type = "strip"
                                        elif d.is_dimmer: dev_type = "dimmer"
                                        
                                        info = f"{d.alias} (IP: {ip}, Type: {dev_type})"
                                        if d.is_on:
                                            info += " [ON]"
                                        else:
                                            info += " [OFF]"
                                        dev_summaries.append(info)
                                        
                                        frontend_list.append({
                                            "ip": ip,
                                            "alias": d.alias,
                                            "model": d.model,
                                            "type": dev_type,
                                            "is_on": d.is_on,
                                            "brightness": d.brightness if d.is_bulb or d.is_dimmer else None,
                                            "hsv": d.hsv if d.is_bulb and d.is_color else None,
                                            "has_color": d.is_color if d.is_bulb else False,
                                            "has_brightness": d.is_dimmable if d.is_bulb or d.is_dimmer else False
                                        })
                                    
                                    result_str = "No devices found in cache."
                                    if dev_summaries:
                                        result_str = "Found Devices (Cached):\n" + "\n".join(dev_summaries)
                                    
                                    if self.on_device_update:
                                        self.on_device_update(frontend_list)

                                    function_response = types.FunctionResponse(
                                        id=fc.id, name=fc.name, response={"result": result_str}
                                    )
                                    function_responses.append(function_response)

                                elif fc.name == "control_light":
                                    target = fc.args["target"]
                                    action = fc.args["action"]
                                    brightness = fc.args.get("brightness")
                                    color = fc.args.get("color")
                                    
                                    print(f"[ORION DEBUG] [TOOL] Tool Call: 'control_light' Target='{target}' Action='{action}'")
                                    
                                    result_msg = f"Action '{action}' on '{target}' failed."
                                    success = False
                                    
                                    _kasa_timeout = 3.0
                                    if action == "turn_on":
                                        try:
                                            success = await asyncio.wait_for(self.kasa_agent.turn_on(target), timeout=_kasa_timeout)
                                        except asyncio.TimeoutError:
                                            success = False
                                            result_msg = f"Turning on '{target}' timed out — the device may be offline."
                                        if success:
                                            result_msg = f"Turned ON '{target}'."
                                    elif action == "turn_off":
                                        try:
                                            success = await asyncio.wait_for(self.kasa_agent.turn_off(target), timeout=_kasa_timeout)
                                        except asyncio.TimeoutError:
                                            success = False
                                            result_msg = f"Turning off '{target}' timed out — the device may be offline."
                                        if success:
                                            result_msg = f"Turned OFF '{target}'."
                                    elif action == "set":
                                        success = True
                                        result_msg = f"Updated '{target}':"

                                    if success or action == "set":
                                        if brightness is not None:
                                            try:
                                                sb = await asyncio.wait_for(self.kasa_agent.set_brightness(target, brightness), timeout=_kasa_timeout)
                                            except asyncio.TimeoutError:
                                                sb = False
                                            if sb:
                                                result_msg += f" Set brightness to {brightness}."
                                        if color is not None:
                                            try:
                                                sc = await asyncio.wait_for(self.kasa_agent.set_color(target, color), timeout=_kasa_timeout)
                                            except asyncio.TimeoutError:
                                                sc = False
                                            if sc:
                                                result_msg += f" Set color to {color}."

                                    if success:
                                        updated_list = []
                                        for ip, dev in self.kasa_agent.devices.items():
                                            dev_type = "unknown"
                                            if dev.is_bulb: dev_type = "bulb"
                                            elif dev.is_plug: dev_type = "plug"
                                            elif dev.is_strip: dev_type = "strip"
                                            elif dev.is_dimmer: dev_type = "dimmer"

                                            d_info = {
                                                "ip": ip,
                                                "alias": dev.alias,
                                                "model": dev.model,
                                                "type": dev_type,
                                                "is_on": dev.is_on,
                                                "brightness": dev.brightness if dev.is_bulb or dev.is_dimmer else None,
                                                "hsv": dev.hsv if dev.is_bulb and dev.is_color else None,
                                                "has_color": dev.is_color if dev.is_bulb else False,
                                                "has_brightness": dev.is_dimmable if dev.is_bulb or dev.is_dimmer else False
                                            }
                                            updated_list.append(d_info)
                                            
                                        if self.on_device_update:
                                            self.on_device_update(updated_list)
                                    else:
                                        if self.on_error:
                                            self.on_error(result_msg)

                                    function_response = types.FunctionResponse(
                                        id=fc.id, name=fc.name, response={"result": result_msg}
                                    )
                                    function_responses.append(function_response)

                                elif fc.name == "control_smart_home_device":
                                    domain = fc.args["domain"]
                                    service = fc.args["service"]
                                    data = fc.args.get("data", {})
                                    
                                    print(f"[ORION DEBUG] [TOOL] Tool Call: 'control_smart_home_device' Domain='{domain}' Service='{service}' Data='{data}'")
                                    
                                    if self.on_ha_command:
                                        self.on_ha_command({
                                            "domain": domain,
                                            "service": service,
                                            "data": data
                                        })
                                        result_msg = f"Sent {service} command to {domain} via Home Assistant."
                                    else:
                                        result_msg = "Home Assistant integration is not configured."
                                        print("[ORION DEBUG] [TOOL] Error: on_ha_command callback not set.")

                                    function_response = types.FunctionResponse(
                                        id=fc.id, name=fc.name, response={"result": result_msg}
                                    )
                                    function_responses.append(function_response)

                                elif fc.name == "discover_printers":
                                    print(f"[ORION DEBUG] [TOOL] Tool Call: 'discover_printers' (dispatching to background — 5s mDNS scan)")
                                    asyncio.create_task(self.handle_discover_printers())
                                    result_str = "Scanning the network for 3D printers now. I'll let you know what I find in a few seconds."
                                    function_response = types.FunctionResponse(
                                        id=fc.id, name=fc.name, response={"result": result_str}
                                    )
                                    function_responses.append(function_response)

                                elif fc.name == "print_stl":
                                    stl_path = fc.args["stl_path"]
                                    printer = fc.args["printer"]
                                    profile = fc.args.get("profile")
                                    print(f"[ORION DEBUG] [TOOL] Tool Call: 'print_stl' STL='{stl_path}' Printer='{printer}' (dispatching to background)")
                                    if stl_path.lower() == "current":
                                        stl_path = "output.stl"
                                    project_path = str(self.project_manager.get_current_project_path())
                                    asyncio.create_task(self.handle_print_stl_request(stl_path, printer, profile, project_path))
                                    result_str = "Starting the print job now. I'll let you know when slicing and upload are complete."
                                    function_response = types.FunctionResponse(
                                        id=fc.id, name=fc.name, response={"result": result_str}
                                    )
                                    function_responses.append(function_response)

                                elif fc.name == "get_print_status":
                                    printer = fc.args["printer"]
                                    print(f"[ORION DEBUG] [TOOL] Tool Call: 'get_print_status' Printer='{printer}'")
                                    status = await self.run_timed_tool(
                                        "get_print_status",
                                        self.printer_agent.get_print_status(printer),
                                        timeout=3.0,
                                    )
                                    if isinstance(status, str):
                                        # run_timed_tool returned an error/timeout string
                                        result_str = status
                                    elif status:
                                        result_str = f"Printer: {status.printer}\n"
                                        result_str += f"State: {status.state}\n"
                                        result_str += f"Progress: {status.progress_percent:.1f}%\n"
                                        if status.time_remaining:
                                            result_str += f"Time Remaining: {status.time_remaining}\n"
                                        if status.time_elapsed:
                                            result_str += f"Time Elapsed: {status.time_elapsed}\n"
                                        if status.filename:
                                            result_str += f"File: {status.filename}\n"
                                        if status.temperatures:
                                            temps = status.temperatures
                                            if "hotend" in temps:
                                                result_str += f"Hotend: {temps['hotend']['current']:.0f}°C / {temps['hotend']['target']:.0f}°C\n"
                                            if "bed" in temps:
                                                result_str += f"Bed: {temps['bed']['current']:.0f}°C / {temps['bed']['target']:.0f}°C"
                                    else:
                                        result_str = f"Could not get status for printer '{printer}'. Ensure it is discovered first."
                                    function_response = types.FunctionResponse(
                                        id=fc.id, name=fc.name, response={"result": result_str}
                                    )
                                    function_responses.append(function_response)

                                elif fc.name == "iterate_cad":
                                    prompt = fc.args["prompt"]
                                    print(f"[ORION DEBUG] [TOOL] Tool Call: 'iterate_cad' Prompt='{prompt}' (dispatching to background)")
                                    if self.on_cad_status:
                                        self.on_cad_status("generating")
                                    cad_output_dir = str(self.project_manager.get_current_project_path() / "cad")
                                    asyncio.create_task(self.handle_iterate_cad_request(prompt, cad_output_dir))
                                    result_str = "CAD iteration started. I'll update you when the new model is ready."
                                    function_response = types.FunctionResponse(
                                        id=fc.id, name=fc.name, response={"result": result_str}
                                    )
                                    function_responses.append(function_response)

                                elif fc.name == "get_weather":
                                    location = fc.args.get("location", "the current location")
                                    print(f"[ORION DEBUG] [TOOL] Tool Call: 'get_weather' Location='{location}'")
                                    result_str = await self.run_timed_tool(
                                        "get_weather",
                                        asyncio.to_thread(fetch_real_weather, location),
                                        timeout=3.5,
                                    )
                                    function_response = types.FunctionResponse(
                                        id=fc.id, name=fc.name, response={"result": result_str}
                                    )
                                    function_responses.append(function_response)

                                elif fc.name == "get_news":
                                    topic = fc.args.get("topic")
                                    category = fc.args.get("category")
                                    country = fc.args.get("country", "us")
                                    language = fc.args.get("language", "en")
                                    limit = fc.args.get("limit", 5)
                                    print(f"[ORION DEBUG] [TOOL] Tool Call: 'get_news' Topic='{topic}' Category='{category}'")
                                    result_str = await self.run_timed_tool(
                                        "get_news",
                                        asyncio.to_thread(fetch_real_news, topic, category, country, language, limit),
                                        timeout=3.5,
                                    )
                                    function_response = types.FunctionResponse(
                                        id=fc.id, name=fc.name, response={"result": result_str}
                                    )
                                    function_responses.append(function_response)

                                elif fc.name == "manage_calendar":
                                    action = (fc.args.get("action") or "").lower()
                                    title = fc.args.get("title", "")
                                    evt_id = fc.args.get("id")
                                    evt_type = fc.args.get("type", "meeting")
                                    day = fc.args.get("day")
                                    month = fc.args.get("month")
                                    year = fc.args.get("year")
                                    new_title = fc.args.get("new_title")
                                    new_type = fc.args.get("new_type")
                                    new_day = fc.args.get("new_day")
                                    new_month = fc.args.get("new_month")
                                    new_year = fc.args.get("new_year")

                                    print(f"[ORION DEBUG] [TOOL] Tool Call: 'manage_calendar' Action='{action}' Title='{title}'")

                                    if action == "list":
                                        events = list(self.cached_events)
                                        if day is not None:
                                            events = [ev for ev in events if int(ev.get("day", -1)) == int(day)]
                                        if month is not None:
                                            events = [ev for ev in events if int(ev.get("month", -1)) == int(month)]
                                        if year is not None:
                                            events = [ev for ev in events if int(ev.get("year", -1)) == int(year)]

                                        if not events:
                                            result_str = "There are no matching calendar events scheduled."
                                        else:
                                            months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
                                            ev_list = []
                                            for ev in events:
                                                m_idx = int(ev.get("month", 0))
                                                m_name = months[m_idx] if 0 <= m_idx < 12 else str(m_idx + 1)
                                                ev_list.append(f"- [{ev.get('type', 'event')}] {ev.get('title')} on {m_name} {ev.get('day')}, {ev.get('year')} (ID: {ev.get('id')})")
                                            result_str = "Current calendar events:\n" + "\n".join(ev_list)
                                    else:
                                        if self.on_frontend_action:
                                            self.on_frontend_action({
                                                "tool": "manage_calendar",
                                                "action": action,
                                                "title": title,
                                                "id": evt_id,
                                                "type": evt_type,
                                                "day": day,
                                                "month": month,
                                                "year": year,
                                                "newTitle": new_title,
                                                "newType": new_type,
                                                "newDay": new_day,
                                                "newMonth": new_month,
                                                "newYear": new_year,
                                            })
                                            result_str = f"Calendar action '{action}' was sent to the dashboard."
                                        else:
                                            result_str = "Frontend action handler is not connected."

                                    function_response = types.FunctionResponse(
                                        id=fc.id, name=fc.name, response={"result": result_str}
                                    )
                                    function_responses.append(function_response)

                                elif fc.name == "manage_tasks":
                                    action = (fc.args.get("action") or "").lower()
                                    title = fc.args.get("title", "")
                                    task_id = fc.args.get("id")
                                    new_title = fc.args.get("new_title")
                                    done = fc.args.get("done")

                                    print(f"[ORION DEBUG] [TOOL] Tool Call: 'manage_tasks' Action='{action}' Title='{title}'")

                                    if action == "list":
                                        if not self.cached_tasks:
                                            result_str = "There are no tasks on the Daily Tasks dashboard."
                                        else:
                                            task_lines = []
                                            for task in self.cached_tasks:
                                                status = "done" if task.get("done") else "not done"
                                                task_lines.append(f"- {task.get('label') or task.get('title')} ({status}, ID: {task.get('id')})")
                                            result_str = "Current Daily Tasks:\n" + "\n".join(task_lines)
                                    else:
                                        frontend_action = action
                                        frontend_done = done
                                        if action == "delete":
                                            frontend_action = "remove"
                                        elif action == "complete":
                                            frontend_action = "toggle"
                                            frontend_done = True
                                        elif action == "reopen":
                                            frontend_action = "toggle"
                                            frontend_done = False

                                        if self.on_frontend_action:
                                            self.on_frontend_action({
                                                "tool": "manage_tasks",
                                                "action": frontend_action,
                                                "title": title,
                                                "id": task_id,
                                                "newTitle": new_title,
                                                "done": frontend_done,
                                            })
                                            result_str = f"Task action '{action}' was sent to the dashboard."
                                        else:
                                            result_str = "Frontend action handler is not connected."

                                    function_response = types.FunctionResponse(
                                        id=fc.id, name=fc.name, response={"result": result_str}
                                    )
                                    function_responses.append(function_response)

                                elif fc.name == "analyze_skin":
                                    print(f"[ORION DEBUG] [TOOL] Tool Call: 'analyze_skin'")
                                    
                                    if self.on_frontend_action:
                                        self.on_frontend_action({
                                            "tool": "analyze_skin"
                                        })
                                        result_str = "Skin analysis dashboard opened and analysis triggered."
                                    else:
                                        result_str = "Frontend action handler not connected."
                                        
                                    function_response = types.FunctionResponse(
                                        id=fc.id, name=fc.name, response={"result": result_str}
                                    )
                                    function_responses.append(function_response)

                                elif fc.name == "get_skin_analysis":
                                    print(f"[ORION DEBUG] [TOOL] Tool Call: 'get_skin_analysis'")
                                    result_str = self.load_latest_skin_context()
                                    function_response = types.FunctionResponse(
                                        id=fc.id, name=fc.name, response={"result": result_str}
                                    )
                                    function_responses.append(function_response)

                                elif fc.name == "refresh_skin_report_qr":
                                    print(f"[ORION DEBUG] [TOOL] Tool Call: 'refresh_skin_report_qr'")
                                    if self.on_frontend_action:
                                        self.on_frontend_action({
                                            "tool": "refresh_skin_report_qr"
                                        })
                                        result_str = "QR Skin Report refreshed and ready to scan."
                                    else:
                                        result_str = "Frontend action handler not connected."
                                    function_response = types.FunctionResponse(
                                        id=fc.id, name=fc.name, response={"result": result_str}
                                    )
                                    function_responses.append(function_response)

                                elif fc.name == "manage_music":
                                    action = (fc.args.get("action") or "play").lower()
                                    query = fc.args.get("query", "")
                                    media_type = fc.args.get("media_type", "auto")
                                    volume = fc.args.get("volume")
                                    shuffle = fc.args.get("shuffle")
                                    repeat = fc.args.get("repeat")

                                    print(f"[ORION DEBUG] [TOOL] Tool Call: 'manage_music' Action='{action}' Query='{query}'")
                                    if self.on_frontend_action:
                                        self.on_frontend_action({
                                            "tool": "manage_music",
                                            "action": action,
                                            "query": query,
                                            "mediaType": media_type,
                                            "volume": volume,
                                            "shuffle": shuffle,
                                            "repeat": repeat,
                                        })
                                        if action == "play" and query:
                                            result_str = f"Starting {query} in the Orion Music Player."
                                        else:
                                            result_str = f"Music action '{action}' was sent to the Orion Music Player."
                                    else:
                                        result_str = "Orion Music Player action handler is not connected."

                                    function_response = types.FunctionResponse(
                                        id=fc.id, name=fc.name, response={"result": result_str}
                                    )
                                    function_responses.append(function_response)

                                elif fc.name == "manage_alarm":
                                    action = (fc.args.get("action") or "set").lower()
                                    time_str = fc.args.get("time", "")
                                    ringtone = fc.args.get("ringtone", "")
                                    print(f"[ORION DEBUG] [TOOL] Tool Call: 'manage_alarm' Action='{action}' Time='{time_str}'")
                                    if self.on_frontend_action:
                                        self.on_frontend_action({
                                            "tool": "manage_alarm",
                                            "action": action,
                                            "time": time_str,
                                            "ringtone": ringtone,
                                        })
                                        result_str = f"Alarm action '{action}' for {time_str or 'specified time'} executed."
                                    else:
                                        result_str = "Frontend action handler not connected for alarm."

                                    function_response = types.FunctionResponse(
                                        id=fc.id, name=fc.name, response={"result": result_str}
                                    )
                                    function_responses.append(function_response)

                                elif fc.name == "manage_timer":
                                    action = (fc.args.get("action") or "start").lower()
                                    duration = fc.args.get("duration_seconds")
                                    minutes = fc.args.get("minutes")
                                    seconds = fc.args.get("seconds")
                                    print(f"[ORION DEBUG] [TOOL] Tool Call: 'manage_timer' Action='{action}' Minutes={minutes} Seconds={seconds}")
                                    if self.on_frontend_action:
                                        self.on_frontend_action({
                                            "tool": "manage_timer",
                                            "action": action,
                                            "durationSeconds": duration,
                                            "minutes": minutes,
                                            "seconds": seconds,
                                        })
                                        result_str = f"Timer action '{action}' executed."
                                    else:
                                        result_str = "Frontend action handler not connected for timer."

                                    function_response = types.FunctionResponse(
                                        id=fc.id, name=fc.name, response={"result": result_str}
                                    )
                                    function_responses.append(function_response)

                                elif fc.name == "manage_stopwatch":
                                    action = (fc.args.get("action") or "start").lower()
                                    print(f"[ORION DEBUG] [TOOL] Tool Call: 'manage_stopwatch' Action='{action}'")
                                    if self.on_frontend_action:
                                        self.on_frontend_action({
                                            "tool": "manage_stopwatch",
                                            "action": action,
                                        })
                                        result_str = f"Stopwatch action '{action}' executed."
                                    else:
                                        result_str = "Frontend action handler not connected for stopwatch."

                                    function_response = types.FunctionResponse(
                                        id=fc.id, name=fc.name, response={"result": result_str}
                                    )
                                    function_responses.append(function_response)

                        if function_responses:
                            await self.session.send_tool_response(function_responses=function_responses)
                
                self.flush_chat()
        except asyncio.CancelledError:
            print(f"[ORION DEBUG] [AUDIO] receive_audio cancelled (normal shutdown).")
            raise
        except Exception as e:
            _uptime = f"{time.perf_counter() - self._session_connected_at:.1f}s" if self._session_connected_at else "unknown"
            print(f"[ORION DEBUG] [ERR] receive_audio crashed after {_uptime} uptime: {e}")
            traceback.print_exc()
            raise e

    async def play_audio(self):
        while True:
            bytestream = await self.audio_in_queue.get()
            if self.on_audio_data:
                self.on_audio_data(bytestream)

    async def get_frames(self):
        backend = cv2.CAP_DSHOW if sys.platform == "win32" else cv2.CAP_AVFOUNDATION
        cap = await asyncio.to_thread(cv2.VideoCapture, 0, backend)
        if not cap or not cap.isOpened():
            cap = await asyncio.to_thread(cv2.VideoCapture, 0)
        while True:
            if self.paused:
                await asyncio.sleep(0.1)
                continue
            frame = await asyncio.to_thread(self._get_frame, cap)
            if frame is None:
                break
            await asyncio.sleep(1.0)
            if self.out_queue:
                self.queue_realtime_input({"type": "video", "blob": frame})
        cap.release()

    def _get_frame(self, cap):
        ret, frame = cap.read()
        if not ret:
            return None
        frame_rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        img = PIL.Image.fromarray(frame_rgb)
        img.thumbnail([1024, 1024])
        image_io = io.BytesIO()
        img.save(image_io, format="jpeg")
        image_io.seek(0)
        image_bytes = image_io.read()
        return types.Blob(data=image_bytes, mime_type="image/jpeg")

    async def _get_screen(self):
        pass 
    async def get_screen(self):
         pass

    async def run(self, start_message=None):
        while not self.stop_event.is_set():
            try:
                print(f"[ORION DEBUG] [CONNECT] Connecting to Gemini Live API...")
                _connect_t0 = time.perf_counter()
                async with (
                    client.aio.live.connect(model=MODEL, config=config) as session,
                    asyncio.TaskGroup() as tg,
                ):
                    _connect_elapsed = int((time.perf_counter() - _connect_t0) * 1000)
                    print(f"[ORION LATENCY] Gemini Live API connected in {_connect_elapsed}ms")
                    self.session = session
                    self._session_connected_at = time.perf_counter()
                    self._last_receive_at = time.perf_counter()
                    self.audio_in_queue = asyncio.Queue(maxsize=PLAYBACK_QUEUE_MAX)
                    self.out_queue = asyncio.Queue(maxsize=REALTIME_QUEUE_MAX)
                    self.user_audio_queue = asyncio.Queue(maxsize=USER_AUDIO_QUEUE_MAX)
                    self.reset_vad_state()

                    running_tasks = [
                        tg.create_task(self.send_realtime()),
                        tg.create_task(self.listen_audio()),
                        tg.create_task(self.receive_audio()),
                        tg.create_task(self.play_audio()),
                    ]

                    if self.video_mode == "camera":
                        running_tasks.append(tg.create_task(self.get_frames()))
                    elif self.video_mode == "screen":
                        running_tasks.append(tg.create_task(self.get_screen()))

                    if not hasattr(self, "_reconnect_attempts"):
                        if start_message:
                            print(f"[ORION DEBUG] [INFO] Sending start message: {start_message}")
                            await self.send_client_text(start_message, turn_complete=True)
                        
                        if self.on_project_update and self.project_manager:
                            self.on_project_update(self.project_manager.current_project)
                    
                    else:
                        print(f"[ORION DEBUG] [RECONNECT] Connection restored.")
                        history = self.project_manager.get_recent_chat_history(limit=10)
                        context_msg = "System Notification: Connection was lost and just re-established. Here is the recent chat history to help you resume seamlessly:\n\n"
                        for entry in history:
                            sender = entry.get('sender', 'Unknown')
                            text = entry.get('text', '')
                            context_msg += f"[{sender}]: {text}\n"
                        context_msg += "\nPlease acknowledge the reconnection to the user (e.g. 'I lost connection for a moment, but I'm back...') and resume what you were doing."
                        await self.send_client_text(context_msg, turn_complete=True)

                    self._reconnect_attempts = 0
                    await self.stop_event.wait()
                    for task in running_tasks:
                        task.cancel()

            except asyncio.CancelledError:
                print(f"[ORION DEBUG] [STOP] Main loop cancelled.")
                break
                
            except Exception as e:
                _session_uptime = f"{time.perf_counter() - self._session_connected_at:.1f}s" if self._session_connected_at else "N/A"
                print(f"[ORION DEBUG] [ERR] Connection Error after {_session_uptime} uptime: {e}")
                traceback.print_exception(e)
                self._reconnect_attempts = getattr(self, "_reconnect_attempts", 0) + 1
                backoff = min(0.5 * (2 ** max(self._reconnect_attempts - 1, 0)), 8.0)
                backoff += random.uniform(0, 0.25)
                print(f"[ORION DEBUG] [RETRY] Reconnecting in {backoff:.2f} seconds (attempt #{self._reconnect_attempts})...")
                if self.on_error and self._reconnect_attempts >= 2:
                    self.on_error(f"Orion voice connection is recovering after {self._reconnect_attempts} disconnects.")
                await asyncio.sleep(backoff)
                self.clear_audio_queue()
                self.clear_pending_input_queues()
                continue
                
            finally:
                _session_uptime = f"{time.perf_counter() - self._session_connected_at:.1f}s" if self._session_connected_at else "N/A"
                print(f"[ORION DEBUG] [SESSION] Session ended. Uptime: {_session_uptime}")
                self.session = None
                self._session_connected_at = None

def get_input_devices():
    return []

def get_output_devices():
    return []

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--mode",
        type=str,
        default=DEFAULT_MODE,
        help="pixels to stream from",
        choices=["camera", "screen", "none"],
    )
    args = parser.parse_args()
    main = AudioLoop(video_mode=args.mode)
    asyncio.run(main.run())