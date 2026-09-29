# Privacy Policy for VidAmp

**Effective Date:** September 29, 2026  
**Developer:** Chandan ([GitHub: Chandan-14r](https://github.com/Chandan-14r))  
**Project:** VidAmp - Universal Video Enhancer & Speed Controller

---

## 1. Overview
VidAmp ("the extension") is committed to protecting your privacy. This policy outlines how user data is handled. In short: **VidAmp does not collect, transmit, store on remote servers, or sell any of your personal data.**

---

## 2. Information Collection and Usage
VidAmp functions entirely client-side inside your web browser. 

* **No Personal Data Collected**: VidAmp does not collect names, email addresses, browsing history, IP addresses, or device identifiers.
* **No Analytics or Telemetry**: VidAmp contains zero tracking scripts, analytics SDKs, advertising networks, or external telemetry pings.
* **No Remote Data Transmission**: No video data, bookmarks, audio settings, or screenshots are ever transmitted to any external server or third party.

---

## 3. Browser Permissions & Justifications

| Permission | Purpose & Technical Justification |
| :--- | :--- |
| `storage` | Used strictly to save user preferences locally on your device (e.g., favorite playback speed, EQ bass/vocal toggles, and saved video timestamp bookmarks). Stored via `browser.storage.local`. |
| `activeTab` | Used to detect HTML5 `<video>` elements on the active tab when interacting with popup controls and keyboard shortcuts. |
| Host Permissions (`*://*/*`) | Required so the content script can attach audio processing nodes (Web Audio EQ), overlay the below-video toolbar, and manage video playback speed on web pages containing HTML5 video players. |

---

## 4. Third-Party Services
VidAmp does not integrate with or share data with any third-party services, APIs, or data brokers. All audio filters, video transformations, speed adjustments, and screenshots are executed locally using browser-native APIs (`CanvasRenderingContext2D`, `AudioContext`, `BiquadFilterNode`, and `MediaRecorder`).

---

## 5. Changes to This Policy
Any updates to this Privacy Policy will be reflected in this repository with an updated effective date.

---

## 6. Contact
If you have any questions or feedback regarding this Privacy Policy, please open an issue on the official GitHub repository:  
https://github.com/Chandan-14r/VidAmp
