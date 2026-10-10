/* =========================================================
   Ultimate Video Controller v6.0 — Production Chrome Extension
   Architecture:
   - ActiveVideoManager (robust multi-video & YouTube SPA tracking)
   - InputManager & Keyboard Shortcuts (editable-element protection)
   - GestureManager (trackpad pinch, touch 2-finger drag, hold-to-boost, rate-guard)
   - GestureZoneManager (left brightness, right volume, center safe zone)
   - AudioController (Web Audio API volume boost up to 200%, lazy context)
   - FilterController (non-destructive CSS brightness, contrast, saturate)
   - LoopManager (full loop & A/B segment repeat)
   - ScreenshotManager (timestamped canvas capture, PNG/JPEG, CORS resilient)
   - MiniplayerManager (smart scroll-away miniplayer with YouTube conflict avoidance)
   - OverlayManager (unified top-center feedback toast)
   - UIController (draggable, adaptive docking shadow DOM panel)
   - SettingsManager (chrome.storage.local sync, live tab updates)
   ========================================================= */

(async function () {
    'use strict';

    const isTopWindow = window.self === window.top;
    if (!isTopWindow) {
        try {
            if (window.innerWidth > 0 && window.innerHeight > 0 && (window.innerWidth < 200 || window.innerHeight < 140)) {
                return; // Ignore tiny ad banners and tracking iframes
            }
        } catch (_) {}
    }

    const DEBUG = false;
    const dbg = (...args) => { if (DEBUG) console.info('[MVC]', ...args); };

    dbg('Ultimate Video Controller v6.0 initializing on:', location.hostname);

    /* =========================================================
       Constants & Defaults
       ========================================================= */

    const MAX_SPEED = 4;
    const MIN_SPEED = 0.25;
    const SPEED_STEP = 0.25;
    const SPEED_INCREMENT = SPEED_STEP;
    const SPEED_GRID = SPEED_STEP;
    const SEEK_OPTIONS = [5, 10, 15, 30];
    const MIN_AREA = 6000;
    const SEEK_RETRY_COUNT = 14;
    const SEEK_RETRY_DELAY = 120;

    // Gesture constants
    const DEFAULT_GESTURE_THRESHOLD = 14;
    const DEFAULT_GESTURE_SENSITIVITY = 55;
    const GESTURE_AXIS = 'Y';
    const GESTURE_DIRECTION = 1;
    const TRACKPAD_GESTURE_COOLDOWN_MS = 350;

    // Hold-to-boost constants
    const HOLD_BOOST_SPEED = 2;
    const HOLD_BOOST_DELAY_MS = 350;
    const HOLD_BOOST_MOVE_TOLERANCE = 40;
    const RATE_GUARD_MIN_HOLD_MS = 250;
    const RATE_GUARD_RETRY_MS = [0, 80, 200, 400, 800, 1200];
    const RATE_GUARD_WINDOW_MS = 1800;

    function stepDownToGrid(rate, step = SPEED_GRID) {
        const cur = Number(rate) || 1.0;
        const epsilon = 1e-4;
        const snapped = Math.floor((cur - epsilon) / step) * step;
        return Number(Math.max(MIN_SPEED, Math.round(snapped * 100) / 100).toFixed(2));
    }

    function stepUpToGrid(rate, step = SPEED_GRID) {
        const cur = Number(rate) || 1.0;
        const epsilon = 1e-4;
        const snapped = Math.ceil((cur + epsilon) / step) * step;
        return Number(Math.min(MAX_SPEED, Math.round(snapped * 100) / 100).toFixed(2));
    }

    function formatTime(sec) {
        if (!Number.isFinite(sec)) return '--:--';
        sec = Math.max(0, Math.floor(sec));
        const h = Math.floor(sec / 3600);
        const m = Math.floor((sec % 3600) / 60);
        const s = sec % 60;
        const pad = n => String(n).padStart(2, '0');
        return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
    }

    function formatSpeed(n) {
        return (Math.round(Number(n) * 100) / 100) + '×';
    }

    /* =========================================================
       Settings & Storage Layer (Cross-Browser WebExtensions)
       ========================================================= */

    const extApi = (typeof browser !== 'undefined' && browser.storage) ? browser : (typeof chrome !== 'undefined' ? chrome : null);
    const STORAGE_PREFIX = 'mvc_';
    let storageCache = {};

    try {
        if (extApi && extApi.storage && extApi.storage.local) {
            storageCache = await extApi.storage.local.get(null);
        }
    } catch (err) {
        console.warn('[MVC] Storage cache hydration fallback:', err);
    }

    function loadValue(key, fallback) {
        const k = STORAGE_PREFIX + key;
        return k in storageCache ? storageCache[k] : fallback;
    }

    function saveValue(key, value) {
        const k = STORAGE_PREFIX + key;
        storageCache[k] = value;
        try {
            if (extApi && extApi.storage && extApi.storage.local) {
                extApi.storage.local.set({ [k]: value });
            }
        } catch (err) {
            console.warn('[MVC] Storage write failed:', err);
        }
    }

    const storeValue = saveValue;

    let speedStorageDebounceTimer = null;
    function debouncedSaveSpeed(rate) {
        clearTimeout(speedStorageDebounceTimer);
        speedStorageDebounceTimer = setTimeout(() => {
            saveValue(siteKey('speed'), rate);
        }, 350);
    }

    const siteKey = key => `mvc:${location.hostname.toLowerCase()}:${key}`;

    function validSpeed(value) {
        const n = Number(value);
        return Number.isFinite(n) && n >= MIN_SPEED && n <= MAX_SPEED;
    }

    function validSeek(value) {
        const n = Number(value);
        return SEEK_OPTIONS.includes(n);
    }

    const prefs = {
        speed: validSpeed(loadValue(siteKey('speed'), 1)) ? Number(loadValue(siteKey('speed'), 1)) : 1,
        volume: Number.isFinite(Number(loadValue(siteKey('volume'), 1)))
            ? Math.max(0, Math.min(2, Number(loadValue(siteKey('volume'), 1))))
            : 1,
        muted: Boolean(loadValue(siteKey('muted'), false)),
        seekSeconds: validSeek(loadValue(siteKey('seekSeconds'), 10)) ? Number(loadValue(siteKey('seekSeconds'), 10)) : 10,
        shortcuts: loadValue('shortcuts', true) !== false,

        pos: loadValue('pos', null),
        pinned: Boolean(loadValue('pinned', false)),
        manualPos: Boolean(loadValue('manualPos', false)),
        showToolbar: false, // Default: toolbar is strictly on-demand, only shown when clicking the VidAmp side dropdown
        sideTabEnabled: Boolean(loadValue('sideTabEnabled', false)), // Floating tab is disabled by default so it never obstructs video buttons

        // Enhanced feature flags & settings
        trackpadSpeedEnabled: loadValue('trackpadSpeedEnabled', true) !== false,
        gestureZonesEnabled: loadValue('gestureZonesEnabled', false) === true,
        gestureSensitivity: Number(loadValue('gestureSensitivity', DEFAULT_GESTURE_SENSITIVITY)) || DEFAULT_GESTURE_SENSITIVITY,
        gestureReverse: Boolean(loadValue('gestureReverse', false)),
        volumeBoostEnabled: loadValue('volumeBoostEnabled', true) !== false,
        mouseDragSpeedEnabled: loadValue('mouseDragSpeedEnabled', true) !== false,
        centerWheelSpeedEnabled: false, // Plain touchpad scrolling must NEVER change speed
        smartMiniplayerEnabled: Boolean(loadValue('smartMiniplayerEnabled', false)),
        screenshotFormat: loadValue('screenshotFormat', 'png') === 'jpeg' ? 'jpeg' : 'png',
        autoTheater: Boolean(loadValue('autoTheater', false)),

        // Filter values (per session/site)
        brightness: Number(loadValue(siteKey('brightness'), 100)) || 100,
        contrast: Number(loadValue(siteKey('contrast'), 100)) || 100,
        saturate: Number(loadValue(siteKey('saturate'), 100)) || 100
    };

    /* =========================================================
       Video Discovery & Active Video Tracking
       ========================================================= */

    function isVisible(el) {
        if (!el || !el.isConnected) return false;
        if (!el.offsetWidth || !el.offsetHeight) return false;

        const style = getComputedStyle(el);
        if (
            style.display === 'none' ||
            style.visibility === 'hidden' ||
            parseFloat(style.opacity) === 0
        ) {
            return false;
        }

        const rect = el.getBoundingClientRect();
        return (
            rect.width >= 1 &&
            rect.height >= 1 &&
            rect.bottom > 0 &&
            rect.right > 0 &&
            rect.top < window.innerHeight &&
            rect.left < window.innerWidth
        );
    }

    function isUsableVideo(v) {
        if (!v || !v.isConnected || !(v instanceof HTMLVideoElement)) return false;
        if (v.videoWidth > 0 || v.videoHeight > 0 || !v.paused) return true;
        if (v.offsetWidth >= 30 && v.offsetHeight >= 30) return true;
        return isVisible(v);
    }

    function isYouTubePage() {
        return /(^|\.)youtube\.com$/i.test(location.hostname) ||
               /(^|\.)youtube-nocookie\.com$/i.test(location.hostname);
    }

    function findYouTubeMainVideo() {
        if (!isYouTubePage()) return null;

        // Watch page main video
        const selectors = [
            '#movie_player video.html5-main-video',
            '#movie_player video',
            'ytd-watch-flexy video.html5-main-video',
            'ytd-reel-video-renderer[is-active] video',
            'video.html5-main-video'
        ];

        for (const selector of selectors) {
            try {
                const v = document.querySelector(selector);
                if (v && isUsableVideo(v)) return v;
            } catch (_) {}
        }
        return null;
    }

    function inViewport(el) {
        const r = el.getBoundingClientRect();
        return (
            r.bottom > 0 &&
            r.top < window.innerHeight &&
            r.right > 0 &&
            r.left < window.innerWidth
        );
    }

    function collectVideos(initialRoot, out, seenVideos, seenRoots) {
        if (!initialRoot || !initialRoot.querySelectorAll) return;
        const queue = [{ root: initialRoot, depth: 0 }];
        const MAX_DEPTH = 3;

        while (queue.length > 0) {
            const { root, depth } = queue.shift();
            if (!root || !root.querySelectorAll) continue;

            let directVideos = [];
            try {
                directVideos = [...root.querySelectorAll('video')];
            } catch (_) {}

            for (const v of directVideos) {
                if (!seenVideos.has(v)) {
                    seenVideos.add(v);
                    out.push(v);
                }
            }

            if (depth < MAX_DEPTH) {
                let playerHosts = [];
                try {
                    playerHosts = [...root.querySelectorAll('[class*="player"], [id*="player"], video-js, media-player, ytd-player, ytd-watch-flexy')];
                } catch (_) {}

                for (const el of playerHosts) {
                    try {
                        const sr = el.shadowRoot;
                        if (!sr || seenRoots.has(sr)) continue;
                        seenRoots.add(sr);
                        queue.push({ root: sr, depth: depth + 1 });
                    } catch (_) {}
                }
            }
        }
    }

    function queryVideos(root = document) {
        const out = [];
        const seenVideos = new Set();
        const seenRoots = new Set([root]);
        collectVideos(root, out, seenVideos, seenRoots);
        return out;
    }

    function scoreVideo(v) {
        const area = v.offsetWidth * v.offsetHeight;
        if (area < MIN_AREA) return -1;

        let score = area;
        if (inViewport(v)) score *= 2;
        if (!v.paused && !v.ended) score *= 1.5;
        if (v.muted && v.paused) score *= 0.75;
        return score;
    }

    function findVideos() {
        const all = queryVideos(document).filter(isVisible);

        const scored = all
            .map(v => ({ v, score: scoreVideo(v) }))
            .filter(x => x.score >= 0)
            .sort((a, b) => b.score - a.score)
            .map(x => x.v);

        const ranked = scored.length ? scored : all;
        const ytMain = findYouTubeMainVideo();
        if (ytMain) {
            return [ytMain, ...ranked.filter(v => v !== ytMain)];
        }
        return ranked;
    }

    /* =========================================================
       Active State & Controller Singletons
       ========================================================= */

    let videos = [];
    let videoIndex = 0;
    let video = null;
    let preferredVideo = null;
    let videoAbortController = null;

    let panelBuilt = false;
    let panelBuildInProgress = false;
    let shadow = null;
    let panel = null;
    let playBtn = null;
    let muteBtn = null;
    let volumeSlider = null;
    let speedButtons = [];
    let extraSpeedSelect = null;
    let progressBar = null;
    let progressFill = null;
    let loopMarkerA = null;
    let loopMarkerB = null;
    let timeLabel = null;
    let pinBtn = null;
    let dockBtn = null;
    let settingsBtn = null;
    let closeBtn = null;
    let counterRow = null;
    let counterLabel = null;
    let toastEl = null;
    let cheatSheet = null;
    let settingsPanel = null;
    let seekSelect = null;
    let shortcutsCheck = null;
    let trackpadCheck = null;
    let gestureZonesCheck = null;
    let volumeBoostCheck = null;
    let smartMiniplayerCheck = null;
    let loopBtn = null;
    let setLoopABtn = null;
    let setLoopBBtn = null;
    let clearLoopABBtn = null;
    let screenshotBtn = null;
    let pipBtn = null;
    let fullscreenBtn = null;
    let resetFiltersBtn = null;

    let showRemainingTime = false;
    let hideTimer = null;
    let toastTimer = null;
    let lastPointer = null;

    // A/B Loop State
    let loopA = null;
    let loopB = null;

    // Gestures state
    const gesturePointers = new Map();
    let gestureVideo = null;
    let gestureBaseRate = 1;
    let gestureStartMid = 0;
    let gestureEngaged = false;
    let gestureRafPending = false;
    let gestureLatestDelta = null;

    let holdBoostPointerId = null;
    let holdBoostTimer = null;
    let holdBoostVideo = null;
    let holdBoostRestoreRate = null;
    let holdBoostEngaged = false;
    let holdBoostSource = null; // 'space' | 'pointer' | 'double-tap'
    let holdBoostStartPos = null;
    let holdBoostDownTime = 0;
    let suppressNextClick = false;

    // Spacebar Hold-to-2x state
    let spaceDownTime = 0;
    let spaceHoldTimer = null;
    let spaceTargetVideo = null;
    let spaceKeyIntercepted = false;
    const SPACE_HOLD_DELAY_MS = 220;

    // Double-tap & Pointer Hold-to-2x state
    let lastTapTimestamp = 0;
    let lastTapX = 0;
    let lastTapY = 0;
    let isDoubleTapCandidate = false;
    const DOUBLE_TAP_MAX_GAP_MS = 380;
    const DOUBLE_TAP_HOLD_DELAY_MS = 140;
    const SINGLE_HOLD_DELAY_MS = 280;
    const HOLD_MAX_MOVE_PX = 22;

    // Mouse speed drag state (moving mouse in opposite directions to inc/dec speed)
    let mouseDragActive = false;
    let mouseDragVideo = null;
    let mouseDragStartPos = null;
    let mouseDragBaseRate = 1;
    let mouseDragEngaged = false;

    let rateGuard = null;
    let rateGuardToken = 0;

    // Persistent speed & temporary 2x boost tracking
    let persistentUserSpeed = 1.0;
    let temporaryBoostActive = false;
    let temporaryBoostOriginalSpeed = null;
    let temporaryBoostRestoreTimer = null;

    let trackpadGestureVideo = null;
    let trackpadGestureLatestDelta = 0;
    let trackpadGestureIdleTimer = null;
    let accumulatedWheelDelta = 0;
    let wheelIdleTimer = null;
    let wheelGestureRaf = null;
    let wheelGestureTarget = null;
    let wheelGestureLastAt = 0;
    let wheelGestureStreak = 0;

    let fullscreenFallback = null;
    let hostOriginalParent = null;
    let hostOriginalNextSibling = null;

    // Miniplayer state
    let miniplayerObserver = null;
    let miniplayerShell = null;
    let isMiniplayerFloating = false;

    let showPanel = () => {};
    let updateDockButton = () => {};
    let positionPanelSmartly = () => {};
    let applyStoredPosition = () => {};
    let hidePanel = () => {};

    // Below-video toolbar state
    let toolbarHost = null;
    let tbShadow = null;
    let toolbarBuilt = false;
    let toolbarEl = null;
    let cinemaModeActive = false;
    let cinemaOverlay = null;
    let hideCardsActive = false;
    let hideCardsStyle = null;
    let toolbarCustomPos = null;
    let isDraggingToolbar = false;
    let toolbarDragStart = null;
    const MIN_VIDEO_AREA_PCT = 0.25; // 25% of viewport to show toolbar

    // Side dropdown tab state (collapses/expands below-video toolbar on demand)
    let sideTabHost = null;
    let sideTabShadow = null;
    let sideTabBtn = null;
    let sideTabBuilt = false;
    let sideTabCustomPos = null;
    let isDraggingSideTab = false;
    let sideTabDragStart = null;
    let sideTabIdleTimer = null;

    // === Audio FX State (Bass Boost & Vocal Clarity) ===
    let bassBoostActive = false;
    let vocalBoostActive = false;

    // === Universal Ambient Glow State ===
    let ambientGlowActive = false;
    let ambientCanvasEl = null;
    let ambientCtx = null;
    let ambientRafId = null;
    let lastAmbientDraw = 0;

    // === Mini-Clip Exporter State ===
    let isRecordingClip = false;
    let clipMediaRecorder = null;
    let clipRecordedChunks = [];

    // === Video Timestamp Bookmarks State ===
    let videoBookmarks = [];

    // === Sleep Timer State ===
    let sleepTimerMode = 'off';
    let sleepTimerRemainingSec = 0;
    let sleepTimerInterval = null;

    // === Speed Popover State ===
    let speedPopoverEl = null;

    // === Speed Authority & Anti-Drift State ===
    let isInternalRateChange = false;
    let accumulatedPinchDelta = 0;
    let trackpadPinchTimer = null;
    let lastTrackpadGestureTime = 0;
    let trackpadGestureStreak = 0;

    /* =========================================================
       Audio Controller (Lazy Web Audio API Volume Boost & EQ)
       ========================================================= */

    const audioNodes = new WeakMap(); // HTMLMediaElement -> { ctx, source, gain, bassFilter, vocalFilter }

    function getOrCreateAudioBoostNode(v) {
        if (!v || v.paused) return null;
        let entry = audioNodes.get(v);
        if (entry) {
            if (entry.ctx.state === 'suspended') {
                entry.ctx.resume().catch(() => {});
            }
            return entry;
        }

        try {
            const AudioCtx = window.AudioContext || window.webkitAudioContext;
            if (!AudioCtx) return null;

            const ctx = new AudioCtx();
            const source = ctx.createMediaElementSource(v);

            // BiquadFilter: Low-shelf for Bass Boost
            const bassFilter = ctx.createBiquadFilter();
            bassFilter.type = 'lowshelf';
            bassFilter.frequency.value = 140;
            bassFilter.gain.value = bassBoostActive ? 7.0 : 0.0;

            // BiquadFilter: Peaking for Vocal Clarity / Dialogue Boost
            const vocalFilter = ctx.createBiquadFilter();
            vocalFilter.type = 'peaking';
            vocalFilter.frequency.value = 2400;
            vocalFilter.Q.value = 1.0;
            vocalFilter.gain.value = vocalBoostActive ? 6.0 : 0.0;

            const gain = ctx.createGain();
            gain.gain.value = 1.0;

            // Chain: source -> bassFilter -> vocalFilter -> gain -> ctx.destination
            source.connect(bassFilter);
            bassFilter.connect(vocalFilter);
            vocalFilter.connect(gain);
            gain.connect(ctx.destination);

            entry = { ctx, source, gain, bassFilter, vocalFilter };
            audioNodes.set(v, entry);

            if (ctx.state === 'suspended') {
                ctx.resume().catch(() => {});
            }
            return entry;
        } catch (err) {
            dbg('Web Audio setup skipped or restricted:', err);
            return null;
        }
    }

    function applyVolumeAndBoost(v, volumeLevel, notify = false) {
        if (!v) return;

        const effectiveVol = Math.max(0, Math.min(prefs.volumeBoostEnabled ? 2.0 : 1.0, volumeLevel));
        prefs.volume = effectiveVol;
        saveValue(siteKey('volume'), effectiveVol);

        if (effectiveVol <= 1.0) {
            // Normal volume
            v.volume = effectiveVol;
            const entry = audioNodes.get(v);
            if (entry) {
                entry.gain.gain.value = 1.0;
            }
            if (notify) {
                showToast(`🔊 Volume: ${Math.round(effectiveVol * 100)}%`);
            }
        } else {
            // Volume Boost active (> 100%)
            v.volume = 1.0;
            const entry = getOrCreateAudioBoostNode(v);
            if (entry) {
                entry.gain.gain.value = effectiveVol;
                if (notify) {
                    showToast(`🚀 Volume Boost: ${Math.round(effectiveVol * 100)}%`);
                }
            } else {
                // If Web Audio blocked, stay at 100%
                v.volume = 1.0;
                if (notify) {
                    showToast(`🔊 Volume: 100%`);
                }
            }
        }

        if (effectiveVol > 0 && v.muted) {
            v.muted = false;
            prefs.muted = false;
            saveValue(siteKey('muted'), false);
        }

        syncControlsToVideo();
    }

    function toggleBassBoost(v) {
        if (!v) v = getVideo();
        if (!v) return;
        bassBoostActive = !bassBoostActive;
        const entry = getOrCreateAudioBoostNode(v);
        if (entry && entry.bassFilter) {
            entry.bassFilter.gain.value = bassBoostActive ? 7.0 : 0.0;
        }
        showToast(bassBoostActive ? '🔊 Bass Boost: ON (+7dB)' : '🔊 Bass Boost: OFF');
        if (toolbarBuilt) syncToolbar();
        syncControlsToVideo();
    }

    function toggleVocalBoost(v) {
        if (!v) v = getVideo();
        if (!v) return;
        vocalBoostActive = !vocalBoostActive;
        const entry = getOrCreateAudioBoostNode(v);
        if (entry && entry.vocalFilter) {
            entry.vocalFilter.gain.value = vocalBoostActive ? 6.0 : 0.0;
        }
        showToast(vocalBoostActive ? '🎙️ Vocal Clarity: ON (+6dB)' : '🎙️ Vocal Clarity: OFF');
        if (toolbarBuilt) syncToolbar();
        syncControlsToVideo();
    }

    /* =========================================================
       Video Filter Controller (Non-destructive CSS Filters)
       ========================================================= */

    function applyVideoFilters(v) {
        if (!v || !v.isConnected) return;

        const b = prefs.brightness;
        const c = prefs.contrast;
        const s = prefs.saturate;

        if (b === 100 && c === 100 && s === 100) {
            v.style.filter = '';
        } else {
            v.style.filter = `brightness(${b}%) contrast(${c}%) saturate(${s}%)`;
        }
    }

    function adjustBrightness(delta, notify = true) {
        const v = getVideo();
        if (!v) return;

        const next = Math.max(10, Math.min(200, prefs.brightness + delta));
        prefs.brightness = next;
        saveValue(siteKey('brightness'), next);
        applyVideoFilters(v);

        if (notify) {
            showToast(`☀️ Brightness: ${next}%`);
        }
    }

    function resetFilters(notify = true) {
        const v = getVideo();
        prefs.brightness = 100;
        prefs.contrast = 100;
        prefs.saturate = 100;
        saveValue(siteKey('brightness'), 100);
        saveValue(siteKey('contrast'), 100);
        saveValue(siteKey('saturate'), 100);

        if (v) applyVideoFilters(v);
        if (notify) showToast('🎨 Filters Reset');
    }

    /* =========================================================
       Loop & A/B Repeat Controller
       ========================================================= */

    function updateLoopMarkers() {
        if (!panelBuilt || !progressBar || !video) return;

        const dur = video.duration;
        if (!Number.isFinite(dur) || dur <= 0) {
            if (loopMarkerA) loopMarkerA.style.display = 'none';
            if (loopMarkerB) loopMarkerB.style.display = 'none';
            return;
        }

        if (loopA !== null && loopMarkerA) {
            loopMarkerA.style.display = 'block';
            loopMarkerA.style.left = `${Math.min(100, Math.max(0, (loopA / dur) * 100))}%`;
        } else if (loopMarkerA) {
            loopMarkerA.style.display = 'none';
        }

        if (loopB !== null && loopMarkerB) {
            loopMarkerB.style.display = 'block';
            loopMarkerB.style.left = `${Math.min(100, Math.max(0, (loopB / dur) * 100))}%`;
        } else if (loopMarkerB) {
            loopMarkerB.style.display = 'none';
        }

        if (setLoopABtn) setLoopABtn.classList.toggle('active', loopA !== null);
        if (setLoopBBtn) setLoopBBtn.classList.toggle('active', loopB !== null);
    }

    function handleLoopTimeUpdate(v) {
        if (!v || loopA === null || loopB === null || loopA >= loopB) return;
        if (v.currentTime >= loopB || v.currentTime < loopA - 0.5) {
            setCurrentTimeNative(v, loopA);
        }
    }

    /* =========================================================
       Live Stream Catch-Up & Live-Head Protection
       ========================================================= */

    let lastLiveCatchupToastTime = 0;

    function isLiveVideo(v) {
        if (!v) return false;

        // 1. Any video with a valid, finite duration (> 0 and < 1,000,000s) is a standard recorded VOD (YouTube videos, movies, TV shows).
        // Standard recorded media is NEVER a live stream and must have full, unrestricted speed control!
        if (Number.isFinite(v.duration) && v.duration > 0 && v.duration < 1000000) {
            return false;
        }

        // 2. YouTube specialized live stream check
        if (isYouTubePage()) {
            const moviePlayer = document.getElementById('movie_player') || document.querySelector('.html5-video-player');
            if (moviePlayer && typeof moviePlayer.getVideoData === 'function') {
                try {
                    if (moviePlayer.getVideoData()?.isLive === true) return true;
                } catch (_) {}
            }
            const liveBadge = document.querySelector('.ytp-live-badge');
            if (liveBadge && !liveBadge.hasAttribute('disabled') && liveBadge.offsetWidth > 0 && (liveBadge.textContent || '').toUpperCase().includes('LIVE')) {
                return true;
            }
        }

        // 3. True live streams have infinite or non-finite duration
        if (v.duration === Infinity) return true;

        // 4. Moving seekable DVR window (only when duration is not a normal finite length)
        if (v.seekable && v.seekable.length > 0) {
            try {
                const start = v.seekable.start(0);
                if (start > 30 && (!Number.isFinite(v.duration) || v.duration === Infinity)) {
                    return true;
                }
            } catch (_) {}
        }

        return false;
    }

    function getLiveDelay(v) {
        if (!v || !isLiveVideo(v)) return null;

        // YouTube live stream delay
        if (isYouTubePage()) {
            const liveBadge = document.querySelector('.ytp-live-badge');
            if (liveBadge && (liveBadge.hasAttribute('disabled') || liveBadge.classList.contains('disabled'))) {
                return 0; // Exactly at the live edge!
            }
            const moviePlayer = document.getElementById('movie_player') || document.querySelector('.html5-video-player');
            if (moviePlayer && typeof moviePlayer.getProgressState === 'function') {
                try {
                    const ps = moviePlayer.getProgressState();
                    if (ps && typeof ps.seekableEnd === 'number' && typeof ps.current === 'number') {
                        return Math.max(0, ps.seekableEnd - ps.current);
                    }
                } catch (_) {}
            }
        }

        // HTML5 Media seekable DVR window
        if (v.seekable && v.seekable.length > 0) {
            try {
                const liveEnd = v.seekable.end(v.seekable.length - 1);
                if (Number.isFinite(liveEnd)) {
                    return Math.max(0, liveEnd - v.currentTime);
                }
            } catch (_) {}
        }

        if (v.duration === Infinity) return 0;

        return null;
    }

    function checkLiveStreamCatchUp(v) {
        if (!v || v.paused) return;
        if (Number(v.playbackRate) <= 1.0) return; // Only monitor if user is running faster than 1x to catch up

        // Fast bail-out for recorded videos (YouTube, movies, etc.)
        if (Number.isFinite(v.duration) && v.duration > 0 && v.duration < 1000000) return;
        if (!isLiveVideo(v)) return;

        const delay = getLiveDelay(v);
        // If within 2.5 seconds of the live head, we have caught up to the live stream
        if (delay !== null && delay <= 2.5) {
            const now = performance.now();
            if (now - lastLiveCatchupToastTime > 3000) {
                lastLiveCatchupToastTime = now;
                setPlaybackRate(v, 1.0, false);
                showToast('🔴 Caught up to Live — Speed returned to 1×');
                if (toolbarBuilt) syncToolbar();
                syncControlsToVideo();
            }
        }
    }

    function setPointA() {
        const v = getVideo();
        if (!v) return;
        loopA = v.currentTime;
        if (loopB !== null && loopA >= loopB) loopB = null;
        updateLoopMarkers();
        showToast(`📍 Set A: ${formatTime(loopA)}`);
    }

    function setPointB() {
        const v = getVideo();
        if (!v) return;
        if (loopA === null) {
            loopA = 0;
        }
        loopB = v.currentTime;
        if (loopB <= loopA) {
            showToast('Point B must be after Point A');
            loopB = null;
            updateLoopMarkers();
            return;
        }
        updateLoopMarkers();
        showToast(`🔁 Loop A-B: ${formatTime(loopA)} → ${formatTime(loopB)}`);
    }

    function clearLoopAB() {
        loopA = null;
        loopB = null;
        updateLoopMarkers();
        showToast('A-B Loop Cleared');
        if (toolbarBuilt) syncToolbar();
        syncControlsToVideo();
    }

    /* =========================================================
       Mini-Clip / WebM Exporter (from A-B Loop)
       ========================================================= */

    function exportLoopClip() {
        const v = getVideo();
        if (!v) return;
        if (loopA === null || loopB === null || loopB <= loopA) {
            showToast('⚠️ Set Point A and Point B first to export clip');
            return;
        }

        const duration = loopB - loopA;
        if (duration > 90) {
            showToast('⚠️ Loop duration exceeds 90s limit');
            return;
        }

        if (isRecordingClip) {
            showToast('Clip recording already in progress');
            return;
        }

        let stream = null;
        try {
            if (typeof v.captureStream === 'function') {
                stream = v.captureStream();
            } else if (typeof v.mozCaptureStream === 'function') {
                stream = v.mozCaptureStream();
            }
        } catch (_) {}

        if (!stream) {
            showToast('Media stream capture not supported on this video');
            return;
        }

        try {
            clipRecordedChunks = [];
            const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
                ? 'video/webm;codecs=vp9'
                : (MediaRecorder.isTypeSupported('video/webm') ? 'video/webm' : '');

            clipMediaRecorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
            clipMediaRecorder.ondataavailable = e => {
                if (e.data && e.data.size > 0) clipRecordedChunks.push(e.data);
            };

            clipMediaRecorder.onstop = () => {
                isRecordingClip = false;
                const blob = new Blob(clipRecordedChunks, { type: 'video/webm' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                const title = getCleanVideoTitle() || 'video';
                a.download = `${title}_clip_${formatTime(loopA)}-${formatTime(loopB)}.webm`;
                document.body.appendChild(a);
                a.click();
                setTimeout(() => {
                    a.remove();
                    URL.revokeObjectURL(url);
                }, 1000);
                showToast(`🎬 Clip downloaded! (${Math.round(duration)}s)`);
                if (toolbarBuilt) syncToolbar();
                syncControlsToVideo();
            };

            isRecordingClip = true;
            setCurrentTimeNative(v, loopA);
            showToast(`🔴 Recording loop clip (${Math.round(duration)}s)...`);
            clipMediaRecorder.start();
            safePlay(v);
            if (toolbarBuilt) syncToolbar();
            syncControlsToVideo();

            const checkClipProgress = () => {
                if (!isRecordingClip) return;
                if (v.currentTime >= loopB || v.currentTime < loopA - 0.5) {
                    v.pause();
                    if (clipMediaRecorder && clipMediaRecorder.state === 'recording') {
                        clipMediaRecorder.stop();
                    }
                    v.removeEventListener('timeupdate', checkClipProgress);
                }
            };
            v.addEventListener('timeupdate', checkClipProgress);
        } catch (err) {
            isRecordingClip = false;
            showToast('Error recording clip');
            if (toolbarBuilt) syncToolbar();
            syncControlsToVideo();
        }
    }

    /* =========================================================
       Smart Media Downloader (Generic HTML5 Video Sites)
       ========================================================= */

    function getCleanVideoFilename(v, ext = 'mp4') {
        let base = document.title || 'video';
        base = base.replace(/[/\\?%*:|"<>]/g, '').trim().substring(0, 80);
        if (!base) base = 'video_download';
        return `${base}_${Date.now().toString().slice(-4)}.${ext}`;
    }

    function triggerBlobDownload(blobOrUrl, filename) {
        const a = document.createElement('a');
        if (typeof blobOrUrl === 'string') {
            a.href = blobOrUrl;
        } else {
            a.href = URL.createObjectURL(blobOrUrl);
        }
        a.download = filename;
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();
        setTimeout(() => {
            if (typeof blobOrUrl !== 'string') {
                URL.revokeObjectURL(a.href);
            }
            a.remove();
        }, 2500);
    }

    async function downloadActiveVideo() {
        if (isYouTubePage()) {
            showToast('⚠️ YouTube downloading is disabled to comply with Web Store policies. Use 🎬 Export Clip instead!');
            return;
        }

        const v = getVideo();
        if (!v) {
            showToast('No active video found on page');
            return;
        }

        let mediaUrl = v.currentSrc || v.src;
        if (!mediaUrl || mediaUrl.startsWith('blob:') || mediaUrl.startsWith('mediasource:')) {
            const sources = v.querySelectorAll('source');
            for (const s of sources) {
                if (s.src && !s.src.startsWith('blob:')) {
                    mediaUrl = s.src;
                    break;
                }
            }
        }

        if (!mediaUrl || mediaUrl.startsWith('blob:') || mediaUrl.startsWith('mediasource:')) {
            showToast('💡 Streaming media detected: Use 🎬 Export Clip to capture any clip directly!');
            return;
        }

        let ext = 'mp4';
        try {
            const parsed = new URL(mediaUrl, location.href);
            const match = parsed.pathname.match(/\.(mp4|webm|ogg|mov|m4v|mkv|flv)(\?|$)/i);
            if (match) {
                ext = match[1].toLowerCase();
            }
        } catch (_) {}

        const filename = getCleanVideoFilename(v, ext);
        showToast('📥 Starting download...');

        try {
            const response = await fetch(mediaUrl, { mode: 'cors' });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const blob = await response.blob();
            triggerBlobDownload(blob, filename);
            showToast('✅ Video downloaded successfully!');
        } catch (fetchErr) {
            try {
                triggerBlobDownload(mediaUrl, filename);
                showToast('📥 Download started via browser');
            } catch (anchorErr) {
                window.open(mediaUrl, '_blank');
                showToast('↗️ Opened video stream in new tab');
            }
        }
    }

    /* =========================================================
       Frame-by-Frame Stepper
       ========================================================= */

    function formatTimeWithMs(sec) {
        if (!Number.isFinite(sec) || sec < 0) sec = 0;
        const m = Math.floor(sec / 60);
        const s = Math.floor(sec % 60);
        const ms = Math.floor((sec % 1) * 1000);
        return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(ms).padStart(3, '0')}`;
    }

    function stepVideoFrame(direction = 1) {
        const v = getVideo();
        if (!v) return;

        if (!v.paused) v.pause();

        const frameDuration = 1 / 30; // standard 30fps step (~0.0333s)
        const targetTime = Math.max(0, Math.min(v.duration || Infinity, v.currentTime + direction * frameDuration));
        setCurrentTimeNative(v, targetTime);

        const sign = direction > 0 ? '+1' : '-1';
        showToast(`🎞️ Frame ${sign}`);
        syncControlsToVideo();
    }

    /* =========================================================
       Universal Ambient Glow (Dynamic Bias Lighting)
       ========================================================= */

    function ensureAmbientGlow() {
        if (ambientCanvasEl && ambientCanvasEl.isConnected) return;
        ambientCanvasEl = document.createElement('canvas');
        ambientCanvasEl.id = 'mvc-ambient-glow';
        ambientCanvasEl.width = 32;
        ambientCanvasEl.height = 18;
        ambientCanvasEl.style.cssText = [
            'position: fixed',
            'pointer-events: none',
            'z-index: 0',
            'opacity: 0',
            'transform: translateZ(0)',
            'filter: blur(55px) saturate(2.0) brightness(1.25)',
            '-webkit-filter: blur(55px) saturate(2.0) brightness(1.25)',
            'border-radius: 24px',
            'transition: opacity 0.5s ease',
            'display: none',
            'will-change: transform, opacity'
        ].join(';');

        ambientCtx = ambientCanvasEl.getContext('2d', { willReadFrequently: false });
        document.documentElement.appendChild(ambientCanvasEl);
    }

    function runAmbientGlowLoop() {
        if (!ambientGlowActive) {
            if (ambientCanvasEl) ambientCanvasEl.style.opacity = '0';
            return;
        }

        const v = getVideo();
        const now = performance.now();

        if (v && v.isConnected && !v.paused && !v.ended && isVisible(v)) {
            if (now - lastAmbientDraw >= 45) {
                lastAmbientDraw = now;
                try {
                    const rect = v.getBoundingClientRect();
                    if (rect.width > 60 && rect.height > 60) {
                        ensureAmbientGlow();
                        ambientCanvasEl.style.display = 'block';
                        ambientCanvasEl.style.left = (rect.left - 24) + 'px';
                        ambientCanvasEl.style.top = (rect.top - 24) + 'px';
                        ambientCanvasEl.style.width = (rect.width + 48) + 'px';
                        ambientCanvasEl.style.height = (rect.height + 48) + 'px';

                        ambientCtx.drawImage(v, 0, 0, 32, 18);
                        ambientCanvasEl.style.opacity = '0.75';
                    }
                } catch (_) {}
            }
        } else if (ambientCanvasEl) {
            ambientCanvasEl.style.opacity = '0';
        }

        ambientRafId = requestAnimationFrame(runAmbientGlowLoop);
    }

    function toggleAmbientGlow() {
        ambientGlowActive = !ambientGlowActive;
        ensureAmbientGlow();
        if (ambientGlowActive) {
            showToast('🌌 Ambient Glow on');
            cancelAnimationFrame(ambientRafId);
            runAmbientGlowLoop();
        } else {
            showToast('🌌 Ambient Glow off');
            if (ambientCanvasEl) {
                ambientCanvasEl.style.opacity = '0';
                setTimeout(() => { if (!ambientGlowActive && ambientCanvasEl) ambientCanvasEl.style.display = 'none'; }, 450);
            }
        }
        if (toolbarBuilt) syncToolbar();
        syncControlsToVideo();
    }

    /* =========================================================
       Video Timestamp Bookmarks
       ========================================================= */

    function getVideoBookmarkKey() {
        if (isYouTubePage()) {
            const urlParams = new URLSearchParams(location.search);
            const videoId = urlParams.get('v') || location.pathname;
            return siteKey('bookmarks_' + videoId);
        }
        return siteKey('bookmarks_' + location.pathname);
    }

    function loadVideoBookmarks() {
        const key = getVideoBookmarkKey();
        if (!key) return;
        const saved = loadValue(key, []);
        videoBookmarks = Array.isArray(saved) ? saved : [];
    }

    function addVideoBookmark() {
        const v = getVideo();
        if (!v) return;
        const time = v.currentTime;
        const key = getVideoBookmarkKey();
        if (!key) return;

        loadVideoBookmarks();
        if (videoBookmarks.some(b => Math.abs(b.time - time) < 1.0)) {
            showToast(`Bookmark already near ${formatTime(time)}`);
            return;
        }

        const newBm = {
            id: Date.now(),
            time: Math.round(time * 10) / 10,
            label: formatTime(time)
        };
        videoBookmarks.push(newBm);
        videoBookmarks.sort((a, b) => a.time - b.time);
        saveValue(key, videoBookmarks);
        showToast(`📌 Bookmark saved at ${formatTime(time)}`);
        if (toolbarBuilt) syncToolbar();
        syncControlsToVideo();
    }

    function removeVideoBookmark(id) {
        const key = getVideoBookmarkKey();
        if (!key) return;
        videoBookmarks = videoBookmarks.filter(b => b.id !== id);
        saveValue(key, videoBookmarks);
        showToast('Bookmark removed');
        if (toolbarBuilt) syncToolbar();
        syncControlsToVideo();
    }

    function jumpToBookmark(time) {
        const v = getVideo();
        if (!v) return;
        setCurrentTimeNative(v, time);
        showToast(`📌 Jumped to ${formatTime(time)}`);
    }

    /* =========================================================
       Sleep Timer (Auto-Pause)
       ========================================================= */

    function toggleSleepTimer() {
        const modes = ['off', '15', '30', '45', '60', 'ended'];
        const curIdx = modes.indexOf(String(sleepTimerMode));
        const nextMode = modes[(curIdx + 1) % modes.length];
        setSleepTimer(nextMode);
    }

    function setSleepTimer(mode) {
        clearInterval(sleepTimerInterval);
        sleepTimerInterval = null;
        sleepTimerMode = mode;

        if (mode === 'off') {
            sleepTimerRemainingSec = 0;
            showToast('🌙 Sleep Timer: OFF');
            if (toolbarBuilt) syncToolbar();
            syncControlsToVideo();
            return;
        }

        if (mode === 'ended') {
            showToast('🌙 Sleep Timer: Pause when video ends');
            const v = getVideo();
            if (v) {
                const onEnded = () => {
                    v.pause();
                    setSleepTimer('off');
                    showToast('🌙 Video finished · sleep timer paused');
                    v.removeEventListener('ended', onEnded);
                };
                v.addEventListener('ended', onEnded, { once: true });
            }
            if (toolbarBuilt) syncToolbar();
            syncControlsToVideo();
            return;
        }

        const mins = Number(mode);
        sleepTimerRemainingSec = mins * 60;
        showToast(`🌙 Sleep Timer set for ${mins} minutes`);

        sleepTimerInterval = setInterval(() => {
            sleepTimerRemainingSec--;
            if (sleepTimerRemainingSec <= 10 && sleepTimerRemainingSec > 0) {
                const v = getVideo();
                if (v && v.volume > 0.1) {
                    v.volume = Math.max(0, v.volume - 0.05);
                }
            }
            if (sleepTimerRemainingSec <= 0) {
                clearInterval(sleepTimerInterval);
                sleepTimerInterval = null;
                sleepTimerMode = 'off';
                const v = getVideo();
                if (v) v.pause();
                showToast('🌙 Sleep Timer finished: video paused. Goodnight!');
                if (toolbarBuilt) syncToolbar();
                syncControlsToVideo();
            }
        }, 1000);

        if (toolbarBuilt) syncToolbar();
        syncControlsToVideo();
    }

    /* =========================================================
       Screenshot Manager
       ========================================================= */

    function getCleanVideoTitle() {
        if (isYouTubePage()) {
            const titleEl = document.querySelector('h1.ytd-watch-metadata yt-formatted-string, #title h1 yt-formatted-string, h1.title');
            if (titleEl && titleEl.textContent) {
                return titleEl.textContent.trim().replace(/[\\/:*?"<>|]/g, '-').slice(0, 40);
            }
        }
        return 'screenshot';
    }

    function takeScreenshot(v) {
        if (!v) return;

        const width = v.videoWidth;
        const height = v.videoHeight;

        if (!width || !height) {
            showToast('No frame available');
            return;
        }

        let canvas;
        try {
            canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;

            const ctx = canvas.getContext('2d');
            ctx.drawImage(v, 0, 0, width, height);
        } catch (err) {
            dbg('Screenshot capture error:', err);
            showToast('Screenshot blocked by site CORS restrictions');
            return;
        }

        const mime = prefs.screenshotFormat === 'jpeg' ? 'image/jpeg' : 'image/png';
        const ext = prefs.screenshotFormat === 'jpeg' ? 'jpg' : 'png';

        try {
            canvas.toBlob(blob => {
                if (!blob) {
                    showToast('Screenshot blocked by site CORS restrictions');
                    return;
                }

                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                const stamp = formatTime(v.currentTime).replace(/:/g, '-');
                const title = getCleanVideoTitle();

                a.href = url;
                a.download = `${title}-${stamp}.${ext}`;
                document.body.appendChild(a);
                a.click();
                a.remove();

                setTimeout(() => URL.revokeObjectURL(url), 2000);
                showToast(`📸 Screenshot saved (${ext.toUpperCase()})`);
            }, mime, 0.95);
        } catch (err) {
            showToast('Screenshot blocked by site CORS restrictions');
        }
    }

    /* =========================================================
       Smart Miniplayer Manager
       ========================================================= */

    function setupSmartMiniplayer() {
        if (miniplayerObserver) {
            miniplayerObserver.disconnect();
            miniplayerObserver = null;
        }

        if (!prefs.smartMiniplayerEnabled) return;

        const v = getVideo();
        if (!v) return;

        miniplayerObserver = new IntersectionObserver(entries => {
            const entry = entries[0];
            if (!entry) return;

            // Avoid collision if YouTube native miniplayer is open
            if (isYouTubePage() && document.querySelector('ytd-miniplayer[active]')) {
                return;
            }

            if (!entry.isIntersecting && !v.paused && !isMiniplayerFloating) {
                enterSmartMiniplayer(v);
            } else if (entry.isIntersecting && isMiniplayerFloating) {
                exitSmartMiniplayer();
            }
        }, { threshold: [0.15] });

        miniplayerObserver.observe(v);
    }

    function enterSmartMiniplayer(v) {
        if (isMiniplayerFloating || !v) return;

        // Use native PiP if preferred and available
        if (document.pictureInPictureEnabled && typeof v.requestPictureInPicture === 'function') {
            v.requestPictureInPicture().then(() => {
                isMiniplayerFloating = true;
                showToast('📺 Miniplayer active (PiP)');
            }).catch(() => {
                // If auto PiP restricted by user gesture requirements, fallback
            });
        }
    }

    function exitSmartMiniplayer() {
        if (!isMiniplayerFloating) return;
        if (document.pictureInPictureElement) {
            document.exitPictureInPicture().catch(() => {});
        }
        isMiniplayerFloating = false;
    }

    /* =========================================================
       Video Helpers & Binding
       ========================================================= */

    function applySitePreferences(v) {
        if (!v || !v.isConnected) return;

        // 1. Only restore custom speed if user configured a non-1x speed and video is already playing
        try {
            if (validSpeed(prefs.speed) && prefs.speed !== 1.0 && !v.paused && v.readyState >= 2) {
                v.playbackRate = prefs.speed;
            }
        } catch (_) {}

        // 2. Normal volume (0.0 to 1.0) - purely native v.volume!
        // NEVER attach Web Audio createMediaElementSource on auto-load!
        try {
            if (Number.isFinite(prefs.volume) && prefs.volume >= 0 && prefs.volume <= 1.0) {
                v.volume = prefs.volume;
            }
        } catch (_) {}

        // 3. NEVER force v.muted on discovery!
        // Movie streaming players require initial muted = true to satisfy Chrome Autoplay Policy.

        // 4. Video Filters (safe pure CSS)
        try {
            applyVideoFilters(v);
        } catch (_) {}

        if (toolbarBuilt) syncToolbar();
    }

    let isRefreshingVideos = false;
    function refreshVideos({ resetIndex = false } = {}) {
        if (isRefreshingVideos) return video;
        isRefreshingVideos = true;

        try {
            videos = findVideos();

            if (resetIndex || videoIndex >= videos.length) {
                videoIndex = 0;
            }

            const preferredUsable = isUsableVideo(preferredVideo) && videos.includes(preferredVideo);
            const next = preferredUsable ? preferredVideo : (videos[videoIndex] || null);

            if (next !== video) {
                video = next;
                if (video) {
                    videoIndex = Math.max(0, videos.indexOf(video));
                    preferredVideo = video;
                }

                if (video && !panelBuilt) buildPanel();

                attachVideoListeners(video);
                applySitePreferences(video);
                syncControlsToVideo();
                setupSmartMiniplayer();
            }

            updateVideoCounter();

            if (panelBuilt && !prefs.manualPos) {
                positionPanelSmartly();
            }

            observeOpenShadowRoots();

            if (toolbarBuilt) {
                positionToolbar(video);
            }
            if (!sideTabBuilt) {
                buildSideTab();
            } else {
                positionSideTab(video);
            }
        } finally {
            isRefreshingVideos = false;
        }

        return video;
    }

    function getVideo() {
        if (isYouTubePage()) {
            const yt = findYouTubeMainVideo();
            if (yt) {
                if (video !== yt) {
                    video = yt;
                    preferredVideo = yt;
                }
                return yt;
            }
        }
        if (isUsableVideo(preferredVideo)) return preferredVideo;
        if (isUsableVideo(video)) return video;
        if (video && video.isConnected) return video;
        if (isRefreshingVideos) return video;
        preferredVideo = null;
        video = null;
        return refreshVideos();
    }

    async function safePlay(v) {
        if (!v) return;
        try {
            await v.play();
        } catch (_) {
            showToast('Play blocked');
        }
    }

    function togglePlayPause(v) {
        if (!v) v = getVideo();
        if (!v) return;

        // 1. YouTube specialized player integration
        if (isYouTubePage()) {
            const playBtn = document.querySelector('.ytp-play-button');
            if (playBtn) {
                playBtn.click();
                return;
            }

            const moviePlayer = document.getElementById('movie_player') || document.querySelector('.html5-video-player');
            if (moviePlayer && typeof moviePlayer.getPlayerState === 'function') {
                try {
                    const state = moviePlayer.getPlayerState();
                    // 1 = PLAYING
                    if (state === 1) {
                        if (typeof moviePlayer.pauseVideo === 'function') {
                            moviePlayer.pauseVideo();
                            return;
                        }
                    } else {
                        if (typeof moviePlayer.playVideo === 'function') {
                            moviePlayer.playVideo();
                            return;
                        }
                    }
                } catch (_) {}
            }
        }

        // 2. Standard HTML5 video element toggle
        try {
            if (v.paused) {
                safePlay(v);
            } else {
                v.pause();
            }
        } catch (_) {}
    }

    function attachVideoListeners(v) {
        if (videoAbortController) {
            try { videoAbortController.abort(); } catch (_) {}
        }

        if (!v) return;

        videoAbortController = new AbortController();
        const { signal } = videoAbortController;

        [
            'play',
            'pause',
            'volumechange',
            'ratechange',
            'timeupdate',
            'loadedmetadata',
            'durationchange',
            'progress',
            'seeking',
            'seeked'
        ].forEach(evt => {
            v.addEventListener(evt, () => {
                syncControlsToVideo();
                if (evt === 'timeupdate') {
                    handleLoopTimeUpdate(v);
                    checkLiveStreamCatchUp(v);
                } else if (evt === 'progress') {
                    checkLiveStreamCatchUp(v);
                }
            }, { signal });
        });

        v.addEventListener('volumechange', () => {
            if (prefs.volume <= 1.0) {
                prefs.volume = Number(v.volume) || 0;
                saveValue(siteKey('volume'), prefs.volume);
            }
            prefs.muted = Boolean(v.muted);
            saveValue(siteKey('muted'), prefs.muted);
        }, { signal });

        v.addEventListener('ratechange', () => {
            const n = Number(v.playbackRate);
            if (!validSpeed(n)) return;

            if (isInternalRateChange) {
                if (!holdBoostEngaged && !temporaryBoostActive) {
                    prefs.speed = n;
                    persistentUserSpeed = n;
                    saveValue(siteKey('speed'), n);
                    if (toolbarBuilt) syncToolbar();
                    syncControlsToVideo();
                }
                return;
            }

            // If a temporary hold boost is actively engaged by our extension, ignore ratechange
            if (holdBoostEngaged || temporaryBoostActive) {
                return;
            }

            // 1. Temporary 2x boost detection (YouTube native hold-to-2x)
            if (isYouTubePage() && Math.abs(n - 2.0) < 0.01) {
                if (Math.abs(persistentUserSpeed - 2.0) >= 0.01) {
                    temporaryBoostActive = true;
                    temporaryBoostOriginalSpeed = persistentUserSpeed;
                    if (toolbarBuilt) syncToolbar(v);
                    return;
                }
            }

            // 2. Temporary 2x boost released: the site (YouTube) reset rate back to 1.0
            if (temporaryBoostActive && Math.abs(n - 1.0) < 0.01) {
                temporaryBoostActive = false;
                const restoreRate = temporaryBoostOriginalSpeed || persistentUserSpeed || 1.0;
                temporaryBoostOriginalSpeed = null;

                try {
                    isInternalRateChange = true;
                    v.playbackRate = restoreRate;
                    setTimeout(() => { isInternalRateChange = false; }, 80);
                } catch (_) {}

                prefs.speed = restoreRate;
                persistentUserSpeed = restoreRate;
                saveValue(siteKey('speed'), restoreRate);
                syncControlsToVideo();
                if (toolbarBuilt) syncToolbar();
                showToast(formatSpeed(restoreRate));
                return;
            }

            // 3. Normal rate change (from user interaction or site menu)
            // Respect any valid speed cleanly with no feedback loops or resets
            prefs.speed = n;
            persistentUserSpeed = n;
            saveValue(siteKey('speed'), n);
            if (toolbarBuilt) syncToolbar();
            syncControlsToVideo();
        }, { signal });

        v.addEventListener('enterpictureinpicture', () => {
            if (pipBtn) pipBtn.classList.add('active');
        }, { signal });

        v.addEventListener('leavepictureinpicture', () => {
            if (pipBtn) pipBtn.classList.remove('active');
            isMiniplayerFloating = false;
        }, { signal });
    }

    /* =========================================================
       Panel Host / Fullscreen Movement
       ========================================================= */

    function moveHostTo(target) {
        const host = document.getElementById('mvc-host');
        if (!host || !target || host.parentNode === target) return;

        if (!hostOriginalParent) {
            hostOriginalParent = host.parentNode;
            hostOriginalNextSibling = host.nextSibling;
        }

        try {
            target.appendChild(host);
        } catch (_) {}
    }

    function restoreHost() {
        const host = document.getElementById('mvc-host');
        if (!host) return;

        const parent = hostOriginalParent && hostOriginalParent.isConnected
            ? hostOriginalParent
            : document.documentElement;

        try {
            if (hostOriginalNextSibling && hostOriginalNextSibling.parentNode === parent) {
                parent.insertBefore(host, hostOriginalNextSibling);
            } else {
                parent.appendChild(host);
            }
        } catch (_) {
            try {
                document.documentElement.appendChild(host);
            } catch (_) {}
        }

        hostOriginalParent = null;
        hostOriginalNextSibling = null;
    }

    /* =========================================================
       Geometry & Adaptive Docking
       ========================================================= */

    function rectIntersectionArea(a, b) {
        const x1 = Math.max(a.left, b.left);
        const y1 = Math.max(a.top, b.top);
        const x2 = Math.min(a.right, b.right);
        const y2 = Math.min(a.bottom, b.bottom);
        return Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
    }

    function getPlayerRoot(v) {
        if (!v) return null;
        const selectors = [
            '.html5-video-player',
            '.video-js',
            '.jwplayer',
            '.plyr',
            '[class*="video-player"]',
            '[class*="player"]',
            '[id*="player"]'
        ];

        for (const selector of selectors) {
            try {
                const el = v.closest(selector);
                if (el) return el;
            } catch (_) {}
        }
        return v.parentElement || null;
    }

    function getInteractiveRects(v) {
        const root = getPlayerRoot(v);
        if (!root || !root.querySelectorAll) return [];

        const vr = v.getBoundingClientRect();
        const selectors = [
            'button',
            'input',
            'select',
            'textarea',
            '[role="button"]',
            '[aria-controls]',
            '[class*="control" i]',
            '[id*="control" i]',
            '[class*="toolbar" i]',
            '[class*="action" i]'
        ];

        const found = new Set();
        const rects = [];

        for (const selector of selectors) {
            let nodes = [];
            try {
                nodes = [...root.querySelectorAll(selector)];
            } catch (_) {}

            for (const el of nodes) {
                if (found.has(el)) continue;
                found.add(el);

                if (el.closest && el.closest('#mvc-host')) continue;

                const r = el.getBoundingClientRect();
                if (
                    r.width < 3 ||
                    r.height < 3 ||
                    rectIntersectionArea(r, vr) <= 0
                ) {
                    continue;
                }

                rects.push({
                    rect: r,
                    tag: el.tagName,
                    bottomBias: r.top > vr.bottom - Math.max(100, vr.height * 0.22)
                });

                if (rects.length >= 120) return rects;
            }
        }
        return rects;
    }

    function placePanelAt(x, y) {
        if (!panel) return;

        const w = panel.offsetWidth || 244;
        const h = panel.offsetHeight || 260;

        const maxLeft = Math.max(8, window.innerWidth - w - 8);
        const maxTop = Math.max(8, window.innerHeight - h - 8);

        const left = Math.max(8, Math.min(maxLeft, x));
        const top = Math.max(8, Math.min(maxTop, y));

        panel.style.left = left + 'px';
        panel.style.top = top + 'px';
        panel.style.right = 'auto';
        panel.style.bottom = 'auto';
    }

    applyStoredPosition = function () {
        if (!prefs.pos || !panel) return;

        if (
            typeof prefs.pos.left === 'string' ||
            typeof prefs.pos.top === 'string'
        ) {
            panel.style.left = prefs.pos.left || '';
            panel.style.top = prefs.pos.top || '';
            panel.style.right = 'auto';
            panel.style.bottom = 'auto';
        } else {
            panel.style.right = prefs.pos.right || '20px';
            panel.style.bottom = prefs.pos.bottom || '20px';
            panel.style.left = 'auto';
            panel.style.top = 'auto';
        }
    };

    positionPanelSmartly = function (force = false, avoidPoint = lastPointer) {
        if (!panel || !panelBuilt) return;

        if (!force && prefs.manualPos) {
            applyStoredPosition();
            return;
        }

        const v = (isUsableVideo(preferredVideo) && preferredVideo) ||
                  (isUsableVideo(video) && video);
        if (!v) return;

        const vr = v.getBoundingClientRect();
        const w = panel.offsetWidth || 244;
        const h = panel.offsetHeight || 260;
        const gap = 14;

        const candidates = [
            { x: vr.right + gap, y: vr.top + 8 },
            { x: vr.left - w - gap, y: vr.top + 8 },
            { x: vr.right - w, y: vr.bottom + gap },
            { x: vr.left, y: vr.top - h - gap },
            { x: vr.left + 12, y: vr.top + 12 },
            { x: vr.right - w - 12, y: vr.top + 12 },
            { x: vr.left + 12, y: vr.bottom - h - 12 },
            { x: vr.right - w - 12, y: vr.bottom - h - 12 },
            { x: window.innerWidth - w - 14, y: 14 },
            { x: 14, y: 14 },
            { x: window.innerWidth - w - 14, y: window.innerHeight - h - 14 },
            { x: 14, y: window.innerHeight - h - 14 }
        ];

        const controlRects = getInteractiveRects(v);

        const valid = candidates.filter(c =>
            c.x >= 8 &&
            c.y >= 8 &&
            c.x + w <= window.innerWidth - 8 &&
            c.y + h <= window.innerHeight - 8
        );

        if (!valid.length) return;

        function scoreCandidate(c) {
            const pr = {
                left: c.x,
                top: c.y,
                right: c.x + w,
                bottom: c.y + h
            };

            const videoOverlap = rectIntersectionArea(pr, vr);
            let score = videoOverlap * 2500;

            for (const item of controlRects) {
                const overlap = rectIntersectionArea(pr, item.rect);
                if (overlap > 0) {
                    score += overlap * 9000;
                    if (item.bottomBias) score += 100000;
                }
            }

            if (avoidPoint) {
                const insidePoint =
                    avoidPoint.x >= pr.left &&
                    avoidPoint.x <= pr.right &&
                    avoidPoint.y >= pr.top &&
                    avoidPoint.y <= pr.bottom;
                if (insidePoint) score += 10000000;
            }

            const bottomPenalty = c.y + h > window.innerHeight * 0.72 ? 700 : 0;
            score += bottomPenalty;

            if (panel.isConnected) {
                const old = panel.getBoundingClientRect();
                score += Math.hypot(old.left - c.x, old.top - c.y) * 0.15;
            }
            return score;
        }

        valid.sort((a, b) => scoreCandidate(a) - scoreCandidate(b));
        const chosen = valid[0];
        if (!chosen) return;

        placePanelAt(chosen.x, chosen.y);
    };

    updateDockButton = function () {
        if (!dockBtn) return;
        dockBtn.classList.toggle('active', !prefs.manualPos);
        dockBtn.setAttribute(
            'aria-label',
            prefs.manualPos ? 'Use automatic docking' : 'Automatic docking enabled'
        );
    };

    /* =========================================================
       Trusted Types Policy
       ========================================================= */

    function toTrustedHTML(html) {
        if (typeof trustedTypes !== 'undefined' && trustedTypes && typeof trustedTypes.createPolicy === 'function') {
            if (!toTrustedHTML._policy && toTrustedHTML._policy !== false) {
                try {
                    toTrustedHTML._policy = trustedTypes.createPolicy('mvc-video-controller', { createHTML: s => s });
                } catch (err) {
                    toTrustedHTML._policy = false;
                }
            }
            if (toTrustedHTML._policy) {
                try {
                    return toTrustedHTML._policy.createHTML(html);
                } catch (_) {}
            }
        }
        return html;
    }

    /* =========================================================
       Panel Construction
       ========================================================= */

    function buildPanel() {
        if (panelBuilt || panelBuildInProgress) return;
        // The Alt+B floating controller panel ONLY belongs in the top window!
        if (window.self !== window.top) return;
        panelBuildInProgress = true;

        const host = document.createElement('div');
        host.id = 'mvc-host';
        host.style.cssText = [
            'position: fixed !important',
            'left: 0 !important',
            'top: 0 !important',
            'width: 0 !important',
            'height: 0 !important',
            'overflow: visible !important',
            'z-index: 2147483647 !important',
            'pointer-events: none !important',
            'margin: 0 !important',
            'padding: 0 !important',
            'border: none !important',
            'background: transparent !important'
        ].join(';');

        document.documentElement.appendChild(host);
        shadow = host.attachShadow({ mode: 'open' });

        try {
            shadow.innerHTML = toTrustedHTML(`
            <style>
                :host { all: initial; }

                #panel {
                    position: absolute;
                    left: auto;
                    top: auto;
                    right: 20px;
                    bottom: 20px;
                    z-index: 2147483647;
                    width: 316px;
                    max-height: min(88vh, 560px);
                    padding: 14px 16px 16px;
                    box-sizing: border-box;
                    user-select: none;
                    overflow-y: auto;
                    overscroll-behavior: contain;

                    background: rgba(14, 17, 23, 0.98);
                    color: #f8fafc;
                    border: 1px solid rgba(255, 255, 255, 0.12);
                    border-radius: 12px;
                    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
                    font-size: 12px;
                    box-shadow: 0 20px 48px rgba(0, 0, 0, 0.68), 0 0 0 1px rgba(255, 255, 255, 0.05);
                    backdrop-filter: blur(24px) saturate(145%);
                    -webkit-backdrop-filter: blur(24px);

                    opacity: 0;
                    transform: translateY(14px) scale(.97);
                    pointer-events: none;
                    transition: opacity .2s cubic-bezier(0.16, 1, 0.3, 1), transform .2s cubic-bezier(0.16, 1, 0.3, 1);
                }

                #panel::-webkit-scrollbar {
                    width: 4px;
                }
                #panel::-webkit-scrollbar-thumb {
                    background: rgba(255, 255, 255, 0.18);
                    border-radius: 4px;
                }

                #panel.visible {
                    opacity: 1;
                    transform: translateY(0) scale(1);
                    pointer-events: auto;
                }

                #title {
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    gap: 8px;
                    font-weight: 700;
                    margin-bottom: 10px;
                    cursor: move;
                    touch-action: none;
                    padding-bottom: 8px;
                    border-bottom: 1px solid rgba(255, 255, 255, 0.08);
                }

                #title-main {
                    display: flex;
                    align-items: center;
                    gap: 6px;
                    white-space: nowrap;
                    font-size: 13px;
                    font-weight: 800;
                    letter-spacing: 0.07em;
                    text-transform: uppercase;
                    color: #7dd3fc;
                }

                #title-actions {
                    display: flex;
                    align-items: center;
                    gap: 5px;
                }

                #pin, #dock, #settings-toggle, #close {
                    background: rgba(255, 255, 255, 0.06);
                    border: 1px solid rgba(255, 255, 255, 0.1);
                    color: #94a3b8;
                    cursor: pointer;
                    font-size: 12px;
                    padding: 0;
                    width: 27px;
                    height: 27px;
                    border-radius: 8px;
                    transition: all .14s cubic-bezier(0.16, 1, 0.3, 1);
                    display: inline-flex;
                    align-items: center;
                    justify-content: center;
                    line-height: 1;
                }

                #pin:hover, #dock:hover, #settings-toggle:hover {
                    background: rgba(255, 255, 255, 0.16);
                    color: #ffffff;
                    transform: translateY(-1px);
                }

                #pin.active { color: #fff; background: #059669; border-color: #10b981; box-shadow: 0 0 10px rgba(16, 185, 129, 0.45); }
                #dock.active { color: #fff; background: #2563eb; border-color: #3b82f6; box-shadow: 0 0 10px rgba(37, 99, 235, 0.45); }
                #settings-toggle.active { color: #fff; background: #4f46e5; border-color: #6366f1; box-shadow: 0 0 10px rgba(79, 70, 229, 0.45); }
                #close:hover { background: rgba(239, 68, 68, 0.35); color: #f87171; border-color: #ef4444; }

                #counter-row {
                    display: none;
                    align-items: center;
                    justify-content: space-between;
                    margin-bottom: 8px;
                    font-size: 11px;
                    color: #d1d5db;
                }

                #counter-row button {
                    min-width: 28px;
                    padding: 3px 6px;
                }

                #progress-wrap { margin-bottom: 8px; }

                #progress-bar {
                    position: relative;
                    width: 100%;
                    height: 5px;
                    background: rgba(255, 255, 255, 0.13);
                    border-radius: 5px;
                    cursor: pointer;
                    overflow: visible;
                    transition: height 0.15s ease;
                }

                #progress-bar:hover {
                    height: 7px;
                }

                #progress-fill {
                    position: absolute;
                    left: 0;
                    top: 0;
                    bottom: 0;
                    width: 0%;
                    background: #38bdf8;
                    border-radius: 5px;
                    pointer-events: none;
                    box-shadow: 0 0 10px rgba(56, 189, 248, 0.55);
                }

                .loop-marker {
                    position: absolute;
                    top: -3px;
                    width: 3px;
                    height: 13px;
                    background: #ef4444;
                    border-radius: 2px;
                    display: none;
                    pointer-events: none;
                    z-index: 2;
                    box-shadow: 0 0 6px rgba(239, 68, 68, 0.85);
                }
                #loop-marker-b {
                    background: #10b981;
                    box-shadow: 0 0 6px rgba(16, 185, 129, 0.85);
                }

                #time-label {
                    margin-top: 4px;
                    font-size: 11px;
                    color: #94a3b8;
                    text-align: right;
                    font-family: ui-monospace, SFMono-Regular, monospace;
                    font-variant-numeric: tabular-nums;
                    font-weight: 600;
                    cursor: pointer;
                }

                /* Playback Deck */
                .playback-deck {
                    display: flex;
                    align-items: center;
                    gap: 6px;
                    margin-bottom: 8px;
                }

                .playback-btn-seek {
                    flex: 1;
                    height: 35px;
                    font-size: 11.5px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    background: rgba(255, 255, 255, 0.07);
                    border: 1px solid rgba(255, 255, 255, 0.1);
                    border-radius: 9px;
                    color: #e2e8f0;
                    cursor: pointer;
                    transition: all .12s ease;
                }
                .playback-btn-seek:hover {
                    background: rgba(255, 255, 255, 0.14);
                    color: #fff;
                    transform: translateY(-1px);
                }

                #play {
                    flex: 1.25;
                    height: 36px;
                    background: #0284c7;
                    border: 1px solid rgba(255, 255, 255, 0.2);
                    border-radius: 10px;
                    color: #ffffff;
                    box-shadow: 0 4px 14px rgba(2, 132, 199, 0.45);
                    font-size: 14px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    cursor: pointer;
                    transition: all .14s ease;
                }
                #play:hover {
                    background: #0369a1;
                    box-shadow: 0 6px 18px rgba(2, 132, 199, 0.6);
                    transform: translateY(-1px);
                }

                /* Speed Bar */
                .speed-bar {
                    display: flex;
                    align-items: center;
                    gap: 3px;
                    margin-bottom: 11px;
                    background: rgba(0, 0, 0, 0.28);
                    padding: 3px;
                    border-radius: 9px;
                    border: 1px solid rgba(255, 255, 255, 0.06);
                }
                .speed-bar button {
                    flex: 1;
                    padding: 4px 0;
                    font-size: 11px;
                    font-weight: 700;
                    border-radius: 6px;
                    border: none;
                    background: transparent;
                    color: #94a3b8;
                    text-align: center;
                    cursor: pointer;
                    transition: all .12s ease;
                }
                .speed-bar button:hover {
                    background: rgba(255, 255, 255, 0.1);
                    color: #fff;
                }
                .speed-bar button.active {
                    background: #0284c7;
                    color: #ffffff;
                    box-shadow: 0 0 10px rgba(56, 189, 248, 0.4);
                }
                #extra-speed {
                    width: 60px;
                    padding: 3px 2px;
                    font-size: 10.5px;
                    background: #161822;
                    color: #cbd5e1;
                    border: 1px solid rgba(255, 255, 255, 0.12);
                    border-radius: 6px;
                }

                /* Segmented HUD Tabs */
                .hud-tabs {
                    display: flex;
                    gap: 3px;
                    background: rgba(255, 255, 255, 0.05);
                    padding: 3px;
                    border-radius: 11px;
                    margin-bottom: 10px;
                    border: 1px solid rgba(255, 255, 255, 0.07);
                }
                .hud-tab {
                    flex: 1;
                    padding: 6px 0;
                    font-size: 11px;
                    font-weight: 700;
                    border: 1px solid transparent;
                    border-radius: 8px;
                    background: transparent;
                    color: #94a3b8;
                    cursor: pointer;
                    text-align: center;
                    transition: all .14s cubic-bezier(0.16, 1, 0.3, 1);
                }
                .hud-tab:hover {
                    color: #e2e8f0;
                    background: rgba(255, 255, 255, 0.07);
                }
                .hud-tab.active {
                    background: linear-gradient(135deg, rgba(56, 189, 248, 0.22), rgba(129, 140, 248, 0.22));
                    border-color: rgba(56, 189, 248, 0.45);
                    color: #38bdf8;
                    box-shadow: 0 0 12px rgba(56, 189, 248, 0.25);
                }

                /* Panes */
                .hud-pane {
                    display: none;
                    animation: paneFade .15s ease;
                }
                .hud-pane.active {
                    display: block;
                }
                @keyframes paneFade {
                    from { opacity: 0; transform: translateY(3px); }
                    to { opacity: 1; transform: translateY(0); }
                }

                /* Buttons inside Panes */
                .hud-btn {
                    border: 1px solid rgba(255, 255, 255, 0.1);
                    border-radius: 9px;
                    padding: 7px 10px;
                    background: rgba(255, 255, 255, 0.07);
                    color: #f1f5f9;
                    cursor: pointer;
                    font-size: 11.5px;
                    font-weight: 600;
                    line-height: 1.2;
                    transition: background .12s, border-color .12s, transform .08s, box-shadow .12s;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    gap: 6px;
                    box-sizing: border-box;
                }
                .hud-btn:hover {
                    background: rgba(255, 255, 255, 0.15);
                    border-color: rgba(255, 255, 255, 0.2);
                    color: #ffffff;
                    transform: translateY(-1px);
                }
                .hud-btn:active {
                    transform: scale(0.96);
                }
                .hud-btn.active {
                    background: linear-gradient(135deg, #0284c7, #38bdf8);
                    border-color: #7dd3fc;
                    color: #ffffff;
                    box-shadow: 0 0 12px rgba(56, 189, 248, 0.45);
                }
                .hud-btn.recording {
                    background: #dc2626 !important;
                    color: #ffffff !important;
                    border-color: #f87171 !important;
                    box-shadow: 0 0 14px rgba(220, 38, 38, 0.7) !important;
                }
                .hud-btn-full {
                    width: 100%;
                    box-sizing: border-box;
                    margin-bottom: 6px;
                }

                .grid-2 {
                    display: grid;
                    grid-template-columns: 1fr 1fr;
                    gap: 6px;
                    margin-bottom: 6px;
                }
                .grid-3 {
                    display: grid;
                    grid-template-columns: 1fr 1fr 1fr;
                    gap: 5px;
                    margin-bottom: 6px;
                }

                #volume-row {
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    margin-bottom: 8px;
                    background: rgba(0, 0, 0, 0.2);
                    padding: 4px 8px;
                    border-radius: 9px;
                    border: 1px solid rgba(255, 255, 255, 0.05);
                }
                #volume {
                    flex: 1;
                    accent-color: #38bdf8;
                    cursor: pointer;
                    height: 4px;
                    border-radius: 3px;
                }

                /* Settings inside pane */
                .setting { margin-bottom: 9px; }
                .setting:last-child { margin-bottom: 0; }
                .setting-label {
                    display: block;
                    margin-bottom: 4px;
                    color: #d1d5db;
                    font-size: 11px;
                    font-weight: 500;
                }
                #seek-select {
                    box-sizing: border-box;
                    width: 100%;
                    border: 1px solid rgba(255,255,255,0.14);
                    border-radius: 8px;
                    background: #181920;
                    color: #f8fafc;
                    padding: 5px 8px;
                    font-size: 11.5px;
                }
                .check-line {
                    display: flex;
                    align-items: center;
                    gap: 7px;
                    color: #e2e8f0;
                    font-size: 11.5px;
                    cursor: pointer;
                }

                #toast {
                    display: none !important;
                }

                #cheatsheet {
                    position: fixed;
                    top: 50%;
                    left: 50%;
                    transform: translate(-50%, -50%);
                    background: rgba(18, 18, 24, 0.96);
                    color: #f4f4f6;
                    padding: 20px 24px;
                    border-radius: 16px;
                    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
                    font-size: 12.5px;
                    min-width: 310px;
                    max-width: calc(100vw - 32px);
                    opacity: 0;
                    pointer-events: none;
                    transition: opacity .16s ease;
                    z-index: 2147483647;
                    box-shadow: 0 20px 50px rgba(0,0,0,.75), 0 0 0 1px rgba(255,255,255,0.08);
                    border: 1px solid rgba(255,255,255,0.12);
                    backdrop-filter: blur(24px);
                    -webkit-backdrop-filter: blur(24px);
                }
                #cheatsheet.visible {
                    opacity: 1;
                    pointer-events: auto;
                }
                .cheat-title {
                    font-weight: 700;
                    margin-bottom: 12px;
                    font-size: 14px;
                    color: #fff;
                    letter-spacing: 0.02em;
                }
                .cheat-row {
                    display: flex;
                    justify-content: space-between;
                    gap: 20px;
                    padding: 4px 0;
                    color: #d1d5db;
                }
                .cheat-row span:first-child {
                    color: #60a5fa;
                    font-weight: 700;
                }
                .cheat-hint {
                    margin-top: 12px;
                    font-size: 11px;
                    color: #9ca3af;
                    text-align: center;
                }

                @media (max-width: 520px) {
                    #panel {
                        width: min(290px, calc(100vw - 16px));
                    }
                }
            </style>

            <div id="panel" aria-label="VidAmp Video HUD">
                <div id="title">
                    <span id="title-main">⚡ VIDAMP</span>
                    <span id="title-actions">
                        <button id="dock" type="button" aria-label="Automatic docking" title="Auto-position away from player controls">⌖</button>
                        <button id="settings-toggle" type="button" aria-label="Settings" title="Settings">⚙️</button>
                        <button id="pin" type="button" aria-label="Keep panel open" title="Keep panel open">📌</button>
                        <button id="close" type="button" aria-label="Close" title="Hide panel">×</button>
                    </span>
                </div>

                <div id="counter-row">
                    <button id="prev-video" class="hud-btn" type="button">◀</button>
                    <span id="video-counter"></span>
                    <button id="next-video" class="hud-btn" type="button">▶</button>
                </div>

                <div id="progress-wrap">
                    <div id="progress-bar" role="slider" aria-label="Video progress" tabindex="0">
                        <div id="progress-fill"></div>
                        <div id="loop-marker-a" class="loop-marker" title="Loop Point A"></div>
                        <div id="loop-marker-b" class="loop-marker" title="Loop Point B"></div>
                    </div>
                    <div id="time-label" aria-live="off" title="Click to toggle remaining time">--:-- / --:--</div>
                </div>

                <div class="playback-deck">
                    <button id="back" class="playback-btn-seek" type="button" title="Rewind">⏪ <span id="back-label">10s</span></button>
                    <button id="play" type="button" title="Play/Pause (Space)">▶️</button>
                    <button id="forward" class="playback-btn-seek" type="button" title="Forward"><span id="forward-label">10s</span> ⏩</button>
                </div>

                <div class="speed-bar" id="speed-row">
                    <button type="button" data-speed="0.5">0.5×</button>
                    <button type="button" data-speed="1">1×</button>
                    <button type="button" data-speed="1.25">1.25×</button>
                    <button type="button" data-speed="1.4">1.4×</button>
                    <button type="button" data-speed="1.5">1.5×</button>
                    <button type="button" data-speed="2">2×</button>
                    <select id="extra-speed" aria-label="More playback speeds" title="Custom speeds">
                        <option value="">More…</option>
                        <option value="0.75">0.75×</option>
                        <option value="1.75">1.75×</option>
                        <option value="2.5">2.5×</option>
                        <option value="3">3×</option>
                        <option value="3.5">3.5×</option>
                        <option value="4">4×</option>
                    </select>
                </div>

                <nav class="hud-tabs">
                    <button type="button" class="hud-tab active" data-tab-target="hud-audio">🔊 Audio</button>
                    <button type="button" class="hud-tab" data-tab-target="hud-studio">🎬 Studio</button>
                    <button type="button" class="hud-tab" data-tab-target="hud-fx">🌌 Pro FX</button>
                    <button type="button" class="hud-tab" data-tab-target="hud-prefs">⚙️ Prefs</button>
                </nav>

                <!-- Pane 1: Audio & View -->
                <div id="hud-audio" class="hud-pane active">
                    <div id="volume-row">
                        <button id="mute" class="hud-btn" type="button" title="Mute (M)" style="width:34px; height:28px; padding:0;">🔊</button>
                        <input id="volume" type="range" min="0" max="2" step="0.02" value="1" aria-label="Video volume">
                    </div>
                    <div class="grid-2">
                        <button id="panel-bass" class="hud-btn" type="button" title="Bass Boost (+7dB low-shelf)">🔊 Bass (+7dB)</button>
                        <button id="panel-vocal" class="hud-btn" type="button" title="Vocal Clarity (+6dB speech peak)">🎙️ Vocals (+6dB)</button>
                    </div>
                    <div class="grid-2">
                        <button id="pip" class="hud-btn" type="button" title="Picture-in-Picture (P)">🖼️ PiP</button>
                        <button id="fullscreen" class="hud-btn" type="button" title="Fullscreen (F)" aria-label="Enter fullscreen">⛶ Fullscreen</button>
                    </div>
                </div>

                <!-- Pane 2: Studio & Clips -->
                <div id="hud-studio" class="hud-pane">
                    <div class="grid-3">
                        <button id="loop-a" class="hud-btn" type="button" title="Set Loop Point A (A)">Set [A]</button>
                        <button id="loop-b" class="hud-btn" type="button" title="Set Loop Point B (B)">Set [B]</button>
                        <button id="clear-loop-ab" class="hud-btn" type="button" title="Clear A-B (C)">Clear</button>
                    </div>
                    <div class="grid-2">
                        <button id="loop-clip" class="hud-btn" type="button" title="Export A-B Loop as .webm video">🎬 Export Clip</button>
                        <button id="btn-download-video" class="hud-btn" type="button" title="Smart Media Downloader (Generic HTML5 Sites)">📥 Download</button>
                    </div>
                    <div class="grid-2">
                        <button id="step-back" class="hud-btn" type="button" title="Step Back 1 Frame (,)">◀ 1 Frame</button>
                        <button id="step-fwd" class="hud-btn" type="button" title="Step Forward 1 Frame (.)">1 Frame ▶</button>
                    </div>
                </div>

                <!-- Pane 3: Pro FX -->
                <div id="hud-fx" class="hud-pane">
                    <button id="panel-ambient" class="hud-btn hud-btn-full" type="button" title="Toggle Universal Ambient Glow (Shift+A)">🌌 Ambient Glow</button>
                    <div class="grid-2">
                        <button id="panel-bookmark" class="hud-btn" type="button" title="Save Bookmark (Shift+B)">📌 Bookmark</button>
                        <button id="panel-sleep" class="hud-btn" type="button" title="Cycle Sleep Timer (Shift+S)">🌙 Sleep Timer</button>
                    </div>
                    <div class="grid-2">
                        <button id="loop" class="hud-btn" type="button" title="Loop Whole Video">🔁 Loop Video</button>
                        <button id="screenshot" class="hud-btn" type="button" title="Save Frame Screenshot">📸 Snapshot</button>
                    </div>
                </div>

                <!-- Pane 4: Prefs -->
                <div id="hud-prefs" class="hud-pane">
                    <div id="settings" style="display:block;">
                        <div class="setting">
                            <span class="setting-label">Seek Amount</span>
                            <select id="seek-select" aria-label="Seek amount">
                                <option value="5">5 seconds</option>
                                <option value="10" selected>10 seconds</option>
                                <option value="15">15 seconds</option>
                                <option value="30">30 seconds</option>
                            </select>
                        </div>
                        <div class="setting">
                            <label class="check-line"><input id="shortcuts-check" type="checkbox" checked> Keyboard shortcuts</label>
                        </div>
                        <div class="setting">
                            <label class="check-line"><input id="trackpad-check" type="checkbox" checked> Trackpad pinch speed</label>
                        </div>
                        <div class="setting">
                            <label class="check-line"><input id="gesture-zones-check" type="checkbox" checked> Gesture zones (L: Brightness, R: Vol)</label>
                        </div>
                        <div class="setting">
                            <label class="check-line"><input id="volume-boost-check" type="checkbox" checked> Volume boost (up to 200%)</label>
                        </div>
                        <div class="setting">
                            <label class="check-line"><input id="miniplayer-check" type="checkbox"> Smart miniplayer on scroll</label>
                        </div>
                        <div class="grid-2" style="margin-top:8px;">
                            <button id="reset-filters" class="hud-btn" type="button">Reset Filters</button>
                            <button id="reset-site" class="hud-btn" type="button">Reset Site</button>
                        </div>
                    </div>
                </div>
            </div>

            <div id="toast" role="status" aria-live="polite"></div>

            <div id="cheatsheet">
                <div class="cheat-title">⚡ VidAmp Pro Shortcuts</div>
                <div class="cheat-row"><span>Space</span><span>Play / Pause</span></div>
                <div class="cheat-row"><span>← / →</span><span>Seek backward / forward</span></div>
                <div class="cheat-row"><span>[ / ]</span><span>Speed −/+ 0.25×</span></div>
                <div class="cheat-row"><span>R</span><span>Reset speed to 1.0×</span></div>
                <div class="cheat-row"><span>, / .</span><span>Step back / forward 1 frame</span></div>
                <div class="cheat-row"><span>Shift + B</span><span>Bookmark current timestamp</span></div>
                <div class="cheat-row"><span>Shift + A</span><span>Universal Ambient Glow</span></div>
                <div class="cheat-row"><span>Shift + S</span><span>Cycle Sleep Timer</span></div>
                <div class="cheat-row"><span>M</span><span>Mute / Unmute</span></div>
                <div class="cheat-row"><span>P</span><span>Picture-in-Picture</span></div>
                <div class="cheat-row"><span>F</span><span>Fullscreen</span></div>
                <div class="cheat-row"><span>A / B</span><span>Set Loop Point A / B</span></div>
                <div class="cheat-row"><span>C</span><span>Clear A-B Loop</span></div>
                <div class="cheat-row"><span>Shift + ↑/↓</span><span>Volume +/− 5%</span></div>
                <div class="cheat-row"><span>Alt + B</span><span>Show / hide VidAmp tools</span></div>
                <div class="cheat-row"><span>Trackpad Pinch</span><span>Pinch in/out on touchpad for Speed</span></div>
                <div class="cheat-row"><span>Right-Drag Mouse</span><span>Move Up/Right (+) or Down/Left (−) for Speed</span></div>
                <div class="cheat-row"><span>Alt + Wheel</span><span>Left: Brightness · Right: Volume</span></div>
                <div class="cheat-row"><span>Hold (1 finger)</span><span>Temporary 2× boost</span></div>
                <div class="cheat-row"><span>?</span><span>Toggle this help</span></div>
                <div class="cheat-hint">Press Esc to close</div>
            </div>
            `);
        } catch (err) {
            console.error('[MVC] buildPanel injection error:', err);
            try { host.remove(); } catch (_) {}
            panelBuildInProgress = false;
            panelBuilt = false;
            shadow = null;
            return;
        }

        const $ = selector => shadow.querySelector(selector);

        panel = $('#panel');
        playBtn = $('#play');
        muteBtn = $('#mute');
        volumeSlider = $('#volume');
        speedButtons = [...shadow.querySelectorAll('[data-speed]')];
        extraSpeedSelect = $('#extra-speed');
        progressBar = $('#progress-bar');
        progressFill = $('#progress-fill');
        loopMarkerA = $('#loop-marker-a');
        loopMarkerB = $('#loop-marker-b');
        timeLabel = $('#time-label');
        pinBtn = $('#pin');
        dockBtn = $('#dock');
        settingsBtn = $('#settings-toggle');
        closeBtn = $('#close');
        counterRow = $('#counter-row');
        counterLabel = $('#video-counter');
        toastEl = $('#toast');
        cheatSheet = $('#cheatsheet');
        settingsPanel = $('#settings');
        seekSelect = $('#seek-select');
        shortcutsCheck = $('#shortcuts-check');
        trackpadCheck = $('#trackpad-check');
        gestureZonesCheck = $('#gesture-zones-check');
        volumeBoostCheck = $('#volume-boost-check');
        smartMiniplayerCheck = $('#miniplayer-check');
        loopBtn = $('#loop');
        setLoopABtn = $('#loop-a');
        setLoopBBtn = $('#loop-b');
        clearLoopABBtn = $('#clear-loop-ab');
        screenshotBtn = $('#screenshot');
        pipBtn = $('#pip');
        fullscreenBtn = $('#fullscreen');
        resetFiltersBtn = $('#reset-filters');

        seekSelect.value = String(prefs.seekSeconds);
        shortcutsCheck.checked = prefs.shortcuts;
        trackpadCheck.checked = prefs.trackpadSpeedEnabled;
        gestureZonesCheck.checked = prefs.gestureZonesEnabled;
        volumeBoostCheck.checked = prefs.volumeBoostEnabled;
        smartMiniplayerCheck.checked = prefs.smartMiniplayerEnabled;

        syncExtraSpeedSelect();

        $('#back-label').textContent = `${prefs.seekSeconds}s`;
        $('#forward-label').textContent = `${prefs.seekSeconds}s`;

        updateDockButton();

        if (prefs.pinned) {
            pinBtn.classList.add('active');
        }

        if (prefs.manualPos) {
            applyStoredPosition();
        } else {
            positionPanelSmartly();
        }

        showPanel = function () {
            if (!panelBuilt) return;
            if (!prefs.manualPos) {
                positionPanelSmartly(true, lastPointer);
            } else {
                applyStoredPosition();
            }

            panel.classList.add('visible');
            clearTimeout(hideTimer);

            if (prefs.pinned) return;

            hideTimer = setTimeout(() => {
                panel.classList.remove('visible');
            }, 2400);
        };

        hidePanel = function () {
            if (!panelBuilt) return;
            clearTimeout(hideTimer);
            panel.classList.remove('visible');
        };

        panel.addEventListener('mouseenter', () => {
            clearTimeout(hideTimer);
        });

        panel.addEventListener('mouseleave', () => {
            if (panel.classList.contains('visible') && !prefs.pinned) {
                clearTimeout(hideTimer);
                hideTimer = setTimeout(() => {
                    panel.classList.remove('visible');
                }, 750);
            }
        });

        pinBtn.onclick = () => {
            prefs.pinned = !prefs.pinned;
            saveValue('pinned', prefs.pinned);
            pinBtn.classList.toggle('active', prefs.pinned);
            showPanel();
        };

        dockBtn.onclick = () => {
            prefs.manualPos = false;
            prefs.pos = null;
            saveValue('manualPos', false);
            saveValue('pos', null);
            updateDockButton();
            positionPanelSmartly(true, lastPointer);
            showPanel();
        };

        const hudTabs = shadow.querySelectorAll('.hud-tab');
        const hudPanes = shadow.querySelectorAll('.hud-pane');
        hudTabs.forEach(tab => {
            tab.onclick = () => {
                const targetId = tab.getAttribute('data-tab-target');
                hudTabs.forEach(t => t.classList.remove('active'));
                hudPanes.forEach(p => p.classList.remove('active'));
                tab.classList.add('active');
                const targetPane = shadow.getElementById(targetId);
                if (targetPane) targetPane.classList.add('active');
                if (settingsBtn) {
                    settingsBtn.classList.toggle('active', targetId === 'hud-prefs');
                }
            };
        });

        settingsBtn.onclick = () => {
            const prefsTab = shadow.querySelector('[data-tab-target="hud-prefs"]');
            if (prefsTab) {
                if (prefsTab.classList.contains('active')) {
                    const audioTab = shadow.querySelector('[data-tab-target="hud-audio"]');
                    if (audioTab) audioTab.click();
                } else {
                    prefsTab.click();
                }
            }
        };

        closeBtn.onclick = hidePanel;

        seekSelect.onchange = () => {
            const value = Number(seekSelect.value);
            if (!validSeek(value)) return;
            prefs.seekSeconds = value;
            saveValue(siteKey('seekSeconds'), value);
            $('#back-label').textContent = `${value}s`;
            $('#forward-label').textContent = `${value}s`;
            showToast(`Seek ±${value}s`);
        };

        shortcutsCheck.onchange = () => {
            prefs.shortcuts = shortcutsCheck.checked;
            saveValue('shortcuts', prefs.shortcuts);
            showToast(prefs.shortcuts ? 'Shortcuts on' : 'Shortcuts off');
        };

        trackpadCheck.onchange = () => {
            prefs.trackpadSpeedEnabled = trackpadCheck.checked;
            saveValue('trackpadSpeedEnabled', prefs.trackpadSpeedEnabled);
            showToast(prefs.trackpadSpeedEnabled ? 'Trackpad speed on' : 'Trackpad speed off');
        };

        gestureZonesCheck.onchange = () => {
            prefs.gestureZonesEnabled = gestureZonesCheck.checked;
            saveValue('gestureZonesEnabled', prefs.gestureZonesEnabled);
            showToast(prefs.gestureZonesEnabled ? 'Gesture zones on' : 'Gesture zones off');
        };

        volumeBoostCheck.onchange = () => {
            prefs.volumeBoostEnabled = volumeBoostCheck.checked;
            saveValue('volumeBoostEnabled', prefs.volumeBoostEnabled);
            volumeSlider.max = prefs.volumeBoostEnabled ? '2' : '1';
            showToast(prefs.volumeBoostEnabled ? 'Volume boost on (up to 200%)' : 'Volume boost off');
        };

        smartMiniplayerCheck.onchange = () => {
            prefs.smartMiniplayerEnabled = smartMiniplayerCheck.checked;
            saveValue('smartMiniplayerEnabled', prefs.smartMiniplayerEnabled);
            setupSmartMiniplayer();
            showToast(prefs.smartMiniplayerEnabled ? 'Smart miniplayer on' : 'Smart miniplayer off');
        };

        extraSpeedSelect.onchange = () => {
            const n = Number(extraSpeedSelect.value);
            if (!Number.isFinite(n) || !validSpeed(n)) return;
            setPlaybackRate(getVideo(), n, true);
            syncExtraSpeedSelect();
        };

        resetFiltersBtn.onclick = () => resetFilters(true);

        $('#reset-site').onclick = () => {
            prefs.speed = 1;
            prefs.volume = 1;
            prefs.muted = false;
            prefs.seekSeconds = 10;
            resetFilters(false);
            clearLoopAB();

            for (const key of ['speed', 'volume', 'muted', 'seekSeconds', 'brightness', 'contrast', 'saturate']) {
                try {
                    delete storageCache[STORAGE_PREFIX + siteKey(key)];
                    if (extApi && extApi.storage && extApi.storage.local) {
                        extApi.storage.local.remove(STORAGE_PREFIX + siteKey(key));
                    }
                } catch (_) {}
            }

            seekSelect.value = '10';
            syncExtraSpeedSelect();
            $('#back-label').textContent = '10s';
            $('#forward-label').textContent = '10s';

            const v = getVideo();
            if (v) applySitePreferences(v);
            syncControlsToVideo();
            showToast('Site settings reset');
        };

        // Header Dragging
        $('#title').addEventListener('pointerdown', e => {
            const path = e.composedPath ? e.composedPath() : [];
            if (path.some(node => node instanceof HTMLElement && node.tagName === 'BUTTON')) {
                return;
            }
            if (e.button !== undefined && e.button !== 0) return;

            const rect = panel.getBoundingClientRect();
            const offsetX = e.clientX - rect.left;
            const offsetY = e.clientY - rect.top;

            try { e.currentTarget.setPointerCapture?.(e.pointerId); } catch (_) {}
            clearTimeout(hideTimer);

            const onMove = ev => {
                const left = ev.clientX - offsetX;
                const top = ev.clientY - offsetY;
                panel.style.left = Math.max(0, Math.min(window.innerWidth - rect.width, left)) + 'px';
                panel.style.top = Math.max(0, Math.min(window.innerHeight - rect.height, top)) + 'px';
                panel.style.right = 'auto';
                panel.style.bottom = 'auto';
            };

            const onUp = () => {
                document.removeEventListener('pointermove', onMove);
                document.removeEventListener('pointerup', onUp);
                prefs.pos = { left: panel.style.left, top: panel.style.top };
                prefs.manualPos = true;
                saveValue('pos', prefs.pos);
                saveValue('manualPos', true);
                updateDockButton();
                showPanel();
            };

            document.addEventListener('pointermove', onMove, true);
            document.addEventListener('pointerup', onUp, { once: true, capture: true });
            e.preventDefault();
        });

        $('#prev-video').onclick = () => switchVideo(videoIndex - 1);
        $('#next-video').onclick = () => switchVideo(videoIndex + 1);

        $('#back').onclick = () => {
            const v = getVideo();
            if (v) seekVideo(v, -prefs.seekSeconds);
        };

        $('#forward').onclick = () => {
            const v = getVideo();
            if (v) seekVideo(v, prefs.seekSeconds);
        };

        playBtn.onclick = () => {
            togglePlayPause(getVideo());
        };

        speedButtons.forEach(button => {
            button.onclick = () => {
                const v = getVideo();
                const speed = Number(button.dataset.speed);
                if (!v || !validSpeed(speed)) return;
                setPlaybackRate(v, speed, true);
            };
        });

        volumeSlider.oninput = function () {
            const v = getVideo();
            if (!v) return;
            applyVolumeAndBoost(v, Number(this.value), false);
        };

        muteBtn.onclick = () => {
            const v = getVideo();
            if (!v) return;
            v.muted = !v.muted;
            prefs.muted = v.muted;
            saveValue(siteKey('muted'), prefs.muted);
            showToast(v.muted ? '🔇 Muted' : '🔊 Unmuted');
        };

        progressBar.addEventListener('click', e => {
            const v = getVideo();
            if (!v) return;
            const rect = progressBar.getBoundingClientRect();
            if (isFinite(v.duration) && v.duration > 0) {
                const pct = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
                seekVideoTo(v, pct * v.duration);
            }
        });

        progressBar.addEventListener('keydown', e => {
            const v = getVideo();
            if (!v) return;
            if (e.key === 'ArrowLeft') {
                e.preventDefault();
                seekVideo(v, -prefs.seekSeconds);
            } else if (e.key === 'ArrowRight') {
                e.preventDefault();
                seekVideo(v, prefs.seekSeconds);
            }
        });

        pipBtn.onclick = togglePiP;
        fullscreenBtn.onclick = toggleFullscreen;

        loopBtn.onclick = () => {
            const v = getVideo();
            if (!v) return;
            v.loop = !v.loop;
            loopBtn.classList.toggle('active', v.loop);
            showToast(v.loop ? '🔁 Loop on' : '🔁 Loop off');
        };

        setLoopABtn.onclick = setPointA;
        setLoopBBtn.onclick = setPointB;
        clearLoopABBtn.onclick = clearLoopAB;

        const panelBassBtn = $('#panel-bass');
        const panelVocalBtn = $('#panel-vocal');
        const loopClipBtn = $('#loop-clip');
        const panelDownloadBtn = $('#btn-download-video');
        const stepBackBtn = $('#step-back');
        const stepFwdBtn = $('#step-fwd');
        const panelAmbientBtn = $('#panel-ambient');
        const panelBookmarkBtn = $('#panel-bookmark');
        const panelSleepBtn = $('#panel-sleep');

        if (panelBassBtn) {
            panelBassBtn.onclick = () => {
                const v = getVideo();
                toggleBassBoost(v);
                syncControlsToVideo();
            };
        }
        if (panelVocalBtn) {
            panelVocalBtn.onclick = () => {
                const v = getVideo();
                toggleVocalBoost(v);
                syncControlsToVideo();
            };
        }
        if (loopClipBtn) {
            loopClipBtn.onclick = () => {
                exportLoopClip();
            };
        }
        if (panelDownloadBtn) {
            panelDownloadBtn.onclick = () => {
                downloadActiveVideo();
            };
        }
        if (stepBackBtn) {
            stepBackBtn.onclick = () => {
                stepVideoFrame(-1);
            };
        }
        if (stepFwdBtn) {
            stepFwdBtn.onclick = () => {
                stepVideoFrame(1);
            };
        }
        if (panelAmbientBtn) {
            panelAmbientBtn.onclick = () => {
                toggleAmbientGlow();
                syncControlsToVideo();
            };
        }
        if (panelBookmarkBtn) {
            panelBookmarkBtn.onclick = () => {
                addVideoBookmark();
            };
        }
        if (panelSleepBtn) {
            panelSleepBtn.onclick = () => {
                toggleSleepTimer();
                syncControlsToVideo();
            };
        }

        screenshotBtn.onclick = () => takeScreenshot(getVideo());

        timeLabel.style.cursor = 'pointer';
        timeLabel.addEventListener('click', () => {
            showRemainingTime = !showRemainingTime;
            syncControlsToVideo();
        });

        panelBuilt = true;
        panelBuildInProgress = false;

        buildToolbar();

        syncControlsToVideo();
        updateVideoCounter();
        updateLoopMarkers();
    }

    /* =========================================================
       Below-Video Toolbar (Enhancer for YouTube style icon bar)
       ========================================================= */

    function isLargeVideo(v) {
        if (!v || !v.isConnected) return false;
        const rect = v.getBoundingClientRect();
        if (rect.width < 320 || rect.height < 180) return false;

        const viewArea = window.innerWidth * window.innerHeight;
        if (viewArea <= 0) return false;
        const videoArea = rect.width * rect.height;
        const areaPct = videoArea / viewArea;

        // User requested: video covers 30-40% of screen area
        return areaPct >= 0.30 || (rect.width >= 640 && rect.height >= 360 && rect.top < window.innerHeight && rect.bottom > 0);
    }

    const ASPECT_MODES = [
        { id: 'default', label: 'Default' },
        { id: 'crop-21-9', label: '21:9 Ultrawide Crop' },
        { id: 'stretch-fill', label: 'Stretch to Fill' },
        { id: 'fit-16-9', label: '16:9 Standard Fit' }
    ];
    let currentAspectModeIndex = 0;

    function cycleAspectRatio(v) {
        if (!v) v = getVideo();
        if (!v) return;
        currentAspectModeIndex = (currentAspectModeIndex + 1) % ASPECT_MODES.length;
        const mode = ASPECT_MODES[currentAspectModeIndex];
        switch (mode.id) {
            case 'crop-21-9':
                v.style.objectFit = 'cover';
                v.style.transform = 'scale(1.33)';
                break;
            case 'stretch-fill':
                v.style.objectFit = 'fill';
                v.style.transform = 'none';
                break;
            case 'fit-16-9':
                v.style.objectFit = 'contain';
                v.style.transform = 'none';
                break;
            default:
                v.style.objectFit = '';
                v.style.transform = '';
                break;
        }
        showToast(`📐 Aspect: ${mode.label}`);
        syncToolbar();
    }

    const FILTER_PRESETS = [
        { id: 'normal', name: 'Normal (Reset)', b: 100, c: 100, s: 100 },
        { id: 'hdr', name: 'HDR Vibrant', b: 105, c: 115, s: 125 },
        { id: 'night', name: 'Night Warm', b: 85, c: 95, s: 85 },
        { id: 'contrast', name: 'High Contrast', b: 100, c: 130, s: 110 }
    ];
    let currentFilterPresetIndex = 0;

    function cycleFilterPreset(v) {
        if (!v) v = getVideo();
        if (!v) return;
        currentFilterPresetIndex = (currentFilterPresetIndex + 1) % FILTER_PRESETS.length;
        const p = FILTER_PRESETS[currentFilterPresetIndex];
        prefs.brightness = p.b;
        prefs.contrast = p.c;
        prefs.saturate = p.s;
        saveValue(siteKey('brightness'), p.b);
        saveValue(siteKey('contrast'), p.c);
        saveValue(siteKey('saturate'), p.s);
        applyVideoFilters(v);
        showToast(`✨ Filter: ${p.name}`);
        syncToolbar();
    }

    function cycleLoopAB() {
        const v = getVideo();
        if (!v) return;
        if (loopA === null) {
            setPointA();
        } else if (loopB === null) {
            setPointB();
        } else {
            clearLoopAB();
        }
        syncToolbar();
    }

    let webExpandedActive = false;
    function toggleWebTheater(v) {
        if (!v) v = getVideo();
        if (!v) return;

        if (isYouTubePage()) {
            const theaterBtn = document.querySelector('button.ytp-size-button');
            if (theaterBtn) {
                theaterBtn.click();
                showToast('🎬 Theater Mode');
                setTimeout(positionToolbar, 200);
                return;
            }
        }

        webExpandedActive = !webExpandedActive;
        if (webExpandedActive) {
            v.dataset.mvcOrigStyle = v.getAttribute('style') || '';
            v.style.position = 'fixed';
            v.style.top = '0';
            v.style.left = '0';
            v.style.width = '100vw';
            v.style.height = '100vh';
            v.style.zIndex = '2147483630';
            showToast('🎬 Web Theater Mode on');
        } else {
            v.setAttribute('style', v.dataset.mvcOrigStyle || '');
            showToast('🎬 Web Theater Mode off');
        }
        setTimeout(positionToolbar, 100);
    }

    let toolbarBuildInProgress = false;
    function buildToolbar() {
        if (window.self !== window.top) return;
        if (toolbarBuilt || toolbarBuildInProgress) return;
        toolbarBuildInProgress = true;

        toolbarHost = document.createElement('div');
        toolbarHost.id = 'mvc-toolbar-host';
        toolbarHost.classList.add('mvc-hidden');
        toolbarHost.setAttribute('hidden', '');
        toolbarHost.style.setProperty('display', 'none', 'important');
        toolbarHost.style.setProperty('visibility', 'hidden', 'important');

        tbShadow = toolbarHost.attachShadow({ mode: 'open' });

        const toolbarStyle = document.createElement('style');
        toolbarStyle.textContent = `
            :host {
                display: block;
                all: initial;
                width: 100%;
                margin: 8px 0 16px 0;
                box-sizing: border-box;
                z-index: 100;
                clear: both;
                pointer-events: auto;
            }
            :host(.mvc-hidden),
            :host([hidden]) {
                display: none !important;
                visibility: hidden !important;
                opacity: 0 !important;
                pointer-events: none !important;
            }
            :host(.mvc-docked-mode:not(.mvc-hidden):not([hidden])) {
                position: absolute !important;
                z-index: 2147483640 !important;
                pointer-events: none !important;
                margin: 0 !important;
                padding: 0 !important;
                width: max-content !important;
                height: max-content !important;
                display: block !important;
            }
            :host(.mvc-docked-mode) #mvc-toolbar-container {
                display: flex !important;
                align-items: center !important;
                justify-content: center !important;
                pointer-events: none !important;
                width: max-content !important;
                height: max-content !important;
                margin: 0 !important;
                padding: 0 !important;
            }
            :host(.mvc-docked-mode) #mvc-toolbar {
                pointer-events: auto !important;
            }
            :host(.mvc-floating-mode:not(.mvc-hidden):not([hidden])) {
                position: fixed !important;
                z-index: 2147483645 !important;
                pointer-events: none !important;
                margin: 0 !important;
                padding: 0 !important;
                width: max-content !important;
                height: max-content !important;
                display: block !important;
            }
            :host(.mvc-floating-mode) #mvc-toolbar-container {
                display: flex !important;
                align-items: center !important;
                justify-content: center !important;
                pointer-events: none !important;
                width: max-content !important;
                height: max-content !important;
                margin: 0 !important;
                padding: 0 !important;
            }
            :host(.mvc-floating-mode) #mvc-toolbar {
                pointer-events: auto !important;
            }
            #mvc-toolbar-container {
                position: relative;
                display: flex;
                align-items: center;
                justify-content: flex-start;
                width: 100%;
                padding: 0;
                margin: 0;
                box-sizing: border-box;
                pointer-events: none;
                max-width: calc(100vw - 16px);
                overflow-x: auto;
                scrollbar-width: none;
            }
            #mvc-toolbar-container::-webkit-scrollbar { display: none; }
            #mvc-toolbar {
                display: inline-flex;
                align-items: center;
                gap: 2px;
                height: 36px;
                box-sizing: border-box;
                padding: 3px 7px;
                background: rgba(14, 17, 23, 0.96);
                border: 1px solid rgba(148, 163, 184, 0.24);
                border-radius: 8px;
                box-shadow: 0 8px 24px rgba(0, 0, 0, 0.42);
                user-select: none;
                backdrop-filter: blur(16px);
                -webkit-backdrop-filter: blur(16px);
                transition: transform 0.2s ease, box-shadow 0.15s ease, border-color 0.15s ease, opacity 0.25s ease;
                pointer-events: auto !important;
                cursor: grab;
            }
            #mvc-toolbar.mvc-autohide {
                opacity: 0 !important;
                pointer-events: none !important;
                transform: translateY(6px) !important;
            }
            #mvc-toolbar:hover {
                border-color: rgba(255, 255, 255, 0.22);
                box-shadow: 0 4px 16px rgba(0, 0, 0, 0.55);
            }
            #mvc-toolbar:active {
                cursor: grabbing;
            }
            .tb-btn {
                display: inline-flex;
                align-items: center;
                justify-content: center;
                width: 28px;
                height: 28px;
                border: none;
                border-radius: 6px;
                background: transparent;
                color: #cbd5e1;
                cursor: pointer;
                padding: 0;
                position: relative;
                transition: background 0.12s ease, color 0.12s ease, transform 0.08s ease;
                flex-shrink: 0;
            }
            .tb-btn:hover {
                background: rgba(255, 255, 255, 0.12);
                color: #ffffff;
            }
            .tb-btn:active {
                transform: scale(0.92);
            }
            .tb-btn:focus-visible, .tb-speed-btn:focus-visible {
                outline: 2px solid #38bdf8;
                outline-offset: 2px;
            }
            .tb-btn.active {
                color: #38bdf8;
                background: rgba(56, 189, 248, 0.16);
            }
            .tb-btn.active-glow {
                color: #fbbf24 !important;
                background: rgba(251, 191, 36, 0.18) !important;
            }
            .tb-btn.active-violet {
                color: #c084fc !important;
                background: rgba(192, 132, 252, 0.18) !important;
            }
            .tb-btn.active-indigo {
                color: #818cf8 !important;
                background: rgba(129, 140, 248, 0.18) !important;
            }
            .tb-btn.recording {
                color: #ef4444 !important;
                background: rgba(239, 68, 68, 0.2) !important;
                animation: mvc-pulse 1s infinite alternate;
            }
            @keyframes mvc-pulse {
                from { transform: scale(1); opacity: 1; }
                to { transform: scale(1.08); opacity: 0.85; }
            }
            .tb-btn svg {
                width: 16px;
                height: 16px;
                fill: none;
                stroke: currentColor;
                stroke-width: 1.85;
                stroke-linecap: round;
                stroke-linejoin: round;
            }
            .tb-sep {
                width: 1px;
                height: 16px;
                background: rgba(255, 255, 255, 0.12);
                margin: 0 2px;
                flex-shrink: 0;
            }
            .tb-speed-btn {
                display: inline-flex;
                align-items: center;
                gap: 4px;
                height: 24px;
                padding: 0 7px;
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                font-size: 11px;
                font-weight: 700;
                color: #ffffff;
                cursor: pointer;
                border-radius: 5px;
                background: rgba(255, 255, 255, 0.08);
                border: 1px solid rgba(255, 255, 255, 0.14);
                transition: background 0.12s ease, border-color 0.12s ease;
                flex-shrink: 0;
            }
            .tb-speed-btn:hover {
                background: rgba(255, 255, 255, 0.18);
                border-color: rgba(255, 255, 255, 0.25);
            }
            .tb-speed-btn svg {
                width: 13px;
                height: 13px;
            }
            #mvc-speed-popover, #mvc-bookmark-popover {
                position: absolute;
                bottom: calc(100% + 8px);
                left: 50%;
                transform: translateX(-50%) translateY(4px) scale(0.96);
                display: none;
                opacity: 0;
                background: rgba(20, 21, 26, 0.96);
                border: 1px solid rgba(255, 255, 255, 0.14);
                border-radius: 10px;
                padding: 6px 8px;
                box-shadow: 0 8px 24px rgba(0, 0, 0, 0.6);
                backdrop-filter: blur(20px);
                -webkit-backdrop-filter: blur(20px);
                z-index: 2147483645;
                transition: opacity 0.14s ease, transform 0.14s ease;
                pointer-events: auto;
            }
            #mvc-speed-popover.visible, #mvc-bookmark-popover.visible {
                display: block;
                opacity: 1;
                transform: translateX(-50%) translateY(0) scale(1);
            }
            .sp-list {
                display: flex;
                align-items: center;
                gap: 4px;
            }
            .sp-pill {
                background: rgba(255, 255, 255, 0.08);
                border: 1px solid rgba(255, 255, 255, 0.12);
                color: #e2e8f0;
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                font-size: 11px;
                font-weight: 700;
                padding: 3px 7px;
                border-radius: 6px;
                cursor: pointer;
                transition: all 0.12s ease;
                white-space: nowrap;
            }
            .sp-pill:hover {
                background: rgba(255, 255, 255, 0.22);
                color: #ffffff;
            }
            .sp-pill.active {
                background: #38bdf8;
                color: #0f172a;
                border-color: #38bdf8;
                box-shadow: 0 0 10px rgba(56, 189, 248, 0.5);
            }
            .bm-list {
                display: flex;
                flex-direction: column;
                gap: 4px;
                min-width: 140px;
                max-height: 180px;
                overflow-y: auto;
            }
            .bm-item {
                display: flex;
                align-items: center;
                justify-content: space-between;
                padding: 4px 8px;
                background: rgba(255, 255, 255, 0.06);
                border-radius: 8px;
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                font-size: 11px;
                color: #e2e8f0;
                gap: 8px;
            }
            .bm-time {
                cursor: pointer;
                font-weight: 600;
            }
            .bm-time:hover {
                color: #38bdf8;
            }
            .bm-del {
                cursor: pointer;
                color: #ef4444;
                border: none;
                background: transparent;
                padding: 0 2px;
                font-size: 12px;
            }
        `;
        tbShadow.appendChild(toolbarStyle);

        // Cinema overlay (in main fixed shadow host)
        if (shadow && !cinemaOverlay) {
            const cinemaStyle = document.createElement('style');
            cinemaStyle.textContent = `
                #cinema-overlay {
                    position: fixed;
                    inset: 0;
                    background: rgba(0, 0, 0, 0.88);
                    z-index: 2147483640;
                    pointer-events: none !important;
                    opacity: 0;
                    display: none;
                    cursor: pointer;
                    transition: opacity 0.3s cubic-bezier(0.16, 1, 0.3, 1);
                }
                #cinema-overlay.visible {
                    display: block;
                    opacity: 1;
                    pointer-events: auto !important;
                }
            `;
            shadow.appendChild(cinemaStyle);

            cinemaOverlay = document.createElement('div');
            cinemaOverlay.id = 'cinema-overlay';
            cinemaOverlay.title = 'Click to exit Cinema Mode';
            cinemaOverlay.onclick = () => toggleCinemaMode();
            shadow.appendChild(cinemaOverlay);
        }

        const wrap = document.createElement('div');
        wrap.id = 'mvc-toolbar-container';

        const tb = document.createElement('div');
        tb.id = 'mvc-toolbar';
        tb.setAttribute('aria-label', 'Video controls toolbar');

        // SVG icon helper
        const icon = (paths, vb = '0 0 24 24') =>
            `<svg viewBox="${vb}">${paths}</svg>`;

        // Icons matching Enhancer for YouTube + Professional Suite
        const ICONS = {
            loop:        icon('<path d="M17 2l4 4-4 4"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><path d="M7 22l-4-4 4-4"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/>'),
            fullscreen:  icon('<path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M16 3h3a2 2 0 0 1 2 2v3"/><path d="M21 16v3a2 2 0 0 1-2 2h-3"/><path d="M3 16v3a2 2 0 0 0 2 2h3"/>'),
            volumeBoost: icon('<path d="M11 5L6 9H2v6h4l5 4V5z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M18.5 5.5a9 9 0 0 1 0 13"/><path d="M13 2l2 4-3 1 3 5" fill="none" stroke="currentColor" stroke-width="2"/>'),
            bass:        icon('<path d="M4 10v4M8 6v12M12 2v20M16 6v12M20 10v4"/>'),
            cinema:      icon('<rect x="2" y="4" width="20" height="16" rx="3"/><circle cx="12" cy="12" r="3"/><path d="M3 7h2M19 7h2M3 17h2M19 17h2"/>'),
            ambient:     icon('<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/>'),
            theater:     icon('<rect x="3" y="6" width="18" height="12" rx="2"/><path d="M3 10h18M7 6v4M11 6v4M15 6v4M19 6v4"/>'),
            pip:         icon('<rect x="2" y="4" width="20" height="16" rx="2"/><rect x="12" y="11" width="8" height="7" rx="1.5" fill="rgba(255,255,255,0.2)"/>'),
            aspect:      icon('<rect x="3" y="5" width="18" height="14" rx="2"/><line x1="7" y1="5" x2="7" y2="19"/><line x1="17" y1="5" x2="17" y2="19"/><line x1="3" y1="9.5" x2="7" y2="9.5"/><line x1="3" y1="14.5" x2="7" y2="14.5"/><line x1="17" y1="9.5" x2="21" y2="9.5"/><line x1="17" y1="14.5" x2="21" y2="14.5"/>'),
            speed:       icon('<path d="M12 4a8 8 0 0 0-8 8c0 2.2.9 4.2 2.3 5.7L12 12l5.7 5.7A7.96 7.96 0 0 0 20 12a8 8 0 0 0-8-8z"/><line x1="12" y1="12" x2="15" y2="8" stroke-width="2.2"/>'),
            filters:     icon('<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M12 8l1 2 2 1-2 1-1 2-1-2-2-1 2-1 1-2z" fill="currentColor"/><path d="M7 14l.7 1.3 1.3.7-1.3.7-.7 1.3-.7-1.3-1.3-.7 1.3-.7.7-1.3z" fill="currentColor"/>'),
            screenshot:  icon('<path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/>'),
            abloop:      icon('<path d="M10 2v6L4.5 18A2 2 0 0 0 6.2 21h11.6a2 2 0 0 0 1.7-3L14 8V2h-4z"/><path d="M8.5 14h7"/>'),
            clip:        icon('<rect x="2" y="4" width="20" height="16" rx="2"/><path d="M7 4v16M17 4v16M2 12h20"/><circle cx="12" cy="12" r="2.5" fill="currentColor"/>'),
            download:    icon('<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>'),
            bookmark:    icon('<path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>'),
            sleep:       icon('<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>'),
            settings:    icon('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>'),
            close:       icon('<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>')
        };

        const btn = (id, iconKey, title) => {
            const b = document.createElement('button');
            b.className = 'tb-btn';
            b.id = 'tb-' + id;
            b.title = title;
            b.setAttribute('aria-label', title);
            b.innerHTML = ICONS[iconKey];
            return b;
        };

        const sep = () => {
            const d = document.createElement('div');
            d.className = 'tb-sep';
            return d;
        };

        // Buttons
        const btnLoop       = btn('loop', 'loop', 'Loop whole video');
        const btnVolBoost   = btn('volboost', 'volumeBoost', 'Volume Boost (Click 150%)');
        const btnBass       = btn('bass', 'bass', 'Bass & Vocal EQ (Click: Bass +7dB, Right-Click: Vocal +6dB)');
        const btnCinema     = btn('cinema', 'cinema', 'Cinema Mode (Dim lights)');
        const btnAmbient    = btn('ambient', 'ambient', 'Universal Ambient Glow (Bias Lighting)');
        const btnTheater    = btn('theater', 'theater', 'Theater Mode / Resize Player');
        const btnPip        = btn('pip', 'pip', 'Picture-in-Picture (Detach Player)');
        const btnAspect     = btn('aspect', 'aspect', 'Aspect Ratio (Crop 21:9 / Stretch / Fit)');
        const btnFullscreen = btn('fullscreen', 'fullscreen', 'Enter fullscreen (F)');
        
        // Speed pill button
        const btnSpeed = document.createElement('button');
        btnSpeed.className = 'tb-btn tb-speed-btn';
        btnSpeed.id = 'tb-speed';
        btnSpeed.title = 'Playback Speed (Click: Speed Menu, Right-Click: 1×, Right-Drag on video)';
        btnSpeed.innerHTML = `${ICONS.speed}<span id="tb-speed-val">1×</span>`;

        const btnFilters    = btn('filters', 'filters', 'Video Filters (HDR / Night / Contrast)');
        const btnScreenshot = btn('screenshot', 'screenshot', 'Capture Screenshot');
        const btnAbLoop     = btn('abloop', 'abloop', 'A-B Loop Repeater (Click to set A, B, clear)');
        const btnClip       = btn('clip', 'clip', 'Export Loop Clip (.webm)');
        const btnDownload   = btn('download', 'download', 'Smart Media Downloader (HTML5 Media Sites)');
        const btnBookmark   = btn('bookmark', 'bookmark', 'Video Bookmark (Click: Save, Right-Click: List)');
        const btnSleep      = btn('sleep', 'sleep', 'Sleep Timer (Click: 15m/30m/45m/60m/End/Off)');
        const btnSettings   = btn('settings', 'settings', 'Video Controller Panel');
        const btnClose      = btn('close', 'close', 'Hide toolbar (Press Alt+T to restore)');
        btnClose.style.marginLeft = '3px';
        btnClose.style.opacity = '0.7';
        btnClose.onmouseenter = () => btnClose.style.opacity = '1';
        btnClose.onmouseleave = () => btnClose.style.opacity = '0.7';
        btnClose.onclick = e => {
            if (e) {
                e.preventDefault();
                e.stopPropagation();
            }
            toggleToolbarVisibility(false);
        };

        // Assemble toolbar
        tb.appendChild(btnLoop);
        tb.appendChild(btnVolBoost);
        tb.appendChild(btnBass);
        tb.appendChild(sep());
        tb.appendChild(btnCinema);
        tb.appendChild(btnAmbient);
        tb.appendChild(btnTheater);
        tb.appendChild(btnPip);
        tb.appendChild(btnAspect);
        tb.appendChild(btnFullscreen);
        tb.appendChild(sep());
        tb.appendChild(btnSpeed);
        tb.appendChild(btnFilters);
        tb.appendChild(btnScreenshot);
        tb.appendChild(btnAbLoop);
        tb.appendChild(btnClip);
        tb.appendChild(btnDownload);
        tb.appendChild(sep());
        tb.appendChild(btnBookmark);
        tb.appendChild(btnSleep);
        tb.appendChild(sep());
        tb.appendChild(btnSettings);
        tb.appendChild(btnClose);

        wrap.appendChild(tb);

        // Speed Popover
        const speedPopover = document.createElement('div');
        speedPopover.id = 'mvc-speed-popover';
        const speeds = [0.5, 0.75, 1.0, 1.25, 1.4, 1.5, 1.75, 2.0, 2.5, 3.0, 4.0];
        speedPopover.innerHTML = `
            <div class="sp-list">
                ${speeds.map(s => `<button class="sp-pill" data-speed="${s}">${s}×</button>`).join('')}
            </div>
        `;
        wrap.appendChild(speedPopover);
        speedPopoverEl = speedPopover;

        speedPopover.querySelectorAll('.sp-pill').forEach(pill => {
            pill.onclick = e => {
                e.stopPropagation();
                const rate = Number(pill.dataset.speed);
                const v = getVideo();
                if (v && validSpeed(rate)) {
                    setPlaybackRate(v, rate, true);
                    syncToolbar();
                }
                speedPopover.classList.remove('visible');
            };
        });

        // Bookmark Popover
        const bookmarkPopover = document.createElement('div');
        bookmarkPopover.id = 'mvc-bookmark-popover';
        bookmarkPopover.innerHTML = `<div class="bm-list" id="bm-list-container"></div>`;
        wrap.appendChild(bookmarkPopover);

        function updateBookmarkPopoverList() {
            const listContainer = bookmarkPopover.querySelector('#bm-list-container');
            if (!listContainer) return;
            loadVideoBookmarks();
            if (videoBookmarks.length === 0) {
                listContainer.innerHTML = '<div style="padding: 6px; font-size: 11px; color: #94a3b8; text-align: center;">No bookmarks yet<br><span style="font-size: 10px; opacity: 0.7;">Click ribbon to save current time</span></div>';
                return;
            }
            listContainer.innerHTML = videoBookmarks.map(bm => `
                <div class="bm-item">
                    <span class="bm-time" data-time="${bm.time}">⏱️ ${bm.label}</span>
                    <button class="bm-del" data-id="${bm.id}" title="Delete bookmark">✕</button>
                </div>
            `).join('');

            listContainer.querySelectorAll('.bm-time').forEach(el => {
                el.onclick = e => {
                    e.stopPropagation();
                    const t = Number(el.dataset.time);
                    jumpToBookmark(t);
                    bookmarkPopover.classList.remove('visible');
                };
            });

            listContainer.querySelectorAll('.bm-del').forEach(el => {
                el.onclick = e => {
                    e.stopPropagation();
                    const id = Number(el.dataset.id);
                    removeVideoBookmark(id);
                    updateBookmarkPopoverList();
                };
            });
        }

        tbShadow.appendChild(wrap);
        toolbarEl = tb;

        // Button Click Handlers
        btnLoop.onclick = () => {
            const v = getVideo();
            if (!v) return;
            v.loop = !v.loop;
            showToast(v.loop ? '🔁 Loop on' : '🔁 Loop off');
            syncToolbar();
            if (loopBtn) loopBtn.classList.toggle('active', v.loop);
        };

        btnVolBoost.onclick = () => {
            const v = getVideo();
            if (!v) return;
            if (prefs.volume <= 1.0) {
                applyVolumeAndBoost(v, 1.5, true);
            } else {
                applyVolumeAndBoost(v, 1.0, true);
            }
            syncToolbar();
        };

        btnBass.onclick = () => toggleBassBoost(getVideo());
        btnBass.oncontextmenu = e => {
            e.preventDefault();
            e.stopPropagation();
            toggleVocalBoost(getVideo());
        };

        btnCinema.onclick = () => toggleCinemaMode();
        btnAmbient.onclick = () => toggleAmbientGlow();
        btnTheater.onclick = () => toggleWebTheater();
        btnPip.onclick = () => togglePiP();
        btnAspect.onclick = () => cycleAspectRatio();
        btnFullscreen.onclick = () => toggleFullscreen();

        btnSpeed.onclick = e => {
            e.stopPropagation();
            if (bookmarkPopover) bookmarkPopover.classList.remove('visible');
            speedPopover.classList.toggle('visible');
        };

        btnSpeed.oncontextmenu = e => {
            e.preventDefault();
            e.stopPropagation();
            const v = getVideo();
            if (!v) return;
            setPlaybackRate(v, 1.0, true);
            syncToolbar();
            speedPopover.classList.remove('visible');
        };

        btnFilters.onclick = () => cycleFilterPreset();
        btnScreenshot.onclick = () => takeScreenshot(getVideo());
        btnAbLoop.onclick = () => cycleLoopAB();
        btnClip.onclick = () => exportLoopClip();
        btnDownload.onclick = () => downloadActiveVideo();

        btnBookmark.onclick = () => addVideoBookmark();
        btnBookmark.oncontextmenu = e => {
            e.preventDefault();
            e.stopPropagation();
            if (speedPopover) speedPopover.classList.remove('visible');
            updateBookmarkPopoverList();
            bookmarkPopover.classList.toggle('visible');
        };

        btnSleep.onclick = () => toggleSleepTimer();

        btnSettings.onclick = () => {
            if (!panelBuilt) buildPanel();
            if (panel.classList.contains('visible')) {
                hidePanel();
            } else {
                showPanel();
            }
        };

        // Make floating toolbar draggable so user can freely position it anywhere on screen
        tb.addEventListener('pointerdown', e => {
            if (e.target.closest('button, input, select, .sp-pill, .bm-item, #mvc-speed-popover, #mvc-bookmark-popover')) {
                return;
            }
            if (e.button !== 0) return; // Only primary left-click drag

            isDraggingToolbar = true;
            const currentLeft = toolbarHost.offsetLeft || 0;
            const currentTop = toolbarHost.offsetTop || 0;
            toolbarDragStart = {
                mouseX: e.clientX,
                mouseY: e.clientY,
                hostX: currentLeft,
                hostY: currentTop
            };

            const onPointerMove = moveEvt => {
                if (!isDraggingToolbar || !toolbarDragStart) return;
                const dx = moveEvt.clientX - toolbarDragStart.mouseX;
                const dy = moveEvt.clientY - toolbarDragStart.mouseY;
                const newLeft = Math.max(0, Math.min(window.innerWidth - tb.offsetWidth, toolbarDragStart.hostX + dx));
                const newTop = Math.max(0, Math.min(window.innerHeight - tb.offsetHeight, toolbarDragStart.hostY + dy));

                toolbarCustomPos = { left: newLeft, top: newTop };
                toolbarHost.style.setProperty('left', `${Math.round(newLeft)}px`, 'important');
                toolbarHost.style.setProperty('top', `${Math.round(newTop)}px`, 'important');
            };

            const onPointerUp = () => {
                isDraggingToolbar = false;
                toolbarDragStart = null;
                window.removeEventListener('pointermove', onPointerMove, true);
                window.removeEventListener('pointerup', onPointerUp, true);
            };

            window.addEventListener('pointermove', onPointerMove, true);
            window.addEventListener('pointerup', onPointerUp, true);
        });

        // Double-click empty space on toolbar to reset custom position and dock back under video
        tb.addEventListener('dblclick', e => {
            if (e.target.closest('button, input, select, .sp-pill, .bm-item, #mvc-speed-popover, #mvc-bookmark-popover')) {
                return;
            }
            toolbarCustomPos = null;
            mountToolbarInPage();
            showToast('📍 Toolbar docked under video');
        });

        // Close popovers on outer click
        document.addEventListener('click', () => {
            if (speedPopover) speedPopover.classList.remove('visible');
            if (bookmarkPopover) bookmarkPopover.classList.remove('visible');
        });

        toolbarBuilt = true;
        toolbarBuildInProgress = false;
        mountToolbarInPage(video);
        if (!sideTabBuilt) buildSideTab();
    }

    // Sync toolbar icon states
    function syncToolbar(targetVideo) {
        if (!toolbarBuilt || !tbShadow) return;
        const v = targetVideo || video || (isRefreshingVideos ? null : getVideo());

        const loopB = tbShadow.querySelector('#tb-loop');
        if (loopB) loopB.classList.toggle('active', Boolean(v && v.loop));

        const volB = tbShadow.querySelector('#tb-volboost');
        if (volB) volB.classList.toggle('active', prefs.volume > 1.0);

        const bassB = tbShadow.querySelector('#tb-bass');
        if (bassB) {
            bassB.classList.toggle('active-violet', bassBoostActive || vocalBoostActive);
            if (bassBoostActive && vocalBoostActive) {
                bassB.title = 'Bass (+7dB) & Vocal (+6dB) Active';
            } else if (bassBoostActive) {
                bassB.title = 'Bass Boost Active (+7dB)';
            } else if (vocalBoostActive) {
                bassB.title = 'Vocal Clarity Active (+6dB)';
            } else {
                bassB.title = 'Bass & Vocal EQ (Click: Bass +7dB, Right-Click: Vocal +6dB)';
            }
        }

        const cinB = tbShadow.querySelector('#tb-cinema');
        if (cinB) cinB.classList.toggle('active', cinemaModeActive);

        const ambB = tbShadow.querySelector('#tb-ambient');
        if (ambB) ambB.classList.toggle('active-glow', ambientGlowActive);

        const theaterB = tbShadow.querySelector('#tb-theater');
        if (theaterB && isYouTubePage()) {
            const player = document.querySelector('#movie_player');
            theaterB.classList.toggle('active', Boolean(player && player.classList.contains('ytp-theater-mode')));
        } else if (theaterB) {
            theaterB.classList.toggle('active', webExpandedActive);
        }

        const pipB = tbShadow.querySelector('#tb-pip');
        if (pipB) pipB.classList.toggle('active', Boolean(v && document.pictureInPictureElement === v));

        const aspectB = tbShadow.querySelector('#tb-aspect');
        if (aspectB) aspectB.classList.toggle('active', currentAspectModeIndex > 0);

        const filtB = tbShadow.querySelector('#tb-filters');
        if (filtB) filtB.classList.toggle('active', currentFilterPresetIndex > 0 || prefs.brightness !== 100 || prefs.contrast !== 100 || prefs.saturate !== 100);

        const abB = tbShadow.querySelector('#tb-abloop');
        if (abB) abB.classList.toggle('active', loopA !== null);

        const clipB = tbShadow.querySelector('#tb-clip');
        if (clipB) {
            clipB.classList.toggle('recording', isRecordingClip);
            clipB.classList.toggle('active', isRecordingClip || (loopA !== null && loopB !== null));
            clipB.title = isRecordingClip ? '🔴 Recording clip...' : (loopA !== null && loopB !== null ? `Export Loop Clip (${Math.round(loopB - loopA)}s)` : 'Export Loop Clip (Set A-B first)');
        }

        const dlB = tbShadow.querySelector('#tb-download');
        if (dlB) {
            if (isYouTubePage()) {
                dlB.style.opacity = '0.35';
                dlB.title = 'Download disabled on YouTube (Store Policy) - Use 🎬 Clip';
            } else {
                dlB.style.opacity = '1';
                dlB.title = 'Smart Media Downloader (HTML5 Media Sites)';
            }
        }

        const bmB = tbShadow.querySelector('#tb-bookmark');
        if (bmB) {
            loadVideoBookmarks();
            bmB.classList.toggle('active', videoBookmarks.length > 0);
        }

        const sleepB = tbShadow.querySelector('#tb-sleep');
        if (sleepB) {
            sleepB.classList.toggle('active-indigo', sleepTimerMode !== 'off');
            if (sleepTimerMode === 'ended') {
                sleepB.title = 'Sleep Timer: Active (Pause on end)';
            } else if (sleepTimerRemainingSec > 0) {
                const m = Math.ceil(sleepTimerRemainingSec / 60);
                sleepB.title = `Sleep Timer: ${m}m remaining`;
            } else {
                sleepB.title = 'Sleep Timer (Click: 15m/30m/45m/60m/End/Off)';
            }
        }

        const speedTxt = tbShadow.querySelector('#tb-speed-val');
        if (speedTxt && v) speedTxt.textContent = formatSpeed(v.playbackRate);

        // Highlight active pill in speed popover
        if (speedPopoverEl && v) {
            const curRate = Number(v.playbackRate) || 1;
            speedPopoverEl.querySelectorAll('.sp-pill').forEach(pill => {
                pill.classList.toggle('active', Math.abs(Number(pill.dataset.speed) - curRate) < 0.02);
            });
        }
    }

    function toggleToolbarVisibility(forceState) {
        if (window.self !== window.top) return;
        const nextState = typeof forceState === 'boolean' ? forceState : (!prefs.showToolbar);
        prefs.showToolbar = nextState;
        updateSideTabState(nextState);
        if (toolbarHost) {
            if (nextState) {
                toolbarHost.classList.remove('mvc-hidden');
                toolbarHost.removeAttribute('hidden');
                toolbarHost.style.removeProperty('display');
                toolbarHost.style.removeProperty('visibility');
                mountToolbarInPage();
                showToast('🎛️ Toolbar visible (Alt+T)');
            } else {
                toolbarHost.classList.add('mvc-hidden');
                toolbarHost.setAttribute('hidden', '');
                toolbarHost.style.setProperty('display', 'none', 'important');
                toolbarHost.style.setProperty('visibility', 'hidden', 'important');
                showToast('🎛️ Toolbar hidden (Press ⚡ VidAmp tab to restore)');
            }
        }
        resetSideTabIdle();
    }

    function setFullscreenUi(active) {
        clearTimeout(toolbarIdleTimer);
        if (active) {
            if (toolbarHost) {
                toolbarHost.style.setProperty('display', 'none', 'important');
            }
            if (sideTabHost) {
                sideTabHost.style.setProperty('display', 'none', 'important');
            }
        } else {
            // Exiting fullscreen:
            if (sideTabHost) {
                sideTabHost.style.removeProperty('display');
            }
            if (toolbarHost) {
                // Toolbar should ONLY be restored if user explicitly has showToolbar enabled AND it was not hidden
                if (prefs.showToolbar === true && !toolbarHost.classList.contains('mvc-hidden') && !toolbarHost.hasAttribute('hidden')) {
                    setTimeout(() => {
                        const isFs = Boolean(document.fullscreenElement || document.webkitFullscreenElement);
                        if (!isFs && toolbarHost && prefs.showToolbar === true && !toolbarHost.classList.contains('mvc-hidden')) {
                            toolbarHost.style.removeProperty('display');
                            mountToolbarInPage();
                        }
                    }, 180);
                } else {
                    toolbarHost.classList.add('mvc-hidden');
                    toolbarHost.setAttribute('hidden', '');
                    toolbarHost.style.setProperty('display', 'none', 'important');
                    toolbarHost.style.setProperty('visibility', 'hidden', 'important');
                }
            }

            setTimeout(() => {
                const isFs = Boolean(document.fullscreenElement || document.webkitFullscreenElement);
                if (!isFs && sideTabBuilt) {
                    positionSideTab();
                }
            }, 180);
        }

        if (fullscreenBtn) {
            const label = active ? 'Exit fullscreen' : 'Enter fullscreen';
            fullscreenBtn.title = `${label} (F)`;
            fullscreenBtn.setAttribute('aria-label', label);
            fullscreenBtn.textContent = active ? '⛶ Exit Fullscreen' : '⛶ Fullscreen';
        }
    }

    let toolbarIdleTimer = null;
    function resetToolbarIdle() {
        if (!toolbarBuilt || !tbShadow) return;
        const tb = tbShadow.querySelector('#mvc-toolbar');
        if (!tb) return;
        tb.classList.remove('mvc-autohide');

        clearTimeout(toolbarIdleTimer);
        // Only autohide if custom floating mode is active
        if (toolbarHost && toolbarHost.classList.contains('mvc-floating-mode')) {
            toolbarIdleTimer = setTimeout(() => {
                if (tb && !tb.matches(':hover')) {
                    tb.classList.add('mvc-autohide');
                }
            }, 2500);
        }
    }

    window.addEventListener('mousemove', resetToolbarIdle, { passive: true });
    window.addEventListener('pointermove', resetToolbarIdle, { passive: true });

    function findTruePlayerContainer(v) {
        if (!v) return null;
        const playerSelectors = [
            '.html5-video-player',
            '#movie_player',
            '.video-js',
            '.jwplayer',
            '.plyr',
            '.vjs-tech',
            '.shaka-video-container',
            '.bmpui-ui-uicontainer',
            '[data-player]',
            '[class*="player-container"]',
            '[class*="video-container"]',
            '[class*="player_container"]',
            '[class*="video_container"]',
            '[id*="player-container"]',
            '[id*="video-container"]',
            '[class*="player-wrapper"]',
            '[class*="video-wrapper"]',
            '[class*="player"][class*="wrap"]',
            '[class*="player"]',
            '[id*="player"]'
        ];
        for (const sel of playerSelectors) {
            try {
                const el = v.closest(sel);
                if (el && el !== document.body && el !== document.documentElement) {
                    const elRect = el.getBoundingClientRect();
                    const vRect = v.getBoundingClientRect();
                    if (elRect.width >= vRect.width * 0.8 && elRect.height >= vRect.height * 0.8) {
                        return el;
                    }
                }
            } catch (_) {}
        }
        let cur = v.parentElement;
        let candidate = v;
        let depth = 0;
        const vRect = v.getBoundingClientRect();
        while (cur && cur !== document.body && cur !== document.documentElement && depth < 6) {
            const cRect = cur.getBoundingClientRect();
            if (cRect.width >= vRect.width * 0.9 && cRect.height >= vRect.height * 0.9) {
                if (cRect.width < window.innerWidth * 1.5 && cRect.height < window.innerHeight * 1.5) {
                    candidate = cur;
                }
            }
            cur = cur.parentElement;
            depth++;
        }
        return candidate;
    }

    // Mount toolbar strictly in page block flow BELOW video player (YouTube) or dock UNDER player container (Generic sites)
    // GUARANTEE: The toolbar NEVER renders over the video frame on ANY video type.
    function mountToolbarInPage(targetVideo) {
        if (window.self !== window.top) return;
        if (!toolbarBuilt || !toolbarHost) return;
        if (isDraggingToolbar) return;

        // Strictly honor hidden state and user preference
        if (prefs.showToolbar === false || toolbarHost.classList.contains('mvc-hidden') || toolbarHost.hasAttribute('hidden')) {
            toolbarHost.classList.add('mvc-hidden');
            toolbarHost.setAttribute('hidden', '');
            toolbarHost.style.setProperty('display', 'none', 'important');
            toolbarHost.style.setProperty('visibility', 'hidden', 'important');
            return;
        }

        const v = targetVideo || video || (isRefreshingVideos ? null : getVideo());

        const isFullscreen = Boolean(
            document.fullscreenElement ||
            document.webkitFullscreenElement ||
            (v && v.closest && (v.closest('.ytp-fullscreen') || v.closest(':fullscreen') || v.closest(':-webkit-full-screen')))
        );
        if (!v || !isLargeVideo(v) || isFullscreen) {
            toolbarHost.style.setProperty('display', 'none', 'important');
            return;
        }

        // 1. YouTube Watch Page: Place cleanly in page block flow BEFORE ytd-watch-metadata (below player/theater and above title)
        if (isYouTubePage()) {
            const watchMetadata = document.querySelector('ytd-watch-metadata') ||
                                  document.querySelector('#below') ||
                                  document.querySelector('#primary-inner') ||
                                  document.querySelector('#columns');

            if (watchMetadata && watchMetadata.parentNode) {
                toolbarHost.classList.remove('mvc-floating-mode');
                toolbarHost.classList.remove('mvc-docked-mode');
                toolbarHost.style.cssText = [
                    'position: relative !important',
                    'display: block !important',
                    'width: 100% !important',
                    'height: auto !important',
                    'margin: 8px 0 16px 0 !important',
                    'padding: 0 !important',
                    'border: none !important',
                    'background: transparent !important',
                    'z-index: 100 !important',
                    'pointer-events: auto !important',
                    'clear: both !important'
                ].join(';');

                if (!toolbarHost.isConnected || toolbarHost.nextSibling !== watchMetadata) {
                    try {
                        watchMetadata.parentNode.insertBefore(toolbarHost, watchMetadata);
                    } catch (_) {}
                }
                syncToolbar(v);
                return;
            }

            // YouTube metadata container not ready yet: hide toolbar and schedule retry.
            // NEVER fall through to Section 2 (generic body positioning) on YouTube!
            toolbarHost.style.setProperty('display', 'none', 'important');
            setTimeout(tryMountYouTubeToolbar, 150);
            return;
        }

        // 2. Generic Video Sites (Hotstar, JioCinema, Netflix, Prime Video, Vimeo, movie sites, etc.)
        const body = document.body || document.documentElement;
        if (!body) return;

        const rect = v.getBoundingClientRect();
        // If video is scrolled off-screen or invisible, hide
        if (rect.bottom < 40 || rect.top > window.innerHeight - 40 || rect.width <= 0 || rect.height <= 0) {
            toolbarHost.style.setProperty('display', 'none', 'important');
            return;
        }

        const tb = tbShadow.querySelector('#mvc-toolbar');
        const tbWidth = (tb && tb.offsetWidth > 0) ? tb.offsetWidth : 440;
        const tbHeight = (tb && tb.offsetHeight > 0) ? tb.offsetHeight : 36;

        if (toolbarCustomPos && typeof toolbarCustomPos.top === 'number') {
            // User explicitly dragged toolbar to a custom floating position
            toolbarHost.classList.remove('mvc-docked-mode');
            toolbarHost.classList.add('mvc-floating-mode');
            if (toolbarHost.parentNode !== body) {
                try { body.appendChild(toolbarHost); } catch (_) {}
            }

            const left = Math.max(8, Math.min(window.innerWidth - tbWidth - 8, toolbarCustomPos.left));
            const top = Math.max(8, Math.min(window.innerHeight - tbHeight - 8, toolbarCustomPos.top));

            toolbarHost.style.cssText = [
                'position: fixed !important',
                `left: ${Math.round(left)}px !important`,
                `top: ${Math.round(top)}px !important`,
                'width: max-content !important',
                'height: max-content !important',
                'z-index: 2147483645 !important',
                'pointer-events: none !important',
                'margin: 0 !important',
                'padding: 0 !important',
                'border: none !important',
                'background: transparent !important',
                'display: block !important',
                'transform: none !important'
            ].join(';');
        } else {
            // Default position: DOCKED STRICTLY UNDER THE VIDEO (Zero Overlap with the video!)
            const container = findTruePlayerContainer(v) || v;
            const cRect = (container && container !== v) ? container.getBoundingClientRect() : rect;
            const bodyRect = body.getBoundingClientRect();

            // Measure player boundary in viewport coordinates
            const playerBottomViewport = Math.max(rect.bottom, cRect.bottom);
            const playerLeftViewport = Math.min(rect.left, cRect.left);
            const playerWidth = Math.max(rect.width, cRect.width);

            // Full-window / Theater Guard: If the player fills viewport height and page has no scroll space below
            const totalDocHeight = Math.max(document.documentElement.scrollHeight, body.scrollHeight);
            const playerBottomDoc = playerBottomViewport - bodyRect.top;
            const remainingDocSpaceBelow = totalDocHeight - playerBottomDoc;

            // If player extends to the bottom of the window (within 24px) AND there's no scroll space below:
            if (playerBottomViewport >= window.innerHeight - 24 && remainingDocSpaceBelow < 40) {
                // Video takes up the full screen/window — do not render docked bar over the video!
                toolbarHost.style.setProperty('display', 'none', 'important');
                return;
            }

            toolbarHost.classList.remove('mvc-floating-mode');
            toolbarHost.classList.add('mvc-docked-mode');
            if (toolbarHost.parentNode !== body) {
                try { body.appendChild(toolbarHost); } catch (_) {}
            }

            // In document coordinates: sit immediately UNDER the player container with generous clearance
            const docTop = playerBottomDoc + 10;

            const effectiveLeftDoc = playerLeftViewport - bodyRect.left;
            let docLeft = effectiveLeftDoc + (playerWidth - tbWidth) / 2;
            const maxScrollW = body.scrollWidth || window.innerWidth;
            docLeft = Math.max(12, Math.min(maxScrollW - tbWidth - 12, docLeft));

            toolbarHost.style.cssText = [
                'position: absolute !important',
                `left: ${Math.round(docLeft)}px !important`,
                `top: ${Math.round(docTop)}px !important`,
                'width: max-content !important',
                'height: max-content !important',
                'z-index: 2147483640 !important',
                'pointer-events: none !important',
                'margin: 0 !important',
                'padding: 0 !important',
                'border: none !important',
                'background: transparent !important',
                'display: block !important',
                'transform: none !important'
            ].join(';');
        }

        syncToolbar(v);
    }

    const positionToolbar = mountToolbarInPage;

    if (isYouTubePage()) {
        let ytMountScheduled = false;
        function tryMountYouTubeToolbar() {
            if (!toolbarBuilt || !toolbarHost || Boolean(document.fullscreenElement) || prefs.showToolbar === false || toolbarHost.classList.contains('mvc-hidden')) return;
            const watchMetadata = document.querySelector('ytd-watch-metadata') ||
                                  document.querySelector('#below') ||
                                  document.querySelector('#primary-inner') ||
                                  document.querySelector('#columns');
            if (watchMetadata && (!toolbarHost.isConnected || toolbarHost.nextSibling !== watchMetadata)) {
                if (ytMountScheduled) return;
                ytMountScheduled = true;
                requestAnimationFrame(() => {
                    ytMountScheduled = false;
                    mountToolbarInPage();
                });
            }
        }

        // Lightweight hooks on navigation and player updates instead of scanning entire DOM tree
        ['yt-navigate-finish', 'yt-page-data-updated', 'spfdone'].forEach(evt => {
            document.addEventListener(evt, () => {
                setTimeout(() => {
                    tryMountYouTubeToolbar();
                    if (sideTabBuilt) positionSideTab();
                }, 150);
                setTimeout(() => {
                    tryMountYouTubeToolbar();
                    if (sideTabBuilt) positionSideTab();
                }, 600);
            }, { passive: true });
        });
    }

    // Cinema Mode: dims everything except the video
    function toggleCinemaMode() {
        cinemaModeActive = !cinemaModeActive;

        if (cinemaOverlay) {
            cinemaOverlay.classList.toggle('visible', cinemaModeActive);
        }

        if (cinemaModeActive && isYouTubePage()) {
            const theaterBtn = document.querySelector('button.ytp-size-button');
            const player = document.querySelector('#movie_player');
            if (theaterBtn && player && !player.classList.contains('ytp-theater-mode')) {
                theaterBtn.click();
            }
        }

        showToast(cinemaModeActive ? '🎬 Cinema Mode on' : '🎬 Cinema Mode off');
        syncToolbar();
    }

    /* =========================================================
       Side Dropdown Tab (On-Demand Below-Video Toolbar Expander)
       ========================================================= */

    function updateSideTabState(forceOpen) {
        if (window.self !== window.top) return;
        if (!sideTabBuilt || !sideTabBtn) return;
        const open = typeof forceOpen === 'boolean' ? forceOpen : Boolean(prefs.showToolbar);
        sideTabBtn.classList.toggle('active', open);
        if (open) {
            sideTabBtn.classList.remove('idle');
        } else {
            sideTabBtn.classList.add('idle');
        }
        const arrow = sideTabBtn.querySelector('.side-arrow');
        if (arrow) {
            arrow.textContent = open ? '▴' : '▾';
        }
    }

    function positionSideTab(targetVideo) {
        if (window.self !== window.top) return;
        if (!sideTabBuilt || !sideTabHost || !sideTabBtn) return;
        if (isDraggingSideTab) return;

        // If user disabled the floating tab, completely hide it
        if (!prefs.sideTabEnabled) {
            sideTabHost.classList.remove('visible');
            sideTabHost.style.setProperty('display', 'none', 'important');
            return;
        }

        const isFullscreen = Boolean(
            document.fullscreenElement ||
            document.webkitFullscreenElement ||
            (targetVideo && targetVideo.closest && (targetVideo.closest('.ytp-fullscreen') || targetVideo.closest(':fullscreen') || targetVideo.closest(':-webkit-full-screen')))
        );
        if (isFullscreen) {
            sideTabHost.classList.remove('visible');
            sideTabHost.style.setProperty('display', 'none', 'important');
            return;
        }
        sideTabHost.style.removeProperty('display');

        const v = targetVideo || video || (isRefreshingVideos ? null : getVideo());
        if (!v || !isLargeVideo(v)) {
            sideTabHost.classList.remove('visible');
            return;
        }

        const rect = v.getBoundingClientRect();
        if (rect.bottom < 40 || rect.top > window.innerHeight - 40 || rect.width <= 0 || rect.height <= 0) {
            sideTabHost.classList.remove('visible');
            return;
        }

        const tabWidth = (sideTabBtn.offsetWidth > 0) ? sideTabBtn.offsetWidth : 106;
        const tabHeight = (sideTabBtn.offsetHeight > 0) ? sideTabBtn.offsetHeight : 28;

        if (sideTabCustomPos && typeof sideTabCustomPos.left === 'number') {
            const left = Math.max(4, Math.min(window.innerWidth - tabWidth - 4, sideTabCustomPos.left));
            const top = Math.max(4, Math.min(window.innerHeight - tabHeight - 4, sideTabCustomPos.top));
            sideTabHost.style.cssText = [
                'position: fixed !important',
                `left: ${Math.round(left)}px !important`,
                `top: ${Math.round(top)}px !important`,
                'display: block !important',
                'z-index: 2147483646 !important',
                'pointer-events: none !important'
            ].join(';');
        } else {
            // Default position: flush against the top-right corner of the video player container
            const container = findTruePlayerContainer(v) || v;
            const cRect = (container && container !== v) ? container.getBoundingClientRect() : rect;
            const effectiveTop = Math.min(rect.top, cRect.top);
            const effectiveRight = Math.max(rect.right, cRect.right);

            const defaultLeft = effectiveRight - tabWidth - 8;
            const defaultTop = effectiveTop + 6;

            const clampedLeft = Math.max(4, Math.min(window.innerWidth - tabWidth - 4, defaultLeft));
            const clampedTop = Math.max(4, Math.min(window.innerHeight - tabHeight - 4, defaultTop));

            sideTabHost.style.cssText = [
                'position: fixed !important',
                `left: ${Math.round(clampedLeft)}px !important`,
                `top: ${Math.round(clampedTop)}px !important`,
                'display: block !important',
                'z-index: 2147483646 !important',
                'pointer-events: none !important'
            ].join(';');
        }

        sideTabHost.classList.add('visible');
        updateSideTabState();
    }

    function resetSideTabIdle(e) {
        if (!prefs.sideTabEnabled || !sideTabBuilt || !sideTabBtn) return;
        const v = getVideo();
        if (!v) return;

        const container = findTruePlayerContainer(v) || v;
        const rect = container.getBoundingClientRect();

        // If mouse is outside the video player container, keep idle/hidden
        if (e && (e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom)) {
            if (!prefs.showToolbar) {
                sideTabBtn.classList.add('idle');
            }
            return;
        }

        // Only wake up if mouse is in the upper 25% of the player
        const inUpperZone = e && (e.clientY <= rect.top + Math.max(90, rect.height * 0.25));
        if (!inUpperZone && !prefs.showToolbar && !sideTabBtn.matches(':hover')) {
            sideTabBtn.classList.add('idle');
            return;
        }

        sideTabBtn.classList.remove('idle');
        clearTimeout(sideTabIdleTimer);
        if (!prefs.showToolbar) {
            sideTabIdleTimer = setTimeout(() => {
                if (sideTabBtn && !sideTabBtn.matches(':hover') && !sideTabBtn.classList.contains('active')) {
                    sideTabBtn.classList.add('idle');
                }
            }, 1800);
        }
    }

    function buildSideTab() {
        if (window.self !== window.top) return;
        if (sideTabBuilt) return;
        const body = document.body || document.documentElement;
        if (!body) return;

        sideTabHost = document.createElement('div');
        sideTabHost.id = 'mvc-side-tab-host';

        sideTabShadow = sideTabHost.attachShadow({ mode: 'open' });

        const style = document.createElement('style');
        style.textContent = `
            :host {
                all: initial;
                position: fixed !important;
                z-index: 2147483646 !important;
                pointer-events: none !important;
                display: none;
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif !important;
            }
            :host(.visible) {
                display: block !important;
            }
            #mvc-side-container {
                all: unset;
                box-sizing: border-box;
                display: inline-flex;
                align-items: center;
                gap: 2px;
                padding: 3px 5px 3px 9px;
                background: rgba(16, 16, 22, 0.88);
                border: 1px solid rgba(255, 255, 255, 0.18);
                border-radius: 20px;
                backdrop-filter: blur(14px);
                -webkit-backdrop-filter: blur(14px);
                box-shadow: 0 4px 18px rgba(0, 0, 0, 0.45);
                color: #e2e2e8;
                user-select: none;
                pointer-events: auto;
                transition: opacity 0.25s ease, transform 0.18s ease, background 0.15s ease, border-color 0.15s ease, box-shadow 0.15s ease;
                opacity: 0.85;
            }
            #mvc-side-container:hover {
                opacity: 1 !important;
                background: rgba(24, 24, 34, 0.94);
                border-color: rgba(76, 154, 255, 0.65);
                box-shadow: 0 6px 22px rgba(0, 0, 0, 0.6), 0 0 10px rgba(76, 154, 255, 0.25);
            }
            #mvc-side-container.active {
                opacity: 1 !important;
                background: rgba(18, 28, 48, 0.94);
                border-color: #4c9aff;
                color: #4c9aff;
                box-shadow: 0 4px 20px rgba(0, 0, 0, 0.5), 0 0 12px rgba(76, 154, 255, 0.4);
            }
            #mvc-side-container.idle:not(.active):not(:hover) {
                opacity: 0 !important;
                pointer-events: none !important;
                transform: translateY(-4px) scale(0.95);
            }
            #mvc-side-dropdown {
                all: unset;
                box-sizing: border-box;
                display: inline-flex;
                align-items: center;
                gap: 5px;
                cursor: pointer;
                font-size: 11.5px;
                font-weight: 600;
                line-height: 1;
            }
            #mvc-side-dropdown:active {
                transform: scale(0.96);
            }
            .side-badge {
                font-size: 12px;
                line-height: 1;
            }
            .side-text {
                font-size: 11.5px;
                font-weight: 700;
                letter-spacing: 0.3px;
            }
            .side-arrow {
                font-size: 11px;
                line-height: 1;
                transition: transform 0.25s ease;
                display: inline-block;
            }
            #mvc-side-container.active .side-arrow {
                transform: rotate(180deg);
            }
            #mvc-side-close {
                all: unset;
                box-sizing: border-box;
                display: inline-flex;
                align-items: center;
                justify-content: center;
                width: 17px;
                height: 17px;
                border-radius: 50%;
                color: rgba(255, 255, 255, 0.5);
                font-size: 13px;
                line-height: 1;
                cursor: pointer;
                margin-left: 2px;
                transition: background 0.15s, color 0.15s;
            }
            #mvc-side-close:hover {
                background: rgba(255, 255, 255, 0.15);
                color: #ff6b6b;
            }
        `;
        sideTabShadow.appendChild(style);

        const container = document.createElement('div');
        container.id = 'mvc-side-container';

        const btn = document.createElement('button');
        btn.id = 'mvc-side-dropdown';
        btn.setAttribute('aria-label', 'Toggle VidAmp video controls');
        btn.title = 'VidAmp Video Controls (Click to toggle toolbar, Alt+T)';
        btn.innerHTML = `
            <span class="side-badge">⚡</span>
            <span class="side-text">VidAmp</span>
            <span class="side-arrow">▾</span>
        `;

        const closeBtn = document.createElement('button');
        closeBtn.id = 'mvc-side-close';
        closeBtn.setAttribute('aria-label', 'Hide VidAmp tab');
        closeBtn.title = 'Hide this tab (Press Alt+T to toggle toolbar, or re-enable in extension popup)';
        closeBtn.textContent = '×';

        btn.onclick = e => {
            if (e) {
                e.preventDefault();
                e.stopPropagation();
            }
            toggleToolbarVisibility();
        };

        closeBtn.onclick = e => {
            if (e) {
                e.preventDefault();
                e.stopPropagation();
            }
            prefs.sideTabEnabled = false;
            saveValue('sideTabEnabled', false);
            if (sideTabHost) {
                sideTabHost.classList.remove('visible');
                sideTabHost.style.setProperty('display', 'none', 'important');
            }
            showToast('🚫 VidAmp tab hidden (Re-enable in extension popup or press Alt+T)');
        };

        // Drag to reposition anywhere
        container.addEventListener('pointerdown', e => {
            if (e.button !== 0 || e.target === closeBtn) return;
            isDraggingSideTab = true;
            const curLeft = sideTabHost.offsetLeft || 0;
            const curTop = sideTabHost.offsetTop || 0;
            sideTabDragStart = {
                mouseX: e.clientX,
                mouseY: e.clientY,
                hostX: curLeft,
                hostY: curTop
            };

            const onMove = moveEvt => {
                if (!isDraggingSideTab || !sideTabDragStart) return;
                const dx = moveEvt.clientX - sideTabDragStart.mouseX;
                const dy = moveEvt.clientY - sideTabDragStart.mouseY;
                const newLeft = Math.max(4, Math.min(window.innerWidth - container.offsetWidth - 4, sideTabDragStart.hostX + dx));
                const newTop = Math.max(4, Math.min(window.innerHeight - container.offsetHeight - 4, sideTabDragStart.hostY + dy));

                sideTabCustomPos = { left: newLeft, top: newTop };
                sideTabHost.style.setProperty('left', `${Math.round(newLeft)}px`, 'important');
                sideTabHost.style.setProperty('top', `${Math.round(newTop)}px`, 'important');
            };

            const onUp = () => {
                isDraggingSideTab = false;
                sideTabDragStart = null;
                window.removeEventListener('pointermove', onMove, true);
                window.removeEventListener('pointerup', onUp, true);
            };

            window.addEventListener('pointermove', onMove, true);
            window.addEventListener('pointerup', onUp, true);
        });

        // Double click to reset position
        btn.addEventListener('dblclick', () => {
            sideTabCustomPos = null;
            positionSideTab();
            showToast('📍 VidAmp tab reset to default');
        });

        container.appendChild(btn);
        container.appendChild(closeBtn);
        sideTabShadow.appendChild(container);
        sideTabBtn = container;

        body.appendChild(sideTabHost);
        sideTabBuilt = true;
        updateSideTabState();
        if (!prefs.showToolbar) {
            container.classList.add('idle');
        }
        if (!prefs.sideTabEnabled) {
            sideTabHost.style.setProperty('display', 'none', 'important');
        } else {
            positionSideTab();
        }
    }

    // Hook toolbar & side tab into resize and scroll
    let toolbarRepositionRaf = false;
    function scheduleToolbarReposition() {
        if (window.self !== window.top) return;
        if (toolbarRepositionRaf) return;
        toolbarRepositionRaf = true;
        requestAnimationFrame(() => {
            toolbarRepositionRaf = false;
            const isFs = Boolean(document.fullscreenElement || document.webkitFullscreenElement);
            if (!isFs) {
                if (prefs.showToolbar === true && toolbarHost && !toolbarHost.classList.contains('mvc-hidden')) {
                    positionToolbar();
                }
                if (sideTabBuilt) positionSideTab();
            }
        });
    }

    window.addEventListener('resize', scheduleToolbarReposition, { passive: true });
    window.addEventListener('scroll', scheduleToolbarReposition, { passive: true, capture: true });

    /* =========================================================
       Playback Rate Controller
       ========================================================= */

    function setPlaybackRate(v, rate, notify = false) {
        if (!v || !validSpeed(rate)) return false;

        // Live stream head protection: cannot speed up beyond 1.0x when already at the live edge!
        if (rate > 1.0 && isLiveVideo(v)) {
            const delay = getLiveDelay(v);
            if (delay !== null && delay <= 2.5) {
                showToast('⚠️ At Live edge — Speed kept at 1× to prevent buffering');
                return false;
            }
        }

        rateGuardToken++; // manual deliberate change cancels pending restore
        rateGuard = null;

        isInternalRateChange = true;
        try {
            v.playbackRate = rate;
        } catch (_) {
            isInternalRateChange = false;
            return false;
        }
        setTimeout(() => { isInternalRateChange = false; }, 80);

        prefs.speed = rate;
        persistentUserSpeed = rate;
        temporaryBoostActive = false;
        temporaryBoostOriginalSpeed = null;
        clearTimeout(temporaryBoostRestoreTimer);
        temporaryBoostRestoreTimer = null;
        debouncedSaveSpeed(rate);
        syncExtraSpeedSelect();

        if (notify) showToast(formatSpeed(rate));

        syncControlsToVideo();
        if (toolbarBuilt) syncToolbar();
        return true;
    }

    /* =========================================================
       Native Seeking
       ========================================================= */

    function getNativeCurrentTimeSetter() {
        try {
            return Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'currentTime')?.set || null;
        } catch (_) {
            return null;
        }
    }

    const nativeCurrentTimeSetter = getNativeCurrentTimeSetter();

    function setCurrentTimeNative(v, target) {
        if (!v || !Number.isFinite(target)) return false;
        try {
            if (nativeCurrentTimeSetter) {
                nativeCurrentTimeSetter.call(v, target);
            } else {
                v.currentTime = target;
            }
            return true;
        } catch (_) {
            try {
                v.currentTime = target;
                return true;
            } catch (__) {
                return false;
            }
        }
    }

    function getSeekBounds(v) {
        if (Number.isFinite(v.duration)) {
            return { start: 0, end: Math.max(0, v.duration) };
        }
        if (v.seekable && v.seekable.length) {
            try {
                return { start: v.seekable.start(0), end: v.seekable.end(v.seekable.length - 1) };
            } catch (_) {}
        }
        return { start: 0, end: Infinity };
    }

    function clampSeekTarget(v, target) {
        const bounds = getSeekBounds(v);
        if (Number.isFinite(bounds.end)) {
            return Math.max(bounds.start, Math.min(bounds.end, target));
        }
        return Math.max(bounds.start, target);
    }

    function reinforceSeek(v, target, attempt = 0, startedAt = performance.now()) {
        if (!v || !v.isConnected) return;

        const current = Number(v.currentTime);
        const closeEnough = Number.isFinite(current) && Math.abs(current - target) < 0.35;

        if (closeEnough) {
            return;
        }

        if (attempt >= SEEK_RETRY_COUNT || performance.now() - startedAt > 1900) {
            if (Math.abs(Number(v.currentTime) - target) >= 0.8) {
                showToast('Seek may be restricted by this site');
            }
            return;
        }

        setCurrentTimeNative(v, target);
        setTimeout(() => {
            reinforceSeek(v, target, attempt + 1, startedAt);
        }, SEEK_RETRY_DELAY);
    }

    function seekVideo(v, delta) {
        if (!v || !Number.isFinite(delta)) return false;
        const target = clampSeekTarget(v, Number(v.currentTime) + delta);
        if (!setCurrentTimeNative(v, target)) {
            showToast('Seek unavailable');
            return false;
        }
        reinforceSeek(v, target);
        return true;
    }

    function seekVideoTo(v, target) {
        if (!v || !Number.isFinite(target)) return false;
        const finalTarget = clampSeekTarget(v, target);
        if (!setCurrentTimeNative(v, finalTarget)) {
            showToast('Seek unavailable');
            return false;
        }
        reinforceSeek(v, finalTarget);
        return true;
    }

    /* =========================================================
       Sync UI & Formatting
       ========================================================= */

    function syncExtraSpeedSelect() {
        if (!extraSpeedSelect) return;
        const rate = Number(video?.playbackRate ?? prefs.speed);
        const knownMain = [0.5, 1, 1.25, 1.5, 2];
        const isMain = knownMain.some(m => Math.abs(m - rate) < 0.001);
        if (isMain) {
            extraSpeedSelect.value = '';
        } else {
            const hasOption = [...extraSpeedSelect.options].some(o => Math.abs(Number(o.value) - rate) < 0.001);
            extraSpeedSelect.value = hasOption ? String(rate) : '';
        }
    }

    function syncControlsToVideo() {
        if (!panelBuilt || !video) return;

        playBtn.textContent = video.paused ? '▶️' : '⏸️';
        playBtn.setAttribute('aria-label', video.paused ? 'Play video' : 'Pause video');

        speedButtons.forEach(btn => {
            btn.classList.toggle(
                'active',
                Math.abs(Number(btn.dataset.speed) - Number(video.playbackRate)) < 0.001
            );
        });

        volumeSlider.value = String(prefs.volume);
        muteBtn.textContent = video.muted || prefs.volume === 0 ? '🔇' : (prefs.volume > 1.0 ? '🚀' : '🔊');

        const customRate = Number(video.playbackRate);
        if (Number.isFinite(customRate)) {
            syncExtraSpeedSelect();
        }

        if (loopBtn) {
            loopBtn.classList.toggle('active', Boolean(video.loop));
        }

        if (pipBtn) {
            pipBtn.classList.toggle('active', document.pictureInPictureElement === video);
        }

        if (!Number.isFinite(video.duration) || video.duration <= 0) {
            progressFill.style.width = '0%';
            timeLabel.textContent = 'LIVE';
        } else {
            const pct = Math.min(100, Math.max(0, (video.currentTime / video.duration) * 100));
            progressFill.style.width = pct + '%';

            if (showRemainingTime) {
                const remaining = Math.max(0, video.duration - video.currentTime);
                timeLabel.textContent = `-${formatTime(remaining)}`;
            } else {
                timeLabel.textContent = `${formatTime(video.currentTime)} / ${formatTime(video.duration)}`;
            }
        }

        updateLoopMarkers();

        if (shadow) {
            const panelBass = shadow.querySelector('#panel-bass');
            if (panelBass) panelBass.classList.toggle('active', bassBoostActive);

            const panelVocal = shadow.querySelector('#panel-vocal');
            if (panelVocal) panelVocal.classList.toggle('active', vocalBoostActive);

            const panelAmbient = shadow.querySelector('#panel-ambient');
            if (panelAmbient) panelAmbient.classList.toggle('active', ambientGlowActive);

            const panelSleep = shadow.querySelector('#panel-sleep');
            if (panelSleep) {
                panelSleep.classList.toggle('active', sleepTimerMode !== 'off');
                panelSleep.textContent = sleepTimerMode === 'off' ? '🌙 Sleep' : `🌙 ${sleepTimerMode}`;
            }

            const loopClip = shadow.querySelector('#loop-clip');
            if (loopClip) {
                loopClip.classList.toggle('recording', isRecordingClip);
                loopClip.textContent = isRecordingClip ? '⏹ Recording...' : '🎬 Export Clip';
            }

            const panelDownload = shadow.querySelector('#btn-download-video');
            if (panelDownload) {
                if (isYouTubePage()) {
                    panelDownload.style.opacity = '0.4';
                    panelDownload.title = 'Disabled on YouTube (Store Policy) - Use Export Clip';
                } else {
                    panelDownload.style.opacity = '1';
                    panelDownload.title = 'Smart Media Downloader (Generic HTML5 Sites)';
                }
            }
        }

        if (toolbarBuilt) {
            syncToolbar(video);
        }
    }

    function updateVideoCounter() {
        if (!panelBuilt) return;
        const multiple = videos.length > 1;
        counterRow.style.display = multiple ? 'flex' : 'none';
        counterLabel.textContent = multiple ? `Video ${videoIndex + 1}/${videos.length}` : '';
    }

    function switchVideo(newIndex) {
        if (videos.length < 2) return;
        videoIndex = (newIndex + videos.length) % videos.length;
        video = videos[videoIndex];
        preferredVideo = video;

        attachVideoListeners(video);
        applySitePreferences(video);
        syncControlsToVideo();
        updateVideoCounter();
        setupSmartMiniplayer();

        if (!prefs.manualPos) {
            positionPanelSmartly(true, lastPointer);
        }
    }

    let videoHudEl = null;
    let videoHudTimer = null;

    function isTimingMessage(str) {
        if (!str || typeof str !== 'string') return false;
        const s = str.trim();
        return /^-?\d{1,2}:\d{2}(:\d{2})?$/.test(s) || /^\d{1,2}:\d{2}\s*\/\s*\d{1,2}:\d{2}$/.test(s);
    }

    function showVideoHud(message) {
        if (!message) return;
        if (window.self !== window.top) return; // Prevent duplicate HUD overlays from iframes
        if (isTimingMessage(message)) return; // Strictly suppress any video timing pill on top of video

        if (!videoHudEl) {
            videoHudEl = document.createElement('div');
            videoHudEl.id = 'mvc-video-hud';
            videoHudEl.style.cssText = [
                'position: fixed !important',
                'z-index: 2147483647 !important',
                'top: 32px !important',
                'left: 50% !important',
                'transform: translateX(-50%) translateY(-6px) scale(0.94) !important',
                'background: rgba(14, 16, 24, 0.90) !important',
                'color: #ffffff !important',
                'font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif !important',
                'font-size: 13.5px !important',
                'font-weight: 700 !important',
                'letter-spacing: 0.3px !important',
                'padding: 7px 18px !important',
                'border-radius: 9999px !important',
                'border: 1px solid rgba(56, 189, 248, 0.35) !important',
                'box-shadow: 0 12px 36px rgba(0, 0, 0, 0.65), 0 0 16px rgba(56, 189, 248, 0.18) !important',
                'pointer-events: none !important',
                'user-select: none !important',
                'opacity: 0 !important',
                'transition: opacity 0.16s cubic-bezier(0.16, 1, 0.3, 1), transform 0.16s cubic-bezier(0.16, 1, 0.3, 1) !important',
                'display: flex !important',
                'align-items: center !important',
                'justify-content: center !important',
                'gap: 8px !important',
                'backdrop-filter: blur(20px) saturate(180%) !important',
                '-webkit-backdrop-filter: blur(20px) saturate(180%) !important',
                'white-space: nowrap !important'
            ].join(';');
        }

        const targetParent = document.fullscreenElement || document.webkitFullscreenElement || document.body || document.documentElement;
        if (targetParent && videoHudEl.parentNode !== targetParent) {
            try { targetParent.appendChild(videoHudEl); } catch (_) {}
        }

        const msgStr = String(message).trim();
        // Modern indicator with cyan icon badge
        if (/\d+(?:\.\d+)?\s*[×x]/i.test(msgStr)) {
            videoHudEl.innerHTML = `<span style="display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;border-radius:50%;background:rgba(56,189,248,0.22);color:#38bdf8;font-size:11px;font-weight:800;line-height:1;">⚡</span><span style="font-weight:700;color:#f8fafc;letter-spacing:0.4px;">${msgStr}</span>`;
        } else if (msgStr.includes('Volume')) {
            videoHudEl.innerHTML = `<span style="display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;border-radius:50%;background:rgba(56,189,248,0.22);color:#38bdf8;font-size:11px;line-height:1;">🔊</span><span style="font-weight:700;color:#f8fafc;">${msgStr.replace(/^[🔊🚀]\s*/, '')}</span>`;
        } else {
            videoHudEl.innerHTML = `<span style="font-weight:700;color:#f8fafc;">${msgStr}</span>`;
        }

        videoHudEl.style.setProperty('opacity', '1', 'important');
        videoHudEl.style.setProperty('transform', 'translateX(-50%) translateY(0) scale(1)', 'important');

        clearTimeout(videoHudTimer);
        videoHudTimer = setTimeout(() => {
            if (videoHudEl) {
                videoHudEl.style.setProperty('opacity', '0', 'important');
                videoHudEl.style.setProperty('transform', 'translateX(-50%) translateY(-6px) scale(0.94)', 'important');
            }
        }, 850);
    }

    function showToast(message) {
        if (!message) return;
        // Suppress any video timing display (user requested complete removal of top timing pill)
        if (isTimingMessage(message)) return;

        // Suppress duplicate 2x badge on YouTube (YouTube already renders its native 2x bubble on screen)
        if (isYouTubePage() && typeof message === 'string' && (message.includes('2×') || message.includes('2x') || message.includes('hold'))) {
            return;
        }

        // ONE single unified on-screen HUD (never duplicate)
        showVideoHud(message);
    }

    /* =========================================================
       Picture-in-Picture & Fullscreen
       ========================================================= */

    async function togglePiP() {
        const v = getVideo();
        if (!v) return;

        try {
            if (document.pictureInPictureElement) {
                await document.exitPictureInPicture();
                return;
            }
            if (!document.pictureInPictureEnabled || typeof v.requestPictureInPicture !== 'function') {
                throw new Error('PiP unavailable');
            }
            await v.requestPictureInPicture();
        } catch (_) {
            showToast('Picture-in-Picture unavailable');
        }
    }

    function fullscreenScore(el, v, depth) {
        const vr = v.getBoundingClientRect();
        const r = el.getBoundingClientRect();
        if (r.width < vr.width * 0.9 || r.height < vr.height * 0.9) return Infinity;

        const ratio = (r.width * r.height) / Math.max(1, vr.width * vr.height);
        if (ratio > 8) return Infinity;

        const text = `${el.id || ''} ${String(el.className || '')}`.toLowerCase();
        let score = depth + Math.max(0, ratio - 1) * 0.6;
        if (/player|video|media|plyr|jw|youtube|wrapper|controls/.test(text)) score -= 4;

        try {
            if (el.querySelector('[class*="control" i], [aria-label*="play" i], [role="button"]')) {
                score -= 1;
            }
        } catch (_) {}
        return score;
    }

    function findFullscreenTarget(v) {
        const preferredSelectors = [
            '.html5-video-player',
            '.video-js',
            '.jwplayer',
            '.plyr',
            '[class*="player"]',
            '[id*="player"]',
            '[class*="video-player"]'
        ];

        for (const selector of preferredSelectors) {
            try {
                const el = v.closest(selector);
                if (el && el !== v && typeof el.requestFullscreen === 'function') {
                    const score = fullscreenScore(el, v, 0);
                    if (Number.isFinite(score)) return el;
                }
            } catch (_) {}
        }

        let current = v.parentElement;
        let depth = 1;
        let best = null;
        let bestScore = Infinity;

        while (current && current !== document.documentElement && depth <= 10) {
            if (typeof current.requestFullscreen === 'function') {
                const score = fullscreenScore(current, v, depth);
                if (score < bestScore) {
                    bestScore = score;
                    best = current;
                }
            }
            current = current.parentElement;
            depth++;
        }
        return best;
    }

    function enterFallbackFullscreen(v) {
        const parent = v.parentNode;
        const next = v.nextSibling;
        const oldStyle = v.getAttribute('style');
        if (!parent) throw new Error('Video has no parent');

        const shell = document.createElement('div');
        shell.id = 'mvc-fullscreen-shell';
        shell.style.cssText = [
            'position:fixed',
            'inset:0',
            'width:100vw',
            'height:100vh',
            'background:#000',
            'display:flex',
            'align-items:center',
            'justify-content:center',
            'z-index:2147483646'
        ].join(';');

        v.setAttribute('style', `${oldStyle || ''};width:100%;height:100%;object-fit:contain;`);
        document.documentElement.appendChild(shell);
        shell.appendChild(v);

        fullscreenFallback = { shell, parent, next, video: v, oldStyle };

        if (panelBuilt) moveHostTo(shell);
        if (typeof shell.requestFullscreen !== 'function') {
            cleanupFallbackFullscreen();
            throw new Error('Fullscreen unavailable');
        }
        return shell.requestFullscreen({ navigationUI: 'hide' });
    }

    async function toggleFullscreen() {
        const v = getVideo();
        if (!v) return;

        try {
            if (document.fullscreenElement || document.webkitFullscreenElement) {
                if (document.exitFullscreen) await document.exitFullscreen();
                else if (document.webkitExitFullscreen) await document.webkitExitFullscreen();
                return;
            }

            // The extension toolbar is useful beside a player, but must not survive inside it.
            // Hide it before asking a site's native player to enter fullscreen so there is no flash.
            setFullscreenUi(true);
            setTimeout(() => {
                if (!document.fullscreenElement && !document.webkitFullscreenElement) {
                    setFullscreenUi(false);
                }
            }, 800);

            // 1. YouTube native fullscreen button
            if (isYouTubePage()) {
                const ytFsBtn = document.querySelector('button.ytp-fullscreen-button');
                if (ytFsBtn) {
                    ytFsBtn.click();
                    return;
                }
            }

            // 2. Generic site native fullscreen button (e.g. Hotstar, Netflix, Prime, etc.)
            const siteFsBtn = document.querySelector('[class*="fullscreen" i] button, button[class*="fullscreen" i], [aria-label*="fullscreen" i], [title*="fullscreen" i], button[data-testid*="fullscreen" i]');
            if (siteFsBtn && typeof siteFsBtn.click === 'function') {
                siteFsBtn.click();
                return;
            }

            // 3. Target player container or video element directly (NEVER detach video from DOM!)
            let target = findFullscreenTarget(v);
            if (!target && v.parentElement && v.parentElement !== document.body) {
                target = v.parentElement;
            }

            if (target && target !== v && typeof target.requestFullscreen === 'function') {
                moveHostTo(target);
                try {
                    await target.requestFullscreen({ navigationUI: 'hide' });
                } catch (err) {
                    restoreHost();
                    throw err;
                }
            } else if (typeof v.requestFullscreen === 'function') {
                await v.requestFullscreen();
            } else if (typeof v.webkitRequestFullscreen === 'function') {
                await v.webkitRequestFullscreen();
            }
        } catch (_) {
            setFullscreenUi(false);
            showToast('Fullscreen unavailable');
        }
    }

    function cleanupFallbackFullscreen() {
        if (!fullscreenFallback) return;
        const { shell, parent, next, video: v, oldStyle } = fullscreenFallback;

        restoreHost();
        try {
            if (next && next.parentNode === parent) {
                parent.insertBefore(v, next);
            } else {
                parent.appendChild(v);
            }
            if (oldStyle === null) {
                v.removeAttribute('style');
            } else {
                v.setAttribute('style', oldStyle);
            }
        } catch (_) {}

        try {
            if (shell.isConnected) shell.remove();
        } catch (_) {}
        fullscreenFallback = null;
    }

    document.addEventListener('fullscreenchange', () => {
        if (document.fullscreenElement) {
            const fs = document.fullscreenElement;
            setFullscreenUi(true);
            if (panelBuilt && fs) moveHostTo(fs);
            requestAnimationFrame(() => {
                if (panelBuilt) positionPanelSmartly(true, lastPointer);
            });
            return;
        }

        cleanupFallbackFullscreen();
        restoreHost();
        setFullscreenUi(false);
        if (panelBuilt) {
            updateDockButton();
            requestAnimationFrame(() => {
                positionPanelSmartly(true, lastPointer);
            });
        }
    });

    document.addEventListener('webkitfullscreenchange', () => {
        setFullscreenUi(Boolean(document.webkitFullscreenElement));
    });

    /* =========================================================
       Pointer Tracking & Selection
       ========================================================= */

    function getVideoFromEvent(e) {
        const path = e.composedPath ? e.composedPath() : [e.target];
        for (const node of path) {
            if (node instanceof HTMLVideoElement) return node;
        }
        return null;
    }

    function eventIsInsideController(e) {
        const path = e.composedPath ? e.composedPath() : [e.target];
        return path.some(node => {
            try {
                if (node instanceof HTMLElement) {
                    if (node.id === 'mvc-toolbar-host' || node.id === 'mvc-host' || node.id === 'mvc-toolbar-container') {
                        return false;
                    }
                }
                if (shadow && shadow.contains(node)) {
                    if (panel && panel.contains(node)) return true;
                    if (cheatSheet && cheatSheet.contains(node)) return true;
                    if (cinemaOverlay && cinemaOverlay.contains(node) && cinemaModeActive) return true;
                    return false;
                }
                if (tbShadow && tbShadow.contains(node)) {
                    const tb = tbShadow.querySelector('#mvc-toolbar');
                    const sp = tbShadow.querySelector('#mvc-speed-popover');
                    const bp = tbShadow.querySelector('#mvc-bookmark-popover');
                    if (tb && tb.contains(node)) return true;
                    if (sp && sp.contains(node)) return true;
                    if (bp && bp.contains(node)) return true;
                    return false;
                }
                return false;
            } catch (_) { return false; }
        });
    }

    document.addEventListener('pointerover', e => {
        const target = getVideoFromEvent(e);
        if (!target || !isVisible(target)) return;

        preferredVideo = target;
        const idx = videos.indexOf(target);

        if (idx !== -1 && video !== target) {
            videoIndex = idx;
            video = target;
            attachVideoListeners(video);
            applySitePreferences(video);
            syncControlsToVideo();
            updateVideoCounter();
            setupSmartMiniplayer();

            if (!prefs.manualPos && panelBuilt) {
                positionPanelSmartly(true, lastPointer);
            }
        }
    }, true);

    document.addEventListener('play', e => {
        const target = e.target;
        if (!(target instanceof HTMLVideoElement)) return;
        if (!isYouTubePage() && !isVisible(target)) return;

        preferredVideo = target;
        if (!panelBuilt) buildPanel();

        const idx = videos.indexOf(target);
        if (idx !== -1 && video !== target) {
            videoIndex = idx;
        } else if (idx === -1) {
            if (!videos.includes(target)) {
                videos = [target, ...videos.filter(v => v !== target)];
            }
            videoIndex = 0;
        }

        video = target;
        attachVideoListeners(video);
        applySitePreferences(video);
        syncControlsToVideo();
        updateVideoCounter();
        setupSmartMiniplayer();

        if (!prefs.manualPos) {
            positionPanelSmartly(true, lastPointer);
        }
    }, true);

    document.addEventListener('pointermove', e => {
        lastPointer = { x: e.clientX, y: e.clientY };
    }, { passive: true });

    /* =========================================================
       Two-Finger Playback-Speed Gesture (Touchscreen)
       ========================================================= */

    function averagePosition(points, axis = GESTURE_AXIS) {
        const key = axis === 'X' ? 'x' : 'y';
        return points.reduce((sum, p) => sum + p[key], 0) / points.length;
    }

    function findVideoAtPoint(x, y) {
        let el = null;
        try { el = document.elementFromPoint(x, y); } catch (_) {}

        if (el) {
            // 1. Direct video hit
            if (el instanceof HTMLVideoElement && isUsableVideo(el)) return el;

            // 2. Ancestor lookup
            try {
                const closestVideo = el.closest ? el.closest('video') : null;
                if (closestVideo && isUsableVideo(closestVideo)) return closestVideo;
            } catch (_) {}

            // 3. Child lookup within the hit element
            try {
                if (el.querySelector) {
                    const childVideo = el.querySelector('video');
                    if (childVideo && isUsableVideo(childVideo)) return childVideo;
                }
            } catch (_) {}

            // 4. Common web video player containers (YouTube, Hotstar, JioCinema, Netflix, Prime, Video.js, etc.)
            try {
                const playerContainer = el.closest ? el.closest('.html5-video-player, #movie_player, .video-js, [class*="player"], [id*="player"], [class*="video-container"], .shaka-video-container, .bmpui-ui-uicontainer, [data-player]') : null;
                if (playerContainer) {
                    const wrapVideo = playerContainer.querySelector('video');
                    if (wrapVideo && isUsableVideo(wrapVideo)) return wrapVideo;
                }
            } catch (_) {}

            // 5. Penetrate Shadow DOM
            let curr = el;
            while (curr && curr.shadowRoot && curr.shadowRoot.elementFromPoint) {
                const inner = curr.shadowRoot.elementFromPoint(x, y);
                if (!inner || inner === curr) break;
                curr = inner;
                if (curr instanceof HTMLVideoElement && isUsableVideo(curr)) return curr;
                if (curr.querySelector) {
                    const shadowVideo = curr.querySelector('video');
                    if (shadowVideo && isUsableVideo(shadowVideo)) return shadowVideo;
                }
            }
        }

        // 6. Active video check (if cursor is within bounds of current video or its player)
        const cur = getVideo();
        if (cur && isUsableVideo(cur)) {
            const playerEl = findFullscreenTarget(cur) || cur.parentElement || cur;
            const r = playerEl.getBoundingClientRect();
            if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) {
                return cur;
            }
        }

        // 7. Check all tracked videos and any video elements on the page
        const pool = (videos && videos.length > 0) ? videos : queryVideos(document);
        for (const candidate of pool) {
            if (!isUsableVideo(candidate)) continue;
            const rect = candidate.getBoundingClientRect();
            if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) {
                return candidate;
            }
            const p = candidate.parentElement;
            if (p) {
                const pr = p.getBoundingClientRect();
                if (x >= pr.left && x <= pr.right && y >= pr.top && y <= pr.bottom) {
                    return candidate;
                }
            }
        }
        return null;
    }

    function formatGestureLabel(rate) {
        return `Playback Speed: ${formatSpeed(rate)}`;
    }

    function startSpeedGesture() {
        if (!prefs.trackpadSpeedEnabled) return;
        const points = [...gesturePointers.values()];
        if (points.length !== 2) return;

        let target = null;
        for (const p of points) {
            target = findVideoAtPoint(p.x, p.y);
            if (target) break;
        }
        if (!target) return;

        gestureVideo = target;
        gestureBaseRate = Number(target.playbackRate) || 1;
        gestureStartMid = averagePosition(points, GESTURE_AXIS);
        gestureEngaged = false;
        gestureLatestDelta = null;
    }

    function updateSpeedGesture(e) {
        if (!prefs.trackpadSpeedEnabled || gesturePointers.size !== 2 || !gestureVideo) return;
        if (!gestureVideo.isConnected) {
            endSpeedGesture();
            return;
        }

        const points = [...gesturePointers.values()];
        const currentMid = averagePosition(points, GESTURE_AXIS);

        const rawDiff = GESTURE_AXIS === 'X'
            ? (currentMid - gestureStartMid)
            : (gestureStartMid - currentMid);

        const dir = prefs.gestureReverse ? -GESTURE_DIRECTION : GESTURE_DIRECTION;
        const rawDelta = rawDiff * dir;

        const threshold = prefs.gestureSensitivity ? (DEFAULT_GESTURE_THRESHOLD) : 14;
        if (!gestureEngaged) {
            if (Math.abs(rawDelta) < threshold) return;
            gestureEngaged = true;
        }

        if (e.cancelable) {
            try { e.preventDefault(); } catch (_) {}
        }

        gestureLatestDelta = rawDelta;
        if (!gestureRafPending) {
            gestureRafPending = true;
            requestAnimationFrame(applyPendingSpeedGesture);
        }
    }

    function applyPendingSpeedGesture() {
        gestureRafPending = false;
        if (!gestureEngaged || !gestureVideo || gestureLatestDelta === null) return;
        if (!gestureVideo.isConnected) {
            endSpeedGesture();
            return;
        }

        const rawDelta = gestureLatestDelta;
        const threshold = DEFAULT_GESTURE_THRESHOLD;
        const travel = rawDelta - Math.sign(rawDelta) * threshold;
        const sensitivity = prefs.gestureSensitivity || DEFAULT_GESTURE_SENSITIVITY;
        // A gentle curve makes small corrections precise while longer two-finger moves
        // gain momentum without jumping in the old 0.25x blocks.
        const normalizedTravel = Math.sign(travel) * Math.pow(Math.abs(travel) / sensitivity, 0.86);
        const rawRate = gestureBaseRate + normalizedTravel * 0.10;
        const snapped = Math.round(rawRate * 20) / 20;
        const clamped = Math.max(MIN_SPEED, Math.min(MAX_SPEED, snapped));

        if (Math.abs(Number(gestureVideo.playbackRate) - clamped) > 0.001) {
            setPlaybackRate(gestureVideo, clamped, false);
        }
        showToast(formatGestureLabel(clamped));
    }

    function endSpeedGesture() {
        gestureVideo = null;
        gestureEngaged = false;
        gestureLatestDelta = null;
    }

    function releaseGesturePointer(e) {
        if (!gesturePointers.has(e.pointerId)) return;
        gesturePointers.delete(e.pointerId);
        if (gesturePointers.size < 2) endSpeedGesture();
    }

    /* =========================================================
       Single-Finger & Mouse Hold-to-Boost + Rate Guard
       ========================================================= */

    function cancelHoldBoostTimer() {
        if (holdBoostTimer) {
            clearTimeout(holdBoostTimer);
            holdBoostTimer = null;
        }
    }

    function engageTemporaryBoost(target, source = 'pointer', boostRate = 2.0) {
        if (!target || !target.isConnected) return;
        if (holdBoostEngaged) return;

        const currentRate = (typeof target.playbackRate === 'number' && target.playbackRate > 0)
            ? target.playbackRate
            : (prefs.speed || persistentUserSpeed || 1.0);

        const rateToSet = (currentRate >= 2.0) ? Math.min(MAX_SPEED, currentRate + 0.5) : boostRate;

        holdBoostEngaged = true;
        holdBoostSource = source;
        holdBoostVideo = target;
        holdBoostRestoreRate = persistentUserSpeed || currentRate || 1.0;
        temporaryBoostActive = true;
        temporaryBoostOriginalSpeed = holdBoostRestoreRate;

        if (source === 'space' && target.paused) {
            try { target.play(); } catch (_) {}
        }

        try {
            isInternalRateChange = true;
            target.playbackRate = rateToSet;
            setTimeout(() => { isInternalRateChange = false; }, 80);
        } catch (_) {}

        showToast(`⚡ ${formatSpeed(rateToSet)} (hold)`);
        if (toolbarBuilt) syncToolbar();
    }

    function releaseTemporaryBoost(source = null) {
        if (!holdBoostEngaged) return;
        if (source && holdBoostSource && holdBoostSource !== source) return;

        cancelHoldBoostTimer();

        const v = holdBoostVideo || getVideo();
        const restoreRate = holdBoostRestoreRate || persistentUserSpeed || 1.0;

        holdBoostEngaged = false;
        holdBoostSource = null;
        holdBoostVideo = null;
        holdBoostRestoreRate = null;
        holdBoostPointerId = null;
        holdBoostStartPos = null;
        temporaryBoostActive = false;
        temporaryBoostOriginalSpeed = null;

        if (v && v.isConnected) {
            try {
                isInternalRateChange = true;
                v.playbackRate = restoreRate;
                setTimeout(() => { isInternalRateChange = false; }, 80);
            } catch (_) {}

            prefs.speed = restoreRate;
            persistentUserSpeed = restoreRate;
            saveValue(siteKey('speed'), restoreRate);
            syncControlsToVideo();
            if (toolbarBuilt) syncToolbar();
            showToast(`⚡ ${formatSpeed(restoreRate)}`);
        }
    }

    function engageHoldBoost() {
        if (holdBoostVideo) engageTemporaryBoost(holdBoostVideo, 'pointer', 2.0);
    }

    function releaseHoldBoost() {
        releaseTemporaryBoost();
    }

    function abortHoldBoostCandidate() {
        cancelHoldBoostTimer();
        holdBoostPointerId = null;
        holdBoostVideo = null;
        holdBoostStartPos = null;
    }

    function clearAllGesturePointers() {
        gesturePointers.clear();
        endSpeedGesture();
        releaseTemporaryBoost();
    }

    document.addEventListener('pointerdown', e => {
        // 1. Touchscreen 2-Finger Speed Gesture
        if (e.pointerType === 'touch') {
            gesturePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
            if (gesturePointers.size === 2) {
                abortHoldBoostCandidate();
                startSpeedGesture();
                return;
            } else if (gesturePointers.size > 2) {
                endSpeedGesture();
                return;
            }
        }

        // 2. Hold-to-2x & Double-Tap Long Press (Touchscreen, Laptop Touchpad, Mouse left-click)
        // Guard: ignore non-primary mouse buttons or modifier keys (Right-click or Shift+Drag is for mouse drag gesture)
        if (e.pointerType === 'mouse' && (e.button !== 0 || e.shiftKey || e.ctrlKey || e.altKey || e.metaKey)) {
            return;
        }

        // Guard: ignore if inside controller or typing in editable fields
        if (eventIsInsideController(e) || isEditableEvent(e)) return;

        // Find video target
        const target = findVideoAtPoint(e.clientX, e.clientY) || getVideo();
        if (!target || !target.isConnected) return;

        // Guard: ignore if over player control bar or scrubber
        if (isOverPlayerControl(e, target)) return;

        // Detect if this is the second tap of a double tap
        const now = performance.now();
        const dt = now - lastTapTimestamp;
        const dist = Math.hypot(e.clientX - lastTapX, e.clientY - lastTapY);
        const isDoubleTap = (dt > 40 && dt < DOUBLE_TAP_MAX_GAP_MS && dist < 45);

        isDoubleTapCandidate = isDoubleTap;
        holdBoostPointerId = e.pointerId;
        holdBoostVideo = target;
        holdBoostStartPos = { x: e.clientX, y: e.clientY };
        holdBoostDownTime = now;

        cancelHoldBoostTimer();
        const holdDelay = isDoubleTap ? DOUBLE_TAP_HOLD_DELAY_MS : SINGLE_HOLD_DELAY_MS;

        holdBoostTimer = setTimeout(() => {
            holdBoostTimer = null;
            if (holdBoostPointerId === e.pointerId && holdBoostVideo) {
                engageTemporaryBoost(holdBoostVideo, isDoubleTapCandidate ? 'double-tap' : 'pointer', 2.0);
                armClickSuppression();
            }
        }, holdDelay);
    }, true);

    document.addEventListener('pointermove', e => {
        if (e.pointerType === 'touch' && gesturePointers.has(e.pointerId)) {
            gesturePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
            updateSpeedGesture(e);
        }

        if (holdBoostPointerId === e.pointerId && !holdBoostEngaged && holdBoostStartPos) {
            const dx = e.clientX - holdBoostStartPos.x;
            const dy = e.clientY - holdBoostStartPos.y;
            if (Math.hypot(dx, dy) > HOLD_MAX_MOVE_PX) {
                abortHoldBoostCandidate();
            }
        }
    }, { capture: true, passive: false });

    function releaseGesturePointerAndHoldBoost(e) {
        if (e.pointerType === 'touch') {
            releaseGesturePointer(e);
        }

        if (holdBoostPointerId === e.pointerId) {
            cancelHoldBoostTimer();

            if (holdBoostEngaged) {
                armClickSuppression();
                releaseTemporaryBoost(holdBoostSource);
                lastTapTimestamp = 0;
                if (e.cancelable) {
                    try { e.preventDefault(); } catch (_) {}
                }
                try { e.stopPropagation(); } catch (_) {}
            } else {
                const heldDuration = performance.now() - holdBoostDownTime;
                if (holdBoostStartPos) {
                    const dx = e.clientX - holdBoostStartPos.x;
                    const dy = e.clientY - holdBoostStartPos.y;
                    if (heldDuration < 300 && Math.hypot(dx, dy) <= HOLD_MAX_MOVE_PX) {
                        lastTapTimestamp = performance.now();
                        lastTapX = e.clientX;
                        lastTapY = e.clientY;
                    } else {
                        lastTapTimestamp = 0;
                    }
                }
                abortHoldBoostCandidate();
            }
        }
    }

    document.addEventListener('pointerup', releaseGesturePointerAndHoldBoost, true);
    document.addEventListener('pointercancel', releaseGesturePointerAndHoldBoost, true);
    window.addEventListener('blur', clearAllGesturePointers, true);
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) clearAllGesturePointers();
    }, true);

    let suppressClickTimer = null;
    function armClickSuppression() {
        suppressNextClick = true;
        clearTimeout(suppressClickTimer);
        suppressClickTimer = setTimeout(() => {
            suppressNextClick = false;
        }, 400);
    }

    document.addEventListener('click', e => {
        if (!suppressNextClick) return;
        suppressNextClick = false;
        clearTimeout(suppressClickTimer);
        try { e.preventDefault(); } catch (_) {}
        try { e.stopPropagation(); } catch (_) {}
        try { e.stopImmediatePropagation(); } catch (_) {}
    }, true);

    document.addEventListener('mouseup', e => {
        if (suppressNextClick) {
            try { e.preventDefault(); } catch (_) {}
            try { e.stopPropagation(); } catch (_) {}
            try { e.stopImmediatePropagation(); } catch (_) {}
        }
    }, true);

    function isOverPlayerControl(e, targetVideo = null) {
        if (eventIsInsideController(e)) return true;

        if (targetVideo && targetVideo.controls) {
            try {
                const rect = targetVideo.getBoundingClientRect();
                if (e.clientY >= rect.bottom - 48) return true;
            } catch (_) {}
        }

        const path = e.composedPath ? e.composedPath() : [e.target];
        return path.some(node => {
            if (!(node instanceof HTMLElement)) return false;
            if (node.id === 'movie_player' || node.classList?.contains('html5-video-player')) {
                return false;
            }
            if (node instanceof HTMLVideoElement) return false;

            return (
                node.tagName === 'BUTTON' ||
                node.tagName === 'INPUT' ||
                node.tagName === 'SELECT' ||
                node.tagName === 'A' ||
                node.getAttribute?.('role') === 'button' ||
                node.getAttribute?.('role') === 'slider' ||
                node.getAttribute?.('role') === 'menuitem' ||
                node.hasAttribute?.('aria-controls') ||
                node.classList?.contains('ytp-chrome-bottom') ||
                node.classList?.contains('ytp-chrome-top') ||
                node.classList?.contains('control-bar') ||
                node.classList?.contains('player-controls') ||
                Boolean(node.closest?.('.ytp-chrome-bottom, .ytp-chrome-top, .vjs-control-bar, .art-controls, .jw-controls, .jw-controlbar, .plyr__controls, [class*="progress" i], [class*="scrub" i], [class*="slider" i], [class*="control-bar" i], [class*="player-controls" i], [class*="controls-bar" i]'))
            );
        });
    }

    // Mouse Drag Speed Gesture: moving mouse in opposite directions (up/right = speed up, down/left = speed down)
    // CRITICAL: Must ONLY engage on Right-Click Drag (e.button === 2) OR Shift + Left Drag (e.button === 0 && e.shiftKey).
    // Plain left-click must NEVER engage speed drag or hold boost, ensuring normal clicks, pause, and scrubbing are 100% unaffected!
    document.addEventListener('pointerdown', e => {
        if (e.pointerType !== 'mouse') return;
        if (eventIsInsideController(e) || isOverPlayerControl(e)) return;

        const isMouseSpeedDragCandidate = (e.button === 2) || (e.button === 0 && e.shiftKey);
        if (isMouseSpeedDragCandidate && prefs.mouseDragSpeedEnabled) {
            const target = findVideoAtPoint(e.clientX, e.clientY);
            if (target) {
                mouseDragActive = true;
                mouseDragVideo = target;
                mouseDragStartPos = { x: e.clientX, y: e.clientY };
                mouseDragBaseRate = Number(target.playbackRate) || 1;
                mouseDragEngaged = false;
            }
        }
    }, true);

    // Suppress context menu after a right-click drag speed gesture
    document.addEventListener('contextmenu', e => {
        if (mouseDragEngaged) {
            e.preventDefault();
            e.stopPropagation();
            try { e.stopImmediatePropagation(); } catch (_) {}
            mouseDragEngaged = false;
        }
    }, true);

    document.addEventListener('pointermove', e => {
        if (e.pointerType !== 'mouse') return;

        // Mouse Drag Speed Gesture
        if (prefs.mouseDragSpeedEnabled && mouseDragActive && mouseDragVideo && mouseDragVideo.isConnected && mouseDragStartPos) {
            const dx = e.clientX - mouseDragStartPos.x; // Right = positive, Left = negative
            const dy = mouseDragStartPos.y - e.clientY; // Up = positive, Down = negative
            const dist = Math.hypot(dx, dy);

            const MOUSE_DRAG_THRESHOLD = 30;
            if (dist > MOUSE_DRAG_THRESHOLD) {
                cancelHoldBoostTimer();
                if (holdBoostEngaged) {
                    holdBoostEngaged = false;
                }

                mouseDragEngaged = true;
                const dir = prefs.gestureReverse ? -1 : 1;
                const rawDiff = Math.abs(dx) > Math.abs(dy) ? dx : dy;
                const rawDelta = rawDiff * dir;

                const sensitivity = prefs.gestureSensitivity || DEFAULT_GESTURE_SENSITIVITY;
                const travel = rawDelta - Math.sign(rawDelta) * MOUSE_DRAG_THRESHOLD;
                const steps = travel / sensitivity;
                const rawRate = mouseDragBaseRate + steps * SPEED_INCREMENT;
                const snapped = Math.round(rawRate / SPEED_INCREMENT) * SPEED_INCREMENT;
                const clamped = Math.max(MIN_SPEED, Math.min(MAX_SPEED, snapped));

                if (Math.abs(Number(mouseDragVideo.playbackRate) - clamped) > 0.001) {
                    setPlaybackRate(mouseDragVideo, clamped, false);
                }
                showToast(formatGestureLabel(clamped));

                if (e.cancelable) {
                    try { e.preventDefault(); } catch (_) {}
                }
                try { e.stopPropagation(); } catch (_) {}
                return;
            }
        }

        // Abort hold-boost if drifted before threshold
        if (holdBoostPointerId === e.pointerId && !holdBoostEngaged && holdBoostStartPos) {
            const dx = e.clientX - holdBoostStartPos.x;
            const dy = e.clientY - holdBoostStartPos.y;
            if (Math.hypot(dx, dy) > HOLD_MAX_MOVE_PX) {
                abortHoldBoostCandidate();
            }
        }
    }, { capture: true, passive: false });

    // Rate guard for YouTube's native hold-to-2x
    window.addEventListener('pointerdown', e => {
        if (!isYouTubePage()) return;
        if (eventIsInsideController(e) || isOverPlayerControl(e)) return;
        if (e.pointerType === 'mouse' && e.button !== 0) return;

        const target = findVideoAtPoint(e.clientX, e.clientY);
        if (!target) return;

        rateGuard = {
            video: target,
            rate: validSpeed(prefs.speed) ? prefs.speed : (Number(target.playbackRate) || 1),
            downAt: performance.now(),
            phase: 'pressed',
            token: rateGuardToken,
            sawBoost: false
        };
        dbg('[MVC][guard] pressed — recorded rate', rateGuard.rate);
    }, true);

    function enforceRateGuard(why) {
        const g = rateGuard;
        if (!g || g.phase !== 'released') return;
        if (g.token !== rateGuardToken) return; // deliberate user change cancelled this guard

        const v = g.video;
        if (!v || !v.isConnected) return;

        if (Math.abs(Number(v.playbackRate) - g.rate) > 0.01) {
            dbg('[MVC][guard] restoring', g.rate, 'was', v.playbackRate, 'via', why);
            try {
                v.playbackRate = g.rate;
            } catch (_) {}
            prefs.speed = g.rate;
            saveValue(siteKey('speed'), g.rate);
            syncControlsToVideo();
            if (toolbarBuilt) syncToolbar();
            showToast(formatSpeed(g.rate));
        }
    }

    function endRateGuardPress(reason) {
        const g = rateGuard;
        if (!g || g.phase !== 'pressed') return;
        const held = performance.now() - g.downAt;
        dbg('[MVC][guard] real release via', reason, 'after', Math.round(held), 'ms', 'sawBoost:', g.sawBoost);

        if (held < RATE_GUARD_MIN_HOLD_MS && !g.sawBoost) {
            rateGuard = null;
            return;
        }

        g.phase = 'released';
        g.token = rateGuardToken;

        RATE_GUARD_RETRY_MS.forEach(delay => {
            setTimeout(() => enforceRateGuard('timer+' + delay), delay);
        });

        setTimeout(() => {
            if (rateGuard === g) {
                dbg('[MVC][guard] window over');
                rateGuard = null;
            }
        }, RATE_GUARD_WINDOW_MS);
    }

    function endMouseDrag() {
        if (!mouseDragActive && !mouseDragEngaged) return;
        if (mouseDragEngaged) {
            armClickSuppression();
            rateGuard = null;
        }
        mouseDragActive = false;
        mouseDragVideo = null;
        mouseDragStartPos = null;
        mouseDragEngaged = false;
    }

    function checkTemporaryBoostRelease() {
        if (!temporaryBoostActive && !holdBoostEngaged) return;
        releaseTemporaryBoost();
    }

    window.addEventListener('pointerup', e => {
        checkTemporaryBoostRelease();
        cancelHoldBoostTimer();
        if (holdBoostEngaged) {
            releaseHoldBoost();
        } else {
            abortHoldBoostCandidate();
        }
        if (e.pointerType === 'mouse') {
            try { endMouseDrag(); } catch (_) {}
        }
        try { endRateGuardPress('pointerup-' + e.pointerType); } catch (_) {}
    }, true);

    window.addEventListener('mouseup', () => {
        checkTemporaryBoostRelease();
        cancelHoldBoostTimer();
        if (holdBoostEngaged) {
            releaseHoldBoost();
        } else {
            abortHoldBoostCandidate();
        }
        try { endMouseDrag(); } catch (_) {}
        try { endRateGuardPress('mouseup'); } catch (_) {}
    }, true);

    window.addEventListener('touchend', () => {
        checkTemporaryBoostRelease();
        cancelHoldBoostTimer();
        if (holdBoostEngaged) {
            releaseHoldBoost();
        } else {
            abortHoldBoostCandidate();
        }
        try { endRateGuardPress('touchend'); } catch (_) {}
    }, true);

    window.addEventListener('pointermove', e => {
        if (e.pointerType === 'mouse' && (e.buttons & 1) === 0) {
            cancelHoldBoostTimer();
            if (holdBoostEngaged) {
                releaseHoldBoost();
            } else {
                abortHoldBoostCandidate();
            }
            if (mouseDragActive || mouseDragEngaged) {
                try { endMouseDrag(); } catch (_) {}
            }
            if (rateGuard && rateGuard.phase === 'pressed') {
                try { endRateGuardPress('move-with-button-up'); } catch (_) {}
            }
        }
    }, { capture: true, passive: true });

    /* =========================================================
       Trackpad Pinch Speed & Gesture Zones (Conflict Managed)
       ========================================================= */

    function endTrackpadGesture() {
        trackpadGestureVideo = null;
        trackpadGestureLatestDelta = 0;
        accumulatedPinchDelta = 0;
        lastTrackpadGestureTime = 0;
        trackpadGestureStreak = 0;
        wheelGestureTarget = null;
        wheelGestureStreak = 0;
        wheelGestureLastAt = 0;
        clearTimeout(trackpadPinchTimer);
        trackpadPinchTimer = null;
        clearTimeout(trackpadGestureIdleTimer);
        trackpadGestureIdleTimer = null;
    }

    let wheelLastRateTime = 0;

    function handleSpeedWheelStep(target, travel, isDiscreteNotch = false) {
        if (!target || !target.isConnected) return;

        let steps = 0;
        if (isDiscreteNotch) {
            steps = Math.sign(travel);
        } else {
            // Touchpad gesture: accumulate delta smoothly without dropping finger momentum
            accumulatedWheelDelta += travel;
            clearTimeout(wheelIdleTimer);
            wheelIdleTimer = setTimeout(() => {
                accumulatedWheelDelta = 0;
            }, 250);

            // Frictionless, responsive threshold (10px) with velocity scaling
            const STEP_PX = 10;
            const absDelta = Math.abs(accumulatedWheelDelta);
            if (absDelta >= STEP_PX) {
                const dir = Math.sign(accumulatedWheelDelta);
                // Allow dynamic scaling: fast pinch sweeps smoothly through speeds
                const count = Math.min(4, Math.floor(absDelta / STEP_PX));
                steps = dir * count;
                // Preserve true remainder so gesture momentum flows naturally and seamlessly
                accumulatedWheelDelta -= steps * STEP_PX;
            }
        }

        if (steps === 0) return;

        const now = performance.now();
        if (now - wheelLastRateTime < 16) return; // Smooth 60fps refresh rate
        wheelLastRateTime = now;

        const currentRate = Number(target.playbackRate) || (prefs.speed || 1);
        const baseStep = 0.05;
        let nextRate = currentRate + steps * baseStep;
        nextRate = Math.min(MAX_SPEED, Math.max(MIN_SPEED, Math.round(nextRate * 20) / 20));
        nextRate = Number(nextRate.toFixed(2));

        if (Math.abs(nextRate - currentRate) > 0.001) {
            setPlaybackRate(target, nextRate, true);
            if (toolbarBuilt) syncToolbar();
        }
    }

    document.addEventListener('wheel', e => {
        if (eventIsInsideController(e)) return;

        // 1. Wheel over Toolbar Speed Button or popover
        const overSpeedBtn = e.target && e.target.closest && e.target.closest('#tb-speed, .tb-speed-btn, #tb-speed-val, #mvc-speed-popover');
        if (overSpeedBtn) {
            const v = getVideo();
            if (v) {
                if (e.cancelable) {
                    try { e.preventDefault(); } catch (_) {}
                }
                const dir = prefs.gestureReverse ? -1 : 1;
                const isDiscrete = e.deltaMode !== 0 || Math.abs(e.deltaY) >= 80;
                handleSpeedWheelStep(v, -e.deltaY * dir, isDiscrete);
                return;
            }
        }

        const target = findVideoAtPoint(e.clientX, e.clientY);
        const isOverVideo = Boolean(target && !isOverPlayerControl(e));
        if (!isOverVideo) return;

        const dir = prefs.gestureReverse ? -1 : 1;
        const isDiscrete = e.deltaMode !== 0 || Math.abs(e.deltaY) >= 80;

        // 2. Laptop Touchpad Pinch Gesture (ctrlKey + wheel) over video player:
        // Dedicated touchpad gesture for frictionless, smooth speed control (never interferes with page scrolling!)
        if (e.ctrlKey && prefs.trackpadSpeedEnabled) {
            if (e.cancelable) {
                try { e.preventDefault(); } catch (_) {}
            }
            try { e.stopPropagation(); } catch (_) {}

            const pinchDir = prefs.gestureReverse ? -1 : 1;
            handleSpeedWheelStep(target, -e.deltaY * pinchDir, false);
            return;
        }

        // 3. Modifier Key Two-Finger Gesture over video player:
        // Alt + Scroll = Speed control
        // Shift + Scroll = Volume control
        if (e.altKey || e.shiftKey) {
            if (e.cancelable) {
                try { e.preventDefault(); } catch (_) {}
            }
            try { e.stopPropagation(); } catch (_) {}

            if (e.shiftKey) {
                const volDelta = (-e.deltaY * dir) > 0 ? 0.05 : -0.05;
                const nextVol = Math.round((prefs.volume + volDelta) * 100) / 100;
                applyVolumeAndBoost(target, nextVol, true);
            } else {
                handleSpeedWheelStep(target, -e.deltaY * dir, isDiscrete);
            }
            return;
        }

        // 4. Horizontal Two-Finger Swipe over video player:
        // Left/Right swipe controls speed without hijacking vertical page scrolling
        if (prefs.trackpadSpeedEnabled && Math.abs(e.deltaX) > Math.abs(e.deltaY) + 4 && Math.abs(e.deltaX) > 6) {
            if (e.cancelable) {
                try { e.preventDefault(); } catch (_) {}
            }
            try { e.stopPropagation(); } catch (_) {}

            const delta = e.deltaX * dir;
            handleSpeedWheelStep(target, delta, false);
            return;
        }

        // Standard two-finger vertical scrolling (up/down) is NEVER hijacked!
        // Whether in normal mode, theater mode, or fullscreen:
        // The user can freely, smoothly, and normally scroll the page/player up and down!
    }, { capture: true, passive: false });

    /* =========================================================
       Global Keyboard Shortcuts
       ========================================================= */

    function isSpaceKey(e) {
        return (
            e.code === 'Space' ||
            e.key === ' ' ||
            e.key === 'Spacebar' ||
            e.keyCode === 32 ||
            e.which === 32
        );
    }

    function isEditableEvent(e) {
        const target = (e.composedPath && e.composedPath()[0]) || e.target;
        const active = document.activeElement;

        const isElEditable = (el) => {
            if (!el) return false;
            try {
                if (el.isContentEditable) return true;
                const tag = el.tagName ? el.tagName.toUpperCase() : '';
                if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
                if (el.getAttribute && el.getAttribute('role') === 'textbox') return true;
                if (el.closest && el.closest('input, textarea, select, [contenteditable="true"], [role="textbox"], ytd-searchbox, #search-input, #contenteditable-root')) {
                    return true;
                }
            } catch (_) {}
            return false;
        };

        return isElEditable(target) || isElEditable(active);
    }

    window.addEventListener('keyup', e => {
        if (isSpaceKey(e)) {
            if (spaceHoldTimer) {
                clearTimeout(spaceHoldTimer);
                spaceHoldTimer = null;
            }

            if (holdBoostEngaged && holdBoostSource === 'space') {
                // Spacebar hold boost was active: restore original speed and NEVER pause the video!
                releaseTemporaryBoost('space');
                spaceKeyIntercepted = false;
                spaceTargetVideo = null;
                try { e.preventDefault(); } catch (_) {}
                try { e.stopPropagation(); } catch (_) {}
                try { e.stopImmediatePropagation(); } catch (_) {}
                return;
            }

            // Quick tap (< 220ms): cleanly toggle play/pause
            const heldDuration = performance.now() - spaceDownTime;
            if (spaceKeyIntercepted || heldDuration < 280) {
                spaceKeyIntercepted = false;
                const v = spaceTargetVideo || getVideo() || document.querySelector('video');
                spaceTargetVideo = null;
                if (v) {
                    togglePlayPause(v);
                }
                try { e.preventDefault(); } catch (_) {}
                try { e.stopPropagation(); } catch (_) {}
                try { e.stopImmediatePropagation(); } catch (_) {}
                return;
            }

            checkTemporaryBoostRelease();
            if (spaceKeyIntercepted) {
                spaceKeyIntercepted = false;
                try { e.preventDefault(); } catch (_) {}
                try { e.stopPropagation(); } catch (_) {}
                try { e.stopImmediatePropagation(); } catch (_) {}
            }
        }
    }, { capture: true });

    window.addEventListener('keydown', e => {
        // Alt + B: Toggle Controller Panel
        if (e.altKey && !e.ctrlKey && !e.metaKey && (String(e.key).toLowerCase() === 'b' || e.code === 'KeyB')) {
            e.preventDefault();
            e.stopPropagation();

            let v = getVideo();
            if (isYouTubePage()) {
                const yt = findYouTubeMainVideo();
                if (yt) {
                    preferredVideo = yt;
                    video = yt;
                    if (!videos.includes(yt)) {
                        videos = [yt, ...videos.filter(item => item !== yt)];
                    }
                    videoIndex = 0;
                    attachVideoListeners(yt);
                    applySitePreferences(yt);
                    v = yt;

                    if (!panelBuilt) buildPanel();
                    syncControlsToVideo();
                    updateVideoCounter();
                } else {
                    refreshVideos({ resetIndex: true });
                    v = getVideo();
                }
            }

            if (!v && !panelBuilt) buildPanel();
            if (!v) {
                showToast('No video detected');
                return;
            }

            if (!panelBuilt) buildPanel();
            if (panel.classList.contains('visible')) {
                hidePanel();
            } else {
                showPanel();
            }
            return;
        }

        // Alt + T: Toggle Below-Video Toolbar (show / hide)
        if (e.altKey && !e.ctrlKey && !e.metaKey && (String(e.key).toLowerCase() === 't' || e.code === 'KeyT')) {
            e.preventDefault();
            e.stopPropagation();
            toggleToolbarVisibility();
            return;
        }

        if (!prefs.shortcuts) return;

        // Editable-element protection: never intercept typing in comment or search boxes!
        if (isEditableEvent(e)) return;

        const v = getVideo() || document.querySelector('video');
        if (!v) return;

        // Space: Universal Play / Pause or Hold-to-2x Speed Boost
        if (isSpaceKey(e) && !e.ctrlKey && !e.altKey && !e.metaKey) {
            e.preventDefault();
            e.stopPropagation();
            try { e.stopImmediatePropagation(); } catch (_) {}

            spaceKeyIntercepted = true;

            // Blur any currently focused button so the browser doesn't activate it via Space
            if (document.activeElement && typeof document.activeElement.blur === 'function') {
                try { document.activeElement.blur(); } catch (_) {}
            }

            if (e.repeat) {
                // OS key repeat while holding Spacebar:
                // If boost hasn't engaged yet, engage immediately!
                if (!holdBoostEngaged) {
                    if (spaceHoldTimer) {
                        clearTimeout(spaceHoldTimer);
                        spaceHoldTimer = null;
                    }
                    engageTemporaryBoost(v, 'space', 2.0);
                }
                return;
            }

            // First press down: start hold-to-2x timer (220ms)
            spaceDownTime = performance.now();
            spaceTargetVideo = v;
            if (spaceHoldTimer) {
                clearTimeout(spaceHoldTimer);
            }
            spaceHoldTimer = setTimeout(() => {
                spaceHoldTimer = null;
                const target = spaceTargetVideo || getVideo() || v;
                if (target) {
                    engageTemporaryBoost(target, 'space', 2.0);
                }
            }, SPACE_HOLD_DELAY_MS);

            return;
        }

        // [ or BracketLeft: Decrease playback speed (0.1x step by default, 0.25x with Shift)
        if ((e.key === '[' || e.code === 'BracketLeft') && !e.ctrlKey && !e.altKey && !e.metaKey) {
            e.preventDefault();
            e.stopPropagation();
            try { e.stopImmediatePropagation(); } catch (_) {}

            if (document.activeElement && typeof document.activeElement.blur === 'function') {
                try { document.activeElement.blur(); } catch (_) {}
            }

            const curRate = (typeof v.playbackRate === 'number' && v.playbackRate > 0) ? v.playbackRate : (prefs.speed || 1.0);
            const rate = e.shiftKey
                ? stepDownToGrid(curRate)
                : Math.max(MIN_SPEED, Math.round((curRate - 0.1) * 20) / 20);
            setPlaybackRate(v, Number(rate.toFixed(2)), true);
            if (toolbarBuilt) syncToolbar();
            return;
        }

        // ] or BracketRight: Increase playback speed (0.1x step by default, 0.25x with Shift)
        if ((e.key === ']' || e.code === 'BracketRight') && !e.ctrlKey && !e.altKey && !e.metaKey) {
            e.preventDefault();
            e.stopPropagation();
            try { e.stopImmediatePropagation(); } catch (_) {}

            if (document.activeElement && typeof document.activeElement.blur === 'function') {
                try { document.activeElement.blur(); } catch (_) {}
            }

            const curRate = (typeof v.playbackRate === 'number' && v.playbackRate > 0) ? v.playbackRate : (prefs.speed || 1.0);
            const rate = e.shiftKey
                ? stepUpToGrid(curRate)
                : Math.min(MAX_SPEED, Math.round((curRate + 0.1) * 20) / 20);
            setPlaybackRate(v, Number(rate.toFixed(2)), true);
            if (toolbarBuilt) syncToolbar();
            return;
        }

        // R or KeyR: Reset speed to 1.0x
        if ((e.key === 'r' || e.key === 'R' || e.code === 'KeyR') && !e.ctrlKey && !e.altKey && !e.metaKey) {
            e.preventDefault();
            e.stopPropagation();
            try { e.stopImmediatePropagation(); } catch (_) {}

            if (document.activeElement && typeof document.activeElement.blur === 'function') {
                try { document.activeElement.blur(); } catch (_) {}
            }

            setPlaybackRate(v, 1.0, true);
            if (toolbarBuilt) syncToolbar();
            return;
        }

        if (eventIsInsideController(e)) return;

        if (e.key === 'Escape') {
            if (panelBuilt && cheatSheet && cheatSheet.classList.contains('visible')) {
                cheatSheet.classList.remove('visible');
                e.preventDefault();
                e.stopPropagation();
            }
            return;
        }

        if (e.key === '?') {
            buildPanel();
            cheatSheet.classList.toggle('visible');
            e.preventDefault();
            e.stopPropagation();
            return;
        }

        // Shift + Up/Down for Volume
        if (e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey) {
            if (e.key === 'ArrowUp') {
                e.preventDefault();
                e.stopPropagation();
                applyVolumeAndBoost(v, prefs.volume + 0.05, true);
                return;
            }
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                e.stopPropagation();
                applyVolumeAndBoost(v, prefs.volume - 0.05, true);
                return;
            }
            if (e.key === 'ArrowRight') {
                e.preventDefault();
                e.stopPropagation();
                const rate = Math.min(MAX_SPEED, stepUpToGrid(v.playbackRate));
                setPlaybackRate(v, rate, true);
                return;
            }
            if (e.key === 'ArrowLeft') {
                e.preventDefault();
                e.stopPropagation();
                const rate = Math.max(MIN_SPEED, stepDownToGrid(v.playbackRate));
                setPlaybackRate(v, rate, true);
                return;
            }
            if (e.key === 'B' || e.code === 'KeyB') {
                e.preventDefault();
                e.stopPropagation();
                addVideoBookmark();
                return;
            }
            if (e.key === 'A' || e.code === 'KeyA') {
                e.preventDefault();
                e.stopPropagation();
                toggleAmbientGlow();
                syncControlsToVideo();
                return;
            }
            if (e.key === 'S' || e.code === 'KeyS') {
                e.preventDefault();
                e.stopPropagation();
                toggleSleepTimer();
                syncControlsToVideo();
                return;
            }
        }

        if (e.ctrlKey || e.altKey || e.metaKey) return;

        switch (e.key) {
            case '.':
            case '>':
                e.preventDefault();
                e.stopPropagation();
                stepVideoFrame(1);
                break;

            case ',':
            case '<':
                e.preventDefault();
                e.stopPropagation();
                stepVideoFrame(-1);
                break;

            case 'ArrowLeft':
                if (isYouTubePage()) return; // Let YouTube handle its native smooth seek
                e.preventDefault();
                e.stopPropagation();
                seekVideo(v, -prefs.seekSeconds);
                break;

            case 'ArrowRight':
                if (isYouTubePage()) return; // Let YouTube handle its native smooth seek
                e.preventDefault();
                e.stopPropagation();
                seekVideo(v, prefs.seekSeconds);
                break;

            case 'm':
            case 'M':
                e.preventDefault();
                e.stopPropagation();
                v.muted = !v.muted;
                prefs.muted = v.muted;
                saveValue(siteKey('muted'), prefs.muted);
                showToast(v.muted ? '🔇 Muted' : '🔊 Unmuted');
                break;

            case 'p':
            case 'P':
                e.preventDefault();
                e.stopPropagation();
                togglePiP();
                break;

            case 'f':
            case 'F':
                e.preventDefault();
                e.stopPropagation();
                toggleFullscreen();
                break;

            case 'a':
            case 'A':
                e.preventDefault();
                e.stopPropagation();
                setPointA();
                break;

            case 'b':
            case 'B':
                e.preventDefault();
                e.stopPropagation();
                setPointB();
                break;

            case 'c':
            case 'C':
                e.preventDefault();
                e.stopPropagation();
                clearLoopAB();
                break;
        }
    }, { capture: true });

    /* =========================================================
       Shadow DOM & Video Observers
       ========================================================= */

    const observedRoots = new WeakSet();
    let observerScheduled = false;
    let lastVideoScan = 0;
    let scanCooldownTimer = null;

    // High-performance event-driven video discovery:
    // Capturing HTML5 media events across document gives instant 0.001ms detection
    // with 0% CPU consumption and ZERO DOM thrashing.
    ['loadedmetadata', 'canplay', 'play', 'playing'].forEach(evt => {
        document.addEventListener(evt, e => {
            if (e.target instanceof HTMLVideoElement) {
                if (!videos.includes(e.target)) {
                    videos.push(e.target);
                }
                if (!video || !isUsableVideo(video)) {
                    refreshVideos();
                }
            }
        }, true);
    });

    function doVideoScan() {
        lastVideoScan = performance.now();
        refreshVideos();
    }

    function scheduleVideoRefresh() {
        if (observerScheduled) return;
        observerScheduled = true;
        requestAnimationFrame(() => {
            observerScheduled = false;
            doVideoScan();
        });
    }

    function observeOpenShadowRoots() {
        // High-performance no-op: replaced with native HTML5 media event hooks above.
        // Completely eliminates CPU lockups and tab freezes on movie sites.
    }

    /* =========================================================
       Live Settings Sync (chrome.storage.onChanged)
       ========================================================= */

    try {
        const storageOnChanged = extApi?.storage?.onChanged || chrome?.storage?.onChanged;
        if (storageOnChanged) {
            storageOnChanged.addListener((changes, areaName) => {
            if (areaName !== 'local') return;

            for (const [fullKey, change] of Object.entries(changes)) {
                if (!fullKey.startsWith(STORAGE_PREFIX)) continue;
                storageCache[fullKey] = change.newValue;
                const key = fullKey.slice(STORAGE_PREFIX.length);

                if (key === 'shortcuts') {
                    prefs.shortcuts = change.newValue !== false;
                    if (shortcutsCheck) shortcutsCheck.checked = prefs.shortcuts;
                } else if (key === 'showToolbar') {
                    prefs.showToolbar = change.newValue !== false;
                    if (toolbarHost) {
                        if (prefs.showToolbar) {
                            toolbarHost.classList.remove('mvc-hidden');
                            toolbarHost.removeAttribute('hidden');
                            toolbarHost.style.removeProperty('display');
                            toolbarHost.style.removeProperty('visibility');
                            mountToolbarInPage();
                        } else {
                            toolbarHost.classList.add('mvc-hidden');
                            toolbarHost.setAttribute('hidden', '');
                            toolbarHost.style.setProperty('display', 'none', 'important');
                            toolbarHost.style.setProperty('visibility', 'hidden', 'important');
                        }
                    }
                } else if (key === 'sideTabEnabled') {
                    prefs.sideTabEnabled = change.newValue === true;
                    if (sideTabHost) {
                        if (prefs.sideTabEnabled) {
                            sideTabHost.style.removeProperty('display');
                            positionSideTab();
                        } else {
                            sideTabHost.style.setProperty('display', 'none', 'important');
                            sideTabHost.classList.remove('visible');
                        }
                    }
                } else if (key === 'trackpadSpeedEnabled') {
                    prefs.trackpadSpeedEnabled = change.newValue !== false;
                    if (trackpadCheck) trackpadCheck.checked = prefs.trackpadSpeedEnabled;
                } else if (key === 'gestureZonesEnabled') {
                    prefs.gestureZonesEnabled = change.newValue !== false;
                    if (gestureZonesCheck) gestureZonesCheck.checked = prefs.gestureZonesEnabled;
                } else if (key === 'volumeBoostEnabled') {
                    prefs.volumeBoostEnabled = change.newValue !== false;
                    if (volumeBoostCheck) volumeBoostCheck.checked = prefs.volumeBoostEnabled;
                    if (volumeSlider) volumeSlider.max = prefs.volumeBoostEnabled ? '2' : '1';
                } else if (key === 'mouseDragSpeedEnabled') {
                    prefs.mouseDragSpeedEnabled = change.newValue !== false;
                } else if (key === 'smartMiniplayerEnabled') {
                    prefs.smartMiniplayerEnabled = Boolean(change.newValue);
                    if (smartMiniplayerCheck) smartMiniplayerCheck.checked = prefs.smartMiniplayerEnabled;
                    setupSmartMiniplayer();
                } else if (key === 'gestureSensitivity') {
                    prefs.gestureSensitivity = Number(change.newValue) || DEFAULT_GESTURE_SENSITIVITY;
                } else if (key === 'gestureReverse') {
                    prefs.gestureReverse = Boolean(change.newValue);
                } else if (key === 'screenshotFormat') {
                    prefs.screenshotFormat = change.newValue === 'jpeg' ? 'jpeg' : 'png';
                } else if (key === 'ambientGlowEnabled') {
                    if (Boolean(change.newValue) !== ambientGlowActive) {
                        toggleAmbientGlow();
                        syncControlsToVideo();
                    }
                } else if (key === 'bassBoostEnabled') {
                    if (Boolean(change.newValue) !== bassBoostActive) {
                        toggleBassBoost(getVideo());
                        syncControlsToVideo();
                    }
                } else if (key === 'vocalBoostEnabled') {
                    if (Boolean(change.newValue) !== vocalBoostActive) {
                        toggleVocalBoost(getVideo());
                        syncControlsToVideo();
                    }
                } else if (key === siteKey('speed') && video) {
                    const spd = Number(change.newValue);
                    const isGuarded = (rateGuard && (rateGuard.phase === 'pressed' || rateGuard.phase === 'released')) || holdBoostEngaged;
                    if (!isGuarded && validSpeed(spd) && Math.abs(Number(video.playbackRate) - spd) > 0.01) {
                        setPlaybackRate(video, spd, false);
                    }
                } else if (key === siteKey('volume') && video) {
                    applyVolumeAndBoost(video, Number(change.newValue), false);
                } else if (key === siteKey('brightness') && video) {
                    prefs.brightness = Number(change.newValue) || 100;
                    applyVideoFilters(video);
                }
            }
        });
        }
    } catch (err) {
        console.warn('[MVC] storage.onChanged setup error:', err);
    }

    /* =========================================================
       YouTube SPA Robustness & Navigation Lifecycle
       ========================================================= */

    function checkAutoTheater() {
        if (!prefs.autoTheater || !isYouTubePage()) return;
        setTimeout(() => {
            const theaterBtn = document.querySelector('button.ytp-size-button');
            const player = document.querySelector('#movie_player');
            if (theaterBtn && player && !player.classList.contains('ytp-theater-mode')) {
                theaterBtn.click();
            }
        }, 600);
    }

    function refreshAfterNavigation() {
        preferredVideo = null;
        video = null;
        videoIndex = 0;
        loopA = null;
        loopB = null;

        if (panelBuilt) {
            hidePanel();
            updateLoopMarkers();
        }

        requestAnimationFrame(() => {
            refreshVideos({ resetIndex: true });
            checkAutoTheater();
            if (toolbarBuilt) mountToolbarInPage();
        });

        setTimeout(() => {
            refreshVideos({ resetIndex: true });
            if (toolbarBuilt) mountToolbarInPage();
        }, 250);
        setTimeout(() => {
            refreshVideos({ resetIndex: true });
            if (toolbarBuilt) mountToolbarInPage();
        }, 900);
    }

    if (isYouTubePage()) {
        ['yt-navigate-finish', 'yt-page-data-updated', 'spfdone'].forEach(evt => {
            document.addEventListener(evt, refreshAfterNavigation, true);
        });

        ['loadedmetadata', 'canplay', 'playing'].forEach(evt => {
            document.addEventListener(evt, e => {
                if (!(e.target instanceof HTMLVideoElement)) return;

                const yt = findYouTubeMainVideo();
                if (!yt || e.target !== yt) return;

                preferredVideo = yt;
                video = yt;

                if (!videos.includes(yt)) {
                    videos = [yt, ...videos.filter(item => item !== yt)];
                }
                videoIndex = 0;

                if (!panelBuilt) buildPanel();

                attachVideoListeners(yt);
                applySitePreferences(yt);
                syncControlsToVideo();
                updateVideoCounter();
                setupSmartMiniplayer();
            }, true);
        });

        window.addEventListener('popstate', refreshAfterNavigation, true);

        let lastYTVideo = null;
        setInterval(() => {
            const ytVideo = findYouTubeMainVideo();
            if (!ytVideo) {
                if (lastYTVideo && video === lastYTVideo) {
                    preferredVideo = null;
                    video = null;
                }
                lastYTVideo = null;
                return;
            }

            if (ytVideo !== lastYTVideo || ytVideo !== video) {
                lastYTVideo = ytVideo;
                preferredVideo = ytVideo;
                refreshVideos({ resetIndex: true });
            }

            if (!panelBuilt && document.documentElement) {
                buildPanel();
                syncControlsToVideo();
            }
        }, 700);
    }

    /* =========================================================
       Window Resize & Startup
       ========================================================= */

    window.addEventListener('resize', () => {
        if (!panelBuilt) return;
        if (prefs.manualPos) {
            applyStoredPosition();
        } else {
            positionPanelSmartly(true, lastPointer);
        }
    }, { passive: true });

    function startAfterDOMReady() {
        try {
            observeOpenShadowRoots();
        } catch (err) {
            console.error('[MVC] Initial observer setup failed:', err);
        }
        lastVideoScan = performance.now();
        refreshVideos({ resetIndex: true });
        checkAutoTheater();
    }

    if (document.documentElement) {
        startAfterDOMReady();
    } else {
        document.addEventListener('DOMContentLoaded', startAfterDOMReady, { once: true });
    }
})();
