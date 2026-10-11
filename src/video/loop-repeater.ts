import { formatTimeWithMs } from './time-formatter';

export interface LoopRange {
  pointA: number | null;
  pointB: number | null;
}

/**
 * Validates whether the loop segment [A, B] is valid and ready to repeat.
 */
export function isLoopActive(loop: LoopRange): boolean {
  return loop.pointA !== null && loop.pointB !== null && loop.pointA < loop.pointB;
}

/**
 * Checks if the video currentTime has reached or surpassed Point B, requiring rewind to Point A.
 */
export function shouldRewindToPointA(currentTime: number, loop: LoopRange): boolean {
  if (!isLoopActive(loop) || loop.pointA === null || loop.pointB === null) {
    return false;
  }
  return currentTime >= loop.pointB && currentTime >= loop.pointA;
}

/**
 * Returns human-readable status toast string for A-B loop state.
 */
export function formatLoopLabel(loop: LoopRange): string {
  if (loop.pointA === null && loop.pointB === null) {
    return '🔁 A-B Loop: Cleared';
  }
  if (loop.pointA !== null && loop.pointB === null) {
    return `🔁 Point A: ${formatTimeWithMs(loop.pointA)}`;
  }
  if (loop.pointA !== null && loop.pointB !== null) {
    return `🔁 Loop: ${formatTimeWithMs(loop.pointA)} ➔ ${formatTimeWithMs(loop.pointB)}`;
  }
  return '🔁 A-B Loop';
}
