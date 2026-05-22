import type { ReactNode } from 'react';
import type { SlideData } from '../api';
import { getQuizQuestions } from '../lib/quiz';

interface Props {
  slide: SlideData;
  index: number;
  total: number;
}

function PreviewChrome({ slide, index, total, children }: Props & { children: ReactNode }) {
  return (
    <div className="slide-preview-panel">
      <div className="slide-preview-meta">
        <span>Layout preview</span>
        <span>{index + 1} / {total}</span>
      </div>
      <div className="slide-preview-frame">
        <div className={`slide-preview-canvas slide-preview-${slide.slideType}`}>
          {children}
        </div>
      </div>
      <p className="slide-preview-note">
        Approximates exported PPTX — edit text on the left; layout is fixed by template.
      </p>
    </div>
  );
}

function TitlePreview({ slide }: { slide: SlideData }) {
  return (
    <>
      <div className="pv-title-bar" />
      <div className="pv-title-content">
        <h3>{slide.title || 'Presentation title'}</h3>
        {slide.bodyText && <p>{slide.bodyText}</p>}
      </div>
      <div className="pv-title-footer">SAVRA AI</div>
    </>
  );
}

function BulletPreview({ slide }: { slide: SlideData }) {
  const bullets = slide.bullets?.length ? slide.bullets : ['Bullet point'];
  return (
    <>
      <div className="pv-side-accent" />
      <div className="pv-light-body">
        <h3>{slide.title || 'Slide title'}</h3>
        <div className="pv-title-rule" />
        <div className="pv-bullet-card">
          <ul>
            {bullets.map((b, i) => (
              <li key={i}>{b}</li>
            ))}
          </ul>
        </div>
      </div>
    </>
  );
}

function QuizPreview({ slide }: { slide: SlideData }) {
  const questions = getQuizQuestions(slide).slice(0, 3);
  if (!questions.length) {
    return <BulletPreview slide={slide} />;
  }
  return (
    <>
      <div className="pv-side-accent" />
      <div className="pv-light-body pv-quiz-body">
        <h3>{slide.title || 'Quiz'}</h3>
        <div className="pv-title-rule" />
        <div className="pv-quiz-list">
          {questions.map((q, qi) => (
            <div key={qi} className="pv-quiz-card">
              <span className="pv-quiz-badge">Q{qi + 1}</span>
              <p className="pv-quiz-q">{q.question}</p>
              <div className="pv-quiz-options">
                {q.options.map((opt, oi) => (
                  <div key={oi} className="pv-quiz-opt">
                    <span>{String.fromCharCode(65 + oi)}</span>
                    <span>{opt}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

function TwoColumnPreview({ slide }: { slide: SlideData }) {
  return (
    <div className="pv-light-body pv-columns-wrap">
      <h3 className="pv-center-title">{slide.title || 'Discussion'}</h3>
      <div className="pv-title-rule pv-center-rule" />
      <div className="pv-columns">
        <div className="pv-col pv-col-left">
          <span className="pv-col-label">Prompt</span>
          <p>{slide.leftContent || 'Left column content'}</p>
        </div>
        <div className="pv-col pv-col-right">
          <span className="pv-col-label">Discuss / Answers</span>
          <p>{slide.rightContent || 'Right column content'}</p>
        </div>
      </div>
    </div>
  );
}

function VisualPreview({ slide }: { slide: SlideData }) {
  return (
    <>
      <div className="pv-side-accent" />
      <div className="pv-light-body pv-visual-body">
        <h3>{slide.title || 'Visual'}</h3>
        <div className="pv-title-rule" />
        <div className="pv-visual-split">
          <p className="pv-visual-text">{slide.bodyText || 'Explanation text goes here.'}</p>
          <div className="pv-visual-placeholder">
            <span className="pv-visual-label">Visual</span>
            <div className="pv-visual-diagram" />
            <span className="pv-visual-caption">Diagram / image</span>
          </div>
        </div>
      </div>
    </>
  );
}

function QuotePreview({ slide }: { slide: SlideData }) {
  const text = slide.quoteText || slide.bodyText || 'Definition or quote text';
  return (
    <div className="pv-quote-wrap">
      <span className="pv-quote-mark">"</span>
      <h3>{slide.title || 'Key concept'}</h3>
      <div className="pv-quote-box">
        <p>{text}</p>
      </div>
      <div className="pv-quote-rule" />
    </div>
  );
}

function renderSlideContent(slide: SlideData) {
  if (slide.slideType === 'quiz' || (getQuizQuestions(slide).length > 0 && /quiz|mcq/i.test(slide.title))) {
    return <QuizPreview slide={slide} />;
  }
  switch (slide.slideType) {
    case 'title':
      return <TitlePreview slide={slide} />;
    case 'two-column':
      return <TwoColumnPreview slide={slide} />;
    case 'content-with-image':
      return <VisualPreview slide={slide} />;
    case 'quote-or-definition':
      return <QuotePreview slide={slide} />;
    default:
      return <BulletPreview slide={slide} />;
  }
}

export default function SlidePreview({ slide, index, total }: Props) {
  return (
    <PreviewChrome slide={slide} index={index} total={total}>
      {renderSlideContent(slide)}
    </PreviewChrome>
  );
}
