import { describe, it, expect } from 'vitest';
import { AUDIO_PRESETS, getAudioPreset, getNextAudioPreset, PRESET_KEYS } from '../src/audio/eq-presets';

describe('Studio EQ Presets', () => {
  it('defines all 8 core presets with required acoustic properties', () => {
    expect(PRESET_KEYS).toEqual(['normal', 'vocal', 'bass', 'treble', 'podcast', 'music', 'night', 'cinema']);

    for (const key of PRESET_KEYS) {
      const preset = AUDIO_PRESETS[key];
      expect(preset.id).toBe(key);
      expect(preset.name).toBeTypeOf('string');
      expect(preset.icon).toBeTypeOf('string');
      expect(preset.bassGain).toBeTypeOf('number');
      expect(preset.vocalGain).toBeTypeOf('number');
      expect(preset.trebleGain).toBeTypeOf('number');
      expect(preset.compThreshold).toBeLessThanOrEqual(0);
      expect(preset.compRatio).toBeGreaterThanOrEqual(1);
    }
  });

  it('provides flat response for normal preset', () => {
    const normal = AUDIO_PRESETS.normal;
    expect(normal.bassGain).toBe(0);
    expect(normal.vocalGain).toBe(0);
    expect(normal.trebleGain).toBe(0);
  });

  it('boosts low frequencies for bass preset', () => {
    const bass = AUDIO_PRESETS.bass;
    expect(bass.bassGain).toBeGreaterThan(5);
  });

  it('boosts vocal frequencies for podcast and vocal clarity', () => {
    expect(AUDIO_PRESETS.vocal.vocalGain).toBeGreaterThan(5);
    expect(AUDIO_PRESETS.podcast.vocalGain).toBeGreaterThan(5);
  });

  it('cycles presets in expected circular order', () => {
    expect(getNextAudioPreset('normal').id).toBe('vocal');
    expect(getNextAudioPreset('vocal').id).toBe('bass');
    expect(getNextAudioPreset('cinema').id).toBe('normal'); // wraps around
  });

  it('falls back to normal preset for unknown key', () => {
    expect(getAudioPreset('unknown_key').id).toBe('normal');
  });
});
