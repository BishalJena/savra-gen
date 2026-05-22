// LLM integration for structured slide JSON (shared by API outline + worker).
import Anthropic from '@anthropic-ai/sdk';
import type { PptRequest, PresentationData } from '../shared';

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

export function hasLlmProvider(): boolean {
  return Boolean(OPENAI_API_KEY || ANTHROPIC_API_KEY);
}

let anthropicClient: Anthropic | null = null;
function getAnthropicClient(): Anthropic {
  if (!anthropicClient) {
    if (!ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY is not set');
    anthropicClient = new Anthropic({ apiKey: ANTHROPIC_API_KEY });
  }
  return anthropicClient;
}

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
- First slide MUST be type "title" with the chapter as title and a short subtitle as bodyText
- Use a good mix of slide types across the deck
- Content must be accurate and grade-level appropriate for CBSE curriculum
- Use Indian context and examples where relevant
- Keep text concise: max 5 bullets per slide, max 12 words per bullet, max 40 words for bodyText
- Do not reference images you cannot see
- Include helpful speaker notes for the teacher
- Ensure the last slide is a summary or key takeaways slide
- Output ONLY the JSON object, nothing else`;

export interface LLMResult {
  presentation: PresentationData;
  model: string;
  tokensUsed: number;
  costINR: number;
  cached: boolean;
}

interface RawLLMResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
}

const INR_PER_USD = 83;
const PRICING: Record<string, { input: number; output: number; cachedInput?: number }> = {
  'gpt-4o-mini': { input: 0.15, output: 0.6 },
  'claude-haiku-4-5-20250514': { input: 1.0, output: 5.0, cachedInput: 0.1 },
  'claude-sonnet-4-6-20250514': { input: 3.0, output: 15.0, cachedInput: 0.3 },
};

function calculateCost(model: string, inputTokens: number, outputTokens: number, cacheReadTokens = 0): number {
  const pricing = PRICING[model] || PRICING['gpt-4o-mini'];
  const billableInput = Math.max(inputTokens - cacheReadTokens, 0);
  const cachedRate = pricing.cachedInput ?? pricing.input;
  const inputCost = (billableInput / 1_000_000) * pricing.input;
  const cachedCost = (cacheReadTokens / 1_000_000) * cachedRate;
  const outputCost = (outputTokens / 1_000_000) * pricing.output;
  return (inputCost + cachedCost + outputCost) * INR_PER_USD;
}

function buildUserPrompt(req: PptRequest): string {
  return `Chapter: ${req.chapter}\nGrade: ${req.grade}\nSubject: ${req.subject}\nNumber of slides: ${req.numSlides}`;
}

async function callOpenAI(userPrompt: string, model: string): Promise<RawLLMResult> {
  if (!OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is not set');

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.4,
    }),
  });

  const payload: any = await response.json().catch(() => null);
  if (!response.ok) {
    const message = payload?.error?.message || `OpenAI request failed with HTTP ${response.status}`;
    const error: any = new Error(message);
    error.status = response.status;
    throw error;
  }

  return {
    text: payload?.choices?.[0]?.message?.content || '',
    inputTokens: payload?.usage?.prompt_tokens || 0,
    outputTokens: payload?.usage?.completion_tokens || 0,
    cacheReadTokens: 0,
  };
}

async function callAnthropic(userPrompt: string, model: string): Promise<RawLLMResult> {
  const response = await getAnthropicClient().messages.create({
    model,
    max_tokens: 4096,
    system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: userPrompt }],
  });

  const textBlock = response.content.find((block: any) => block.type === 'text');
  return {
    text: textBlock ? (textBlock as any).text : '',
    inputTokens: response.usage?.input_tokens || 0,
    outputTokens: response.usage?.output_tokens || 0,
    cacheReadTokens: (response.usage as any)?.cache_read_input_tokens || 0,
  };
}

function parseSlideJSON(text: string): PresentationData {
  let cleaned = text.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
  }
  const parsed = JSON.parse(cleaned);
  if (!parsed.presentationTitle || !Array.isArray(parsed.slides) || parsed.slides.length === 0) {
    throw new Error('Invalid slide JSON: missing presentationTitle or slides array');
  }
  return parsed as PresentationData;
}

export async function generateSlideContent(req: PptRequest): Promise<LLMResult> {
  const userPrompt = buildUserPrompt(req);

  if (OPENAI_API_KEY) {
    console.log(`[LLM] Calling OpenAI ${OPENAI_MODEL} for "${req.chapter}" (Grade ${req.grade})`);
    const result = await callOpenAI(userPrompt, OPENAI_MODEL);
    const presentation = parseSlideJSON(result.text);
    const tokensUsed = result.inputTokens + result.outputTokens;
    const costINR = calculateCost(OPENAI_MODEL, result.inputTokens, result.outputTokens);
    return {
      presentation,
      model: `openai:${OPENAI_MODEL}`,
      tokensUsed,
      costINR,
      cached: false,
    };
  }

  const primaryModel = 'claude-haiku-4-5-20250514';
  const fallbackModel = 'claude-sonnet-4-6-20250514';

  try {
    console.log(`[LLM] Calling ${primaryModel} for "${req.chapter}" (Grade ${req.grade})`);
    const result = await callAnthropic(userPrompt, primaryModel);
    const presentation = parseSlideJSON(result.text);
    const tokensUsed = result.inputTokens + result.outputTokens;
    const costINR = calculateCost(primaryModel, result.inputTokens, result.outputTokens, result.cacheReadTokens);
    return {
      presentation,
      model: primaryModel,
      tokensUsed,
      costINR,
      cached: result.cacheReadTokens > 0,
    };
  } catch (err: any) {
    const status = err?.status || err?.error?.status;
    if (status === 503 || status === 529 || status === 429) {
      console.warn(`[LLM] ${primaryModel} returned ${status}, escalating to ${fallbackModel}`);
    } else if (err instanceof SyntaxError || err.message?.includes('Invalid slide JSON')) {
      console.warn(`[LLM] ${primaryModel} returned invalid JSON, retrying with ${fallbackModel}`);
    } else {
      throw err;
    }
  }

  const result = await callAnthropic(userPrompt, fallbackModel);
  const presentation = parseSlideJSON(result.text);
  const tokensUsed = result.inputTokens + result.outputTokens;
  const costINR = calculateCost(fallbackModel, result.inputTokens, result.outputTokens, result.cacheReadTokens);
  return {
    presentation,
    model: fallbackModel,
    tokensUsed,
    costINR,
    cached: result.cacheReadTokens > 0,
  };
}
