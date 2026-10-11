export const MIN_SPEED = 0.25;
export const MAX_SPEED = 16.0;
export const SPEED_STEP = 0.25;

export function validSpeed(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n) && n >= MIN_SPEED && n <= MAX_SPEED;
}

export function formatSpeed(n: unknown): string {
  const num = Number(n);
  if (!Number.isFinite(num)) return '1.0×';
  const rounded = Math.round(num * 100) / 100;
  const str = rounded % 1 === 0 ? rounded.toFixed(1) : rounded.toString();
  return `${str}×`;
}

export function stepDownToGrid(rate: number, step = SPEED_STEP): number {
  const cur = Number(rate) || 1.0;
  const epsilon = 1e-4;
  const snapped = Math.floor((cur - epsilon) / step) * step;
  return Number(Math.max(MIN_SPEED, Math.round(snapped * 100) / 100).toFixed(2));
}

export function stepUpToGrid(rate: number, step = SPEED_STEP): number {
  const cur = Number(rate) || 1.0;
  const epsilon = 1e-4;
  const snapped = Math.ceil((cur + epsilon) / step) * step;
  return Number(Math.min(MAX_SPEED, Math.round(snapped * 100) / 100).toFixed(2));
}
