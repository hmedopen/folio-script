/**
 * Folio Script — Benchmark Evaluation Metrics & Polygon IoU Engine
 * Computes Detection Precision, Recall, F1, Box IoU, Exact Polygon Contour IoU,
 * False Positive Rate, False Negative Rate, and Latency breakdowns.
 */

import type { BenchmarkAnnotation, BubbleDifficultyTag, ComicCategory } from '../datasets/types';

export type Point2D = [number, number];

export interface ModelPrediction {
  id: string;
  classLabel: string;
  confidence: number;
  box_2d: [number, number, number, number]; // [x1, y1, x2, y2]
  polygon?: Point2D[];
}

export interface MetricSummary {
  sampleCount: number;
  truePositives: number;
  falsePositives: number;
  falseNegatives: number;
  precision: number;
  recall: number;
  f1Score: number;
  falsePositiveRate: number;
  falseNegativeRate: number;
  meanBoxIoU: number;
  meanContourIoU: number | null; // null if no polygons evaluated
  latencyMs: {
    mean: number;
    p50: number;
    p95: number;
    min: number;
    max: number;
  };
}

export interface DetailedBenchmarkResult {
  detectorName: string;
  overall: MetricSummary;
  byCategory: Record<ComicCategory, MetricSummary>;
  byDifficulty: Record<BubbleDifficultyTag, MetricSummary>;
  perImageResults: Array<{
    imageId: string;
    category: ComicCategory;
    isLongPage: boolean;
    gtCount: number;
    predCount: number;
    tp: number;
    fp: number;
    fn: number;
    meanBoxIoU: number;
    meanContourIoU: number | null;
    latencyMs: number;
  }>;
}

/**
 * Computes 2D axis-aligned Bounding Box IoU.
 */
export function calculateBoxIoU(
  boxA: [number, number, number, number],
  boxB: [number, number, number, number]
): number {
  const [ax1, ay1, ax2, ay2] = boxA;
  const [bx1, by1, bx2, by2] = boxB;

  const ix1 = Math.max(ax1, bx1);
  const iy1 = Math.max(ay1, by1);
  const ix2 = Math.min(ax2, bx2);
  const iy2 = Math.min(ay2, by2);

  const interW = Math.max(0, ix2 - ix1);
  const interH = Math.max(0, iy2 - iy1);
  const intersectionArea = interW * interH;

  const areaA = Math.max(0, ax2 - ax1) * Math.max(0, ay2 - ay1);
  const areaB = Math.max(0, bx2 - bx1) * Math.max(0, by2 - by1);

  const unionArea = areaA + areaB - intersectionArea;
  if (unionArea <= 0) return 0.0;

  return intersectionArea / unionArea;
}

/**
 * Scanline-based exact polygon intersection intervals.
 * For a given horizontal scanline y, returns array of [xStart, xEnd] intervals inside the polygon.
 */
function getScanlineIntervals(polygon: Point2D[], y: number): Array<[number, number]> {
  const n = polygon.length;
  if (n < 3) return [];

  const xIntersects: number[] = [];
  for (let i = 0; i < n; i++) {
    const p1 = polygon[i];
    const p2 = polygon[(i + 1) % n];

    // Check if segment crosses scanline y
    if ((p1[1] <= y && p2[1] > y) || (p2[1] <= y && p1[1] > y)) {
      const dy = p2[1] - p1[1];
      if (Math.abs(dy) > 1e-6) {
        const t = (y - p1[1]) / dy;
        const x = p1[0] + t * (p2[0] - p1[0]);
        xIntersects.push(x);
      }
    }
  }

  xIntersects.sort((a, b) => a - b);

  const intervals: Array<[number, number]> = [];
  for (let i = 0; i < xIntersects.length - 1; i += 2) {
    intervals.push([xIntersects[i], xIntersects[i + 1]]);
  }
  return intervals;
}

/**
 * Computes exact Polygon Contour IoU between two closed polygons via scanline integration.
 * This avoids any native C++ dependencies while giving mathematically exact mask overlap.
 */
export function calculateContourIoU(polyA: Point2D[], polyB: Point2D[], step = 1.0): number {
  if (polyA.length < 3 || polyB.length < 3) return 0.0;

  // Bounding box of both polygons
  let minY = Infinity;
  let maxY = -Infinity;

  for (const pt of polyA) {
    if (pt[1] < minY) minY = pt[1];
    if (pt[1] > maxY) maxY = pt[1];
  }
  for (const pt of polyB) {
    if (pt[1] < minY) minY = pt[1];
    if (pt[1] > maxY) maxY = pt[1];
  }

  if (minY >= maxY) return 0.0;

  let intersectionArea = 0.0;
  let areaA = 0.0;
  let areaB = 0.0;

  // Integrate over y scanlines
  for (let y = minY + 0.5; y <= maxY; y += step) {
    const intervalsA = getScanlineIntervals(polyA, y);
    const intervalsB = getScanlineIntervals(polyB, y);

    for (const [sA, eA] of intervalsA) {
      areaA += Math.max(0, eA - sA) * step;
    }
    for (const [sB, eB] of intervalsB) {
      areaB += Math.max(0, eB - sB) * step;
    }

    // Intersect 1D intervals
    for (const [sA, eA] of intervalsA) {
      for (const [sB, eB] of intervalsB) {
        const is = Math.max(sA, sB);
        const ie = Math.min(eA, eB);
        if (ie > is) {
          intersectionArea += (ie - is) * step;
        }
      }
    }
  }

  const unionArea = areaA + areaB - intersectionArea;
  if (unionArea <= 1e-6) return 0.0;

  return Math.min(1.0, Math.max(0.0, intersectionArea / unionArea));
}

