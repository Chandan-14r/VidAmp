export const MAX_SOUND_STEP = 20;

/**
 * Converts a 0.0-1.0 physical volume into integer sound steps from 0 to 20
 * using a square-law perceptual curve matching human hearing.
 */
export function volumeToSoundStep(vol: number): number {
  if (!vol || vol <= 0) return 0;
  if (vol >= 1.0) return MAX_SOUND_STEP;
  return Math.max(0, Math.min(MAX_SOUND_STEP, Math.round(Math.sqrt(vol) * MAX_SOUND_STEP)));
}

/**
 * Converts integer sound steps (0-20) to float volume (0.0-1.0)
 * using an acoustic power square curve (step / 20)^2.
 * Steps 1-4 scale smoothly and quietly without early saturation.
 */
export function soundStepToVolume(step: number): number {
  if (step <= 0) return 0;
  const clampedStep = Math.max(0, Math.min(MAX_SOUND_STEP, Math.round(step)));
  const normalized = clampedStep / MAX_SOUND_STEP;
  return Math.round(normalized * normalized * 10000) / 10000;
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
