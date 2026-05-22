import { Fragment, useEffect, useState } from 'react';
import {
  GenerateRequest,
  PresentationData,
  SlideActivityRole,
  SlideData,
  SlideType,
  populateSlideContent,
} from '../api';
import { formatQuizForEditor, quizFromEditorText } from '../lib/quiz';
import SlidePreview from './SlidePreview';

interface OutlineMeta {
  cached: boolean;
  strategy: string;
  similarityScore?: number;
  matchedChapter?: string;
}

interface Props {
  request: GenerateRequest;
  presentation: PresentationData;
  outlineMeta: OutlineMeta | null;
  onChange: (presentation: PresentationData) => void;
  onGenerate: () => void;
  onBack: () => void;
  disabled: boolean;
}

const SLIDE_TYPES: SlideType[] = [
  'title',
  'bullet-list',
  'quiz',
  'two-column',
  'content-with-image',
  'quote-or-definition',
];

const SLIDE_ROLES: { id: SlideActivityRole; label: string; slideType: SlideType; placeholder: string }[] = [
  { id: 'quiz', label: 'Quiz', slideType: 'quiz', placeholder: 'e.g. 3 MCQ on coal extraction methods and environmental impact' },
  { id: 'discussion', label: 'Discussion', slideType: 'two-column', placeholder: 'e.g. think-pair-share: is sunlight always needed?' },
  { id: 'definition', label: 'Definition', slideType: 'quote-or-definition', placeholder: 'e.g. define photosynthesis in Class 8 terms' },
  { id: 'visual', label: 'Visual', slideType: 'content-with-image', placeholder: 'e.g. diagram of chloroplast and light-dependent reactions' },
];

function shiftIndexedRecord<T>(prev: Record<number, T>, index: number, delta: 1 | -1): Record<number, T> {
  const next: Record<number, T> = {};
  for (const [key, value] of Object.entries(prev)) {
    const i = Number(key);
    if (delta === -1 && i === index) continue;
    next[i > index ? i + delta : i] = value;
  }
  return next;
}

const MIN_SLIDES = 3;
const MAX_SLIDES = 25;

function slideContentValue(slide: SlideData): string {
  if (slide.slideType === 'quiz') return formatQuizForEditor(slide);
  if (slide.slideType === 'bullet-list') return (slide.bullets || []).join('\n');
  if (slide.slideType === 'two-column') return [slide.leftContent || '', slide.rightContent || ''].join('\n---\n');
  if (slide.slideType === 'quote-or-definition') return slide.quoteText || '';
  return slide.bodyText || '';
}

function withContent(slide: SlideData, value: string): SlideData {
  if (slide.slideType === 'quiz') {
    return {
      ...slide,
      quizQuestions: quizFromEditorText(value),
      bullets: undefined,
    };
  }
  if (slide.slideType === 'bullet-list') {
    return { ...slide, bullets: value.split('\n').map((item) => item.trim()).filter(Boolean) };
  }
  if (slide.slideType === 'two-column') {
    const [leftContent = '', rightContent = ''] = value.split('\n---\n');
    return { ...slide, leftContent, rightContent };
  }
  if (slide.slideType === 'quote-or-definition') {
    return { ...slide, quoteText: value };
  }
  return { ...slide, bodyText: value };
}

function contentLabel(slideType: SlideType): string {
  if (slideType === 'quiz') return 'Quiz questions';
  if (slideType === 'bullet-list') return 'Bullets';
  if (slideType === 'two-column') return 'Column content';
  if (slideType === 'quote-or-definition') return 'Definition or quote';
  return 'Body text';
}

function createBlankSlide(afterIndex: number): SlideData {
  return {
    slideType: 'bullet-list',
    title: `Slide ${afterIndex + 2}`,
    bullets: ['Key point', 'Example or explanation'],
    speakerNote: '',
  };
}

const QUIZ_EDITOR_HINT = `Q1: Your question here?
A) Option 1
B) Option 2
C) Option 3

Q2: Next question?
A) ...
B) ...
C) ...`;

function cacheBadge(meta: OutlineMeta | null): string | null {
  if (meta?.strategy === 'template-fallback') return 'Provider fallback used — editable template draft';
  if (!meta?.cached) return null;
  if (meta.strategy === 'l2-semantic') {
    const pct = meta.similarityScore ? `${Math.round(meta.similarityScore * 100)}%` : '';
    const matched = meta.matchedChapter ? ` → ${meta.matchedChapter}` : '';
    return `Semantic cache (${pct} similar${matched}) — no AI cost`;
  }
  if (meta.strategy === 'l1-cache') return 'Exact cache hit — no AI cost';
  return 'Loaded from cache';
}

