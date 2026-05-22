// Worker LLM — re-exports API implementation via duplicated thin wrapper using PptRequest.
import type { PptRequest, PresentationData } from './shared';

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

import Anthropic from '@anthropic-ai/sdk';

const SYSTEM_PROMPT = `You are a slide content generator for Indian school teachers using CBSE curriculum.
Output ONLY valid JSON matching this shape:
{
  "presentationTitle": string,
  "slides": [
    {
      "slideType": "title" | "bullet-list" | "two-column" | "content-with-image" | "quote-or-definition",
      "title": string,
      "bullets": string[],
      "bodyText": string,
      "leftContent": string,
      "rightContent": string,
      "quoteText": string,
      "speakerNote": string
    }
  ]
}

Rules:
- First slide MUST be type "title"
- Content must be accurate and grade-level appropriate for CBSE curriculum
- Keep text concise
- Output ONLY the JSON object, nothing else`;

interface LLMResult {
  presentation: PresentationData;
  model: string;
  tokensUsed: number;
  costINR: number;
  cached: boolean;
}

let anthropicClient: Anthropic | null = null;
function getAnthropicClient(): Anthropic {
  if (!anthropicClient) {
    if (!ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY is not set');
    anthropicClient = new Anthropic({ apiKey: ANTHROPIC_API_KEY });
  }
  return anthropicClient;
}

function buildUserPrompt(req: PptRequest): string {
  return `Chapter: ${req.chapter}\nGrade: ${req.grade}\nSubject: ${req.subject}\nNumber of slides: ${req.numSlides}`;
}

function parseSlideJSON(text: string): PresentationData {
  let cleaned = text.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
  }
  const parsed = JSON.parse(cleaned);
  if (!parsed.presentationTitle || !Array.isArray(parsed.slides)) {
    throw new Error('Invalid slide JSON');
  }
  return parsed;
}

export async function generateSlideContent(req: PptRequest): Promise<LLMResult> {
  const userPrompt = buildUserPrompt(req);

  if (OPENAI_API_KEY) {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userPrompt },
        ],
        response_format: { type: 'json_object' },
        temperature: 0.4,
      }),
    });
    const payload: any = await response.json().catch(() => null);
    if (!response.ok) throw new Error(payload?.error?.message || `OpenAI HTTP ${response.status}`);
    const presentation = parseSlideJSON(payload?.choices?.[0]?.message?.content || '');
    return {
      presentation,
      model: `openai:${OPENAI_MODEL}`,
      tokensUsed: (payload?.usage?.prompt_tokens || 0) + (payload?.usage?.completion_tokens || 0),
      costINR: 0.5,
      cached: false,
    };
  }

  const primaryModel = 'claude-haiku-4-5-20250514';
  const fallbackModel = 'claude-sonnet-4-6-20250514';

  try {
    const response = await getAnthropicClient().messages.create({
      model: primaryModel,
      max_tokens: 4096,
      system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: userPrompt }],
    });
    const textBlock = response.content.find((b: any) => b.type === 'text');
    const presentation = parseSlideJSON(textBlock ? (textBlock as any).text : '');
    return {
      presentation,
      model: primaryModel,
      tokensUsed: (response.usage?.input_tokens || 0) + (response.usage?.output_tokens || 0),
      costINR: 0.86,
      cached: false,
    };
  } catch (err: any) {
    const status = err?.status;
    if (status !== 503 && status !== 529 && status !== 429) throw err;
  }

  const response = await getAnthropicClient().messages.create({
    model: fallbackModel,
    max_tokens: 4096,
    system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: userPrompt }],
  });
  const textBlock = response.content.find((b: any) => b.type === 'text');
  const presentation = parseSlideJSON(textBlock ? (textBlock as any).text : '');
  return {
    presentation,
    model: fallbackModel,
    tokensUsed: (response.usage?.input_tokens || 0) + (response.usage?.output_tokens || 0),
    costINR: 2.5,
    cached: false,
  };
}

export function generateMockSlideContent(req: PptRequest): LLMResult {
  const { chapter, grade, subject, numSlides } = req;
  const slides: any[] = [
    {
      slideType: 'title',
      title: chapter,
      bodyText: `Class ${grade} ${subject}`,
      speakerNote: `Introduce ${chapter}.`,
    },
  ];
  const slideTypes = ['bullet-list', 'two-column', 'content-with-image', 'quote-or-definition'];
  for (let i = 1; i < numSlides - 1; i++) {
    const type = slideTypes[i % slideTypes.length];
    const slide: any = { slideType: type, title: `${chapter} — Part ${i}`, speakerNote: 'Explain with examples.' };
    if (type === 'bullet-list') {
      slide.bullets = ['Key idea', `Class ${grade} example`, 'Misconception', 'Check question'];
    } else if (type === 'two-column') {
      slide.leftContent = `Prior knowledge: ${chapter}`;
      slide.rightContent = 'Learning goal for this slide';
    } else if (type === 'content-with-image') {
      slide.bodyText = `Visual explanation of ${chapter}.`;
    } else {
      slide.quoteText = `Definition of ${chapter} for Class ${grade}.`;
    }
    slides.push(slide);
  }
  slides.push({
    slideType: 'bullet-list',
    title: 'Recap',
    bullets: [`Review ${chapter}`, 'Practice question', 'Next lesson link'],
    speakerNote: 'Formative check.',
  });
  return {
    presentation: { presentationTitle: `${chapter} — Class ${grade}`, slides },
    model: 'mock',
    tokensUsed: 0,
    costINR: 0,
    cached: false,
  };
}
