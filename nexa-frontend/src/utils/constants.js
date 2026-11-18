/**
 * Global Application Constants & Route Definitions
 */

export const APP_CONFIG = {
  NAME: 'NEXA 2.0',
  TAGLINE: 'AI Personal Computer Operator',
  VERSION: (typeof import.meta !== 'undefined' && import.meta.env?.VITE_APP_VERSION) || '2.0.0',
  ENV: (typeof import.meta !== 'undefined' && import.meta.env?.VITE_APP_ENV) || 'development',
};

export const ROUTES = {
  HOME: '/',
  DASHBOARD: '/',
  ASSISTANT: '/assistant',
  AUTOMATIONS: '/automations',
  HISTORY: '/history',
  DESKTOP: '/desktop',
  SETTINGS: '/settings',
  LOGIN: '/login',
  REGISTER: '/register',
};

const resolveBaseUrl = () => {
  if (typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_BASE_URL) {
    return import.meta.env.VITE_API_BASE_URL;
  }
  if (typeof window !== 'undefined' && window.location?.hostname) {
    return `${window.location.protocol}//${window.location.hostname}:5000/api`;
  }
  return 'http://localhost:5000/api';
};

const resolveAuthBaseUrl = () => {
  if (typeof import.meta !== 'undefined' && import.meta.env?.VITE_AUTH_BASE_URL) {
    return import.meta.env.VITE_AUTH_BASE_URL;
  }
  if (typeof window !== 'undefined' && window.location?.hostname) {
    return `${window.location.protocol}//${window.location.hostname}:5000/api/v1/auth`;
  }
  return 'http://localhost:5000/api/v1/auth';
};

const resolveWsUrl = () => {
  if (typeof import.meta !== 'undefined' && import.meta.env?.VITE_WS_BASE_URL) {
    return import.meta.env.VITE_WS_BASE_URL;
  }
  if (typeof window !== 'undefined' && window.location?.hostname) {
    const wsProto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${wsProto}//${window.location.hostname}:5000/ws`;
  }
  return 'ws://localhost:5000/ws';
};

export const API_ENDPOINTS = {
  BASE_URL: resolveBaseUrl(),
  AUTH_BASE_URL: resolveAuthBaseUrl(),
  WS_URL: resolveWsUrl(),
  DESKTOP_BRIDGE_URL: (typeof import.meta !== 'undefined' && import.meta.env?.VITE_DESKTOP_BRIDGE_URL) || 'ws://localhost:9001/desktop',
  MEMORIES: '/memories',
  CONVERSATIONS: '/conversations',
  OLLAMA_STATUS: '/chat/ollama/status',
};

export const DEFAULT_AI_PROVIDER = 'ollama';
export const DEFAULT_OLLAMA_MODEL = 'llama3.2';
export const DEFAULT_OLLAMA_BASE_URL = 'http://127.0.0.1:11434';
export const DEFAULT_GEMINI_FALLBACK = false;

export const SUPPORTED_AI_PROVIDERS = [
  {
    id: 'ollama',
    name: 'Ollama Local',
    description: 'Privacy-focused on-device AI inference via local daemon. No data leaves your machine.',
    badge: 'Local-First',
    recommended: true,
  },
  {
    id: 'gemini',
    name: 'Google Gemini',
    description: 'High-parameter cloud reasoning brain using Google Gen AI SDK. Requires GEMINI_API_KEY in backend.',
    badge: 'Cloud Brain',
    recommended: false,
  },
];

export const MEMORY_CATEGORIES = [
  'All',
  'preference',
  'project',
  'personal',
  'instruction',
  'fact',
  'other',
];

export const ASSISTANT_STATES = {
  IDLE: 'idle',
  LISTENING: 'listening',
  PROCESSING: 'processing',
  SPEAKING: 'speaking',
  ERROR: 'error',
};

export const VOICE_LANGUAGES = [
  { code: 'en-US', label: 'English (US)', short: 'EN' },
  { code: 'hi-IN', label: 'Hindi (हिन्दी)', short: 'HI' },
];

export const QUICK_ACTIONS = [
  {
    id: 'open-browser',
    label: 'Open Browser',
    description: 'Launch isolated Chromium session',
    icon: 'Compass',
    actionPrompt: 'Open browser for automation session',
  },
  {
    id: 'open-vscode',
    label: 'Open VS Code',
    description: 'Open active workspace directory in editor',
    icon: 'Code2',
    actionPrompt: 'Open VS Code in workspace directory',
  },
  {
    id: 'search-google',
    label: 'Search Google',
    description: 'Query web search via browser automation',
    icon: 'Search',
    actionPrompt: 'Search Google for latest developer updates',
  },
  {
    id: 'manage-files',
    label: 'Manage Files',
    description: 'Explore and index local file system',
    icon: 'FolderOpen',
    actionPrompt: 'Inspect local filesystem directory contents',
  },
];
