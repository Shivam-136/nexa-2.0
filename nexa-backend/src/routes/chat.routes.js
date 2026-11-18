import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import {
  handleChatMessage,
  getChatStatus,
  getOllamaConnectionStatus,
} from '../controllers/chat.controller.js';
import { requireAuth } from '../middleware/auth.middleware.js';

const router = Router();

// Rate limiter for chat endpoint: 60 requests per minute per IP
const chatLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  message: {
    success: false,
    error: 'Too many chat requests from this IP. Please wait a moment before sending another message.',
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// Rate limiter for Ollama status check endpoint: 60 requests per minute per IP
const ollamaStatusLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  message: {
    success: false,
    error: 'Too many status check requests from this IP. Please wait a moment.',
  },
  standardHeaders: true,
  legacyHeaders: false,
});

router.post('/', chatLimiter, requireAuth, handleChatMessage);
router.get('/status', getChatStatus);
router.get('/ollama/status', ollamaStatusLimiter, requireAuth, getOllamaConnectionStatus);

export default router;
