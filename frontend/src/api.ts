const API_BASE = '/api';

export interface GenerateRequest {
  topic: string;
  grade: number;
  subject: string;
  numSlides: number;
}

export interface GenerateResponse {
  jobId: string;
  status: string;
  estimatedSeconds: number;
  pollUrl: string;
  deduplicated?: boolean;
}

export interface JobStatusResponse {
  jobId: string;
  status: 'queued' | 'processing' | 'done' | 'failed';
  step?: string;
  progress?: number;
  cached: boolean;
  downloadUrl?: string;
  error?: string;
  tokensUsed?: number;
  costINR?: number;
  model?: string;
  slidePreview?: Array<{ type: string; title: string }>;
  createdAt: string;
}

export async function submitGeneration(data: GenerateRequest): Promise<GenerateResponse> {
  const res = await fetch(`${API_BASE}/ppt/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Request failed' }));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.json();
}

export async function pollJobStatus(jobId: string): Promise<JobStatusResponse> {
  const res = await fetch(`${API_BASE}/ppt/job/${jobId}`);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  return res.json();
}

export function getDownloadUrl(jobId: string): string {
  return `${API_BASE}/ppt/download/${jobId}`;
}
