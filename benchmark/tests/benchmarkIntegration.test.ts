import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runDetectorBenchmark } from '../runners/benchmarkRunner';
import {
  extractPolygonContour,
  simplifyPolygon,
  scalePolygonCoordinates,
} from '../segmentation/contourExtractor';
import {
  parseYoloSegDetections,
  reconstructInstanceMask,
} from '../segmentation/maskDecoder';
import {
  calculateBoxIoU,
  calculateContourIoU,
} from '../metrics/evaluationMetrics';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

test('Benchmark End-to-End: executes both detectors and writes benchmarkResults.json', async () => {
  const outputPath = path.resolve(__dirname, '../reports/testResults.json');

  const results = await runDetectorBenchmark({
    outputPath,
    splitFilter: 'all',
  });

  assert.equal(results.length, 2);
  const [rtdetr, koharu] = results;

  assert.equal(rtdetr.detectorName, 'RT-DETR-v2 (Production)');
  assert.equal(koharu.detectorName, 'Koharu YOLO26s');

  // Verify RT-DETR-v2 properties
  assert.equal(rtdetr.overall.recall, 1.0);
  assert.equal(rtdetr.overall.meanContourIoU, null); // No polygons
  assert.ok(rtdetr.overall.meanBoxIoU > 0.9);

  // Verify Koharu YOLO26s properties
  assert.ok(koharu.overall.meanContourIoU !== null && koharu.overall.meanContourIoU > 0.75);
  // Koharu excels at Japanese manga
  assert.equal(koharu.byCategory.manga.recall, 1.0);
  // Koharu struggles with Korean manhwa due to domain shift on borderless/transparent bubbles
  assert.ok(koharu.byCategory.manhwa.recall < 0.65, `Expected manhwa recall < 0.65, got ${koharu.byCategory.manhwa.recall}`);
  assert.ok(koharu.byDifficulty.borderless.recall < 0.40, `Expected borderless recall < 0.40, got ${koharu.byDifficulty.borderless.recall}`);

  // Verify output file on disk
  assert.ok(fs.existsSync(outputPath));
  const fileContent = JSON.parse(fs.readFileSync(outputPath, 'utf-8'));
  assert.equal(fileContent.length, 2);

  // Clean up test file
  fs.unlinkSync(outputPath);
});

test('Segmentation Edge Cases: handles empty mask, all-zeros, and degenerate 1-pixel contours', () => {
  const w = 32;
  const h = 32;
  const emptyMask = new Uint8Array(w * h);

  // 1. All-zeros mask -> empty contour
  const contourEmpty = extractPolygonContour(emptyMask, w, h);
  assert.equal(contourEmpty.length, 0);

  // 2. 1-pixel mask -> degenerate contour, discarded by minArea filter
  emptyMask[10 * w + 10] = 1;
  const contour1Px = extractPolygonContour(emptyMask, w, h, { minArea: 4.0 });
  assert.equal(contour1Px.length, 0);

  // 3. Single horizontal line (2x1) -> degenerate contour
  emptyMask[10 * w + 11] = 1;
  const contourLine = extractPolygonContour(emptyMask, w, h, { minArea: 4.0 });
  assert.equal(contourLine.length, 0);
});

test('Segmentation Edge Cases: parseYoloSegDetections handles empty, negative, and out-of-order boxes', () => {
  const data = new Float32Array(38);
  // Degenerate box: x2 < x1
  data[0] = 100;
  data[1] = 100;
  data[2] = 50; // inverted x
  data[3] = 150;
  data[4] = 0.99;
  data[5] = 2;

  const parsed = parseYoloSegDetections(data, 1, 0.35);
  assert.equal(parsed.length, 0, 'Inverted bounding box should be rejected');
});

test('Metrics Edge Cases: IoU calculation on zero-area and degenerate boxes', () => {
  const zeroBox: [number, number, number, number] = [10, 10, 10, 10]; // 0 width & height
  const normalBox: [number, number, number, number] = [0, 0, 20, 20];

  assert.equal(calculateBoxIoU(zeroBox, normalBox), 0.0);
  assert.equal(calculateBoxIoU(zeroBox, zeroBox), 0.0);

  // Degenerate polygons (less than 3 vertices)
  assert.equal(calculateContourIoU([[0, 0]], [[10, 10]]), 0.0);
});
