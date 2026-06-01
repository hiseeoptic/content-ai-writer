/**
 * POST /api/image — image generation + vision analysis.
 * Body: { action: string, params: {...} }
 *
 * Actions:
 *   generateBlogImage       → string (data URL)
 *   analyzeReferenceImage   → string
 *   analyzeCharacterFeature → string
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { toFile } from 'openai';
import {
  getOpenAI,
  IMAGE_MODEL,
  vision,
  aspectToSize,
  delay,
} from './_lib/openai.js';

interface ReferenceImage {
  id: string;
  base64: string;
  keyword: string;
}

interface CharacterImage {
  id: string;
  base64: string;
}

const normalize = (str: string): string => {
  if (!str) return '';
  return str
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .trim();
};

async function analyzeReferenceImage(p: any): Promise<string> {
  try {
    const text = await vision({
      base64Image: p.base64,
      prompt:
        'Analyze this image as a Commercial Photographer. Describe the lighting key (Hard/Soft), color palette, and vibe (Luxury/Medical/Natural). Keep it brief.',
    });
    return text || 'Professional photography';
  } catch {
    return 'High-end commercial photography.';
  }
}

async function analyzeCharacterFeature(p: any): Promise<string> {
  try {
    const text = await vision({
      base64Image: p.base64,
      prompt:
        "Analyze this face. Return ONLY a concise physical description focusing on Age, Gender, Ethnicity, and distinctive features. Example: 'A 50-year-old Asian man with a beard' or 'A 6-year-old Vietnamese girl'. No conversational text.",
    });
    return (text || 'A person').trim();
  } catch {
    return 'A professional model';
  }
}

async function generateBlogImage(p: any): Promise<string | null> {
  const ai = getOpenAI();
  const {
    title,
    styleDescription = 'Professional, high quality blog illustration.',
    aspectRatio = '16:9',
    referenceImages = [] as ReferenceImage[],
    characterOption = 'no-character',
    characterImages = [] as CharacterImage[],
    descriptionKeywords = null,
    preGeneratedBriefJson = null,
    imageStyle = 'realistic',
  } = p;

  const size = aspectToSize(aspectRatio);

  // ---- 1) Pick the best matching reference (product) image ----
  let selectedRefImageBase64: string | null = null;
  if (referenceImages.length > 0) {
    const combinedContext = (title + ' ' + (descriptionKeywords || '')).toLowerCase();
    const normSearchText = normalize(combinedContext);

    const withKw = referenceImages.filter(
      (i: ReferenceImage) => i.keyword && i.keyword.trim().length > 0
    );
    const withoutKw = referenceImages.filter(
      (i: ReferenceImage) => !i.keyword || i.keyword.trim().length === 0
    );

    let matched = false;
    if (withKw.length > 0) {
      withKw.sort(
        (a: ReferenceImage, b: ReferenceImage) => b.keyword.length - a.keyword.length
      );
      for (const img of withKw) {
        if (normSearchText.includes(normalize(img.keyword))) {
          selectedRefImageBase64 = img.base64;
          matched = true;
          break;
        }
      }
    }
    if (!matched) {
      selectedRefImageBase64 = withoutKw[0]?.base64 || referenceImages[0]?.base64;
    }
  }

  const hasCharacters = characterImages.length > 0 && characterOption === 'with-character';
  const characterCount = hasCharacters ? characterImages.length : 0;

  // ---- 2) Resolve visual brief ----
  let visualBrief: any = {};
  try {
    if (preGeneratedBriefJson) visualBrief = JSON.parse(preGeneratedBriefJson);
  } catch {
    /* noop */
  }
  const setDesign = visualBrief.set_design_and_environment || 'Modern minimal background';
  const lighting = visualBrief.lighting_setup || 'Studio lighting';

  // ---- 3) Optionally analyze character faces in parallel ----
  let characterDescriptions: string[] = [];
  if (hasCharacters) {
    try {
      characterDescriptions = await Promise.all(
        characterImages.map((img: CharacterImage) =>
          vision({
            base64Image: img.base64,
            prompt:
              "Analyze this face. Return ONLY a concise physical description focusing on Age, Gender, Ethnicity, distinctive features. Example: 'A 50-year-old Asian man with a beard'. No conversational text.",
          }).then((s) => s.trim() || 'A specific person')
        )
      );
    } catch {
      characterDescriptions = characterImages.map(() => 'A specific person');
    }
  }

  // ---- 4) Build the master prompt ----
  let promptText = `STRICT INVARIANT RULES: NO TEXT. NO TYPOGRAPHY. NO WATERMARKS. NO SIGNAGE.\n\n`;

  if (hasCharacters) {
    const combinedDescription = characterDescriptions.join(' and ');
    if (characterCount > 1) {
      promptText += `SUBJECT: A GROUP PHOTO containing: ${combinedDescription}. They are presenting the product.\n`;
      promptText += `FRAMING: Medium / Waist-up group photo. All ${characterCount} faces must be visible.\n`;
      promptText += `ACTION: The group is interacting naturally, holding the product or gesturing toward it.\n`;
      promptText += `COMPOSITION: Balanced group composition. Clean background.\n`;
    } else {
      promptText += `SUBJECT: ${characterDescriptions[0]} presenting the product.\n`;
      promptText += `FRAMING: Medium shot or waist-up. DO NOT crop the head. Face fully visible.\n`;
      promptText += `ACTION: Holding the product elegantly or gesturing toward it on a table.\n`;
      promptText += `COMPOSITION: Rule of thirds. Clean background. Depth of field.\n`;
    }
    promptText += `\nCRITICAL FACE-PRESERVATION:\n`;
    characterDescriptions.forEach((desc, idx) => {
      promptText += `- Character #${idx + 1}: ${desc}. Preserve exact age, gender, ethnicity, facial structure. Do NOT beautify or "youngify".\n`;
    });
  } else {
    promptText += `SUBJECT: The product (bottle/box) as the hero object.\n`;
    promptText += `FRAMING: Close-up hero shot. Eye-level or slight low angle.\n`;
    promptText += `COMPOSITION: Centered on a podium or textured surface.\n`;
  }

  promptText += `CONCEPT: ${title}\n`;
  promptText += `Environment: ${setDesign}.\n`;

  if (imageStyle === 'cartoon') {
    promptText += `Lighting: Soft, even, bright animation lighting.\n`;
    promptText += `Style: 3D Cartoon Render, Pixar/Disney style, vibrant colors, smooth textures, expressive features. NO photorealism.\n`;
  } else {
    promptText += `Lighting: ${lighting}, high key, commercial polish.\n`;
    promptText += `Style: ${styleDescription}, photorealistic, 8K, highly detailed, magazine quality. NO cartoon, NO illustration.\n`;
  }

  let negPrompt =
    'text, writing, letters, watermark, logo, bad anatomy, blur, duplicate, ugly, back view, silhouette, cropped head, cut off face, distorted hands, missing limbs, fused bodies, changing age, changing gender';
  if (imageStyle === 'cartoon') negPrompt += ', photorealistic, real photo, grainy, noise, photograph';
  else negPrompt += ', cartoon, illustration, drawing, painting, 3d render, anime, sketch';
  promptText += `\nAvoid: ${negPrompt}\n`;

  // ---- 5) Call OpenAI image API ----
  const MAX_IMAGE_RETRIES = 2;
  for (let attempt = 1; attempt <= MAX_IMAGE_RETRIES; attempt++) {
    try {
      // If we have any reference image (product or character), use the EDIT API
      // which supports up to 16 reference images for gpt-image-1.
      const refFiles: any[] = [];

      if (selectedRefImageBase64) {
        refFiles.push(
          await toFile(Buffer.from(selectedRefImageBase64, 'base64'), 'product.png', {
            type: 'image/png',
          })
        );
      }
      if (hasCharacters) {
        for (let i = 0; i < characterImages.length; i++) {
          refFiles.push(
            await toFile(
              Buffer.from(characterImages[i].base64, 'base64'),
              `character_${i + 1}.png`,
              { type: 'image/png' }
            )
          );
        }
      }

      let response: any;
      if (refFiles.length > 0) {
        // Edit mode — preserves likeness from reference images
        response = await ai.images.edit({
          model: IMAGE_MODEL,
          image: refFiles.length === 1 ? refFiles[0] : refFiles,
          prompt: promptText,
          size,
        });
      } else {
        // Pure text-to-image
        response = await ai.images.generate({
          model: IMAGE_MODEL,
          prompt: promptText,
          size,
          n: 1,
        });
      }

      const b64 = response?.data?.[0]?.b64_json;
      const url = response?.data?.[0]?.url;
      if (b64) return `data:image/png;base64,${b64}`;
      if (url) return url;
    } catch (err: any) {
      console.error(`[image gen attempt ${attempt}] error:`, err?.message || err);
      if (attempt === MAX_IMAGE_RETRIES) return null;
      await delay(1500);
    }
  }
  return null;
}

const ACTIONS: Record<string, (p: any) => Promise<any>> = {
  generateBlogImage,
  analyzeReferenceImage,
  analyzeCharacterFeature,
};

export const config = {
  api: {
    bodyParser: { sizeLimit: '20mb' },
  },
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' });

  try {
    const { action, params } = (req.body ?? {}) as { action: string; params: any };
    const fn = ACTIONS[action];
    if (!fn) return res.status(400).json({ ok: false, error: `Unknown action: ${action}` });
    const data = await fn(params || {});
    return res.status(200).json({ ok: true, data });
  } catch (err: any) {
    console.error('[/api/image] error:', err);
    return res.status(500).json({ ok: false, error: err?.message || 'Internal server error' });
  }
}
