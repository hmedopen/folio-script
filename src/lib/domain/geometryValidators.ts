import type { Point2D, PixelBox } from '../../types/domain/primitives.ts';
import type { ContainerGeometry } from '../../types/domain/geometry.ts';

/**
 * Computes tight axis-aligned bounding box [ymin, xmin, ymax, xmax] from polygon vertices [[x, y], ...].
 */
export function computeBoundingBox(polygon: Point2D[]): PixelBox {
  if (!polygon || polygon.length === 0) {
    return [0, 0, 0, 0];
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (let i = 0; i < polygon.length; i++) {
    const [x, y] = polygon[i];
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }

  return [minY, minX, maxY, maxX];
}

/**
 * Computes bodyPixelBox and totalPixelBox for a PhysicalContainer in memory.
 */
export function computeContainerBoundingBoxes(geometry: ContainerGeometry): {
  bodyPixelBox: PixelBox;
  totalPixelBox: PixelBox;
} {
  const bodyPixelBox = computeBoundingBox(geometry.bodyContour);

  const allPoints: Point2D[] = [...geometry.bodyContour];
  for (const tail of geometry.tails) {
    allPoints.push(tail.attachmentBase[0], tail.attachmentBase[1], tail.tipPoint);
  }

  const totalPixelBox = computeBoundingBox(allPoints);

  return { bodyPixelBox, totalPixelBox };
}

/**
 * Computes signed polygon area using the Shoelace formula.
 * In screen coordinates (x right, y down), clockwise winding yields positive area.
 */
export function computeSignedShoelaceArea(polygon: Point2D[]): number {
  if (!polygon || polygon.length < 3) return 0;

  let sum = 0;
  const n = polygon.length;

  for (let i = 0; i < n; i++) {
    const [x1, y1] = polygon[i];
    const [x2, y2] = polygon[(i + 1) % n];
    sum += x1 * y2 - x2 * y1;
  }

  return sum / 2;
}

/**
 * Computes exact unsigned polygon area using the Shoelace formula.
 */
export function computeShoelaceArea(polygon: Point2D[]): number {
  return Math.abs(computeSignedShoelaceArea(polygon));
}

/**
 * Tests whether polygon vertices wind in clockwise direction in screen space (x right, y down).
 */
export function isClockwiseWinding(polygon: Point2D[]): boolean {
  return computeSignedShoelaceArea(polygon) > 0;
}

/**
 * Normalizes polygon vertices to clockwise winding order.
 */
export function normalizePolygonWinding(polygon: Point2D[]): Point2D[] {
  if (!polygon || polygon.length < 3) return [...polygon];
  if (isClockwiseWinding(polygon)) {
    return [...polygon];
  }
  return [...polygon].reverse();
}

export interface PolygonValidationResult {
  isValid: boolean;
  reason?: string;
}

/**
 * Validates polygon coordinates against finiteness, page boundaries, vertex count and non-degeneracy.
 */
export function validatePolygonCoordinates(
  polygon: Point2D[],
  pageWidth: number,
  pageHeight: number,
  margin = 10
): PolygonValidationResult {
  if (!polygon || !Array.isArray(polygon)) {
    return { isValid: false, reason: 'Polygon must be an array of points' };
  }

  if (polygon.length < 3) {
    return { isValid: false, reason: `Polygon must contain at least 3 vertices (found ${polygon.length})` };
  }

  for (let i = 0; i < polygon.length; i++) {
    const pt = polygon[i];
    if (!Array.isArray(pt) || pt.length !== 2) {
      return { isValid: false, reason: `Vertex at index ${i} is not a valid 2D point [x, y]` };
    }

    const [x, y] = pt;
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      return { isValid: false, reason: `Vertex at index ${i} contains non-finite coordinate values (${x}, ${y})` };
    }

    if (x < -margin || x > pageWidth + margin || y < -margin || y > pageHeight + margin) {
      return {
        isValid: false,
        reason: `Vertex at index ${i} (${x}, ${y}) exceeds page bounds [0..${pageWidth}, 0..${pageHeight}] plus margin (${margin}px)`,
      };
    }
  }

  const area = computeShoelaceArea(polygon);
  if (area < 1.0) {
    return { isValid: false, reason: `Polygon area (${area.toFixed(2)}px²) is degenerate (minimum 1.0px²)` };
  }

  return { isValid: true };
}

/**
 * Tests whether a point lies inside an arbitrary polygon (including concave starbursts) using ray casting.
 */
export function isPointInPolygon(point: Point2D, polygon: Point2D[]): boolean {
  if (!polygon || polygon.length < 3) return false;

  const [px, py] = point;
  let isInside = false;
  const n = polygon.length;

  for (let i = 0, j = n - 1; i < n; j = i++) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];

    const intersects =
      yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi + Number.EPSILON) + xi;

    if (intersects) {
      isInside = !isInside;
    }
  }

  return isInside;
}

/**
 * Derives canonical region text by joining non-ruby lines with newline (\n).
 */
export function getCanonicalRegionText(lines: Array<{ text: string; isRuby?: boolean }>): string {
  if (!lines || lines.length === 0) return '';
  return lines
    .filter((l) => !l.isRuby)
    .map((l) => l.text)
    .join('\n');
}

/**
 * Extracts text span using 0-based UTF-16 code unit offsets [startOffset, endOffset).
 */
export function extractTextSpan(canonicalText: string, textSpan: [number, number]): string {
  if (!canonicalText) return '';
  const [start, end] = textSpan;
  const safeStart = Math.max(0, Math.min(canonicalText.length, start));
  const safeEnd = Math.max(safeStart, Math.min(canonicalText.length, end));
  return canonicalText.slice(safeStart, safeEnd);
}
