import type { VidAmpPrefs } from './types';

export const STORAGE_PREFIX = 'vidamp_';
export const LEGACY_STORAGE_PREFIX = 'mvc_';

export const MIN_SPEED = 0.07;
export const MAX_SPEED = 16.0;
export const SPEED_INCREMENT = 0.1;
export const DEFAULT_GESTURE_SENSITIVITY = 55;

export const DEFAULT_PREFS: VidAmpPrefs = {
  speed: 1.0,
  volume: 1.0,
  muted: false,
  seekSeconds: 10,
  shortcuts: true,
  trackpadSpeedEnabled: true,
  gestureReverse: false,
  gestureSensitivity: DEFAULT_GESTURE_SENSITIVITY,
  mouseDragSpeedEnabled: true,
  gestureZonesEnabled: false,
  volumeBoostEnabled: true,
  loudBoostActive: false,
  audioPreset: 'normal',
  monoAudioActive: false,
  ambientGlowEnabled: false,
  screenshotFormat: 'png',
  sideTabEnabled: false,
  showToolbar: false,
  smartMiniplayerEnabled: false,
  autoTheater: false,
  pinned: false,
  manualPos: false,
  pos: null,
};
