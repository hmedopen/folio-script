import type { TileTransformRecord } from '../../types/localOcr.ts';
import {
  findGuttersInZone,
  type GutterCandidate,
  type RgbaImageBufferLike,
} from './gutterDetector.ts';

export const DETECTOR_TARGET_SIZE = 640;
export const DEFAULT_TILE_OVERLAP_RATIO = 0.2;
export const LONG_PAGE_OVERLAP_RATIO = 0.35; // 35% overlap = 224px on 640px tiles for long manhwa/webtoon pages

export interface TilePlanOptions {
  tileSize?: number;
  overlapRatio?: number;
  imageBuffer?: RgbaImageBufferLike;
  enableGutterSnapping?: boolean;
}

export interface AxisSlice {
  origin: number;
  cropSpan: number;
  isSnappedToGutter?: boolean;
}

/**
 * Computes deterministic, monotonic 1D tile slices covering [0, dimension) with zero gaps.
 * Enforces strictly guaranteed minimum overlap between adjacent tiles and eliminates duplicate final tiles.
 */
export function computeAdaptiveAxisSlices(
  dimension: number,
  tileSize = DETECTOR_TARGET_SIZE,
  minOverlapRatio = DEFAULT_TILE_OVERLAP_RATIO,
  gutters: GutterCandidate[] = []
): AxisSlice[] {
  if (!Number.isFinite(dimension) || dimension <= 0) {
    throw new Error(`Invalid page dimension: ${dimension}`);
  }
  if (!Number.isFinite(tileSize) || tileSize <= 0) {
    throw new Error(`Invalid tileSize: ${tileSize}`);
  }

  // Safe overlap ratio clamped to [0.20, 0.45]
  const safeOverlap = Math.max(0.2, Math.min(0.45, minOverlapRatio));
  const maxStride = Math.max(1, Math.floor(tileSize * (1 - safeOverlap))); // e.g. 416px

  if (dimension <= tileSize) {
    return [{ origin: 0, cropSpan: dimension, isSnappedToGutter: false }];
  }

  const slices: AxisSlice[] = [];
  let currentOrigin = 0;

  while (currentOrigin + tileSize < dimension) {
    slices.push({
      origin: currentOrigin,
      cropSpan: tileSize,
      isSnappedToGutter: false,
    });

    const idealNextOrigin = currentOrigin + maxStride;
    if (idealNextOrigin + tileSize >= dimension) {
      // Final tile reached
      break;
    }

    // Gutter candidate search window:
    // To maintain at least safeOverlap with current tile: nextOrigin <= currentOrigin + maxStride
    const candidateMax = currentOrigin + maxStride;
    const candidateMin = currentOrigin + Math.floor(maxStride * 0.7);

    let chosenOrigin = idealNextOrigin;
    let snapped = false;

    if (gutters.length > 0) {
      // Find gutters whose center falls within [candidateMin, candidateMax]
      const validGutters = gutters.filter(
        (g) => g.center >= candidateMin && g.center <= candidateMax
      );

      if (validGutters.length > 0) {
        // Pick gutter with highest quality score
        validGutters.sort((a, b) => b.score - a.score);
        const best = validGutters[0];
        chosenOrigin = best.center;
        snapped = true;
      }
    }

    // Strictly enforce monotonic progress and minimum overlap
    if (chosenOrigin > currentOrigin && chosenOrigin <= candidateMax) {
      currentOrigin = chosenOrigin;
      if (snapped) {
        slices[slices.length - 1].isSnappedToGutter = true;
      }
    } else {
      currentOrigin = idealNextOrigin;
    }
  }

  // Final tile anchored to dimension - tileSize (only if not already at edge)
  const finalOrigin = dimension - tileSize;
  const lastSlice = slices[slices.length - 1];
  if (!lastSlice || lastSlice.origin < finalOrigin) {
    slices.push({
      origin: finalOrigin,
      cropSpan: tileSize,
      isSnappedToGutter: false,
    });
  }

  return slices;
}

