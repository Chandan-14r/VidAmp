/**
 * Formats a duration in seconds into M:SS or H:MM:SS format.
 */
export function formatTime(sec: number): string {
  if (!Number.isFinite(sec) || isNaN(sec)) return '--:--';
  sec = Math.max(0, Math.floor(sec));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

/**
 * Formats precise time with milliseconds (M:SS.mmm).
 */
export function formatTimeWithMs(sec: number): string {
  if (!Number.isFinite(sec) || isNaN(sec)) return '00:00.000';
  sec = Math.max(0, sec);
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  const ms = Math.round((sec % 1) * 1000);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(ms).padStart(3, '0')}`;
}

/**
 * Formats remaining time as negative countdown string (-M:SS).
 */
export function formatRemainingTime(current: number, duration: number): string {
  if (!Number.isFinite(duration) || duration <= 0) return formatTime(current);
  const remaining = Math.max(0, duration - current);
  return `-${formatTime(remaining)}`;
}
