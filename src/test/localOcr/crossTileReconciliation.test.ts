import test from 'node:test';
import assert from 'node:assert/strict';
import type { RawComicDetection, TileTransformRecord } from '../../types/localOcr.ts';
import {
  fuseTiledComicDetections,
  validateClusterGraph,
  stitchSeamPolygons,
  areCrossTileBoundarySplitPieces,
  type Point2D,
} from '../../lib/localOcr/geometryFusion.ts';
import { originalPixelsToDerivedNormalized } from '../../lib/localOcr/coordinatePipeline.ts';

function makeDet(
  id: string,
  cls: 'bubble' | 'text_bubble' | 'text_free',
  pixelBox: [number, number, number, number],
  tileId: string,
  rawScore: number,
  w: number,
  h: number,
  edges: Partial<{ left: boolean; top: boolean; right: boolean; bottom: boolean }> = {},
  pixelPolygon?: Point2D[]
): RawComicDetection {
  return {
    detectionId: id,
    classLabel: cls,
    classId: cls === 'bubble' ? 0 : cls === 'text_bubble' ? 1 : 2,
    pixelBox,
    normalizedBox: originalPixelsToDerivedNormalized(pixelBox, w, h),
    pixelPolygon,
    rawScore,
    tileId,
    touchesTileInnerLeft: Boolean(edges.left),
    touchesTileInnerTop: Boolean(edges.top),
    touchesTileInnerRight: Boolean(edges.right),
    touchesTileInnerBottom: Boolean(edges.bottom),
  };
}

function makeTile(
  tileId: string,
  row: number,
  col: number,
  originX: number,
  originY: number,
  cropW = 640,
  cropH = 640
): TileTransformRecord {
  return {
    tileId,
    row,
    col,
    originX,
    originY,
    cropWidth: cropW,
    cropHeight: cropH,
    inputWidth: 640,
    inputHeight: 640,
    scaleX: 1,
    scaleY: 1,
    padRight: 0,
    padBottom: 0,
    touchesPageLeft: originX === 0,
    touchesPageTop: originY === 0,
    touchesPageRight: false,
    touchesPageBottom: false,
  };
}

test('CrossTileReconciliation: anti-transitive defense strictly enforces same-tile disjointness', () => {
  const t0 = makeTile('t0', 0, 0, 0, 0);
  const t1 = makeTile('t1', 1, 0, 0, 416);
  const tileMap = new Map([['t0', t0], ['t1', t1]]);

  const d1 = makeDet('d1', 'bubble', [300, 100, 420, 250], 't0', 0.9, 640, 1200);
  const d2 = makeDet('d2', 'bubble', [300, 300, 420, 450], 't0', 0.9, 640, 1200); // also in t0!

  // Cluster attempting to contain both d1 and d2 from t0 must be rejected
  const valid = validateClusterGraph([d1, d2], tileMap);
  assert.equal(valid, false, 'Multiple detections from the same tile must never be merged');
});

test('CrossTileReconciliation: anti-transitive defense rejects bridging across disconnected tiles', () => {
  const t0 = makeTile('t0', 0, 0, 0, 0);
  const t2 = makeTile('t2', 2, 0, 0, 1000); // Disconnected from t0 (gap > 640px)
  const tileMap = new Map([['t0', t0], ['t2', t2]]);

  const d1 = makeDet('d1', 'bubble', [300, 100, 400, 250], 't0', 0.9, 640, 2000);
  const d2 = makeDet('d2', 'bubble', [1200, 100, 1300, 250], 't2', 0.9, 640, 2000);

  const valid = validateClusterGraph([d1, d2], tileMap);
  assert.equal(valid, false, 'Detections in physically disconnected tiles cannot be merged');
});

test('CrossTileReconciliation: allows long vertical manhwa narration boxes (15:1 ratio)', () => {
  const t0 = makeTile('t0', 0, 0, 0, 0);
  const t1 = makeTile('t1', 1, 0, 0, 416);
  const t2 = makeTile('t2', 2, 0, 0, 832);
  const tileMap = new Map([['t0', t0], ['t1', t1], ['t2', t2]]);

  // Narrow, very tall vertical narration segment spanning t0, t1, t2: 60px wide, 900px tall (15:1)
  const d1 = makeDet('d1', 'text_free', [100, 200, 450, 260], 't0', 0.9, 640, 2000, { bottom: true });
  const d2 = makeDet('d2', 'text_free', [416, 200, 850, 260], 't1', 0.9, 640, 2000, { top: true, bottom: true });
  const d3 = makeDet('d3', 'text_free', [832, 200, 1000, 260], 't2', 0.9, 640, 2000, { top: true });

  const valid = validateClusterGraph([d1, d2, d3], tileMap);
  assert.equal(valid, true, 'Legitimate 15:1 vertical narration strip across adjacent tiles must be accepted');
});

test('CrossTileReconciliation: chains oversized balloon spanning across 3 vertical tiles', () => {
  const w = 640;
  const h = 2000;
  const t0 = makeTile('t0', 0, 0, 0, 0);
  const t1 = makeTile('t1', 1, 0, 0, 416);
  const t2 = makeTile('t2', 2, 0, 0, 832);
  const tiles = [t0, t1, t2];

  const raw: RawComicDetection[] = [
    // Narration box piece in t0 touching bottom
    makeDet('n0', 'bubble', [200, 150, 640, 450], 't0', 0.92, w, h, { bottom: true }),
    // Narration box piece in t1 touching top & bottom
    makeDet('n1', 'bubble', [416, 152, 1056, 448], 't1', 0.91, w, h, { top: true, bottom: true }),
    // Narration box piece in t2 touching top
    makeDet('n2', 'bubble', [832, 149, 1200, 451], 't2', 0.89, w, h, { top: true }),
  ];

  const fused = fuseTiledComicDetections(raw, tiles, w, h);
  assert.equal(fused.length, 1, 'All 3 pieces across 3 tiles must unite into 1 oversized region');
  assert.deepEqual(fused[0].pixelBox, [200, 149, 1200, 451]);
  assert.equal(fused[0].sourceTileIds.length, 3);
  assert.equal(fused[0].boundaryUncertain, false);
});

test('PolygonStitching: welds complex starburst contour with multiple seam intersections', () => {
  const seamY = 500;

  // Starburst upper piece with two downward spikes crossing seamY=500 at [120..160] and [240..280]
  const polyA: Point2D[] = [
    [100, 400],
    [140, 520], // Spike 1 enters seam
    [180, 450],
    [260, 520], // Spike 2 enters seam
    [300, 400],
    [200, 350],
    [100, 400],
  ];

  // Starburst lower piece with matching spikes below seamY=500
  const polyB: Point2D[] = [
    [120, 480],
    [140, 580], // Tip of spike 1
    [160, 480],
    [240, 480],
    [260, 580], // Tip of spike 2
    [280, 480],
    [120, 480],
  ];

  const result = stitchSeamPolygons(polyA, polyB, seamY);
  assert.equal(result.isAmbiguous, false);
  assert.ok(result.stitched !== null);
  assert.ok(result.stitched!.length >= 6);

  // Closed loop verification
  const first = result.stitched![0];
  const last = result.stitched![result.stitched!.length - 1];
  assert.deepEqual(first, last);
});
