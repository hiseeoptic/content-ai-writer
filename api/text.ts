/**
 * POST /api/text — single endpoint for every text-generation action.
 * Body shape: { action: string, params: Record<string, unknown> }
 * Returns:    { ok: true, data: any } or { ok: false, error: string }
 *
 * Actions:
 *   generateTOC          → TocItem[]
 *   generateIntroduction → string
 *   generateSection      → string
 *   generateConclusion   → string
 *   generateShorts       → string
 *   generateTitle        → string
 *   remasterArticle      → string
 *   generateBatch        → BulkGenerationResult[]
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { chat, cleanText } from './_lib/openai.js';

interface TocItem {
  sectionTitle: string;
  subSections?: string[];
}

interface BulkItem {
  id: number;
  title: string;
  outline: string;
}

interface BulkGenerationResult {
  id: number;
  title: string;
  content: string;
  imageBriefJson?: string;
  error?: string;
}

const langStr = (l: string | undefined) =>
  l === 'en' ? 'ENGLISH' : 'VIETNAMESE (Tiếng Việt)';

const sectionCount = (length: number): string => {
  if (length <= 2000) return '2-3';
  if (length <= 3000) return '3-4';
  if (length <= 5000) return '4-6';
  if (length <= 10000) return '7-10';
  if (length <= 20000) return '10-14';
  if (length <= 40000) return '15-20';
  return '20-30';
};

const introConclusionRange = (length: number): string => {
  if (length <= 2000) return '150-250';
  if (length <= 3000) return '200-350';
  if (length <= 5000) return '300-500';
  if (length <= 10000) return '600-800';
  if (length <= 20000) return '900-1200';
  if (length <= 40000) return '1300-1600';
  return '1700-2000';
};

// ---------- ACTION HANDLERS ----------

async function generateTOC(p: any): Promise<TocItem[]> {
  const { title, outline, targetLength = 5000, language = 'vi' } = p;
  const raw = await chat({
    jsonMode: true,
    system: 'You are a Senior Content Architect. You always reply with valid JSON.',
    user: `LANGUAGE: ${langStr(language)}.
TITLE: "${title}"
USER OUTLINE/INTENT: "${outline}"

TASK: Construct a logical, professional Table of Contents for the BODY of a deep-dive article.
REQUIREMENTS:
1. Logical flow: problem → analysis → solutions → advanced insights.
2. Depth: ${sectionCount(targetLength)} main chapters.
3. Each chapter MUST have 3-5 sub-points.
4. EXCLUDE intro / conclusion / summary.

OUTPUT JSON SHAPE (return exactly this object):
{ "toc": [ { "sectionTitle": "string", "subSections": ["string", "string"] } ] }`,
  });

  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed;
    if (Array.isArray(parsed.toc)) return parsed.toc;
    if (Array.isArray(parsed.sections)) return parsed.sections;
    // Fallback: pick the first array property
    for (const key of Object.keys(parsed)) {
      if (Array.isArray((parsed as any)[key])) return (parsed as any)[key];
    }
  } catch {
    // try to extract array
    const match = raw.match(/\[[\s\S]*\]/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch {
        /* noop */
      }
    }
  }
  return [];
}

async function generateIntroduction(p: any): Promise<string> {
  const { title, outline, targetLength = 5000, language = 'vi' } = p;
  const range = introConclusionRange(targetLength);
  const minWords = Math.round(parseInt(range.split('-')[0]) / 4.5);

  const text = await chat({
    system: 'You are an expert copywriter and subject matter expert.',
    user: `LANGUAGE: ${langStr(language)}.
TITLE: "${title}"
CONTEXT: "${outline}"

TASK: Write a professional and inspiring Introduction (Mở bài) for a high-quality long-form article.
GUIDELINES:
- HOOK: Compelling fact, strong statement, or relatable problem.
- DEFINE: State what the article is about, naturally.
- VALUE: Why should the reader care? Connect with aspirations / pain points.
- TONE: Professional, authoritative, engaging, inspiring.
- FORMATTING: Plain text only. No **bold**, no headers (#).

LENGTH: ~${minWords} words.
OUTPUT: Raw text content only.`,
  });
  return cleanText(text);
}

