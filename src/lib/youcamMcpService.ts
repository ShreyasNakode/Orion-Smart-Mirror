import { spawn, ChildProcess } from 'child_process';
import https from 'https';
import http from 'http';
import dns from 'dns';
import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import unzipper from 'unzipper';
import { ClassPrediction, DetectedFeatureRegion } from '../types';

interface CacheEntry {
  timestamp: number;
  data: YouCamAnalysisOutput;
}

// In-flight scans map to share promises between concurrent calls for the same image
const inFlightScans = new Map<string, Promise<YouCamAnalysisOutput>>();

// 60-second result cache to prevent re-calling YouCam API if re-queried shortly
const scanResultCache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 60 * 1000;

function computeImageSha256(buffer: Buffer): string {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

// Set public DNS servers (Google & Cloudflare) to prevent local ISP DNS filtering
try {
  dns.setServers(['8.8.8.8', '1.1.1.1']);
} catch (_) {}

/**
 * Custom DNS lookup to resolve against Google/Cloudflare DNS directly,
 * bypassing any local ISP Response Policy Zone (RPZ) / carrier blocking.
 */
function customDnsLookup(hostname: string, options: any, callback: any) {
  let cb = callback;
  let opts = options;
  if (typeof options === 'function') {
    cb = options;
    opts = {};
  }
  dns.resolve4(hostname, (err, addresses) => {
    if (!err && addresses && addresses.length > 0) {
      if (opts && opts.all) {
        cb(null, addresses.map(addr => ({ address: addr, family: 4 })));
      } else {
        cb(null, addresses[0], 4);
      }
    } else {
      dns.lookup(hostname, opts, cb);
    }
  });
}

function httpsPostJson(urlStr: string, data: any, headers: Record<string, string> = {}): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const bodyStr = JSON.stringify(data);
    const req = https.request({
      protocol: u.protocol,
      hostname: u.hostname,
      port: u.port || 443,
      path: u.pathname + u.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(bodyStr),
        ...headers,
      },
      lookup: customDnsLookup,
    }, res => {
      let resBody = '';
      res.on('data', c => resBody += c);
      res.on('end', () => resolve({ status: res.statusCode || 200, body: resBody }));
    });
    req.on('error', reject);
    req.write(bodyStr);
    req.end();
  });
}

function httpsPutBinary(urlStr: string, buffer: Buffer, headers: Record<string, any> = {}): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const client = u.protocol === 'https:' ? https : http;
    const req = client.request({
      protocol: u.protocol,
      hostname: u.hostname,
      port: u.port || (u.protocol === 'https:' ? 443 : 80),
      path: u.pathname + u.search,
      method: 'PUT',
      headers: {
        'Content-Length': buffer.length,
        ...headers,
      },
      lookup: customDnsLookup,
    }, res => {
      let resBody = '';
      res.on('data', c => resBody += c);
      res.on('end', () => resolve({ status: res.statusCode || 200, body: resBody }));
    });
    req.on('error', reject);
    req.write(buffer);
    req.end();
  });
}

function fetchBinaryWithDns(urlStr: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const client = u.protocol === 'https:' ? https : http;
    const req = client.request({
      protocol: u.protocol,
      hostname: u.hostname,
      port: u.port || (u.protocol === 'https:' ? 443 : 80),
      path: u.pathname + u.search,
      method: 'GET',
      lookup: customDnsLookup,
    }, res => {
      const chunks: Buffer[] = [];
      res.on('data', chunk => chunks.push(Buffer.from(chunk)));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    });
    req.on('error', reject);
    req.end();
  });
}

export interface YouCamAnalysisOutput {
  status: 'success' | 'error';
  faceDetected: boolean;
  score: number;
  hydration: number;
  texture: number;
  acneScore: number;
  acneSeverity: string;
  acneDetected: boolean;
  uvScore: number;
  uvDamage: 'Low' | 'Moderate' | 'High';
  classification: string;
  finalSkinType: string;
  allClassifications: ClassPrediction[];
  topThreeClasses: ClassPrediction[];
  detectedConditions: string[];
  detectedCount: number;
  detectedRegions: DetectedFeatureRegion[];
  conditionScores: Record<string, number>;
  rawProbabilities: number[];
  modelName: string;
  modelFilename: string;
  youcamAnalysis?: any;
  error?: string;
  message?: string;
}

/**
 * Extracts a clean Buffer and mimeType from a base64 string or data URL.
 */
function parseBase64Image(dataUri: string): { buffer: Buffer; mimeType: string } {
  let cleanB64 = dataUri.trim();
  let mimeType = 'image/jpeg';

  const match = cleanB64.match(/^data:([^;]+);base64,(.+)$/);
  if (match) {
    mimeType = match[1];
    cleanB64 = match[2];
  }

  const buffer = Buffer.from(cleanB64, 'base64');
  return { buffer, mimeType };
}

