import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import {
  getMemories,
  createMemory,
  updateMemory,
  deleteMemory,
  clearMemories,
} from '../controllers/memory.controller.js';

const router = Router();

// Memory rate limiter: 120 operations per minute
const memoryLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  message: {
    success: false,
    error: 'Too many memory management requests. Please try again shortly.',
  },
  standardHeaders: true,
  legacyHeaders: false,
});

router.use(memoryLimiter);

router.get('/', getMemories);
router.post('/', createMemory);
router.put('/:id', updateMemory);
router.delete('/:id', deleteMemory);
router.delete('/', clearMemories);

export default router;
