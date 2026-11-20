import type { ProvenanceMeta } from './primitives.ts';

export type ContentSemanticType =
  | 'dialogue'
  | 'thought'
  | 'narration'
  | 'caption'
  | 'sfx'
  | 'system_message'
  | 'translator_note';

export type ContentLifecycleStatus = 'active' | 'unattached_content' | 'archived';

export interface RegionTarget {
  regionId: string;
  lineObservationIds?: string[];
  textSpan?: [number, number];
}

export interface TranslationVersion {
  versionId: string;
  timestamp: number;
  text: string;
  type: 'raw' | 'humanized' | 'manual';
  modelId?: string;
}

export interface TyperTag {
  id: string;
  prefix: string;
}

export interface ContentRecord {
  contentId: string;
  pageId: string;
  regionTargets: RegionTarget[];
  contentType: ContentSemanticType;
  speakerIds: string[];
  sourceText: string;
  originalOcrText: string;
  translatedText: string;
  translationHistory: TranslationVersion[];
  typerTag: TyperTag;
  status: ContentLifecycleStatus;
  orderState: {
    isUserPinned: boolean;
    pinnedAt?: number;
  };
  reviewFlags: Array<{
    flagId: string;
    category: string;
    severity: 'blocker' | 'warning' | 'suggestion';
    reasonAr: string;
    status: 'pending' | 'accepted' | 'dismissed';
  }>;
  provenance: {
    sourceText: ProvenanceMeta;
    translatedText: ProvenanceMeta;
    typerTag: ProvenanceMeta;
    speakerIds: ProvenanceMeta;
    contentType: ProvenanceMeta;
    regionTargets: ProvenanceMeta;
  };
}
