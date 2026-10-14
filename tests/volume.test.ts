import { describe, it, expect } from 'vitest';
import { volumeToSoundStep, soundStepToVolume, formatSoundLabel, MAX_SOUND_STEP } from '../src/audio/volume';

describe('Volume & 0-20 Sound Scale Conversions (600% Boost & 1000% Turbo)', () => {
  it('converts 0 volume to 0 step', () => {
    expect(volumeToSoundStep(0)).toBe(0);
    expect(volumeToSoundStep(-0.5)).toBe(0);
  });

  it('converts 6.0 volume (600%) to 20/20 step', () => {
    expect(volumeToSoundStep(6.0)).toBe(20);
    expect(soundStepToVolume(20)).toBe(6.0);
  });

  it('scales volume smoothly across early steps (1-4) without early saturation', () => {
    expect(soundStepToVolume(1)).toBe(0.015);
    expect(soundStepToVolume(2)).toBe(0.06);
    expect(soundStepToVolume(3)).toBe(0.135);
    expect(soundStepToVolume(4)).toBe(0.24);
    // Every step strictly increases
    expect(soundStepToVolume(1)).toBeLessThan(soundStepToVolume(2));
    expect(soundStepToVolume(2)).toBeLessThan(soundStepToVolume(3));
    expect(soundStepToVolume(3)).toBeLessThan(soundStepToVolume(4));
  });

  it('converts middle volume step 10 to 1.5x (150%)', () => {
    expect(volumeToSoundStep(1.5)).toBe(10);
    expect(soundStepToVolume(10)).toBe(1.5);
    expect(soundStepToVolume(0)).toBe(0);
  });

  it('roundtrips every integer step 0-20 losslessly', () => {
    for (let step = 0; step <= MAX_SOUND_STEP; step++) {
      const vol = soundStepToVolume(step);
      const recoveredStep = volumeToSoundStep(vol);
      expect(recoveredStep).toBe(step);
    }
  });

  it('clamps values within [0, MAX_SOUND_STEP]', () => {
    expect(volumeToSoundStep(10.0)).toBe(MAX_SOUND_STEP);
    expect(soundStepToVolume(25)).toBe(6.0);
    expect(soundStepToVolume(-5)).toBe(0);
  });

  it('formats muted and zero volume labels with mute icon', () => {
    expect(formatSoundLabel(0, true)).toBe('🔇 Sound: 0/20');
    expect(formatSoundLabel(0, false)).toBe('🔇 Sound: 0/20');
    expect(formatSoundLabel(1.5, true)).toBe('🔇 Sound: 0/20');
  });

  it('formats normal volume labels (0-20 scale up to 600%) with step/20', () => {
    expect(formatSoundLabel(6.0)).toBe('🔊 Sound: 20/20');
    expect(formatSoundLabel(soundStepToVolume(18))).toBe('🔊 Sound: 18/20');
    expect(formatSoundLabel(1.5)).toBe('🔊 Sound: 10/20');
    expect(formatSoundLabel(0.24)).toBe('🔊 Sound: 4/20');
  });

  it('formats turbo boost levels above 600% with lightning indicators up to 1000%', () => {
    expect(formatSoundLabel(7.0)).toContain('⚡ Turbo Boost: 700%');
    expect(formatSoundLabel(8.0)).toContain('⚡ Turbo Boost: 800%');
    expect(formatSoundLabel(9.0)).toContain('⚡ Turbo Boost: 900%');
    expect(formatSoundLabel(10.0)).toContain('⚡ Ultra Boost: 1000% (MAX)');
  });
});
