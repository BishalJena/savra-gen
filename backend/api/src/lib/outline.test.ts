import assert from 'node:assert/strict';
import test from 'node:test';
import { buildDraftOutline, generateApprovedCacheKey, validatePresentation } from './outline';

test('buildDraftOutline returns the requested number of slides with a title and recap', () => {
  const outline = buildDraftOutline({
    chapter: ' Photosynthesis ',
    grade: 8,
    subject: 'Science',
    numSlides: 5,
  });

  assert.equal(outline.presentationTitle, 'Photosynthesis — Class 8');
  assert.equal(outline.slides.length, 5);
  assert.equal(outline.slides[0].slideType, 'title');
  assert.equal(outline.slides[0].title, 'Photosynthesis');
  assert.equal(outline.slides.at(-1)?.title, 'Recap and Practice');
});

test('validatePresentation rejects empty slide titles and invalid bullet slides', () => {
  assert.equal(
    validatePresentation({
      presentationTitle: 'Valid deck',
      slides: [
        { slideType: 'title', title: 'Title' },
        { slideType: 'bullet-list', title: '', bullets: ['Point'] },
        { slideType: 'bullet-list', title: 'Recap', bullets: ['Done'] },
      ],
    }),
    'Slide 2 needs a title.',
  );
});

test('generateApprovedCacheKey changes when teacher edits content', () => {
  const base = {
    chapter: 'Photosynthesis',
    grade: 8,
    subject: 'Science',
    numSlides: 3,
    presentation: {
      presentationTitle: 'Photosynthesis',
      slides: [
        { slideType: 'title' as const, title: 'Photosynthesis' },
        { slideType: 'bullet-list' as const, title: 'Key Points', bullets: ['Plants make food'] },
        { slideType: 'bullet-list' as const, title: 'Recap', bullets: ['Review'] },
      ],
    },
  };

  const keyA = generateApprovedCacheKey(base);
  const keyB = generateApprovedCacheKey({
    ...base,
    presentation: {
      ...base.presentation,
      slides: base.presentation.slides.map((s, i) =>
        i === 1 ? { ...s, bullets: ['Updated bullet'] } : s,
      ),
    },
  });
  assert.notEqual(keyA, keyB);
});
