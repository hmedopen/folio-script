/**
 * Folio Script — Benchmark Dataset Types & Contracts
 */

export type ComicCategory = 'manga' | 'manhwa' | 'manhua' | 'western';

export type BenchmarkSplit = 'tuning' | 'test';

export type BubbleDifficultyTag =
  | 'standard'
  | 'transparent'
  | 'borderless'
  | 'gradient'
  | 'irregular_shape'
  | 'thought_bubble'
  | 'dense_dialogue'
  | 'overlapping'
  | 'small'
  | 'large'
  | 'vertical_scroll';

export type DetectionClassLabel = 'balloon' | 'dialogue_text' | 'onomatopoeia_text' | 'frame';

export interface BenchmarkAnnotation {
  id: string;
  classLabel: DetectionClassLabel;
  /** Bounding box [x1, y1, x2, y2] in image pixel coordinates */
  box_2d: [number, number, number, number];
  /** Optional true polygon boundary contour [[x, y], ...] in image pixel coordinates */
  polygon?: Array<[number, number]>;
  difficultyTags: BubbleDifficultyTag[];
  readingOrderIndex?: number;
}

export interface BenchmarkImageMetadata {
  id: string;
  title: string;
  category: ComicCategory;
  imagePath: string;
  width: number;
  height: number;
  isLongPage: boolean;
  split: BenchmarkSplit;
  annotations: BenchmarkAnnotation[];
}

export interface BenchmarkManifest {
  version: string;
  createdAt: string;
  description: string;
  datasetSplitRatio: {
    tuning: number;
    test: number;
  };
  categories: Record<ComicCategory, number>;
  images: BenchmarkImageMetadata[];
}