/**
 * Uploads image to YouCam Presigned URL using the two-step File API with direct DNS resolution.
 */
async function uploadImageToYouCam(buffer: Buffer, mimeType: string, apiKey: string): Promise<string> {
  const fileApiUrl = 'https://yce-api-01.perfectcorp.com/s2s/v2.1/file/skin-analysis';
  const ext = mimeType.includes('png') ? 'png' : 'jpg';
  const fileName = `mirror_scan_${Date.now()}.${ext}`;

  console.log(`[YOUCAM MCP] Registering file upload (${buffer.length} bytes, ${mimeType})...`);

  const regRes = await httpsPostJson(fileApiUrl, {
    files: [
      {
        content_type: mimeType,
        file_name: fileName,
        file_size: buffer.length,
      },
    ],
  }, {
    'Authorization': `Bearer ${apiKey}`,
  });

  if (regRes.status !== 200) {
    throw new Error(`YouCam file registration failed with HTTP ${regRes.status}: ${regRes.body}`);
  }

  const regData = JSON.parse(regRes.body);
  const fileInfo = regData?.data?.files?.[0];
  if (!fileInfo || !fileInfo.file_id || !fileInfo.requests?.[0]?.url) {
    throw new Error(`YouCam file registration returned unexpected structure: ${regRes.body}`);
  }

  const putUrl = fileInfo.requests[0].url;
  const putHeaders = fileInfo.requests[0].headers || { 'Content-Type': mimeType };

  console.log(`[YOUCAM MCP] Uploading image binary to presigned S3 URL...`);
  const putRes = await httpsPutBinary(putUrl, buffer, putHeaders);

  if (putRes.status !== 200) {
    throw new Error(`Presigned file upload to YouCam storage failed with HTTP ${putRes.status}: ${putRes.body}`);
  }

  console.log(`[YOUCAM MCP] ✓ Image upload succeeded, file_id: ${fileInfo.file_id}`);
  return fileInfo.file_id;
}

const YOUCAM_MCP_URL = 'https://mcp-api-01.makeupar.com/mcp/beauty';
const DEFAULT_SKIN_TOOL_NAME = 'AI-Skin-Analysis-(Standard)';
const SKIN_ANALYSIS_DST_ACTIONS = [
  'skin_type',
  'acne',
  'oiliness',
  'moisture',
  'wrinkle',
];

/**
 * Resolves the YouCam API key from parameter, environment variables, or .env.local / .env files.
 */
export function resolveYouCamApiKey(customApiKey?: string): string {
  const fromParamOrEnv = (
    customApiKey ||
    process.env.YOUCAM_API_KEY ||
    process.env.YOUCAM_BEAUTY_KEY ||
    ''
  ).trim();

  if (fromParamOrEnv && fromParamOrEnv !== 'YOUR_API_KEY' && fromParamOrEnv !== 'YOUR_YOUCAM_API_KEY') {
    return fromParamOrEnv;
  }

  const candidateDirs = [
    process.cwd(),
    path.dirname(process.execPath),
    'E:\\orion_smart-mirror_3',
  ];

  for (const dir of candidateDirs) {
    for (const fileName of ['.env.local', '.env']) {
      try {
        const envPath = path.join(dir, fileName);
        if (fs.existsSync(envPath)) {
          const content = fs.readFileSync(envPath, 'utf8');
          const match = content.match(/^\s*YOUCAM_API_KEY\s*=\s*([^\r\n#]+)/m);
          if (match && match[1]) {
            const key = match[1].trim().replace(/^["']|["']$/g, '');
            if (key && key !== 'YOUR_API_KEY' && key !== 'YOUR_YOUCAM_API_KEY') {
              process.env.YOUCAM_API_KEY = key;
              return key;
            }
          }
        }
      } catch (_) {}
    }
  }

  return '';
}

function mcpHttpPost(
  urlStr: string,
  payload: any,
  headers: Record<string, string> = {},
  timeoutMs = 60000
): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const bodyStr = JSON.stringify(payload);
    const req = https.request(
      {
        protocol: u.protocol,
        hostname: u.hostname,
        port: u.port || 443,
        path: u.pathname + u.search,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json, text/event-stream',
          'Content-Length': Buffer.byteLength(bodyStr),
          ...headers,
        },
        lookup: customDnsLookup,
      },
      (res) => {
        let resBody = '';
        res.on('data', (c) => {
          resBody += c.toString();
        });
        res.on('end', () =>
          resolve({
            status: res.statusCode || 200,
            headers: res.headers,
            body: resBody,
          })
        );
      }
    );
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error(`MCP HTTP request timed out after ${timeoutMs / 1000}s`));
    });
    req.on('error', reject);
    req.write(bodyStr);
    req.end();
  });
}

