/**
 * Folio Script — Polygon Contour Extractor & Simplifier
 * Extracts ordered polygon contours from binary instance masks and simplifies them
 * using the Ramer-Douglas-Peucker algorithm.
 */

export type Point2D = [number, number];

export interface ContourExtractionOptions {
  /** Ramer-Douglas-Peucker epsilon tolerance in mask pixels (default: 1.2) */
  simplificationTolerance?: number;
  /** Minimum polygon area in mask pixels to be considered valid (default: 8.0) */
  minArea?: number;
  /** Optional bounding box ROI to limit extraction [px1, py1, px2, py2] */
  roi?: [number, number, number, number];
}

/**
 * Calculates perpendicular distance from point p to line segment (a, b).
 */
export function perpendicularDistance(p: Point2D, a: Point2D, b: Point2D): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const lineLengthSq = dx * dx + dy * dy;

  if (lineLengthSq === 0) {
    const px = p[0] - a[0];
    const py = p[1] - a[1];
    return Math.hypot(px, py);
  }

  // Cross product magnitude divided by line length
  const numerator = Math.abs(dy * p[0] - dx * p[1] + b[0] * a[1] - b[1] * a[0]);
  return numerator / Math.sqrt(lineLengthSq);
}

/**
 * Ramer-Douglas-Peucker polygon simplification algorithm.
 * Reduces the number of vertices in a curve while preserving key geometry (bursts, corners, tails).
 */
export function simplifyPolygon(points: Point2D[], epsilon: number): Point2D[] {
  if (points.length <= 2 || epsilon <= 0) {
    return [...points];
  }

  let dmax = 0;
  let index = 0;
  const last = points.length - 1;

  for (let i = 1; i < last; i++) {
    const d = perpendicularDistance(points[i], points[0], points[last]);
    if (d > dmax) {
      index = i;
      dmax = d;
    }
  }

  if (dmax > epsilon) {
    const recResults1 = simplifyPolygon(points.slice(0, index + 1), epsilon);
    const recResults2 = simplifyPolygon(points.slice(index), epsilon);
    return recResults1.slice(0, recResults1.length - 1).concat(recResults2);
  }

  return [points[0], points[last]];
}

/**
 * Calculates the polygon area using the Shoelace formula (Gauss's area formula).
 */
export function calculatePolygonArea(points: Point2D[]): number {
  const n = points.length;
  if (n < 3) return 0;

  let area = 0.0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    area += points[i][0] * points[j][1];
    area -= points[j][0] * points[i][1];
  }
  return Math.abs(area) / 2.0;
}

/**
 * Moore-Neighbor boundary tracing algorithm.
 * Extracts the primary exterior boundary of a binary mask component as an ordered loop of points.
 */
export function traceMooreNeighborBoundary(
  mask: Uint8Array,
  width: number,
  height: number,
  roi?: [number, number, number, number]
): Point2D[] {
  const minX = roi ? Math.max(0, roi[0]) : 0;
  const minY = roi ? Math.max(0, roi[1]) : 0;
  const maxX = roi ? Math.min(width - 1, roi[2]) : width - 1;
  const maxY = roi ? Math.min(height - 1, roi[3]) : height - 1;

  // 1. Find the starting pixel: leftmost-topmost foreground pixel (value === 1)
  let startX = -1;
  let startY = -1;

  for (let y = minY; y <= maxY; y++) {
    const rowOffset = y * width;
    for (let x = minX; x <= maxX; x++) {
      if (mask[rowOffset + x] === 1) {
        startX = x;
        startY = y;
        break;
      }
    }
    if (startX !== -1) break;
  }

  if (startX === -1) {
    return []; // No foreground pixels found
  }

  // 8-connected directional offsets in clockwise order:
  // 0: North, 1: North-East, 2: East, 3: South-East,
  // 4: South, 5: South-West, 6: West, 7: North-West
  const dx = [0, 1, 1, 1, 0, -1, -1, -1];
  const dy = [-1, -1, 0, 1, 1, 1, 0, -1];

  const contour: Point2D[] = [[startX, startY]];

  // Backtracking entry direction for starting pixel (coming from West -> enters from 6, search begins at (6 + 2) % 8 = 0)
  let curX = startX;
  let curY = startY;
  let backtrackDir = 6; // West

  const maxSteps = width * height * 2;
  let steps = 0;

  while (steps < maxSteps) {
    steps++;
    // Start scanning neighbors from (backtrackDir + 2) % 8 mod clockwise
    const startScanDir = (backtrackDir + 2) % 8;
    let foundNext = false;

    for (let i = 0; i < 8; i++) {
      const dir = (startScanDir + i) % 8;
      const nx = curX + dx[dir];
      const ny = curY + dy[dir];

      if (nx >= minX && nx <= maxX && ny >= minY && ny <= maxY) {
        if (mask[ny * width + nx] === 1) {
          curX = nx;
          curY = ny;
          contour.push([curX, curY]);
          // Backtracking direction is opposite of movement direction
          backtrackDir = (dir + 4) % 8;
          foundNext = true;
          break;
        }
      }
    }

    if (!foundNext) {
      // Isolated single pixel
      break;
    }

    // Stop condition: returned to start point
    if (curX === startX && curY === startY) {
      break;
    }
  }

  return contour;
}

/**
 * Extracts a simplified, valid polygon contour from a binary mask.
 */
export function extractPolygonContour(
  mask: Uint8Array,
  width: number,
  height: number,
  options: ContourExtractionOptions = {}
): Point2D[] {
  const tolerance = options.simplificationTolerance ?? 1.2;
  const minArea = options.minArea ?? 8.0;

  const rawBoundary = traceMooreNeighborBoundary(mask, width, height, options.roi);
  if (rawBoundary.length < 3) {
    return [];
  }

  // Simplify raw boundary points
  const simplified = simplifyPolygon(rawBoundary, tolerance);

  // Close the loop if not closed
  if (simplified.length >= 3) {
    const first = simplified[0];
    const last = simplified[simplified.length - 1];
    if (first[0] !== last[0] || first[1] !== last[1]) {
      simplified.push([first[0], first[1]]);
    }
  }

  // Validate area
  const area = calculatePolygonArea(simplified);
  if (area < minArea || simplified.length < 4) {
    return [];
  }

  return simplified;
}

/**
 * Transforms polygon coordinates from mask space (e.g. prototype [protoW, protoH])
 * into the target reference frame (e.g. full image pixels or tile pixels).
 */
export function scalePolygonCoordinates(
  polygon: Point2D[],
  fromWidth: number,
  fromHeight: number,
  toWidth: number,
  toHeight: number,
  offsetX = 0,
  offsetY = 0
): Point2D[] {
  const scaleX = toWidth / fromWidth;
  const scaleY = toHeight / fromHeight;

  return polygon.map(([x, y]) => [
    Math.round((x * scaleX + offsetX) * 10) / 10,
    Math.round((y * scaleY + offsetY) * 10) / 10,
  ]);
}
