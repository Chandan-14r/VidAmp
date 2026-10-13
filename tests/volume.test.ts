import { describe, it, expect } from 'vitest';
import { volumeToSoundStep, soundStepToVolume, formatSoundLabel, MAX_SOUND_STEP } from '../src/audio/volume';

describe('Volume & 0-20 Sound Scale Conversions (Perceptual Curve)', () => {
  it('converts 0 volume to 0 step', () => {
    expect(volumeToSoundStep(0)).toBe(0);
    expect(volumeToSoundStep(-0.5)).toBe(0);
  });

  it('converts 1.0 volume (100%) to 20/20 step', () => {
    expect(volumeToSoundStep(1.0)).toBe(20);
    expect(soundStepToVolume(20)).toBe(1.0);
  });

  it('scales volume smoothly across early steps (1-4) without early saturation', () => {
    expect(soundStepToVolume(1)).toBe(0.0025);
    expect(soundStepToVolume(2)).toBe(0.01);
    expect(soundStepToVolume(3)).toBe(0.0225);
    expect(soundStepToVolume(4)).toBe(0.04);
    // Every step strictly increases
    expect(soundStepToVolume(1)).toBeLessThan(soundStepToVolume(2));
    expect(soundStepToVolume(2)).toBeLessThan(soundStepToVolume(3));
    expect(soundStepToVolume(3)).toBeLessThan(soundStepToVolume(4));
  });

  it('converts middle volume steps accurately to perceived half volume (0.25)', () => {
    expect(volumeToSoundStep(0.25)).toBe(10);
    expect(soundStepToVolume(10)).toBe(0.25);
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
    expect(volumeToSoundStep(1.5)).toBe(MAX_SOUND_STEP);
    expect(soundStepToVolume(25)).toBe(1.0);
    expect(soundStepToVolume(-5)).toBe(0);
  });

  it('formats muted and zero volume labels with mute icon', () => {
    expect(formatSoundLabel(0, true)).toBe('🔇 Sound: 0/20');
    expect(formatSoundLabel(0, false)).toBe('🔇 Sound: 0/20');
    expect(formatSoundLabel(0.25, true)).toBe('🔇 Sound: 0/20');
  });

  it('formats normal volume labels with step/20', () => {
    expect(formatSoundLabel(1.0)).toBe('🔊 Sound: 20/20');
    expect(formatSoundLabel(0.25)).toBe('🔊 Sound: 10/20');
    expect(formatSoundLabel(0.04)).toBe('🔊 Sound: 4/20');
  });

  it('formats boost levels above 1.0 with appropriate indicators', () => {
    expect(formatSoundLabel(1.5)).toContain('🚀 Loud Boost: 150%');
    expect(formatSoundLabel(2.0)).toContain('🚀 Loud Boost: 200%');
    expect(formatSoundLabel(3.0)).toContain('🔥 Super Boost: 300%');
    expect(formatSoundLabel(6.0)).toContain('⚡ Ultra Boost: 600% (MAX)');
  });
});
