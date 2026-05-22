import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { populateSlide } from './populate-slide';

const basePresentation = {
  presentationTitle: 'Photosynthesis — Class 8',
  slides: [
    { slideType: 'title' as const, title: 'Photosynthesis', bodyText: 'Class 8 Science' },
    { slideType: 'bullet-list' as const, title: 'Introduction', bullets: ['Plants', 'Sunlight'] },
    { slideType: 'bullet-list' as const, title: 'Chlorophyll', bullets: ['Green pigment'] },
    { slideType: 'bullet-list' as const, title: 'Recap', bullets: ['Summary'] },
  ],
};

describe('populateSlide', () => {
  it('fills a quiz intent with bullet-list template when no LLM keys', async () => {
    const prevOpenAi = process.env.OPENAI_API_KEY;
    const prevAnthropic = process.env.ANTHROPIC_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;

    try {
      const result = await populateSlide({
        chapter: 'Photosynthesis',
        grade: 8,
        subject: 'Science',
        numSlides: 5,
        slideIndex: 2,
        slideType: 'bullet-list',
        intent: 'chlorophyll and light',
        activityRole: 'quiz',
        presentation: basePresentation,
      });

      assert.equal(result.strategy, 'template');
      assert.equal(result.slide.slideType, 'quiz');
      assert.match(result.slide.title, /quiz/i);
      assert.ok(result.slide.quizQuestions && result.slide.quizQuestions.length >= 2);
      assert.ok(result.slide.quizQuestions[0].options.length >= 2);
    } finally {
      if (prevOpenAi) process.env.OPENAI_API_KEY = prevOpenAi;
      if (prevAnthropic) process.env.ANTHROPIC_API_KEY = prevAnthropic;
    }
  });

  it('rejects empty intent', async () => {
    await assert.rejects(
      () =>
        populateSlide({
          chapter: 'Photosynthesis',
          grade: 8,
          subject: 'Science',
          numSlides: 4,
          slideIndex: 1,
          slideType: 'bullet-list',
          intent: '   ',
          presentation: basePresentation,
        }),
      /intent is required/,
    );
  });
});
