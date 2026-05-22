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

  return (
    <div className="app">
      <header className="app-header">
        <div className="app-logo">
          <div className="app-logo-icon">S</div>
          <span className="app-logo-text">SAVRA</span>
        </div>
        <span className="app-badge">PPT Generator</span>
      </header>

      <main className="app-main">
        <div className="app-container">
          {!presentation && !jobId && (
            <GenerateForm onSubmit={handleSubmit} disabled={isSubmitting} />
          )}

          {submitError && (
            <div className="status-card">
              <div className="error-message">{submitError}</div>
            </div>
          )}

          {presentation && !jobId && (
            <OutlineEditor
              presentation={presentation}
              outlineMeta={outlineMeta}
              onChange={setPresentation}
              onGenerate={handleGenerateFinal}
              onBack={handleBack}
              disabled={isSubmitting}
            />
          )}

          {jobId && <JobStatus jobId={jobId} onReset={handleReset} />}
        </div>
      </main>

      <footer className="app-footer">
        <span>SAVRA AI</span>
        <span className="footer-dot" />
        <span>Async PPT Generation</span>
        <span className="footer-dot" />
        <span>BullMQ + Haiku 4.5</span>
      </footer>
    </div>
  );
}
