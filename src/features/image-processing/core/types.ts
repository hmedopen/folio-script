/**
 * Folio Script — Image Merge & Cut System
 * Core Contracts & Type Definitions
 */

export interface ProcessingSourceImage {
  /** Stable unique source identifier (e.g., 'src-0', 'src-1') */
  id: string;
  /** 1-based original sequential position */
  originalIndex: number;
  name: string;
  mimeType: string;
  extension: string;
  width: number;
  height: number;
  sizeBytes: number;
  /** Object URL for responsive rendering in UI thumbnails */
  thumbnailUrl: string;
  /** Binary blob of original source image (non-destructive) */
  blob: Blob;
  /** Local disk path if disk-backed */
  tempFilePath?: string;
}

export interface SourceRegionCrop {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface OutputSourceContribution {
  sourceImageId: string;
  /** 1-based sequential position within the output */
  sourceIndex: number;
  /** Sub-region coordinates if this output uses a fragment (e.g. from Cut) */
  sourceRegion?: SourceRegionCrop;
}

export type ProcessingOperation = 'merge' | 'cut';

export type OutputStatus = 'pending' | 'processing' | 'ready' | 'failed';

export interface ProcessingOutput {
  /** Stable unique output identifier (e.g. 'out-1', 'out-2') */
  id: string;
  /** 1-based sequential output index */
  outputIndex: number;
  name: string;
  operation: ProcessingOperation;
  /** Detailed mapping of all contributing sources in order */
  contributingSources: OutputSourceContribution[];
  width: number;
  height: number;
  sizeBytes: number;
  blob?: Blob;
  previewUrl?: string;
  status: OutputStatus;
  error?: string;
}

export interface BoundaryIntegrityStatus {
  /** Source images not assigned to any output */
  unassignedSourceIds: string[];
  /** Source images assigned to more than one output */
  duplicateSourceIds: string[];
  /** Gaps in sequence (e.g. Output 1 has 1-5, Output 2 has 8-12) */
  gaps: {
    priorOutputIndex: number;
    nextOutputIndex: number;
    missingSourceIds: string[];
  }[];
  /** Output IDs that have 0 contributing source images */
  emptyOutputIds: string[];
  isValid: boolean;
}

export interface ProcessingProgress {
  current: number;
  total: number;
  message: string;
}

export interface ProcessingSession {
  id: string;
  context: 'fetch' | 'upload';
  title: string;
  sourceImages: ProcessingSourceImage[];
  outputs: ProcessingOutput[];
  history: OutputSourceContribution[][][];
  status: 'idle' | 'processing' | 'ready' | 'failed';
  progress: ProcessingProgress;
  errorMessage?: string;
}

export interface MergeOptions {
  /** Target maximum height for each merged strip in pixels (default: 8000) */
  targetMaxHeight?: number;
  /** Approximate target number of images per strip if height is unspecified (default: 10) */
  targetChunkCount?: number;
}

export interface CutOptions {
  /** Maximum page height threshold triggering a cut (default: 3000) */
  maxSliceHeight?: number;
}
