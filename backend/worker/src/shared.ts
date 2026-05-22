export type {
  PptRequest,
  PptJobData,
  JobStatus,
  SlideData,
  PresentationData,
  CacheEntry,
  OutlineRequest,
  GenerateFromOutlineRequest,
} from '@savra/shared';

export {
  normalizeChapter,
  normalizeRequest,
  buildEmbeddingText,
  generateContentCacheKey,
  buildDraftOutline,
} from '@savra/shared';
