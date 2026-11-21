import express from "express";
import path from "path";
import cors from "cors";
import dotenv from "dotenv";
import { GoogleGenAI } from "@google/genai";
import { spawn } from "child_process";
import net from "net";
import os from "os";
import fs from "fs";
import { CATALOG_PRODUCTS, generateDynamicRoutine, normalizeRecommendations, syncRecommendationsFromRoutine } from "./src/lib/skinRecommendations";
import { analyzeSkinWithYouCam, resolveYouCamApiKey } from "./src/lib/youcamMcpService";
const loadEnv = (appRoot?: string) => {
  const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
  const candidateDirs = [process.cwd(), path.dirname(process.execPath), resourcesPath, appRoot]
    .filter((dir): dir is string => Boolean(dir))
    .map((dir) => path.resolve(dir));
  const uniqueDirs = Array.from(new Set(candidateDirs));

  for (const dir of uniqueDirs) {
    dotenv.config({ path: path.join(dir, ".env.local") });
  }
  for (const dir of uniqueDirs) {
    dotenv.config({ path: path.join(dir, ".env") });
  }
};

loadEnv();

type ServerOptions = {
  port?: number;
  host?: string;
  appRoot?: string;
  useVite?: boolean;
};

const SPOTIFY_SCOPES = [
  "user-read-playback-state",
  "user-modify-playback-state",
  "user-read-currently-playing",
  "playlist-read-private",
  "playlist-read-collaborative",
  "user-library-read",
  "streaming",
  "app-remote-control",
  "user-read-email",
  "user-read-private",
  "user-top-read",
].join(" ");

const getPublicBaseUrl = (req: express.Request) => {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/$/, "");

  const forwardedProto = req.headers["x-forwarded-proto"];
  const host = req.headers["x-forwarded-host"] || req.get("host") || `127.0.0.1:${process.env.PORT || 3000}`;
  const hostValue = Array.isArray(host) ? host[0] : host;
  const isLocal = hostValue.startsWith("localhost") || hostValue.startsWith("127.0.0.1");
  const protocol = Array.isArray(forwardedProto)
    ? forwardedProto[0]
    : forwardedProto || (isLocal ? "http" : req.protocol || "https");

  return `${protocol}://${hostValue}`;
};

const spotifyCredentials = () => ({
  clientId: process.env.SPOTIFY_CLIENT_ID || "",
  clientSecret: process.env.SPOTIFY_CLIENT_SECRET || "",
});

const GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/userinfo.profile",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/calendar",
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/tasks",
].join(" ");

const googleCredentials = () => ({
  clientId: process.env.GOOGLE_CLIENT_ID || "",
  clientSecret: process.env.GOOGLE_CLIENT_SECRET || "",
});

const getGoogleRedirectUri = (req: express.Request) => {
  const configuredRedirect = process.env.GOOGLE_REDIRECT_URI?.trim();
  if (configuredRedirect) return configuredRedirect;

  const hostHeader = req.headers["x-forwarded-host"] || req.get("host") || "";
  const hostValue = Array.isArray(hostHeader) ? hostHeader[0] : hostHeader;

  if (hostValue && (hostValue.startsWith("localhost") || hostValue.startsWith("127.0.0.1"))) {
    const forwardedProto = req.headers["x-forwarded-proto"];
    const protocol = Array.isArray(forwardedProto) ? forwardedProto[0] : forwardedProto || "http";
    return `${protocol}://${hostValue}/api/google/callback`;
  }

  return `${getPublicBaseUrl(req)}/api/google/callback`;
};

const getSpotifyRedirectUri = (req: express.Request) => {
  const configuredRedirect = process.env.SPOTIFY_REDIRECT_URI?.trim();
  if (configuredRedirect) return configuredRedirect;

  return `${getPublicBaseUrl(req)}/api/spotify/callback`;
};

// In-memory skin scan cache and disk persistence for QR-based mobile report lookup
const SCANS_FILE = path.join(process.cwd(), ".tmp", "saved_skin_scans.json");
const savedSkinScansMap = new Map<string, any>();

function loadSavedSkinScans() {
  try {
    if (fs.existsSync(SCANS_FILE)) {
      const data = JSON.parse(fs.readFileSync(SCANS_FILE, "utf8"));
      for (const key of Object.keys(data)) {
        savedSkinScansMap.set(key, data[key]);
      }
    }
  } catch (e) {
    console.warn("Failed to load saved skin scans file:", e);
  }
}

function persistSkinScan(scan: any) {
  if (!scan) return;
  const idStr = String(scan.id || Date.now());
  savedSkinScansMap.set(idStr, scan);
  savedSkinScansMap.set("latest", scan);
  try {
    const tmpDir = path.dirname(SCANS_FILE);
    if (!fs.existsSync(tmpDir)) {
      fs.mkdirSync(tmpDir, { recursive: true });
    }
    const obj: Record<string, any> = {};
    savedSkinScansMap.forEach((v, k) => {
      obj[k] = v;
    });
    fs.writeFileSync(SCANS_FILE, JSON.stringify(obj, null, 2), "utf8");
  } catch (e) {
    console.warn("Failed to persist skin scan to disk:", e);
  }
}

loadSavedSkinScans();
const GEMINI_PRODUCT_IDS = new Set([
  'minimalist_salicylic_acid',
  'minimalist_niacinamide',
  'dot_key_cica_gel',
  'cetaphil_gentle_cleanser',
  'dot_key_ceramide_moisturizer',
  'requil_dry_touch_sunscreen',
  'foxtale_retinol_night_serum',
  'plum_green_tea_toner',
  'derma_co_vitamin_c',
  'minimalist_alpha_arbutin',
  'bioderma_atoderm_baume',
  'derma_co_salicylic_cleanser',
]);

function stripJsonFence(raw: string): string {
  return String(raw || '')
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
}

