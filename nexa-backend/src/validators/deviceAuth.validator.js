import { z } from 'zod';

export const deviceTokenAuthSchema = z.object({
  deviceId: z
    .string({ required_error: 'Device ID is required' })
    .trim()
    .min(8, 'Device ID must be at least 8 characters')
    .max(128, 'Device ID must not exceed 128 characters'),
  deviceGeneration: z
    .number({ required_error: 'Device generation is required' })
    .int('Device generation must be an integer')
    .min(1, 'Device generation must be >= 1'),
  deviceToken: z
    .string({ required_error: 'Device token is required' })
    .trim()
    .min(16, 'Device token must be at least 16 characters')
    .max(1024, 'Device token must not exceed 1024 characters'),
});

export const deviceRefreshSchema = z.object({
  refreshToken: z
    .string({ required_error: 'Refresh token is required' })
    .trim()
    .min(16, 'Refresh token is invalid')
    .max(4096, 'Refresh token exceeds maximum length'),
  deviceId: z
    .string()
    .trim()
    .min(8, 'Device ID must be at least 8 characters')
    .max(128, 'Device ID must not exceed 128 characters')
    .optional(),
  deviceGeneration: z
    .number()
    .int('Device generation must be an integer')
    .min(1, 'Device generation must be >= 1')
    .optional(),
});

export const deviceHeartbeatSchema = z.object({
  deviceId: z
    .string()
    .trim()
    .min(8, 'Device ID must be at least 8 characters')
    .max(128, 'Device ID must not exceed 128 characters')
    .optional(),
  deviceGeneration: z
    .number()
    .int('Device generation must be an integer')
    .min(1, 'Device generation must be >= 1')
    .optional(),
  agentVersion: z
    .string()
    .trim()
    .max(32, 'Agent version must not exceed 32 characters')
    .optional(),
  platform: z
    .string()
    .trim()
    .max(32, 'Platform must not exceed 32 characters')
    .optional(),
  arch: z
    .string()
    .trim()
    .max(32, 'Architecture must not exceed 32 characters')
    .optional(),
  uptimeSeconds: z
    .number()
    .min(0, 'Uptime must be non-negative')
    .max(315360000, 'Uptime exceeds maximum')
    .optional(),
  ollamaAvailable: z.boolean().optional(),
  installedModels: z.array(z.string().trim().max(100)).max(50).optional(),
});
