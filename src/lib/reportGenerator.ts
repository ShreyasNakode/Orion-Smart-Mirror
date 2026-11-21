import QRCode from 'qrcode';
import { SkinAnalysisRecord } from '../types';
import { CATALOG_PRODUCTS, generateDynamicRoutine, normalizeRecommendations, syncRecommendationsFromRoutine } from './skinRecommendations';

export async function generateQRCodeDataUrl(text: string): Promise<string> {
  if (!text) return '';
  try {
    return await QRCode.toDataURL(text, {
      width: 400,
      margin: 4, // ISO/IEC 18004 standard 4-module quiet zone margin
      errorCorrectionLevel: 'M',
      color: {
        dark: '#000000',
        light: '#ffffff'
      }
    });
  } catch (err) {
    console.error('QR code generation error:', err);
    return '';
  }
}

export function encodeScanToParam(scan: SkinAnalysisRecord): string {
  try {
    const compact: any = {
      i: String(scan.id || Date.now().toString()).slice(0, 14),
      d: scan.date || new Date().toISOString(),
      s: scan.score ?? 85,
      h: scan.hydration ?? 80,
      t: scan.texture ?? 80,
      a: scan.acneSeverity || 'Mild',
      q: scan.acneScore ?? 20,
      u: scan.uvDamage || 'Low',
      v: scan.uvScore ?? 15,
      c: scan.classification || 'Normal',
      f: scan.finalSkinType || `${scan.classification || 'Normal'} Skin Type`,
    };
    const jsonStr = JSON.stringify(compact);
    if (typeof btoa === 'function') {
      return btoa(encodeURIComponent(jsonStr).replace(/%([0-9A-F]{2})/g, (_, p1) => String.fromCharCode(parseInt(p1, 16))));
    }
    return Buffer.from(jsonStr, 'utf8').toString('base64url');
  } catch (e) {
    console.warn('Failed to compactify scan:', e);
    return '';
  }
}

export async function uploadPublicReportHTML(html: string, scan?: SkinAnalysisRecord): Promise<string | null> {
  // Strategy 1: Delegate to local server endpoint which runs in Node.js (ZERO CORS restrictions)
  try {
    const res = await fetch('/api/skin/publish-public-report', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ html, scan }),
    });
    if (res.ok) {
      const data = await res.json();
      if (data && data.url) {
        console.log('[PUBLIC QR REPORT] Published via server to:', data.url);
        return data.url;
      }
    }
  } catch (e) {
    console.warn('[PUBLIC QR REPORT] Server publish endpoint unreachable, trying direct fallback:', e);
  }

  // Strategy 2: Direct public CDN upload fallback (if supported by client environment)
  try {
    const res = await fetch('https://api.pastes.dev/post', {
      method: 'POST',
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
      body: html,
    });
    if (res.ok) {
      const data = await res.json();
      if (data && data.key) {
        const publicUrl = `https://api.pastes.dev/${data.key}`;
        console.log('[PUBLIC QR REPORT] Published directly to pastes.dev:', publicUrl);
        return publicUrl;
      }
    }
  } catch (e) {
    console.warn('[PUBLIC QR REPORT] Direct CDN upload fallback failed:', e);
  }
  return null;
}

