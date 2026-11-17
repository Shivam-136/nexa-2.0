# NEXA 2.0 - Frontend Architecture

> Next-Generation AI-Powered Personal Computer Operator User Interface

This repository contains the standalone frontend client for **NEXA 2.0**, an autonomous AI computer operator designed for voice interaction, desktop automation, and intelligent task execution.

---

## 🛠 Tech Stack

- **Core Library:** [React 18](https://react.dev/) (Functional Components & Hooks)
- **Build Tool:** [Vite 5](https://vitejs.dev/) (Lightning-fast HMR & ESM build)
- **Language:** JavaScript (Strictly standard modern ECMAScript, No TypeScript)
- **Styling:** [Tailwind CSS 3](https://tailwindcss.com/) with PostCSS & Autoprefixer
- **Navigation:** [React Router DOM 6](https://reactrouter.com/)
- **Icons:** [Lucide React](https://lucide.dev/)
- **Animations:** [Framer Motion](https://www.framer.com/motion/)

---

## 📁 Directory Structure

```text
nexa-frontend/
├── public/
│   ├── favicon.svg          # Application vector favicon
│   └── logo.svg             # NEXA 2.0 brand emblem
│
├── src/
│   ├── assets/              # Static media assets
│   │   ├── images/          # Graphic assets & diagrams
│   │   ├── icons/           # Custom brand SVG assets
│   │   └── animations/      # Animation specifications
│   │
│   ├── components/          # Reusable UI components
│   │   ├── common/          # Global UI elements (Navbar, Buttons, Badges)
│   │   ├── layout/          # Layout shells (AppLayout with Router Outlet)
│   │   ├── dashboard/       # Dashboard widgets (Phase 2)
│   │   └── chat/            # Chat & operator conversation feed (Phase 2)
│   │
│   ├── pages/               # Top-level view routes (HomePage, NotFoundPage)
│   ├── hooks/               # Custom lifecycle and connection hooks
│   ├── services/            # Decoupled API and telemetry clients
│   ├── context/             # Global application state providers
│   ├── routes/              # Client-side route declarations (AppRoutes)
│   ├── utils/               # Constants and helper utilities
│   ├── App.jsx              # Root router & provider composition
│   ├── main.jsx             # DOM mounting entry point
│   └── index.css            # Tailwind directives and base layer styles
│
├── .env.example             # Documented environment variable template
├── .gitignore               # Ignored dependencies, build outputs, and credentials
├── index.html               # Single page application HTML shell
├── package.json             # Pinned project dependencies and scripts
├── postcss.config.js        # PostCSS pipeline configuration
├── tailwind.config.js       # Tailwind theme and content scanning
├── vite.config.js           # Vite development and build configuration
└── README.md                # Frontend documentation
```

---

## 🚀 Getting Started

### Prerequisites

- **Node.js:** v18.0.0 or higher (v20+ recommended)
- **npm:** v9.0.0 or higher

### Installation

1. Navigate to the `nexa-frontend` directory:
   ```bash
   cd nexa-frontend
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Create local environment configuration:
   ```bash
   cp .env.example .env
   ```

### Development Server

Start the local Vite development server with Hot Module Replacement (HMR):

```bash
npm run dev
```

The application will be accessible at `http://localhost:3000`.

### Production Build

Create an optimized, minified production build:

```bash
npm run build
```

Preview the production build locally:

```bash
npm run preview
```

---

## ⚙️ Environment Variables

Configure connection endpoints via environment variables. Copy `.env.example` to `.env`:

| Variable | Description | Default |
| :--- | :--- | :--- |
| `VITE_APP_NAME` | Frontend title | `NEXA 2.0` |
| `VITE_APP_VERSION` | Application semantic version | `2.0.0` |
| `VITE_APP_ENV` | Runtime environment mode | `development` |
| `VITE_API_BASE_URL` | Future REST API backend gateway | `http://localhost:8000/api/v1` |
| `VITE_WS_BASE_URL` | Future real-time WebSocket connection | `ws://localhost:8000/ws` |
| `VITE_DESKTOP_BRIDGE_URL` | Native desktop automation daemon bridge | `ws://localhost:9001/desktop` |

> 🔒 **Security Notice:** Never place private API keys, credentials, or tokens in frontend code or environment files. All secret operations must be handled securely through the backend.

---

## 🏛 Architectural Principles

1. **Strict Decoupling:** Business logic and API handling reside in `services/` and `hooks/`, strictly separated from presentation components.
2. **Pure Functional React:** Built entirely with functional components and modern React hooks (`useState`, `useEffect`, `useContext`).
3. **No Premature State:** Components and routes are prepared for real-time WebSocket and API feeds without brittle mock data or fake implementations.
4. **Independent Lifecycle:** Designed to be built, tested, and deployed independently of the upcoming desktop daemon and backend services.

