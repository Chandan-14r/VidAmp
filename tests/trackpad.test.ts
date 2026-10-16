import { describe, it, expect } from 'vitest';
import { classifyWheelIntent, calculateGestureStep } from '../src/gestures/trackpad';

describe('Trackpad Gesture Intent Classification', () => {
  const baseInput = {
    deltaX: 0,
    deltaY: 0,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    isOverVideo: true,
    trackpadSpeedEnabled: true,
  };

  it('preserves vertical scrolling completely untouched (page-scroll)', () => {
    // Two-finger vertical scroll down
    const verticalDown = { ...baseInput, deltaX: 0, deltaY: 25 };
    expect(classifyWheelIntent(verticalDown)).toBe('page-scroll');

    // Two-finger vertical scroll up
    const verticalUp = { ...baseInput, deltaX: 0, deltaY: -30 };
    expect(classifyWheelIntent(verticalUp)).toBe('page-scroll');

    // Diagonal scroll with more vertical than horizontal
    const diagonalVertical = { ...baseInput, deltaX: 5, deltaY: 20 };
    expect(classifyWheelIntent(diagonalVertical)).toBe('page-scroll');
  });

  it('preserves two-finger horizontal swipe untouched for native back/forward page navigation', () => {
    // Pure horizontal swipe right (standard forward navigation gesture)
    const horizontalRight = { ...baseInput, deltaX: 18, deltaY: 0 };
    expect(classifyWheelIntent(horizontalRight)).toBe('page-scroll');

    // Pure horizontal swipe left (standard back navigation gesture)
    const horizontalLeft = { ...baseInput, deltaX: -22, deltaY: 2 };
    expect(classifyWheelIntent(horizontalLeft)).toBe('page-scroll');
  });

  it('guarantees gestures never trigger when nothing is playing or when in editable fields', () => {
    const idleVideo = { ...baseInput, ctrlKey: true, isVideoPlaying: false };
    expect(classifyWheelIntent(idleVideo)).toBe('page-scroll');

    const searchField = { ...baseInput, ctrlKey: true, isEditable: true };
    expect(classifyWheelIntent(searchField)).toBe('page-scroll');
  });

  it('detects pinch-to-zoom (ctrlKey) as speed pinch', () => {
    const pinch = { ...baseInput, deltaX: 0, deltaY: 12, ctrlKey: true };
    expect(classifyWheelIntent(pinch)).toBe('speed-pinch');
  });

  it('detects Shift + Wheel as volume modifier', () => {
    const shiftWheel = { ...baseInput, deltaX: 0, deltaY: 10, shiftKey: true };
    expect(classifyWheelIntent(shiftWheel)).toBe('volume-modifier');
  });

  it('detects Alt + Wheel as zones modifier', () => {
    const altWheel = { ...baseInput, deltaX: 0, deltaY: 10, altKey: true };
    expect(classifyWheelIntent(altWheel)).toBe('zones-modifier');
  });

  it('returns page-scroll when not hovering over video or disabled', () => {
    expect(classifyWheelIntent({ ...baseInput, isOverVideo: false, deltaX: 50 })).toBe('page-scroll');
    expect(classifyWheelIntent({ ...baseInput, trackpadSpeedEnabled: false, deltaX: 50 })).toBe('page-scroll');
  });
});

describe('Gesture Step Calculations', () => {
  it('calculates discrete notch steps directly', () => {
    expect(calculateGestureStep(100, 55, true)).toEqual({ steps: 1, remainingDelta: 0 });
    expect(calculateGestureStep(-100, 55, true)).toEqual({ steps: -1, remainingDelta: 0 });
  });

  it('accumulates continuous delta smoothly based on sensitivity threshold', () => {
    // With sensitivity 55, stepPx = 14
    // 10px delta: not enough for a step yet
    expect(calculateGestureStep(10, 55, false)).toEqual({ steps: 0, remainingDelta: 10 });

    // 16px delta: triggers 1 step (14px consumed, 2px remainder preserved)
    expect(calculateGestureStep(16, 55, false)).toEqual({ steps: 1, remainingDelta: 2 });

    // 30px delta: triggers 2 steps (28px consumed, 2px remainder preserved)
    expect(calculateGestureStep(30, 55, false)).toEqual({ steps: 2, remainingDelta: 2 });
  });
});
