/**
 * Frontend AI service.
 * NEVER imports the OpenAI SDK directly — every call goes through serverless
 * functions in /api so the API key stays on the server.
 *
 * Exposes the same function names that the original Gemini service exposed,
 * so the rest of the app does not have to change.
 */
import {
  TocItem,
  AspectRatio,
  CharacterOption,
  BulkItem,
  ReferenceImage,
  CharacterImage,
  ImageStyle,
} from '../types';

const API_BASE =
  (typeof window !== 'undefined' && (window as any).__API_BASE__) ||
  '';

interface ApiResponse<T> {
  ok: boolean;
  data?: T;
  error?: string;
}

async function callApi<T>(
  endpoint: '/api/text' | '/api/image',
  action: string,
  params: Record<string, unknown>
): Promise<T> {
  const res = await fetch(`${API_BASE}${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, params }),
  });
  let json: ApiResponse<T>;
  try {
    json = await res.json();
  } catch {
    throw new Error(`API ${endpoint} returned non-JSON (${res.status}).`);
  }
  if (!res.ok || !json.ok) {
    throw new Error(json.error || `API ${endpoint} failed (${res.status}).`);
  }
  return json.data as T;
}

// =============== TEXT GENERATION ===============

export async function generateTableOfContents(
  title: string,
  outline: string,
  targetLength: number,
  language: 'vi' | 'en' = 'vi'
): Promise<TocItem[]> {
  return callApi<TocItem[]>('/api/text', 'generateTOC', {
    title,
    outline,
    targetLength,
    language,
  });
}

export async function generateIntroduction(
  title: string,
  outline: string,
  targetLength: number,
  language: 'vi' | 'en' = 'vi'
): Promise<string> {
  return callApi<string>('/api/text', 'generateIntroduction', {
    title,
    outline,
    targetLength,
    language,
  });
}

export async function generateSectionContent(
  mainTitle: string,
  section: TocItem,
  totalSections: number,
  targetArticleLength: number,
  language: 'vi' | 'en' = 'vi'
): Promise<string> {
  return callApi<string>('/api/text', 'generateSection', {
    mainTitle,
    section,
    totalSections,
    targetArticleLength,
    language,
  });
}

export async function generateConclusion(
  title: string,
  _articleBody: string,
  targetLength: number,
  language: 'vi' | 'en' = 'vi'
): Promise<string> {
  return callApi<string>('/api/text', 'generateConclusion', {
    title,
    targetLength,
    language,
  });
}

export async function generateShortsScript(
  outline: string,
  targetLength: number,
  language: 'vi' | 'en' = 'vi'
): Promise<string> {
  return callApi<string>('/api/text', 'generateShorts', {
    outline,
    targetLength,
    language,
  });
}

export async function generateTitle(
  articleContent: string,
  originalPrompt: string,
  language: 'vi' | 'en' = 'vi'
): Promise<string> {
  try {
    return await callApi<string>('/api/text', 'generateTitle', {
      articleContent,
      originalPrompt,
      language,
    });
  } catch {
    return originalPrompt;
  }
}

export async function remasterArticle(
  originalContent: string,
  instruction: string,
  language: 'vi' | 'en' = 'vi'
): Promise<string> {
  return callApi<string>('/api/text', 'remasterArticle', {
    originalContent,
    instruction,
    language,
  });
}

export interface BulkGenerationResult {
  id: number;
  title: string;
  content: string;
  imageBriefJson?: string;
  error?: string;
}

export async function generateBatchArticles(
  items: BulkItem[],
  targetLength: number = 3000,
  characterOption: CharacterOption = 'no-character',
  imageStyle: ImageStyle = 'realistic'
): Promise<BulkGenerationResult[]> {
  try {
    return await callApi<BulkGenerationResult[]>('/api/text', 'generateBatch', {
      items,
      targetLength,
      characterOption,
      imageStyle,
    });
  } catch (err: any) {
    console.error('Batch failed:', err);
    return items.map((item) => ({
      id: item.id,
      title: item.title,
      content: '',
      error: err?.message || 'Batch processing failed.',
    }));
  }
}

// =============== IMAGE GENERATION & VISION ===============

export async function generateBlogImage(
  title: string,
  styleDescription: string,
  aspectRatio: AspectRatio,
  referenceImages: ReferenceImage[] = [],
  characterOption: CharacterOption = 'no-character',
  characterImages: CharacterImage[] = [],
  descriptionKeywords: string | null = null,
  preGeneratedBriefJson: string | null = null,
  imageStyle: ImageStyle = 'realistic'
): Promise<string | null> {
  try {
    return await callApi<string | null>('/api/image', 'generateBlogImage', {
      title,
      styleDescription,
      aspectRatio,
      referenceImages,
      characterOption,
      characterImages,
      descriptionKeywords,
      preGeneratedBriefJson,
      imageStyle,
    });
  } catch (err) {
    console.error('Image generation failed:', err);
    return null;
  }
}

export async function analyzeReferenceImage(referenceImageBase64: string): Promise<string> {
  try {
    return await callApi<string>('/api/image', 'analyzeReferenceImage', {
      base64: referenceImageBase64,
    });
  } catch {
    return 'High-end commercial photography.';
  }
}
