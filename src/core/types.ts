export interface VidAmpPrefs {
  speed: number;
  volume: number;
  muted: boolean;
  seekSeconds: number;
  shortcuts: boolean;
  trackpadSpeedEnabled: boolean;
  gestureReverse: boolean;
  gestureSensitivity: number;
  mouseDragSpeedEnabled: boolean;
  gestureZonesEnabled: boolean;
  volumeBoostEnabled: boolean;
  loudBoostActive: boolean;
  audioPreset: AudioPresetKey;
  monoAudioActive: boolean;
  ambientGlowEnabled: boolean;
  screenshotFormat: 'png' | 'jpeg' | 'webp';
  sideTabEnabled: boolean;
  showToolbar: boolean;
  smartMiniplayerEnabled: boolean;
  autoTheater: boolean;
  pinned: boolean;
  manualPos: boolean;
  pos: { left: number; top: number } | null;
}

export type AudioPresetKey = 'normal' | 'bass' | 'vocal' | 'treble' | 'podcast' | 'cinema';

export interface VideoBookmark {
  id: number;
  time: number;
  label: string;
}

export interface LoopABState {
  pointA: number | null;
  pointB: number | null;
  active: boolean;
}
