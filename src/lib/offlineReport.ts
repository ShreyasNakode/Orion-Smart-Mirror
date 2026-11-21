/**
 * Generates a fully self-contained HTML report as a data:text/html;base64 URI.
 * The QR code encodes this data URI directly, so scanning it opens the full
 * report in the phone's browser without any server connection.
 * Works on mobile data, Wi-Fi, airplane mode — any network.
 */
import { SkinAnalysisRecord } from '../types';

interface CompactScan {
  i: string;   // id
  d: string;   // date
  s: number;   // score
  h: number;   // hydration
  t: number;   // texture
  a: string;   // acneSeverity
  q: number;   // acneScore
  u: string;   // uvDamage
  v: number;   // uvScore
  c: string;   // classification
  f: string;   // finalSkinType
  x: string;   // aiExplanation (truncated)
}

function compactifyScan(scan: SkinAnalysisRecord): CompactScan {
  return {
    i: (scan.id || '').slice(0, 8),
    d: scan.date || new Date().toISOString(),
    s: scan.score ?? 85,
    h: scan.hydration ?? 80,
    t: scan.texture ?? 80,
    a: scan.acneSeverity || 'Mild',
    q: scan.acneScore ?? 20,
    u: scan.uvDamage || 'Low',
    v: scan.uvScore ?? 15,
    c: scan.classification || 'Normal',
    f: scan.finalSkinType || `${scan.classification || 'Normal'} Skin`,
    x: (scan.aiExplanation || '').slice(0, 150),
  };
}

/**
 * Builds an ultra-compact, self-contained HTML report page.
 * The scan data is base64-encoded JSON embedded directly inside a <script> tag.
 * When opened in the phone browser, it decodes and renders instantly.
 */
function toB64(str: string): string {
  return btoa(encodeURIComponent(str).replace(/%([0-9A-F]{2})/g, (_, p1) => String.fromCharCode(parseInt(p1, 16))));
}

function buildCompactReportHTML(scan: SkinAnalysisRecord): string {
  const compact = compactifyScan(scan);
  const jsonStr = JSON.stringify(compact);
  const b64 = toB64(jsonStr);

  return `<!DOCTYPE html><html><head><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><title>Orion</title><style>*{margin:0;box-sizing:border-box}body{font-family:system-ui;background:#0f172a;color:#f8fafc;padding:12px}.c{max-width:600px;margin:auto;background:#1e293b;border-radius:14px;padding:16px;border:1px solid #334155}.g{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin:12px 0}.b{background:#0f172a;padding:10px;border-radius:8px;border:1px solid #334155}.l{font-size:9px;color:#94a3b8;text-transform:uppercase}.v{font-size:16px;font-weight:800}.n{font-size:44px;font-weight:900;color:#38bdf8;text-align:center;margin:12px 0}.a{background:rgba(2,132,199,.1);border:1px solid rgba(56,189,248,.2);padding:12px;border-radius:8px;margin:12px 0;font-size:12px;color:#cbd5e1}.p{background:#0284c7;color:#fff;border:0;padding:8px;border-radius:6px;font-weight:700;cursor:pointer;width:100%;margin-top:10px}@media print{body{background:#fff!important;color:#000!important}.c,.b{background:#fff!important;border:0!important}.p{display:none!important}}</style></head><body><div class=c><b style=color:#38bdf8>ORION HEALTHCARE</b><br><small style=color:#94a3b8>AI Skin Report</small><div id=r></div><button class=p onclick=print()>Download PDF</button><div style=font-size:9px;color:#64748b;text-align:center;margin-top:10px>For personal tracking only</div></div><script>try{function f(b){return decodeURIComponent(Array.prototype.map.call(atob(b),function(c){return"%"+("00"+c.charCodeAt(0).toString(16)).slice(-2)}).join(""))}var d=JSON.parse(f("${b64}")),r=document.getElementById("r"),t=new Date(d.d).toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"});r.innerHTML='<div class=n>'+d.s+'%</div><div class=g><div class=b><div class=l>ID</div><div class=v>#'+d.i+'</div></div><div class=b><div class=l>Date</div><div class=v>'+t+'</div></div><div class=b><div class=l>Acne</div><div class=v>'+d.a+'</div></div><div class=b><div class=l>Hydration</div><div class=v>'+d.h+'%</div></div><div class=b><div class=l>Texture</div><div class=v>'+d.t+'%</div></div><div class=b><div class=l>UV</div><div class=v>'+d.u+'</div></div></div>'+(d.x?'<div class=a>'+d.x+'</div>':'')}catch(e){}</script></body></html>`;
}

/**
 * Generates a data:text/html;base64 URI containing the full self-contained report.
 */
export function generateOfflineReportDataUri(scan: SkinAnalysisRecord): string {
  const html = buildCompactReportHTML(scan);
  return `data:text/html;base64,${toB64(html)}`;
}

/**
 * Returns estimated QR payload size in characters for debugging.
 */
export function getOfflineReportSize(scan: SkinAnalysisRecord): number {
  return generateOfflineReportDataUri(scan).length;
}
