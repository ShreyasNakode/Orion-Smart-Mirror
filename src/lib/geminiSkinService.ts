import { SkinAnalysisRecord, SkincareRoutine } from '../types';

export interface SkinAssistantMessage {
  sender: 'user' | 'assistant';
  text: string;
  timestamp: string;
}

// ---------------------------------------------------------------------------
// Trend delta helpers — passed to Gemini so it can speak about change over time
// ---------------------------------------------------------------------------
export interface SkinTrendDelta {
  scoreDelta:     number;   // +/- vs previous scan
  hydrationDelta: number;
  textureDelta:   number;
  acneChanged:    boolean;
  previousDate:   string | null;
  scanCount:      number;
}

export function computeTrendDelta(
  current: SkinAnalysisRecord,
  history: SkinAnalysisRecord[]
): SkinTrendDelta {
  if (history.length === 0) {
    return { scoreDelta: 0, hydrationDelta: 0, textureDelta: 0, acneChanged: false, previousDate: null, scanCount: 0 };
  }
  const prev = history[0];
  return {
    scoreDelta:     current.score     - prev.score,
    hydrationDelta: current.hydration - prev.hydration,
    textureDelta:   current.texture   - prev.texture,
    acneChanged:    current.acneSeverity !== prev.acneSeverity,
    previousDate:   prev.date,
    scanCount:      history.length,
  };
}

// ---------------------------------------------------------------------------
// Primary function: ask Gemini to reason about the CV metrics and trend delta.
// This uses /api/skin/gemini_reasoning — the Gemini Live reasoning endpoint.
// Gemini is NEVER used for computer vision; it only interprets PyTorch outputs.
// ---------------------------------------------------------------------------
export async function generateSkinReasoning(
  metrics:    SkinAnalysisRecord,
  history:    SkinAnalysisRecord[] = [],
  question?:  string
): Promise<{
  explanation: string;
  spokenSummary: string;
  productIds?: string[];
  routine?: SkincareRoutine;
}> {
  const trend = computeTrendDelta(metrics, history);

  try {
    const res = await fetch('/api/skin/gemini_reasoning', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        metrics,
        history: history.slice(0, 5),     // pass up to 5 prior scans for trend context
        trend,
        question: question ?? buildDefaultQuestion(metrics, trend),
      }),
    });

    if (res.ok) {
      const data = await res.json();
      const raw: string = data.text || data.explanation || '';
      const cleanExplanation = cleanAiSummaryText(raw);
      if (cleanExplanation.trim()) {
        return {
          explanation:   cleanExplanation,
          spokenSummary: data.spokenSummary || buildSpokenSummary(metrics, trend, cleanExplanation),
          productIds:    Array.isArray(data.productIds) ? data.productIds : undefined,
          routine:       data.routine || undefined,
        };
      }
    }
  } catch (err) {
    console.warn('[GeminiSkinService] Reasoning request failed, using local fallback:', err);
  }

  // Local fallback — always data-driven from actual metrics, never random
  const explanation = buildLocalExplanation(metrics, trend);
  return {
    explanation,
    spokenSummary: buildSpokenSummary(metrics, trend, explanation),
  };
}

// ---------------------------------------------------------------------------
// Backwards-compatible wrapper kept for components that still call this name
// ---------------------------------------------------------------------------
export async function generateSkinExplanation(
  metrics:      Partial<SkinAnalysisRecord>,
  previousScans: SkinAnalysisRecord[] = []
): Promise<string> {
  const full = metrics as SkinAnalysisRecord;
  const { explanation } = await generateSkinReasoning(full, previousScans);
  return explanation;
}

// ---------------------------------------------------------------------------
// Skin Q&A assistant — used in conversational follow-ups
// ---------------------------------------------------------------------------
export async function askSkinAssistant(
  question:  string,
  latestScan?: SkinAnalysisRecord,
  history:   SkinAnalysisRecord[] = []
): Promise<string> {
  try {
    const res = await fetch('/api/skin/assistant', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ question, latestScan, history }),
    });
    if (res.ok) {
      const data = await res.json();
      const answer = data.answer || data.text || '';
      if (answer.trim()) return answer;
    }
  } catch (err) {
    console.warn('[GeminiSkinService] Assistant request failed, using fallback:', err);
  }
  return buildFallbackAnswer(question, latestScan);
}

// ---------------------------------------------------------------------------
// Helper to expand abbreviations
// ---------------------------------------------------------------------------
export function expandAbbreviations(text: string): string {
  if (!text) return '';
  return text
    .replace(/\bSPF\b/g, 'Sun Protection Factor')
    .replace(/\bBHA\b/g, 'Beta Hydroxy Acid')
    .replace(/\bAHA\b/g, 'Alpha Hydroxy Acid')
    .replace(/\bUV\b/g, 'Ultraviolet')
    .replace(/\bGI\b/g, 'Glycemic Index');
}

