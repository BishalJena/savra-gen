import { useEffect, useState, useRef } from 'react';
import { pollJobStatus, getDownloadUrl, type JobStatusResponse } from '../api';

interface Props {
  jobId: string;
  onReset: () => void;
}

const POLL_INTERVAL = 3000; // 3 seconds

export default function JobStatus({ jobId, onReset }: Props) {
  const [status, setStatus] = useState<JobStatusResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const intervalRef = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;

    const poll = async () => {
      try {
        const result = await pollJobStatus(jobId);
        if (cancelled) return;
        setStatus(result);
        setError(null);

        // Stop polling when terminal state
        if (result.status === 'done' || result.status === 'failed') {
          if (intervalRef.current) {
            clearInterval(intervalRef.current);
            intervalRef.current = null;
          }
        }
      } catch (err: any) {
        if (cancelled) return;
        setError(err.message);
      }
    };

    // Poll immediately, then every 3s
    poll();
    intervalRef.current = window.setInterval(poll, POLL_INTERVAL);

    return () => {
      cancelled = true;
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [jobId]);

  if (error) {
    return (
      <div className="status-card">
        <div className="error-message">⚠️ {error}</div>
        <button className="btn-new" onClick={onReset}>Try Again</button>
      </div>
    );
  }

  if (!status) {
    return (
      <div className="status-card">
        <div className="status-header">
          <h3>Connecting...</h3>
          <span className="status-tag queued">INITIALIZING</span>
        </div>
      </div>
    );
  }

  const progress = status.progress || (status.status === 'queued' ? 5 : status.status === 'done' ? 100 : 50);

  return (
    <div className="status-card">
      <div className="status-header">
        <h3>
          {status.status === 'done' ? '🎉 Presentation Ready!' :
           status.status === 'failed' ? '❌ Generation Failed' :
           '📝 Generating Presentation'}
        </h3>
        <span className={`status-tag ${status.status}`}>
          {status.status === 'done' ? '✓ DONE' :
           status.status === 'failed' ? 'FAILED' :
           status.status.toUpperCase()}
        </span>
      </div>

      {status.step && status.status !== 'done' && (
        <p className="status-step">{status.step}</p>
      )}

      {status.status !== 'done' && status.status !== 'failed' && (
        <div className="progress-bar-container">
          <div className="progress-bar" style={{ width: `${progress}%` }} />
        </div>
      )}

      {status.status === 'done' && (
        <>
          <div className="status-stats">
            <div className="stat-item">
              <span className="stat-label">Model</span>
              <span className="stat-value">{status.model || '—'}</span>
            </div>
            <div className="stat-item">
              <span className="stat-label">Tokens</span>
              <span className="stat-value">{status.tokensUsed?.toLocaleString() || '0'}</span>
            </div>
            <div className="stat-item">
              <span className="stat-label">Cost</span>
              <span className="stat-value cost">
                ₹{status.costINR?.toFixed(2) || '0.00'}
              </span>
            </div>
            <div className="stat-item">
              <span className="stat-label">Cache</span>
              <span className={`stat-value ${status.cached ? 'cached' : ''}`}>
                {status.cached ? '✓ HIT' : 'MISS'}
              </span>
            </div>
          </div>

          {status.slidePreview && status.slidePreview.length > 0 && (
            <div className="slide-preview">
              <h4>Slides Generated</h4>
              <div className="slide-preview-list">
                {status.slidePreview.map((slide, i) => (
                  <div key={i} className="slide-preview-item">
                    <span className="slide-number">{i + 1}</span>
                    <span style={{ flex: 1 }}>{slide.title}</span>
                    <span className="slide-type">{slide.type}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div style={{ display: 'flex', flexWrap: 'wrap' }}>
            <a
              href={getDownloadUrl(jobId)}
              className="btn-download"
              download
            >
              📥 Download PPTX
            </a>
            <button className="btn-new" onClick={onReset}>
              + New Presentation
            </button>
          </div>
        </>
      )}

      {status.status === 'failed' && (
        <>
          <div className="error-message">
            {status.error || 'An unexpected error occurred. Please try again.'}
          </div>
          <button className="btn-new" onClick={onReset}>🔄 Try Again</button>
        </>
      )}
    </div>
  );
}
