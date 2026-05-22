const API_BASE = '/api';

export interface GenerateRequest {
  chapter: string;
  grade: number;
  subject: string;
  numSlides: number;
}

export type SlideType =
  | 'title'
  | 'bullet-list'
  | 'two-column'
  | 'content-with-image'
  | 'quote-or-definition'
  | 'quiz';

export interface SlideData {
  slideType: SlideType;
  title: string;
  bullets?: string[];
  bodyText?: string;
  leftContent?: string;
  rightContent?: string;
  quoteText?: string;
  speakerNote?: string;
  quizQuestions?: Array<{ question: string; options: string[] }>;
}

export interface PresentationData {
  presentationTitle: string;
  slides: SlideData[];
}

export interface GenerateResponse {
  jobId: string;
  status: string;
  estimatedSeconds: number;
  pollUrl: string;
  deduplicated?: boolean;
}

export interface OutlineResponse {
  presentation: PresentationData;
  cached: boolean;
  strategy: 'l1-cache' | 'l2-semantic' | 'llm' | 'template' | 'template-fallback' | string;
  similarityScore?: number;
  matchedChapter?: string;
  estimatedSecondsSaved: number;
}

export interface JobStatusResponse {
  jobId: string;
  status: 'queued' | 'processing' | 'done' | 'failed';
  step?: string;
  progress?: number;
  cached: boolean;
  downloadUrl?: string;
  error?: string;
  tokensUsed?: number;
  costINR?: number;
  model?: string;
  slidePreview?: Array<{ type: string; title: string }>;
  createdAt: string;
}

export async function fetchChapters(grade: number, subject: string): Promise<string[]> {
  const params = new URLSearchParams({ grade: String(grade), subject });
  const res = await fetch(`${API_BASE}/ppt/chapters?${params}`);
  if (!res.ok) return [];
  const data = await res.json();
  return data.chapters || [];
}

export interface PopulateSlideResponse {
  slide: SlideData;
  strategy: 'llm' | 'template';
  model?: string;
  tokensUsed?: number;
}

export type SlideActivityRole = 'quiz' | 'discussion' | 'definition' | 'visual';

export async function populateSlideContent(
  data: GenerateRequest & {
    presentation: PresentationData;
    slideIndex: number;
    slideType: SlideType;
    intent: string;
    activityRole?: SlideActivityRole;
  },
): Promise<PopulateSlideResponse> {
  const res = await fetch(`${API_BASE}/ppt/slide/populate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Request failed' }));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.json();
}

export async function draftOutline(data: GenerateRequest): Promise<OutlineResponse> {
  const res = await fetch(`${API_BASE}/ppt/outline`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Request failed' }));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.json();
}

export async function submitGeneration(
  data: GenerateRequest & { presentation?: PresentationData },
): Promise<GenerateResponse> {
  const res = await fetch(`${API_BASE}/ppt/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Request failed' }));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.json();
}

export async function pollJobStatus(jobId: string): Promise<JobStatusResponse> {
  const res = await fetch(`${API_BASE}/ppt/job/${jobId}`);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  return res.json();
}

export function getDownloadUrl(jobId: string): string {
  return `${API_BASE}/ppt/download/${jobId}`;
}
