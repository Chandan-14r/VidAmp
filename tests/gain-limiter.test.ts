import { describe, it, expect } from 'vitest';
import { clampBoostGain, calculateLimiterThreshold, BRICKWALL_LIMITER_CONFIG, MAX_BOOST_GAIN, MIN_BOOST_GAIN } from '../src/audio/gain-limiter';

describe('Gain Limiter & Compressor Settings', () => {
  it('clamps gain values to valid range [1.0, 6.0]', () => {
    expect(clampBoostGain(0.5)).toBe(MIN_BOOST_GAIN);
    expect(clampBoostGain(2.0)).toBe(2.0);
    expect(clampBoostGain(6.0)).toBe(MAX_BOOST_GAIN);
    expect(clampBoostGain(10.0)).toBe(MAX_BOOST_GAIN);
    expect(clampBoostGain(NaN)).toBe(MIN_BOOST_GAIN);
  });

  it('engages brickwall limiter threshold (-1.5 dBFS) for ultra boost >= 5.0x', () => {
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
});
