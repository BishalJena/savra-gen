import { useState, FormEvent, useEffect } from 'react';
import { fetchChapters, type GenerateRequest } from '../api';

interface Props {
  onSubmit: (data: GenerateRequest) => void;
  disabled: boolean;
}

const SUBJECTS = [
  'Science', 'Mathematics', 'Physics', 'Chemistry', 'Biology',
  'Social Science', 'History', 'Geography', 'English', 'Hindi',
  'Computer Science', 'Economics', 'Political Science',
];

const OTHER_CHAPTER = '__other__';

export default function GenerateForm({ onSubmit, disabled }: Props) {
  const [grade, setGrade] = useState(8);
  const [subject, setSubject] = useState('Science');
  const [chapter, setChapter] = useState('');
  const [chapterOptions, setChapterOptions] = useState<string[]>([]);
  const [useCustomChapter, setUseCustomChapter] = useState(false);
  const [numSlides, setNumSlides] = useState(10);

  useEffect(() => {
    let cancelled = false;
    setChapter('');
    setUseCustomChapter(false);
    fetchChapters(grade, subject).then((list) => {
      if (!cancelled) setChapterOptions(list);
    });
    return () => { cancelled = true; };
  }, [grade, subject]);

  const hasCatalog = chapterOptions.length > 0;

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!chapter.trim()) return;
    onSubmit({ chapter: chapter.trim(), grade, subject, numSlides });
  };

  return (
    <div className="form-card">
      <h2>Draft Presentation</h2>
      <p className="subtitle">
        CBSE chapter list for each class and subject. Pick class → subject → chapter.
      </p>

      <form onSubmit={handleSubmit}>
        <div className="form-row">
          <div className="form-group">
            <label htmlFor="grade">Class</label>
            <select
              id="grade"
              value={grade}
              onChange={(e) => setGrade(Number(e.target.value))}
              disabled={disabled}
            >
              {Array.from({ length: 12 }, (_, i) => i + 1).map((g) => (
                <option key={g} value={g}>Class {g}</option>
              ))}
            </select>
          </div>

          <div className="form-group">
            <label htmlFor="subject">Subject</label>
            <select
              id="subject"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              disabled={disabled}
            >
              {SUBJECTS.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="form-group">
          <label htmlFor="chapter">Chapter</label>
          {hasCatalog && !useCustomChapter ? (
            <select
              id="chapter"
              value={chapter}
              disabled={disabled}
              onChange={(e) => {
                const value = e.target.value;
                if (value === OTHER_CHAPTER) {
                  setUseCustomChapter(true);
                  setChapter('');
                } else {
                  setChapter(value);
                }
              }}
            >
              <option value="">Select a chapter</option>
              {chapterOptions.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
              <option value={OTHER_CHAPTER}>Other chapter (type manually)</option>
            </select>
          ) : (
            <>
              <input
                id="chapter"
                type="text"
                placeholder="Enter chapter name"
                value={chapter}
                onChange={(e) => setChapter(e.target.value)}
                disabled={disabled}
                autoFocus
              />
              {hasCatalog && (
                <button
                  type="button"
                  className="btn-link-back"
                  disabled={disabled}
                  onClick={() => {
                    setUseCustomChapter(false);
                    setChapter('');
                  }}
                >
                  Back to chapter list
                </button>
              )}
            </>
          )}
          {hasCatalog && (
            <p className="field-hint">{chapterOptions.length} NCERT-aligned chapters for Class {grade} {subject}</p>
          )}
        </div>

        <div className="form-group">
          <label htmlFor="numSlides">Number of Slides</label>
          <select
            id="numSlides"
            value={numSlides}
            onChange={(e) => setNumSlides(Number(e.target.value))}
            disabled={disabled}
          >
            {[5, 8, 10, 12, 15, 20].map((n) => (
              <option key={n} value={n}>{n} slides</option>
            ))}
          </select>
        </div>

        <button type="submit" className="btn-generate" disabled={disabled || !chapter.trim()}>
          {disabled ? 'Drafting...' : 'Create Editable Draft'}
        </button>
      </form>
    </div>
  );
}
