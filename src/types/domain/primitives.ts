export type ProvenanceSource =
  | 'local_detector'
  | 'ocr_engine'
  | 'visual_interpretation'
  | 'user_manual'
  | 'legacy_migration';

export interface ProvenanceMeta {
  source: ProvenanceSource;
  updatedAt: number;
}

/** 2D Point in native image pixel coordinates [x, y] */
export type Point2D = [number, number];

/** Axis-aligned bounding box in native image pixel coordinates [ymin, xmin, ymax, xmax] */
export type PixelBox = [number, number, number, number];
