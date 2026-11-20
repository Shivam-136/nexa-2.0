const { app } = require('electron');
const config = require('../src/main/config');

console.log('[NEXA Startup Verification] Electron version:', process.versions.electron);
console.log('[NEXA Startup Verification] Chrome version:', process.versions.chrome);
console.log('[NEXA Startup Verification] Config Title:', config.WINDOW_CONFIG.title);
console.log('[NEXA Startup Verification] Context Isolation Config:', config.SECURITY_CONFIG.contextIsolation);

app.whenReady().then(() => {
  console.log('[NEXA Startup Verification] Electron app.whenReady() resolved successfully!');
  console.log('[NEXA Startup Verification] App path:', app.getAppPath());
  app.quit();
});