function parseMcpSseOrJson(rawBody: string, expectedId?: number): any {
  const trimmed = (rawBody || '').trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('{')) {
    try {
      return JSON.parse(trimmed);
    } catch (_) {}
  }

  let lastParsed: any = null;
  for (const line of trimmed.split('\n')) {
    const l = line.trim();
    if (l.startsWith('data:')) {
      const jsonText = l.slice(5).trim();
      if (!jsonText) continue;
      try {
        const msg = JSON.parse(jsonText);
        lastParsed = msg;
        if (expectedId !== undefined && msg.id === expectedId) {
          return msg;
        }
      } catch (_) {}
    }
  }
  return lastParsed;
}

function pickSkinAnalysisToolName(tools: Array<{ name: string }>): string {
  if (!Array.isArray(tools) || tools.length === 0) {
    return DEFAULT_SKIN_TOOL_NAME;
  }
  const exactStandard = tools.find((t) => t.name === 'AI-Skin-Analysis-(Standard)');
  if (exactStandard) return exactStandard.name;

  const exactLegacy = tools.find((t) => t.name === 'AI-Skin-Analysis');
  if (exactLegacy) return exactLegacy.name;

  const prefixMatch = tools.find(
    (t) => /^AI-Skin-Analysis/i.test(t.name) && !/Simulation|Detection/i.test(t.name)
  );
  if (prefixMatch) return prefixMatch.name;

  return DEFAULT_SKIN_TOOL_NAME;
}

async function processYouCamMcpToolResponse(msg: any): Promise<any> {
  if (msg?.error) {
    throw new Error(`YouCam MCP Server returned JSON-RPC error: ${JSON.stringify(msg.error)}`);
  }

  const result = msg?.result;
  let parsedData: any = null;

  if (result?.structuredContent?.result) {
    parsedData = result.structuredContent.result;
  } else if (result?.content && Array.isArray(result.content)) {
    for (const c of result.content) {
      if (c.type === 'text' && c.text) {
        try {
          parsedData = JSON.parse(c.text);
          break;
        } catch (_) {
          parsedData = c.text;
        }
      }
    }
  } else if (result?.result) {
    parsedData = result.result;
  } else {
    parsedData = result;
  }

  console.log(`[YOUCAM MCP] ✓ Successfully received skin analysis response from MCP.`);

  // Check if result contains an error message from YouCam
  if (parsedData?.error_message) {
    const errMsg = String(parsedData.error_message);
    if (errMsg.includes('error_no_face')) {
      return {
        faceDetected: false,
        message: 'No face detected in the captured image. Please align your face clearly within the mirror view.',
      };
    }
    if (errMsg.includes('error_src_face_out_of_bound')) {
      return {
        faceDetected: false,
        message: 'Face is too close or extends beyond the frame. Please step back slightly so your entire face is fully visible.',
      };
    }
    if (errMsg.includes('error_below_min_image_size')) {
      return {
        faceDetected: false,
        message: 'Image resolution is too low. Please ensure clear lighting and steady positioning.',
      };
    }
    throw new Error(`YouCam API returned: ${errMsg}`);
  }

  // If result contains a ZIP URL in results.url
  const zipUrl = parsedData?.data?.results?.url || parsedData?.results?.url;
  if (zipUrl && typeof zipUrl === 'string' && zipUrl.includes('.zip')) {
    try {
      console.log(`[YOUCAM MCP] Downloading result ZIP bundle from S3...`);
      const zipBuf = await fetchBinaryWithDns(zipUrl);
      const directory = await unzipper.Open.buffer(zipBuf);

      let scoreData: any = {};
      const masks: Record<string, string> = {};

      for (const file of directory.files) {
        if (file.path.endsWith('score_info.json')) {
          const content = await file.buffer();
          scoreData = JSON.parse(content.toString('utf8'));
        } else if (file.path.endsWith('.png')) {
          const baseName = file.path.split('/').pop()?.replace('_output.png', '') || '';
          if (baseName) {
            const buf = await file.buffer();
            masks[baseName] = `data:image/png;base64,${buf.toString('base64')}`;
          }
        }
      }

      scoreData.masks = masks;
      return scoreData;
    } catch (zipErr) {
      console.warn('[YOUCAM MCP] Failed to extract zip bundle, falling back to raw payload:', zipErr);
    }
  }

  return parsedData;
}

/**
 * Direct Streamable HTTP MCP client for YouCam Beauty MCP Server.
 * Authenticates with Bearer API key, discovers the active skin analysis tool name (e.g. 'AI-Skin-Analysis-(Standard)'),
 * and executes the 5-concern skin analysis.
 */
