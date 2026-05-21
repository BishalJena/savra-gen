import { useState, FormEvent } from 'react';

interface Props {
  onSubmit: (data: { topic: string; grade: number; subject: string; numSlides: number }) => void;
  disabled: boolean;
}

const SUBJECTS = [
  'Science', 'Mathematics', 'Physics', 'Chemistry', 'Biology',
  'Social Science', 'History', 'Geography', 'English', 'Hindi',
  'Computer Science', 'Economics', 'Political Science',
];

export default function GenerateForm({ onSubmit, disabled }: Props) {
  const [topic, setTopic] = useState('');
  const [grade, setGrade] = useState(8);
  const [subject, setSubject] = useState('Science');
  const [numSlides, setNumSlides] = useState(10);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!topic.trim()) return;
    onSubmit({ topic: topic.trim(), grade, subject, numSlides });
  };

  return (
    <div className="form-card">
      <h2>✨ Generate Presentation</h2>
      <p className="subtitle">AI-powered CBSE-aligned slides for your classroom</p>

      <form onSubmit={handleSubmit}>
        <div className="form-group">
          <label htmlFor="topic">Topic</label>
          <input
            id="topic"
            type="text"
            placeholder="e.g., Photosynthesis, Light Reflection, Atoms and Molecules"
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            disabled={disabled}
            autoFocus
          />
        </div>

        <div className="form-row">
          <div className="form-group">
            <label htmlFor="grade">Grade</label>
            <select id="grade" value={grade} onChange={(e) => setGrade(Number(e.target.value))} disabled={disabled}>
              {Array.from({ length: 12 }, (_, i) => i + 1).map((g) => (
                <option key={g} value={g}>Class {g}</option>
              ))}
            </select>
          </div>

          <div className="form-group">
            <label htmlFor="numSlides">Number of Slides</label>
            <select id="numSlides" value={numSlides} onChange={(e) => setNumSlides(Number(e.target.value))} disabled={disabled}>
              {[5, 8, 10, 12, 15, 20].map((n) => (
                <option key={n} value={n}>{n} slides</option>
              ))}
            </select>
          </div>
        </div>

        <div className="form-group">
          <label htmlFor="subject">Subject</label>
          <select id="subject" value={subject} onChange={(e) => setSubject(e.target.value)} disabled={disabled}>
            {SUBJECTS.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>

        <button type="submit" className="btn-generate" disabled={disabled || !topic.trim()}>
          {disabled ? '⏳ Generating...' : '🚀 Generate Presentation'}
        </button>
      </form>
    </div>
  );
}