/**
 * Plans adaptive overlapping 640x640 tiles across a page of arbitrary dimensions,
 * supporting 10k-14k+ px webtoons, conditional gutter snapping, and complete coverage.
 */
export function planAdaptivePageTiles(
  sourceWidth: number,
  sourceHeight: number,
  options: TilePlanOptions = {}
): TileTransformRecord[] {
  const tileSize = options.tileSize ?? DETECTOR_TARGET_SIZE;
  const overlapRatio =
    options.overlapRatio ??
    (sourceHeight >= 2000 || sourceWidth >= 2000
      ? LONG_PAGE_OVERLAP_RATIO
      : DEFAULT_TILE_OVERLAP_RATIO);

  // Horizontal slices across width
  const xSlices = computeAdaptiveAxisSlices(sourceWidth, tileSize, overlapRatio);

  // Vertical slices across height (with optional gutter detection)
  let yGutters: GutterCandidate[] = [];
  if (options.enableGutterSnapping && options.imageBuffer) {
    yGutters = findGuttersInZone(
      options.imageBuffer,
      0,
      sourceHeight,
      Math.floor(tileSize * (1 - overlapRatio)),
      { minGutterHeight: 16, maxVarianceThreshold: 4.5 }
    );
  }

  const ySlices = computeAdaptiveAxisSlices(sourceHeight, tileSize, overlapRatio, yGutters);

  const tiles: TileTransformRecord[] = [];

  for (let row = 0; row < ySlices.length; row++) {
    const ySlice = ySlices[row];
    for (let col = 0; col < xSlices.length; col++) {
      const xSlice = xSlices[col];

      const cropWidth = xSlice.cropSpan;
      const cropHeight = ySlice.cropSpan;
      const padRight = Math.max(0, tileSize - cropWidth);
      const padBottom = Math.max(0, tileSize - cropHeight);

      tiles.push({
        tileId: `tile_r${row}_c${col}`,
        row,
        col,
        originX: xSlice.origin,
        originY: ySlice.origin,
        cropWidth,
        cropHeight,
        inputWidth: tileSize,
        inputHeight: tileSize,
        scaleX: 1,
        scaleY: 1,
        padRight,
        padBottom,
        touchesPageLeft: xSlice.origin === 0,
        touchesPageTop: ySlice.origin === 0,
        touchesPageRight: xSlice.origin + cropWidth >= sourceWidth,
        touchesPageBottom: ySlice.origin + cropHeight >= sourceHeight,
      });
    }
  }

  return tiles;
}

/**
 * Verifies that a planned tile list covers every integer pixel [0..W-1] x [0..H-1].
 */
export function verifyTileCoverage(
  tiles: TileTransformRecord[],
  sourceWidth: number,
  sourceHeight: number
): boolean {
  if (tiles.length === 0 || sourceWidth <= 0 || sourceHeight <= 0) return false;

  const xPoints = new Set<number>([0, sourceWidth - 1]);
  const yPoints = new Set<number>([0, sourceHeight - 1]);
  for (const t of tiles) {
    xPoints.add(t.originX);
    xPoints.add(Math.min(sourceWidth - 1, t.originX + t.cropWidth - 1));
    if (t.originX + t.cropWidth < sourceWidth) xPoints.add(t.originX + t.cropWidth);
    yPoints.add(t.originY);
    yPoints.add(Math.min(sourceHeight - 1, t.originY + t.cropHeight - 1));
    if (t.originY + t.cropHeight < sourceHeight) yPoints.add(t.originY + t.cropHeight);
  }

  for (const y of yPoints) {
    for (const x of xPoints) {
      const covered = tiles.some(
        (t) =>
          x >= t.originX &&
          x < t.originX + t.cropWidth &&
          y >= t.originY &&
          y < t.originY + t.cropHeight
      );
      if (!covered) return false;
    }
  }

  return true;
}
