import app from './app.js';
import { isGeminiConfigured, getGeminiModel } from './config/gemini.js';
import { connectDatabase, disconnectDatabase, getDatabaseStatus } from './config/db.js';
import { validateRatSecretConfig } from './services/pairing.service.js';
import { validateJwtSecretsConfig } from './utils/auth.utils.js';
import { validateDeviceJwtSecretsConfig } from './utils/deviceAuth.utils.js';

// Fail closed at startup if required secret configuration is missing or invalid
try {
  validateRatSecretConfig();
  validateJwtSecretsConfig();
  validateDeviceJwtSecretsConfig();
} catch (err) {
  console.error(`[Startup Configuration Error] ${err.message}`);
  process.exit(1);
}

const PORT = parseInt(process.env.PORT, 10) || 5000;

// Connect to MongoDB asynchronously on startup
connectDatabase().catch((err) => {
  console.warn('[Server Startup] MongoDB connection deferred:', err.message);
});

const server = app.listen(PORT, () => {
  const model = getGeminiModel();
  const configured = isGeminiConfigured();
  const dbStatus = getDatabaseStatus();

  console.log('====================================================');
  console.log(`🤖 NEXA 2.0 AI Brain Server running on port ${PORT}`);
  console.log(`📡 Health Check: http://localhost:${PORT}/api/health`);
  console.log(`💬 Chat Endpoint: POST http://localhost:${PORT}/api/chat`);
  console.log(`🧠 Gemini Model: ${model}`);
  console.log(`🔑 Gemini API Key: ${configured ? 'Configured ✅' : 'Not Configured (Missing in .env) ⚠️'}`);
  console.log(`🗄️  MongoDB Database: ${dbStatus.status}`);
  console.log('====================================================');
});

// Graceful shutdown
const shutdown = async (signal) => {
  console.log(`\n[Server] Received ${signal}. Shutting down gracefully...`);
  await disconnectDatabase();
  server.close(() => {
    console.log('[Server] Closed remaining connections. Exiting.');
    process.exit(0);
  });
};

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
