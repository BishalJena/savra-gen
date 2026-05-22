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
} from './types';
export type {
  PptRequest,
  PptJobData,
  JobStatus,
  ContentStrategy,
  JobStatusResponse,
  SlideData,
  QuizQuestion,
  PresentationData,
  CacheEntry,
  OutlineRequest,
  GenerateFromOutlineRequest,
} from './types';
export { SLIDE_TEMPLATES, COLORS } from './templates';
export type { SlideTemplate } from './templates';
export { createStorage, signR2Url } from './storage';
export type { StorageUploadResult } from './storage';
export {
  parseQuizFromBullets,
  parseQuizFromLines,
  getQuizQuestions,
  formatQuizForEditor,
  quizFromEditorText,
  normalizeQuizSlide,
} from './quiz';
