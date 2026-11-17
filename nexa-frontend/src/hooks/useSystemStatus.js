import { useState, useEffect } from 'react';
import { APP_CONFIG } from '../utils/constants';
import { isRecognitionSupported, isSynthesisSupported } from '../services/voice.service';

/**
 * System status hook for monitoring frontend runtime readiness,
 * reporting voice engine and desktop bridge telemetry.
 */
export function useSystemStatus() {
  const [status, setStatus] = useState({
    isInitialized: false,
    environment: APP_CONFIG.ENV,
    version: APP_CONFIG.VERSION,
    modules: {
      router: true,
      styles: true,
      apiServiceReady: true,
      backendConnected: false,
      voiceEngineReady: false,
      desktopBridgeReady: false,
    },
  });

  useEffect(() => {
    // Mark core frontend system architecture initialized with voice check
    const voiceReady = isRecognitionSupported() || isSynthesisSupported();
    setStatus((prev) => ({
      ...prev,
      isInitialized: true,
      modules: {
        ...prev.modules,
        voiceEngineReady: voiceReady,
      },
    }));
  }, []);

  return status;
}

export default useSystemStatus;

