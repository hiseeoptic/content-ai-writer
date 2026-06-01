/**
 * Shared OpenAI helper used by all serverless API routes.
 * Folder name starts with "_" so Vercel does NOT publish it as an endpoint.
 */
import OpenAI from 'openai';

let _client: OpenAI | null = null;

export function getOpenAI(): OpenAI {
  if (_client) return _client;
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error(
      'OPENAI_API_KEY is not set. Add it in Vercel → Project → Settings → Environment Variables.'
    );
  }
  _client = new OpenAI({
    apiKey,
    organization: process.env.OPENAI_ORG_ID,
  });
  return _client;
}

export const TEXT_MODEL = process.env.OPENAI_TEXT_MODEL || 'gpt-4o-mini';
export const IMAGE_MODEL = process.env.OPENAI_IMAGE_MODEL || 'gpt-image-1';

export const MAX_RETRIES = 4;
export const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
export const backoff = (attempt: number) => 1500 * Math.pow(2, attempt - 1);

export function cleanText(text: string): string {
  if (!text) return '';
  return text
    .replace(/\*\*/g, '')
    .replace(/##/g, '')
    .replace(/###/g, '')
    .replace(/(^|\n)#\s/g, '$1')
    .replace(/\*/g, '-')
    .replace(/^["']|["']$/g, '')
    .trim();
}

/**
 * Plain chat-completion wrapper with retries.
 */
export async function chat(opts: {
  system?: string;
  user: string;
  jsonMode?: boolean;
  temperature?: number;
  maxTokens?: number;
}): Promise<string> {
  const ai = getOpenAI();
  const messages: Array<{ role: 'system' | 'user'; content: string }> = [];
  if (opts.system) messages.push({ role: 'system', content: opts.system });
  messages.push({ role: 'user', content: opts.user });

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const completion = await ai.chat.completions.create({
        model: TEXT_MODEL,
        messages,
        temperature: opts.temperature ?? 0.8,
        max_tokens: opts.maxTokens ?? 4096,
        response_format: opts.jsonMode ? { type: 'json_object' } : undefined,
      });
      return completion.choices[0]?.message?.content ?? '';
    } catch (err: any) {
      const status = err?.status ?? err?.response?.status;
      // Retry on 429 / 5xx only
      const retryable = status === 429 || (status >= 500 && status < 600);
      if (attempt === MAX_RETRIES || !retryable) throw err;
      await delay(backoff(attempt));
    }
  }
  return '';
}

/**
 * Vision wrapper — pass an image as base64 plus a question.
 */
export async function vision(opts: {
  base64Image: string;
  mimeType?: string;
  prompt: string;
  maxTokens?: number;
}): Promise<string> {
  const ai = getOpenAI();
  const mime = opts.mimeType || 'image/png';
  const completion = await ai.chat.completions.create({
    model: TEXT_MODEL,
    max_tokens: opts.maxTokens ?? 256,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: opts.prompt },
          {
            type: 'image_url',
            image_url: { url: `data:${mime};base64,${opts.base64Image}` },
          },
        ],
      },
    ],
  });
  return completion.choices[0]?.message?.content ?? '';
}

/** Map a Gemini-style aspect ratio to a gpt-image-1 size. */
export function aspectToSize(ratio: string): '1024x1024' | '1536x1024' | '1024x1536' {
  switch (ratio) {
    case '1:1':
      return '1024x1024';
    case '16:9':
    case '4:3':
      return '1536x1024';
    case '3:4':
    case '9:16':
      return '1024x1536';
    default:
      return '1024x1024';
  }
}
