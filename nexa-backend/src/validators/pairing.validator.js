import { z } from 'zod';

export const recoverMrcSchema = z.object({
  deviceId: z
    .string({ required_error: 'Device ID is required' })
    .trim()
    .min(1, 'Device ID cannot be empty'),
  deviceGeneration: z
    .number({ required_error: 'Device generation must be a number' })
    .int('Device generation must be an integer')
    .min(1, 'Device generation must be >= 1')
    .default(1),
  mrcPlaintext: z
    .string({ required_error: 'Master Recovery Code plaintext is required' })
    .trim()
    .min(1, 'Master Recovery Code cannot be empty'),
  intendedNewUserId: z
    .string({ required_error: 'Intended new user ID is required' })
    .trim()
    .min(1, 'Intended new user ID cannot be empty'),
  clientRecoveryPubKey: z
    .string({ required_error: 'Client recovery public key (DER base64) is required' })
    .trim()
    .min(1, 'Public key cannot be empty'),
});

export const recoverRetrySchema = z.object({
  deviceId: z
    .string({ required_error: 'Device ID is required' })
    .trim()
    .min(1, 'Device ID cannot be empty'),
  deviceGeneration: z
    .number({ required_error: 'Device generation is required' })
    .int('Device generation must be an integer')
    .min(1, 'Device generation must be >= 1'),
  ratId: z
    .string({ required_error: 'ratId is required' })
    .trim()
    .min(1, 'ratId cannot be empty'),
  action: z
    .literal('RECOVER_RETRY', {
      errorMap: () => ({ message: 'Action must be strictly RECOVER_RETRY' }),
    }),
  nonce: z
    .string({ required_error: 'Nonce is required' })
    .trim()
    .min(16, 'Nonce must be at least 16 characters')
    .max(128, 'Nonce must not exceed 128 characters'),
  timestamp: z
    .number({ required_error: 'Timestamp is required' })
    .int('Timestamp must be an integer millisecond value')
    .positive('Timestamp must be positive'),
  signature: z
    .string({ required_error: 'PoP signature is required' })
    .trim()
    .min(1, 'Signature cannot be empty'),
});

export const deliveryKeepaliveSchema = z.object({
  action: z.literal('KEEPALIVE'),
  sessionId: z.string().trim().min(1, 'Session ID cannot be empty'),
  deviceId: z.string().trim().min(1, 'Device ID cannot be empty'),
  operationId: z.string().trim().min(1, 'Operation ID cannot be empty'),
  deviceGeneration: z.number().int().min(1),
  clientRetrievalId: z.string().trim().min(1, 'Client retrieval ID cannot be empty'),
  fencingToken: z.number().int().nonnegative(),
  timestamp: z.number().int().positive(),
  signature: z.string().trim().min(1, 'Signature cannot be empty'),
});

export const confirmActivationSchema = z.object({
  action: z.literal('ACK'),
  sessionId: z.string().trim().min(1, 'Session ID cannot be empty'),
  deviceId: z.string().trim().min(1, 'Device ID cannot be empty'),
  operationId: z.string().trim().min(1, 'Operation ID cannot be empty'),
  deviceGeneration: z.number().int().min(1),
  clientRetrievalId: z.string().trim().min(1, 'Client retrieval ID cannot be empty'),
  fencingToken: z.number().int().nonnegative(),
  timestamp: z.number().int().positive(),
  signature: z.string().trim().min(1, 'Signature cannot be empty'),
});

export const releaseFenceSchema = z.object({
  action: z.literal('RELEASE'),
  sessionId: z.string().trim().min(1, 'Session ID cannot be empty'),
  deviceId: z.string().trim().min(1, 'Device ID cannot be empty'),
  operationId: z.string().trim().min(1, 'Operation ID cannot be empty'),
  deviceGeneration: z.number().int().min(1),
  clientRetrievalId: z.string().trim().min(1, 'Client retrieval ID cannot be empty'),
  fencingToken: z.number().int().nonnegative(),
  timestamp: z.number().int().positive(),
  signature: z.string().trim().min(1, 'Signature cannot be empty'),
});

export const adminResetSchema = z.object({
  deviceId: z.string().trim().min(1, 'Device ID cannot be empty').optional(),
  expectedGeneration: z.number().int().min(1),
  newMasterHash: z.string().trim().min(1, 'New master hash cannot be empty'),
});
