import type { GenerateFromOutlineRequest, OutlineRequest, PresentationData, SlideData } from '../shared';
import { normalizeRequest } from '../shared';
import { createHash } from 'crypto';

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
  }

  return null;
}
