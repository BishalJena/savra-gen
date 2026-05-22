import type { PptRequest, SlideData } from '../shared';

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

const SINGLE_SLIDE_SYSTEM = `You fill ONE slide for an Indian CBSE teacher's presentation.
Output ONLY valid JSON:
{
  "slide": {
    "slideType": "title" | "bullet-list" | "two-column" | "content-with-image" | "quote-or-definition" | "quiz",
    "title": string,
    "bullets": string[],
    "bodyText": string,
    "leftContent": string,
    "rightContent": string,
    "quoteText": string,
    "speakerNote": string,
    "quizQuestions": [{ "question": string, "options": string[] }]
  }
}

Rules:
- Match the requested slideType exactly
- When slideType is "quiz", you MUST use quizQuestions (2-3 questions, each with 3-4 short options). Do NOT use bullets for quizzes.
- Honor the teacher's intent (quiz, discussion, definition, recap, etc.)
- Fit between neighboring slides — do not repeat the whole lesson
- Grade-appropriate, concise
- Include speakerNote with timing or facilitation tips
- Only include fields relevant to the slideType
- Output ONLY JSON`;

interface PopulateLlmInput {
  req: PptRequest;
  slideType: SlideData['slideType'];
  intent: string;
  deckContext: string;
}

interface PopulateLlmResult {
  slide: SlideData;
  model: string;
  tokensUsed: number;
}

function parseSingleSlideJSON(text: string): SlideData {
  let cleaned = text.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
  }
  const parsed = JSON.parse(cleaned);
  const slide = parsed.slide ?? parsed;
  if (!slide.title || !slide.slideType) {
    throw new Error('Invalid slide JSON');
  }
  if (slide.slideType === 'quiz' && !Array.isArray(slide.quizQuestions)) {
    throw new Error('Quiz slides require quizQuestions array');
  }
  return slide as SlideData;
}

function buildUserPrompt(input: PopulateLlmInput): string {
  const { req, slideType, intent, deckContext } = input;
  return [
    `Chapter: ${req.chapter}`,
    `Grade: ${req.grade}`,
    `Subject: ${req.subject}`,
    `Requested slideType: ${slideType}`,
    `Teacher intent: ${intent}`,
    '',
    deckContext,
  ].join('\n');
}

async function callOpenAI(userPrompt: string): Promise<{ text: string; tokensUsed: number }> {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      messages: [
        { role: 'system', content: SINGLE_SLIDE_SYSTEM },
        { role: 'user', content: userPrompt },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.5,
    }),
  });
  const payload: any = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(payload?.error?.message || `OpenAI HTTP ${response.status}`);
  }
  const tokensUsed = (payload?.usage?.prompt_tokens || 0) + (payload?.usage?.completion_tokens || 0);
  return { text: payload?.choices?.[0]?.message?.content || '', tokensUsed };
}

export async function populateSlideWithLlm(input: PopulateLlmInput): Promise<PopulateLlmResult> {
  const userPrompt = buildUserPrompt(input);

  if (!OPENAI_API_KEY && !ANTHROPIC_API_KEY) {
    throw new Error('No LLM API key configured');
  }

  if (OPENAI_API_KEY) {
    const result = await callOpenAI(userPrompt);
    const slide = parseSingleSlideJSON(result.text);
    return { slide, model: `openai:${OPENAI_MODEL}`, tokensUsed: result.tokensUsed };
  }

  const Anthropic = (await import('@anthropic-ai/sdk')).default;
  const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY });
  const response = await client.messages.create({
    model: 'claude-haiku-4-5-20250514',
    max_tokens: 1024,
    system: SINGLE_SLIDE_SYSTEM,
    messages: [{ role: 'user', content: userPrompt }],
  });
  const textBlock = response.content.find((b: any) => b.type === 'text');
  const slide = parseSingleSlideJSON(textBlock ? (textBlock as any).text : '');
  const tokensUsed = (response.usage?.input_tokens || 0) + (response.usage?.output_tokens || 0);
  return { slide, model: 'claude-haiku-4-5-20250514', tokensUsed };
}
