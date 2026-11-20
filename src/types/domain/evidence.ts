import type { Point2D, PixelBox } from './primitives.ts';

export type ScanLifecycleStatus = 'running' | 'completed' | 'partial' | 'failed' | 'cancelled';
export type ExecutionProvider = 'wasm' | 'webgpu' | 'remote_http' | 'none';

export interface StageExecutionMetadata {
  stage: 'detector' | 'ocr';
  status: 'executed' | 'skipped' | 'failed';
  provider: ExecutionProvider;
  modelId?: string | null;
  revision?: string | null;
  simdEnabled?: boolean;
  threadsUsed?: number;
  durationMs?: number;
  error?: string | null;
}

export interface ModelExecutionMetadata {
  detector: StageExecutionMetadata;
  ocr: StageExecutionMetadata;
}

export interface TileTransformRecord {
  tileId: string;
  row: number;
  col: number;
  originX: number;
  originY: number;
  cropWidth: number;
  cropHeight: number;
  inputWidth: number;
  inputHeight: number;
  scaleX: number;
  scaleY: number;
  padRight: number;
  padBottom: number;
  touchesPageLeft: boolean;
  touchesPageTop: boolean;
  touchesPageRight: boolean;
  touchesPageBottom: boolean;
}

export interface DetectorObservation {
  detectionId: string;
  scanRunId: string;
  pageId: string;
  classLabel: 'bubble' | 'text_bubble' | 'text_free';
  pixelBox: PixelBox;
  pixelPolygon?: Point2D[];
  rawScore: number;
  sourceTileIds: string[];
  touchesTileInnerBoundary: boolean;
  timestamp: number;
}

export interface OcrLineObservation {
  lineId: string;
  scanRunId: string;
  pageId: string;
  text: string;
  lineScore: number;
  pixelBox: PixelBox;
  pixelPolygon: Point2D[];
  isVertical: boolean;
  isRuby?: boolean;
  sourceTileIds: string[];
  timestamp: number;
}

export interface ScanRunRecord {
  scanRunId: string;
  pageId: string;
  chapterId?: string;
  status: ScanLifecycleStatus;
  startedAt: number;
  completedAt?: number;
  models: ModelExecutionMetadata;
  tiles: TileTransformRecord[];
  detectorObservations: Record<string, DetectorObservation>;
  ocrObservations: Record<string, OcrLineObservation>;
  errorMessage?: string;
}
