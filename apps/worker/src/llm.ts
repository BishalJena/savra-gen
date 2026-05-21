// LLM integration: Anthropic Claude Haiku 4.5 (primary) with Sonnet 4.6 fallback
// Uses prompt caching for system prompt (90% cost reduction on cached input)
import Anthropic from '@anthropic-ai/sdk';
import type { PresentationData } from './shared';

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

// Lazily initialize — allows worker to start without API key for testing
let client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!client) {
    if (!ANTHROPIC_API_KEY) {
      throw new Error('ANTHROPIC_API_KEY is not set');
    }
    client = new Anthropic({ apiKey: ANTHROPIC_API_KEY });
  }
  return client;
}

// The system prompt is cached via Anthropic's prompt caching
// At 1,200 tokens, this qualifies for caching on Haiku (2,048 token minimum met with padding)
const SYSTEM_PROMPT = `You are a slide content generator for Indian school teachers using CBSE curriculum.
Output ONLY valid JSON matching the schema below — no markdown, no explanation, no code fences.

Schema:
{
  "presentationTitle": string,
  "slides": [
    {
      "slideType": "title" | "bullet-list" | "two-column" | "content-with-image" | "quote-or-definition",
      "title": string (max 8 words),
      "bullets": string[] (max 5 items, max 12 words each) — only for bullet-list,
      "bodyText": string (max 40 words) — for title subtitle or content-with-image text,
      "leftContent": string — for two-column only,
      "rightContent": string — for two-column only,
      "quoteText": string — for quote-or-definition only,
      "speakerNote": string (max 30 words, for teacher use only)
    }
  ]
}

Rules:
- First slide MUST be type "title" with the topic as title and a short subtitle as bodyText
- Use a good MIX of slide types across the deck for visual variety
- Content must be accurate and grade-level appropriate for CBSE curriculum
- Use Indian context and examples where relevant (Indian scientists, local applications, NCERT-aligned)
- Keep text extremely concise — slides are visual aids, not textbooks
- Do not reference images you cannot see
- Include helpful speaker notes for the teacher
- Ensure the last slide is a summary or key takeaways slide
- Output ONLY the JSON object, nothing else`;

interface LLMResult {
  presentation: PresentationData;
  model: string;
  tokensUsed: number;
  costINR: number;
  cached: boolean;
}

// Model pricing (per million tokens, in USD)
const PRICING: Record<string, { input: number; output: number; cachedInput: number }> = {
  'claude-haiku-4-5-20250514': { input: 1.0, output: 5.0, cachedInput: 0.1 },
  'claude-sonnet-4-6-20250514': { input: 3.0, output: 15.0, cachedInput: 0.3 },
};

const INR_PER_USD = 83;

function calculateCost(model: string, inputTokens: number, outputTokens: number, cacheReadTokens: number): number {
  const pricing = PRICING[model] || PRICING['claude-haiku-4-5-20250514'];
  const inputCost = ((inputTokens - cacheReadTokens) / 1_000_000) * pricing.input;
  const cachedCost = (cacheReadTokens / 1_000_000) * pricing.cachedInput;
  const outputCost = (outputTokens / 1_000_000) * pricing.output;
  return (inputCost + cachedCost + outputCost) * INR_PER_USD;
}

async function callLLM(
  userPrompt: string,
  model: string,
): Promise<{ text: string; inputTokens: number; outputTokens: number; cacheReadTokens: number }> {
  const anthropic = getClient();

  const response = await anthropic.messages.create({
    model,
    max_tokens: 4096,
    system: [
      {
        type: 'text',
        text: SYSTEM_PROMPT,
        cache_control: { type: 'ephemeral' }, // Enable prompt caching
      },
    ],
    messages: [
      { role: 'user', content: userPrompt },
    ],
  });

  const textBlock = response.content.find((b: any) => b.type === 'text');
  const text = textBlock ? (textBlock as any).text : '';

  return {
    text,
    inputTokens: response.usage?.input_tokens || 0,
    outputTokens: response.usage?.output_tokens || 0,
    cacheReadTokens: (response.usage as any)?.cache_read_input_tokens || 0,
  };
}

function parseSlideJSON(text: string): PresentationData {
  // Strip any markdown code fences the model might add despite instructions
  let cleaned = text.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
  }

  const parsed = JSON.parse(cleaned);

  // Basic validation
  if (!parsed.presentationTitle || !Array.isArray(parsed.slides) || parsed.slides.length === 0) {
    throw new Error('Invalid slide JSON: missing presentationTitle or slides array');
  }

  return parsed as PresentationData;
}

