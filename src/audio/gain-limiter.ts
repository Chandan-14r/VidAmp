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
  if (gainMultiplier >= 5.0) {
    return BRICKWALL_LIMITER_CONFIG.threshold; // -2.0 dBFS strict peak limit
  }
  if (gainMultiplier >= 2.5) {
    return Math.min(baseThreshold, -4.0);
  }
  return baseThreshold;
}