// ---------------------------------------------------------------------------
// Build the question string that gets sent to Gemini — includes trend context
// ---------------------------------------------------------------------------
function buildDefaultQuestion(
  metrics: SkinAnalysisRecord,
  trend:   SkinTrendDelta
): string {
  const trendPart = trend.scanCount > 0
    ? `Compared to your previous scan (${trend.scanCount} scan${trend.scanCount > 1 ? 's' : ''} in history), ` +
      `your overall skin health score changed by ${trend.scoreDelta > 0 ? '+' : ''}${trend.scoreDelta} points, ` +
      `hydration by ${trend.hydrationDelta > 0 ? '+' : ''}${trend.hydrationDelta}%, ` +
      `texture by ${trend.textureDelta > 0 ? '+' : ''}${trend.textureDelta}%. ` +
      (trend.acneChanged ? `Acne severity changed to ${metrics.acneSeverity}. ` : '')
    : 'This is your initial baseline scan — no prior history recorded yet.';

  return (
    `Provide a concise, intelligent Gemini AI Summary of these skin analysis results. ` +
    trendPart +
    ` Tone: Friendly, caring, intelligent, honest, direct, supportive, and personalized. ` +
    `CRITICAL: Do NOT fake positivity. If the skin score dropped or a concern worsened, state it clearly and constructively. ` +
    `CRITICAL: Do NOT use unexplained short forms or abbreviations. Write out full terms (e.g., Sun Protection Factor instead of SPF, Beta Hydroxy Acid instead of BHA, Ultraviolet instead of UV). ` +
    `Focus on practical lifestyle improvements (hydration, sleep, diet/fruits, stress management) and only recommend products if genuinely necessary. ` +
    `Keep the summary engaging, insightful, and easy to read (3-4 sentences max). ` +
    `End with a single-line note starting with "📌 Quick Take:" giving a direct, personalized actionable takeaway for their skin.`
  );
}

// ---------------------------------------------------------------------------
// Convert Gemini's paragraph text into a shorter spoken sentence
// ---------------------------------------------------------------------------
function buildSpokenSummary(
  metrics: SkinAnalysisRecord,
  trend:   SkinTrendDelta,
  rawExplanation: string
): string {
  const sentences = rawExplanation
    .replace(/\n+/g, ' ')
    .split(/(?<=[.!?])\s+/)
    .filter(s => s.trim().length > 10)
    .slice(0, 2)
    .join(' ');

  const delta = trend.scoreDelta !== 0
    ? ` That is ${trend.scoreDelta > 0 ? 'up' : 'down'} ${Math.abs(trend.scoreDelta)} points from your last scan.`
    : '';

  return expandAbbreviations(`Your skin score is ${metrics.score} percent, classified as ${metrics.classification}.${delta} ${sentences}`);
}

// ---------------------------------------------------------------------------
// Fully data-driven local fallback explanation — honest, direct, short
// ---------------------------------------------------------------------------
function buildLocalExplanation(metrics: SkinAnalysisRecord, trend: SkinTrendDelta): string {
  const lines: string[] = [];

  // 1. Direct score & history status (Honest & direct)
  if (trend.scanCount > 0) {
    if (trend.scoreDelta < -3) {
      lines.push(
        `Your skin health score dropped by ${Math.abs(trend.scoreDelta)} points to ${metrics.score}% (${metrics.classification}). ` +
        `This drop reflects ${metrics.acneSeverity !== 'Clear' && metrics.acneSeverity !== 'Not Detected' ? 'active acne inflammation' : metrics.hydration < 70 ? 'dermal dehydration' : 'heightened barrier stress'}.`
      );
    } else if (trend.scoreDelta > 3) {
      lines.push(
        `Your skin health score improved by +${trend.scoreDelta} points to ${metrics.score}% (${metrics.classification}). ` +
        `Your consistent hydration and daily habits are showing positive dermal progress.`
      );
    } else {
      lines.push(
        `Your skin health score remains steady at ${metrics.score}% (${metrics.classification}). ` +
        `Maintaining consistent daily habits is key for long-term barrier health.`
      );
    }
  } else {
    lines.push(
      `Initial skin health index recorded at ${metrics.score}% (${metrics.classification}). ` +
      `This baseline scan will track your skin progress over time.`
    );
  }

  // 2. Specific key concern commentary
  if (metrics.hydration < 65) {
    lines.push(`Hydration is low at ${metrics.hydration}%. Focus on drinking 2.5–3L of water daily and eating water-rich fruits like watermelon or cucumber.`);
  }
  if (metrics.acneSeverity !== 'Clear' && metrics.acneSeverity !== 'Not Detected') {
    lines.push(`Acne activity is evaluated as ${metrics.acneSeverity} (${metrics.acneScore}/100). Use cool water rinses and avoid high-sugar foods to calm inflammation.`);
  }

  // 3. Honest, non-fake Quick Take
  let quickTakeHook = '';
  if (trend.scoreDelta < -3) {
    quickTakeHook = `📌 Quick Take: Score drop detected (${metrics.score}%) — prioritize barrier repair, 2.5L+ hydration, and 8h restful sleep to recover.`;
  } else if (trend.scoreDelta > 3) {
    quickTakeHook = `📌 Quick Take: Positive progress (+${trend.scoreDelta} pts) — stay consistent with your hydration, diet, and daily Sun Protection Factor!`;
  } else if (metrics.score >= 80) {
    quickTakeHook = `📌 Quick Take: Optimal skin health (${metrics.score}%) — maintain your hydration intake and consistent morning Sun Protection Factor defense!`;
  } else if (metrics.hydration < 70) {
    quickTakeHook = `📌 Quick Take: Hydration focus needed (${metrics.hydration}%) — increase daily water intake and use a gentle barrier moisturizer.`;
  } else {
    quickTakeHook = `📌 Quick Take: Steady skin profile (${metrics.score}%) — maintain your core routine and healthy lifestyle habits.`;
  }

  lines.push(quickTakeHook);
  return expandAbbreviations(lines.join(' '));
}

