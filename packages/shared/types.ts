// Shared types and small runtime helpers for Savra PPT generation system
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

export type ContentStrategy =
  | 'l1-cache'
  | 'l2-semantic'
  | 'llm'
  | 'template'
  | 'template-fallback'
  | 'teacher-approved';

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

export interface QuizQuestion {
  question: string;
  options: string[];
}

export interface SlideData {
  slideType:
    | 'title'
    | 'bullet-list'
    | 'two-column'
    | 'content-with-image'
    | 'quote-or-definition'
    | 'quiz';
  title: string;
  bullets?: string[];
  bodyText?: string;
  leftContent?: string;
  rightContent?: string;
  quoteText?: string;
  speakerNote?: string;
  /** Structured MCQ items — used with slideType `quiz` for proper layout. */
  quizQuestions?: QuizQuestion[];
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

/** Parse API body; accepts deprecated `topic` as alias for `chapter`. */
export function parsePptRequest(body: Record<string, unknown>): PptRequest {
  const chapter = String(body.chapter ?? body.topic ?? '').trim();
  return {
    chapter,
    grade: Number(body.grade),
    subject: String(body.subject ?? '').trim(),
    numSlides: Number(body.numSlides),
    language: body.language ? String(body.language) : 'en',
  };
}

export function buildEmbeddingText(req: PptRequest): string {
  return `grade:${req.grade} subject:${req.subject.toLowerCase().trim()} chapter:${normalizeChapter(req.chapter)} slides:${req.numSlides}`;
}

export function generateContentCacheKey(req: PptRequest): string {
  const hash = createHash('sha256').update(normalizeRequest(req)).digest('hex').substring(0, 16);
  return `ppt:content:l1:${hash}`;
}

/** @deprecated Use generateContentCacheKey */
export function generateCacheKey(req: PptRequest): string {
  return generateContentCacheKey(req);
}

const SLIDE_PATTERN: SlideData['slideType'][] = [
  'title',
  'quote-or-definition',
  'bullet-list',
  'two-column',
  'content-with-image',
  'bullet-list',
];

export function buildDraftOutline({ chapter, grade, subject, numSlides }: OutlineRequest): PresentationData {
  const cleanChapter = chapter.trim();
  const slides: SlideData[] = [
    {
      slideType: 'title',
      title: cleanChapter,
      bodyText: `Class ${grade} ${subject} presentation`,
      speakerNote: `Introduce ${cleanChapter} and connect it to the current chapter.`,
    },
  ];

  const middleCount = Math.max(1, numSlides - 2);
  for (let i = 0; i < middleCount; i++) {
    const slideNo = i + 2;
    const slideType = SLIDE_PATTERN[slideNo % SLIDE_PATTERN.length];
    if (slideType === 'quote-or-definition') {
      slides.push({
        slideType,
        title: `Core Idea ${i + 1}`,
        quoteText: `A clear Class ${grade} definition of ${cleanChapter} goes here.`,
        speakerNote: 'Replace with the exact textbook-aligned wording if needed.',
      });
    } else if (slideType === 'two-column') {
      slides.push({
        slideType,
        title: 'Compare and Connect',
        leftContent: `What students already know about ${cleanChapter}.`,
        rightContent: `What they should understand after this slide.`,
        speakerNote: 'Use this as a discussion checkpoint before moving ahead.',
      });
    } else if (slideType === 'content-with-image') {
      slides.push({
        slideType,
        title: 'Visual Explanation',
        bodyText: `Use a diagram, flow, or classroom example to make ${cleanChapter} easier to see.`,
        speakerNote: 'Add or request a diagram during the final production flow.',
      });
    } else {
      slides.push({
        slideType: 'bullet-list',
        title: `Key Points ${i + 1}`,
        bullets: [
          `Important idea about ${cleanChapter}`,
          `Class ${grade} example from ${subject}`,
          'Common misconception to correct',
          'Quick check-for-understanding question',
        ],
        speakerNote: 'Trim or edit bullets before generating the final PPT.',
      });
    }
  }

  slides.push({
    slideType: 'bullet-list',
    title: 'Recap and Practice',
    bullets: [
      `Summarize the main idea of ${cleanChapter}`,
      'Ask one oral recall question',
      'Assign one short practice task',
      'Connect to the next lesson',
    ],
    speakerNote: 'End with a quick formative assessment.',
  });

  return {
    presentationTitle: `${cleanChapter} — Class ${grade}`,
    slides: slides.slice(0, numSlides),
  };
}

export function generateApprovedCacheKey(req: GenerateFromOutlineRequest): string {
  const normalizedPresentation = JSON.stringify(req.presentation);
  const hash = createHash('sha256')
    .update(`${normalizeRequest(req)}|${normalizedPresentation}`)
    .digest('hex')
    .substring(0, 16);
  return `ppt:approved:${hash}`;
}

export function validatePresentation(presentation: PresentationData): string | null {
  if (!presentation.presentationTitle?.trim()) return 'Presentation title is required.';
  if (!Array.isArray(presentation.slides) || presentation.slides.length < 3) {
    return 'At least 3 slides are required.';
  }
  if (presentation.slides.length > 25) return 'At most 25 slides are supported.';

  for (const [index, slide] of presentation.slides.entries()) {
    if (!slide.title?.trim()) return `Slide ${index + 1} needs a title.`;
    if (slide.slideType === 'bullet-list' && (!slide.bullets || slide.bullets.length === 0)) {
      return `Slide ${index + 1} needs at least one bullet.`;
    }
    if (slide.slideType === 'quiz') {
      const count = slide.quizQuestions?.length ?? 0;
      if (count === 0) return `Slide ${index + 1} needs at least one quiz question.`;
    }
  }

  return null;
}
