import { Fragment } from 'react';
import { PresentationData, SlideData, SlideType } from '../api';

interface OutlineMeta {
  cached: boolean;
  strategy: string;
  similarityScore?: number;
  matchedChapter?: string;
}

interface Props {
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
  'two-column',
  'content-with-image',
  'quote-or-definition',
];

const MIN_SLIDES = 3;
const MAX_SLIDES = 25;

function slideContentValue(slide: SlideData): string {
  if (slide.slideType === 'bullet-list') return (slide.bullets || []).join('\n');
  if (slide.slideType === 'two-column') return [slide.leftContent || '', slide.rightContent || ''].join('\n---\n');
  if (slide.slideType === 'quote-or-definition') return slide.quoteText || '';
  return slide.bodyText || '';
}

function withContent(slide: SlideData, value: string): SlideData {
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

function cacheBadge(meta: OutlineMeta | null): string | null {
  if (!meta?.cached) return null;
  if (meta.strategy === 'l2-semantic') {
    const pct = meta.similarityScore ? `${Math.round(meta.similarityScore * 100)}%` : '';
    const matched = meta.matchedChapter ? ` → ${meta.matchedChapter}` : '';
    return `Semantic cache (${pct} similar${matched}) — no AI cost`;
  }
  if (meta.strategy === 'l1-cache') return 'Exact cache hit — no AI cost';
  return 'Loaded from cache';
}

export default function OutlineEditor({ presentation, outlineMeta, onChange, onGenerate, onBack, disabled }: Props) {
  const slideCount = presentation.slides.length;
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
  };

  const removeAt = (index: number) => {
    if (!canDelete) return;
    onChange({
      ...presentation,
      slides: presentation.slides.filter((_, i) => i !== index),
    });
  };

  return (
    <div className="outline-card">
      <div className="outline-header">
        <div>
          <h2>Review Slide Content</h2>
          <p className="subtitle">
            Edit slides, add or remove any slide ({slideCount}/{MAX_SLIDES}), then generate the PPTX.
          </p>
        </div>
        <span className="app-badge">Draft</span>
      </div>

      {cacheBadge(outlineMeta) && (
        <p className="cache-badge">{cacheBadge(outlineMeta)}</p>
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

      <div className="outline-list">
        {presentation.slides.map((slide, index) => (
          <Fragment key={`slide-${index}`}>
            <section className="outline-slide">
              <div className="outline-slide-header">
                <span className="slide-number">{index + 1}</span>
                <select
                  value={slide.slideType}
                  disabled={disabled}
                  onChange={(event) => updateSlide(index, { ...slide, slideType: event.target.value as SlideType })}
                >
                  {SLIDE_TYPES.map((type) => (
                    <option key={type} value={type}>{type}</option>
                  ))}
                </select>
                <button
                  type="button"
                  className="btn-slide-delete"
                  disabled={disabled || !canDelete}
                  onClick={() => removeAt(index)}
                  title={canDelete ? 'Remove this slide' : `At least ${MIN_SLIDES} slides required`}
                >
                  Delete
                </button>
              </div>

              <div className="form-group">
                <label>Slide Title</label>
                <input
                  value={slide.title}
                  disabled={disabled}
                  onChange={(event) => updateSlide(index, { ...slide, title: event.target.value })}
                />
              </div>

              <div className="form-group">
                <label>{contentLabel(slide.slideType)}</label>
                <textarea
                  value={slideContentValue(slide)}
                  disabled={disabled}
                  rows={slide.slideType === 'two-column' ? 5 : 4}
                  onChange={(event) => updateSlide(index, withContent(slide, event.target.value))}
                />
                {slide.slideType === 'two-column' && (
                  <p className="field-hint">Separate left and right columns with a line containing only ---</p>
                )}
              </div>

              <div className="form-group">
                <label>Teacher Note</label>
                <textarea
                  value={slide.speakerNote || ''}
                  disabled={disabled}
                  rows={2}
                  onChange={(event) => updateSlide(index, { ...slide, speakerNote: event.target.value })}
                />
              </div>
            </section>

            <div className="slide-insert-row">
              <button
                type="button"
                className="btn-slide-add"
                disabled={disabled || !canAdd}
                onClick={() => insertAfter(index)}
                title={canAdd ? 'Insert a new slide after this one' : `Maximum ${MAX_SLIDES} slides`}
              >
                + Add slide below
              </button>
            </div>
          </Fragment>
        ))}
      </div>

      <div className="outline-actions">
        <button type="button" className="btn-new" onClick={onBack} disabled={disabled}>Back</button>
        <button type="button" className="btn-generate" onClick={onGenerate} disabled={disabled}>
          {disabled ? 'Generating PPTX...' : 'Generate Final PPTX'}
        </button>
      </div>
    </div>
  );
}
