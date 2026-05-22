import { useState } from 'react';
import GenerateForm from './components/GenerateForm';
import JobStatus from './components/JobStatus';
import OutlineEditor from './components/OutlineEditor';
import { draftOutline, submitGeneration, type GenerateRequest, type PresentationData } from './api';

export default function App() {
  const [jobId, setJobId] = useState<string | null>(null);
  const [request, setRequest] = useState<GenerateRequest | null>(null);
  const [presentation, setPresentation] = useState<PresentationData | null>(null);
  const [outlineMeta, setOutlineMeta] = useState<{
    cached: boolean;
    strategy: string;
    similarityScore?: number;
    matchedChapter?: string;
  } | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const handleSubmit = async (data: GenerateRequest) => {
    setIsSubmitting(true);
    setSubmitError(null);

    try {
      const result = await draftOutline(data);
      setRequest(data);
      setPresentation(result.presentation);
      setOutlineMeta({
        cached: result.cached,
        strategy: result.strategy,
        similarityScore: result.similarityScore,
        matchedChapter: result.matchedChapter,
      });
    } catch (err: any) {
      setSubmitError(err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleGenerateFinal = async () => {
    if (!request || !presentation) return;

    setIsSubmitting(true);
    setSubmitError(null);

    try {
      const result = await submitGeneration({ ...request, presentation });
      setJobId(result.jobId);
    } catch (err: any) {
      setSubmitError(err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleReset = () => {
    setJobId(null);
    setRequest(null);
    setPresentation(null);
    setOutlineMeta(null);
    setSubmitError(null);
  };

  const handleBack = () => {
    setRequest(null);
    setPresentation(null);
    setOutlineMeta(null);
    setSubmitError(null);
  };

  const currentStep = jobId ? 3 : presentation ? 2 : 1;

  return (
    <div className="app">
      <aside className="app-sidebar">
        <div className="brand-lockup">
          <div className="brand-mark">S</div>
          <div>
            <p className="brand-name">SAVRA</p>
            <p className="brand-caption">Presentation Studio</p>
          </div>
        </div>

        <nav className="step-list" aria-label="Generation progress">
          <div className={`step-item ${currentStep === 1 ? 'active' : currentStep > 1 ? 'done' : ''}`}>
            <span className="step-dot">1</span>
            <span>Draft</span>
          </div>
          <div className={`step-item ${currentStep === 2 ? 'active' : currentStep > 2 ? 'done' : ''}`}>
            <span className="step-dot">2</span>
            <span>Review & preview</span>
          </div>
          <div className={`step-item ${currentStep === 3 ? 'active' : ''}`}>
            <span className="step-dot">3</span>
            <span>Export</span>
          </div>
        </nav>

        <div className="sidebar-panel">
          <p className="panel-label">Pipeline</p>
          <p className="panel-value">Redis Queue</p>
          <p className="panel-value">L1 + L2 Cache</p>
          <p className="panel-value">OpenAI gpt-4o-mini</p>
        </div>
      </aside>

      <main className="app-main">
        <header className="topbar">
          <div>
            <p className="eyebrow">CBSE PPTX generator</p>
            <h1>Build a classroom-ready deck</h1>
          </div>
          <span className="system-pill">Async export</span>
        </header>

        <section className={`app-workspace${presentation && !jobId ? ' app-workspace--review' : ''}`}>
          {!presentation && !jobId && (
            <GenerateForm onSubmit={handleSubmit} disabled={isSubmitting} />
          )}

          {submitError && (
            <div className="status-card error-card">
              <div className="error-message">{submitError}</div>
            </div>
          )}

          {presentation && !jobId && (
            <OutlineEditor
              request={request}
              presentation={presentation}
              outlineMeta={outlineMeta}
              onChange={setPresentation}
              onGenerate={handleGenerateFinal}
              onBack={handleBack}
              disabled={isSubmitting}
            />
          )}

          {jobId && <JobStatus jobId={jobId} onReset={handleReset} />}
        </section>
      </main>
    </div>
  );
}
