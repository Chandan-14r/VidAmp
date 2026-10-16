export type GestureIntent = 'speed-horizontal' | 'speed-pinch' | 'volume-modifier' | 'zones-modifier' | 'page-scroll';

export interface WheelGestureInput {
  deltaX: number;
  deltaY: number;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  isOverVideo: boolean;
  trackpadSpeedEnabled: boolean;
  isVideoPlaying?: boolean;
  isEditable?: boolean;
}

/**
 * Classifies a wheel/trackpad event to guarantee:
 * 1. Standard vertical scrolling is NEVER hijacked.
 * 2. Two-finger horizontal swipe is NEVER hijacked, preserving the browser's native Back/Forward page navigation.
 * 3. Gestures never trigger if nothing is playing or if typing in an input/search bar.
 * 4. Two-finger pinch (ctrlKey) provides dedicated, conflict-free speed adjustment.
 */
export function classifyWheelIntent(input: WheelGestureInput): GestureIntent {
  if (
    !input.isOverVideo ||
    !input.trackpadSpeedEnabled ||
    input.isEditable ||
    input.isVideoPlaying === false
  ) {
    return 'page-scroll';
  }

  if (input.shiftKey) {
    return 'volume-modifier';
  }

  if (input.altKey) {
    return 'zones-modifier';
  }

  // Two-Finger Pinch (ctrlKey + trackpad scroll): Dedicated, conflict-free speed gesture!
  if (input.ctrlKey) {
    return 'speed-pinch';
  }

  // Standard horizontal swipe (deltaX) is preserved untouched for native browser back/forward page navigation!
  // Standard vertical scrolling (deltaY) is also preserved untouched for natural page scrolling.
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
