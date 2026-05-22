import type { QuizQuestion, SlideData } from './types';

const OPTION_LINE = /^[A-D][).:]\s*(.+)$/i;
const QUESTION_LINE = /^Q\d*[:.)]\s*(.+)$/i;

export function parseQuizFromLines(lines: string[]): QuizQuestion[] {
  const questions: QuizQuestion[] = [];
  let current: QuizQuestion | null = null;

  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line === '---') continue;

    const qMatch = line.match(QUESTION_LINE);
    if (qMatch) {
      if (current?.question) questions.push(current);
      current = { question: qMatch[1].trim(), options: [] };
      continue;
    }

    const optMatch = line.match(OPTION_LINE);
    if (optMatch && current) {
      current.options.push(optMatch[1].trim());
      continue;
    }

    if (current) {
      if (current.options.length === 0 && !line.startsWith('Teacher:')) {
        current.question = `${current.question} ${line}`.trim();
      }
    }
  }

  if (current?.question) questions.push(current);
  return questions;
}

export function parseQuizFromBullets(bullets: string[]): QuizQuestion[] {
  return parseQuizFromLines(bullets);
}

export function getQuizQuestions(slide: SlideData): QuizQuestion[] {
  if (slide.quizQuestions?.length) return slide.quizQuestions;
  if (slide.bullets?.length) return parseQuizFromBullets(slide.bullets);
  return [];
}

export function formatQuizForEditor(slide: SlideData): string {
  const questions = getQuizQuestions(slide);
  if (!questions.length) return '';

  return questions
    .map((q, i) => {
      const opts = q.options.map((o, j) => `${String.fromCharCode(65 + j)}) ${o}`).join('\n');
      return `Q${i + 1}: ${q.question}\n${opts}`;
    })
    .join('\n\n');
}

export function quizFromEditorText(text: string): QuizQuestion[] {
  const blocks = text.split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean);
  const questions: QuizQuestion[] = [];

  for (const block of blocks) {
    const parsed = parseQuizFromLines(block.split('\n'));
    questions.push(...parsed);
  }

  if (!questions.length && text.trim()) {
    return parseQuizFromLines(text.split('\n'));
  }

  return questions;
}

export function normalizeQuizSlide(slide: SlideData): SlideData {
  const questions = getQuizQuestions(slide);
  return {
    ...slide,
    slideType: 'quiz',
    quizQuestions: questions,
    bullets: undefined,
  };
}
