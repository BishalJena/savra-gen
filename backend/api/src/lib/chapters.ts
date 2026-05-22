import { redisConnection } from './queue';
import { getCbseChapters } from './cbse-chapters';

const CHAPTER_PREFIX = 'chapters:';

function catalogKey(grade: number, subject: string): string {
  return `${CHAPTER_PREFIX}${grade}:${subject.toLowerCase().trim().replace(/\s+/g, '_')}`;
}

export async function listChapters(grade: number, subject: string): Promise<string[]> {
  const key = catalogKey(grade, subject);
  const stored = await redisConnection.smembers(key);
  const seeded = [...getCbseChapters(grade, subject)];
  const merged = [...new Set([...seeded, ...stored])].sort((a, b) => a.localeCompare(b));
  return merged;
}

export async function recordChapter(grade: number, subject: string, chapter: string): Promise<void> {
  const trimmed = chapter.trim();
  if (trimmed.length < 2) return;
  await redisConnection.sadd(catalogKey(grade, subject), trimmed);
}
