# NEXA 2.0 — AI Brain Backend Service

Backend service for NEXA 2.0 powered by Express.js and the official Google Gen AI SDK (`@google/genai`).

## Features
- **Official Google Gen AI SDK**: Uses `@google/genai` to communicate with Google Gemini models.
- **Configurable Models**: Switch easily between `gemini-2.5-flash`, `gemini-1.5-flash`, `gemini-2.5-pro` etc. via `GEMINI_MODEL`.
- **Multi-Turn Context**: Maintains conversation flow and context across turns.
- **Multilingual Support**: Tailored to respond naturally in English, Hindi, and Hinglish based on user input.
- **Enterprise-Grade Middleware**: Equipped with Helmet security headers, CORS for frontend dev servers, and express-rate-limit protection.
- **Secure Key Management**: Secrets (`GEMINI_API_KEY`) stay strictly on the backend and are never exposed to clients.

## API Endpoints

### 1. Health Check
- `GET /api/health`
- Returns server uptime, status, and Gemini configuration state.

### 2. Chat Completion
- `POST /api/chat`
- Request body:
```json
{
  "message": "What is JavaScript?",
  "conversationHistory": [
    { "role": "user", "text": "Hello" },
    { "role": "assistant", "text": "Hello Operator! How can I assist you today?" }
  ],
  "conversationId": "optional-id"
}
```
- Response:
```json
{
  "success": true,
  "reply": "JavaScript is a versatile programming language...",
  "conversationId": "conv_1731828...",
  "model": "gemini-2.5-flash",
  "timestamp": "2026-11-17T..."
}
```

### 3. Model Status
- `GET /api/chat/status`
- Returns readiness and active model name.

## Setup & Running

```bash
# 1. Install dependencies
npm install

# 2. Configure environment
cp .env.example .env
# Edit .env with your actual GEMINI_API_KEY

# 3. Start development server
npm run dev

# 4. Start production server
npm start
```
