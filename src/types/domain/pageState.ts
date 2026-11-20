import type { SpatialGroup } from './spatialGroup.ts';
import type { PhysicalContainer } from './container.ts';
import type { TextRegion } from './textRegion.ts';
import type { ContentRecord } from './contentRecord.ts';

export interface ScanIssue {
  issueId: string;
  flag: string;
  severity: 'blocker' | 'warning' | 'suggestion';
  affectedEntityIds: string[];
  reason: string;
  retryable: boolean;
  evidence?: string;
}

export interface PageDomainState {
  pageId: string;
  chapterId?: string;
  dimensions: { width: number; height: number };
  spatialGroups: Record<string, SpatialGroup>;
  containers: Record<string, PhysicalContainer>;
  textRegions: Record<string, TextRegion>;
  contentRecords: Record<string, ContentRecord>;
  readingSequence: string[];
  issues: ScanIssue[];
  activeScanRunId?: string;
  version: number;
  updatedAt: number;
  extensions?: {
    legacyPayload?: Record<string, unknown>;
  };
}

export interface MigrationJournalEntry {
  key: string;
  version: 9;
  status: 'in_progress' | 'completed' | 'failed' | 'aborted';
  startedAt: number;
  completedAt?: number;
  totalPagesFound: number;
  migratedPagesCount: number;
  failedPageIds: string[];
  error?: string;
}
