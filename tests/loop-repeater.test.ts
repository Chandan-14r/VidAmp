import { describe, it, expect } from 'vitest';
import { isLoopActive, shouldRewindToPointA, formatLoopLabel } from '../src/video/loop-repeater';

describe('A-B Loop Repeater', () => {
  it('determines when a loop is active', () => {
    expect(isLoopActive({ pointA: null, pointB: null })).toBe(false);
    expect(isLoopActive({ pointA: 5.0, pointB: null })).toBe(false);
    expect(isLoopActive({ pointA: 10.0, pointB: 5.0 })).toBe(false); // A >= B invalid
    expect(isLoopActive({ pointA: 5.0, pointB: 10.0 })).toBe(true);
  });

  it('determines when video should rewind to Point A', () => {
    const loop = { pointA: 10.0, pointB: 20.0 };

    expect(shouldRewindToPointA(15.0, loop)).toBe(false);
    expect(shouldRewindToPointA(19.99, loop)).toBe(false);
    expect(shouldRewindToPointA(20.0, loop)).toBe(true);
    expect(shouldRewindToPointA(21.5, loop)).toBe(true);

    // Inactive loop does not rewind
    expect(shouldRewindToPointA(25.0, { pointA: null, pointB: 20.0 })).toBe(false);
  });

  it('formats loop labels clearly', () => {
    expect(formatLoopLabel({ pointA: null, pointB: null })).toBe('🔁 A-B Loop: Cleared');
    expect(formatLoopLabel({ pointA: 5.5, pointB: null })).toBe('🔁 Point A: 00:05.500');
    expect(formatLoopLabel({ pointA: 5.0, pointB: 15.0 })).toBe('🔁 Loop: 00:05.000 ➔ 00:15.000');
  });
});
