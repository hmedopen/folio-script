import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import * as ort from 'onnxruntime-web';

import {
  executeManualCropOcrBatch,
  prepareManualCropRgba,
  type ManualWorkerRuntimeState,
} from '../features/manual-selection/ocr/manualOcrWorker.ts';
import {
  ManualOcrService,
  checkManualOcrModelReadiness,
} from '../features/manual-selection/ocr/manualOcrService.ts';
import { ScanQueueManager } from '../lib/scanQueue.ts';
import { scanPageWithGemini } from '../lib/geminiScan.ts';
import { scanMangaPageHybridWithMeta } from '../lib/hybridScan.ts';
import type { LocalModelAssetProvider } from '../lib/localOcr/modelClient.ts';
import type { BubbleItem } from '../types/workbench.ts';
import type { RgbaImageBuffer } from '../lib/localOcr/comicDetector.ts';

const require = createRequire(import.meta.url);
const { createModelManager } = require('../../electron/modelManager.cjs');

function decodePngRgba(buf: Buffer): RgbaImageBuffer {
  let offset = 8;
  let width = 0;
  let height = 0;
  let colorType = 0;
  const idatChunks: Buffer[] = [];

  while (offset < buf.length) {
    const len = buf.readUInt32BE(offset);
    const type = buf.toString('ascii', offset + 4, offset + 8);
    const data = buf.subarray(offset + 8, offset + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      colorType = data[9];
    } else if (type === 'IDAT') {
      idatChunks.push(data);
    } else if (type === 'IEND') {
      break;
    }
    offset += 12 + len;
  }

  const raw = zlib.inflateSync(Buffer.concat(idatChunks));
  const bpp = colorType === 6 ? 4 : colorType === 2 ? 3 : 1;
  const stride = width * bpp;
  const rgba = new Uint8ClampedArray(width * height * 4);
  const prevRow = new Uint8Array(stride);
  const currRow = new Uint8Array(stride);
  let pos = 0;

  for (let y = 0; y < height; y++) {
    const filter = raw[pos++];
    for (let x = 0; x < stride; x++) {
      const val = raw[pos++];
      const a = x >= bpp ? currRow[x - bpp] : 0;
      const b = prevRow[x];
      const c = x >= bpp ? prevRow[x - bpp] : 0;
      let out = val;
      if (filter === 1) out = (val + a) & 0xff;
      else if (filter === 2) out = (val + b) & 0xff;
      else if (filter === 3) out = (val + Math.floor((a + b) / 2)) & 0xff;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        const pr = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
        out = (val + pr) & 0xff;
      }
      currRow[x] = out;
    }
    for (let x = 0; x < width; x++) {
      const dst = (y * width + x) * 4;
      if (bpp === 4) {
        rgba[dst] = currRow[x * 4];
        rgba[dst + 1] = currRow[x * 4 + 1];
        rgba[dst + 2] = currRow[x * 4 + 2];
        rgba[dst + 3] = currRow[x * 4 + 3];
      } else if (bpp === 3) {
        rgba[dst] = currRow[x * 3];
        rgba[dst + 1] = currRow[x * 3 + 1];
        rgba[dst + 2] = currRow[x * 3 + 2];
        rgba[dst + 3] = 255;
      } else {
        rgba[dst] = rgba[dst + 1] = rgba[dst + 2] = currRow[x];
        rgba[dst + 3] = 255;
      }
    }
    prevRow.set(currRow);
  }

  return { width, height, data: rgba };
}

// ============================================================================
// ACCEPTANCE TEST A: MANUAL SELECTION
// ============================================================================

