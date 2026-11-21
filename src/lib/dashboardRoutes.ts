import { ViewState } from '../types';
import routesConfig from '../../dashboard_routes.json';

type DashboardRoute = {
  id: ViewState;
  label: string;
  aliases: string[];
};

const NAVIGATION_PREFIXES = [
  'go to',
  'go',
  'open',
  'show',
  'show me',
  'take me to',
  'take me',
  'switch to',
  'navigate to',
  'bring up',
  'pull up',
  'launch',
  'display',
  'view',
];

const TARGET_SUFFIXES = ['screen', 'dashboard', 'page', 'module', 'tab', 'view', 'section'];
const OPTIONAL_FILLERS = ['the', 'my', 'orion'];
const TRAILING_WORDS = ['please', 'now', 'for me'];

export type DashboardNavigationIntent = {
  view: ViewState;
  label: string;
  matchedAlias: string;
  confidence: number;
};

const normalizeVoiceText = (value: string) => value
  .toLowerCase()
  .replace(/['?]/g, '')
  .replace(/[^a-z0-9]+/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const routeData = (routesConfig.routes || []) as DashboardRoute[];

export const DASHBOARD_ROUTES: DashboardRoute[] = routeData.map(route => ({
  ...route,
  aliases: Array.from(new Set([
    route.label,
    route.id.replace(/_/g, ' '),
    ...(route.aliases || []),
  ].map(normalizeVoiceText).filter(Boolean))),
}));

export const DASHBOARD_LABEL_BY_ID = DASHBOARD_ROUTES.reduce((acc, route) => {
  acc[route.id] = route.label;
  return acc;
}, {} as Record<ViewState, string>);

export const resolveDashboardView = (value?: string | null): ViewState | null => {
  const normalized = normalizeVoiceText(String(value || ''));
  if (!normalized) return null;

  const direct = DASHBOARD_ROUTES.find(route => route.id === value || normalizeVoiceText(route.id) === normalized);
  if (direct) return direct.id;

  const byAlias = DASHBOARD_ROUTES.find(route => route.aliases.includes(normalized));
  return byAlias?.id || null;
};

const suffixPattern = `(?:\\s+(?:${TARGET_SUFFIXES.map(escapeRegExp).join('|')}))*`;
const fillerPattern = `(?:(?:${OPTIONAL_FILLERS.map(escapeRegExp).join('|')})\\s+)*`;
const prefixPattern = `(?:${NAVIGATION_PREFIXES.map(prefix => escapeRegExp(normalizeVoiceText(prefix))).join('|')})`;
const trailingPattern = `(?:\s+(?:${TRAILING_WORDS.map(escapeRegExp).join('|')}))*`;

export const detectDashboardNavigationIntent = (text?: string | null): DashboardNavigationIntent | null => {
  const normalized = normalizeVoiceText(String(text || ''));
  if (!normalized) return null;

  const candidates = DASHBOARD_ROUTES
    .flatMap(route => route.aliases.map(alias => ({ route, alias })))
    .sort((a, b) => b.alias.length - a.alias.length);

  for (const { route, alias } of candidates) {
    const target = escapeRegExp(alias);
    const commandedPattern = new RegExp(`(?:^|\\b)${prefixPattern}\\s+${fillerPattern}${target}${suffixPattern}(?:\\b|$)`);
    if (commandedPattern.test(normalized)) {
      return { view: route.id, label: route.label, matchedAlias: alias, confidence: 0.96 };
    }

    const barePattern = new RegExp(`^${fillerPattern}${target}${suffixPattern}${trailingPattern}$`);
    if (normalized.length <= alias.length + 16 && barePattern.test(normalized)) {
      return { view: route.id, label: route.label, matchedAlias: alias, confidence: 0.82 };
    }
  }

  return null;
};

export const navigateToDashboard = (viewOrAlias?: string | null, source = 'unknown', metadata: Record<string, unknown> = {}) => {
  const view = resolveDashboardView(viewOrAlias);
  if (!view) return null;

  window.dispatchEvent(new CustomEvent('orion_navigate', {
    detail: {
      view,
      label: DASHBOARD_LABEL_BY_ID[view] || view,
      source,
      timestamp: Date.now(),
      ...metadata,
    },
  }));
  return view;
};
