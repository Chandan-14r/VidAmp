import { describe, it, expect } from 'vitest';
import {
  clampBoostGain,
  calculateLimiterThreshold,
  calculateSubsonicCutoff,
  calculateTurboMakeupGain,
  calculateTurboThreshold,
  BRICKWALL_LIMITER_CONFIG,
  SUBSONIC_PROTECTION_CONFIG,
  MAX_BOOST_GAIN,
  MIN_BOOST_GAIN,
} from '../src/audio/gain-limiter';

describe('Gain Limiter & Compressor Settings', () => {
  it('clamps gain values to valid range [1.0, 10.0]', () => {
    expect(clampBoostGain(0.5)).toBe(MIN_BOOST_GAIN);
    expect(clampBoostGain(2.0)).toBe(2.0);
    expect(clampBoostGain(6.0)).toBe(6.0);
    expect(clampBoostGain(10.0)).toBe(MAX_BOOST_GAIN);
    expect(clampBoostGain(15.0)).toBe(MAX_BOOST_GAIN);
    expect(clampBoostGain(NaN)).toBe(MIN_BOOST_GAIN);
  });

  it('engages brickwall limiter threshold (-2.0 dBFS safe ceiling) for ultra boost 5.0x - 6.0x', () => {
    expect(calculateLimiterThreshold(5.0)).toBe(BRICKWALL_LIMITER_CONFIG.threshold);
    expect(calculateLimiterThreshold(6.0)).toBe(BRICKWALL_LIMITER_CONFIG.threshold);
  });

  it('uses moderate threshold for super boost >= 2.5x', () => {
    expect(calculateLimiterThreshold(3.0, -8)).toBe(-8);
    expect(calculateLimiterThreshold(2.5, -2)).toBe(-4.0);
  });

  it('keeps base threshold for normal boost < 2.5x', () => {
    expect(calculateLimiterThreshold(1.5, -8)).toBe(-8);
  });

  it('calculates adaptive subsonic high-pass cutoff to protect small speaker cones', () => {
    expect(calculateSubsonicCutoff(0)).toBe(SUBSONIC_PROTECTION_CONFIG.minCutoffHz);
    expect(calculateSubsonicCutoff(1.0)).toBe(20);
    expect(calculateSubsonicCutoff(6.0)).toBe(53);
    expect(calculateSubsonicCutoff(10.0)).toBe(80);
    expect(calculateSubsonicCutoff(15.0)).toBe(80);
  });

  it('progressively scales turbo makeup gain across 700%, 800%, 900%, 1000% so each level is distinctly louder', () => {
    const g700 = calculateTurboMakeupGain(7.0);
    const g800 = calculateTurboMakeupGain(8.0);
    const g900 = calculateTurboMakeupGain(9.0);
    const g1000 = calculateTurboMakeupGain(10.0);

    expect(calculateTurboMakeupGain(1.0)).toBe(1.0);
    expect(calculateTurboMakeupGain(6.0)).toBe(1.0);
    expect(g700).toBeGreaterThan(1.0);
    expect(g800).toBeGreaterThan(g700);
    expect(g900).toBeGreaterThan(g800);
    expect(g1000).toBeGreaterThan(g900);
  });

  it('progressively lifts limiter threshold across 700%, 800%, 900%, 1000% to provide audible headroom', () => {
    expect(calculateLimiterThreshold(7.0)).toBe(-4.0);
    expect(calculateLimiterThreshold(8.0)).toBe(-3.2);
    expect(calculateLimiterThreshold(9.0)).toBe(-2.4);
    expect(calculateLimiterThreshold(10.0)).toBe(-1.5);
  });
});
