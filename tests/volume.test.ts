import { describe, it, expect } from 'vitest';
import { volumeToSoundStep, soundStepToVolume, formatSoundLabel, MAX_SOUND_STEP } from '../src/audio/volume';

describe('Volume & 0-20 Sound Scale Conversions', () => {
  it('converts 0 volume to 0 step', () => {
    expect(volumeToSoundStep(0)).toBe(0);
    expect(volumeToSoundStep(-0.5)).toBe(0);
  });

  it('converts 1.0 volume (100%) to 20/20 step', () => {
    expect(volumeToSoundStep(1.0)).toBe(20);
    expect(soundStepToVolume(20)).toBe(1.0);
  });

  it('converts middle volume steps accurately', () => {
    expect(volumeToSoundStep(0.5)).toBe(10);
    expect(soundStepToVolume(10)).toBe(0.5);
    expect(soundStepToVolume(1)).toBe(0.05); // 1/20 = 5%
    expect(soundStepToVolume(0)).toBe(0);
  });

  it('clamps values within [0, MAX_SOUND_STEP]', () => {
    expect(volumeToSoundStep(1.5)).toBe(MAX_SOUND_STEP);
    expect(soundStepToVolume(25)).toBe(1.0);
    expect(soundStepToVolume(-5)).toBe(0);
  });

  it('formats muted and zero volume labels with mute icon', () => {
    expect(formatSoundLabel(0, true)).toBe('🔇 Sound: 0/20');
    expect(formatSoundLabel(0, false)).toBe('🔇 Sound: 0/20');
    expect(formatSoundLabel(0.5, true)).toBe('🔇 Sound: 0/20');
  });

  it('formats normal volume labels with step/20', () => {
    expect(formatSoundLabel(1.0)).toBe('🔊 Sound: 20/20');
    expect(formatSoundLabel(0.5)).toBe('🔊 Sound: 10/20');
  });

  it('formats boost levels above 1.0 with appropriate indicators', () => {
    expect(formatSoundLabel(1.5)).toContain('🚀 Loud Boost: 150%');
    expect(formatSoundLabel(2.0)).toContain('🚀 Loud Boost: 200%');
    expect(formatSoundLabel(3.0)).toContain('🔥 Super Boost: 300%');
    expect(formatSoundLabel(6.0)).toContain('⚡ Ultra Boost: 600% (MAX)');
  });
});
