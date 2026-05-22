/** Editor helpers — mirrors packages/shared/quiz.ts for the browser bundle. */

export interface QuizQuestion {
  question: string;
  options: string[];
}

export interface QuizSlideFields {
  slideType: string;
  title: string;
  bullets?: string[];
  quizQuestions?: QuizQuestion[];
}

const OPTION_LINE = /^[A-D][).:]\s*(.+)$/i;
const QUESTION_LINE = /^Q\d*[:.)]\s*(.+)$/i;

function parseQuizFromLines(lines: string[]): QuizQuestion[] {
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
    }
  }

  if (current?.question) questions.push(current);
  return questions;
}

export function getQuizQuestions(slide: QuizSlideFields): QuizQuestion[] {
  if (slide.quizQuestions?.length) return slide.quizQuestions;
  if (slide.bullets?.length) return parseQuizFromLines(slide.bullets);
  return [];
}

export function formatQuizForEditor(slide: QuizSlideFields): string {
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
    questions.push(...parseQuizFromLines(block.split('\n')));
  }

  if (!questions.length && text.trim()) {
    return parseQuizFromLines(text.split('\n'));
  }

  return questions;
}
