import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateBoxIoU,
  calculateContourIoU,
  evaluateDetectionsForImage,
  buildMetricSummary,
} from '../metrics/evaluationMetrics';
import type { BenchmarkAnnotation } from '../datasets/types';

test('Metrics: calculateBoxIoU calculates intersection over union correctly', () => {
  // Disjoint boxes
  const box1: [number, number, number, number] = [0, 0, 10, 10];
  const box2: [number, number, number, number] = [20, 20, 30, 30];
  assert.equal(calculateBoxIoU(box1, box2), 0.0);

  // Identical boxes
  assert.equal(calculateBoxIoU(box1, box1), 1.0);

  // 50% overlap horizontally: [0, 0, 10, 10] and [5, 0, 15, 10]
  // Intersection = 5 * 10 = 50. Union = 100 + 100 - 50 = 150. IoU = 50 / 150 = 1/3 ~ 0.3333
  const box3: [number, number, number, number] = [5, 0, 15, 10];
  assert.ok(Math.abs(calculateBoxIoU(box1, box3) - 1 / 3) < 1e-4);
});

test('Metrics: calculateContourIoU calculates exact polygon overlap', () => {
  // Identical 10x10 squares
  const polyA: Array<[number, number]> = [
    [0, 0],
    [10, 0],
    [10, 10],
    [0, 10],
  ];
  const polyB: Array<[number, number]> = [
    [0, 0],
    [10, 0],
    [10, 10],
    [0, 10],
  ];
  const iouIdentical = calculateContourIoU(polyA, polyB);
  assert.ok(Math.abs(iouIdentical - 1.0) < 0.05, `Expected ~1.0, got ${iouIdentical}`);

  // Disjoint polygons
  const polyDisjoint: Array<[number, number]> = [
    [50, 50],
    [60, 50],
    [60, 60],
    [50, 60],
  ];
  const iouDisjoint = calculateContourIoU(polyA, polyDisjoint);
  assert.equal(iouDisjoint, 0.0);

  // 50% overlap
  const polyHalf: Array<[number, number]> = [
    [5, 0],
    [15, 0],
    [15, 10],
    [5, 10],
  ];
  const iouHalf = calculateContourIoU(polyA, polyHalf);
  assert.ok(Math.abs(iouHalf - 1 / 3) < 0.05, `Expected ~0.333, got ${iouHalf}`);
});

test('Metrics: evaluateDetectionsForImage matches TP, FP, FN and evaluates Contour IoU', () => {
  const gt: BenchmarkAnnotation[] = [
    {
      id: 'gt1',
      classLabel: 'balloon',
      box_2d: [10, 10, 50, 50],
      polygon: [
        [10, 10],
        [50, 10],
        [50, 50],
        [10, 50],
      ],
      difficultyTags: ['standard'],
    },
    {
      id: 'gt2',
      classLabel: 'balloon',
      box_2d: [100, 100, 150, 150],
      difficultyTags: ['transparent'],
    },
  ];

  const preds = [
    {
      id: 'p1',
      classLabel: 'balloon',
      confidence: 0.95,
      box_2d: [10, 10, 50, 50] as [number, number, number, number],
      polygon: [
        [10, 10],
        [50, 10],
        [50, 50],
        [10, 50],
      ] as Array<[number, number]>,
    },
    {
      id: 'p2',
      classLabel: 'balloon',
      confidence: 0.8,
      box_2d: [300, 300, 350, 350] as [number, number, number, number], // false positive
    },
  ];

  const evalResult = evaluateDetectionsForImage(gt, preds, 0.5);
  assert.equal(evalResult.tp, 1);
  assert.equal(evalResult.fp, 1);
  assert.equal(evalResult.fn, 1); // gt2 was missed
  assert.equal(evalResult.boxIous.length, 1);
  assert.equal(evalResult.contourIous.length, 1);
  assert.ok(evalResult.contourIous[0] > 0.95);

  const summary = buildMetricSummary(1, evalResult.tp, evalResult.fp, evalResult.fn, evalResult.boxIous, evalResult.contourIous, [45]);
  assert.equal(summary.precision, 0.5);
  assert.equal(summary.recall, 0.5);
  assert.equal(summary.f1Score, 0.5);
  assert.ok(summary.meanContourIoU !== null && summary.meanContourIoU > 0.9);
});
