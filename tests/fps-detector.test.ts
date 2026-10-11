import { describe, it, expect } from 'vitest';
import { detectVideoFps } from '../src/video/fps-detector';

describe('FPS Detector', () => {
  it('defaults to 30fps for null or missing video quality data', () => {
    expect(detectVideoFps(null)).toBe(30);
    expect(detectVideoFps(undefined)).toBe(30);
    expect(detectVideoFps({})).toBe(30);
  });

  it('detects 60fps media accurately when frames/time >= 45', () => {
    const video60 = {
      currentTime: 10,
      getVideoPlaybackQuality: () => ({ totalVideoFrames: 600 }),
    };
    expect(detectVideoFps(video60)).toBe(60);
  });

  it('detects 24fps cinematic media when frames/time is ~24', () => {
    const video24 = {
      currentTime: 10,
      getVideoPlaybackQuality: () => ({ totalVideoFrames: 240 }),
    };
    expect(detectVideoFps(video24)).toBe(24);
  });

  it('detects 30fps standard media when frames/time is ~30', () => {
    const video30 = {
      currentTime: 10,
      getVideoPlaybackQuality: () => ({ totalVideoFrames: 300 }),
    };
    expect(detectVideoFps(video30)).toBe(30);
  });

  it('falls back to webkitDecodedFrameCount if getVideoPlaybackQuality is not implemented', () => {
    const safariVideo = {
      currentTime: 5,
      webkitDecodedFrameCount: 300, // 300 / 5 = 60fps
    };
    expect(detectVideoFps(safariVideo)).toBe(60);
  });
});
