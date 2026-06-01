
export interface TocItem {
  sectionTitle: string;
  subSections?: string[];
}

export interface BulkItem {
  id: number;
  title: string;
  outline: string;
}

export type AspectRatio = '1:1' | '16:9' | '4:3' | '3:4' | '9:16';

export type CharacterOption = 'with-character' | 'no-character';

export type ImageStyle = 'realistic' | 'cartoon';

export interface ReferenceImage {
  id: string;
  base64: string;
  keyword: string; // The keyword to match against article content
}

export interface CharacterImage {
  id: string;
  base64: string;
}

export interface BulkArticle {
  id: number;
  title: string;
  content: string;
  error?: string;
  imageUrl?: string | null;
  outline?: string; // Stored outline for regeneration context
}

export interface HistoryRecord {
    id: string; // UUID or timestamp
    timestamp: number;
    mode: 'single' | 'bulk';
    title: string; // Summary title
    // Data for single mode
    singleContent?: string;
    // Data for bulk mode
    bulkContent?: BulkArticle[];
    
    // Saved Image Context
    referenceImages?: ReferenceImage[];
    characterImages?: CharacterImage[];
    aspectRatio?: AspectRatio;
    characterOption?: CharacterOption;
    imageStyle?: ImageStyle;
}