export async function getMobileReportURL(
  scanId: string | number = 'latest',
  scan?: SkinAnalysisRecord,
  historyCountOrMode: number | 'cloud' | 'wifi' | 'auto' = 'auto',
  _explicitMode: 'cloud' | 'wifi' | 'auto' = 'auto'
): Promise<string> {
  const id = scanId || (scan?.id ? String(scan.id) : 'latest');
  const count = typeof historyCountOrMode === 'number' ? historyCountOrMode : 1;

  // 1. Primary Strategy: Publish the complete standalone report to public edge CDN
  // This renders 100% reliably on ANY phone (iPhone, Android, 4G, 5G, Wi-Fi) with ZERO login barriers
  // and ZERO "Please wait while your application starts" stalls!
  if (scan) {
    try {
      const html = buildSkinReportHTML(scan, count);
      const publicCdnUrl = await uploadPublicReportHTML(html, scan);
      if (publicCdnUrl) {
        return publicCdnUrl;
      }
    } catch (err) {
      console.warn('Failed to publish report to public CDN, falling back:', err);
    }
  }

  // 2. Fallback Strategy: Local LAN IP if phone and mirror are on the same Wi-Fi
  try {
    const netRes = await fetch('/api/system/network-ip');
    if (netRes.ok) {
      const net = await netRes.json();
      if (net.ip && net.ip !== '127.0.0.1') {
        const compactParam = scan ? encodeScanToParam(scan) : '';
        const dataQuery = compactParam ? `?d=${encodeURIComponent(compactParam)}` : '';
        return `http://${net.ip}:${net.port || 3001}/api/skin/report/${id}${dataQuery}`;
      }
    }
  } catch (_) {}

  // 3. Fallback Strategy: Local port endpoint
  const compactParam = scan ? encodeScanToParam(scan) : '';
  const dataQuery = compactParam ? `?d=${encodeURIComponent(compactParam)}` : '';
  return `http://localhost:3001/api/skin/report/${id}${dataQuery}`;
}

export function getAllFiveReportClasses(scan: any): Array<{
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

export function buildSkinReportHTML(scan: SkinAnalysisRecord, historyCount: number): string {
  const scanId = (scan.id || Date.now().toString()).toString();
  const dateStr = new Date(scan.date || Date.now()).toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit'
  });
  const score = scan.score ?? 85;
  const finalType = scan.finalSkinType || `${scan.classification || 'Normal'} Skin Type`;
  const fiveClasses = getAllFiveReportClasses(scan);

  const routine = scan.routine || generateDynamicRoutine(scan);
  const morningSteps = routine?.morning || [];
  const nightSteps = routine?.night || [];

  const savedRecs = normalizeRecommendations(scan.recommendations || []);
  const recs = savedRecs.length > 0
    ? savedRecs
    : syncRecommendationsFromRoutine(routine);

  const statusBadge = score >= 80 ? 'Optimal Dermal Integrity' : score >= 65 ? 'Moderate Care Recommended' : 'Clinical Attention Suggested';
  const statusColor = score >= 80 ? '#38bdf8' : score >= 65 ? '#fbbf24' : '#f87171';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Orion Dermatological AI Skin Assessment Report - #${scanId.slice(0, 8)}</title>
  <style>
    :root {
      --primary: #0284c7;
      --primary-light: #38bdf8;
      --bg: #0f172a;
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
      max-width: 820px;
      margin: 0 auto;
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 24px;
      padding: 40px;
      box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.6);
    }
    .top-bar {
      display: flex;
      justify-content: space-between;
      align-items: center;
      border-bottom: 2px solid var(--border);
      padding-bottom: 24px;
      margin-bottom: 24px;
    }
    .clinic-brand {
      display: flex;
      flex-direction: column;
    }
    .clinic-logo {
      font-size: 24px;
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
      padding: 12px 24px;
      border-radius: 12px;
      font-weight: 700;
      font-size: 14px;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 8px;
      box-shadow: 0 4px 14px rgba(2, 132, 199, 0.35);
      transition: all 0.2s ease;
    }
    .download-btn:hover { background: #0284c7; transform: translateY(-1px); }

    /* Biometric Face Image Card at Top */
    .biometric-card {
      background: linear-gradient(180deg, rgba(15, 23, 42, 0.95), rgba(30, 41, 59, 0.8));
      border: 1px solid rgba(56, 189, 248, 0.35);
      border-radius: 20px;
      padding: 20px;
      margin-bottom: 28px;
      box-shadow: 0 10px 30px rgba(0, 0, 0, 0.4);
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

export function downloadReportFile(scan: SkinAnalysisRecord, historyCount: number) {
  const htmlContent = buildSkinReportHTML(scan, historyCount);
  const blob = new Blob([htmlContent], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `Orion_Skin_Report_${new Date().toISOString().split('T')[0]}.html`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
