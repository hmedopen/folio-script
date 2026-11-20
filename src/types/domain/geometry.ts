import type { Point2D } from './primitives.ts';

export interface TextRegionGeometry {
  /** Authoritative tight polygon contour enclosing text lines in native pixels [[x, y], ...] */
  pixelPolygon: Point2D[];
}

export interface BalloonTail {
  tailId: string;
  style: 'pointed_vector' | 'thought_dots' | 'burst_flare';
  attachmentBase: [Point2D, Point2D];
  tipPoint: Point2D;
  targetSpeakerId?: string | null;
}

export interface ContainerGeometry {
  /** Outer boundary contour of the main balloon body in native pixels (supports concave shapes) */
  bodyContour: Point2D[];
  /** Zero, one, or more attached balloon tails */
  tails: BalloonTail[];
}
