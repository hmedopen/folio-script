import test from 'node:test';
import assert from 'node:assert/strict';
import { indexedDB } from 'fake-indexeddb';
import { scanPageWithGemini } from '../../lib/geminiScan.ts';
import {
  savePageBlob,
  resetDatabaseConnection,
} from '../../services/db.ts';
import type { PageDomainState, ScanRunRecord } from '../../types/domain/index.ts';
import type { LocalOcrScanResult } from '../../types/localOcr.ts';

(globalThis as any).indexedDB = indexedDB;

function createDummyPngBlob(): Blob {
  // Minimal valid 1x1 PNG
  const pngBytes = new Uint8Array([
    137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1,
    8, 6, 0, 0, 0, 31, 21, 196, 137, 0, 0, 0, 10, 73, 68, 65, 84, 120, 156, 99, 0, 1, 0,
    0, 5, 0, 1, 13, 10, 45, 180, 0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130,
  ]);
  return new Blob([pngBytes], { type: 'image/png' });
}

test('F-02 & F-04: Live scan creates canonical domain state, persists running and completed scan evidence', async () => {
  resetDatabaseConnection();

  const pageId = 'live-scan-page-test-1';
  await savePageBlob(pageId, createDummyPngBlob());

  const persistedRuns: ScanRunRecord[] = [];
  let savedDomainState: PageDomainState | null = null;

  // Mock hybrid scan outcome simulating full local OCR execution with:
  // 1. One physical balloon containing TWO independent dialogue regions
  // 2. One borderless text region (no physical balloon)
  // 3. One empty balloon container (no text inside)
  // 4. One text region with Ruby (furigana) annotation
  const mockBubbleRegions = [
    {
      bubbleId: 'cont-shared-balloon',
      geometry: {
        coordinateSpace: 'normalized_1000' as const,
        box_2d: [100, 100, 400, 400] as [number, number, number, number],
        pixelBox: [160, 100, 640, 400] as [number, number, number, number],
        pixelPolygon: [
          [100, 160],
          [400, 160],
          [400, 640],
          [100, 640],
        ] as Array<[number, number]>,
      },
      confidence: 0.98,
      classLabel: 'speech_bubbles' as const,
    },
    {
      bubbleId: 'cont-empty-balloon',
      geometry: {
        coordinateSpace: 'normalized_1000' as const,
        box_2d: [700, 700, 900, 900] as [number, number, number, number],
        pixelBox: [1120, 700, 1440, 900] as [number, number, number, number],
        pixelPolygon: [
          [700, 1120],
          [900, 1120],
          [900, 1440],
          [700, 1440],
        ] as Array<[number, number]>,
      },
      confidence: 0.95,
      classLabel: 'thought_bubbles' as const,
    },
  ];

  const mockTextRegions = [
    // Dialogue 1 inside cont-shared-balloon
    {
      regionId: 'reg-shared-1',
      geometry: {
        coordinateSpace: 'normalized_1000' as const,
        box_2d: [120, 120, 220, 380] as [number, number, number, number],
        pixelBox: [192, 120, 352, 380] as [number, number, number, number],
        pixelPolygon: [
          [120, 192],
          [380, 192],
          [380, 352],
          [120, 352],
        ] as Array<[number, number]>,
      },
      confidence: { ocr: 0.95, regionDetection: 0.98 },
      rawOCR: 'First independent sentence.',
      classification: { primaryClass: 'dialogue' as const, confidence: 0.98 },
      order: { sequenceIndex: 1, confidence: 0.95 },
      associations: { bubbleId: 'cont-shared-balloon' },
      flags: [],
      lineSegments: [
        {
          lineId: 'line-shared-1',
          text: 'First independent sentence.',
          recognitionConfidence: 0.95,
          isVertical: false,
          geometry: {
            box_2d: [120, 120, 220, 380] as [number, number, number, number],
            pixelBox: [192, 120, 352, 380] as [number, number, number, number],
          },
        },
      ],
    },
    // Dialogue 2 inside cont-shared-balloon
    {
      regionId: 'reg-shared-2',
      geometry: {
        coordinateSpace: 'normalized_1000' as const,
        box_2d: [240, 120, 360, 380] as [number, number, number, number],
        pixelBox: [384, 120, 576, 380] as [number, number, number, number],
        pixelPolygon: [
          [120, 384],
          [380, 384],
          [380, 576],
          [120, 576],
        ] as Array<[number, number]>,
      },
      confidence: { ocr: 0.92, regionDetection: 0.97 },
      rawOCR: 'Second independent sentence in same balloon.',
      classification: { primaryClass: 'dialogue' as const, confidence: 0.97 },
      order: { sequenceIndex: 2, confidence: 0.95 },
      associations: { bubbleId: 'cont-shared-balloon' },
      flags: [],
      lineSegments: [
        {
          lineId: 'line-shared-2',
          text: 'Second independent sentence in same balloon.',
          recognitionConfidence: 0.92,
          isVertical: false,
          geometry: {
            box_2d: [240, 120, 360, 380] as [number, number, number, number],
            pixelBox: [384, 120, 576, 380] as [number, number, number, number],
          },
        },
      ],
    },
    // Borderless text (no container)
    {
      regionId: 'reg-borderless',
      geometry: {
        coordinateSpace: 'normalized_1000' as const,
        box_2d: [500, 50, 600, 300] as [number, number, number, number],
        pixelBox: [800, 50, 960, 300] as [number, number, number, number],
        pixelPolygon: [
          [50, 800],
          [300, 800],
          [300, 960],
          [50, 960],
        ] as Array<[number, number]>,
      },
      confidence: { ocr: 0.91, regionDetection: 0.90 },
      rawOCR: 'Floating narration outside any balloon.',
      classification: { primaryClass: 'caption' as const, confidence: 0.90 },
      order: { sequenceIndex: 3, confidence: 0.90 },
      associations: {}, // No bubbleId!
      flags: [],
      lineSegments: [
        {
          lineId: 'line-borderless-1',
          text: 'Floating narration outside any balloon.',
          recognitionConfidence: 0.91,
          isVertical: false,
          geometry: {
            box_2d: [500, 50, 600, 300] as [number, number, number, number],
            pixelBox: [800, 50, 960, 300] as [number, number, number, number],
          },
        },
      ],
    },
    // Ruby (furigana) annotation attached to parent line
    {
      regionId: 'reg-ruby-text',
      geometry: {
        coordinateSpace: 'normalized_1000' as const,
        box_2d: [600, 500, 700, 800] as [number, number, number, number],
        pixelBox: [960, 500, 1120, 800] as [number, number, number, number],
        pixelPolygon: [
          [500, 960],
          [800, 960],
          [800, 1120],
          [500, 1120],
        ] as Array<[number, number]>,
      },
      confidence: { ocr: 0.96, regionDetection: 0.95 },
      rawOCR: '漢字',
      classification: { primaryClass: 'dialogue' as const, confidence: 0.95 },
      order: { sequenceIndex: 4, confidence: 0.92 },
      associations: {},
      flags: [],
      lineSegments: [
        {
          lineId: 'line-cjk-base',
          text: '漢字',
          recognitionConfidence: 0.96,
          isVertical: false,
          geometry: {
            box_2d: [600, 500, 700, 800] as [number, number, number, number],
            pixelBox: [960, 500, 1120, 800] as [number, number, number, number],
          },
        },
        {
          lineId: 'line-cjk-ruby',
          text: 'かんじ',
          recognitionConfidence: 0.94,
          isVertical: false,
          isRuby: true,
          parentLineId: 'line-cjk-base',
          geometry: {
            box_2d: [580, 500, 600, 800] as [number, number, number, number],
            pixelBox: [928, 500, 960, 800] as [number, number, number, number],
          },
        } as any,
      ],
    },
  ];

  const mockLocalResult: LocalOcrScanResult = {
    scanId: 'mock-local-scan-1',
    pageId,
    status: 'complete',
    sourceDimensions: { width: 1000, height: 1600 },
    readingConvention: 'rtl',
    languageHint: 'auto',
    resolvedRoute: 'ja_manga_mixed',
    bubbleRegions: mockBubbleRegions as any,
    textRegions: mockTextRegions as any,
    lineSegments: mockTextRegions.flatMap((r) => r.lineSegments) as any,
    tiles: [
      {
        tileId: 'tile-0-0',
        row: 0,
        col: 0,
        originX: 0,
        originY: 0,
        cropWidth: 1000,
        cropHeight: 1600,
        inputWidth: 640,
        inputHeight: 640,
        scaleX: 1,
        scaleY: 1,
        padRight: 0,
        padBottom: 0,
        touchesPageLeft: true,
        touchesPageTop: true,
        touchesPageRight: true,
        touchesPageBottom: true,
      },
    ],
    rawDetections: [
      {
        detectionId: 'raw-det-1',
        tileId: 'tile-0-0',
        classLabel: 'text_bubble',
        pixelBox: [160, 100, 640, 400],
        rawScore: 0.98,
        touchesTileInnerLeft: false,
        touchesTileInnerTop: false,
        touchesTileInnerRight: false,
        touchesTileInnerBottom: false,
      },
      {
        detectionId: 'raw-det-2',
        tileId: 'tile-0-0',
        classLabel: 'thought_bubbles',
        pixelBox: [1120, 700, 1440, 900],
        rawScore: 0.95,
        touchesTileInnerLeft: false,
        touchesTileInnerTop: false,
        touchesTileInnerRight: false,
        touchesTileInnerBottom: false,
      },
    ],
    modelsUsed: {
      detectorModel: { modelId: 'comic_detector_v1', revision: 'r1', provider: 'wasm' },
      recModel: { modelId: 'paddle_rec_ja', revision: 'r1', provider: 'wasm' },
    },
    timings: { totalMs: 120, tilingMs: 5, detectionMs: 50, cropMs: 15, recognitionMs: 40, groupingMs: 10 },
    partialFailures: [],
    warnings: [],
    toCanonicalPageScanResult: () => ({} as any),
  };

  const hybridDeps = {
    getPageBlob: async () => createDummyPngBlob(),
    extractImageDimensions: async () => ({ width: 1000, height: 1600 }),
    getModelProvider: () => ({
      getStatus: async (modelId: string) => ({
        modelId,
        state: 'installed' as const,
        policy: { activationPermitted: true },
      }),
    } as any),
    runLocalOcr: async () => mockLocalResult,
    runGeminiContextPass: async () => ({
      pageContext: 'Scene context',
      readingOrder: ['reg-shared-1', 'reg-shared-2', 'reg-borderless', 'reg-ruby-text'],
      regionDecisions: [
        { regionId: 'reg-shared-1', action: 'keep' as const, primaryClass: 'dialogue' as const },
        { regionId: 'reg-shared-2', action: 'keep' as const, primaryClass: 'dialogue' as const },
        { regionId: 'reg-borderless', action: 'keep' as const, primaryClass: 'caption' as const },
        { regionId: 'reg-ruby-text', action: 'keep' as const, primaryClass: 'dialogue' as const },
      ],
      panels: [],
      additionalRegions: [],
      detectedCharacters: [],
      detectedGlossaryTerms: [],
      detectedRelationships: [],
    }),
  };

  const scanDeps = {
    batchTranslateBubbles: async () => ({
      success: true,
      translationMap: new Map(),
    }),
    saveScanRunRecord: async (rec: ScanRunRecord) => {
      persistedRuns.push(rec);
    },
    savePageDomainState: async (st: PageDomainState) => {
      savedDomainState = st;
    },
  };

  const result = await scanPageWithGemini({
    pageId,
    apiKey: 'mock-key',
    selectedModel: 'gemini-3.8-flash',
    eloquenceLevel: 'standard',
    includeSFX: true,
    hybridDeps,
    scanDeps,
  });

  assert.ok(result);
  assert.equal(result.bubbles.length, 4, 'Four bubble views created');

  // Verify F-04: Running scan record was persisted before inference begins!
  assert.ok(persistedRuns.length >= 2, 'At least 2 scan run persistence calls (running + terminal)');
  assert.equal(persistedRuns[0].status, 'running', 'First persisted record must have status running');
  assert.equal(persistedRuns[0].startedAt > 0, true);

  // Verify terminal scan record
  const terminalRun = persistedRuns[persistedRuns.length - 1];
  assert.equal(terminalRun.status, 'completed', 'Terminal record status must be completed');
  assert.ok(terminalRun.completedAt && terminalRun.completedAt >= terminalRun.startedAt);
  assert.equal(terminalRun.tiles.length, 1, 'Tile transforms recorded');
  assert.equal(terminalRun.models.detector.provider, 'wasm');
  assert.equal(terminalRun.models.ocr.provider, 'wasm');
  assert.ok(Object.keys(terminalRun.detectorObservations).length >= 2, 'Detector observations recorded');
  assert.ok(Object.keys(terminalRun.ocrObservations).length >= 4, 'OCR line observations recorded');

  // Verify F-02: Canonical domain state was constructed via buildCanonicalDomainStateFromOcr
  assert.ok(savedDomainState, 'Canonical PageDomainState must be persisted');
  const domain = savedDomainState as PageDomainState;
  assert.equal(domain.pageId, pageId);
  assert.equal(domain.activeScanRunId, terminalRun.scanRunId, 'Active scan run ID must match terminal run');

  // Explicit test 1: Two independent dialogue records inside one physical balloon
  assert.ok(domain.containers['cont-shared-balloon'], 'Shared container exists');
  const dial1 = Object.values(domain.contentRecords).find((cr) =>
    cr.contentId.includes('reg-shared-1') || cr.sourceText.includes('First independent sentence')
  );
  const dial2 = Object.values(domain.contentRecords).find((cr) =>
    cr.contentId.includes('reg-shared-2') || cr.sourceText.includes('Second independent sentence')
  );
  assert.ok(dial1, 'First dialogue content record exists');
  assert.ok(dial2, 'Second dialogue content record exists');
  const reg1 = Object.values(domain.textRegions).find((tr) => tr.regionId.includes('reg-shared-1'))!;
  const reg2 = Object.values(domain.textRegions).find((tr) => tr.regionId.includes('reg-shared-2'))!;
  assert.ok(reg1, 'reg1 exists');
  assert.ok(reg2, 'reg2 exists');
  assert.equal(reg1.containerId, 'cont-shared-balloon');
  assert.equal(reg2.containerId, 'cont-shared-balloon');
  assert.notEqual(dial1.contentId, dial2.contentId, 'Two independent content records inside one balloon');

  // Explicit test 2: Borderless text with no physical container
  const borderlessRegion = Object.values(domain.textRegions).find((tr) => tr.regionId.includes('reg-borderless'))!;
  assert.ok(borderlessRegion);
  assert.equal(borderlessRegion.containerId, null, 'Borderless text must have null containerId');
  assert.equal(borderlessRegion.containerAssociation, 'borderless');

  // Explicit test 3: A physical container with no recognized text (empty container)
  const emptyContainer = domain.containers['cont-empty-balloon'];
  assert.ok(emptyContainer, 'Empty container exists');
  assert.equal(emptyContainer.state, 'empty', 'Container with no text must have state empty');

  // Explicit test 5: Ruby/furigana annotations that do not pollute the main text
  const rubyRegion = Object.values(domain.textRegions).find((tr) => tr.regionId.includes('reg-ruby-text'))!;
  assert.ok(rubyRegion);
  assert.equal(rubyRegion.rubyAnnotations.length, 1);
  assert.equal(rubyRegion.rubyAnnotations[0].rubyText, 'かんじ');
  // Main line observation IDs must only contain base line, not ruby line
  assert.deepEqual(rubyRegion.lineObservationIds, ['line-cjk-base']);
  const rubyContent = Object.values(domain.contentRecords).find((cr) =>
    cr.contentId.includes('reg-ruby-text') || cr.sourceText === '漢字'
  )!;
  assert.ok(rubyContent);
  assert.equal(rubyContent.sourceText, '漢字', 'Canonical text must strictly exclude ruby');

  // Explicit test 6: Correct geometry in original-pixel coordinate system
  assert.deepEqual(reg1.geometry.pixelPolygon, [
    [120, 192],
    [380, 192],
    [380, 352],
    [120, 352],
  ]);

  resetDatabaseConnection();
});

