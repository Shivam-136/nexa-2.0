# NEXA 2.0 - Windows Desktop Agent (Milestone 3.1)

> Foundational Electron Desktop Agent for NEXA 2.0 with Windows System Tray integration, Single Instance Lock, Hardened Security, and Validated IPC Architecture.

---

## 🏛 Overview

`nexa-desktop` is the native Windows desktop agent container for **NEXA 2.0**. It operates as a persistent desktop daemon capable of running minimized in the Windows System Tray, handling validated inter-process communication (IPC), and providing an isolated, hardened desktop runtime matching the NEXA 2.0 dark glassmorphic design language.

---

## 🔒 Security Architecture & Guardrails

The desktop agent strictly enforces the following security standards:

1. **Context Isolation (`contextIsolation: true`)**:
   - The renderer execution context is strictly segregated from the preload and main process contexts.
   - Prevents prototype pollution and renderer privilege escalation.

2. **Node Integration Disabled (`nodeIntegration: false`)**:
   - Renderer processes have no direct access to `require()`, `process`, `Buffer`, or filesystem APIs.
   - `nodeIntegrationInWorker` and `nodeIntegrationInSubFrames` are disabled.

3. **Chromium Process Sandbox (`sandbox: true`)**:
   - Native Chromium operating-system level sandbox limits the capabilities of the renderer process.

4. **Encapsulated Preload (`contextBridge`)**:
   - **Never exposes raw `ipcRenderer`**.
   - Exposes strictly defined, frozen helper functions via `window.nexaDesktop`.
   - Internal Electron event arguments (`IpcRendererEvent`) are stripped and never leaked to renderer callbacks.

5. **Validated IPC Handlers**:
   - All IPC channels are strictly whitelisted.
   - Message payloads undergo rigorous validation (string length capping at 1024 chars, control character sanitization, type validation).
   - Arbitrary shell execution (`child_process`, `exec`, `spawn`) is strictly prohibited.

6. **Content Security Policy (CSP)**:
   - Renderer HTML includes strict CSP:
     ```html
     <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self';">
     ```
   - Navigation away from local file origins is blocked (`will-navigate` guardrail).
   - External links open exclusively in the default system browser via `shell.openExternal`.

---

## 📁 Directory Structure

```text
nexa-desktop/
├── assets/
│   ├── icon.png                 # Application window icon (32x32 RGBA)
│   └── tray-icon.png            # Windows System Tray icon (16x16 RGBA)
├── scripts/
│   ├── generate-icons.js        # Standalone vector icon generator
│   └── verify-startup.js        # Startup verification script
├── src/
│   ├── main/
│   │   ├── config.js            # Configuration constants, geometry, and security settings
│   │   ├── index.js             # Electron main process entry point
│   │   ├── ipc.js               # Main process IPC registration & strict input validation
│   │   ├── lifecycle.js         # Application lifecycle & graceful shutdown manager
│   │   ├── singleInstance.js    # Single Instance Lock enforcement & second-instance restoration
│   │   ├── tray.js              # Windows System Tray integration & context menu
│   │   └── window.js            # Hardened BrowserWindow creation & navigation guardrails
│   ├── preload/
│   │   ├── channels.js          # Whitelisted channels & payload validators
│   │   └── index.js             # Secure contextBridge preload script (exposes window.nexaDesktop)
│   ├── renderer/
│   │   ├── app.js               # Renderer UI logic (communicates strictly via window.nexaDesktop)
│   │   ├── index.html           # Desktop window HTML shell with strict CSP
│   │   └── styles.css           # NEXA 2.0 dark glassmorphic styling
│   └── __tests__/
│       ├── ipc.test.js          # IPC whitelisting, sanitization, and execution tests
│       ├── lifecycle.test.js    # Minimize-to-tray & graceful shutdown tests
│       ├── preload.test.js      # Preload API encapsulation & subscriber tests
│       ├── security.test.js     # Context isolation, node integration, and CSP tests
│       ├── singleInstance.test.js # Single-instance lock and secondary rejection tests
│       ├── startup.test.js      # Startup, asset integrity, and binary tests
│       └── tray.test.js         # Tray creation, actions, toggling, and cleanup tests
├── package.json
└── README.md
```

---

## ⚡ Core Features

### 1. Windows System Tray Integration
- Resides persistently in the Windows notification tray with tooltip `"NEXA 2.0 Desktop Agent"`.
- Context menu options:
  - **Open NEXA 2.0**: Restores and focuses the main window.
  - **Status: Active (Online)**: Read-only live agent status indicator.
  - **Minimize to Tray**: Hides the window to the tray.
  - **Quit NEXA 2.0**: Commences graceful application shutdown.
- Left-click toggles visibility; double-click opens and brings window to foreground.

### 2. Single Instance Lock
- Uses `app.requestSingleInstanceLock()`.
- If a secondary instance is launched, it immediately terminates with `app.quit()`.
- The primary instance intercepts the `second-instance` event, restores from minimized state if necessary, un-hides the window, and focuses it.

### 3. Minimize-to-Tray Behavior
- Clicking the window close button (`X`) or triggering close via IPC does not terminate the process.
- The `close` event is intercepted (`event.preventDefault()`) and the window is cleanly hidden.
- The agent continues running as a background daemon.

### 4. Graceful Application Shutdown
- Orderly teardown sequence:
  1. Sets `isQuitting = true` to allow window close events to proceed.
  2. Destroys the Windows System Tray icon via `tray.destroy()`.
  3. Unregisters all registered IPC handlers.
  4. Closes and destroys active BrowserWindow instances.
  5. Invokes `app.quit()`.

### 5. Whitelisted IPC API (`window.nexaDesktop`)
| Method | Channel | Description |
| :--- | :--- | :--- |
| `ping(message)` | `nexa:ping` | Validates message and tests roundtrip communication |
| `getAppInfo()` | `nexa:get-app-info` | Returns runtime metadata (versions, platform, arch) |
| `getSystemStatus()` | `nexa:get-system-status` | Returns system telemetry and security status |
| `minimize()` | `nexa:window-minimize` | Minimizes desktop window |
| `maximize()` | `nexa:window-maximize` | Toggles maximize / restore |
| `close()` | `nexa:window-close` | Closes window (hides to tray) |
| `isMaximized()` | `nexa:window-is-maximized` | Queries maximized state |
| `quitApp()` | `nexa:app-quit` | Requests graceful application shutdown |
| `onTrayEvent(fn)` | `nexa:tray-event` | Subscribes to tray actions; returns cleanup unsubscribe |
| `onStatusChange(fn)` | `nexa:status-changed` | Subscribes to daemon status updates |
| `onWindowStateChange(fn)` | `nexa:window-state-changed` | Subscribes to window maximize/restore events |

---

## 🧪 Testing

Run all unit and integration tests:

```bash
npm test
```

Run specific test suites:

```bash
node --test src/__tests__/security.test.js
node --test src/__tests__/ipc.test.js
node --test src/__tests__/singleInstance.test.js
node --test src/__tests__/tray.test.js
node --test src/__tests__/lifecycle.test.js
node --test src/__tests__/startup.test.js
```

---

## 🚀 Running the Desktop Agent

Start the Electron agent in standard mode:

```bash
npm start
```

Start the Electron agent in development mode:

```bash
npm run dev
```
