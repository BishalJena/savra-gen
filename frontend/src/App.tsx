import { useState } from 'react';
import GenerateForm from './components/GenerateForm';
import JobStatus from './components/JobStatus';
import { submitGeneration, type GenerateRequest } from './api';

export default function App() {
  const [jobId, setJobId] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const handleSubmit = async (data: GenerateRequest) => {
    setIsSubmitting(true);
    setSubmitError(null);

    try {
      const result = await submitGeneration(data);
      setJobId(result.jobId);
    } catch (err: any) {
      setSubmitError(err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleReset = () => {
    setJobId(null);
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
          <GenerateForm onSubmit={handleSubmit} disabled={isSubmitting || !!jobId} />

          {submitError && (
            <div className="status-card">
              <div className="error-message">⚠️ {submitError}</div>
            </div>
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
