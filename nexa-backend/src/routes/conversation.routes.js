import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import {
  listConversations,
  getConversation,
  deleteConversation,
  clearConversations,
} from '../controllers/conversation.controller.js';

const router = Router();

// Conversation rate limiter: 120 operations per minute
const conversationLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  message: {
    success: false,
    error: 'Too many conversation history requests. Please try again shortly.',
  },
  standardHeaders: true,
  legacyHeaders: false,
});

router.use(conversationLimiter);

router.get('/', listConversations);
router.get('/:id', getConversation);
router.delete('/:id', deleteConversation);
router.delete('/', clearConversations);

export default router;
