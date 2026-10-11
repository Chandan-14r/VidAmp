export type GestureIntent = 'speed-horizontal' | 'speed-pinch' | 'volume-modifier' | 'zones-modifier' | 'page-scroll';

export interface WheelGestureInput {
  deltaX: number;
  deltaY: number;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  isOverVideo: boolean;
  trackpadSpeedEnabled: boolean;
}

/**
 * Classifies a wheel/trackpad event to guarantee standard vertical scrolling
 * is NEVER intercepted or hijacked by speed controls.
 */
export function classifyWheelIntent(input: WheelGestureInput): GestureIntent {
  if (!input.isOverVideo || !input.trackpadSpeedEnabled) {
    return 'page-scroll';
  }

  if (input.shiftKey) {
    return 'volume-modifier';
  }

  if (input.altKey) {
    return 'zones-modifier';
  }

  // Two-Finger Pinch (ctrlKey + trackpad scroll)
  if (input.ctrlKey) {
    return 'speed-pinch';
  }

  // Two-finger horizontal swipe over video
  const absX = Math.abs(input.deltaX);
  const absY = Math.abs(input.deltaY);

  if (absX > absY + 4 && absX > 4) {
    return 'speed-horizontal';
  }

  // Any vertical movement (deltaY >= deltaX) is left 100% untouched for natural page scrolling
  return 'page-scroll';
}

/**
 * Calculates step count from accumulated travel distance based on sensitivity setting.
 */
export function calculateGestureStep(
  accumulatedDelta: number,
  sensitivity: number,
  isDiscrete = false
): { steps: number; remainingDelta: number } {
  if (isDiscrete) {
    return { steps: Math.sign(accumulatedDelta), remainingDelta: 0 };
  }

  // Frictionless threshold scaled with sensitivity (default 55 * 0.25 ≈ 14px)
  const stepPx = Math.max(8, Math.min(28, Math.round(sensitivity * 0.25)));
  const absDelta = Math.abs(accumulatedDelta);

  if (absDelta < stepPx) {
    return { steps: 0, remainingDelta: accumulatedDelta };
  }

  const dir = Math.sign(accumulatedDelta);
  const count = Math.min(4, Math.floor(absDelta / stepPx));
  const steps = dir * count;
  const remainingDelta = accumulatedDelta - steps * stepPx;

  return { steps, remainingDelta };
}