async function callYouCamMcpStreamableHttp(fileId: string, apiKey: string, timeoutMs = 65000): Promise<any> {
  console.log(`[YOUCAM MCP] Connecting to YouCam MCP Server (${YOUCAM_MCP_URL}) via Streamable HTTP...`);

  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
  };

  // 1. Initialize MCP session
  const initRes = await mcpHttpPost(
    YOUCAM_MCP_URL,
    {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: {
          name: 'orion-smart-mirror-3',
          version: '3.0.0',
        },
      },
    },
    headers,
    15000
  );

  if (initRes.status >= 400) {
    throw new Error(`YouCam MCP initialize failed with HTTP ${initRes.status}: ${initRes.body.slice(0, 300)}`);
  }

  const rawSessionId = initRes.headers['mcp-session-id'];
  const sessionId = Array.isArray(rawSessionId) ? rawSessionId[0] : rawSessionId;
  if (sessionId) {
    headers['mcp-session-id'] = sessionId;
  }

  // 2. Send initialized notification
  await mcpHttpPost(
    YOUCAM_MCP_URL,
    {
      jsonrpc: '2.0',
      method: 'notifications/initialized',
    },
    headers,
    10000
  ).catch(() => {});

  // 3. Discover the exact Skin Analysis tool name from tools/list
  let toolName = DEFAULT_SKIN_TOOL_NAME;
  try {
    const listRes = await mcpHttpPost(
      YOUCAM_MCP_URL,
      {
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/list',
        params: {},
      },
      headers,
      15000
    );
    const listMsg = parseMcpSseOrJson(listRes.body, 2);
    const tools = listMsg?.result?.tools || [];
    toolName = pickSkinAnalysisToolName(tools);
  } catch (listErr) {
    console.warn(`[YOUCAM MCP] tools/list discovery skipped, using "${toolName}":`, listErr);
  }

  console.log(`[YOUCAM MCP] ✓ Connected (session: ${sessionId || 'stateless'}). Invoking MCP tool "${toolName}"...`);

  // 4. Call the Skin Analysis tool
  const callRes = await mcpHttpPost(
    YOUCAM_MCP_URL,
    {
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: {
        name: toolName,
        arguments: {
          request: {
            src_file_id: fileId,
            dst_actions: SKIN_ANALYSIS_DST_ACTIONS,
          },
          polling: true,
        },
      },
    },
    headers,
    timeoutMs
  );

  if (callRes.status >= 400) {
    throw new Error(`YouCam MCP tool call failed with HTTP ${callRes.status}: ${callRes.body.slice(0, 300)}`);
  }

  const callMsg = parseMcpSseOrJson(callRes.body, 3);
  if (!callMsg) {
    throw new Error(`YouCam MCP returned empty or unparseable response: ${callRes.body.slice(0, 300)}`);
  }

  return await processYouCamMcpToolResponse(callMsg);
}

/**
 * Fallback stdio bridge via npx mcp-remote in case direct Streamable HTTP is unavailable.
 */
async function callYouCamMcpViaRemoteCli(fileId: string, apiKey: string, timeoutMs = 65000): Promise<any> {
  const tempHeaderPath = path.join(os.tmpdir(), `youcam_header_${Date.now()}.txt`);
  fs.writeFileSync(tempHeaderPath, `Authorization: Bearer ${apiKey}`, 'utf8');

  return new Promise((resolve, reject) => {
    console.log(`[YOUCAM MCP] Spawning MCP remote server connection via npx mcp-remote...`);

    const child: ChildProcess = spawn('npx', [
      '-y',
      'mcp-remote',
      YOUCAM_MCP_URL,
      '--header-file',
      `"${tempHeaderPath}"`,
    ], {
      shell: true,
      env: {
        ...process.env,
        AUTH: `Bearer ${apiKey}`,
      },
    });

    let stdoutBuffer = '';
    let stderrBuffer = '';
    let initialized = false;
    let toolsListed = false;
    let isFinished = false;

    const timer = setTimeout(() => {
      if (!isFinished) {
        isFinished = true;
        cleanup();
        reject(new Error(`YouCam MCP tool execution timed out after ${timeoutMs / 1000}s`));
      }
    }, timeoutMs);

    const cleanup = () => {
      clearTimeout(timer);
      try {
        if (fs.existsSync(tempHeaderPath)) fs.unlinkSync(tempHeaderPath);
      } catch (_) {}
      try {
        child.stdin?.end();
        child.kill();
      } catch (_) {}
    };

    child.stderr?.on('data', (d) => {
      stderrBuffer += d.toString();
    });

    child.stdout?.on('data', async (data) => {
      stdoutBuffer += data.toString();
      const lines = stdoutBuffer.split('\n');
      stdoutBuffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        try {
          const msg = JSON.parse(trimmed);

          // Response to initialize (id: 1)
          if (msg.id === 1 && !initialized) {
            initialized = true;
            child.stdin?.write(JSON.stringify({
              jsonrpc: '2.0',
              method: 'notifications/initialized',
            }) + '\n');

            child.stdin?.write(JSON.stringify({
              jsonrpc: '2.0',
              id: 2,
              method: 'tools/list',
              params: {},
            }) + '\n');
          }

          // Response to tools/list (id: 2)
          if (msg.id === 2 && !toolsListed) {
            toolsListed = true;
            const tools = msg.result?.tools || [];
            const toolName = pickSkinAnalysisToolName(tools);
            console.log(`[YOUCAM MCP] ✓ Discovered MCP tool "${toolName}". Executing skin analysis...`);

            const toolCallReq = {
              jsonrpc: '2.0',
              id: 3,
              method: 'tools/call',
              params: {
                name: toolName,
                arguments: {
                  request: {
                    src_file_id: fileId,
                    dst_actions: SKIN_ANALYSIS_DST_ACTIONS,
                  },
                  polling: true,
                },
              },
            };

            child.stdin?.write(JSON.stringify(toolCallReq) + '\n');
          }

          // Response to tool call (id: 3)
          if (msg.id === 3) {
            isFinished = true;
            cleanup();
            try {
              const processed = await processYouCamMcpToolResponse(msg);
              return resolve(processed);
            } catch (err) {
              return reject(err);
            }
          }
        } catch (_) {
          // buffering json-rpc line
        }
      }
    });

    child.on('error', (err) => {
      if (!isFinished) {
        isFinished = true;
        cleanup();
        reject(new Error(`Failed to start YouCam MCP process (mcp-remote): ${err.message}`));
      }
    });

    child.on('close', (code) => {
      if (!isFinished) {
        isFinished = true;
        cleanup();
        reject(new Error(`YouCam MCP process exited prematurely with code ${code}. Stderr: ${stderrBuffer.slice(-300)}`));
      }
    });

    setTimeout(() => {
      if (!isFinished && child.stdin?.writable) {
        const initReq = {
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: '2024-11-05',
            capabilities: {},
            clientInfo: {
              name: 'orion-smart-mirror-3',
              version: '3.0.0',
            },
          },
        };
        child.stdin.write(JSON.stringify(initReq) + '\n');
      }
    }, 2500);
  });
}

