import { describe, it, expect } from 'vitest';
import { formatTime, formatTimeWithMs, formatRemainingTime } from '../src/video/time-formatter';

describe('Time Formatter', () => {
  it('formats normal durations in M:SS', () => {
    expect(formatTime(0)).toBe('0:00');
    expect(formatTime(65)).toBe('1:05');
    expect(formatTime(599)).toBe('9:59');
    expect(formatTime(3599)).toBe('59:59');
  });

  it('formats hour-long durations in H:MM:SS', () => {
    expect(formatTime(3600)).toBe('1:00:00');
    expect(formatTime(3665)).toBe('1:01:05');
  });

  it('handles invalid time safely', () => {
    expect(formatTime(NaN)).toBe('--:--');
    expect(formatTime(Infinity)).toBe('--:--');
  });

  it('formats precise time with milliseconds', () => {
    expect(formatTimeWithMs(12.345)).toBe('00:12.345');
    expect(formatTimeWithMs(65.05)).toBe('01:05.050');
  });

  it('formats remaining countdown correctly', () => {
    expect(formatRemainingTime(10, 60)).toBe('-0:50');
    expect(formatRemainingTime(60, 60)).toBe('-0:00');
  });
});
