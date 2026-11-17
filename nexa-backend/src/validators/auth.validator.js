import { z } from 'zod';

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
    .max(100, 'Ollama model name must be under 100 characters')
    .optional(),
  geminiFallback: z.boolean().optional(),
  voiceLanguage: z
    .string()
    .trim()
    .max(30, 'Voice language code must be under 30 characters')
    .optional(),
});
