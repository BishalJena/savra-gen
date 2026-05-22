import { normalizeQuizSlide } from '@savra/shared';
import type { PptRequest, PresentationData, SlideData } from '../shared';
import { hasLlmProvider } from './llm';
import { populateSlideWithLlm } from './llm-populate';

export type SlideActivityRole = 'quiz' | 'discussion' | 'definition' | 'visual' | 'general';

export interface PopulateSlideRequest extends PptRequest {
  slideIndex: number;
  slideType: SlideData['slideType'];
  /** What the teacher wants this slide to be about (their words). */
  intent: string;
  /** Layout / activity format — separate from topic text. */
  activityRole?: SlideActivityRole;
  presentation: PresentationData;
}

const ROLE_HINTS: Record<SlideActivityRole, string> = {
  quiz: 'Format as a quiz: 2–4 MCQ or short-answer items with A/B/C options where appropriate.',
  discussion: 'Format for classroom discussion: prompt on the left, talking points or answers on the right (two-column).',
  definition: 'Format as a definition or key quote the class should remember.',
  visual: 'Format as a visual explanation slide; describe what diagram or image to show in body text.',
  general: 'Match the requested slideType with clear classroom-ready content.',
};

export function composePopulatePrompt(intent: string, activityRole?: SlideActivityRole): string {
  const topic = intent.trim();
  const role = activityRole && ROLE_HINTS[activityRole] ? activityRole : 'general';
  return [`Topic (teacher): ${topic}`, `Activity format: ${role}`, ROLE_HINTS[role]].join('\n');
}

export interface PopulateSlideResult {
  slide: SlideData;
  strategy: 'llm' | 'template';
  model?: string;
  tokensUsed?: number;
}

function summarizeSlide(slide: SlideData, index: number): string {
  const parts = [`#${index + 1} [${slide.slideType}] ${slide.title}`];
  if (slide.bullets?.length) parts.push(`bullets: ${slide.bullets.slice(0, 3).join('; ')}`);
  if (slide.bodyText) parts.push(`body: ${slide.bodyText.slice(0, 80)}`);
  if (slide.quoteText) parts.push(`quote: ${slide.quoteText.slice(0, 80)}`);
  if (slide.leftContent) parts.push(`left: ${slide.leftContent.slice(0, 60)}`);
  return parts.join(' | ');
}

function buildDeckContext(presentation: PresentationData, slideIndex: number): string {
  const slides = presentation.slides;
  const before = slides.slice(Math.max(0, slideIndex - 2), slideIndex).map((s, i) =>
    summarizeSlide(s, Math.max(0, slideIndex - 2) + i),
  );
  const after = slides.slice(slideIndex + 1, slideIndex + 3).map((s, i) =>
    summarizeSlide(s, slideIndex + 1 + i),
  );
  return [
    `Deck title: ${presentation.presentationTitle}`,
    before.length ? `Slides before:\n${before.join('\n')}` : 'Slides before: (none — near start)',
    after.length ? `Slides after:\n${after.join('\n')}` : 'Slides after: (none — near end)',
  ].join('\n\n');
}

function templateSlideFromIntent(
  intent: string,
  slideType: SlideData['slideType'],
  req: PptRequest,
  activityRole?: SlideActivityRole,
): SlideData {
  const topic = intent.trim() || 'Activity';
  const chapter = req.chapter;

  if (slideType === 'quote-or-definition') {
    return {
      slideType,
      title: topic.slice(0, 60),
      quoteText: `Key definition or quote about ${chapter} related to: ${topic}.`,
      speakerNote: 'Replace with textbook wording if needed.',
    };
  }

  if (slideType === 'two-column') {
    return {
      slideType,
      title: topic.slice(0, 60),
      leftContent: `Prompt: ${topic}`,
      rightContent: `Class ${req.grade} ${req.subject} — student responses or correct answers.`,
      speakerNote: 'Use as discussion or quiz reveal.',
    };
  }

  if (slideType === 'content-with-image') {
    return {
      slideType,
      title: topic.slice(0, 60),
      bodyText: `Visual aid for ${chapter}: ${topic}. Add diagram in class.`,
      speakerNote: 'Suggest image or board sketch during lesson.',
    };
  }

  if (slideType === 'title') {
    return {
      slideType: 'title',
      title: topic.slice(0, 60),
      bodyText: `${chapter} — Class ${req.grade} ${req.subject}`,
      speakerNote: '',
    };
  }

  if (activityRole === 'quiz' || slideType === 'quiz') {
    return {
      slideType: 'quiz',
      title: `Quiz: ${topic.slice(0, 50)}`,
      quizQuestions: [
        {
          question: `What is the main idea of ${topic}?`,
          options: ['Open-pit mining', 'Underground mining', 'Both methods'],
        },
        {
          question: `Which factor matters most for ${chapter}?`,
          options: ['Safety procedures', 'Environmental impact', 'Both A and B'],
        },
      ],
      speakerNote: 'Pause after each question; reveal answers after brief discussion.',
    };
  }

  return {
    slideType: 'bullet-list',
    title: topic.slice(0, 60),
    bullets: [
      `Focus: ${topic}`,
      `Link to ${chapter} (Class ${req.grade})`,
      'Example from Indian classroom context',
      'Quick check-for-understanding',
    ],
    speakerNote: 'Adjust bullets before export.',
  };
}

function finalizeSlide(slide: SlideData, activityRole?: SlideActivityRole): SlideData {
  if (activityRole === 'quiz' || slide.slideType === 'quiz') {
    return normalizeQuizSlide({ ...slide, slideType: 'quiz' });
  }
  return slide;
}

export async function populateSlide(input: PopulateSlideRequest): Promise<PopulateSlideResult> {
  const { presentation, slideIndex, slideType, intent, ...req } = input;
  const trimmedIntent = intent.trim();
  if (!trimmedIntent) {
    throw new Error('intent is required — describe what this slide should cover (e.g. "3 MCQ quiz on chlorophyll")');
  }
  if (slideIndex < 0 || slideIndex >= presentation.slides.length) {
    throw new Error('slideIndex is out of range');
  }

  const deckContext = buildDeckContext(presentation, slideIndex);

  if (hasLlmProvider()) {
    try {
      const result = await populateSlideWithLlm({
        req: { ...req, numSlides: presentation.slides.length },
        slideType,
        intent: composePopulatePrompt(trimmedIntent, input.activityRole),
        deckContext,
      });
      return {
        slide: finalizeSlide({ ...result.slide, slideType: activityRole === 'quiz' ? 'quiz' : slideType }, input.activityRole),
        strategy: 'llm',
        model: result.model,
        tokensUsed: result.tokensUsed,
      };
    } catch (err) {
      console.warn('[Populate] LLM failed, using template fill:', err);
    }
  }

  const slide = templateSlideFromIntent(trimmedIntent, slideType, req, input.activityRole);
  return {
    slide: finalizeSlide(slide, input.activityRole),
    strategy: 'template',
    model: 'template',
    tokensUsed: 0,
  };
}
