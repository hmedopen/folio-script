/**
 * Folio Script — Centralized Coordinate Pipeline & Complete Affine Model
 * Provides mathematically exact, reversible transformations between original page pixels,
 * tile input coordinates (including all padding directions and letterboxing), crop spaces,
 * and derived normalized coordinates.
 */

import type { TileTransformRecord } from '../../types/localOcr.ts';

export type BoundingBoxTuple = [number, number, number, number]; // [ymin, xmin, ymax, xmax]
export type Point2D = [number, number]; // [x, y]

export interface AffineTransformParams {
  originX: number;
  originY: number;
  scaleX: number;
  scaleY: number;
  padLeft?: number;
  padTop?: number;
  padRight?: number;
  padBottom?: number;
  inputWidth: number;
  inputHeight: number;
}

export interface ClippedDetectionResult {
  pixelBox: BoundingBoxTuple;
  touchesInnerLeft: boolean;
  touchesInnerTop: boolean;
  touchesInnerRight: boolean;
  touchesInnerBottom: boolean;
  isCompletelyOutOfBounds: boolean;
}

/**
 * Normalizes affine parameters with default zero padding.
 */
function resolveAffineParams(params: AffineTransformParams | TileTransformRecord) {
  const padLeft = (params as any).padLeft ?? 0;
  const padTop = (params as any).padTop ?? 0;
  const padRight = params.padRight ?? 0;
  const padBottom = params.padBottom ?? 0;
  const scaleX = params.scaleX > 0 ? params.scaleX : 1.0;
  const scaleY = params.scaleY > 0 ? params.scaleY : 1.0;

  return {
    originX: params.originX,
    originY: params.originY,
    scaleX,
    scaleY,
    padLeft,
    padTop,
    padRight,
    padBottom,
    inputWidth: params.inputWidth,
    inputHeight: params.inputHeight,
    activeMinX: padLeft,
    activeMinY: padTop,
    activeMaxX: params.inputWidth - padRight,
    activeMaxY: params.inputHeight - padBottom,
  };
}

/**
 * Transforms a model-space bounding box [ymin, xmin, ymax, xmax] back to authoritative
 * floating-point original page pixels, properly handling padding, letterboxing,
 * boundary clipping, and inner-edge touch detection.
 */
export function modelBoxToOriginalPixels(
  modelBox: BoundingBoxTuple,
  transform: AffineTransformParams | TileTransformRecord,
  sourceWidth: number,
  sourceHeight: number,
  boundaryMarginPx = 4
): ClippedDetectionResult {
  const p = resolveAffineParams(transform);
  const [mYmin, mXmin, mYmax, mXmax] = modelBox;

  // Check if box is completely outside the active (non-padded) region
  if (
    mXmax <= p.activeMinX ||
    mXmin >= p.activeMaxX ||
    mYmax <= p.activeMinY ||
    mYmin >= p.activeMaxY
  ) {
    return {
      pixelBox: [0, 0, 0, 0],
      touchesInnerLeft: false,
      touchesInnerTop: false,
      touchesInnerRight: false,
      touchesInnerBottom: false,
      isCompletelyOutOfBounds: true,
    };
  }

  // Clip to active non-padded region
  const clampedXmin = Math.max(p.activeMinX, Math.min(p.activeMaxX, mXmin));
  const clampedYmin = Math.max(p.activeMinY, Math.min(p.activeMaxY, mYmin));
  const clampedXmax = Math.max(p.activeMinX, Math.min(p.activeMaxX, mXmax));
  const clampedYmax = Math.max(p.activeMinY, Math.min(p.activeMaxY, mYmax));

  // Determine edge touches before clipping
  const touchesInnerLeft = mXmin <= p.activeMinX + boundaryMarginPx;
  const touchesInnerTop = mYmin <= p.activeMinY + boundaryMarginPx;
  const touchesInnerRight = mXmax >= p.activeMaxX - boundaryMarginPx;
  const touchesInnerBottom = mYmax >= p.activeMaxY - boundaryMarginPx;

  // Inverse affine transform: subtract padding, divide by scale, add page origin
  const localXmin = (clampedXmin - p.padLeft) / p.scaleX;
  const localYmin = (clampedYmin - p.padTop) / p.scaleY;
  const localXmax = (clampedXmax - p.padLeft) / p.scaleX;
  const localYmax = (clampedYmax - p.padTop) / p.scaleY;

  const pageXmin = Math.max(0, Math.min(sourceWidth, p.originX + localXmin));
  const pageYmin = Math.max(0, Math.min(sourceHeight, p.originY + localYmin));
  const pageXmax = Math.max(0, Math.min(sourceWidth, p.originX + localXmax));
  const pageYmax = Math.max(0, Math.min(sourceHeight, p.originY + localYmax));

  return {
    pixelBox: [
      Math.min(pageYmin, pageYmax),
      Math.min(pageXmin, pageXmax),
      Math.max(pageYmin, pageYmax),
      Math.max(pageXmin, pageXmax),
    ],
    touchesInnerLeft,
    touchesInnerTop,
    touchesInnerRight,
    touchesInnerBottom,
    isCompletelyOutOfBounds: false,
  };
}

/**
 * Forward affine transform: maps authoritative floating-point original page pixels
 * to model input space [ymin, xmin, ymax, xmax].
 */
