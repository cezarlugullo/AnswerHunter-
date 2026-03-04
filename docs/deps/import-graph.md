# Import Graph — AnswerHunter v1.3.0

## Statistics

| Metric | Value |
|---|---|
| Total JS files scanned | 64 (including background.js.bak) |
| Total import edges | 119 |
| Files with zero imports (leaf nodes) | 28 |
| Files with zero importers (root/orphan) | see below |
| Max fan-out (most imports) | `src/controllers/PopupController.js` (18) |
| Max fan-in (most imported by others) | `src/services/search/QuestionParser.js` (10) |

## Top 20 Most-Imported Files (by in-degree)

| Rank | File | Imported by N files |
|---|---|---|
| 1 | `src/services/search/QuestionParser.js` | 10 |
| 2 | `src/services/ApiService.js` | 9 |
| 3 | `src/services/search/OptionsMatchService.js` | 6 |
| 4 | `src/services/NativeFetchBridgeService.js` | 5 |
| 5 | `src/services/ChatGPTAuthService.js` | 4 |
| 6 | `src/services/GeminiCLIAuthService.js` | 4 |
| 7 | `src/services/CopilotAuthService.js` | 4 |
| 8 | `src/services/SearchService.js` | 4 |
| 9 | `src/models/SettingsModel.js` | 4 |
| 10 | `src/services/BackgroundTabExtractorService.js` | 4 |
| 11 | `src/utils/PerformanceTimer.js` | 3 |
| 12 | `src/services/search/SearchCacheService.js` | 3 |
| 13 | `src/services/BadgeService.js` | 3 |
| 14 | `src/services/AnalyticsService.js` | 3 |
| 15 | `src/services/ContentHierarchyService.js` | 3 |
| 16 | `src/models/StorageModel.js` | 3 |
| 17 | `src/i18n/I18nService.js` | 2 |
| 18 | `src/utils/helpers.js` | 2 |
| 19 | `src/services/SearchIndexService.js` | 2 |
| 20 | `src/services/MigrationService.js` | 2 |

## Complete Dependency Graph (A → B means A imports B)

### Service Worker
```
src/background.js
  → src/services/AnalyticsService.js
  → src/services/BadgeService.js
  → src/services/ChatGPTAuthService.js
  → src/services/ContentHierarchyService.js
  → src/services/CopilotAuthService.js
  → src/services/GeminiCLIAuthService.js
  → src/services/SearchService.js
  → src/services/search/SearchCacheService.js
  → src/utils/PerformanceTimer.js
```

### Popup Chain
```
src/popup/popup.js
  → src/controllers/PopupController.js
      → src/controllers/BinderController.js
          → src/i18n/I18nService.js
              → src/i18n/translations.js
              → src/models/SettingsModel.js
          → src/models/StorageModel.js
      → src/controllers/DisciplinasController.js
          → src/models/StorageModel.js
      → src/i18n/I18nService.js
      → src/models/SettingsModel.js
      → src/models/StorageModel.js
      → src/services/ApiService.js
          → src/models/SettingsModel.js
          → src/services/BackgroundTabExtractorService.js
              → src/services/bypass/CloudflareBypassService.js
              → src/services/bypass/HumanMouseSimulator.js
              → src/services/bypass/StealthEvasions.js
          → src/services/ChatGPTAuthService.js
          → src/services/CopilotApiAdapter.js
          → src/services/CopilotAuthService.js
          → src/services/GeminiAuthService.js
          → src/services/GeminiCLIApiAdapter.js
          → src/services/GeminiCLIAuthService.js
      → src/services/ChatGPTAuthService.js
      → src/services/CopilotAuthService.js
      → src/services/CorrectionFeedback.js
      → src/services/ExtractionService.js
      → src/services/GeminiCLIAuthService.js
      → src/services/NativeFetchBridgeService.js
      → src/services/PageGabaritoCache.js
          → src/services/ApiService.js
      → src/services/PlatformExtractors.js
      → src/services/SearchService.js
          → src/services/ApiService.js
          → src/services/BrainlyService.js
          → src/services/NativeFetchBridgeService.js
          → src/services/PasseiDiretoAnswersApiService.js
              → src/services/BackgroundTabExtractorService.js
              → src/services/NativeFetchBridgeService.js
          → src/services/PasseiDiretoService.js
              → src/services/BackgroundTabExtractorService.js
              → src/services/NativeFetchBridgeService.js
          → src/services/SimpleSearchService.js
              → src/services/ApiService.js
              → src/services/BackgroundTabExtractorService.js
              → src/services/NativeFetchBridgeService.js
              → src/services/search/OptionsMatchService.js
              → src/services/search/QuestionParser.js
          → src/services/search/EvidenceService.js
              → src/services/search/OptionsMatchService.js
              → src/services/search/QuestionParser.js
          → src/services/search/FreeTextAnswerService.js
              → src/services/ApiService.js
              → src/services/search/OptionsMatchService.js
              → src/services/search/QuestionParser.js
          → src/services/search/HtmlExtractorService.js
              → src/services/search/OptionsMatchService.js
              → src/services/search/QuestionParser.js
          → src/services/search/OptionsMatchService.js
              → src/services/search/QuestionParser.js
          → src/services/search/QuestionParser.js
          → src/services/search/SearchCacheService.js
          → src/utils/PerformanceTimer.js
      → src/services/search/QuestionParser.js
      → src/utils/PerformanceTimer.js
      → src/utils/QuestionFingerprint.js
      → src/utils/helpers.js
          → src/services/search/QuestionParser.js
  → src/services/ApiService.js
  → src/services/SearchService.js
  → src/utils/DebugLogger.js
  → src/views/PopupView.js
      → src/services/search/QuestionParser.js
      → src/utils/helpers.js
```

