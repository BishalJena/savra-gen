// Shared types (inlined from packages/shared for simpler dev resolution)

export interface PptRequest {
  topic: string;
  grade: number;
  subject: string;
  numSlides: number;
  language?: string;
}

export interface PptJobData extends PptRequest {
  cacheKey: string;
  requestedAt: string;
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

export interface CacheEntry {
  presentation: PresentationData;
  createdAt: string;
  model: string;
  tokensUsed: number;
}

export function normalizeRequest(req: PptRequest): string {
  return [
    req.topic.toLowerCase().trim().replace(/\s+/g, ' '),
    String(req.grade),
    req.subject.toLowerCase().trim().replace(/\s+/g, ' '),
    String(req.numSlides),
  ].join('|');
}
