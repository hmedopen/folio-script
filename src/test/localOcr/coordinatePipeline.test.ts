import test from 'node:test';
import assert from 'node:assert/strict';
import {
  modelBoxToOriginalPixels,
  originalPixelsToModelBox,
  originalPixelsToDerivedNormalized,
  derivedNormalizedToOriginalPixels,
  cropPolygonToOriginalPixels,
  originalPolygonToCropPixels,
  validateBoxRoundTrip,
  type BoundingBoxTuple,
  type AffineTransformParams,
} from '../../lib/localOcr/coordinatePipeline.ts';

test('CoordinatePipeline: exact round-trip reversibility on native 1:1 tiles', () => {
  const transform: AffineTransformParams = {
    originX: 150,
    originY: 4200,
    scaleX: 1.0,
    scaleY: 1.0,
    padLeft: 0,
    padTop: 0,
    padRight: 0,
    padBottom: 0,
    inputWidth: 640,
    inputHeight: 640,
  };
  const sourceW = 1000;
  const sourceH = 14000;

  // Box on page: [ymin, xmin, ymax, xmax] = [4300.5, 200.25, 4550.75, 420.5]
  const originalBox: BoundingBoxTuple = [4300.5, 200.25, 4550.75, 420.5];

  const modelBox = originalPixelsToModelBox(originalBox, transform);
  assert.deepEqual(modelBox, [100.5, 50.25, 350.75, 270.5]);

  const restored = modelBoxToOriginalPixels(modelBox, transform, sourceW, sourceH);
  assert.equal(restored.isCompletelyOutOfBounds, false);
  assert.equal(restored.touchesInnerLeft, false);
  assert.equal(restored.touchesInnerRight, false);

  for (let i = 0; i < 4; i++) {
    assert.ok(
      Math.abs(restored.pixelBox[i] - originalBox[i]) < 1e-4,
      `Coord[${i}] drift: ${restored.pixelBox[i]} vs ${originalBox[i]}`
    );
  }

  assert.ok(validateBoxRoundTrip(originalBox, transform, sourceW, sourceH, 1e-4));
});

test('CoordinatePipeline: exact round-trip reversibility with centered letterboxing & scaling', () => {
  // Model input 640x640 with a crop of 400x200 scaled 1.5x to 600x300, centered letterbox
  // padLeft = (640 - 600)/2 = 20, padRight = 20
  // padTop = (640 - 300)/2 = 170, padBottom = 170
  const transform: AffineTransformParams = {
    originX: 50,
    originY: 1000,
    scaleX: 1.5,
    scaleY: 1.5,
    padLeft: 20,
    padTop: 170,
    padRight: 20,
    padBottom: 170,
    inputWidth: 640,
    inputHeight: 640,
  };
  const sourceW = 1200;
  const sourceH = 10000;

  // Box in original pixels inside the crop
  const origBox: BoundingBoxTuple = [1050.2, 100.4, 1150.8, 300.6];

  const modelBox = originalPixelsToModelBox(origBox, transform);
  // local: y in [50.2, 150.8], x in [50.4, 250.6]
  // scaled: y in [75.3, 226.2], x in [75.6, 375.9]
  // padded: y in [245.3, 396.2], x in [95.6, 395.9]
  assert.ok(Math.abs(modelBox[0] - 245.3) < 1e-3);
  assert.ok(Math.abs(modelBox[1] - 95.6) < 1e-3);

  const restored = modelBoxToOriginalPixels(modelBox, transform, sourceW, sourceH);
  assert.equal(restored.isCompletelyOutOfBounds, false);

  for (let i = 0; i < 4; i++) {
    assert.ok(
      Math.abs(restored.pixelBox[i] - origBox[i]) < 1e-4,
      `Letterboxed roundtrip drift: ${restored.pixelBox[i]} vs ${origBox[i]}`
    );
  }
});

test('CoordinatePipeline: clips out-of-bounds padding detections and flags inner touches', () => {
  const transform: AffineTransformParams = {
    originX: 0,
    originY: 0,
    scaleX: 1.0,
    scaleY: 1.0,
    padLeft: 50,
    padTop: 50,
    padRight: 50,
    padBottom: 50,
    inputWidth: 640,
    inputHeight: 640,
  };

  // 1. Detection crossing the left padding boundary (x starts at 10, padLeft is 50)
  const crossingBox: BoundingBoxTuple = [100, 10, 200, 150];
  const resCrossing = modelBoxToOriginalPixels(crossingBox, transform, 1000, 1000);
  assert.equal(resCrossing.isCompletelyOutOfBounds, false);
  assert.equal(resCrossing.touchesInnerLeft, true);
  // xmin should be clipped to padLeft (50) -> in local/page pixels: (50 - 50)/1.0 = 0
  assert.equal(resCrossing.pixelBox[1], 0);

  // 2. Detection completely inside padding (x from 5 to 40, outside padLeft of 50)
  const outBox: BoundingBoxTuple = [100, 5, 200, 40];
  const resOut = modelBoxToOriginalPixels(outBox, transform, 1000, 1000);
  assert.equal(resOut.isCompletelyOutOfBounds, true);
});

test('CoordinatePipeline: quantifies drift between float normalization and integer rounding', () => {
  const sourceH = 14000;
  const sourceW = 1000;
  const ymin = 4503.2;
  const ymax = 4655.8;
  const origBox: BoundingBoxTuple = [ymin, 100.5, ymax, 450.5];

  // Derived float normalized
  const floatNorm = originalPixelsToDerivedNormalized(origBox, sourceW, sourceH);
  const restoredFloat = derivedNormalizedToOriginalPixels(floatNorm, sourceW, sourceH);

  for (let i = 0; i < 4; i++) {
    assert.ok(
      Math.abs(restoredFloat[i] - origBox[i]) < 1e-4,
      `Derived float normalized must restore exactly: got ${restoredFloat[i]} vs ${origBox[i]}`
    );
  }

  // Integer normalized (legacy defect simulation)
  const intNormYmin = Math.round((ymin / sourceH) * 1000);
  const intNormYmax = Math.round((ymax / sourceH) * 1000);
  const restoredIntYmin = Math.round((intNormYmin / 1000) * sourceH);
  const restoredIntYmax = Math.round((intNormYmax / 1000) * sourceH);

  const errorYmin = Math.abs(restoredIntYmin - ymin);
  const errorYmax = Math.abs(restoredIntYmax - ymax);
  const spanError = Math.abs((restoredIntYmax - restoredIntYmin) - (ymax - ymin));

  assert.ok(errorYmin > 0.5, `Integer rounding should exhibit observable error (> 0.5px), got ${errorYmin}`);
  assert.ok(spanError > 1.0, `Integer rounding span error should be observable, got ${spanError}`);
});

test('CoordinatePipeline: transforms polygon vertices between crop and original pixels', () => {
  const cropX = 120;
  const cropY = 5000;
  const sourceW = 1000;
  const sourceH = 14000;

  const localPoly: Array<[number, number]> = [
    [10.5, 20.25],
    [150.75, 20.25],
    [150.75, 120.5],
    [10.5, 120.5],
  ];

  const origPoly = cropPolygonToOriginalPixels(localPoly, cropX, cropY, sourceW, sourceH);
  assert.deepEqual(origPoly[0], [130.5, 5020.25]);
  assert.deepEqual(origPoly[2], [270.75, 5120.5]);

  const backToCrop = originalPolygonToCropPixels(origPoly, cropX, cropY);
  assert.deepEqual(backToCrop, localPoly);
});
