import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { handleChatMessage, getChatStatus } from '../controllers/chat.controller.js';

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

router.post('/', chatLimiter, handleChatMessage);
router.get('/status', getChatStatus);

export default router;
