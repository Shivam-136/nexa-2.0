import { GoogleGenAI } from '@google/genai';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Resolve .env path from nexa-backend root regardless of current working directory
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

/**
 * Default Gemini model configuration.
 * Recommended model for fast, capable multimodal & chat reasoning.
 */
export const DEFAULT_GEMINI_MODEL = 'gemini-2.5-flash';

/**
 * Checks whether a valid Gemini API key is configured.
 * @returns {boolean}
 */
export function isGeminiConfigured() {
  const apiKey = process.env.GEMINI_API_KEY;
  return Boolean(apiKey && apiKey.trim() && apiKey !== 'your_gemini_api_key_here');
}

/**
 * Retrieves the configured model name.
 * @returns {string}
 */
export function getGeminiModel() {
  return process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL;
}

/**
 * Lazily initializes and returns the GoogleGenAI instance.
 * Configured with httpOptions: { apiVersion: 'v1beta' } for Developer Instruction support.
 * Throws a descriptive error if the API key is missing.
 * @returns {GoogleGenAI}
 */
let cachedClient = null;

export function getGeminiClient() {
  if (!isGeminiConfigured()) {
    throw new Error(
      'GEMINI_API_KEY is not configured on the backend server. Please set a valid key in nexa-backend/.env.'
    );
  }

  if (!cachedClient) {
    cachedClient = new GoogleGenAI({
      apiKey: process.env.GEMINI_API_KEY.trim(),
      httpOptions: {
        apiVersion: 'v1beta',
      },
    });
  }

  return cachedClient;
}

/**
 * Resets the cached GoogleGenAI client (useful for unit testing and key reloads).
 */
export function resetGeminiClient() {
  cachedClient = null;
}