export async function generateSlideContent(
  topic: string,
  grade: number,
  subject: string,
  numSlides: number,
): Promise<LLMResult> {
  const userPrompt = `Topic: ${topic}\nGrade: ${grade}\nSubject: ${subject}\nNumber of slides: ${numSlides}`;

  const PRIMARY_MODEL = 'claude-haiku-4-5-20250514';
  const FALLBACK_MODEL = 'claude-sonnet-4-6-20250514';

  // Try primary model (Haiku) first
  try {
    console.log(`[LLM] Calling ${PRIMARY_MODEL} for "${topic}" (Grade ${grade})`);
    const result = await callLLM(userPrompt, PRIMARY_MODEL);
    const presentation = parseSlideJSON(result.text);
    const totalTokens = result.inputTokens + result.outputTokens;
    const costINR = calculateCost(PRIMARY_MODEL, result.inputTokens, result.outputTokens, result.cacheReadTokens);

    console.log(`[LLM] Success: ${presentation.slides.length} slides, ${totalTokens} tokens, ₹${costINR.toFixed(2)}, cache reads: ${result.cacheReadTokens}`);

    return {
      presentation,
      model: PRIMARY_MODEL,
      tokensUsed: totalTokens,
      costINR,
      cached: result.cacheReadTokens > 0,
    };
  } catch (err: any) {
    // If it's a 503/529/rate limit, escalate to fallback
    const status = err?.status || err?.error?.status;
    if (status === 503 || status === 529 || status === 429) {
      console.warn(`[LLM] ${PRIMARY_MODEL} returned ${status}, escalating to ${FALLBACK_MODEL}`);
    } else if (err instanceof SyntaxError || err.message?.includes('Invalid slide JSON')) {
      console.warn(`[LLM] ${PRIMARY_MODEL} returned invalid JSON, retrying with ${FALLBACK_MODEL}`);
    } else {
      // Re-throw non-transient errors
      throw err;
    }
  }

  // Fallback to Sonnet
  console.log(`[LLM] Calling fallback ${FALLBACK_MODEL} for "${topic}" (Grade ${grade})`);
  const result = await callLLM(userPrompt, FALLBACK_MODEL);
  const presentation = parseSlideJSON(result.text);
  const totalTokens = result.inputTokens + result.outputTokens;
  const costINR = calculateCost(FALLBACK_MODEL, result.inputTokens, result.outputTokens, result.cacheReadTokens);

  console.log(`[LLM] Fallback success: ${presentation.slides.length} slides, ${totalTokens} tokens, ₹${costINR.toFixed(2)}`);

  return {
    presentation,
    model: FALLBACK_MODEL,
    tokensUsed: totalTokens,
    costINR,
    cached: result.cacheReadTokens > 0,
  };
}

// For testing without an API key — returns realistic mock data
export function generateMockSlideContent(
  topic: string,
  grade: number,
  _subject: string,
  numSlides: number,
): LLMResult {
  const slides: any[] = [
    {
      slideType: 'title',
      title: topic,
      bodyText: `A comprehensive guide for Grade ${grade} students`,
      speakerNote: `Welcome the students and introduce today's topic: ${topic}`,
    },
  ];

  const slideTypes = ['bullet-list', 'two-column', 'content-with-image', 'quote-or-definition'];

  for (let i = 1; i < numSlides - 1; i++) {
    const type = slideTypes[i % slideTypes.length];
    const slide: any = {
      slideType: type,
      title: `${topic} — Part ${i}`,
      speakerNote: `Explain this section clearly using examples from the NCERT textbook.`,
    };

    if (type === 'bullet-list') {
      slide.bullets = [
        `Key concept ${i}.1 related to ${topic}`,
        `Key concept ${i}.2 with Indian context`,
        `Key concept ${i}.3 for CBSE curriculum`,
        `Practice question for students`,
      ];
    } else if (type === 'two-column') {
      slide.leftContent = `Advantages of understanding ${topic} in daily life applications`;
      slide.rightContent = `Key formulas and definitions that students must memorize for exams`;
    } else if (type === 'content-with-image') {
      slide.bodyText = `This section covers the fundamental principles of ${topic} as described in the NCERT textbook for Grade ${grade}.`;
    } else if (type === 'quote-or-definition') {
      slide.quoteText = `"The study of ${topic} is essential for understanding the world around us." — NCERT`;
    }

    slides.push(slide);
  }

  // Summary slide
  slides.push({
    slideType: 'bullet-list',
    title: 'Key Takeaways',
    bullets: [
      `Understood the fundamentals of ${topic}`,
      'Connected concepts to real-world Indian applications',
      'Practiced with CBSE-aligned questions',
      'Ready for the upcoming assessment',
    ],
    speakerNote: 'Recap the main points and assign homework from the NCERT exercises.',
  });

  return {
    presentation: { presentationTitle: `${topic} — Grade ${grade}`, slides },
    model: 'mock',
    tokensUsed: 0,
    costINR: 0,
    cached: false,
  };
}
