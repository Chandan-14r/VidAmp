export interface LimiterConfig {
  threshold: number; // dB
  knee: number;      // dB
  ratio: number;     // ratio : 1
  attack: number;    // seconds
  release: number;   // seconds
}

export const BRICKWALL_LIMITER_CONFIG: LimiterConfig = {
  threshold: -2.0, // Safe headroom protecting laptop speaker voice coils from clipping
  knee: 8.0,      // Soft-knee prevents harsh harmonic square wave generation
  ratio: 20.0,
  attack: 0.002, // 2ms fast brickwall attack
  release: 0.20, // 200ms smooth release
};

export const SUBSONIC_PROTECTION_CONFIG = {
  minCutoffHz: 20, // Transparent at normal volume (full range down to 20Hz)
  maxCutoffHz: 80, // Rolls off excursion-heavy sub-bass (<80Hz) at 600%-1000% turbo boost
  safeExcursionQ: 0.707, // Standard Butterworth alignment (no resonance peak)
};

export const MAX_BOOST_GAIN = 10.0; // 1000% maximum boost
export const MIN_BOOST_GAIN = 1.0;

/**
 * Validates and clamps audio boost gain multiplier within [1.0, 10.0].
 */
export function clampBoostGain(gain: number): number {
  if (!Number.isFinite(gain) || isNaN(gain)) return MIN_BOOST_GAIN;
  return Math.max(MIN_BOOST_GAIN, Math.min(MAX_BOOST_GAIN, gain));
}

/**
 * Calculates adaptive subsonic high-pass filter cutoff (Hz).
 * At normal volume (<= 1.0), passes 20Hz (unaltered).
 * At high boost (up to 10.0x), smoothly slopes up to 80Hz to protect tiny laptop speaker cones
 * from excursion bottoming-out and voice coil thermal stress while keeping voices and music clear.
 */
export function calculateSubsonicCutoff(gainMultiplier: number): number {
  if (!Number.isFinite(gainMultiplier) || gainMultiplier <= 1.0) {
    return SUBSONIC_PROTECTION_CONFIG.minCutoffHz;
  }
  const t = Math.min(1.0, (gainMultiplier - 1.0) / (MAX_BOOST_GAIN - 1.0));
  return Math.round(
    SUBSONIC_PROTECTION_CONFIG.minCutoffHz +
      t * (SUBSONIC_PROTECTION_CONFIG.maxCutoffHz - SUBSONIC_PROTECTION_CONFIG.minCutoffHz)
  );
}

/**
 * Applies dynamic limiter parameters based on gain boost level.
 */
export function calculateLimiterThreshold(gainMultiplier: number, baseThreshold = -8): number {
  if (gainMultiplier > 6.0) {
    return calculateTurboThreshold(gainMultiplier);
  }
  if (gainMultiplier >= 5.0) {
    return BRICKWALL_LIMITER_CONFIG.threshold; // -2.0 dBFS strict peak limit
  }
  if (gainMultiplier >= 2.5) {
    return Math.min(baseThreshold, -4.0);
  }
  return baseThreshold;
}

/**
 * Calculates progressive post-compression makeup gain multiplier.
 * For normal volumes (<= 6.0), returns 1.0 (unity gain).
 * For turbo boost (7.0 - 10.0), scales from 1.15x (+1.2 dB) to 1.78x (+5.0 dB)
 * so that each turbo step (700%, 800%, 900%, 1000%) produces an immediately
 * audible and distinct increase in perceived loudness.
 */
export function calculateTurboMakeupGain(gainMultiplier: number): number {
  if (!Number.isFinite(gainMultiplier) || gainMultiplier <= 6.0) return 1.0;
  if (gainMultiplier < 7.5) return 1.15; // 700% (+1.2 dB)
  if (gainMultiplier < 8.5) return 1.32; // 800% (+2.4 dB)
  if (gainMultiplier < 9.5) return 1.51; // 900% (+3.6 dB)
  return 1.78;                          // 1000% (+5.0 dB)
}

/**
 * Calculates progressive limiter threshold (dB) across turbo boost levels.
 * Progressively lifts the ceiling from -4.0 dB to -1.5 dB so that higher turbo steps
 * have more headroom and deliver noticeably higher acoustic power.
 */
export function calculateTurboThreshold(gainMultiplier: number): number {
  if (gainMultiplier <= 6.0) return -2.0;
  if (gainMultiplier < 7.5) return -4.0; // 700%
  if (gainMultiplier < 8.5) return -3.2; // 800%
  if (gainMultiplier < 9.5) return -2.4; // 900%
  return -1.5;                          // 1000%
}
