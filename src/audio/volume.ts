export const MAX_SOUND_STEP = 20;

/**
 * Converts a 0.0-1.0 volume into integer sound steps from 0 to 20.
 */
export function volumeToSoundStep(vol: number): number {
  if (!vol || vol <= 0) return 0;
  return Math.max(0, Math.min(MAX_SOUND_STEP, Math.round(vol * MAX_SOUND_STEP)));
}

/**
 * Converts integer sound steps (0-20) to float volume (0.0-1.0).
 */
export function soundStepToVolume(step: number): number {
  if (step <= 0) return 0;
  return Math.max(0, Math.min(MAX_SOUND_STEP, Math.round(step))) / MAX_SOUND_STEP;
}

/**
 * Formats sound label with emojis for normal volume and boost levels.
 */
export function formatSoundLabel(vol: number, isMuted = false): string {
  if (isMuted || vol <= 0) {
    return '🔇 Sound: 0/20';
  }
  if (vol > 1.0) {
    const pct = Math.round(vol * 100);
    if (pct >= 500) {
      return `⚡ Ultra Boost: ${pct}% (MAX)`;
    } else if (pct >= 250) {
      return `🔥 Super Boost: ${pct}%`;
    }
    return `🚀 Loud Boost: ${pct}%`;
  }
  const step = volumeToSoundStep(vol);
  return `🔊 Sound: ${step}/20`;
}
