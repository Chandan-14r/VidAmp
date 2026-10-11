export interface LimiterConfig {
  threshold: number; // dB
  knee: number;      // dB
  ratio: number;     // ratio : 1
  attack: number;    // seconds
  release: number;   // seconds
}

export const BRICKWALL_LIMITER_CONFIG: LimiterConfig = {
  threshold: -1.5,
  knee: 6.0,
  ratio: 20.0,
  attack: 0.003, // 3ms fast brickwall attack
  release: 0.25, // 250ms smooth release
};

export const MAX_BOOST_GAIN = 6.0;
export const MIN_BOOST_GAIN = 1.0;

/**
 * Validates and clamps audio boost gain multiplier within [1.0, 6.0].
 */
export function clampBoostGain(gain: number): number {
  if (!Number.isFinite(gain) || isNaN(gain)) return MIN_BOOST_GAIN;
  return Math.max(MIN_BOOST_GAIN, Math.min(MAX_BOOST_GAIN, gain));
}

/**
 * Applies dynamic limiter parameters based on gain boost level.
 */
export function calculateLimiterThreshold(gainMultiplier: number, baseThreshold = -8): number {
  if (gainMultiplier >= 5.0) {
    return BRICKWALL_LIMITER_CONFIG.threshold; // -1.5 dBFS strict peak limit
  }
  if (gainMultiplier >= 2.5) {
    return Math.min(baseThreshold, -4.0);
  }
  return baseThreshold;
}
