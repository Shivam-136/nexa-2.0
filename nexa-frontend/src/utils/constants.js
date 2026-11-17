/**
 * Global Application Constants & Route Definitions
 */

export const APP_CONFIG = {
  NAME: 'NEXA 2.0',
  TAGLINE: 'AI Personal Computer Operator',
  VERSION: import.meta.env.VITE_APP_VERSION || '2.0.0',
  ENV: import.meta.env.VITE_APP_ENV || 'development',
};

export const ROUTES = {
  HOME: '/',
  DASHBOARD: '/',
  ASSISTANT: '/assistant',
  AUTOMATIONS: '/automations',
  HISTORY: '/history',
  DESKTOP: '/desktop',
  SETTINGS: '/settings',
};

export const API_ENDPOINTS = {
  BASE_URL: import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000/api/v1',
  WS_URL: import.meta.env.VITE_WS_BASE_URL || 'ws://localhost:8000/ws',
  DESKTOP_BRIDGE_URL: import.meta.env.VITE_DESKTOP_BRIDGE_URL || 'ws://localhost:9001/desktop',
};

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
