/**
 * src/services/search/index.js
 * Barrel re-export for all search sub-services.
 * Import from this module to get access to all sub-services.
 */
export { QuestionParser } from './QuestionParser.js';
export { OptionsMatchService } from './OptionsMatchService.js';
export { HtmlExtractorService } from './HtmlExtractorService.js';
export { EvidenceService } from './EvidenceService.js';
export { SearchCacheService } from './SearchCacheService.js';
