// Shared types for Savra PPT generation system

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

export interface JobStatusResponse {
  jobId: string;
  status: JobStatus;
  step?: string;
  progress?: number;
  cached: boolean;
  downloadUrl?: string;
  error?: string;
  estimatedSeconds?: number;
  tokensUsed?: number;
  costINR?: number;
  createdAt: string;
}

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
  const normalized = [
    req.topic.toLowerCase().trim().replace(/\s+/g, ' '),
    String(req.grade),
    req.subject.toLowerCase().trim().replace(/\s+/g, ' '),
    String(req.numSlides),
  ].join('|');
  return normalized;
}