export default function OutlineEditor({
  request,
  presentation,
  outlineMeta,
  onChange,
  onGenerate,
  onBack,
  disabled,
}: Props) {
  const [intents, setIntents] = useState<Record<number, string>>({});
  const [roles, setRoles] = useState<Record<number, SlideActivityRole>>({});
  const [populateError, setPopulateError] = useState<string | null>(null);
  const [populatingIndex, setPopulatingIndex] = useState<number | null>(null);
  const [activeSlideIndex, setActiveSlideIndex] = useState(0);

  const slideCount = presentation.slides.length;

  useEffect(() => {
    if (activeSlideIndex >= slideCount) {
      setActiveSlideIndex(Math.max(0, slideCount - 1));
    }
  }, [activeSlideIndex, slideCount]);
  const canAdd = slideCount < MAX_SLIDES;
  const canDelete = slideCount > MIN_SLIDES;

  const updateSlide = (index: number, nextSlide: SlideData) => {
    onChange({
      ...presentation,
      slides: presentation.slides.map((slide, i) => (i === index ? nextSlide : slide)),
    });
  };

  const updateTitle = (presentationTitle: string) => {
    onChange({ ...presentation, presentationTitle });
  };

  const insertAfter = (index: number) => {
    if (!canAdd) return;
    const slides = [...presentation.slides];
    slides.splice(index + 1, 0, createBlankSlide(index));
    onChange({ ...presentation, slides });
    setIntents((prev) => shiftIndexedRecord(prev, index, 1));
    setRoles((prev) => shiftIndexedRecord(prev, index, 1));
    setActiveSlideIndex(index + 1);
  };

  const removeAt = (index: number) => {
    if (!canDelete) return;
    onChange({
      ...presentation,
      slides: presentation.slides.filter((_, i) => i !== index),
    });
    setIntents((prev) => shiftIndexedRecord(prev, index, -1));
    setRoles((prev) => shiftIndexedRecord(prev, index, -1));
    setActiveSlideIndex((prev) => (prev > index ? prev - 1 : prev === index ? Math.max(0, index - 1) : prev));
  };

  const setIntent = (index: number, value: string) => {
    setIntents((prev) => ({ ...prev, [index]: value }));
  };

  const selectRole = (index: number, role: (typeof SLIDE_ROLES)[number]) => {
    setRoles((prev) => ({ ...prev, [index]: role.id }));
    updateSlide(index, { ...presentation.slides[index], slideType: role.slideType });
  };

  const handlePopulate = async (index: number) => {
    const intent = (intents[index] || '').trim();
    const activityRole = roles[index];

    if (!intent) {
      setPopulateError('Write what this slide should be about, then choose a format and click Populate.');
      return;
    }
    if (!activityRole) {
      setPopulateError('Choose a slide format (Quiz, Discussion, Definition, or Visual), then click Populate.');
      return;
    }

    setPopulateError(null);
    setPopulatingIndex(index);
    setActiveSlideIndex(index);
    const slide = presentation.slides[index];
    const roleDef = SLIDE_ROLES.find((r) => r.id === activityRole)!;

    try {
      const result = await populateSlideContent({
        ...request,
        numSlides: presentation.slides.length,
        presentation,
        slideIndex: index,
        slideType: roleDef.slideType,
        intent,
        activityRole,
      });
      updateSlide(index, result.slide);
    } catch (err: any) {
      setPopulateError(err.message);
    } finally {
      setPopulatingIndex(null);
    }
  };

  return (
    <div className="outline-card outline-card--review">
      <div className="outline-header">
        <div>
          <p className="eyebrow">Editable outline</p>
          <h2>Review slides</h2>
          <p className="subtitle">
            {slideCount}/{MAX_SLIDES} slides — edit text on the left, check the layout preview on the right, then export when ready
          </p>
        </div>
        <span className="system-pill">Draft</span>
      </div>

      {cacheBadge(outlineMeta) && (
        <p className="cache-badge">{cacheBadge(outlineMeta)}</p>
      )}

      {populateError && (
        <p className="populate-error">{populateError}</p>
      )}

      <div className="form-group">
        <label htmlFor="presentationTitle">Presentation Title</label>
        <input
          id="presentationTitle"
          value={presentation.presentationTitle}
          disabled={disabled}
          onChange={(event) => updateTitle(event.target.value)}
        />
      </div>

      <div className="outline-review-body">
        <div className="outline-editor-column">
      <div className="outline-list">
        {presentation.slides.map((slide, index) => (
          <Fragment key={`slide-${index}`}>
            <section
              className={`outline-slide${activeSlideIndex === index ? ' outline-slide-active' : ''}`}
              onClick={() => setActiveSlideIndex(index)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  setActiveSlideIndex(index);
                }
              }}
              role="button"
              tabIndex={0}
              aria-current={activeSlideIndex === index ? 'true' : undefined}
            >
              <div className="outline-slide-header" onClick={(e) => e.stopPropagation()}>
                <span className="slide-number">{index + 1}</span>
                <select
                  value={slide.slideType}
                  disabled={disabled || populatingIndex === index}
                  onChange={(event) => {
                    const slideType = event.target.value as SlideType;
                    updateSlide(index, { ...slide, slideType });
                    const matchingRole = SLIDE_ROLES.find((r) => r.slideType === slideType);
                    setRoles((prev) => {
                      const next = { ...prev };
                      if (matchingRole && prev[index] === matchingRole.id) return next;
                      delete next[index];
                      return next;
                    });
                  }}
                >
                  {SLIDE_TYPES.map((type) => (
                    <option key={type} value={type}>{type}</option>
                  ))}
                </select>
                <button
                  type="button"
                  className="btn-slide-delete"
                  disabled={disabled || !canDelete || populatingIndex !== null}
                  onClick={() => removeAt(index)}
                  title={canDelete ? 'Remove this slide' : `At least ${MIN_SLIDES} slides required`}
                >
                  Remove
                </button>
              </div>

              <div className="populate-block" onClick={(e) => e.stopPropagation()}>
                <label htmlFor={`intent-${index}`}>What should this slide be about?</label>
                <textarea
                  id={`intent-${index}`}
                  className="populate-intent"
                  rows={2}
                  placeholder={
                    SLIDE_ROLES.find((r) => r.id === roles[index])?.placeholder
                    || 'Describe the topic in your own words (e.g. quiz on chlorophyll between slides 3 and 4)'
                  }
                  value={intents[index] || ''}
                  disabled={disabled || populatingIndex !== null}
                  onChange={(event) => setIntent(index, event.target.value)}
                />

                <p className="populate-label">Slide format</p>
                <div className="intent-presets" role="group" aria-label="Slide format">
                  {SLIDE_ROLES.map((role) => (
                    <button
                      key={role.id}
                      type="button"
                      className={`btn-preset${roles[index] === role.id ? ' active' : ''}`}
                      disabled={disabled || populatingIndex !== null}
                      aria-pressed={roles[index] === role.id}
                      onClick={() => selectRole(index, role)}
                    >
                      {role.label}
                    </button>
                  ))}
                </div>

                <div className="populate-actions">
                  <button
                    type="button"
                    className="btn-populate"
                    disabled={disabled || populatingIndex !== null}
                    onClick={() => handlePopulate(index)}
                  >
                    {populatingIndex === index ? 'Populating…' : 'Populate'}
                  </button>
                </div>
                <p className="field-hint">
                  Your text stays as-is. Format buttons only pick the layout (quiz, discussion, etc.), then Populate fills the slide.
                </p>
              </div>

              <div className="form-group" onClick={(e) => e.stopPropagation()}>
                <label>Slide Title</label>
                <input
                  value={slide.title}
                  disabled={disabled || populatingIndex === index}
                  onChange={(event) => updateSlide(index, { ...slide, title: event.target.value })}
                />
              </div>

              <div className="form-group" onClick={(e) => e.stopPropagation()}>
                <label>{contentLabel(slide.slideType)}</label>
                <textarea
                  value={slideContentValue(slide)}
                  disabled={disabled || populatingIndex === index}
                  rows={slide.slideType === 'quiz' ? 8 : slide.slideType === 'two-column' ? 5 : 4}
                  placeholder={slide.slideType === 'quiz' ? QUIZ_EDITOR_HINT : undefined}
                  onChange={(event) => updateSlide(index, withContent(slide, event.target.value))}
                />
                {slide.slideType === 'quiz' && (
                  <p className="field-hint">One question per block. Options as A) B) C) on separate lines. Populate fills this automatically.</p>
                )}
                {slide.slideType === 'two-column' && (
                  <p className="field-hint">Separate left and right columns with a line containing only ---</p>
                )}
              </div>

              <div className="form-group" onClick={(e) => e.stopPropagation()}>
                <label>Teacher Note</label>
                <textarea
                  value={slide.speakerNote || ''}
                  disabled={disabled || populatingIndex === index}
                  rows={2}
                  onChange={(event) => updateSlide(index, { ...slide, speakerNote: event.target.value })}
                />
              </div>
            </section>

            <div className="slide-insert-row" onClick={(e) => e.stopPropagation()}>
              <button
                type="button"
                className="btn-slide-add"
                disabled={disabled || !canAdd || populatingIndex !== null}
                onClick={() => insertAfter(index)}
                title={canAdd ? 'Insert a new slide after this one' : `Maximum ${MAX_SLIDES} slides`}
              >
                Add slide
              </button>
            </div>
          </Fragment>
        ))}
      </div>
        </div>

        <aside className="outline-preview-column" aria-label="Slide layout preview">
          <SlidePreview
            slide={presentation.slides[activeSlideIndex] ?? presentation.slides[0]}
            index={activeSlideIndex}
            total={slideCount}
          />
        </aside>
      </div>

      <div className="outline-actions">
        <button type="button" className="btn-new" onClick={onBack} disabled={disabled || populatingIndex !== null}>Back</button>
        <button type="button" className="btn-generate" onClick={onGenerate} disabled={disabled || populatingIndex !== null}>
          {disabled ? 'Exporting...' : 'Export PPTX'}
        </button>
      </div>
    </div>
  );
}
