import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import authRoutes from './routes/auth.routes.js';
import chatRoutes from './routes/chat.routes.js';
import healthRoutes from './routes/health.routes.js';
import memoryRoutes from './routes/memory.routes.js';
import conversationRoutes from './routes/conversation.routes.js';
import pairingRoutes from './routes/pairing.routes.js';
import deviceRoutes from './routes/device.routes.js';
import { errorHandler, notFoundHandler } from './middleware/error.middleware.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const app = express();

// Security middleware
app.use(helmet());

// CORS configuration supporting local frontend dev ports
const allowedOrigins = [
  'http://localhost:3000',
  'http://localhost:5173',
  'http://127.0.0.1:3000',
  'http://127.0.0.1:5173',
  process.env.CLIENT_ORIGIN,
].filter(Boolean);

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (like mobile apps, curl, or same-origin)
      if (!origin || allowedOrigins.includes(origin) || process.env.NODE_ENV !== 'production') {
        return callback(null, true);
      }
      return callback(new Error('Blocked by CORS policy'));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Accept', 'X-Device-Id', 'X-Device-Generation'],
  })
);

// Body and Cookie parsers
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));
app.use(cookieParser());

// Authentication Endpoints (Phase 6 Milestone 1)
app.use('/api/auth', authRoutes);
app.use('/api/v1/auth', authRoutes);

// Health Check Endpoints
app.use('/health', healthRoutes);
app.use('/api/health', healthRoutes);
app.use('/api/v1/health', healthRoutes);

// Chat & AI Reasoning Endpoints
app.use('/api/chat', chatRoutes);
app.use('/api/v1/chat', chatRoutes);

// Persistent User Memory Endpoints (Phase 5)
app.use('/api/memories', memoryRoutes);
app.use('/api/v1/memories', memoryRoutes);

// Persistent Conversation History Endpoints (Phase 5)
app.use('/api/conversations', conversationRoutes);
app.use('/api/v1/conversations', conversationRoutes);

// Device Pairing & Disaster Recovery Endpoints (Milestone 3.3 & 3.4.1)
app.use('/api/pairing', pairingRoutes);
app.use('/api/v1/pairing', pairingRoutes);

// Secure Device Authentication Endpoints (Milestone 3.4.2)
app.use('/api/device', deviceRoutes);
app.use('/api/v1/device', deviceRoutes);

// 404 & Error Handlers
app.use(notFoundHandler);
app.use(errorHandler);

export default app;