async function generateSection(p: any): Promise<string> {
  const { mainTitle, section, totalSections, targetArticleLength = 5000, language = 'vi' } = p;
  const bodyLength = targetArticleLength * 0.85;
  const sectionTargetChars = Math.round(bodyLength / Math.max(totalSections, 1));
  const targetWords = Math.round(sectionTargetChars / 4.5);

  const text = await chat({
    system: 'You are an expert long-form writer.',
    user: `LANGUAGE: ${langStr(language)}.
ARTICLE TITLE: "${mainTitle}"
CURRENT SECTION: "${section.sectionTitle}"
KEY POINTS TO COVER: ${(section.subSections || []).join(', ')}

TASK: Write the content for this specific section.
GUIDELINES:
1. STRUCTURE: Start with the section title in UPPERCASE.
2. DEPTH & EMOTION: Analyze key points deeply — explain "How" and "Why". Use relatable examples.
3. FORMATTING: Plain text only. No **bold**, no headers (#). Use "-" for bullets if needed.
4. FLOW: Smooth transitions. AVOID re-introducing the article. Jump straight into core content.
5. TONE: Expert, analytical, professional, inspiring. Avoid robotic / repetitive language.

LENGTH: At least ${targetWords} words.
OUTPUT: Raw content text only.`,
    maxTokens: 6000,
  });
  return cleanText(text);
}

async function generateConclusion(p: any): Promise<string> {
  const { title, targetLength = 5000, language = 'vi' } = p;
  const range = introConclusionRange(targetLength);
  const minWords = Math.round(parseInt(range.split('-')[0]) / 4.5);

  const text = await chat({
    user: `LANGUAGE: ${langStr(language)}.
TASK: Write a powerful Conclusion for the article "${title}".
LENGTH: ~${minWords} words.

REQUIREMENTS:
- Synthesize the main arguments (do not just repeat).
- End with a takeaway or call to action.
- Leave a lasting impression.
- TONE: Inspiring, conclusive, professional.
- FORMATTING: Plain text only. No **bold**, no headers (#).

OUTPUT: Raw text only.`,
  });
  return cleanText(text);
}

async function generateShorts(p: any): Promise<string> {
  const { outline, targetLength = 2000, language = 'vi' } = p;
  const text = await chat({
    system: 'You are an expert YouTube Shorts scriptwriter.',
    user: `LANGUAGE: ${langStr(language)}.
INPUT: "${outline}"

TASK: Write a highly engaging, fast-paced script for a YouTube Shorts video.

REQUIREMENTS:
1. EXACT LENGTH: Final script MUST be ~${targetLength} characters (count carefully).
2. STRUCTURE: Hook (0-3s) → Body (energetic delivery) → CTA.
3. TONE: Energetic, conversational, punchy.
4. FORMATTING: Plain text only. No bold, no headers, no stage directions like [Music] or [Cut].

OUTPUT: Raw spoken-words script only.`,
    maxTokens: 3000,
  });
  return cleanText(text);
}