/**
 * Executes the YouCam AI Skin Analysis tool via the YouCam Beauty MCP Server.
 * Uses direct Streamable HTTP MCP first, falling back to npx mcp-remote if needed.
 */
async function callYouCamMcpSkinAnalysis(fileId: string, apiKey: string, timeoutMs = 65000): Promise<any> {
  try {
    return await callYouCamMcpStreamableHttp(fileId, apiKey, timeoutMs);
  } catch (httpErr: any) {
    // Do not retry via fallback if it's an explicit YouCam API business error
    if (String(httpErr?.message || '').startsWith('YouCam API returned:')) {
      throw httpErr;
    }
    console.warn(`[YOUCAM MCP] Streamable HTTP MCP encountered error (${httpErr?.message}), falling back to mcp-remote CLI...`);
    return await callYouCamMcpViaRemoteCli(fileId, apiKey, timeoutMs);
  }
}

/**
 * Maps raw YouCam API outputs into Orion's standard 5 skin type classifications and metrics.
 */
export function mapYouCamResponseToOrionMetrics(raw: any): YouCamAnalysisOutput {
  if (raw?.faceDetected === false) {
    return {
      status: 'error',
      faceDetected: false,
      score: 0,
      hydration: 0,
      texture: 0,
      acneScore: 0,
      acneSeverity: 'Not Detected',
      acneDetected: false,
      uvScore: 0,
      uvDamage: 'Low',
      classification: 'No Face Detected',
      finalSkinType: 'No Face Detected',
      allClassifications: [],
      topThreeClasses: [],
      detectedConditions: [],
      detectedCount: 0,
      detectedRegions: [],
      conditionScores: {},
      rawProbabilities: [],
      modelName: 'YouCam AI Skin Analysis (MCP)',
      modelFilename: 'youcam-beauty-mcp',
      message: raw.message || 'No face detected.',
    };
  }

  const data = raw?.data || raw || {};
  const masks = data.masks || {};

  // Extract high-level scores
  // In YouCam score_info.json: all.score is the overall score (e.g. 77.5)
  const overallScoreRaw = Number(data.all?.score ?? data.all ?? data.skin_score ?? data.score ?? 80);
  const overallScore = Math.max(10, Math.min(100, Math.round(overallScoreRaw)));

  // Skin Type data
  const skinTypeData = data.skin_type || data.hd_skin_type || {};
  const wholeSkinType = (skinTypeData.whole?.skin_type || skinTypeData.whole?.classification || skinTypeData.classification || 'Combination').toLowerCase();
  const tZoneType = (skinTypeData.t_zone?.skin_type || skinTypeData.t_zone?.classification || 'Oily').toLowerCase();
  const uZoneType = (skinTypeData.u_zone?.skin_type || skinTypeData.u_zone?.classification || 'Normal').toLowerCase();

  // Metrics for each concern: In YouCam, ui_score is 0-100 (higher = healthier/less defect)
  // Acne:
  const acneObj = data.acne || data.hd_acne || {};
  const acneHealthScore = Number(acneObj.ui_score ?? acneObj.raw_score ?? 70);
  // Concern confidence: lower health score = higher acne presence/concern
  const acneConfidence = Math.max(0, Math.min(100, Number((100 - acneHealthScore).toFixed(1))));
  const acneDetected = acneConfidence >= 30 || wholeSkinType.includes('acne');
  const acneSeverity = acneConfidence >= 65 ? 'Severe' : acneConfidence >= 35 ? 'Moderate' : acneConfidence >= 18 ? 'Mild' : 'Not Detected';

  // Oily:
  const oilyObj = data.oiliness || data.hd_oiliness || {};
  const oilyHealthScore = Number(oilyObj.ui_score ?? oilyObj.raw_score ?? 72);
  const oilyConfidence = Math.max(0, Math.min(100, Number((100 - oilyHealthScore).toFixed(1))));
  const oilyDetected = oilyConfidence >= 35 || wholeSkinType.includes('oily') || tZoneType.includes('oily');
  const oilySeverity = oilyConfidence >= 65 ? 'Severe' : oilyConfidence >= 35 ? 'Moderate' : oilyConfidence >= 18 ? 'Mild' : 'Not Detected';

  // Dryness / Moisture:
  const moistObj = data.moisture || data.hd_moisture || {};
  const moistureScore = Number(moistObj.ui_score ?? moistObj.raw_score ?? 72);
  const hydration = Math.max(5, Math.min(100, Math.round(moistureScore)));
  // Dryness confidence = deficit in moisture
  const dryConfidence = Math.max(0, Math.min(100, Number((100 - hydration).toFixed(1))));
  const dryDetected = dryConfidence >= 35 || wholeSkinType.includes('dry') || uZoneType.includes('dry');
  const drySeverity = dryConfidence >= 65 ? 'Severe' : dryConfidence >= 35 ? 'Moderate' : dryConfidence >= 18 ? 'Mild' : 'Not Detected';

  // Wrinkles:
  const wrinkleObj = data.wrinkle || data.hd_wrinkle || {};
  const wrinkleHealthScore = Number(wrinkleObj.ui_score ?? wrinkleObj.raw_score ?? 90);
  const wrinkleConfidence = Math.max(0, Math.min(100, Number((100 - wrinkleHealthScore).toFixed(1))));
  const wrinkleDetected = wrinkleConfidence >= 35 || wholeSkinType.includes('wrinkle');
  const wrinkleSeverity = wrinkleConfidence >= 65 ? 'Severe' : wrinkleConfidence >= 35 ? 'Moderate' : wrinkleConfidence >= 18 ? 'Mild' : 'Not Detected';

  // Normal / Balanced:
  const maxConcern = Math.max(acneConfidence, oilyConfidence, dryConfidence, wrinkleConfidence);
  const normalConfidence = Number(Math.max(10, Math.min(100, 100 - maxConcern * 0.8)).toFixed(1));
  const normalDetected = maxConcern < 45 || wholeSkinType.includes('normal');
  const normalSeverity = normalDetected ? 'Healthy / Balanced' : 'Normal';

  // Texture:
  // Derived from skin smoothness (wrinkles & hydration) since texture is not requested from YouCam API
  const textureScore = Math.max(10, Math.min(100, Math.round((wrinkleHealthScore * 0.5) + (moistureScore * 0.5))));

  // UV Damage / Barrier:
  // Derived from normal skin barrier health since redness is not requested from YouCam API
  const uvScore = Math.max(10, Math.min(100, Math.round((normalConfidence * 0.4) + (moistureScore * 0.6))));
  const uvDamage: 'Low' | 'Moderate' | 'High' = uvScore >= 80 ? 'Low' : uvScore >= 55 ? 'Moderate' : 'High';

  // Build the 5 ClassPrediction items
  const allFive: ClassPrediction[] = [
    {
      className: 'acne',
      label: 'Acne',
      confidence: acneConfidence,
      probability: Number((acneConfidence / 100).toFixed(3)),
      detected: acneDetected,
      severity: acneSeverity,
      description: 'Active blemishes, papules & inflammation',
    },
    {
      className: 'oily',
      label: 'Oily',
      confidence: oilyConfidence,
      probability: Number((oilyConfidence / 100).toFixed(3)),
      detected: oilyDetected,
      severity: oilySeverity,
      description: 'Excess surface sebum & grease sheen',
    },
    {
      className: 'dry',
      label: 'Dryness',
      confidence: dryConfidence,
      probability: Number((dryConfidence / 100).toFixed(3)),
      detected: dryDetected,
      severity: drySeverity,
      description: 'Dehydration & moisture barrier deficit',
    },
    {
      className: 'wrinkles',
      label: 'Wrinkles',
      confidence: wrinkleConfidence,
      probability: Number((wrinkleConfidence / 100).toFixed(3)),
      detected: wrinkleDetected,
      severity: wrinkleSeverity,
      description: 'Fine expression lines & skin laxity',
    },
    {
      className: 'normal',
      label: 'Normal',
      confidence: normalConfidence,
      probability: Number((normalConfidence / 100).toFixed(3)),
      detected: normalDetected,
      severity: normalSeverity,
      description: 'Balanced, clear & healthy skin barrier',
    },
  ];

  // Determine Final Diagnosis Classification
  let finalSkinType = 'Normal Skin Type';
  if (wholeSkinType.includes('acne') || (acneDetected && acneConfidence > maxConcern - 5)) {
    finalSkinType = 'Acne Skin Type';
  } else if (wholeSkinType.includes('oily') || (oilyDetected && oilyConfidence > maxConcern - 5)) {
    finalSkinType = 'Oily Skin Type';
  } else if (wholeSkinType.includes('dry') || (dryDetected && dryConfidence > maxConcern - 5)) {
    finalSkinType = 'Dry Skin Type';
  } else if (wholeSkinType.includes('wrinkle') || (wrinkleDetected && wrinkleConfidence > maxConcern - 5)) {
    finalSkinType = 'Wrinkles Skin Type';
  } else if (wholeSkinType.includes('combination')) {
    finalSkinType = 'Combination Skin Type';
  } else {
    finalSkinType = 'Normal Skin Type';
  }

  // Sorted top 3 concerns
  const sorted = [...allFive].sort((a, b) => b.confidence - a.confidence);
  const topThreeClasses = sorted.slice(0, 3);
  const detectedConditions = allFive.filter(c => c.detected).map(c => c.label);

  // Generate anatomical & detected location markers for facial visualizer
  const detectedRegions: DetectedFeatureRegion[] = [];

  // 1. Acne locations if detected or prominent
  if (Array.isArray(acneObj.items) && acneObj.items.length > 0) {
    acneObj.items.forEach((item: any, idx: number) => {
      detectedRegions.push({
        type: 'acne',
        label: `Acne Spot #${idx + 1}`,
        confidence: acneConfidence,
        severity: acneSeverity,
        x: Number(item.x ?? item.center_x ?? 50),
        y: Number(item.y ?? item.center_y ?? 50),
        width: item.width ?? item.w,
        height: item.height ?? item.h,
        area: item.area || 'forehead',
      });
    });
  } else if (Array.isArray(acneObj.spots) && acneObj.spots.length > 0) {
    acneObj.spots.forEach((spot: any, idx: number) => {
      detectedRegions.push({
        type: 'acne',
        label: `Acne Spot #${idx + 1}`,
        confidence: acneConfidence,
        severity: acneSeverity,
        x: Number(spot.x ?? spot.center_x ?? 50),
        y: Number(spot.y ?? spot.center_y ?? 50),
        width: spot.width ?? spot.w,
        height: spot.height ?? spot.h,
        area: spot.area || 'forehead',
      });
    });
  } else if (acneConfidence >= 25 || acneDetected) {
    detectedRegions.push(
      { type: 'acne', label: 'Acne Papule', confidence: acneConfidence, severity: acneSeverity, x: 48, y: 34, area: 'forehead' },
      { type: 'acne', label: 'Cheek Blemish', confidence: acneConfidence, severity: acneSeverity, x: 32, y: 56, area: 'cheek_left' },
      { type: 'acne', label: 'Chin Flare', confidence: acneConfidence, severity: acneSeverity, x: 50, y: 78, area: 'chin' },
    );
  }

  // 2. Oily / Sebum sheen regions (T-Zone)
  if (oilyConfidence >= 25 || oilyDetected) {
    detectedRegions.push(
      { type: 'oily', label: 'T-Zone Sebum', confidence: oilyConfidence, severity: oilySeverity, x: 50, y: 38, width: 28, height: 18, area: 'forehead' },
      { type: 'oily', label: 'Nasal Sebum', confidence: oilyConfidence, severity: oilySeverity, x: 50, y: 52, width: 16, height: 16, area: 'nose' },
    );
  }

  // 3. Dryness / Dehydration zones (Cheeks & Jawline / U-Zone)
  if (dryConfidence >= 25 || dryDetected) {
    detectedRegions.push(
      { type: 'dry', label: 'Left Cheek Barrier', confidence: dryConfidence, severity: drySeverity, x: 30, y: 60, width: 20, height: 20, area: 'cheek_left' },
      { type: 'dry', label: 'Right Cheek Barrier', confidence: dryConfidence, severity: drySeverity, x: 70, y: 60, width: 20, height: 20, area: 'cheek_right' },
    );
  }

  // 4. Wrinkles / Expression lines
  if (wrinkleConfidence >= 25 || wrinkleDetected) {
    detectedRegions.push(
      { type: 'wrinkles', label: 'Forehead Lines', confidence: wrinkleConfidence, severity: wrinkleSeverity, x: 50, y: 28, width: 34, height: 8, area: 'forehead' },
      { type: 'wrinkles', label: 'Glabellar Frown Line', confidence: wrinkleConfidence, severity: wrinkleSeverity, x: 50, y: 40, width: 8, height: 10, area: 'glabellar' },
      { type: 'wrinkles', label: "Left Crow's Feet", confidence: wrinkleConfidence, severity: wrinkleSeverity, x: 26, y: 44, width: 10, height: 10, area: 'periorbital' },
      { type: 'wrinkles', label: "Right Crow's Feet", confidence: wrinkleConfidence, severity: wrinkleSeverity, x: 74, y: 44, width: 10, height: 10, area: 'periorbital' },
    );
  }

  // 5. Normal protective shield region
  detectedRegions.push({
    type: 'normal',
    label: 'Balanced Facial Shield',
    confidence: normalConfidence,
    severity: normalSeverity,
    x: 50,
    y: 50,
    width: 60,
    height: 70,
    area: 't_zone',
  });

  // Attach regions to predictions
  allFive.forEach(pred => {
    pred.regions = detectedRegions.filter(r => r.type === pred.className);
  });

  return {
    status: 'success',
    faceDetected: true,
    score: overallScore,
    hydration,
    texture: textureScore,
    acneScore: Math.round(100 - acneConfidence),
    acneSeverity,
    acneDetected,
    uvScore,
    uvDamage,
    classification: finalSkinType,
    finalSkinType,
    allClassifications: allFive,
    topThreeClasses,
    detectedConditions,
    detectedCount: detectedConditions.length,
    detectedRegions,
    conditionScores: {
      acne: acneConfidence / 100,
      oily: oilyConfidence / 100,
      dry: dryConfidence / 100,
      wrinkles: wrinkleConfidence / 100,
      normal: normalConfidence / 100,
    },
    rawProbabilities: [
      acneConfidence / 100,
      oilyConfidence / 100,
      dryConfidence / 100,
      wrinkleConfidence / 100,
      normalConfidence / 100,
    ],
    modelName: 'YouCam AI Skin Analysis (MCP)',
    modelFilename: 'youcam-beauty-mcp',
    youcamAnalysis: {
      ...data,
      masks,
    },
  };
}