// ---------------------------------------------------------------------------
// Fallback Q&A answers — driven by real scan data, never generic filler
// ---------------------------------------------------------------------------
function buildFallbackAnswer(question: string, scan?: SkinAnalysisRecord): string {
  const q = question.toLowerCase();

  if (q.includes('hydrat') || q.includes('dry') || q.includes('moisture')) {
    return scan
      ? `Your hydration is at ${scan.hydration}%. ${scan.hydration < 75 ? 'This is below the healthy threshold of 80%. Try a hyaluronic acid serum on damp skin before moisturiser.' : 'This is in the normal range — maintain it with a ceramide moisturiser at night.'}`
      : 'Keep hydration above 80% by applying hyaluronic acid serum on damp skin, followed by a ceramide cream.';
  }

  if (q.includes('acne') || q.includes('breakout') || q.includes('pimple') || q.includes('spot')) {
    return scan
      ? `Your scan shows ${scan.acneSeverity} acne severity (${scan.acneScore}/100). ${(scan.acneSeverity !== 'Clear' && scan.acneSeverity !== 'Not Detected') ? 'I recommend The Ordinary Niacinamide 10% + Zinc 1% in your morning routine to control sebum and reduce active inflammation.' : 'Your skin is clear right now — maintain this with a gentle cleanser and Sun Protection Factor daily.'}`
      : 'For active acne, 10% niacinamide and 2% salicylic acid are both evidence-backed options.';
  }

  if (q.includes('uv') || q.includes('sun') || q.includes('damage')) {
    return scan
      ? `Your Ultraviolet damage index is ${scan.uvDamage} (${scan.uvScore}/100). ${scan.uvDamage !== 'Low' ? 'Apply Neutrogena Sheer Zinc Sun Protection Factor 50 every morning to prevent further photo-ageing.' : 'Ultraviolet damage is currently low — daily Sun Protection Factor 30+ is sufficient to maintain this.'}`
      : 'Apply broad-spectrum Sun Protection Factor 50+ daily. Zinc oxide is the most photostable mineral sunscreen option.';
  }

  if (q.includes('score') || q.includes('overall') || q.includes('health')) {
    return scan
      ? `Your skin health score is ${scan.score}% with a ${scan.classification} classification. ${scan.score >= 80 ? 'This is a strong result — focus on consistency.' : 'Key areas to improve: hydration (currently ' + scan.hydration + '%) and ' + ((scan.acneSeverity !== 'Clear' && scan.acneSeverity !== 'Not Detected') ? 'acne management' : 'Ultraviolet protection') + '.'}`
      : 'Your score reflects a weighted blend of hydration, texture, acne severity, and Ultraviolet damage from your skin analysis.';
  }

  return scan
    ? `Based on your latest scan (score: ${scan.score}%, ${scan.classification} skin, hydration: ${scan.hydration}%, acne: ${scan.acneSeverity}), the top priorities are ${scan.hydration < 80 ? 'boosting hydration' : 'maintaining your current moisture level'} and ${(scan.acneSeverity !== 'Clear' && scan.acneSeverity !== 'Not Detected') ? 'managing active acne inflammation' : 'protecting against Ultraviolet damage'}.`
    : 'Please run a skin scan first so I can give you data-driven advice specific to your skin.';
}

export function cleanAiSummaryText(raw: unknown): string {
  let text = typeof raw === 'string' ? raw : JSON.stringify(raw ?? '');

  for (let i = 0; i < 3; i++) {
    text = text
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim();

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

  const cleaned = text
    .replace(/\\n/g, '\n')
    .replace(/\\"/g, '"')
    .replace(/^\s*["']|["']\s*$/g, '')
    .replace(/^(?:hey there!?|hello!?|hi!?|welcome to orion!?),?\s*(?:i'm gemini ai,?\s*your skin health consultant\.?)?\s*/i, '')
    .trim();

  return expandAbbreviations(cleaned);
}
