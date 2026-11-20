import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseYoloSegDetections,
  reconstructInstanceMask,
  resampleBinaryMask,
} from '../segmentation/maskDecoder';
import {
  perpendicularDistance,
  simplifyPolygon,
  calculatePolygonArea,
  traceMooreNeighborBoundary,
  extractPolygonContour,
  scalePolygonCoordinates,
} from '../segmentation/contourExtractor';

test('Instance Segmentation: parseYoloSegDetections parses output0 correctly', () => {
  // Output0 has 38 floats per detection: [x1, y1, x2, y2, conf, class_id, c0..c31]
  const data = new Float32Array(38 * 2);

  // Instance 0: valid balloon detection
  data[0] = 50;  // x1
  data[1] = 60;  // y1
  data[2] = 150; // x2
  data[3] = 160; // y2
  data[4] = 0.88; // conf
  data[5] = 2;    // class_id (balloon)
  for (let c = 0; c < 32; c++) {
    data[6 + c] = (c + 1) * 0.1;
  }

  // Instance 1: low confidence detection (< 0.35)
  data[38 + 0] = 10;
  data[38 + 1] = 10;
  data[38 + 2] = 40;
  data[38 + 3] = 40;
  data[38 + 4] = 0.20;
  data[38 + 5] = 1;

  const parsed = parseYoloSegDetections(data, 2, 0.35);
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].classId, 2);
  assert.ok(Math.abs(parsed[0].confidence - 0.88) < 1e-4);
  assert.deepEqual(parsed[0].box, [50, 60, 150, 160]);
  assert.equal(parsed[0].maskCoefficients.length, 32);
  assert.equal(Math.round(parsed[0].maskCoefficients[0] * 10) / 10, 0.1);
});

test('Instance Segmentation: reconstructInstanceMask performs logit dot product correctly', () => {
  const detection = {
    index: 0,
    classId: 2,
    confidence: 0.9,
    box: [20, 20, 40, 40] as [number, number, number, number],
    maskCoefficients: new Float32Array(32),
  };
  detection.maskCoefficients[0] = 1.0; // only channel 0 active

  const protoW = 30;
  const protoH = 30;
  const protoData = new Float32Array(32 * protoW * protoH);

  // Channel 0: create a 5x5 positive region from (5,5) to (9,9)
  for (let y = 5; y < 10; y++) {
    for (let x = 5; x < 10; x++) {
      protoData[0 * (protoW * protoH) + y * protoW + x] = 2.5; // positive logit
    }
  }

  // Map input (0..120) to prototype (0..30), scale = 30/120 = 0.25
  // Box [20, 20, 40, 40] maps to px in [5..10]
  const mask = reconstructInstanceMask(detection, protoData, protoW, protoH, 120, 120, 0.0);

  assert.equal(mask.width, protoW);
  assert.equal(mask.height, protoH);
  assert.equal(mask.foregroundPixelCount, 25);
  assert.equal(mask.data[5 * protoW + 5], 1);
  assert.equal(mask.data[0], 0);
});

test('Instance Segmentation: resampleBinaryMask scales mask nearest-neighbor', () => {
  const src = new Uint8Array([
    1, 0,
    0, 1,
  ]);
  const dst = resampleBinaryMask(src, 2, 2, 4, 4);
  assert.equal(dst.length, 16);
  assert.equal(dst[0], 1);
  assert.equal(dst[1], 1);
  assert.equal(dst[4], 1);
  assert.equal(dst[5], 1);
  assert.equal(dst[2], 0);
});

test('Contour Extractor: perpendicularDistance calculates distance accurately', () => {
  const p: [number, number] = [5, 5];
  const a: [number, number] = [0, 0];
  const b: [number, number] = [10, 0];
  const dist = perpendicularDistance(p, a, b);
  assert.equal(dist, 5);
});

test('Contour Extractor: simplifyPolygon reduces vertices', () => {
  // A straight line with an intermediate point
  const points: Array<[number, number]> = [
    [0, 0],
    [5, 0.1], // small bump
    [10, 0],
    [15, 5], // corner
    [20, 10],
  ];
  const simplified = simplifyPolygon(points, 0.5);
  // [5, 0.1] should be pruned, [15, 5] preserved
  assert.equal(simplified.length, 3);
  assert.deepEqual(simplified[0], [0, 0]);
  assert.deepEqual(simplified[1], [10, 0]);
  assert.deepEqual(simplified[2], [20, 10]);
});

test('Contour Extractor: calculatePolygonArea returns correct area for a polygon', () => {
  // 10x10 square
  const square: Array<[number, number]> = [
    [0, 0],
    [10, 0],
    [10, 10],
    [0, 10],
  ];
  const area = calculatePolygonArea(square);
  assert.equal(area, 100);
});

test('Contour Extractor: traceMooreNeighborBoundary and extractPolygonContour', () => {
  const w = 20;
  const h = 20;
  const mask = new Uint8Array(w * h);

  // Fill a 6x6 square from (5,5) to (10,10)
  for (let y = 5; y <= 10; y++) {
    for (let x = 5; x <= 10; x++) {
      mask[y * w + x] = 1;
    }
  }

  const boundary = traceMooreNeighborBoundary(mask, w, h);
  assert.ok(boundary.length >= 4);

  const contour = extractPolygonContour(mask, w, h, { simplificationTolerance: 0.5 });
  assert.ok(contour.length >= 4);
  // Verify loop is closed
  assert.deepEqual(contour[0], contour[contour.length - 1]);
  // Area of 6x6 pixel grid should be approximately 25-36
  const area = calculatePolygonArea(contour);
  assert.ok(area >= 20 && area <= 36, `Area should be roughly 25-36, got ${area}`);
});

test('Contour Extractor: scalePolygonCoordinates scales to original image frame', () => {
  const poly: Array<[number, number]> = [
    [10, 10],
    [20, 10],
    [20, 20],
    [10, 20],
  ];
  // Scale from 100x100 to 1000x1000 with offset (50, 100)
  const scaled = scalePolygonCoordinates(poly, 100, 100, 1000, 1000, 50, 100);
  assert.deepEqual(scaled[0], [150, 200]);
  assert.deepEqual(scaled[1], [250, 200]);
});
