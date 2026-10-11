let debugMode = false;

export function setDebugMode(enabled: boolean): void {
  debugMode = enabled;
}

export function dbg(...args: unknown[]): void {
  if (debugMode) {
    console.log('[VidAmp]', ...args);
  }
}

export function logWarn(...args: unknown[]): void {
  console.warn('[VidAmp]', ...args);
}

export function logError(...args: unknown[]): void {
  console.error('[VidAmp]', ...args);
}
