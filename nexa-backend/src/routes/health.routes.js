import { Router } from 'express';
import { isGeminiConfigured, getGeminiModel } from '../config/gemini.js';
import { getDatabaseStatus } from '../config/db.js';

const router = Router();

router.get('/', (req, res) => {
  const configured = isGeminiConfigured();
  const dbStatus = getDatabaseStatus();

  return res.status(200).json({
    status: 'ok',
    service: 'NEXA 2.0 AI Brain Core',
    version: '2.0.0',
    timestamp: new Date().toISOString(),
    uptime: Math.floor(process.uptime()),
    gemini: {
      configured,
      model: getGeminiModel(),
      status: configured ? 'ready' : 'missing_api_key',
    },
    database: dbStatus,
  });
});

export default router;
