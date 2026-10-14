export const MAX_SOUND_STEP = 20;
export const MAX_NORMAL_VOLUME = 6.0; // 600% at step 20
export const MAX_TURBO_VOLUME = 10.0;  // 1000% ultra boost
export const TURBO_BOOST_LADDER = [7.0, 8.0, 9.0, 10.0];

/**
 * Converts a physical volume (0.0 to 10.0) into integer sound steps from 0 to 20.
 * Step 0 = 0.0 (mute)
 * Step 20 = 6.0 (600% maximum normal volume)
 */
export function volumeToSoundStep(vol: number): number {
  if (!vol || vol <= 0) return 0;
  if (vol >= MAX_NORMAL_VOLUME) return MAX_SOUND_STEP;
  const fraction = Math.sqrt(vol / MAX_NORMAL_VOLUME);
  return Math.max(0, Math.min(MAX_SOUND_STEP, Math.round(fraction * MAX_SOUND_STEP)));
}

/**
 * Converts integer sound steps (0-20) to float volume (0.0-6.0).
 * Scales smoothly from 0 to 600% at step 20 using acoustic square curve.
 */
export function soundStepToVolume(step: number): number {
  if (step <= 0) return 0;
  const clampedStep = Math.max(0, Math.min(MAX_SOUND_STEP, Math.round(step)));
  const normalized = clampedStep / MAX_SOUND_STEP;
  return Math.round(MAX_NORMAL_VOLUME * normalized * normalized * 10000) / 10000;
}

/**
 * Formats sound label with emojis for normal volume and boost levels.
 */
export function formatSoundLabel(vol: number, isMuted = false): string {
  if (isMuted || vol <= 0) {
    return '🔇 Sound: 0/20';
  }
  if (vol > MAX_NORMAL_VOLUME) {
    const pct = Math.round(vol * 100);
    if (pct >= 1000) {
      return `⚡ Ultra Boost: ${pct}% (MAX)`;
    }
    return `⚡ Turbo Boost: ${pct}%`;
  }
  const step = volumeToSoundStep(vol);
  return `🔊 Sound: ${step}/20`;
}
