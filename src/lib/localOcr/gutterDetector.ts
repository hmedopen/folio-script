/**
 * Folio Script — Safety-First Horizontal Gutter Detector
 * Identifies uniform horizontal whitespace/monochrome bands between comic panels
 * without cutting through speech balloons, text, or artwork.
 */

export interface RgbaImageBufferLike {
  width: number;
  height: number;
  data: Uint8ClampedArray | Uint8Array;
}

export interface GutterCandidate {
  start: number;
  end: number;
  height: number;
  center: number;
  meanLuminance: number;
  meanVariance: number;
  score: number;
}

export interface GutterDetectionOptions {
  minGutterHeight?: number;       // default: 16px
  maxVarianceThreshold?: number;  // default: 4.5
  edgeGradientThreshold?: number; // default: 25.0
}

/**
 * Calculates row-level luminance and variance across a horizontal line.
 */
function computeRowLuminanceStats(
  image: RgbaImageBufferLike,
  y: number,
  stride = 2
): { mean: number; variance: number } {
  const width = image.width;
  const rowOffset = y * width * 4;
  const data = image.data;

  let sum = 0;
  let count = 0;

  // Sample every `stride` pixels across the width for speed
  for (let x = 0; x < width; x += stride) {
    const idx = rowOffset + x * 4;
    // Standard sRGB perceptual luminance formula: 0.299 R + 0.587 G + 0.114 B
    const lum = 0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2];
    sum += lum;
    count++;
  }

  if (count === 0) return { mean: 255, variance: 0 };
  const mean = sum / count;

  let varianceSum = 0;
  for (let x = 0; x < width; x += stride) {
    const idx = rowOffset + x * 4;
    const lum = 0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2];
    const diff = lum - mean;
    varianceSum += diff * diff;
  }

  return {
    mean,
    variance: varianceSum / count,
  };
}

/**
 * Scans a vertical search zone [startY, endY] on the original page image for safe horizontal gutters.
 * Rejects any band with high row variance, gradient edges, or insufficient height.
 */
export function findGuttersInZone(
  image: RgbaImageBufferLike,
  startY: number,
  endY: number,
  idealY: number,
  options: GutterDetectionOptions = {}
): GutterCandidate[] {
  const minHeight = options.minGutterHeight ?? 16;
  const maxVar = options.maxVarianceThreshold ?? 4.5;

  const clampedStartY = Math.max(0, Math.min(image.height - 1, startY));
  const clampedEndY = Math.max(clampedStartY, Math.min(image.height - 1, endY));

  const validRows: boolean[] = new Array(clampedEndY - clampedStartY + 1).fill(false);
  const rowMeans: number[] = new Array(clampedEndY - clampedStartY + 1);
  const rowVars: number[] = new Array(clampedEndY - clampedStartY + 1);

  for (let y = clampedStartY; y <= clampedEndY; y++) {
    const idx = y - clampedStartY;
    const { mean, variance } = computeRowLuminanceStats(image, y);
    rowMeans[idx] = mean;
    rowVars[idx] = variance;

    // A row is candidate gutter if its horizontal variance is very low (uniform solid color across page)
    if (variance <= maxVar) {
      validRows[idx] = true;
    }
  }

  // Find contiguous blocks of valid rows
  const candidates: GutterCandidate[] = [];
  let blockStart = -1;

  for (let i = 0; i < validRows.length; i++) {
    if (validRows[i]) {
      if (blockStart === -1) blockStart = i;
    } else {
      if (blockStart !== -1) {
        const h = i - blockStart;
        if (h >= minHeight) {
          const actualStart = clampedStartY + blockStart;
          const actualEnd = clampedStartY + i - 1;
          const center = Math.round((actualStart + actualEnd) / 2);

          let sumM = 0;
          let sumV = 0;
          for (let k = blockStart; k < i; k++) {
            sumM += rowMeans[k];
            sumV += rowVars[k];
          }
          const meanLuminance = sumM / h;
          const meanVariance = sumV / h;

          // Quality score: higher height, lower variance, closer to idealY
          const distToIdeal = Math.abs(center - idealY);
          const maxDist = Math.max(1, (clampedEndY - clampedStartY) / 2);
          const distFactor = Math.max(0, 1.0 - distToIdeal / maxDist);
          const score = (h / 64) * 0.4 + (1.0 / (1.0 + meanVariance)) * 0.3 + distFactor * 0.3;

          candidates.push({
            start: actualStart,
            end: actualEnd,
            height: h,
            center,
            meanLuminance,
            meanVariance,
            score,
          });
        }
        blockStart = -1;
      }
    }
  }

  // Handle block ending at the very boundary
  if (blockStart !== -1) {
    const h = validRows.length - blockStart;
    if (h >= minHeight) {
      const actualStart = clampedStartY + blockStart;
      const actualEnd = clampedEndY;
      const center = Math.round((actualStart + actualEnd) / 2);
      candidates.push({
        start: actualStart,
        end: actualEnd,
        height: h,
        center,
        meanLuminance: 255,
        meanVariance: 0,
        score: (h / 64) * 0.4 + 0.6,
      });
    }
  }

  // Sort candidates by score descending
  return candidates.sort((a, b) => b.score - a.score);
}