test('F-04: Cancellation records accurate cancelled status and preserves partial evidence', async () => {
  resetDatabaseConnection();

  const pageId = 'cancelled-scan-page';
  await savePageBlob(pageId, createDummyPngBlob());

  const persistedRuns: ScanRunRecord[] = [];
  const abortCtrl = new AbortController();

  const hybridDeps = {
    getPageBlob: async () => createDummyPngBlob(),
    extractImageDimensions: async () => ({ width: 1000, height: 1600 }),
    getModelProvider: () => ({
      getStatus: async (modelId: string) => ({
        modelId,
        state: 'installed' as const,
        policy: { activationPermitted: true },
      }),
    } as any),
    runLocalOcr: async () => {
      // Abort during local OCR
      abortCtrl.abort();
      const err = new Error('Scan aborted');
      err.name = 'AbortError';
      throw err;
    },
  };

  const scanDeps = {
    saveScanRunRecord: async (rec: ScanRunRecord) => {
      persistedRuns.push(rec);
    },
  };

  await assert.rejects(
    async () => {
      await scanPageWithGemini({
        pageId,
        apiKey: 'key',
        selectedModel: 'gemini-3.8-flash',
        eloquenceLevel: 'standard',
        includeSFX: false,
        signal: abortCtrl.signal,
        hybridDeps,
        scanDeps,
      });
    },
    { name: 'AbortError' }
  );

  assert.ok(persistedRuns.length >= 2, 'Running and cancelled records persisted');
  assert.equal(persistedRuns[0].status, 'running');
  const finalRun = persistedRuns[persistedRuns.length - 1];
  assert.equal(finalRun.status, 'cancelled', 'Terminal status must be cancelled');
  assert.ok(finalRun.completedAt);

  resetDatabaseConnection();
});
