import { describe, it, expect } from 'vitest';
import { validSpeed, formatSpeed, stepUpToGrid, stepDownToGrid, MIN_SPEED, MAX_SPEED } from '../src/video/speed-grid';

describe('Speed Grid & Validation Logic', () => {
  it('validates playback speeds correctly within bounds', () => {
    expect(validSpeed(1.0)).toBe(true);
    expect(validSpeed(0.25)).toBe(true);
    expect(validSpeed(16.0)).toBe(true);
    expect(validSpeed(0.1)).toBe(false); // below MIN_SPEED
    expect(validSpeed(20.0)).toBe(false); // above MAX_SPEED
    expect(validSpeed('1.0')).toBe(false);
    expect(validSpeed(null)).toBe(false);
    expect(validSpeed(NaN)).toBe(false);
  });

  it('formats speed labels with × multiplier', () => {
    expect(formatSpeed(1)).toBe('1.0×');
    expect(formatSpeed(1.5)).toBe('1.5×');
    expect(formatSpeed(2)).toBe('2.0×');
    expect(formatSpeed(1.25)).toBe('1.25×');
  });

  it('steps up cleanly to the next grid interval', () => {
    expect(stepUpToGrid(1.0, 0.25)).toBe(1.25);
    expect(stepUpToGrid(1.25, 0.25)).toBe(1.5);
    expect(stepUpToGrid(1.1, 0.25)).toBe(1.25);
  });

  it('steps down cleanly to the previous grid interval', () => {
    expect(stepDownToGrid(1.0, 0.25)).toBe(0.75);
    expect(stepDownToGrid(0.75, 0.25)).toBe(0.5);
    expect(stepDownToGrid(1.2, 0.25)).toBe(1.0);
  });

  it('respects min and max speed clamping boundaries', () => {
    expect(stepDownToGrid(0.25, 0.25)).toBe(MIN_SPEED);
    expect(stepUpToGrid(16.0, 0.25)).toBe(MAX_SPEED);
  });
});
