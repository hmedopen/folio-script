/**
 * Folio Script — Automated Benchmark Runner
 * Runs RT-DETR-v2 and Koharu YOLO26s across the benchmark dataset and outputs detailed metrics.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  BenchmarkImageMetadata,
  BenchmarkManifest,
  BubbleDifficultyTag,
  ComicCategory,
} from '../datasets/types';
import {
  buildMetricSummary,
  evaluateDetectionsForImage,
  type DetailedBenchmarkResult,
  type MetricSummary,
} from '../metrics/evaluationMetrics';
import type { DetectorAdapter } from '../models/types';
import { RtDetrDetectorAdapter } from '../models/rtDetrAdapter';
import { KoharuYolo26sAdapter } from '../models/koharuAdapter';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface RunBenchmarkOptions {
  manifestPath?: string;
  outputPath?: string;
  splitFilter?: 'all' | 'test' | 'tuning';
  confidenceThreshold?: number;
}

export async function runDetectorBenchmark(
  options: RunBenchmarkOptions = {}
): Promise<DetailedBenchmarkResult[]> {
  const manifestPath = options.manifestPath ?? path.resolve(__dirname, '../datasets/manifest.json');
  const splitFilter = options.splitFilter ?? 'all';

  if (!fs.existsSync(manifestPath)) {
    throw new Error(`Benchmark manifest not found at ${manifestPath}`);
  }

  const manifestRaw = fs.readFileSync(manifestPath, 'utf-8');
  const manifest: BenchmarkManifest = JSON.parse(manifestRaw);

  const imagesToEvaluate = manifest.images.filter(img => {
    if (splitFilter === 'all') return true;
    return img.split === splitFilter;
  });

  const detectors: DetectorAdapter[] = [
    new RtDetrDetectorAdapter({ confidenceThreshold: options.confidenceThreshold }),
    new KoharuYolo26sAdapter({ confidenceThreshold: options.confidenceThreshold }),
  ];

  const results: DetailedBenchmarkResult[] = [];

  for (const detector of detectors) {
    const perImageResults: DetailedBenchmarkResult['perImageResults'] = [];

    let totalTp = 0;
    let totalFp = 0;
    let totalFn = 0;
    const allBoxIous: number[] = [];
    const allContourIous: number[] = [];
    const allLatencies: number[] = [];

    // Accumulators by category
    const catBuckets: Record<ComicCategory, {
      count: number;
      tp: number;
      fp: number;
      fn: number;
      boxIous: number[];
      contourIous: number[];
      latencies: number[];
    }> = {
      manga: { count: 0, tp: 0, fp: 0, fn: 0, boxIous: [], contourIous: [], latencies: [] },
      manhwa: { count: 0, tp: 0, fp: 0, fn: 0, boxIous: [], contourIous: [], latencies: [] },
      manhua: { count: 0, tp: 0, fp: 0, fn: 0, boxIous: [], contourIous: [], latencies: [] },
      western: { count: 0, tp: 0, fp: 0, fn: 0, boxIous: [], contourIous: [], latencies: [] },
    };

    // Accumulators by difficulty tag
    const diffTags: BubbleDifficultyTag[] = [
      'standard',
      'transparent',
      'borderless',
      'gradient',
      'irregular_shape',
      'thought_bubble',
      'dense_dialogue',
      'overlapping',
      'small',
      'large',
      'vertical_scroll',
    ];

    const diffBuckets = new Map<BubbleDifficultyTag, {
      count: number;
      tp: number;
      fp: number;
      fn: number;
      boxIous: number[];
      contourIous: number[];
      latencies: number[];
    }>();

    for (const tag of diffTags) {
      diffBuckets.set(tag, { count: 0, tp: 0, fp: 0, fn: 0, boxIous: [], contourIous: [], latencies: [] });
    }

    for (const image of imagesToEvaluate) {
      const { predictions, latencyMs } = await detector.detect(image);
      const evalImage = evaluateDetectionsForImage(image.annotations, predictions);

      totalTp += evalImage.tp;
      totalFp += evalImage.fp;
      totalFn += evalImage.fn;
      allBoxIous.push(...evalImage.boxIous);
      allContourIous.push(...evalImage.contourIous);
      allLatencies.push(latencyMs);

      // Category breakdown
      const cBucket = catBuckets[image.category];
      cBucket.count++;
      cBucket.tp += evalImage.tp;
      cBucket.fp += evalImage.fp;
      cBucket.fn += evalImage.fn;
      cBucket.boxIous.push(...evalImage.boxIous);
      cBucket.contourIous.push(...evalImage.contourIous);
      cBucket.latencies.push(latencyMs);

      // Difficulty breakdown
      for (const ann of image.annotations) {
        for (const tag of ann.difficultyTags) {
          const dBucket = diffBuckets.get(tag);
          if (dBucket) {
            dBucket.count++;
            // Tag-level attribution: match predictions covering this annotation
            const annEval = evaluateDetectionsForImage([ann], predictions);
            dBucket.tp += annEval.tp;
            dBucket.fp += annEval.fp;
            dBucket.fn += annEval.fn;
            dBucket.boxIous.push(...annEval.boxIous);
            dBucket.contourIous.push(...annEval.contourIous);
            dBucket.latencies.push(latencyMs);
          }
        }
      }

      const meanBoxIoU = evalImage.boxIous.length > 0
        ? evalImage.boxIous.reduce((a, b) => a + b, 0) / evalImage.boxIous.length
        : 0;

      const meanContourIoU = evalImage.contourIous.length > 0
        ? evalImage.contourIous.reduce((a, b) => a + b, 0) / evalImage.contourIous.length
        : null;

      perImageResults.push({
        imageId: image.id,
        category: image.category,
        isLongPage: image.isLongPage,
        gtCount: image.annotations.length,
        predCount: predictions.length,
        tp: evalImage.tp,
        fp: evalImage.fp,
        fn: evalImage.fn,
        meanBoxIoU: Math.round(meanBoxIoU * 1000) / 1000,
        meanContourIoU: meanContourIoU !== null ? Math.round(meanContourIoU * 1000) / 1000 : null,
        latencyMs,
      });
    }

    const overall = buildMetricSummary(
      imagesToEvaluate.length,
      totalTp,
      totalFp,
      totalFn,
      allBoxIous,
      allContourIous,
      allLatencies
    );

    const byCategory: Record<ComicCategory, MetricSummary> = {
      manga: buildMetricSummary(catBuckets.manga.count, catBuckets.manga.tp, catBuckets.manga.fp, catBuckets.manga.fn, catBuckets.manga.boxIous, catBuckets.manga.contourIous, catBuckets.manga.latencies),
      manhwa: buildMetricSummary(catBuckets.manhwa.count, catBuckets.manhwa.tp, catBuckets.manhwa.fp, catBuckets.manhwa.fn, catBuckets.manhwa.boxIous, catBuckets.manhwa.contourIous, catBuckets.manhwa.latencies),
      manhua: buildMetricSummary(catBuckets.manhua.count, catBuckets.manhua.tp, catBuckets.manhua.fp, catBuckets.manhua.fn, catBuckets.manhua.boxIous, catBuckets.manhua.contourIous, catBuckets.manhua.latencies),
      western: buildMetricSummary(catBuckets.western.count, catBuckets.western.tp, catBuckets.western.fp, catBuckets.western.fn, catBuckets.western.boxIous, catBuckets.western.contourIous, catBuckets.western.latencies),
    };

    const byDifficulty: Partial<Record<BubbleDifficultyTag, MetricSummary>> = {};
    for (const [tag, bucket] of diffBuckets.entries()) {
      byDifficulty[tag] = buildMetricSummary(
        bucket.count,
        bucket.tp,
        bucket.fp,
        bucket.fn,
        bucket.boxIous,
        bucket.contourIous,
        bucket.latencies
      );
    }

    results.push({
      detectorName: detector.name,
      overall,
      byCategory,
      byDifficulty: byDifficulty as Record<BubbleDifficultyTag, MetricSummary>,
      perImageResults,
    });
  }

  // Save report
  const outputPath = options.outputPath ?? path.resolve(__dirname, '../reports/benchmarkResults.json');
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(results, null, 2), 'utf-8');

  return results;
}

// Allow direct CLI execution: node benchmark/runners/benchmarkRunner.ts
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  runDetectorBenchmark()
    .then(results => {
      console.log('=== FOLIO SCRIPT DETECTOR BENCHMARK COMPLETED ===');
      for (const res of results) {
        console.log(`\n--- Model: ${res.detectorName} ---`);
        console.log(`Precision: ${(res.overall.precision * 100).toFixed(1)}% | Recall: ${(res.overall.recall * 100).toFixed(1)}% | F1: ${(res.overall.f1Score * 100).toFixed(1)}%`);
        console.log(`Mean Box IoU: ${res.overall.meanBoxIoU.toFixed(3)} | Mean Contour IoU: ${res.overall.meanContourIoU !== null ? res.overall.meanContourIoU.toFixed(3) : 'N/A'}`);
        console.log(`Mean Latency: ${res.overall.latencyMs.mean}ms (p50: ${res.overall.latencyMs.p50}ms, p95: ${res.overall.latencyMs.p95}ms)`);
        console.log('By Category (Recall):', Object.entries(res.byCategory).map(([c, m]) => `${c}: ${(m.recall * 100).toFixed(1)}%`).join(' | '));
        console.log('Difficult Conditions (Recall):');
        console.log(`  Transparent: ${(res.byDifficulty.transparent.recall * 100).toFixed(1)}%`);
        console.log(`  Borderless: ${(res.byDifficulty.borderless.recall * 100).toFixed(1)}%`);
        console.log(`  Vertical Scroll: ${(res.byDifficulty.vertical_scroll.recall * 100).toFixed(1)}%`);
      }
    })
    .catch(err => {
      console.error('Benchmark failed:', err);
      process.exit(1);
    });
}
