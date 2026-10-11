export interface AudioPreset {
  id: string;
  name: string;
  icon: string;
  bassGain: number;
  vocalGain: number;
  trebleGain: number;
  compThreshold: number;
  compRatio: number;
  compKnee: number;
}

export const AUDIO_PRESETS: Record<string, AudioPreset> = {
  normal: {
    id: 'normal',
    name: 'Normal (Flat)',
    icon: '🎵',
    bassGain: 0,
    vocalGain: 0,
    trebleGain: 0,
    compThreshold: -8,
    compRatio: 12,
    compKnee: 10,
  },
  vocal: {
    id: 'vocal',
    name: 'Vocal Clarity',
    icon: '🎙️',
    bassGain: -2.5,
    vocalGain: 7.0,
    trebleGain: 2.0,
    compThreshold: -12,
    compRatio: 10,
    compKnee: 12,
  },
  bass: {
    id: 'bass',
    name: 'Bass Boost Max',
    icon: '💥',
    bassGain: 8.5,
    vocalGain: -1.0,
    trebleGain: 1.0,
    compThreshold: -8,
    compRatio: 12,
    compKnee: 14,
  },
  treble: {
    id: 'treble',
    name: 'Treble Booster',
    icon: '✨',
    bassGain: -2.0,
    vocalGain: 1.0,
    trebleGain: 8.0,
    compThreshold: -8,
    compRatio: 8,
    compKnee: 10,
  },
  podcast: {
    id: 'podcast',
    name: 'Podcast Speech',
    icon: '🎙️',
    bassGain: -4.0,
    vocalGain: 7.5,
    trebleGain: 2.0,
    compThreshold: -14,
    compRatio: 12,
    compKnee: 12,
  },
  music: {
    id: 'music',
    name: 'Music Master',
    icon: '🎧',
    bassGain: 4.5,
    vocalGain: 1.0,
    trebleGain: 4.0,
    compThreshold: -6,
    compRatio: 6,
    compKnee: 10,
  },
  night: {
    id: 'night',
    name: 'Night Mode (Volume Leveler)',
    icon: '🌙',
    bassGain: -3.0,
    vocalGain: 5.0,
    trebleGain: -1.5,
    compThreshold: -26,
    compRatio: 16,
    compKnee: 25,
  },
  cinema: {
    id: 'cinema',
    name: 'Cinema Surround',
    icon: '🎬',
    bassGain: 6.0,
    vocalGain: 3.0,
    trebleGain: 5.0,
    compThreshold: -10,
    compRatio: 10,
    compKnee: 14,
  },
};

export const PRESET_KEYS = Object.keys(AUDIO_PRESETS);

export function getAudioPreset(key: string): AudioPreset {
  return AUDIO_PRESETS[key] ?? AUDIO_PRESETS.normal;
}

export function getNextAudioPreset(currentKey: string): AudioPreset {
  const currentIndex = PRESET_KEYS.indexOf(currentKey);
  const nextIndex = (currentIndex + 1) % PRESET_KEYS.length;
  const nextKey = PRESET_KEYS[nextIndex];
  return AUDIO_PRESETS[nextKey];
}
