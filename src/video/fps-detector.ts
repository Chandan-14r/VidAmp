export interface PlaybackQualityProvider {
  getVideoPlaybackQuality?: () => { totalVideoFrames?: number } | null;
  webkitDecodedFrameCount?: number;
  currentTime?: number;
}

/**
 * Dynamically detects playback media framerate (24fps, 30fps, 60fps)
 * using video playback quality metrics or decoded frame counts.
 */
export function detectVideoFps(v: PlaybackQualityProvider | null | undefined): number {
  if (!v) return 30;
  try {
    const quality = typeof v.getVideoPlaybackQuality === 'function' ? v.getVideoPlaybackQuality() : null;
    const frames = quality?.totalVideoFrames ?? v.webkitDecodedFrameCount ?? 0;
    const time = v.currentTime ?? 0;

    if (frames > 30 && time > 1) {
      const fps = frames / time;
      if (fps >= 45) return 60;
      if (fps >= 23 && fps <= 26) return 24;
      if (fps >= 28 && fps <= 32) return 30;
      return Math.max(15, Math.min(120, Math.round(fps)));
    }
  } catch (_) {
    // Fall back to standard 30fps
  }
  return 30;
}