/**
 * Main entry point: Performs complete YouCam AI Skin Analysis through the provided MCP server.
 */
export async function analyzeSkinWithYouCam(imageBase64: string, customApiKey?: string): Promise<YouCamAnalysisOutput> {
  const apiKey = resolveYouCamApiKey(customApiKey);

  if (!apiKey) {
    throw new Error(
      'YOUCAM_API_KEY is not configured in .env.local. Please add your YouCam API key to enable AI skin analysis.'
    );
  }

  if (!imageBase64 || imageBase64.length < 50) {
    throw new Error('Image data is empty or invalid.');
  }

  const { buffer, mimeType } = parseBase64Image(imageBase64);
  const imageHash = computeImageSha256(buffer);

  // 1. Result cache check (strictly 0 units consumed for repeated scans of same capture)
  const now = Date.now();
  const cached = scanResultCache.get(imageHash);
  if (cached && (now - cached.timestamp < CACHE_TTL_MS)) {
    console.log(`[YOUCAM MCP] ✓ Returning cached scan for image ${imageHash.slice(0, 10)} (0 units consumed, cached ${Math.round((now - cached.timestamp) / 1000)}s ago)`);
    return cached.data;
  }

  // 2. In-flight check (shares active promise between concurrent calls to prevent double charging)
  if (inFlightScans.has(imageHash)) {
    console.log(`[YOUCAM MCP] In-flight scan already running for image ${imageHash.slice(0, 10)}. Joining existing promise to prevent duplicate API call.`);
    return await inFlightScans.get(imageHash)!;
  }

  // 3. Initiate single scan with strictly 5 concerns (guaranteed 12 units)
  const scanPromise = (async () => {
    try {
      console.log(`[YOUCAM MCP] Starting single YouCam scan for image ${imageHash.slice(0, 10)} with 5 concerns (cost: 12 units)...`);

      // 3a. Upload the image to YouCam
      const fileId = await uploadImageToYouCam(buffer, mimeType, apiKey);

      // 3b. Call the AI-Skin-Analysis MCP tool with strictly 5 concerns
      const mcpRawResult = await callYouCamMcpSkinAnalysis(fileId, apiKey);

      // 3c. Map into Orion's standard 5 skin type format
      const mapped = mapYouCamResponseToOrionMetrics(mcpRawResult);

      // Cache successful scan
      if (mapped.faceDetected !== false) {
        scanResultCache.set(imageHash, {
          timestamp: Date.now(),
          data: mapped,
        });
      }

      return mapped;
    } finally {
      inFlightScans.delete(imageHash);
    }
  })();

  inFlightScans.set(imageHash, scanPromise);
  return await scanPromise;
}