async function generateTitle(p: any): Promise<string> {
  const { articleContent, originalPrompt, language = 'vi' } = p;
  try {
    const snippet = (articleContent || '').substring(0, 5000);
    const text = await chat({
      user: `USER TOPIC (PRIMARY SOURCE): "${originalPrompt}"

ARTICLE SNIPPET (CONTEXT):
"${snippet}..."

TASK: Generate ONE professional, click-worthy title in ${langStr(language)} based strictly on the USER TOPIC.
RESTRICTION: NO emojis, NO quotes, NO markdown. Output the title ONLY.`,
      maxTokens: 120,
      temperature: 0.7,
    });
    return text ? text.replace(/["*#]/g, '').trim() : originalPrompt;
  } catch {
    return originalPrompt;
  }
}

async function remasterArticle(p: any): Promise<string> {
  const { originalContent, instruction, language = 'vi' } = p;
  const originalLength = (originalContent || '').length;
  const text = await chat({
    system: 'You are a senior editor and stylist.',
    user: `LANGUAGE: ${langStr(language)}.
ORIGINAL CONTENT LENGTH: ${originalLength} characters.
ORIGINAL CONTENT:
"""${originalContent}"""

USER STYLE INSTRUCTION: "${instruction}"

TASK: Rewrite the Original Content completely to match the User Style Instruction.

CRITICAL CONSTRAINTS:
1. LANGUAGE: Output MUST be entirely ${langStr(language)}. Translate if needed.
2. PRESERVE MEANING: Don't lose any key information / arguments.
3. STRICT LENGTH: Output MUST be close to original length (${originalLength} characters). Do NOT summarize / shorten. Slight expansion is OK.
4. CHANGE STYLE: Apply the requested tone / style transformation everywhere.
5. FORMATTING: Plain text only. No **bold**, no headers (#). Keep the original paragraph structure.

OUTPUT: The rewritten article text only.`,
    maxTokens: 8000,
  });
  return cleanText(text);
}

async function generateBatch(p: any): Promise<BulkGenerationResult[]> {
  const items: BulkItem[] = p.items || [];
  const targetLength: number = p.targetLength ?? 3000;
  const characterOption: string = p.characterOption ?? 'no-character';
  const imageStyle: string = p.imageStyle ?? 'realistic';

  if (!items.length) return [];

  const inputListJson = JSON.stringify(
    items.map((it) => ({ id: it.id, topic: it.title, context: it.outline }))
  );

  const mandatoryImageConstraint =
    characterOption === 'with-character'
      ? `- "subject_direction": MUST BE "Medium shot, Waist-up portrait" or "Group shot" if implied.\n- "composition": "Rule of thirds, Person engaging with Product".`
      : `- "subject_direction": Hero shot of the product object on podium/table.`;

  const styleContext =
    imageStyle === 'cartoon'
      ? '3D Cartoon, Pixar-style Animation, Soft Lighting, Vibrant Colors'
      : 'Photorealistic, High-End Commercial Photography, Cinematic Lighting';

  let userInstruction = '';
  if (targetLength <= 300)
    userInstruction = `Sub-Task: Write Viral Captions (Short, Punchy). Target length: ~${targetLength} characters.`;
  else if (targetLength <= 1000)
    userInstruction = `Sub-Task: Write Short Blog Posts. Target length: ~${targetLength} characters.`;
  else if (targetLength === 2000 || targetLength === 3000)
    userInstruction = `Sub-Task: Write engaging YouTube Shorts scripts.
1. EXACT LENGTH: ~${targetLength} characters.
2. STRUCTURE: Hook (0-3s), Body (energetic), CTA.
3. TONE: Energetic, conversational, punchy.
4. FORMATTING: Plain text. No bold, no headers, no stage directions.`;
  else userInstruction = `Sub-Task: Write professional articles. Target length: ~${targetLength} characters.`;

  const systemInstruction = `SYSTEM ROLE: Elite copywriter and commercial director.
LANGUAGE: VIETNAMESE (Tiếng Việt).
TASK: For EACH topic in the input array, return:
  1. A high-quality article.
  2. A technical visual brief (JSON object).

OUTPUT JSON SHAPE (must match exactly):
{ "results": [
  {
    "id": number,
    "final_title": "string",
    "article_content": "string",
    "image_brief": {
      "camera_gear": "string",
      "lighting_setup": "string",
      "set_design_and_environment": "string",
      "subject_direction": "string",
      "color_grading": "string"
    }
  }
] }

GLOBAL RULES:
- Treat each topic independently. High quality.
- VISUAL STYLE: ${styleContext}. NO TEXT in visuals.
- FORMATTING: Plain text only. No **bold**, no headers (#).
${mandatoryImageConstraint}`;

  const raw = await chat({
    jsonMode: true,
    system: systemInstruction,
    user: `${userInstruction}

INPUT DATA:
${inputListJson}`,
    maxTokens: 8192,
  });

  let results: any[] = [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) results = parsed;
    else if (Array.isArray(parsed.results)) results = parsed.results;
    else {
      for (const k of Object.keys(parsed)) {
        if (Array.isArray((parsed as any)[k])) {
          results = (parsed as any)[k];
          break;
        }
      }
    }
  } catch {
    results = [];
  }

  return items.map((item) => {
    const found = results.find((r) => r?.id === item.id);
    if (found) {
      return {
        id: item.id,
        title: found.final_title || item.title,
        content: cleanText(found.article_content || ''),
        imageBriefJson: JSON.stringify(found.image_brief || {}),
      };
    }
    return {
      id: item.id,
      title: item.title,
      content: '',
      error: 'AI failed to process this item in batch.',
    };
  });
}

// ---------- ENTRY POINT ----------

const ACTIONS: Record<string, (p: any) => Promise<any>> = {
  generateTOC,
  generateIntroduction,
  generateSection,
  generateConclusion,
  generateShorts,
  generateTitle,
  remasterArticle,
  generateBatch,
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS for local development
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  try {
    const { action, params } = (req.body ?? {}) as {
      action: string;
      params: any;
    };

    const handler = ACTIONS[action];
    if (!handler) {
      return res.status(400).json({ ok: false, error: `Unknown action: ${action}` });
    }

    const data = await handler(params || {});
    return res.status(200).json({ ok: true, data });
  } catch (err: any) {
    console.error('[/api/text] error:', err);
    return res.status(500).json({
      ok: false,
      error: err?.message || 'Internal server error',
    });
  }
}
