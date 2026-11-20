import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeAdaptiveAxisSlices,
  planAdaptivePageTiles,
  verifyTileCoverage,
  DETECTOR_TARGET_SIZE,
} from '../../lib/localOcr/tilePlanner.ts';
import { computeExactCoverage } from '../../lib/localOcr/exactCoverageVerifier.ts';
import type { GutterCandidate } from '../../lib/localOcr/gutterDetector.ts';

test('AdaptiveTiling: strictly enforces minimum 35% overlap invariant and monotonicity', () => {
  const dimension = 14000;
  const tileSize = 640;
  const minOverlapRatio = 0.35;
  const minOverlapPixels = Math.floor(tileSize * minOverlapRatio); // 224px

  const slices = computeAdaptiveAxisSlices(dimension, tileSize, minOverlapRatio);
  assert.ok(slices.length > 20);

  for (let i = 1; i < slices.length; i++) {
    const prev = slices[i - 1];
    const curr = slices[i];

    // Monotonicity
    assert.ok(curr.origin > prev.origin, `Slice ${i} origin must be strictly greater than slice ${i - 1}`);

    // Minimum overlap invariant
    const overlap = prev.origin + prev.cropSpan - curr.origin;
    assert.ok(
      overlap >= minOverlapPixels,
      `Overlap between slice ${i - 1} and ${i} was ${overlap}px, expected >= ${minOverlapPixels}px`
    );
  }

  // Final tile reaches exact edge
  const last = slices[slices.length - 1];
  assert.equal(last.origin + last.cropSpan, dimension);
  // No duplicate final tile
  if (slices.length >= 2) {
    assert.notEqual(slices[slices.length - 2].origin, last.origin);
  }
});

test('AdaptiveTiling: snaps to quality-scored gutter while preserving minimum overlap', () => {
  const dimension = 3000;
  const tileSize = 640;
  const minOverlapRatio = 0.35; // maxStride = 416, ideal origin = 416
  const minOverlapPixels = 224;

  const gutters: GutterCandidate[] = [
    // Gutter at center 380 (within candidate range [291, 416]), high score
    {
      start: 360,
      end: 400,
      height: 40,
      center: 380,
      meanLuminance: 255,
      meanVariance: 0.2,
      score: 0.95,
    },
    // Gutter at 500 (too far, would violate minimum overlap with tile 0)
    {
      start: 480,
      end: 520,
      height: 40,
      center: 500,
      meanLuminance: 255,
      meanVariance: 0.1,
      score: 0.99,
    },
  ];

  const slices = computeAdaptiveAxisSlices(dimension, tileSize, minOverlapRatio, gutters);
  // Slice 1 should snap to gutter at 380
  assert.equal(slices[1].origin, 380);
  assert.equal(slices[0].isSnappedToGutter, true);

  // Verify overlap is strictly preserved
  const overlap = slices[0].origin + slices[0].cropSpan - slices[1].origin;
  assert.ok(overlap >= minOverlapPixels, `Overlap ${overlap} must be >= ${minOverlapPixels}`);
});

test('AdaptiveTiling: plans 10k, 14k, and 20k pages with verified 100% tile coverage', () => {
  const dimensions = [
    { w: 1000, h: 10000 },
    { w: 1080, h: 14000 },
    { w: 1200, h: 20000 },
  ];

  for (const { w, h } of dimensions) {
    const tiles = planAdaptivePageTiles(w, h, { overlapRatio: 0.35 });
    assert.ok(tiles.length > 0);
    assert.equal(verifyTileCoverage(tiles, w, h), true, `Tile coverage must be 100% for ${w}x${h}`);

    // Exact spatial union coverage
    const allIds = tiles.map((t) => t.tileId);
    const report = computeExactCoverage(w, h, tiles, allIds);
    assert.equal(report.isFullyCovered, true);
    assert.equal(report.coverageRatio, 1.0);
    assert.equal(report.unprocessedGaps.length, 0);
    assert.equal(report.status, 'complete');
  }
});

test('ExactCoverageVerifier: detects unprocessed gap when an interior tile fails', () => {
  const w = 640;
  const h = 2000;
  const tiles = planAdaptivePageTiles(w, h, { overlapRatio: 0.35 }); // ~5 vertical tiles

  // Simulate failure of tile_r2_c0
  const succeeded = tiles.filter((t) => t.tileId !== 'tile_r2_c0').map((t) => t.tileId);
  const report = computeExactCoverage(w, h, tiles, succeeded);

  assert.equal(report.isFullyCovered, false);
  assert.ok(report.coverageRatio < 1.0 && report.coverageRatio > 0.7);
  assert.ok(report.unprocessedGaps.length >= 1);
  assert.equal(report.status, 'partial');
  assert.equal(report.failedTileCount, 1);
});

test('ExactCoverageVerifier: reports complete if overlapping neighbors cover failed tile 100%', () => {
  const w = 640;
  const h = 1000;
  // Create 3 tiles where T1 and T3 overlap heavily, covering T2 entirely
  const tiles: any[] = [
    { tileId: 't1', originX: 0, originY: 0, cropWidth: 640, cropHeight: 600 },
    { tileId: 't2', originX: 0, originY: 200, cropWidth: 640, cropHeight: 400 }, // entirely inside t1 + t3
    { tileId: 't3', originX: 0, originY: 400, cropWidth: 640, cropHeight: 600 },
  ];

  // t2 fails, but t1 covers [0..600] and t3 covers [400..1000] -> [0..1000] is 100% covered!
  const report = computeExactCoverage(w, h, tiles, ['t1', 't3']);
  assert.equal(report.isFullyCovered, true);
  assert.equal(report.coverageRatio, 1.0);
  assert.equal(report.unprocessedGaps.length, 0);
  assert.equal(report.status, 'complete');
});
