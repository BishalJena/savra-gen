// Shared types for Savra PPT generation system
import { createHash } from 'crypto';

export interface PptRequest {
  chapter: string;
  grade: number;
  subject: string;
  numSlides: number;
  language?: string;
}

export interface PptJobData extends PptRequest {
  cacheKey: string;
  requestedAt: string;
  approvedPresentation?: PresentationData;
}

export type JobStatus = 'queued' | 'processing' | 'done' | 'failed';

export interface SlideData {
  slideType: 'title' | 'bullet-list' | 'two-column' | 'content-with-image' | 'quote-or-definition';
  title: string;
  bullets?: string[];
  bodyText?: string;
  leftContent?: string;
  rightContent?: string;
  quoteText?: string;
  speakerNote?: string;
}

export interface PresentationData {
  presentationTitle: string;
  slides: SlideData[];
}

export interface OutlineRequest extends PptRequest {}

export interface GenerateFromOutlineRequest extends PptRequest {
  presentation: PresentationData;
}

export interface CacheEntry {
  presentation: PresentationData;
  createdAt: string;
  model: string;
  tokensUsed: number;
}

export function normalizeChapter(chapter: string): string {
  return chapter.toLowerCase().trim().replace(/\s+/g, ' ');
}

export function normalizeRequest(req: PptRequest): string {
  return [
    normalizeChapter(req.chapter),
    String(req.grade),
    req.subject.toLowerCase().trim().replace(/\s+/g, ' '),
    String(req.numSlides),
  ].join('|');
}

export function buildEmbeddingText(req: PptRequest): string {
  return `grade:${req.grade} subject:${req.subject.toLowerCase().trim()} chapter:${normalizeChapter(req.chapter)} slides:${req.numSlides}`;
}

export function generateContentCacheKey(req: PptRequest): string {
  const hash = createHash('sha256').update(normalizeRequest(req)).digest('hex').substring(0, 16);
  return `ppt:content:l1:${hash}`;
}
