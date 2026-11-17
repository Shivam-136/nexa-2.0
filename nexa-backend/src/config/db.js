import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

/**
 * Sanitizes a MongoDB connection URI for safe console logging,
 * stripping username, password, or auth credentials.
 *
 * @param {string} uri
 * @returns {string} Sanitized connection string
 */
export function sanitizeMongoUri(uri) {
  if (!uri || typeof uri !== 'string') return '';
  try {
    return uri.replace(/\/\/[^:]+:[^@]+@/, '//***:***@');
  } catch {
    return '[Protected Mongo URI]';
  }
}

/**
 * Retrieves the configured MongoDB URI.
 *
 * @returns {string}
 */
export function getMongoUri() {
  return process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/nexa';
}

/**
 * Returns current database connection status and telemetry.
 * Safe for frontend consumption (zero credentials exposed).
 *
 * @returns {{ isConnected: boolean, status: string, name?: string, host?: string, port?: number }}
 */
export function getDatabaseStatus() {
  const readyState = mongoose.connection.readyState;
  const states = {
    0: 'disconnected',
    1: 'connected',
    2: 'connecting',
    3: 'disconnecting',
  };

  const status = states[readyState] || 'unknown';
  const isConnected = readyState === 1;

  if (isConnected && mongoose.connection.db) {
    return {
      isConnected: true,
      status: 'connected',
      name: mongoose.connection.name || 'nexa',
      host: mongoose.connection.host || '127.0.0.1',
      port: mongoose.connection.port || 27017,
    };
  }

  return {
    isConnected: false,
    status,
    name: mongoose.connection.name || 'nexa',
  };
}

/**
 * Establishes a resilient connection to MongoDB using Mongoose.
 * Non-blocking: if MongoDB is unreachable, it logs a warning without crashing the server.
 *
 * @param {string} [uriOverride]
 * @returns {Promise<boolean>} Whether connection succeeded
 */
export async function connectDatabase(uriOverride) {
  const uri = uriOverride || getMongoUri();
  const sanitized = sanitizeMongoUri(uri);

  try {
    // If already connected, return true
    if (mongoose.connection.readyState === 1) {
      return true;
    }

    mongoose.set('strictQuery', true);

    await mongoose.connect(uri, {
      serverSelectionTimeoutMS: 5000,
      connectTimeoutMS: 10000,
      socketTimeoutMS: 45000,
      family: 4, // IPv4
    });

    console.log(`🗄️  MongoDB Connected successfully to: ${sanitized}`);
    return true;
  } catch (error) {
    console.warn(`⚠️  MongoDB Connection Notice: Unable to connect to ${sanitized} (${error.message}).`);
    console.warn('    NEXA will run in graceful fallback mode for persistent memory.');
    return false;
  }
}

/**
 * Closes the MongoDB connection gracefully.
 *
 * @returns {Promise<void>}
 */
export async function disconnectDatabase() {
  try {
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
      console.log('🗄️  MongoDB disconnected gracefully.');
    }
  } catch (error) {
    console.error('Error disconnecting MongoDB:', error.message);
  }
}

// Connection event telemetry
mongoose.connection.on('error', (err) => {
  console.error('[MongoDB Error]:', err.message);
});

mongoose.connection.on('disconnected', () => {
  console.log('[MongoDB] Connection lost or disconnected.');
});

mongoose.connection.on('reconnected', () => {
  console.log('[MongoDB] Connection re-established.');
});

export default {
  connectDatabase,
  disconnectDatabase,
  getDatabaseStatus,
  getMongoUri,
  sanitizeMongoUri,
};
