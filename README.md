# NEXA 2.0

> Next-Generation AI-Powered Personal Computer Operator

## Architectural Overview

NEXA 2.0 is designed as an autonomous, multi-interface computer operator capable of voice interaction, intelligent task execution, desktop automation, and browser automation.

The system is architected into three distinct and decoupled subsystems:

```
NEXA-2.0/
├── nexa-frontend/      # React + Vite web user interface & control center
├── nexa-backend/       # Core AI reasoning engine, task orchestrator, & API server (Future Phase)
├── nexa-desktop/       # Native desktop operator & OS automation client (Future Phase)
└── README.md
```

## Subsystems

| Subsystem | Role | Technology Stack | Status |
| :--- | :--- | :--- | :--- |
| **`nexa-frontend`** | Modern operator interface, chat, dashboard, voice telemetry | React, Vite, Tailwind CSS, Lucide React, Framer Motion | **Phase 1: Initialized** |
| **`nexa-backend`** | AI agent orchestration, task planning, tool execution | Python / Node.js backend services | Planned |
| **`nexa-desktop`** | OS-level automation, screen capture, input simulation | Native desktop daemon / automation client | Planned |

## Getting Started with Frontend

See [`nexa-frontend/README.md`](./nexa-frontend/README.md) for full setup instructions, architecture breakdown, and developer guidelines.

