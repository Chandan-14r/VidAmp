// VidAmp Pro v6.1 - Settings & Live Storage Controller
// Cross-browser WebExtension API polyfill (Chrome, Edge, Brave, Firefox, Opera, Chromium)
const extApi = (typeof browser !== 'undefined' && browser.storage) ? browser : chrome;

const STORAGE_PREFIX = 'mvc_';

function siteKeyFor(hostname, key) {
    return `${STORAGE_PREFIX}mvc:${hostname.toLowerCase()}:${key}`;
}

function globalKeyFor(key) {
    return `${STORAGE_PREFIX}${key}`;
}

async function getActiveTabHostname() {
    try {
        const [tab] = await extApi.tabs.query({ active: true, currentWindow: true });
        if (!tab || !tab.url) return null;
        return new URL(tab.url).hostname;
    } catch (_) {
        return null;
    }
}

// Navigation Tabs
function initTabs() {
    const tabBtns = document.querySelectorAll('.tab-btn');
    const tabContents = document.querySelectorAll('.tab-content');

    tabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const targetId = btn.getAttribute('data-tab');
            tabBtns.forEach(b => b.classList.remove('active'));
            tabContents.forEach(c => c.classList.remove('active'));

            btn.classList.add('active');
            const targetEl = document.getElementById(targetId);
            if (targetEl) targetEl.classList.add('active');
        });
    });
}

// Bind boolean checkbox to storage
async function bindCheckbox(elementId, storageKey, defaultValue = true) {
    const el = document.getElementById(elementId);
    if (!el) return;

    const fullKey = globalKeyFor(storageKey);
    let stored = {};
    try {
        stored = await extApi.storage.local.get(fullKey);
    } catch (_) {}

    el.checked = stored[fullKey] !== undefined ? stored[fullKey] : defaultValue;

    el.addEventListener('change', () => {
        extApi.storage.local.set({ [fullKey]: el.checked });
    });
}

// Bind select element to storage
async function bindSelect(elementId, storageKey, defaultValue, isNumber = false) {
    const el = document.getElementById(elementId);
    if (!el) return;

    const fullKey = globalKeyFor(storageKey);
    let stored = {};
    try {
        stored = await extApi.storage.local.get(fullKey);
    } catch (_) {}

    const val = stored[fullKey] !== undefined ? stored[fullKey] : defaultValue;
    el.value = String(val);

    el.addEventListener('change', () => {
        const toSave = isNumber ? Number(el.value) : el.value;
        extApi.storage.local.set({ [fullKey]: toSave });
    });
}

// Bind range slider to storage
async function bindRange(rangeId, valDisplayId, storageKey, defaultValue = 55, suffix = 'px') {
    const el = document.getElementById(rangeId);
    const display = document.getElementById(valDisplayId);
    if (!el) return;

    const fullKey = globalKeyFor(storageKey);
    let stored = {};
    try {
        stored = await extApi.storage.local.get(fullKey);
    } catch (_) {}

    const val = stored[fullKey] !== undefined ? Number(stored[fullKey]) : defaultValue;
    el.value = String(val);
    if (display) display.textContent = `${val}${suffix}`;

    el.addEventListener('input', () => {
        if (display) display.textContent = `${el.value}${suffix}`;
        extApi.storage.local.set({ [fullKey]: Number(el.value) });
    });
}

async function initSiteSection() {
    const siteNameEl = document.getElementById('site-name');
    const siteInfoEl = document.getElementById('site-info');
    const resetBtn = document.getElementById('reset-site-btn');

    const hostname = await getActiveTabHostname();
    if (!hostname) {
        siteNameEl.textContent = 'No active video tab';
        resetBtn.disabled = true;
        return;
    }

    siteNameEl.textContent = hostname;
    const perSiteKeys = ['speed', 'volume', 'muted', 'seekSeconds', 'brightness', 'contrast', 'saturate'];
    const fullKeys = perSiteKeys.map(k => siteKeyFor(hostname, k));

    async function renderInfo() {
        let stored = {};
        try {
            stored = await extApi.storage.local.get(fullKeys);
        } catch (_) {}

        const speed = stored[siteKeyFor(hostname, 'speed')];
        const seek = stored[siteKeyFor(hostname, 'seekSeconds')];
        const vol = stored[siteKeyFor(hostname, 'volume')];

        const speedText = speed !== undefined ? `Speed: ${speed}×` : 'Speed: 1×';
        const seekText = seek !== undefined ? `Seek: ±${seek}s` : 'Seek: 10s';
        const volText = vol !== undefined ? `Volume: ${Math.round(vol * 100)}%` : 'Volume: 100%';

        siteInfoEl.textContent = `${speedText}  ·  ${seekText}  ·  ${volText}`;
    }

    await renderInfo();
    resetBtn.disabled = false;

    resetBtn.onclick = async () => {
        try {
            await extApi.storage.local.remove(fullKeys);
        } catch (_) {}
        await renderInfo();
    };
}

async function initFilterReset() {
    const resetFiltersBtn = document.getElementById('reset-filters-btn');
    if (!resetFiltersBtn) return;

    resetFiltersBtn.addEventListener('click', async () => {
        const hostname = await getActiveTabHostname();
        if (!hostname) return;

        const bKey = siteKeyFor(hostname, 'brightness');
        const cKey = siteKeyFor(hostname, 'contrast');
        const sKey = siteKeyFor(hostname, 'saturate');

        await extApi.storage.local.set({
            [bKey]: 100,
            [cKey]: 100,
            [sKey]: 100
        });

        resetFiltersBtn.textContent = '✓ Filters Reset!';
        setTimeout(() => {
            resetFiltersBtn.textContent = 'Reset Video Filters (Brightness / Contrast)';
        }, 1200);
    });
}

document.addEventListener('DOMContentLoaded', async () => {
    initTabs();

    // Gestures
    await bindCheckbox('trackpad-speed-toggle', 'trackpadSpeedEnabled', true);
    await bindCheckbox('trackpad-reverse-toggle', 'gestureReverse', false);
    await bindRange('trackpad-sensitivity', 'trackpad-sensitivity-val', 'gestureSensitivity', 55, 'px');
    await bindCheckbox('mouse-drag-speed-toggle', 'mouseDragSpeedEnabled', true);
    await bindCheckbox('gesture-zones-toggle', 'gestureZonesEnabled', false);

    // Playback
    await bindSelect('seek-select', 'seekSeconds', 10, true);
    await bindCheckbox('shortcuts-toggle', 'shortcuts', true);
    await bindCheckbox('auto-theater-toggle', 'autoTheater', false);

    // Audio & Video
    await bindCheckbox('volume-boost-toggle', 'volumeBoostEnabled', true);
    await bindCheckbox('bass-boost-toggle', 'bassBoostEnabled', false);
    await bindCheckbox('vocal-boost-toggle', 'vocalBoostEnabled', false);
    await bindCheckbox('ambient-glow-toggle', 'ambientGlowEnabled', false);
    await bindSelect('screenshot-format-select', 'screenshotFormat', 'png', false);
    await initFilterReset();

    // Player
    await bindCheckbox('show-toolbar-toggle', 'showToolbar', true);
    await bindCheckbox('smart-miniplayer-toggle', 'smartMiniplayerEnabled', false);

    // Site
    await initSiteSection();
});
