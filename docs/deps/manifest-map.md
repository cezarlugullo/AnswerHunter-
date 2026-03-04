# Manifest Map — AnswerHunter v1.3.0

Source: `manifest.json` (MV3)

## Background

```json
"background": {
  "service_worker": "src/background.js",
  "type": "module"
}
```

- **File**: `src/background.js`
- **Type**: ES module service worker
- **Imports**: 9 direct dependencies (AnalyticsService, BadgeService, ChatGPTAuthService, ContentHierarchyService, CopilotAuthService, GeminiCLIAuthService, SearchService, search/SearchCacheService, PerformanceTimer)

## Content Scripts

```json
"content_scripts": [{
  "matches": ["<all_urls>"],
  "all_frames": true,
  "js": ["src/content/content.js"],
  "css": ["src/content/content.css"]
}]
```

- **JS**: `src/content/content.js` — IIFE, zero imports, lightweight highlight handler
- **CSS**: `src/content/content.css` — highlight styles
- **Scope**: all URLs, all frames

## Popup (Browser Action)

```json
"action": {
  "default_popup": "src/popup/popup.html",
  "default_icon": { "16":"icons/icon16.png", ... }
}
```

- **HTML**: `src/popup/popup.html` (78.8 KB)
- **Scripts loaded**:
  - `src/popup/chrome-mock.js` (non-module, for dev fallback)
  - `src/popup/popup.js` (module entry → PopupController, PopupView, etc.)
- **CSS**: `src/popup/popup.css`

## Declarative Net Request

```json
"declarative_net_request": {
  "rule_resources": [{
    "id": "ruleset_1",
    "enabled": true,
    "path": "src/rules/headers.json"
  }]
}
```

## Permissions

| Permission | Used By |
|---|---|
| `activeTab` | PopupController (extraction via chrome.scripting) |
| `scripting` | PopupController, BackgroundTabExtractorService, CloudflareBypassService |
| `storage` | StorageModel, SettingsModel, all services |
| `tts` | study.js / study-hub.js (text-to-speech for cards) |
| `alarms` | background.js (study reminders, cleanup, Copilot polling) |
| `clipboardWrite` | BinderController (copy to clipboard) |
| `declarativeNetRequest` | headers.json ruleset |
| `tabs` | background.js, PopupController, BackgroundTabExtractorService |
| `windows` | BackgroundTabExtractorService, CloudflareBypassService |
| `identity` | GeminiAuthService (chrome.identity.launchWebAuthFlow) |
| `nativeMessaging` | NativeFetchBridgeService (native host communication) |
| `downloads` | ExportService (download backup files) |
| `notifications` | background.js (study reminders) |

## Host Permissions

- `https://api.groq.com/*` — Groq AI API
- `https://google.serper.dev/*` — Serper search API
- `https://generativelanguage.googleapis.com/*` — Gemini AI API
- `https://cloudcode-pa.googleapis.com/*` — Gemini cloud code
- `https://openrouter.ai/*` — OpenRouter AI API
- `https://accounts.google.com/*`, `https://oauth2.googleapis.com/*`, `https://www.googleapis.com/*` — Google OAuth
- `<all_urls>` — content script injection + tab extraction

## Web Accessible Resources

```json
"web_accessible_resources": [{
  "resources": [
    "src/native/*",
    "src/dashboard/*",
    "src/styles/*.css",
    "src/services/*.js",
    "src/views/*.js",
    "src/study/*",
    "src/fonts/*",
    "src/models/*.js",
    "src/utils/*.js",
    "src/i18n/*.js"
  ],
  "matches": ["<all_urls>"]
}]
```

**Note**: These patterns are overly broad — they expose all services, models, utils, and views to any webpage. This is necessary for ES module imports from extension pages opened via `chrome.runtime.getURL()`, but means any website can `fetch()` these files if it knows the extension ID.

## Icons

| Size | Path |
|---|---|
| 16px | `icons/icon16.png` |
| 32px | `icons/icon32.png` |
| 48px | `icons/icon48.png` |
| 128px | `icons/icon128.png` |