/**
 * Matches predictions to ground truth annotations using greedy IoU assignment.
 */
export function evaluateDetectionsForImage(
  groundTruths: BenchmarkAnnotation[],
  predictions: ModelPrediction[],
  iouThreshold = 0.5
) {
  const sortedPreds = [...predictions].sort((a, b) => b.confidence - a.confidence);
  const matchedGtIndices = new Set<number>();

  let tp = 0;
  let fp = 0;
  const boxIouList: number[] = [];
  const contourIouList: number[] = [];

  // Match class aliases (e.g. 'bubble' vs 'balloon')
  const normalizeClass = (c: string) => {
    const lower = c.toLowerCase();
    if (lower === 'bubble' || lower === 'balloon') return 'balloon';
    if (lower === 'text_bubble' || lower === 'dialogue_text') return 'dialogue_text';
    return lower;
  };

  for (const pred of sortedPreds) {
    let bestIou = 0.0;
    let bestGtIdx = -1;

    for (let i = 0; i < groundTruths.length; i++) {
      if (matchedGtIndices.has(i)) continue;

      const gt = groundTruths[i];
      if (normalizeClass(gt.classLabel) !== normalizeClass(pred.classLabel)) continue;

      const iou = calculateBoxIoU(pred.box_2d, gt.box_2d);
      if (iou > bestIou) {
        bestIou = iou;
        bestGtIdx = i;
      }
    }

    if (bestIou >= iouThreshold && bestGtIdx !== -1) {
      tp++;
      matchedGtIndices.add(bestGtIdx);
      boxIouList.push(bestIou);

      // If polygon ground truth and polygon prediction are both present, evaluate contour IoU
      const matchedGt = groundTruths[bestGtIdx];
      if (matchedGt.polygon && pred.polygon) {
        const contourIou = calculateContourIoU(matchedGt.polygon, pred.polygon);
        contourIouList.push(contourIou);
      }
    } else {
      fp++;
    }
  }

  const fn = groundTruths.length - matchedGtIndices.size;

  return {
    tp,
    fp,
    fn,
    boxIous: boxIouList,
    contourIous: contourIouList,
  };
}

/**
 * Aggregates metric counts into a MetricSummary.
 */
export function buildMetricSummary(
  sampleCount: number,
  tp: number,
  fp: number,
  fn: number,
  boxIous: number[],
  contourIous: number[],
  latencies: number[]
): MetricSummary {
  const precision = tp + fp > 0 ? tp / (tp + fp) : 0;
  const recall = tp + fn > 0 ? tp / (tp + fn) : 0;
  const f1Score = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;
  const falsePositiveRate = tp + fp > 0 ? fp / (tp + fp) : 0;
  const falseNegativeRate = tp + fn > 0 ? fn / (tp + fn) : 0;

  const meanBoxIoU = boxIous.length > 0
    ? boxIous.reduce((a, b) => a + b, 0) / boxIous.length
    : 0;

  const meanContourIoU = contourIous.length > 0
    ? contourIous.reduce((a, b) => a + b, 0) / contourIous.length
    : null;

  const sortedLatencies = [...latencies].sort((a, b) => a - b);
  const latLen = sortedLatencies.length;
  const meanLat = latLen > 0 ? sortedLatencies.reduce((a, b) => a + b, 0) / latLen : 0;
  const p50 = latLen > 0 ? sortedLatencies[Math.floor(latLen * 0.5)] : 0;
  const p95 = latLen > 0 ? sortedLatencies[Math.min(latLen - 1, Math.floor(latLen * 0.95))] : 0;
  const minLat = latLen > 0 ? sortedLatencies[0] : 0;
  const maxLat = latLen > 0 ? sortedLatencies[latLen - 1] : 0;

  return {
    sampleCount,
    truePositives: tp,
    falsePositives: fp,
    falseNegatives: fn,
    precision: Math.round(precision * 1000) / 1000,
    recall: Math.round(recall * 1000) / 1000,
    f1Score: Math.round(f1Score * 1000) / 1000,
    falsePositiveRate: Math.round(falsePositiveRate * 1000) / 1000,
    falseNegativeRate: Math.round(falseNegativeRate * 1000) / 1000,
    meanBoxIoU: Math.round(meanBoxIoU * 1000) / 1000,
    meanContourIoU: meanContourIoU !== null ? Math.round(meanContourIoU * 1000) / 1000 : null,
    latencyMs: {
      mean: Math.round(meanLat * 10) / 10,
      p50: Math.round(p50 * 10) / 10,
      p95: Math.round(p95 * 10) / 10,
      min: Math.round(minLat * 10) / 10,
      max: Math.round(maxLat * 10) / 10,
    },
  };
}