export function originalPixelsToModelBox(
  pixelBox: BoundingBoxTuple,
  transform: AffineTransformParams | TileTransformRecord
): BoundingBoxTuple {
  const p = resolveAffineParams(transform);
  const [pageYmin, pageXmin, pageYmax, pageXmax] = pixelBox;

  const localXmin = pageXmin - p.originX;
  const localYmin = pageYmin - p.originY;
  const localXmax = pageXmax - p.originX;
  const localYmax = pageYmax - p.originY;

  const mXmin = localXmin * p.scaleX + p.padLeft;
  const mYmin = localYmin * p.scaleY + p.padTop;
  const mXmax = localXmax * p.scaleX + p.padLeft;
  const mYmax = localYmax * p.scaleY + p.padTop;

  return [
    Math.max(0, Math.min(p.inputHeight, Math.min(mYmin, mYmax))),
    Math.max(0, Math.min(p.inputWidth, Math.min(mXmin, mXmax))),
    Math.max(0, Math.min(p.inputHeight, Math.max(mYmin, mYmax))),
    Math.max(0, Math.min(p.inputWidth, Math.max(mXmin, mXmax))),
  ];
}

/**
 * Transforms a crop-local polygon [[x, y], ...] to floating-point original page pixels.
 */
export function cropPolygonToOriginalPixels(
  polygon: Point2D[],
  cropOriginX: number,
  cropOriginY: number,
  sourceWidth: number,
  sourceHeight: number
): Point2D[] {
  return polygon.map(([cx, cy]) => [
    Math.max(0, Math.min(sourceWidth, cropOriginX + cx)),
    Math.max(0, Math.min(sourceHeight, cropOriginY + cy)),
  ]);
}

/**
 * Transforms authoritative original page polygon vertices [[x, y], ...] to crop-local pixels.
 */
export function originalPolygonToCropPixels(
  polygon: Point2D[],
  cropOriginX: number,
  cropOriginY: number
): Point2D[] {
  return polygon.map(([px, py]) => [px - cropOriginX, py - cropOriginY]);
}

/**
 * Derives normalized 0-1000 coordinates from original pixels with floating-point precision,
 * strictly avoiding integer truncation.
 */
export function originalPixelsToDerivedNormalized(
  pixelBox: BoundingBoxTuple,
  sourceWidth: number,
  sourceHeight: number
): BoundingBoxTuple {
  if (sourceWidth <= 0 || sourceHeight <= 0) {
    return [...pixelBox];
  }
  const [ymin, xmin, ymax, xmax] = pixelBox;
  const normYmin = (ymin / sourceHeight) * 1000.0;
  const normXmin = (xmin / sourceWidth) * 1000.0;
  const normYmax = (ymax / sourceHeight) * 1000.0;
  const normXmax = (xmax / sourceWidth) * 1000.0;

  return [
    Math.max(0, Math.min(1000, normYmin)),
    Math.max(0, Math.min(1000, normXmin)),
    Math.max(0, Math.min(1000, normYmax)),
    Math.max(0, Math.min(1000, normXmax)),
  ];
}

/**
 * Converts derived normalized coordinates back to floating-point original pixels.
 */
export function derivedNormalizedToOriginalPixels(
  normBox: BoundingBoxTuple,
  sourceWidth: number,
  sourceHeight: number
): BoundingBoxTuple {
  const [normYmin, normXmin, normYmax, normXmax] = normBox;
  return [
    Math.max(0, Math.min(sourceHeight, (normYmin / 1000.0) * sourceHeight)),
    Math.max(0, Math.min(sourceWidth, (normXmin / 1000.0) * sourceWidth)),
    Math.max(0, Math.min(sourceHeight, (normYmax / 1000.0) * sourceHeight)),
    Math.max(0, Math.min(sourceWidth, (normXmax / 1000.0) * sourceWidth)),
  ];
}

/**
 * Normalizes polygon vertices to derived floating-point 0-1000 coordinates.
 */
export function originalPolygonToDerivedNormalized(
  polygon: Point2D[],
  sourceWidth: number,
  sourceHeight: number
): Point2D[] {
  if (sourceWidth <= 0 || sourceHeight <= 0) return [...polygon];
  return polygon.map(([px, py]) => [
    Math.max(0, Math.min(1000, (px / sourceWidth) * 1000.0)),
    Math.max(0, Math.min(1000, (py / sourceHeight) * 1000.0)),
  ]);
}

/**
 * Converts derived normalized polygon vertices back to original page pixels.
 */
export function derivedNormalizedToOriginalPolygon(
  polygon: Point2D[],
  sourceWidth: number,
  sourceHeight: number
): Point2D[] {
  return polygon.map(([nx, ny]) => [
    Math.max(0, Math.min(sourceWidth, (nx / 1000.0) * sourceWidth)),
    Math.max(0, Math.min(sourceHeight, (ny / 1000.0) * sourceHeight)),
  ]);
}

/**
 * Validates numerical reversibility of a bounding box under forward and inverse transforms.
 * Target tolerance: <= 1e-4 pixels.
 */
export function validateBoxRoundTrip(
  originalBox: BoundingBoxTuple,
  transform: AffineTransformParams | TileTransformRecord,
  sourceWidth: number,
  sourceHeight: number,
  tolerance = 1e-4
): boolean {
  const model = originalPixelsToModelBox(originalBox, transform);
  const restored = modelBoxToOriginalPixels(model, transform, sourceWidth, sourceHeight);

  for (let i = 0; i < 4; i++) {
    if (Math.abs(restored.pixelBox[i] - originalBox[i]) > tolerance) {
      return false;
    }
  }
  return true;
}