function cleanGeminiSummaryText(raw: unknown): string {
  let text = typeof raw === 'string' ? raw : JSON.stringify(raw ?? '');

  for (let i = 0; i < 3; i++) {
    text = stripJsonFence(text);
    if (!text) return '';

    try {
      const parsed = JSON.parse(text);
      if (typeof parsed === 'string') {
        text = parsed;
        continue;
      }
      if (parsed && typeof parsed === 'object') {
        const candidate = (parsed as any).summary || (parsed as any).text || (parsed as any).explanation;
        if (typeof candidate === 'string') {
          text = candidate;
          continue;
        }
      }
    } catch (_) {
      break;
    }
  }

  const summaryMatch = text.match(/["']summary["']\s*:\s*["']?([\s\S]*)/i);
  if (summaryMatch && summaryMatch[1]) {
    text = summaryMatch[1]
      .replace(/["']?\s*,\s*["']productIds["'][\s\S]*$/i, '')
      .replace(/["']?\s*,\s*["']products["'][\s\S]*$/i, '')
      .replace(/["']?\s*}\s*$/i, '');
  }

  return text
    .replace(/\\n/g, '\n')
    .replace(/\\"/g, '"')
    .replace(/^\s*["']|["']\s*$/g, '')
    .replace(/^(?:hey there!?|hello!?|hi!?|welcome to orion!?),?\s*(?:i'm gemini ai,?\s*your skin health consultant\.?)?\s*/i, '')
    .trim();
}

function cleanGeminiProductIds(raw: unknown): string[] {
  const ids = Array.isArray(raw) ? raw : [];
  return Array.from(new Set(ids
    .map(id => String(id || '').trim().toLowerCase())
    .filter(id => GEMINI_PRODUCT_IDS.has(id))))
    .slice(0, 3);
}

function parseGeminiRoutine(parsed: any, metrics?: any): { morning: any[]; night: any[] } | null {
  if (!parsed || typeof parsed !== 'object') return null;
  const rawMorning = Array.isArray(parsed.morningRoutine) ? parsed.morningRoutine : Array.isArray(parsed.morning) ? parsed.morning : null;
  const rawNight = Array.isArray(parsed.nightRoutine) ? parsed.nightRoutine : Array.isArray(parsed.night) ? parsed.night : null;
  if (!rawMorning || !rawNight || rawMorning.length === 0 || rawNight.length === 0) {
    return null;
  }

  let totalNutritionCount = 0;
  const sanitizeItems = (rawList: any[], timeOfDay: 'am' | 'pm') => {
    const list: any[] = [];
    let stepNum = 1;
    for (const item of rawList) {
      if (!item || typeof item !== 'object') continue;
      const title = String(item.title || item.name || (timeOfDay === 'am' ? 'Morning Step' : 'Night Step')).trim();
      const rawCat = String(item.category || '').toLowerCase();
      let category: 'cleanser' | 'serum' | 'moisturizer' | 'sunscreen' | 'treatment' | 'lifestyle' = 'treatment';
      if (rawCat.includes('clean')) category = 'cleanser';
      else if (rawCat.includes('serum')) category = 'serum';
      else if (rawCat.includes('moistur') || rawCat.includes('cream') || rawCat.includes('hydrat')) category = 'moisturizer';
      else if (rawCat.includes('sun') || rawCat.includes('spf')) category = 'sunscreen';
      else if (rawCat.includes('life') || rawCat.includes('nutri') || rawCat.includes('diet') || rawCat.includes('water') || rawCat.includes('habit') || rawCat.includes('sleep') || rawCat.includes('stress')) category = 'lifestyle';
      else category = 'treatment';

      const isNutrition = category === 'lifestyle' ||
        /diet|nutri|water|drink|seed|fruit|vegetable|snack|smoothie|meal|food|eat|sleep|stress|walk/i.test(title + ' ' + (item.instruction || '') + ' ' + (item.product || '') + ' ' + (item.productName || ''));

      // STRICT USER REQUIREMENT: No more than two nutritional/lifestyle recommendations in total across both routines!
      if (isNutrition) {
        if (totalNutritionCount >= 2) {
          continue; // Discard excess nutritional items to strictly observe the <= 2 limit
        }
        totalNutritionCount++;
        category = 'lifestyle';
      }

      let catalogProductId = item.catalogProductId ? String(item.catalogProductId).toLowerCase().trim() : undefined;
      if (catalogProductId && !GEMINI_PRODUCT_IDS.has(catalogProductId)) {
        catalogProductId = undefined;
      }

      let productName = String(item.product || item.productName || item.instruction || title).trim();
      if (catalogProductId && (CATALOG_PRODUCTS as any)[catalogProductId]) {
        productName = (CATALOG_PRODUCTS as any)[catalogProductId].name;
      }

      const reason = String(item.reason || item.instruction || 'Supports healthy skin barrier and cellular recovery.').trim();

      list.push({
        id: `gemini_${timeOfDay}_${stepNum}`,
        step: stepNum++,
        title,
        category,
        productName,
        reason,
        completed: false,
        timeOfDay,
        catalogProductId,
      });
    }
    return list;
  };

  const morning = sanitizeItems(rawMorning, 'am');
  const night = sanitizeItems(rawNight, 'pm');

  if (morning.length === 0 || night.length === 0) return null;
  return { morning, night };
}

function parseGeminiSkinPayload(rawOutput: string, metrics?: any): {
  text: string;
  spokenSummary: string;
  productIds: string[];
  routine?: any;
} {
  const cleanJson = stripJsonFence(rawOutput);

  try {
    const parsed = JSON.parse(cleanJson);
    const summaryText = cleanGeminiSummaryText(parsed?.summary || parsed?.text || parsed?.explanation || cleanJson);
    const quickTake = parsed?.quickTake ? String(parsed.quickTake).trim() : '';
    let text = summaryText;
    if (quickTake && !text.includes('Quick Take:')) {
      text = text + (quickTake.startsWith('📌') ? `\n\n${quickTake}` : `\n\n📌 Quick Take: ${quickTake}`);
    }
    const productIds = cleanGeminiProductIds(parsed?.productIds);
    const routineData = parseGeminiRoutine(parsed, metrics);
    const routine = routineData ? {
      lastUpdated: new Date().toISOString(),
      morning: routineData.morning,
      night: routineData.night,
    } : undefined;

    return {
      text,
      spokenSummary: text.replace(/\n+/g, ' ').slice(0, 180),
      productIds,
      routine,
    };
  } catch (_) {
    const productIdsMatch = cleanJson.match(/["']productIds["']\s*:\s*\[([\s\S]*?)\]/i);
    const productIds = productIdsMatch
      ? cleanGeminiProductIds(productIdsMatch[1].split(',').map(id => id.replace(/["'\s]/g, '')))
      : [];

    const text = cleanGeminiSummaryText(cleanJson);
    return {
      text,
      spokenSummary: text.replace(/\n+/g, ' ').slice(0, 180),
      productIds,
    };
  }
}

function decodeCompactScanQuery(queryData: string): any {
  try {
    const rawB64 = decodeURIComponent(queryData);
    let jsonStr = '';
    if (typeof Buffer !== 'undefined') {
      jsonStr = Buffer.from(rawB64, 'base64url').toString('utf8');
      if (!jsonStr || jsonStr.startsWith('\ufffd')) {
        jsonStr = Buffer.from(rawB64, 'base64').toString('utf8');
      }
    }
    if (!jsonStr) return null;
    const compact = JSON.parse(jsonStr);
    return {
      id: compact.i,
      date: compact.d,
      score: compact.s,
      hydration: compact.h,
      texture: compact.t,
      acneSeverity: compact.a,
      acneScore: compact.q,
      uvDamage: compact.u,
      uvScore: compact.v,
      classification: compact.c,
      finalSkinType: compact.f,
      aiExplanation: compact.x,
      imageUrl: compact.m,
      routine: compact.o,
      topThreeClasses: (compact.k || []).map((item: any) => ({
        label: item.l,
        confidence: item.c,
        severity: item.s,
      })),
      allClassifications: compact.all,
      recommendations: (compact.r || []).map((item: any) => ({
        brand: item.b,
        name: item.n,
        category: item.c,
        reason: item.r,
      })),
    };
  } catch (e) {
    console.warn('Failed to decode compact scan query param:', e);
    return null;
  }
}

function getAllFiveReportClasses(scan: any): Array<{
  key: string;
  label: string;
  confidence: number;
  status: string;
  isDetected: boolean;
  color: string;
}> {
  const existingList = Array.isArray(scan.allClassifications) ? scan.allClassifications : [];
  const findExisting = (pattern: RegExp) => existingList.find((c: any) => pattern.test(c.className || c.label || ''));

  // 1. Acne
  const acneItem = findExisting(/acne/i);
  const acneDetected = acneItem ? Boolean(acneItem.detected ?? (acneItem.confidence >= 45)) : (scan.acneDetected ?? ((scan.acneScore ?? 0) > 35));
  const acneConf = acneItem?.confidence ?? scan.acneScore ?? 20;
  const acneStatus = acneDetected ? (acneItem?.severity || scan.acneSeverity || 'Detected') : 'Not Detected';

  // 2. Dry Skin
  const dryItem = findExisting(/dry/i);
  const dryDetected = dryItem ? Boolean(dryItem.detected ?? (dryItem.confidence >= 45)) : ((scan.hydration ?? 80) < 65);
  const dryConf = dryItem?.confidence ?? (scan.hydration ? Math.max(10, 100 - scan.hydration) : 25);
  const dryStatus = dryDetected ? (dryItem?.severity || 'Detected') : 'Not Detected';

  // 3. Oily Skin
  const oilyItem = findExisting(/oil/i);
  const oilyDetected = oilyItem ? Boolean(oilyItem.detected ?? (oilyItem.confidence >= 45)) : (/oil/i.test(scan.classification || scan.finalSkinType || ''));
  const oilyConf = oilyItem?.confidence ?? (oilyDetected ? 72 : 28);
  const oilyStatus = oilyDetected ? (oilyItem?.severity || 'Detected') : 'Not Detected';

  // 4. Wrinkles
  const wrinkleItem = findExisting(/wrinkle/i);
  const wrinkleDetected = wrinkleItem ? Boolean(wrinkleItem.detected ?? (wrinkleItem.confidence >= 45)) : ((scan.texture ?? 80) < 65);
  const wrinkleConf = wrinkleItem?.confidence ?? (scan.texture ? Math.max(10, 100 - scan.texture) : 20);
  const wrinkleStatus = wrinkleDetected ? (wrinkleItem?.severity || 'Detected') : 'Not Detected';

  // 5. Normal Skin
  const normalItem = findExisting(/normal/i);
  const normalDetected = normalItem ? Boolean(normalItem.detected ?? (normalItem.confidence >= 45)) : ((scan.score ?? 85) >= 75 && !acneDetected);
  const normalConf = normalItem?.confidence ?? (scan.score ?? 80);
  const normalStatus = normalDetected ? 'Balanced / Optimal' : 'Needs Optimization';

  return [
    { key: 'acne', label: '1. Acne & Active Blemishes', confidence: acneConf, status: acneStatus, isDetected: acneDetected, color: '#f87171' },
    { key: 'dry', label: '2. Dry Skin & Dehydration', confidence: dryConf, status: dryStatus, isDetected: dryDetected, color: '#fbbf24' },
    { key: 'oily', label: '3. Oily Skin & Excess Sebum', confidence: oilyConf, status: oilyStatus, isDetected: oilyDetected, color: '#38bdf8' },
    { key: 'wrinkles', label: '4. Wrinkles & Texture Aging', confidence: wrinkleConf, status: wrinkleStatus, isDetected: wrinkleDetected, color: '#c084fc' },
    { key: 'normal', label: '5. Normal Skin & Barrier Balance', confidence: normalConf, status: normalStatus, isDetected: normalDetected, color: '#34d399' },
  ];
}

function renderSkinReportHTMLServer(scan: any, historyCount: number): string {
  const scanId = (scan.id || Date.now().toString()).toString();
  const dateStr = new Date(scan.date || Date.now()).toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit'
  });
  const score = scan.score ?? 85;
  const finalType = scan.finalSkinType || `${scan.classification || 'Normal'} Skin Type`;
  const fiveClasses = getAllFiveReportClasses(scan);

  const routine = scan.routine || generateDynamicRoutine(scan);
  const morningSteps: Array<any> = routine?.morning || [];
  const nightSteps: Array<any> = routine?.night || [];

  const savedRecs = normalizeRecommendations(scan.recommendations || []);
  const recs: Array<any> = savedRecs.length > 0
    ? savedRecs
    : syncRecommendationsFromRoutine(routine);

  const statusBadge = score >= 80 ? 'Optimal Dermal Integrity' : score >= 65 ? 'Moderate Care Recommended' : 'Clinical Attention Suggested';
  const statusColor = score >= 80 ? '#38bdf8' : score >= 65 ? '#fbbf24' : '#f87171';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Orion AI Skin Assessment Report - #${scanId.slice(0, 8)}</title>
  <style>
    :root {
      --primary: #0284c7;
      --primary-light: #38bdf8;
      --bg: #0b1120;
      --card-bg: #1e293b;
      --border: #334155;
      --text: #f8fafc;
      --text-muted: #94a3b8;
    }
    * { box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      background: var(--bg);
      color: var(--text);
      margin: 0;
      padding: 32px 16px;
      line-height: 1.5;
      -webkit-font-smoothing: antialiased;
    }
    .report-card {
      max-width: 860px;
      margin: 0 auto;
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 24px;
      padding: 36px;
      box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.7);
    }
    .top-bar {
      display: flex;
      justify-content: space-between;
      align-items: center;
      border-bottom: 2px solid var(--border);
      padding-bottom: 22px;
      margin-bottom: 28px;
    }
    .clinic-brand {
      display: flex;
      flex-direction: column;
    }
    .clinic-logo {
      font-size: 22px;
      font-weight: 900;
      letter-spacing: 1.5px;
      color: #38bdf8;
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .clinic-sub {
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 2px;
      color: var(--text-muted);
      margin-top: 4px;
      font-weight: 600;
    }
    .download-btn {
      background: linear-gradient(135deg, #0284c7, #0369a1);
      color: #ffffff;
      border: none;
      padding: 11px 22px;
      border-radius: 12px;
      font-weight: 700;
      font-size: 13px;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 8px;
      box-shadow: 0 4px 14px rgba(2, 132, 199, 0.35);
      transition: all 0.2s ease;
    }
    .download-btn:hover { background: #0284c7; transform: translateY(-1px); }

    /* Biometric Facial Scan Card at Top */
    .biometric-card {
      background: rgba(15, 23, 42, 0.85);
      border: 1px solid rgba(56, 189, 248, 0.35);
      border-radius: 20px;
      padding: 20px;
      margin-bottom: 30px;
      box-shadow: 0 10px 30px rgba(0, 0, 0, 0.45);
    }
    .biometric-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 14px;
      padding: 0 4px;
    }
    .biometric-title {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      font-size: 11px;
      font-weight: 800;
      letter-spacing: 1px;
      color: #38bdf8;
      text-transform: uppercase;
    }
    .pulse-dot {
      width: 8px;
      height: 8px;
      background: #38bdf8;
      border-radius: 50%;
      box-shadow: 0 0 8px #38bdf8;
      display: inline-block;
    }
    .biometric-id {
      font-size: 11px;
      color: #94a3b8;
      font-weight: 700;
    }
    .biometric-image-wrapper {
      width: 100%;
      max-width: 360px;
      margin: 0 auto;
      border-radius: 16px;
      overflow: hidden;
      border: 1px solid rgba(255, 255, 255, 0.12);
      background: #020617;
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.6);
    }
    .biometric-image {
      width: 100%;
      height: auto;
      max-height: 420px;
      object-fit: cover;
      display: block;
    }
    .biometric-caption {
      text-align: center;
      font-size: 11px;
      color: #94a3b8;
      margin-top: 10px;
    }
    
    .meta-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
      gap: 14px;
      background: rgba(15, 23, 42, 0.65);
      border: 1px solid var(--border);
      padding: 16px 20px;
      border-radius: 16px;
      margin-bottom: 28px;
      font-size: 13px;
    }
    .meta-item label { display: block; color: var(--text-muted); font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 2px; }
    .meta-item span { font-weight: 700; color: #ffffff; }

    .score-summary {
      display: flex;
      align-items: center;
      justify-content: space-between;
      background: linear-gradient(135deg, rgba(2, 132, 199, 0.18), rgba(99, 102, 241, 0.18));
      border: 1px solid rgba(56, 189, 248, 0.35);
      padding: 24px 28px;
      border-radius: 20px;
      margin-bottom: 30px;
    }
    .score-number {
      font-size: 52px;
      font-weight: 900;
      color: #38bdf8;
      line-height: 1;
      letter-spacing: -1px;
    }
    .score-label {
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 1px;
      color: var(--text-muted);
      font-weight: 700;
    }
    .type-badge {
      display: inline-block;
      background: rgba(56, 189, 248, 0.2);
      color: #38bdf8;
      border: 1px solid rgba(56, 189, 248, 0.4);
      padding: 6px 14px;
      border-radius: 20px;
      font-size: 13px;
      font-weight: 800;
      margin-top: 8px;
    }

    .section-title {
      font-size: 14px;
      font-weight: 800;
      color: #38bdf8;
      text-transform: uppercase;
      letter-spacing: 1px;
      margin-bottom: 14px;
    }

    .concerns-card {
      background: rgba(15, 23, 42, 0.7);
      border: 1px solid var(--border);
      padding: 24px;
      border-radius: 18px;
      margin-bottom: 30px;
    }
    .concern-row { margin-bottom: 14px; }
    .concern-row:last-child { margin-bottom: 0; }
    .bar-outer { width: 100%; height: 8px; background: rgba(255, 255, 255, 0.1); border-radius: 4px; overflow: hidden; margin-top: 6px; }
    .bar-inner { height: 100%; border-radius: 4px; }

    .metrics-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 14px;
      margin-bottom: 30px;
    }
    .metric-card {
      background: rgba(15, 23, 42, 0.7);
      border: 1px solid var(--border);
      padding: 18px 20px;
      border-radius: 16px;
    }
    .metric-title { font-size: 11px; font-weight: 700; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 6px; }
    .metric-val { font-size: 20px; font-weight: 800; color: #ffffff; }

    .summary-box {
      background: rgba(2, 132, 199, 0.08);
      border: 1px solid rgba(56, 189, 248, 0.3);
      padding: 24px;
      border-radius: 18px;
      margin-bottom: 30px;
    }
    .summary-box p { margin: 0; color: #cbd5e1; font-size: 14px; line-height: 1.7; }

    /* Routines Styling */
    .routines-container {
      background: rgba(15, 23, 42, 0.7);
      border: 1px solid var(--border);
      padding: 24px;
      border-radius: 18px;
      margin-bottom: 30px;
    }
    .routine-columns {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
      gap: 20px;
    }
    .routine-col {
      background: rgba(255, 255, 255, 0.02);
      border: 1px solid rgba(255, 255, 255, 0.06);
      border-radius: 16px;
      padding: 18px;
    }
    .routine-col-title {
      font-size: 13px;
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-bottom: 14px;
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .am-title { color: #38bdf8; }
    .pm-title { color: #c084fc; }
    .routine-step-list { display: flex; flex-direction: column; gap: 12px; }
    .routine-item {
      padding: 12px 14px;
      background: rgba(255, 255, 255, 0.04);
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 12px;
      font-size: 12px;
    }
    .lifestyle-item {
      background: rgba(16, 185, 129, 0.06);
      border-color: rgba(16, 185, 129, 0.2);
    }
    .routine-item-top {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 6px;
      margin-bottom: 4px;
    }
    .step-badge {
      font-size: 10px;
      font-weight: 800;
      color: #38bdf8;
      text-transform: uppercase;
    }
    .step-title {
      font-weight: 700;
      color: #ffffff;
      flex: 1;
    }
    .step-cat {
      font-size: 9px;
      text-transform: uppercase;
      font-weight: 700;
      padding: 2px 6px;
      border-radius: 6px;
      background: rgba(255, 255, 255, 0.1);
      color: #94a3b8;
    }
    .step-product {
      font-weight: 600;
      color: #38bdf8;
      margin-bottom: 4px;
      font-size: 12px;
    }
    .step-reason {
      color: #94a3b8;
      font-size: 11px;
      line-height: 1.5;
    }

    /* Product Links */
    .verified-product-link {
      color: #38bdf8;
      text-decoration: none;
      font-weight: 700;
      display: inline-flex;
      align-items: center;
      gap: 4px;
      transition: color 0.2s ease;
    }
    .verified-product-link:hover {
      color: #7dd3fc;
      text-decoration: underline;
    }

    .recommendations-box {
      background: rgba(15, 23, 42, 0.7);
      border: 1px solid var(--border);
      padding: 24px;
      border-radius: 18px;
      margin-bottom: 30px;
    }
    .rec-item {
      padding: 14px 18px;
      background: rgba(255, 255, 255, 0.03);
      border-left: 4px solid #38bdf8;
      border-radius: 8px;
      margin-bottom: 12px;
    }
    .rec-item:last-child { margin-bottom: 0; }
    .rec-price-badge {
      font-size: 11px;
      font-weight: 800;
      color: #10b981;
      background: rgba(16, 185, 129, 0.15);
      padding: 3px 8px;
      border-radius: 6px;
      border: 1px solid rgba(16, 185, 129, 0.3);
      white-space: nowrap;
    }

    .disclaimer {
      font-size: 11px;
      color: var(--text-muted);
      border-top: 1px solid var(--border);
      padding-top: 22px;
      text-align: center;
      line-height: 1.6;
    }

    @media print {
      body { background: #ffffff !important; color: #0f172a !important; padding: 0 !important; }
      .report-card { border: none !important; box-shadow: none !important; background: #ffffff !important; max-width: 100% !important; padding: 0 !important; }
      .download-btn { display: none !important; }
      .meta-grid, .metric-card, .concerns-card, .recommendations-box, .routines-container, .biometric-card { background: #f8fafc !important; border: 1px solid #cbd5e1 !important; }
      .summary-box { background: #f0f9ff !important; border: 1px solid #bae6fd !important; }
      .summary-box p, .metric-val, .meta-item span, .step-title { color: #0f172a !important; }
      .meta-item label, .metric-title, .score-label, .disclaimer, .step-reason { color: #475569 !important; }
      .score-summary { background: #e0f2fe !important; border: 1px solid #7dd3fc !important; }
      .score-number { color: #0284c7 !important; }
      .type-badge { background: #bae6fd !important; color: #0369a1 !important; border-color: #7dd3fc !important; }
      .bar-outer { background: #e2e8f0 !important; }
      .rec-item { background: #f1f5f9 !important; border-left-color: #0284c7 !important; }
      .rec-item span { color: #0f172a !important; }
      .rec-item p { color: #334155 !important; }
      .verified-product-link { color: #0284c7 !important; }
    }
    @media (max-width: 640px) {
      body { padding: 12px; }
      .report-card { padding: 22px 16px; border-radius: 16px; }
      .metrics-grid { grid-template-columns: 1fr; }
      .routine-columns { grid-template-columns: 1fr; }
      .score-summary { flex-direction: column; text-align: center; gap: 16px; }
      .top-bar { flex-direction: column; align-items: flex-start; gap: 16px; }
      .download-btn { width: 100%; justify-content: center; }
    }
  </style>
</head>
<body>
  <div class="report-card">
    <div class="top-bar">
      <div class="clinic-brand">
        <div class="clinic-logo">🔬 ORION HEALTHCARE LABS</div>
        <div class="clinic-sub">Clinical AI Skin Health Assessment Report</div>
      </div>
      <button class="download-btn" onclick="window.print()">📥 Download Report (PDF)</button>
    </div>

    <!-- 1. Actual Scanned Facial Image Prominently at Top -->
    ${scan.imageUrl ? `
    <div class="biometric-card">
      <div class="biometric-header">
        <span class="biometric-title">
          <span class="pulse-dot"></span> Verified Biometric Facial Scan
        </span>
        <span class="biometric-id">#${scanId.slice(0, 8).toUpperCase()}</span>
      </div>
      <div class="biometric-image-wrapper">
        <img src="${scan.imageUrl}" alt="Biometric Face Scan #${scanId.slice(0, 8)}" class="biometric-image" />
      </div>
      <div class="biometric-caption">
        Actual facial image captured and analyzed for this diagnostic report (${dateStr})
      </div>
    </div>
    ` : `
    <div class="biometric-card" style="text-align: center; padding: 20px; color: #94a3b8; font-size: 13px;">
      Facial biometric capture archived for this assessment record.
    </div>
    `}

    <!-- 2. Metadata Grid -->
    <div class="meta-grid">
      <div class="meta-item">
        <label>Record ID</label>
        <span>#${scanId.slice(0, 8).toUpperCase()}</span>
      </div>
      <div class="meta-item">
        <label>Date &amp; Time</label>
        <span>${dateStr}</span>
      </div>
      <div class="meta-item">
        <label>Assessment Type</label>
        <span>Facial AI Skin Diagnostic</span>
      </div>
      <div class="meta-item">
        <label>Scan Sequence</label>
        <span>Record #${historyCount || 1}</span>
      </div>
    </div>

    <!-- 3. Overall Score Summary -->
    <div class="score-summary">
      <div>
        <div class="score-label">Overall Skin Health Index</div>
        <div class="type-badge">${finalType}</div>
      </div>
      <div style="text-align: right;">
        <div class="score-number">${score}%</div>
        <div class="score-label" style="color: ${statusColor}; font-weight: 800;">${statusBadge}</div>
      </div>
    </div>

    <!-- 4. ALL FIVE Skin Classifications (Never Just Top Three) -->
    <div class="concerns-card">
      <div class="section-title">Detected Skin Characteristics &amp; Concerns</div>
      <p style="font-size: 12px; color: #94a3b8; margin: -10px 0 16px 0;">
        Full 5-category diagnostic spectrum evaluated for this facial assessment.
      </p>
      ${fiveClasses.map((item) => `
        <div class="concern-row">
          <div style="display: flex; justify-content: space-between; align-items: center; font-size: 13px;">
            <strong style="color: #f8fafc;">${item.label}</strong>
            <span style="font-size: 11px; font-weight: 800; padding: 3px 10px; border-radius: 12px; background: ${item.isDetected ? 'rgba(56, 189, 248, 0.15)' : 'rgba(148, 163, 184, 0.1)'}; color: ${item.isDetected ? item.color : '#94a3b8'}; border: 1px solid ${item.isDetected ? item.color + '44' : 'rgba(148, 163, 184, 0.2)'}; text-transform: uppercase;">
              ${item.status} (${item.confidence}%)
            </span>
          </div>
          <div class="bar-outer">
            <div class="bar-inner" style="width: ${Math.max(5, Math.min(100, item.confidence))}%; background: ${item.color};"></div>
          </div>
        </div>
      `).join('')}
    </div>

    <!-- 5. Clinical Assessment Metrics -->
    <div class="section-title">Clinical Assessment Metrics</div>
    <div class="metrics-grid">
      <div class="metric-card">
        <div class="metric-title">Acne &amp; Inflammatory Activity</div>
        <div class="metric-val">${scan.acneSeverity || 'Mild'} (${scan.acneScore || 20}/100)</div>
      </div>
      <div class="metric-card">
        <div class="metric-title">Epidermal Hydration Level</div>
        <div class="metric-val">${scan.hydration || 80}%</div>
      </div>
      <div class="metric-card">
        <div class="metric-title">Texture Smoothness Index</div>
        <div class="metric-val">${scan.texture || 80}%</div>
      </div>
      <div class="metric-card">
        <div class="metric-title">UV Photodamage Index</div>
        <div class="metric-val">${scan.uvDamage || 'Low'} (${scan.uvScore || 15}/100)</div>
      </div>
    </div>

    <!-- 6. Gemini AI Summary -->
    ${scan.aiExplanation ? `
    <div class="summary-box">
      <div class="section-title">Gemini AI Summary</div>
      <p>${scan.aiExplanation.replace(/\n\n/g, '</p><p style="margin-top: 10px;">')}</p>
    </div>
    ` : ''}

    <!-- 7. Personalized Daily Skincare Routine (AM & PM) -->
    <div class="routines-container">
      <div class="section-title">Personalized Daily Skincare Routine</div>
      <p style="font-size: 12px; color: #94a3b8; margin: -10px 0 18px 0;">
        Actionable daily regimen generated by Gemini AI tailored directly to detected skin characteristics.
      </p>
      <div class="routine-columns">
        <!-- Morning Routine -->
        <div class="routine-col">
          <div class="routine-col-title am-title">☀️ Morning Routine (AM)</div>
          <div class="routine-step-list">
            ${morningSteps.map((s: any) => `
              <div class="routine-item ${s.category === 'lifestyle' ? 'lifestyle-item' : ''}">
                <div class="routine-item-top">
                  <span class="step-badge">Step ${s.step}</span>
                  <span class="step-title">${s.title}</span>
                  <span class="step-cat">${s.category}</span>
                </div>
                <div class="step-product">
                  ${s.catalogProductId && (CATALOG_PRODUCTS as any)[s.catalogProductId] ? `
                    <a href="${(CATALOG_PRODUCTS as any)[s.catalogProductId].productUrl}" target="_blank" rel="noopener noreferrer" class="verified-product-link">
                      ${s.productName} ↗
                    </a>
                  ` : `<span>${s.productName}</span>`}
                </div>
                <div class="step-reason">${s.reason}</div>
              </div>
            `).join('')}
          </div>
        </div>

        <!-- Night Routine -->
        <div class="routine-col">
          <div class="routine-col-title pm-title">🌙 Night Routine (PM)</div>
          <div class="routine-step-list">
            ${nightSteps.map((s: any) => `
              <div class="routine-item ${s.category === 'lifestyle' ? 'lifestyle-item' : ''}">
                <div class="routine-item-top">
                  <span class="step-badge">Step ${s.step}</span>
                  <span class="step-title">${s.title}</span>
                  <span class="step-cat">${s.category}</span>
                </div>
                <div class="step-product">
                  ${s.catalogProductId && (CATALOG_PRODUCTS as any)[s.catalogProductId] ? `
                    <a href="${(CATALOG_PRODUCTS as any)[s.catalogProductId].productUrl}" target="_blank" rel="noopener noreferrer" class="verified-product-link">
                      ${s.productName} ↗
                    </a>
                  ` : `<span>${s.productName}</span>`}
                </div>
                <div class="step-reason">${s.reason}</div>
              </div>
            `).join('')}
          </div>
        </div>
      </div>
    </div>

    <!-- 8. Verified Skincare Recommendations (Clickable Links) -->
    <div class="recommendations-box">
      <div class="section-title">Verified Skincare Recommendations</div>
      <p style="font-size: 12px; color: #94a3b8; margin: -10px 0 16px 0;">
        Personalized products matching detected skin profile. Tap any product to open its official purchase page.
      </p>
      ${recs.map((r: any) => `
        <div class="rec-item">
          <div style="display: flex; justify-content: space-between; align-items: center; gap: 8px;">
            <a href="${r.productUrl}" target="_blank" rel="noopener noreferrer" class="verified-product-link" style="font-size: 14px; font-weight: 800;">
              ${r.brand ? `${r.brand} ` : ''}${r.name || r.title} ↗
            </a>
            <span class="rec-price-badge">${r.price || 'Verified Item'}</span>
          </div>
          <p style="margin: 6px 0 0 0; font-size: 13px; color: #94a3b8;">${r.whyRecommended || r.reason || r.description}</p>
        </div>
      `).join('')}
    </div>

    <div class="disclaimer">
      <strong>Clinical Disclaimer:</strong> This automated dermatological assessment is generated by Orion AI Smart Mirror for personal tracking and informational monitoring. It does not constitute formal medical diagnosis or clinical treatment planning. For persistent or severe skin conditions, please consult a licensed board-certified dermatologist.
    </div>
  </div>
</body>
</html>`;
}

export async function startServer(options: ServerOptions = {}) {
  const app = express();
  const PORT = Number(options.port || process.env.PORT || 3001);
  const HOST = options.host || process.env.HOST || "0.0.0.0";
  const appRoot = options.appRoot || process.cwd();
  loadEnv(appRoot);

  app.use(cors());
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));

  app.get("/api/news", async (req, res) => {
    try {
      const newsApiKey = process.env.NEWS_API_KEY;
      const gnewsApiKey = process.env.GNEWS_API_KEY;
      let articles: Array<{ id: string | number; title: string; category: string; time: string; image: string; isNew: boolean; timestamp: number }> = [];

      const fallbackImages = [
        "https://images.unsplash.com/photo-1451187580459-43490279c0fa?w=200&h=200&fit=crop",
        "https://images.unsplash.com/photo-1590845947698-8924d7409b56?w=200&h=200&fit=crop",
        "https://images.unsplash.com/photo-1518770660439-4636190af475?w=200&h=200&fit=crop",
        "https://images.unsplash.com/photo-1504384308090-c894fdcc538d?w=200&h=200&fit=crop",
        "https://images.unsplash.com/photo-1495020689067-958852a7765e?w=200&h=200&fit=crop",
      ];

      if (newsApiKey) {
        try {
          const response = await fetch(`https://newsapi.org/v2/top-headlines?country=us&pageSize=10&apiKey=${newsApiKey}`);
          if (response.ok) {
            const data = await response.json();
            if (data.articles && data.articles.length > 0) {
              articles = data.articles.map((item: any, idx: number) => {
                const pubTime = item.publishedAt ? new Date(item.publishedAt).getTime() : Date.now() - idx * 600000;
                const diffHours = Math.max(1, Math.floor((Date.now() - pubTime) / 3600000));
                return {
                  id: item.url || `newsapi-${idx}`,
                  title: (item.title || "").split(" - ")[0],
                  category: item.source?.name || "World News",
                  time: `${diffHours}h ago`,
                  image: item.urlToImage || fallbackImages[idx % fallbackImages.length],
                  isNew: idx === 0,
                  timestamp: pubTime,
                };
              });
            }
          }
        } catch (err) {
          console.warn("NewsAPI error, attempting fallback:", err);
        }
      }

      if (articles.length < 5 && gnewsApiKey) {
        try {
          const response = await fetch(`https://gnews.io/api/v4/top-headlines?category=general&lang=en&max=10&apikey=${gnewsApiKey}`);
          if (response.ok) {
            const data = await response.json();
            if (data.articles && data.articles.length > 0) {
              const gArticles = data.articles.map((item: any, idx: number) => {
                const pubTime = item.publishedAt ? new Date(item.publishedAt).getTime() : Date.now() - idx * 600000;
                const diffHours = Math.max(1, Math.floor((Date.now() - pubTime) / 3600000));
                return {
                  id: item.url || `gnews-${idx}`,
                  title: item.title,
                  category: item.source?.name || "World News",
                  time: `${diffHours}h ago`,
                  image: item.image || fallbackImages[idx % fallbackImages.length],
                  isNew: idx === 0,
                  timestamp: pubTime,
                };
              });
              articles = [...articles, ...gArticles];
            }
          }
        } catch (err) {
          console.warn("GNews error, attempting RSS fallback:", err);
        }
      }

      if (articles.length < 5) {
        try {
          const rssRes = await fetch("https://news.google.com/rss?hl=en-US&gl=US&ceid=US:en");
          if (rssRes.ok) {
            const xml = await rssRes.text();
            const items = xml.split("<item>").slice(1, 10);
            const rssArticles = items.map((itemStr, idx) => {
              const titleMatch = itemStr.match(/<title>(.*?)<\/title>/);
              const pubDateMatch = itemStr.match(/<pubDate>(.*?)<\/pubDate>/);
              const sourceMatch = itemStr.match(/<source[^>]*>(.*?)<\/source>/);
              const linkMatch = itemStr.match(/<link>(.*?)<\/link>/);

              let rawTitle = titleMatch ? titleMatch[1].replace(/<!\[CDATA\[(.*?)\]\]>/, "$1") : "Latest Headline";
              const lastDashIndex = rawTitle.lastIndexOf(" - ");
              if (lastDashIndex !== -1) {
                rawTitle = rawTitle.substring(0, lastDashIndex);
              }
              const source = sourceMatch ? sourceMatch[1] : "Google News";
              const pubDate = pubDateMatch ? new Date(pubDateMatch[1]) : new Date();
              const pubTime = isNaN(pubDate.getTime()) ? Date.now() - idx * 600000 : pubDate.getTime();
              const diffHours = Math.max(1, Math.floor((Date.now() - pubTime) / (1000 * 60 * 60)));
              const link = linkMatch ? linkMatch[1] : `rss-${idx}`;

              return {
                id: link,
                title: rawTitle,
                category: source || "World News",
                time: `${diffHours}h ago`,
                image: fallbackImages[idx % fallbackImages.length],
                isNew: idx === 0,
                timestamp: pubTime,
              };
            });
            articles = [...articles, ...rssArticles];
          }
        } catch (rssErr) {
          console.warn("RSS news fetch error:", rssErr);
        }
      }

      // Offline static fallback items if network fetch returned fewer than 5 items
      if (articles.length < 5) {
        const defaultFallbackStories = [
          { id: "fallback-1", title: "Global Tech Summit Unveils New Innovations", category: "Tech News", time: "2h ago", image: fallbackImages[0], isNew: false, timestamp: Date.now() - 7200000 },
          { id: "fallback-2", title: "Breakthroughs in Renewable Energy Infrastructure", category: "Environment", time: "4h ago", image: fallbackImages[1], isNew: false, timestamp: Date.now() - 14400000 },
          { id: "fallback-3", title: "Commercial Space Flight Reaches Milestone", category: "Science", time: "6h ago", image: fallbackImages[2], isNew: false, timestamp: Date.now() - 21600000 },
          { id: "fallback-4", title: "Next Generation AI Models Enhance Local Processing", category: "AI & Tech", time: "8h ago", image: fallbackImages[3], isNew: false, timestamp: Date.now() - 28800000 },
          { id: "fallback-5", title: "Global Medical Research Advances Healthcare Frontiers", category: "Health", time: "10h ago", image: fallbackImages[4], isNew: false, timestamp: Date.now() - 36000000 },
        ];
        articles = [...articles, ...defaultFallbackStories];
      }

      // Deduplicate by stable ID or title
      const seen = new Set<string>();
      const deduplicated = articles.filter(art => {
        const key = String(art.id || art.title).trim().toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });

      // Sort strictly by timestamp descending
      deduplicated.sort((a, b) => b.timestamp - a.timestamp);

      // Always return exactly 5 items
      const top5 = deduplicated.slice(0, 5).map(({ timestamp, ...rest }) => rest);
      res.json({ articles: top5 });
    } catch (error) {
      console.error("Failed to fetch news:", error);
      res.status(500).json({ error: "Failed to fetch news" });
    }
  });

  app.post("/api/chat", async (req, res) => {
    try {
      const { message, systemContext } = req.body;
      if (!message) {
        return res.status(400).json({ error: "Message is required" });
      }
      if (!process.env.GEMINI_API_KEY) {
        return res.status(503).json({ error: "GEMINI_API_KEY is not configured" });
      }

      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      const response = await ai.models.generateContent({
        model: process.env.ORION_TEXT_MODEL || "gemini-2.5-flash",
        contents: `User: ${message}`,
        config: {
          systemInstruction: systemContext || "You are Orion, the AI assistant for the Orion Smart Mirror. Keep responses very short, natural, and conversational. If a local smart mirror action has already run, acknowledge it briefly.",
          temperature: 0.5,
          maxOutputTokens: 120,
        },
      });

      res.json({ text: response.text });
    } catch (error) {
      console.error("Gemini API Error:", error);
      res.status(500).json({ error: "Failed to process chat" });
    }
  });

function getRealLANIP(req?: express.Request): string {
  if (process.env.MOBILE_NETWORK_IP || process.env.LAN_IP) {
    return process.env.MOBILE_NETWORK_IP || process.env.LAN_IP || "127.0.0.1";
  }

  if (req && req.headers && req.headers.host) {
    const hostIp = req.headers.host.split(":")[0];
    if (net.isIPv4(hostIp) && hostIp !== "127.0.0.1" && hostIp !== "localhost" && !hostIp.startsWith("192.168.56.")) {
      return hostIp;
    }
  }

  const interfaces = os.networkInterfaces();
  const candidates: Array<{ name: string; address: string; score: number }> = [];

  for (const name of Object.keys(interfaces)) {
    const nameLower = name.toLowerCase();

    const isVirtual =
      nameLower.includes("virtualbox") ||
      nameLower.includes("vbox") ||
      nameLower.includes("vmware") ||
      nameLower.includes("vethernet") ||
      nameLower.includes("wsl") ||
      nameLower.includes("hyper-v") ||
      nameLower.includes("pseudo") ||
      nameLower.includes("loopback") ||
      nameLower.includes("docker") ||
      nameLower.includes("host-only") ||
      nameLower.includes("npcap") ||
      nameLower.includes("tap") ||
      nameLower.includes("tun") ||
      nameLower.includes("bluetooth") ||
      nameLower.includes("vpn");

    for (const iface of interfaces[name] || []) {
      if (iface.family === "IPv4" && !iface.internal) {
        const addr = iface.address;

        if (addr.startsWith("127.") || addr.startsWith("192.168.56.") || isVirtual) {
          continue;
        }

        let score = 10;
        if (nameLower.includes("wi-fi") || nameLower.includes("wifi") || nameLower.includes("wireless") || nameLower.includes("wlan")) {
          score = 100;
        } else if (nameLower.includes("ethernet") || nameLower.includes("lan") || nameLower.includes("local area connection")) {
          score = 80;
        } else if (addr.startsWith("192.168.") || addr.startsWith("10.") || (addr.startsWith("172.") && !addr.startsWith("172.28."))) {
          score = 50;
        }

        candidates.push({ name, address: addr, score });
      }
    }
  }

  if (candidates.length > 0) {
    candidates.sort((a, b) => b.score - a.score);
    return candidates[0].address;
  }

  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name] || []) {
      if (iface.family === "IPv4" && !iface.internal && !iface.address.startsWith("192.168.56.")) {
        return iface.address;
      }
    }
  }

  return "127.0.0.1";
}

  app.get("/api/system/network-ip", (req, res) => {
    try {
      const lanIp = getRealLANIP(req);
      res.json({ ip: lanIp, port: PORT });
    } catch (e) {
      res.json({ ip: "127.0.0.1", port: PORT });
    }
  });

  // Strictly single dedicated endpoint for YouCam AI Skin Analysis.
  // Legacy aliases (/predict, /api/skin/debug) are decommissioned to prevent duplicate calls.
  app.post("/api/skin/analyze", async (req, res) => {
    try {
      const { image, userId, debug } = req.body;
      if (!image) {
        return res.status(400).json({ error: "Image data is required" });
      }

      console.log(`[SKIN ANALYSIS] Invoking YouCam Beauty AI via MCP server (user: ${userId || 'anonymous'})...`);

      const apiKey = resolveYouCamApiKey();
      if (!apiKey) {
        console.warn("[SKIN ANALYSIS] YOUCAM_API_KEY is not configured in .env.local");
        return res.status(400).json({
          status: 'error',
          error: 'YOUCAM_API_KEY is not configured in .env.local. Please add your YouCam API key to enable AI skin analysis.',
          code: 'MISSING_YOUCAM_KEY',
          faceDetected: false,
        });
      }

      const youcamMetrics = await analyzeSkinWithYouCam(image, apiKey);
      console.log(`[SKIN ANALYSIS] ✓ YouCam AI skin analysis completed via MCP server (Score: ${youcamMetrics.score}, Classification: ${youcamMetrics.classification}, Detected Conditions: ${youcamMetrics.detectedConditions.join(', ') || 'None'})`);

      return res.json(youcamMetrics);
    } catch (error) {
      console.error("[SKIN ANALYSIS ERROR] YouCam MCP Skin Analysis failed:", error);
      const errMsg = error instanceof Error ? error.message : "Skin analysis failed";
      res.status(500).json({
        status: 'error',
        error: errMsg,
        faceDetected: false,
      });
    }
  });

  app.post(["/predict", "/api/skin/debug"], (_req, res) => {
    return res.status(404).json({
      error: "This legacy endpoint has been decommissioned. Skin analysis must strictly use POST /api/skin/analyze.",
    });
  });

  app.post("/api/skin/gemini_reasoning", async (req, res) => {
    try {
      const { metrics, history, trend, question } = req.body;
      if (!metrics || typeof metrics.score !== 'number' || typeof metrics.hydration !== 'number' || typeof metrics.texture !== 'number') {
        return res.status(400).json({ error: 'Real skin model metrics are required before Gemini reasoning.' });
      }
      
      const apiKey = process.env.GEMINI_API_KEY || "";

      // Build trend section so Gemini can speak about change over time
      let trendSection = "No prior scan history available - this appears to be the user's initial baseline scan.";
      if (trend && trend.scanCount > 0) {
        const sign = (n: number) => n > 0 ? `+${n}` : `${n}`;
        trendSection =
          `History: ${trend.scanCount} prior scan(s). ` +
          `Score change: ${sign(trend.scoreDelta)} pts. ` +
          `Hydration change: ${sign(trend.hydrationDelta)}%. ` +
          `Texture change: ${sign(trend.textureDelta)}%. ` +
          (trend.acneChanged ? `Acne severity changed to ${metrics?.acneSeverity}.` : 'Acne severity unchanged.');
      }

      // Save scan to server memory store for mobile QR report lookup
      if (metrics && metrics.id) {
        savedSkinScansMap.set(String(metrics.id), metrics);
        savedSkinScansMap.set('latest', metrics);
      }

      const ai = new GoogleGenAI({ apiKey });
      const prompt = `You are Gemini AI, a warm, caring, truthful, and supportive AI Skin Health Consultant on the Orion Smart Mirror.

Real Facial Skin Metrics (YouCam AI / Computer Vision analysis):
- Overall Skin Score: ${metrics.score}%
- Skin Type Classification: ${metrics.classification}
- Epidermal Hydration: ${metrics.hydration}%
- Surface Texture: ${metrics.texture}%
- Acne Severity: ${metrics.acneSeverity} (${metrics.acneScore}/100)
- UV / Photodamage: ${metrics.uvDamage} (${metrics.uvScore}/100)

Detected Skin Conditions Spectrum:
- Acne Detected: ${metrics.acneDetected ? 'YES' : 'NO'} (${metrics.acneSeverity})
- Hydration Deficit (Dry Skin): ${metrics.hydration < 70 ? 'YES' : 'NO'} (${metrics.hydration}%)
- Sebum Activity (Oily Skin): ${/oil/i.test(metrics.classification || '') ? 'YES' : 'NO'}
- Texture Lines (Wrinkles): ${metrics.texture < 70 ? 'YES' : 'NO'} (${metrics.texture}%)
- Normal Balance: ${metrics.score >= 75 && !metrics.acneDetected ? 'YES' : 'NO'}

Day-by-Day Trend Context (vs. prior scans):
${trendSection}

Available Verified Products Catalog (select 2-3 product IDs that truly benefit this skin profile):
- minimalist_salicylic_acid (BHA for active acne & sebum)
- minimalist_niacinamide (Oiliness & dark spots balance)
- dot_key_cica_gel (Light oil-free night gel for acne/soothing)
- cetaphil_gentle_cleanser (Gentle non-foaming wash for dry/sensitive/normal)
- dot_key_ceramide_moisturizer (Barrier repair cream for dryness)
- requil_dry_touch_sunscreen (SPF 50 mineral UV defense)
- foxtale_retinol_night_serum (Anti-aging & texture refinement)
- plum_green_tea_toner (Pore balancing toner)
- derma_co_vitamin_c (Vitamin C for dark spots & radiance)
- minimalist_alpha_arbutin (Alpha Arbutin for hyperpigmentation)
- bioderma_atoderm_baume (Ultra-soothing balm for sensitive/dry)
- derma_co_salicylic_cleanser (The Derma Co 1% Salicylic Acid Gel Face Wash, 100 ml - for active acne/blemishes)

Strict Instructions:
1. SUMMARY: Provide a short, clear, and precise summary (2 to 3 sentences maximum) personalized strictly to the actual detected skin characteristics.
2. NO GENERIC GREETINGS: NEVER start with greetings like "Hey there", "Hello", or "Hi". Start directly with the diagnostic assessment.
3. NO HALLUCINATIONS: Do not claim acne if clear, do not claim wrinkles if texture is high.
4. PERSONALIZED ROUTINES: Provide separate Morning Routine and Night Routine:
   - Morning: short, actionable steps (e.g., cleanse, targeted serum, sunscreen).
   - Night: short, actionable steps (e.g., evening cleanse, active repair, barrier moisturize).
   - Include specific durations, quantities, or frequencies (e.g. "Massage for 30s", "Apply 2-3 drops", "Thin layer").
5. STRICT NUTRITIONAL / LIFESTYLE LIMIT: Include NO MORE THAN TWO nutritional recommendations IN TOTAL across both morning and night routines combined. NEVER repeat "drink more water", "eat pumpkin seeds", or generic healthy food advice. Keep steps focused on actual skincare.
6. QUICK TAKE: End with a single standalone line starting with "📌 Quick Take:" giving a direct, encouraging 1-line actionable takeaway.
7. Return your output as valid JSON matching this schema:
{
  "summary": "2-3 short, clear sentences explaining the detected skin characteristics and primary priority.",
  "quickTake": "1-line direct actionable takeaway starting with 📌 Quick Take:",
  "productIds": ["catalog_id_1", "catalog_id_2"],
  "morningRoutine": [
    {
      "step": 1,
      "title": "Short Step Title",
      "category": "cleanser|serum|sunscreen|moisturizer|treatment|lifestyle",
      "instruction": "Short actionable instruction with duration/quantity",
      "product": "Product Name",
      "catalogProductId": "optional_catalog_id",
      "reason": "Specific reason"
    }
  ],
  "nightRoutine": [
    {
      "step": 1,
      "title": "Short Step Title",
      "category": "cleanser|serum|sunscreen|moisturizer|treatment|lifestyle",
      "instruction": "Short actionable instruction with duration/quantity",
      "product": "Product Name",
      "catalogProductId": "optional_catalog_id",
      "reason": "Specific reason"
    }
  ]
}`;

      const response = await ai.models.generateContent({
        model: process.env.ORION_TEXT_MODEL || "gemini-2.5-flash",
        contents: prompt,
        config: {
          systemInstruction: "You are Gemini AI, an expert, caring, truthful, and supportive AI Skin Health Consultant on the Orion Smart Mirror. Never start with a greeting. Output valid JSON containing summary, quickTake, productIds, morningRoutine, and nightRoutine.",
          responseMimeType: "application/json",
          temperature: 0.4,
          maxOutputTokens: 900,
        },
      });

      const rawOutput = response.text || '';
      const parsedPayload = parseGeminiSkinPayload(rawOutput, metrics);

      res.json({
        text: parsedPayload.text,
        spokenSummary: parsedPayload.spokenSummary,
        productIds: parsedPayload.productIds,
        routine: parsedPayload.routine,
      });
    } catch (error) {
      console.error("Gemini reasoning error:", error);
      res.status(500).json({ error: "Failed to generate AI reasoning" });
    }
  });

  app.get("/api/system/network-ip", (req, res) => {
    let localIp = '127.0.0.1';
    try {
      const interfaces = os.networkInterfaces();
      for (const name of Object.keys(interfaces)) {
        const iface = interfaces[name];
        if (!iface) continue;
        for (const alias of iface) {
          if (alias.family === 'IPv4' && !alias.internal) {
            localIp = alias.address;
            break;
          }
        }
        if (localIp !== '127.0.0.1') break;
      }
    } catch (e) {
      console.warn("Failed to get network interfaces:", e);
    }
    const reqPort = req.socket.localPort || process.env.PORT || 3001;
    res.json({ ip: localIp, port: reqPort });
  });

  app.post("/api/skin/save-scan", (req, res) => {
    const scan = req.body;
    if (scan) {
      persistSkinScan(scan);
    }
    res.json({ status: 'ok' });
  });

  app.post("/api/skin/publish-public-report", async (req, res) => {
    try {
      const { html, scan } = req.body || {};
      const reportHtml = html || (scan ? renderSkinReportHTMLServer(scan, 1) : null);
      if (!reportHtml) {
        return res.status(400).json({ error: "Missing html or scan content" });
      }

      // 1. Primary Global CDN: bytebin.lucko.me
      try {
        const bbRes = await fetch("https://bytebin.lucko.me/post", {
          method: "POST",
          headers: { "Content-Type": "text/html; charset=utf-8" },
          body: reportHtml,
        });
        if (bbRes.ok) {
          const data = await bbRes.json();
          if (data && data.key) {
            const publicUrl = `https://bytebin.lucko.me/${data.key}`;
            console.log("[SERVER PUBLIC REPORT] Published to bytebin CDN:", publicUrl);
            return res.json({ url: publicUrl, provider: "bytebin" });
          }
        }
      } catch (bbErr) {
        console.warn("[SERVER PUBLIC REPORT] bytebin upload failed:", bbErr);
      }

      // 2. Secondary Global CDN: api.pastes.dev
      try {
        const pdRes = await fetch("https://api.pastes.dev/post", {
          method: "POST",
          headers: { "Content-Type": "text/html; charset=utf-8" },
          body: reportHtml,
        });
        if (pdRes.ok) {
          const data = await pdRes.json();
          if (data && data.key) {
            const publicUrl = `https://api.pastes.dev/${data.key}`;
            console.log("[SERVER PUBLIC REPORT] Published to pastes.dev CDN:", publicUrl);
            return res.json({ url: publicUrl, provider: "pastes.dev" });
          }
        }
      } catch (pdErr) {
        console.warn("[SERVER PUBLIC REPORT] pastes.dev upload failed:", pdErr);
      }

      // 3. Fallback: Local Wi-Fi network URL
      let localIp = '127.0.0.1';
      try {
        const interfaces = os.networkInterfaces();
        for (const name of Object.keys(interfaces)) {
          const iface = interfaces[name];
          if (!iface) continue;
          for (const alias of iface) {
            if (alias.family === 'IPv4' && !alias.internal) {
              localIp = alias.address;
              break;
            }
          }
          if (localIp !== '127.0.0.1') break;
        }
      } catch (_) {}

      const scanId = scan?.id || 'latest';
      const localUrl = `http://${localIp}:${PORT}/api/skin/report/${scanId}`;
      return res.json({ url: localUrl, provider: "local" });
    } catch (err) {
      console.error("[SERVER PUBLIC REPORT] Error publishing report:", err);
      res.status(500).json({ error: "Failed to publish report" });
    }
  });

  app.post("/api/skin/explain", async (req, res) => {
    try {
      const { metrics, previousScans } = req.body;
      if (!metrics || typeof metrics.score !== 'number' || typeof metrics.hydration !== 'number') {
        return res.status(400).json({ error: 'Real skin model metrics are required before explanation.' });
      }
      if (!process.env.GEMINI_API_KEY) {
        return res.json({ explanation: 'Your overall skin health index is ' + metrics.score + '% (' + metrics.classification + ' type). Hydration level is ' + metrics.hydration + '%, and acne severity is rated as ' + metrics.acneSeverity + '.' });
      }

      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      const prompt = `Analyze these real skin scan metrics for a user:
- Overall Score: ${metrics?.score}%
- Skin Classification: ${metrics?.classification}
- Hydration Level: ${metrics?.hydration}%
- Texture Smoothness: ${metrics?.texture}%
- Acne Severity: ${metrics?.acneSeverity} (${metrics.acneScore}/100)
- UV / Sun Damage: ${metrics?.uvDamage} (${metrics.uvScore}/100)

Previous Scans Count: ${previousScans?.length || 0}

Provide a concise, 2-3 sentence dermatological summary explaining these results and actionable routine advice. No medical overclaims.`;

      const response = await ai.models.generateContent({
        model: process.env.ORION_TEXT_MODEL || "gemini-2.5-flash",
        contents: prompt,
        config: {
          systemInstruction: "You are Orion's expert AI Skin Health Consultant. Concise, scientific, empathetic, no medical overclaims.",
          temperature: 0.4,
          maxOutputTokens: 200,
        },
      });

      res.json({ explanation: response.text });
    } catch (error) {
      console.error("/api/skin/explain error:", error);
      res.status(503).json({ error: 'Skin explanation is unavailable.' });
    }
  });

  app.post("/api/skin/assistant", async (req, res) => {
    try {
      const { question, query, latestScan: bodyScan, history } = req.body;
      const userQuery = String(question || query || "").trim();
      if (!userQuery) {
        return res.status(400).json({ error: 'Query or question is required.' });
      }

      // 1. Resolve scan: from body or fallback to latest saved scan in memory
      let latestScan = bodyScan || savedSkinScansMap.get('latest') || null;

      const lower = userQuery.toLowerCase();

      // 2. Navigation commands
      if (/^(open|go to|show|take me to|navigate to)?\s*(skin|skin analysis|skin scanner|skin report|facial scan)\b/i.test(lower)) {
        return res.json({
          answer: "Opening your Skin Analysis Dashboard.",
          action: { type: "navigate", view: "skin_analysis" }
        });
      }
      if (/^(open|go to|show|take me to|navigate to)?\s*(home|dashboard|main screen|main dashboard)\b/i.test(lower)) {
        return res.json({
          answer: "Returning to the Home Dashboard.",
          action: { type: "navigate", view: "dashboard" }
        });
      }
      if (/^(open|go to|show|take me to|navigate to)?\s*(health|health module|wellness)\b/i.test(lower)) {
        return res.json({
          answer: "Opening the Health Module.",
          action: { type: "navigate", view: "health" }
        });
      }
      if (/^(open|go to|show|take me to|navigate to)?\s*(settings|preferences|configuration)\b/i.test(lower)) {
        return res.json({
          answer: "Opening Settings.",
          action: { type: "navigate", view: "settings" }
        });
      }
      if (/\b(refresh|reload|update)\b.*\b(qr|qr code|skin report)\b/i.test(lower)) {
        return res.json({
          answer: "Refreshing your QR skin report and updating the QR code.",
          action: { type: "refresh_qr" }
        });
      }
      if (/\b(play|listen to)\b.*\b(liked songs?|my library|saved songs?)\b/i.test(lower)) {
        return res.json({
          answer: "Playing songs from your Liked Songs library on Spotify.",
          action: { type: "spotify", action: "play", query: userQuery }
        });
      }
      if (/\b(pause|stop)\s*(music|playback|spotify)?\b/i.test(lower)) {
        return res.json({
          answer: "Pausing Spotify playback.",
          action: { type: "spotify", action: "pause" }
        });
      }
      if (/\b(resume|continue|unpause)\s*(music|playback|spotify)?\b/i.test(lower)) {
        return res.json({
          answer: "Resuming Spotify playback.",
          action: { type: "spotify", action: "resume" }
        });
      }
      if (/\b(skip|next song|next track)\b/i.test(lower)) {
        return res.json({
          answer: "Skipping to the next song.",
          action: { type: "spotify", action: "next" }
        });
      }
      if (/\b(previous song|play previous|go back)\b/i.test(lower)) {
        return res.json({
          answer: "Playing the previous song.",
          action: { type: "spotify", action: "previous" }
        });
      }
      if (/\b(volume up|turn.*up|louder)\b/i.test(lower)) {
        return res.json({
          answer: "Turning the volume up.",
          action: { type: "spotify", action: "volume_up" }
        });
      }
      if (/\b(volume down|turn.*down|softer|quieter)\b/i.test(lower)) {
        return res.json({
          answer: "Turning the volume down.",
          action: { type: "spotify", action: "volume_down" }
        });
      }

      // Check for generic play music request
      if (/^play\s+(.+)/i.test(lower)) {
        const match = lower.match(/^play\s+(.+)/i);
        const songQuery = match ? match[1].replace(/\b(on spotify|please)\b/gi, '').trim() : '';
        if (songQuery) {
          return res.json({
            answer: `Playing ${songQuery} on Spotify.`,
            action: { type: "spotify", action: "play", query: songQuery }
          });
        }
      }

      // 3. Gemini reasoning with available skin context
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) {
        return res.json({ answer: 'Based on your recent skin scan (Score: ' + (latestScan?.score || 85) + '%, Hydration: ' + (latestScan?.hydration || 70) + '%), focus on consistent hydration, sunscreen in the morning, and gentle cleansing at night.' });
      }

      const ai = new GoogleGenAI({ apiKey });
      const prompt = `You are Orion, an intelligent, calm, friendly, and practical smart mirror voice assistant powered by Gemini.
User's Question / Spoken Request: "${userQuery}"

User's Latest Skin Scan Context:
${latestScan ? JSON.stringify({
  overallScore: latestScan.score,
  primaryDiagnosis: latestScan.finalSkinType || latestScan.classification,
  allClassifications: latestScan.allClassifications || latestScan.topThreeClasses,
  hydration: latestScan.hydration,
  texture: latestScan.texture,
  acneSeverity: latestScan.acneSeverity,
  morningRoutine: latestScan.routine?.morning,
  nightRoutine: latestScan.routine?.night,
  geminiSummary: latestScan.aiExplanation,
}, null, 2) : "No scan performed yet. User is asking a general question."}

Instructions:
- Provide a concise, clear, and reassuring spoken response (2 to 3 short sentences maximum).
- If asked about their skin, morning/night routine, or concerns, answer using their actual scan results above.
- If recommending nutritional options, recommend specific foods (e.g. citrus/amla, walnuts, tomato) with a scientific rationale, maximum 2 foods.
- Friendly, conversational, and direct tone without sounding robotic.
- Never claim to provide formal medical diagnosis; advise consulting a dermatologist for persistent concerns when appropriate.`;

      const response = await ai.models.generateContent({
        model: process.env.ORION_TEXT_MODEL || "gemini-2.5-flash",
        contents: prompt,
        config: {
          systemInstruction: "You are Orion's expert voice assistant. Calm, supportive, scientifically grounded, concise.",
          temperature: 0.5,
          maxOutputTokens: 250,
        },
      });

      res.json({ answer: response.text });
    } catch (error) {
      console.error("/api/skin/assistant error:", error);
      res.status(500).json({ error: 'Skin assistant is temporarily unavailable.' });
    }
  });

  app.get("/api/skin/report/:id", (req, res) => {
    const scanId = String(req.params.id);
    let scan = savedSkinScansMap.get(scanId) || savedSkinScansMap.get('latest');

    if (!scan && req.query.d) {
      scan = decodeCompactScanQuery(String(req.query.d));
    }

    if (!scan) {
      scan = {
        id: scanId || Date.now().toString(),
        date: new Date().toISOString(),
        score: 85,
        hydration: 82,
        texture: 80,
        acneSeverity: 'Mild',
        acneScore: 20,
        uvDamage: 'Low',
        uvScore: 12,
        classification: 'Normal / Healthy',
        finalSkinType: 'Normal / Healthy Skin Type',
        aiExplanation: 'Your skin hydration and texture metrics are optimal. Maintain your daily morning SPF and hydrating night moisturizer.'
      };
    }

    const html = renderSkinReportHTMLServer(scan, savedSkinScansMap.size || 1);
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, private");
    res.send(html);
  });
  app.set("trust proxy", 1);

  app.get("/api/spotify/auth/url", (req, res) => {
    const { clientId, clientSecret } = spotifyCredentials();
    if (!clientId || !clientSecret) {
      return res.status(500).json({ error: "Spotify credentials are not configured" });
    }

    const redirectUri = getSpotifyRedirectUri(req);
    const params = new URLSearchParams({
      client_id: clientId,
      response_type: "code",
      redirect_uri: redirectUri,
      scope: SPOTIFY_SCOPES,
    });
    res.json({ url: `https://accounts.spotify.com/authorize?${params.toString()}` });
  });

  app.get("/api/spotify/callback", async (req, res) => {
    const code = req.query.code as string;
    const redirectUri = getSpotifyRedirectUri(req);
    const { clientId, clientSecret } = spotifyCredentials();

    if (!code) {
      res.status(400).send("No code provided");
      return;
    }
    if (!clientId || !clientSecret) {
      res.status(500).send("Spotify credentials are not configured");
      return;
    }

    const authHeader = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

    try {
      const response = await fetch("https://accounts.spotify.com/api/token", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Authorization: `Basic ${authHeader}`,
        },
        body: new URLSearchParams({
          code,
          redirect_uri: redirectUri,
          grant_type: "authorization_code",
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        res.status(response.status).send(data.error_description || data.error || "Failed to authenticate with Spotify");
        return;
      }

      res.send(`
      <html>
        <body>
          <script>
            if (window.opener) {
              window.opener.postMessage({ type: 'SPOTIFY_AUTH_SUCCESS', token: '${data.access_token}', refreshToken: '${data.refresh_token}' }, '*');
              window.close();
            } else {
              window.location.href = '/';
            }
          </script>
          <p>Spotify Authentication successful. This window should close automatically.</p>
        </body>
      </html>
    `);
    } catch (error) {
      res.status(500).send("Failed to authenticate with Spotify");
    }
  });

  app.post("/api/spotify/refresh", async (req, res) => {
    const refreshToken = req.body?.refreshToken;
    const { clientId, clientSecret } = spotifyCredentials();
    if (!refreshToken) {
      return res.status(400).json({ error: "refreshToken is required" });
    }
    if (!clientId || !clientSecret) {
      return res.status(500).json({ error: "Spotify credentials are not configured" });
    }

    const authHeader = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
    try {
      const response = await fetch("https://accounts.spotify.com/api/token", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Authorization: `Basic ${authHeader}`,
        },
        body: new URLSearchParams({
          refresh_token: refreshToken,
          grant_type: "refresh_token",
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        return res.status(response.status).json(data);
      }
      res.json({
        accessToken: data.access_token,
        refreshToken: data.refresh_token || refreshToken,
      });
    } catch (error) {
      res.status(500).json({ error: "Failed to refresh Spotify token" });
    }
  });

  app.get("/api/google/auth/url", (req, res) => {
    const { clientId } = googleCredentials();
    const redirectUri = getGoogleRedirectUri(req);
    const params = new URLSearchParams({
      client_id: clientId,
      response_type: "code",
      redirect_uri: redirectUri,
      scope: GOOGLE_SCOPES,
      access_type: "offline",
      prompt: "consent",
    });
    res.json({ url: `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}` });
  });

  app.get("/api/google/callback", async (req, res) => {
    const code = req.query.code as string;
    const redirectUri = getGoogleRedirectUri(req);
    const { clientId, clientSecret } = googleCredentials();

    if (!code) {
      res.status(400).send("No code provided");
      return;
    }

    try {
      const response = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          code,
          redirect_uri: redirectUri,
          grant_type: "authorization_code",
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        res.status(response.status).send(data.error_description || data.error || "Failed to authenticate with Google");
        return;
      }

      res.send(`
      <html>
        <body>
          <script>
            // Try window.opener first
            if (window.opener) {
              window.opener.postMessage({ type: 'GOOGLE_AUTH_SUCCESS', token: '${data.access_token}', refreshToken: '${data.refresh_token}', expiresIn: ${Number(data.expires_in || 3500)} }, '*');
            }
            // Fallback: use localStorage to pass the token to the main window in Electron
            localStorage.setItem('orion_google_auth_pending', JSON.stringify({
              token: '${data.access_token}',
              refreshToken: '${data.refresh_token}',
              expiresIn: ${Number(data.expires_in || 3500)}
            }));
            
            // Close the window
            window.close();
            
            // If window.close() fails, redirect back to the app
            setTimeout(() => {
              window.location.href = '/';
            }, 1000);
          </script>
          <p>Google Authentication successful. This window should close automatically.</p>
        </body>
      </html>
    `);
    } catch (error) {
      res.status(500).send("Failed to authenticate with Google");
    }
  });

  app.post("/api/google/refresh", async (req, res) => {
    const refreshToken = req.body?.refreshToken;
    const { clientId, clientSecret } = googleCredentials();
    if (!refreshToken) {
      return res.status(400).json({ error: "refreshToken is required" });
    }

    try {
      const response = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          refresh_token: refreshToken,
          grant_type: "refresh_token",
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        return res.status(response.status).json(data);
      }
      res.json({
        accessToken: data.access_token,
        refreshToken: data.refresh_token || refreshToken,
      });
    } catch (error) {
      res.status(500).json({ error: "Failed to refresh Google token" });
    }
  });

  if (options.useVite !== false && process.env.NODE_ENV !== "production") {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(appRoot, "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  const server = app.listen(PORT, HOST, () => {
    const displayHost = HOST === "0.0.0.0" ? "localhost" : HOST;
    console.log(`Server running on http://${displayHost}:${PORT}`);

    const checkPort = (port: number) => {
        return new Promise((resolve) => {
            const server = net.createServer();
            server.once("error", (err: any) => {
                if (err.code === "EADDRINUSE") {
                    resolve(false);
                }
            });
            server.once("listening", () => {
                server.close();
                resolve(true);
            });
            server.listen(port, "0.0.0.0");
        });
    };

    checkPort(Number(process.env.ORION_PYTHON_PORT || 8001)).then((isFree) => {
        if (!isFree) {
            console.log("Port 8001 is already in use. Assuming Orion voice backend is already running. Skipping spawn.");
            return;
        }

        console.log("Spawning Orion Python voice backend on port 8001...");
        const pythonPath = process.platform === "win32" 
          ? path.join(appRoot, "ada_backend", "venv", "Scripts", "python.exe")
          : path.join(appRoot, "ada_backend", "venv", "bin", "python");
        
        const adaProcess = spawn(pythonPath, ["-m", "uvicorn", "server:app_socketio", "--host", "0.0.0.0", "--port", String(process.env.ORION_PYTHON_PORT || 8001)], {
          cwd: path.join(appRoot, "ada_backend"),
          stdio: "inherit"
        });
        
        adaProcess.on("error", (err) => {
          console.error("Failed to start Orion voice backend:", err);
        });
        
        // Ensure the python child process is killed when the Node process exits
        const killOrionVoiceProcess = () => {
           if (adaProcess && !adaProcess.killed) {
               adaProcess.kill();
           }
        };
        process.on("exit", killOrionVoiceProcess);
        process.on("SIGINT", () => { killOrionVoiceProcess(); process.exit(0); });
        process.on("SIGTERM", () => { killOrionVoiceProcess(); process.exit(0); });
    });
  });

  const urlHost = HOST === "0.0.0.0" ? "localhost" : HOST;
  return { app, server, port: PORT, host: HOST, url: `http://${urlHost}:${PORT}` };
}

if (process.env.ORION_SERVER_AUTOSTART !== "false") {
  startServer().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}