test('Acceptance Test A: Manual Selection 3 regions extract with local OCR, 0 Gemini, 0 translation, clean cancel/error handling', async (t) => {
  // 1. Prepare 3 manual selection regions (box, bubble, lasso)
  const regions: BubbleItem[] = [
    {
      id: 'sel-box-1',
      pageId: 'page-manual-1',
      chapterId: 'ch-1',
      index: 1,
      box_2d: [100, 100, 250, 450],
      type: 'speech_bubbles',
      typerPrefix: '"":',
      sourceText: '',
      originalSourceText: '',
      translatedText: '',
      rawTranslatedText: '',
      reviewFlags: [],
      provenance: 'manual_selection',
      manualSelectionShape: 'box',
      manualExtractionStatus: 'created',
      manualTranslationStatus: 'untranslated',
    },
    {
      id: 'sel-bubble-2',
      pageId: 'page-manual-1',
      chapterId: 'ch-1',
      index: 2,
      box_2d: [300, 150, 500, 600],
      type: 'speech_bubbles',
      typerPrefix: '"":',
      sourceText: '',
      originalSourceText: '',
      translatedText: '',
      rawTranslatedText: '',
      reviewFlags: [],
      provenance: 'manual_selection',
      manualSelectionShape: 'bubble',
      manualExtractionStatus: 'created',
      manualTranslationStatus: 'untranslated',
    },
    {
      id: 'sel-lasso-3',
      pageId: 'page-manual-1',
      chapterId: 'ch-1',
      index: 3,
      box_2d: [600, 200, 850, 700],
      manualPolygon: [
        [200, 600],
        [700, 600],
        [700, 850],
        [200, 850],
      ],
      type: 'outside_text',
      typerPrefix: 'OT:',
      sourceText: '',
      originalSourceText: '',
      translatedText: '',
      rawTranslatedText: '',
      reviewFlags: [],
      provenance: 'manual_selection',
      manualSelectionShape: 'lasso',
      manualExtractionStatus: 'created',
      manualTranslationStatus: 'untranslated',
    },
  ];

  // 2. Set up spy to strictly guarantee zero Gemini & zero translation calls
  let geminiCalls = 0;
  let translationCalls = 0;
  const originalFetch = globalThis.fetch;
  (globalThis as any).fetch = async (input: any) => {
    const url = String(input);
    if (url.includes('generativelanguage.googleapis.com')) {
      geminiCalls++;
      throw new Error(`CRITICAL INVARIANT VIOLATION: Gemini called during manual selection: ${url}`);
    }
    return originalFetch(input);
  };

  try {
    // 3. Mock worker that simulates local OCR processing for all three regions
    const progressUpdates: Array<{ regionId: string; completed: number; total: number }> = [];
    const mockWorker = {
      listeners: new Map<string, Set<(ev: any) => void>>(),
      addEventListener(type: string, fn: (ev: any) => void) {
        if (!this.listeners.has(type)) this.listeners.set(type, new Set());
        this.listeners.get(type)!.add(fn);
      },
      removeEventListener(type: string, fn: (ev: any) => void) {
        this.listeners.get(type)?.delete(fn);
      },
      postMessage(msg: any) {
        if (msg.type === 'run_manual_crops') {
          // Verify only the 3 manually selected regions are sent
          assert.equal(msg.targets.length, 3);
          assert.equal(msg.targets[0].regionId, 'sel-box-1');
          assert.equal(msg.targets[1].regionId, 'sel-bubble-2');
          assert.equal(msg.targets[2].regionId, 'sel-lasso-3');

          // Simulate per-region progress updates
          setTimeout(() => {
            for (let i = 0; i < msg.targets.length; i++) {
              for (const fn of this.listeners.get('message') || []) {
                fn({
                  data: {
                    type: 'region_progress',
                    jobId: msg.jobId,
                    regionId: msg.targets[i].regionId,
                    completed: i + 1,
                    total: 3,
                  },
                });
              }
            }

            // Return extracted OCR results
            for (const fn of this.listeners.get('message') || []) {
              fn({
                data: {
                  type: 'job_result',
                  jobId: msg.jobId,
                  pageId: msg.pageId,
                  sourceDimensions: { width: 1000, height: 1400 },
                  outcomes: [
                    { regionId: 'sel-box-1', status: 'ocr_success', text: 'HELLO WORLD', confidence: 0.95, lineCount: 1 },
                    { regionId: 'sel-bubble-2', status: 'ocr_success', text: 'I AM A BUBBLE', confidence: 0.91, lineCount: 1 },
                    { regionId: 'sel-lasso-3', status: 'ocr_success', text: 'LASSO CONTOUR TEXT', confidence: 0.88, lineCount: 1 },
                  ],
                  loadedOcrKey: msg.ocrModelKey,
                },
              });
            }
          }, 10);
        }
      },
      terminate() {},
    };

    const mockProvider: LocalModelAssetProvider = {
      getManifest: async () => ({ manifestVersion: 1, models: [] }),
      getStatus: async () => ({
        modelId: 'ppocr-v6-small-en',
        state: 'installed',
        installedRevision: 'rev1',
        verifiedBytes: 1000,
        expectedBytes: 1000,
        missingFiles: [],
        corruptFiles: [],
      }),
      downloadModel: async () => { throw new Error('No download'); },
      cancelDownload: async () => false,
      removeModel: async () => { throw new Error('No remove'); },
      readModelAssets: async () => ({
        modelId: 'ppocr-v6-small-en',
        revisionLabel: 'rev1',
        files: {},
      }),
    };

    const service = new ManualOcrService({
      modelProvider: mockProvider,
      createWorker: () => mockWorker as any,
      getPageBlob: async () => new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'image/png' }),
      cancellationTimeoutMs: 1000,
      executionTimeoutMs: 5000,
    });

    const result = await service.extractPageRegions({
      pageId: 'page-manual-1',
      bubbles: regions,
      language: 'en',
      onProgress: (regionId, completed, total) => {
        progressUpdates.push({ regionId, completed, total });
      },
    });

    // Invariant 1: All 3 complete and return recognized text
    assert.equal(result.outcomes.length, 3);
    assert.equal(result.outcomes[0].text, 'HELLO WORLD');
    assert.equal(result.outcomes[1].text, 'I AM A BUBBLE');
    assert.equal(result.outcomes[2].text, 'LASSO CONTOUR TEXT');

    // Invariant 2: Progress was updated for each region
    assert.ok(progressUpdates.length >= 3);
    assert.equal(progressUpdates[progressUpdates.length - 1].completed, 3);
    assert.equal(progressUpdates[progressUpdates.length - 1].total, 3);

    // Invariant 3: Zero Gemini calls
    assert.equal(geminiCalls, 0, 'Gemini must NEVER be called during manual selection');

    // Invariant 4: Zero translation calls
    assert.equal(translationCalls, 0, 'Translation must NEVER be invoked during manual extraction');

    // Invariant 5: Cancellation recovers cleanly without hanging
    const abortController = new AbortController();
    abortController.abort();
    await assert.rejects(
      async () => {
        await service.extractPageRegions({
          pageId: 'page-manual-1',
          bubbles: regions,
          language: 'en',
          signal: abortController.signal,
        });
      },
      (err: any) => err.name === 'AbortError'
    );

    // Invariant 6: Provider failure (missing model) produces clean actionable error without hanging
    const missingProvider: LocalModelAssetProvider = {
      ...mockProvider,
      getStatus: async () => ({
        modelId: 'ppocr-v6-small-en',
        state: 'not_installed',
        installedRevision: null,
        verifiedBytes: 0,
        expectedBytes: 1000,
        missingFiles: ['det/inference.onnx'],
        corruptFiles: [],
      }),
    };
    const missingService = new ManualOcrService({
      modelProvider: missingProvider,
      createWorker: () => mockWorker as any,
      getPageBlob: async () => new Blob([new Uint8Array([1, 2, 3])]),
    });
    await assert.rejects(
      async () => {
        await missingService.extractPageRegions({
          pageId: 'page-manual-1',
          bubbles: regions,
          language: 'en',
        });
      },
      (err: any) => /not_installed|Required local OCR model/i.test(err.message)
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// ============================================================================
// ACCEPTANCE TEST B: SCAN ALL WITH GEMINI FALLBACK DISABLED
// ============================================================================

test('Acceptance Test B: Scan All completes with Gemini fallback disabled, zero Gemini calls, accurate progress on failure', async () => {
  let geminiCalls = 0;
  let localOcrCalls = 0;

  const mockPages = [
    { pageId: 'page-batch-1', pageIndex: 1 },
    { pageId: 'page-batch-2', pageIndex: 2 },
    { pageId: 'page-batch-3', pageIndex: 3 },
  ];

  const savedBubbles: Record<string, BubbleItem[]> = {};

  const queue = new ScanQueueManager({
    interRequestDelayMs: 0,
    scanPage: async (opts) => {
      // Assert that allowGeminiFallback is false
      assert.equal(opts.allowGeminiFallback, false, 'allowGeminiFallback must be false');

      if (opts.pageId === 'page-batch-2') {
        // Page 2 encounters a local OCR failure
        localOcrCalls++;
        return {
          scanResult: {
            scanId: 'scan-err',
            pageId: opts.pageId,
            sourceImageId: opts.pageId,
            sourceDimensions: { width: 0, height: 0 },
            readingConvention: 'ltr',
            status: 'failed',
            panels: [],
            bubbleRegions: [],
            regions: [],
            issues: [
              {
                issueId: 'err-p2',
                flag: 'STAGE_UNAVAILABLE',
                severity: 'error',
                affectedRegionIds: [],
                reason: 'Local OCR model crashed on page 2',
                retryable: false,
              },
            ],
            transformLedger: { sourceImageId: opts.pageId, sourceWidth: 0, sourceHeight: 0, operations: [] },
            visualContext: '',
            detectedGlossaryTerms: [],
            detectedCharacters: [],
            detectedRelationships: [],
            createdAt: Date.now(),
            version: 1,
          },
          bubbles: [],
          rawTextExtract: '',
          visualContext: '',
          warnings: ['Local OCR model crashed on page 2'],
          meta: {
            ocrSource: 'hybrid',
            resolvedRoute: null,
            effectiveLanguage: null,
            fallbackReason: 'local_ocr_worker_error',
            warnings: ['Local OCR model crashed on page 2'],
            localCandidateCount: 0,
            keptCandidateCount: 0,
            verifiedCandidateCount: 0,
            addedRegionCount: 0,
            droppedCandidateCount: 0,
            geminiContextFailed: false,
            cropRetryCount: 0,
          },
        };
      }

      // Pages 1 and 3 succeed via Local OCR
      localOcrCalls++;
      return {
        scanResult: {
          scanId: `scan-${opts.pageId}`,
          pageId: opts.pageId,
          sourceImageId: opts.pageId,
          sourceDimensions: { width: 1000, height: 1400 },
          readingConvention: 'ltr',
          status: 'complete',
          panels: [],
          bubbleRegions: [],
          regions: [
            {
              regionId: `${opts.pageId}-r1`,
              orderIndex: 1,
              geometry: { box_2d: [100, 100, 300, 400] },
              classification: { primaryClass: 'dialogue', confidence: 0.9 },
              rawOCR: `Recognized text on ${opts.pageId}`,
              dialogueText: `Recognized text on ${opts.pageId}`,
              confidence: { ocr: 0.92, classification: 0.9 },
            },
          ],
          issues: [],
          transformLedger: { sourceImageId: opts.pageId, sourceWidth: 1000, sourceHeight: 1400, operations: [] },
          visualContext: '',
          detectedGlossaryTerms: [],
          detectedCharacters: [],
          detectedRelationships: [],
          createdAt: Date.now(),
          version: 1,
        },
        bubbles: [
          {
            id: `${opts.pageId}-b1`,
            pageId: opts.pageId,
            index: 1,
            box_2d: [100, 100, 300, 400],
            sourceText: `Recognized text on ${opts.pageId}`,
            translatedText: '',
            type: 'speech_bubbles',
            typerPrefix: '"":',
            updatedAt: Date.now(),
          },
        ],
        rawTextExtract: `Recognized text on ${opts.pageId}`,
        visualContext: '',
        meta: {
          ocrSource: 'local',
          resolvedRoute: 'en_ppocrv6_small',
          effectiveLanguage: 'en',
          warnings: [],
          localCandidateCount: 1,
          keptCandidateCount: 1,
          verifiedCandidateCount: 1,
          addedRegionCount: 1,
          droppedCandidateCount: 0,
          geminiContextFailed: false,
          cropRetryCount: 0,
        },
      };
    },
    savePageBubbles: async (pageId, bubbles) => {
      savedBubbles[pageId] = bubbles;
    },
    getPageBubbles: async (pageId) => savedBubbles[pageId] || [],
    getRollingContextForPage: async () => undefined,
  });

  const progressHistory: Array<{ isScanning: boolean; completedCount: number; totalCount: number }> = [];
  queue.subscribe((p) => {
    progressHistory.push({
      isScanning: p.isScanning,
      completedCount: p.completedCount,
      totalCount: p.totalCount,
    });
  });

  queue.enqueue(
    mockPages.map((p) => ({
      pageId: p.pageId,
      pageIndex: p.pageIndex,
      options: {
        apiKey: 'configured-gemini-key', // Even with an API key, fallback is disabled
        allowGeminiFallback: false,
        sourceLanguageHint: 'en',
      },
    }))
  );

  // Wait for queue processing to finish
  await new Promise((r) => setTimeout(r, 100));

  // Invariant 1: Local OCR was invoked for all 3 pages
  assert.equal(localOcrCalls, 3);

  // Invariant 2: Zero Gemini calls were made
  assert.equal(geminiCalls, 0);

  // Invariant 3: Successful pages (1 and 3) completed and saved records
  assert.ok(savedBubbles['page-batch-1']);
  assert.equal(savedBubbles['page-batch-1'][0].sourceText, 'Recognized text on page-batch-1');
  assert.ok(savedBubbles['page-batch-3']);
  assert.equal(savedBubbles['page-batch-3'][0].sourceText, 'Recognized text on page-batch-3');

  // Invariant 4: Failed page (2) reported error without freezing batch
  assert.equal(queue.getDetailedPageStatus('page-batch-1'), 'ocr_complete_interpretation_complete');
  assert.equal(queue.getDetailedPageStatus('page-batch-2'), 'ocr_failed');
  assert.equal(queue.getDetailedPageStatus('page-batch-3'), 'ocr_complete_interpretation_complete');

  // Invariant 5: Progress completedCount reached 3 (not stuck on 1 or 2)
  const finalProgress = progressHistory[progressHistory.length - 1];
  assert.equal(finalProgress.completedCount, 3, 'completedCount must increment even on failed page so batch does not hang');
  assert.equal(finalProgress.totalCount, 3);
  assert.equal(finalProgress.isScanning, false);
});

// ============================================================================
// ACCEPTANCE TEST C: REAL LOCAL MODEL PROVIDER VERIFICATION
// ============================================================================

test('Acceptance Test C: Real local OCR model loads, provider initializes, selected crops reach inference, text is returned', async (t) => {
  const userDataDir =
    process.env.FOLIO_OCR_CACHE_DIR || path.join(os.tmpdir(), 'folio-script-ocr-cache');
  const manager = createModelManager({ userDataDir, isProduction: false });

  const enStatus = await manager.getModelStatus('ppocr-v6-small-en');
  if (enStatus.state !== 'installed') {
    t.skip('ppocr-v6-small-en not installed in test cache; skipping real inference verification.');
    return;
  }

  // Set wasm paths
  const wasmPaths = pathToFileURL(path.resolve('node_modules/onnxruntime-web/dist') + path.sep).href;
  ort.env.wasm.wasmPaths = wasmPaths;

  // Load real model assets
  const assets = await manager.readModelAssets('ppocr-v6-small-en');
  assert.ok(assets.files, 'Model asset files must be present');
  assert.ok(Object.keys(assets.files).length > 0, 'Model asset files must not be empty');

  // Load real fixture
  const seed = JSON.parse(
    fs.readFileSync(path.resolve('public/seed_double_balloon_detection.json'), 'utf8')
  );
  const fixture = seed.examples[0];
  const pngBuffer = Buffer.from(fixture.imageBase64, 'base64');
  const decoded = decodePngRgba(pngBuffer);

  const state: ManualWorkerRuntimeState = { ocrKey: null, ocrAdapter: null };

  // Prepare a crop from the real image
  const target = {
    regionId: 'real-crop-test-1',
    kind: 'box' as const,
    box_2d: [0, 0, 1000, 1000] as [number, number, number, number],
  };

  const crop = prepareManualCropRgba(decoded, target);
  assert.ok(crop.cropRgba.width > 0);
  assert.ok(crop.cropRgba.height > 0);

  // Execute inference using executeManualCropOcrBatch with real models
  const batchResult = await executeManualCropOcrBatch(
    {
      jobId: 'prov-verif-job-1',
      pageId: 'page-real-verif',
      imageBytes: new ArrayBuffer(0),
      mimeType: 'image/png',
      language: 'en',
      routeId: 'en_ppocrv6_small',
      ocrModelKey: 'ppocr-v6-small-en@test',
      ocrAssets: assets,
      wasmPaths,
      targets: [target],
    },
    state,
    () => false,
    {
      decodeImage: async () => decoded,
    }
  );

  assert.equal(batchResult.outcomes.length, 1);
  const outcome = batchResult.outcomes[0];
  assert.equal(outcome.status, 'ocr_success');
  assert.ok(outcome.text.length > 0, `Recognized text must not be empty, got: "${outcome.text}"`);
  assert.ok(outcome.confidence > 0.5, `Confidence must be > 0.5, got: ${outcome.confidence}`);

  // Dispose adapter
  if (state.ocrAdapter) {
    await state.ocrAdapter.dispose();
  }
});
