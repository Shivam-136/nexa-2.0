import { z } from 'zod';
import { validateOllamaBaseUrl } from '../config/ollama.js';

export const registerSchema = z.object({
  email: z
    .string({ required_error: 'Email is required' })
    .email('Please provide a valid email address')
    .trim()
    .toLowerCase()
    .max(150, 'Email must be under 150 characters'),
  password: z
    .string({ required_error: 'Password is required' })
    .min(8, 'Password must be at least 8 characters long')
    .max(128, 'Password must be under 128 characters'),
  displayName: z
    .string()
    .trim()
    .max(100, 'Display name must be under 100 characters')
    .optional(),
});

export const loginSchema = z.object({
  email: z
    .string({ required_error: 'Email is required' })
    .email('Please provide a valid email address')
    .trim()
    .toLowerCase(),
  password: z
    .string({ required_error: 'Password is required' })
    .min(1, 'Password is required'),
});

export const updatePreferencesSchema = z.object({
  displayName: z
    .string()
    .trim()
    .max(100, 'Display name must be under 100 characters')
    .optional(),
  aiProvider: z
    .enum(['gemini', 'ollama'], {
      errorMap: () => ({ message: 'AI provider must be either "gemini" or "ollama"' }),
    })
    .optional(),
  ollamaModel: z
    .string()
    .trim()
    .min(1, 'Ollama model name cannot be empty')
    .max(100, 'Ollama model name must be under 100 characters')
    .optional(),
  ollamaBaseUrl: z
    .string()
    .trim()
    .max(255, 'Ollama base URL must be under 255 characters')
    .refine(
      (url) => {
        try {
          validateOllamaBaseUrl(url);
          return true;
        } catch {
          return false;
        }
      },
      {
        message:
          'Invalid or unsafe Ollama base URL. Only local loopback endpoints (e.g. http://127.0.0.1:11434, localhost, ::1) are permitted.',
      }
    )
    .optional(),
  geminiFallback: z.boolean().optional(),
  voiceLanguage: z
    .string()
    .trim()
    .max(30, 'Voice language code must be under 30 characters')
    .optional(),
});
