# AnswerHunter - Technical Documentation

## 1) Overview
AnswerHunter is a Chrome Extension that helps students and educators extract or search for answers to educational questions using AI. It provides two primary workflows:
- Extract: Scrape a visible question/answer from the current page and refine it with AI.
- Search: Search the web for likely sources, extract answers, then vote on the best answer.

It also includes a Binder (Fichario) to save and organize questions, with persistence via chrome.storage.sync.

## 2) Key Features
- Question extraction from the current page (including protected sites with DOM-only heuristics).
- Web search (Serper) + AI refinement (Groq) with multi-source voting.
- AI fallback when sources do not yield an answer.
- Binder: save, organize, drag-and-drop, copy, and delete questions.
- Persist last search results when closing/reopening the popup.
- Export Binder to JSON (manual and optional auto export).
- MVC architecture for maintainable UI and logic separation.

## 3) Architecture (MVC)
The project is structured with MVC plus service layers:

```
src/
  controllers/
    PopupController.js
    BinderController.js
  models/
    SettingsModel.js
    StorageModel.js
  services/
    ApiService.js
    SearchService.js
    ExtractionService.js
  utils/
    helpers.js
  views/
    PopupView.js
  popup/
    popup.html
    popup.css
    popup.js
  content/
    content.js
    content.css
```

### Controllers
- PopupController: Orchestrates user actions in the popup (search/extract/copy). Handles UI status updates, result rendering, and persistence of last results.
- BinderController: Handles binder state, drag-and-drop, CRUD actions, exporting, and sources toggle in the binder list.

### Models
- SettingsModel: Stores API keys, endpoints, and model configs.
- StorageModel: Binder persistence (now in chrome.storage.sync with migration from local).

### Services
- ApiService: All external API calls (Groq + Serper), rate limiting, retries, and model selection.
- SearchService: Search orchestration, multi-source answer extraction, voting, and AI fallback.
- ExtractionService: Content scripts injected into pages for robust question extraction.

### Views
- PopupView: DOM rendering and UI helpers, including question formatting, answer rendering, and source toggles.

## 4) Data Flow

### Extract Flow
1. Popup -> ExtractionService.extractQAContentScript is injected into the active tab.
2. Raw question/answer pairs are returned.
3. SearchService.processExtractedItems() refines answers via Groq.
4. Results are rendered and cached (last search).

### Search Flow
1. Popup -> ExtractionService.extractQuestionOnlyScript (frame-aware) extracts a question.
2. SearchService.searchOnly() calls Serper for results.
3. For each result, ApiService.verifyQuestionMatch() filters mismatched sources.
4. ApiService.refineWithGroq() extracts answer (and options if needed).
5. Answers from multiple sources are voted (simple majority by letter).
6. If no valid answers, fallback to ApiService.generateAnswerFromQuestion().

## 5) AI Model Strategy (Speed vs Accuracy)
AnswerHunter uses multiple Groq models:
- Fast model (validation/match/options): llama-3.1-8b-instant
- Answer model (final answer extraction): llama-3.3-70b-versatile
- Fallback model (direct answer when no sources): llama-3.3-70b-versatile

Model settings live in:
```
src/models/SettingsModel.js
```

## 6) Storage and Persistence

### Binder Storage (Primary)
- Stored in chrome.storage.sync to survive cache clearing and sync across Chrome profiles.
- Auto-migrates data from chrome.storage.local if it exists.

### Last Search Results
- Cached in chrome.storage.local as lastSearchResults.
- Restored on popup open to prevent loss after closing.

### Export
- Manual export via the Exportar button.
- Optional auto export on every change.
- Saved via chrome.downloads to:
  Downloads/AnswerHunter/answerhunter-ficheiro.json

## 7) UI and UX Highlights
- Question formatting: separates statement and alternatives.
- Noise filtering: removes gabarito-like text from alternatives.
- Sources: collapsed list by default with toggle.
- AI badge and disclaimer when no external source is used.

## 8) Permissions and Security
Manifest permissions:
- activeTab: access current tab content.
- scripting: inject extraction scripts.
- storage: persist binder and settings.
- downloads: export binder file.
- host_permissions: Groq + Serper + <all_urls> for extraction.

## 9) Configuration
Settings are stored in chrome.storage.sync and merged with defaults:
- Groq API key and endpoint
- Serper API key and endpoint
- Model IDs (fast, answer, fallback)
- Rate limit interval

IMPORTANT: For open source distribution, remove or replace hardcoded API keys. Users should supply their own keys.

## 10) Installation (Developer Mode)
1. Download this repository.
2. Open chrome://extensions/ in Chrome.
3. Enable Developer mode.
4. Click Load unpacked and select the repository folder (where manifest.json is).

## 11) Development Notes
- Popup entry: src/popup/popup.html
- Popup script (ES modules): src/popup/popup.js
- CSS: src/popup/popup.css
- Content scripts: src/content/content.js

## 12) Troubleshooting
- HTTP 429 from Groq: this is rate limiting. The code retries with backoff.
  You can also increase minGroqIntervalMs in SettingsModel.
- If answers appear inside alternatives: noise filtering removes common gabarito phrases.
  Add more terms in utils/helpers.js if needed.

## 13) Limitations
- Extensions cannot write to arbitrary local paths (project folder) for security reasons.
- Large binder data can exceed chrome.storage.sync limits; consider periodic exports.

## 14) Roadmap Ideas
- Import JSON back into the binder.
- Settings UI for API keys and model selection.
- More robust source ranking and confidence scoring.

## 15) License
Add a license file (MIT/Apache-2.0) before public release.
