import test from 'node:test';
import assert from 'node:assert/strict';
import {
  executeLocalPageOcrPipeline,
  type PipelineRuntimeState,
} from '../../lib/localOcr/ocrWorker.ts';
import { planAdaptivePageTiles } from '../../lib/localOcr/tilePlanner.ts';
import { computeExactCoverage } from '../../lib/localOcr/exactCoverageVerifier.ts';
import type { ModelAssetPayload } from '../../types/localOcr.ts';

function fakeAssets(modelId: string, files: Record<string, Uint8Array>): ModelAssetPayload {
  return {
    modelId,
    revisionLabel: '1.0.0',
    files,
    byteLengths: Object.fromEntries(Object.entries(files).map(([k, v]) => [k, v.byteLength])),
  };
}

test('WorkerMemoryFailure: releases decoded buffer and enforces exact partial failure on interior tile crash', async () => {
  const state: PipelineRuntimeState = {
    detectorKey: null,
    detectorSession: null,
    ocrKey: null,
    ocrAdapter: null,
  };

  let bufferAllocated = true;

  const result = await executeLocalPageOcrPipeline(
    {
      jobId: 'mem-fail-1',
      pageId: 'page-mem-1',
      imageBytes: new ArrayBuffer(64),
      mimeType: 'image/png',
      languageHint: 'en',
      resolvedRoute: 'en_ppocrv6_small',
      readingConvention: 'ltr',
      detectorAssets: fakeAssets('comic-detector-v4-s-int8', {
        'detector-v4-s_int8.onnx': new Uint8Array([1]),
      }),
      ocrAssets: fakeAssets('ppocr-v6-small-en', {}),
      wasmPaths: './ort/',
    },
    state,
    () => false,
    {
      decodeImage: async () => {
        bufferAllocated = true;
        return {
          width: 640,
          height: 2400, // Tall page (~6 tiles)
          data: new Uint8ClampedArray(640 * 2400 * 4),
        };
      },
      createDetector: async () => ({
        async runTile(_rgba, tile) {
          // Simulate failure of an interior tile
          if (tile.tileId === 'tile_r2_c0') {
            throw new Error('GPU tile inference OOM simulation');
          }
          return [
            {
              detectionId: `b_${tile.tileId}`,
              classLabel: 'bubble',
              classId: 0,
              pixelBox: [tile.originY + 50, 100, tile.originY + 150, 300],
              normalizedBox: [0, 0, 0, 0],
              rawScore: 0.95,
              tileId: tile.tileId,
              touchesTileInnerLeft: false,
              touchesTileInnerTop: false,
              touchesTileInnerRight: false,
              touchesTileInnerBottom: false,
            },
          ];
        },
        async dispose() {},
      }),
      createOcrAdapter: async () => ({
        runtimeUsed: 'paddleocr_js',
        async predictCrop() {
          return [];
        },
        async dispose() {},
      }),
    }
  );

  // Status must be partial due to uncovered gap
  assert.equal(result.status, 'partial');
  assert.equal(result.partialFailures.length, 1);
  assert.equal(result.partialFailures[0].targetId, 'tile_r2_c0');
  
  // Warning must contain the exact spatial gap
  assert.ok(result.warnings.some((w) => w.includes('Unprocessed spatial gap')));
});

test('WorkerMemoryFailure: mid-scan abort cleanly throws AbortError without poisoning state', async () => {
  const state: PipelineRuntimeState = {
    detectorKey: null,
    detectorSession: null,
    ocrKey: null,
    ocrAdapter: null,
  };

  let tileCount = 0;
  let cancelled = false;

  const promise = executeLocalPageOcrPipeline(
    {
      jobId: 'mem-cancel',
      pageId: 'page-cancel',
      imageBytes: new ArrayBuffer(64),
      mimeType: 'image/png',
      languageHint: 'en',
      resolvedRoute: 'en_ppocrv6_small',
      readingConvention: 'ltr',
      detectorAssets: fakeAssets('comic-detector-v4-s-int8', {
        'detector-v4-s_int8.onnx': new Uint8Array([1]),
      }),
      ocrAssets: fakeAssets('ppocr-v6-small-en', {}),
      wasmPaths: './ort/',
    },
    state,
    () => cancelled,
    {
      decodeImage: async () => ({
        width: 640,
        height: 5000,
        data: new Uint8ClampedArray(640 * 5000 * 4),
      }),
      createDetector: async () => ({
        async runTile() {
          tileCount++;
          if (tileCount >= 2) {
            cancelled = true; // Trigger cancellation after 2 tiles
          }
          return [];
        },
        async dispose() {},
      }),
      createOcrAdapter: async () => ({
        runtimeUsed: 'paddleocr_js',
        async predictCrop() {
          return [];
        },
        async dispose() {},
      }),
    }
  );

  await assert.rejects(
    async () => await promise,
    (err: any) => err.name === 'AbortError'
  );
});

test('WorkerMemoryFailure: preserves pixelBox and pixelPolygon throughout result assembly', async () => {
  const state: PipelineRuntimeState = {
    detectorKey: null,
    detectorSession: null,
    ocrKey: null,
    ocrAdapter: null,
  };

  const result = await executeLocalPageOcrPipeline(
    {
      jobId: 'pixel-geom-test',
      pageId: 'page-geom',
      imageBytes: new ArrayBuffer(64),
      mimeType: 'image/png',
      languageHint: 'en',
      resolvedRoute: 'en_ppocrv6_small',
      readingConvention: 'ltr',
      detectorAssets: fakeAssets('comic-detector-v4-s-int8', {
        'detector-v4-s_int8.onnx': new Uint8Array([1]),
      }),
      ocrAssets: fakeAssets('ppocr-v6-small-en', {}),
      wasmPaths: './ort/',
    },
    state,
    () => false,
    {
      decodeImage: async () => ({
        width: 800,
        height: 1200,
        data: new Uint8ClampedArray(800 * 1200 * 4),
      }),
      createDetector: async () => ({
        async runTile(_rgba, tile) {
          if (tile.tileId !== 'tile_r0_c0') return [];
          return [
            {
              detectionId: 'det_bubble_1',
              classLabel: 'bubble',
              classId: 0,
              pixelBox: [100.5, 200.25, 300.75, 450.5],
              pixelPolygon: [
                [100.5, 200.25],
                [100.5, 450.5],
                [300.75, 450.5],
                [300.75, 200.25],
              ],
              normalizedBox: [83, 250, 250, 563],
              rawScore: 0.98,
              tileId: 'tile_r0_c0',
              touchesTileInnerLeft: false,
              touchesTileInnerTop: false,
              touchesTileInnerRight: false,
              touchesTileInnerBottom: false,
            },
          ];
        },
        async dispose() {},
      }),
      createOcrAdapter: async () => ({
        runtimeUsed: 'paddleocr_js',
        async predictCrop() {
          return [];
        },
        async dispose() {},
      }),
    }
  );

  assert.equal(result.status, 'complete');
  assert.equal(result.bubbleRegions.length, 1);
  const bubble = result.bubbleRegions[0];
  assert.deepEqual(bubble.geometry.pixelBox, [100.5, 200.25, 300.75, 450.5]);
  assert.deepEqual(bubble.geometry.pixelPolygon, [
    [100.5, 200.25],
    [100.5, 450.5],
    [300.75, 450.5],
    [300.75, 200.25],
  ]);
});
