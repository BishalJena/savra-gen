export type {
  PptRequest,
  PptJobData,
  JobStatus,
  ContentStrategy,
  JobStatusResponse,
  SlideData,
  PresentationData,
  CacheEntry,
  OutlineRequest,
  GenerateFromOutlineRequest,
} from '@savra/shared';

export {
  normalizeChapter,
  normalizeRequest,
  parsePptRequest,
  buildEmbeddingText,
  generateContentCacheKey,
  generateCacheKey,
  buildDraftOutline,
  generateApprovedCacheKey,
  validatePresentation,
} from '@savra/shared';
