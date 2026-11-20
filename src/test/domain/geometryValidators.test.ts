import assert from 'node:assert/strict';
import test from 'node:test';
import type { Point2D } from '../../types/domain/primitives.ts';
import type { ContainerGeometry } from '../../types/domain/geometry.ts';
import {
  computeBoundingBox,
  computeContainerBoundingBoxes,
  computeShoelaceArea,
  validatePolygonCoordinates,
  isPointInPolygon,
  getCanonicalRegionText,
  extractTextSpan,
  normalizePolygonWinding,
  isClockwiseWinding,
} from '../../lib/domain/geometryValidators.ts';

test('computeBoundingBox computes exact axis-aligned bounds [ymin, xmin, ymax, xmax]', () => {
  const polygon: Point2D[] = [
    [100, 50],
    [300, 80],
    [250, 400],
    [50, 350],
  ];

  const box = computeBoundingBox(polygon);
  assert.deepEqual(box, [50, 50, 400, 300]);
});

test('computeContainerBoundingBoxes includes body and tail points without persisting duplicate boxes', () => {
  const geometry: ContainerGeometry = {
    bodyContour: [
      [100, 100],
      [300, 100],
      [300, 300],
      [100, 300],
    ],
    tails: [
      {
        tailId: 'tail-1',
        style: 'pointed_vector',
        attachmentBase: [
          [200, 300],
          [240, 300],
        ],
        tipPoint: [350, 450], // extends beyond body bounds
      },
    ],
  };

  const { bodyPixelBox, totalPixelBox } = computeContainerBoundingBoxes(geometry);
  assert.deepEqual(bodyPixelBox, [100, 100, 300, 300]);
  assert.deepEqual(totalPixelBox, [100, 100, 450, 350]);
});

test('computeShoelaceArea calculates exact polygon area', () => {
  // Rectangle of 200 x 100 = 20,000 px²
  const rect: Point2D[] = [
    [0, 0],
    [200, 0],
    [200, 100],
    [0, 100],
  ];

  assert.equal(computeShoelaceArea(rect), 20000);
});

test('validatePolygonCoordinates rejects non-finite, out-of-bounds, or degenerate polygons', () => {
  // Valid polygon
  const validPoly: Point2D[] = [
    [10, 10],
    [100, 10],
    [100, 100],
    [10, 100],
  ];
  assert.equal(validatePolygonCoordinates(validPoly, 1200, 1800).isValid, true);

  // Rejects NaN / Infinity
  const nanPoly: Point2D[] = [
    [10, NaN],
    [100, 10],
    [100, 100],
  ];
  const nanRes = validatePolygonCoordinates(nanPoly, 1200, 1800);
  assert.equal(nanRes.isValid, false);
  assert.match(nanRes.reason || '', /non-finite/);

  // Rejects out of bounds beyond margin
  const outPoly: Point2D[] = [
    [10, 10],
    [1500, 10], // exceeds width 1200 + 10 margin
    [100, 100],
  ];
  const outRes = validatePolygonCoordinates(outPoly, 1200, 1800);
  assert.equal(outRes.isValid, false);
  assert.match(outRes.reason || '', /exceeds page bounds/);

  // Rejects degenerate collinear / zero-area polygon
  const collinearPoly: Point2D[] = [
    [10, 10],
    [20, 20],
    [30, 30],
  ];
  const collRes = validatePolygonCoordinates(collinearPoly, 1200, 1800);
  assert.equal(collRes.isValid, false);
  assert.match(collRes.reason || '', /degenerate/);
});

test('isPointInPolygon correctly classifies points inside and outside concave starburst polygons', () => {
  // Concave starburst shape (V-notch cut in top edge)
  const starburst: Point2D[] = [
    [0, 0],
    [100, 50], // V-notch indentation
    [200, 0],
    [200, 200],
    [0, 200],
  ];

  // Point deep inside lower body
  assert.equal(isPointInPolygon([100, 150], starburst), true);

  // Point in the empty cavity of the V-notch (inside AABB [0..200, 0..200], but outside polygon)
  assert.equal(isPointInPolygon([100, 20], starburst), false);

  // Point completely outside
  assert.equal(isPointInPolygon([250, 100], starburst), false);
});

test('normalizePolygonWinding normalizes polygon vertices to clockwise order', () => {
  // Counter-clockwise triangle
  const ccw: Point2D[] = [
    [0, 0],
    [0, 100],
    [100, 100],
  ];

  assert.equal(isClockwiseWinding(ccw), false);
  const normalized = normalizePolygonWinding(ccw);
  assert.equal(isClockwiseWinding(normalized), true);
});

test('getCanonicalRegionText concatenates lines with \\n and strictly excludes ruby annotations', () => {
  const lines = [
    { text: '海賊王', isRuby: false },
    { text: 'かいぞくおう', isRuby: true }, // Furigana above kanji
    { text: 'に俺はなる！', isRuby: false },
  ];

  const canonical = getCanonicalRegionText(lines);
  assert.equal(canonical, '海賊王\nに俺はなる！');
});

test('extractTextSpan extracts slices using 0-based UTF-16 code units', () => {
  const canonical = 'KENSHIN:\nI will not draw my blade.';
  // "KENSHIN:" is [0, 8)
  assert.equal(extractTextSpan(canonical, [0, 8]), 'KENSHIN:');
  // "I will not draw my blade." is [9, 34)
  assert.equal(extractTextSpan(canonical, [9, 34]), 'I will not draw my blade.');
});