### Dashboard v2 Chain
```
src/dashboard/dashboard-v2.js
  → src/services/AnalyticsService.js
  → src/services/BadgeService.js
  → src/services/ContentHierarchyService.js
  → src/services/ExportService.js
      → src/models/SettingsModel.js
  → src/services/MigrationService.js
  → src/services/SearchIndexService.js
  → src/views/ComponentLibrary.js
```

### Study Hub Chain
```
src/study/study-hub.js
  → src/services/AnalyticsService.js
  → src/services/ApiService.js (full sub-tree above)
  → src/services/BadgeService.js
  → src/services/ContentHierarchyService.js
  → src/services/ElevenLabsTTSService.js
  → src/services/ExportService.js
  → src/services/FSRSService.js
  → src/services/FlashcardGeneratorService.js
  → src/services/LearningPathService.js
  → src/services/MigrationService.js
  → src/services/NotesService.js
  → src/services/PedagogicalPromptsService.js
      → src/services/ApiService.js
  → src/services/RecommendationService.js
  → src/services/SearchIndexService.js
  → src/services/StudyPlanService.js
```

### Orphan Files (not imported by anything reachable)
```
src/study/study.js (superseded by study-hub.js)
src/services/search/index.js (barrel file, consumers import directly)
src/dashboard/dashboard.js (loaded only by unreachable dashboard.html legacy page)
```

### Zero-Import Leaf Nodes (28 files)
These files are imported by others but themselves import nothing:
```
src/content/content.js          src/services/AnalyticsService.js
src/dashboard/dashboard.js      src/services/BadgeService.js
src/i18n/translations.js        src/services/BrainlyService.js
src/models/SettingsModel.js      src/services/ChatGPTAuthService.js
src/models/StorageModel.js       src/services/ContentHierarchyService.js
src/popup/chrome-mock.js         src/services/CopilotApiAdapter.js
src/services/CopilotAuthService.js   src/services/CorrectionFeedback.js
src/services/ElevenLabsTTSService.js src/services/ExtractionService.js
src/services/FlashcardGeneratorService.js  src/services/FSRSService.js
src/services/GeminiAuthService.js    src/services/GeminiCLIApiAdapter.js
src/services/GeminiCLIAuthService.js src/services/LearningPathService.js
src/services/MigrationService.js     src/services/NativeFetchBridgeService.js
src/services/NotesService.js         src/services/PlatformExtractors.js
src/services/RecommendationService.js src/services/SearchIndexService.js
src/services/StudyPlanService.js     src/services/search/QuestionParser.js
src/services/search/SearchCacheService.js  src/utils/DebugLogger.js
src/utils/PerformanceTimer.js        src/utils/QuestionFingerprint.js
src/views/ComponentLibrary.js
```

## Cycles

No circular import cycles detected. The graph is a DAG.

## Dynamic Imports (7 occurrences)

All resolve to files already in the static reachable set:

| File | Dynamic Import Target | Already Reachable? |
|---|---|---|
| `PopupController.js:359` | `../services/ApiService.js` | ✅ |
| `PopupController.js:556` | `../services/GeminiCLIAuthService.js` | ✅ |
| `PopupController.js:4702` | `../services/CorrectionFeedback.js` | ✅ |
| `PopupController.js:4737` | `../services/ApiService.js` | ✅ |
| `PopupController.js:4783` | `../services/ApiService.js` | ✅ |
| `PopupController.js:4871` | `../services/ApiService.js` | ✅ |
| `FreeTextAnswerService.js:21` | `../ApiService.js` | ✅ |
