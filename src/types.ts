export type ViewState = 'dashboard' | 'skin_analysis' | 'home_control' | 'spotify' | 'health' | 'settings';

export interface DetectedFeatureRegion {
  type: 'acne' | 'oily' | 'dry' | 'wrinkles' | 'pore' | 'redness' | string;
  label: string;
  confidence?: number;
  severity?: string;
  x: number; // percentage 0-100 across face image
  y: number; // percentage 0-100 across face image
  width?: number; // percentage 0-100
  height?: number; // percentage 0-100
  area?: 'forehead' | 't_zone' | 'u_zone' | 'cheek_left' | 'cheek_right' | 'nose' | 'chin' | 'periorbital' | 'glabellar' | string;
}

export interface ClassPrediction {
  className: string;
  label: string;
  confidence: number;
  probability?: number;
  logit?: number;
  severity: 'Clear' | 'Not Detected' | 'Mild' | 'Moderate' | 'Severe' | string;
  detected?: boolean;
  regions?: DetectedFeatureRegion[];
  description?: string;
}

export interface SkinAnalysisRecord {
  id: string;
  date: string;
  score: number;
  hydration: number;
  texture: number;
  acneSeverity: 'Clear' | 'Not Detected' | 'Mild' | 'Moderate' | 'Severe' | string;
  acneScore: number;
  acneDetected?: boolean;
  spotCount?: number;
  uvDamage: 'Low' | 'Moderate' | 'High';
  uvScore: number;
  classification: 'Normal' | 'Dry' | 'Oily' | 'Combination' | 'Sensitive' | string;
  finalSkinType?: string;
  topThreeClasses?: ClassPrediction[];
  allClassifications?: ClassPrediction[];
  detectedConditions?: string[];
  detectedCount?: number;
  detectedRegions?: DetectedFeatureRegion[];
  imageUrl?: string;
  aiExplanation?: string;
  routineAdjustments?: string[];
  recommendations?: Recommendation[];
  routine?: SkincareRoutine;
  faceDetected?: boolean;
  agreementScore?: number;
  disagreements?: string[];
  fusionSummary?: string;
  primaryModelPredictions?: Record<string, any>;
  geminiVisionAnalysis?: Record<string, any>;
  youcamAnalysis?: Record<string, any>;
}

export interface Recommendation {
  id: string;
  name: string;
  brand: string;
  description: string;
  image: string;
  targetIssue: string;
  price?: string;
  activeIngredients: string[];
  productUrl: string;
  whyRecommended: string;
  usageInstructions: string;
}

export interface SkincareRoutineItem {
  id: string;
  step: number;
  title: string;
  category: 'cleanser' | 'serum' | 'moisturizer' | 'sunscreen' | 'treatment' | 'lifestyle';
  productName: string;
  reason: string;
  completed: boolean;
  timeOfDay: 'am' | 'pm';
  catalogProductId?: string;
}

export interface SkincareRoutine {
  lastUpdated: string;
  morning: SkincareRoutineItem[];
  night: SkincareRoutineItem[];
  customNotes?: string;
}

export type SmartDeviceType = 'light' | 'fan' | 'ac' | 'climate' | 'tv' | 'media_player' | 'switch' | 'lock' | 'cover' | 'vacuum' | 'sensor' | 'unknown';

export interface SmartDeviceCapability {
  type: 'power' | 'brightness' | 'color' | 'color_temperature' | 'fan_speed' | 'temperature' | 'hvac_mode' | 'preset_mode' | 'media' | 'lock' | 'cover_position';
  min?: number;
  max?: number;
  step?: number;
  options?: string[];
}

export interface SmartDevice {
  id: string;
  name: string;
  type: SmartDeviceType;
  room: string;
  isOn: boolean;
  value?: number;
  entityId?: string;
  domain?: string;
  state?: string;
  available?: boolean;
  unit?: string;
  supportedFeatures?: number;
  attributes?: Record<string, any>;
  capabilities?: SmartDeviceCapability[];
}

export interface VoiceCommandResult {
  text: string;
  needsBrowser?: boolean;
  browserPrompt?: string;
}

export type BrowserActivityStatus = 'idle' | 'starting' | 'running' | 'paused' | 'success' | 'failed';

export interface BrowserActivity {
  status: BrowserActivityStatus;
  backend?: 'orion_webview' | 'playwright' | string;
  website?: string;
  liveUrl?: string;
  activeTab?: string;
  action?: string;
  target?: string;
  typedText?: string;
  formFields?: string[];
  progress?: number;
  step?: number;
  totalSteps?: number;
  message?: string;
  error?: string;
  cursor?: { x: number; y: number; clicking?: boolean };
}

export interface SpotifyTrack {
  title: string;
  artist: string;
  albumUrl: string;
  isPlaying: boolean;
}
