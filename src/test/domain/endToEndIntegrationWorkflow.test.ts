import test from 'node:test';
import assert from 'node:assert/strict';
import { indexedDB } from 'fake-indexeddb';
import {
  getDatabase,
  resetDatabaseConnection,
  savePageBlob,
  getPageDomainState,
  getScanRunRecordsForPage,
  STORE_PAGE_DOMAIN_STATES,
  STORE_SCAN_RUN_RECORDS,
  STORE_MIGRATION_JOURNAL,
} from '../../services/db.ts';
import { runIdempotentV9Migration } from '../../lib/domain/v9Migration.ts';
import { scanPageWithGemini } from '../../lib/geminiScan.ts';
import { useWorkbenchStore } from '../../store/workbenchStore.ts';
import { compileTypeRScript } from '../../lib/compileTypeR.ts';
import type { LocalOcrScanResult } from '../../types/localOcr.ts';

(globalThis as any).indexedDB = indexedDB;

function createDummyPngBlob(): Blob {
  // Minimal valid 1x1 PNG bytes
  const pngBytes = new Uint8Array([
    137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1,
    8, 6, 0, 0, 0, 31, 21, 196, 137, 0, 0, 0, 10, 73, 68, 65, 84, 120, 156, 99, 0, 1, 0,
    0, 5, 0, 1, 13, 10, 45, 180, 0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130,
  ]);
  return new Blob([pngBytes], { type: 'image/png' });
}

test('SECTION 3 INTEGRATION: End-to-end trace through complete 11-step application workflow', async () => {
  resetDatabaseConnection();

  const chapterId = 'ch-manhwa-e2e';
  const pageId = 'page-manhwa-long-1';

  // --------------------------------------------------------------------------
  // STEP 1: Open an existing v8 database fixture and upgrade it to v9
  // --------------------------------------------------------------------------
  const rawDbName = 'dragonfly44_db';
  await new Promise<void>((resolve, reject) => {
    const req = indexedDB.deleteDatabase(rawDbName);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });

  // Create genuine v8 database fixture (legacy stores only, no v9 domain stores)
  await new Promise<void>((resolve, reject) => {
    const openReq = indexedDB.open(rawDbName, 8);
    openReq.onupgradeneeded = () => {
      const db = openReq.result;
      db.createObjectStore('page_blobs');
      db.createObjectStore('page_bubbles');
      db.createObjectStore('page_scans');
      db.createObjectStore('project_lore');
      db.createObjectStore('chapter_intelligence');
      db.createObjectStore('projects', { keyPath: 'id' });
      db.createObjectStore('chapters', { keyPath: 'id' });
      db.createObjectStore('pages', { keyPath: 'id' });
      db.createObjectStore('chapter_snapshots', { keyPath: 'id' });
      db.createObjectStore('migration_journal', { keyPath: 'key' });
      db.createObjectStore('review_findings', { keyPath: 'findingId' });
      db.createObjectStore('review_snapshots', { keyPath: 'snapshotId' });
      db.createObjectStore('review_audit', { keyPath: 'auditId' });
      db.createObjectStore('knowledge_records', { keyPath: 'record_id' });
      db.createObjectStore('knowledge_revisions', { keyPath: 'revision_id' });
      db.createObjectStore('knowledge_candidates', { keyPath: 'candidate_id' });
      db.createObjectStore('knowledge_audit', { keyPath: 'event_id' });
      db.createObjectStore('knowledge_quarantine', { keyPath: 'quarantine_id' });
      db.createObjectStore('knowledge_conflicts', { keyPath: 'conflict_id' });
      db.createObjectStore('knowledge_idempotency', { keyPath: 'key' });
      db.createObjectStore('memory_settings', { keyPath: 'project_id' });
      db.createObjectStore('training_reference_sets', { keyPath: 'id' });
      db.createObjectStore('training_blobs');
    };
    openReq.onsuccess = () => {
      const db = openReq.result;
      const tx = db.transaction(['page_bubbles', 'page_scans'], 'readwrite');
      tx.objectStore('page_bubbles').put([
        {
          id: 'legacy-b1',
          pageId,
          polygon: [[100, 100], [400, 100], [400, 300], [100, 300]],
          box_2d: [33, 100, 100, 400],
          sourceText: 'Legacy dialogue before migration',
          translatedText: 'حوار قديم قبل الترحيل',
          type: 'dialogue',
          typerPrefix: '"":',
          index: 1,
          isManuallyEdited: true,
          updatedAt: 1000,
        },
      ], `page-bubbles:${pageId}`);
      tx.objectStore('page_scans').put({
        scanId: 'legacy-scan-1',
        pageId,
        status: 'complete',
        regions: [],
        panels: [],
        bubbleRegions: [],
        sourceDimensions: { width: 1000, height: 3000 },
      }, `page-scan:${pageId}`);
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
    };
    openReq.onerror = () => reject(openReq.error);
  });

  // Reopen via application path (triggers v9 upgrade and verifies all stores)
  const upgradedDb = await getDatabase();
  assert.equal(upgradedDb.version, 9, 'Database must be upgraded to version 9');
  assert.ok(upgradedDb.objectStoreNames.contains(STORE_PAGE_DOMAIN_STATES), 'page_domain_states store exists');
  assert.ok(upgradedDb.objectStoreNames.contains(STORE_SCAN_RUN_RECORDS), 'scan_run_records store exists');
  assert.ok(upgradedDb.objectStoreNames.contains(STORE_MIGRATION_JOURNAL), 'migration_journal store exists');

  // --------------------------------------------------------------------------
  // STEP 2: Load legacy chapter/page data and run durable v9 migration
  // --------------------------------------------------------------------------
  await savePageBlob(pageId, createDummyPngBlob());

  // Run durable idempotent v9 migration
  const migrationResult = await runIdempotentV9Migration(upgradedDb);
  assert.equal(migrationResult.status === 'completed' || migrationResult.status === 'in_progress', true);

  const migratedDomain = await getPageDomainState(pageId);
  assert.ok(migratedDomain, 'Migrated domain state must exist');
  assert.equal(migratedDomain.pageId, pageId);

  // --------------------------------------------------------------------------
  // STEP 3: Run a real scan through the application's normal scanning path
  // Long Manhwa page (1000 x 3000) with:
  // - 1 Physical balloon with 2 independent dialogue records
  // - 1 Borderless text region
  // - 1 Empty thought balloon
  // - 1 CJK Ruby text region
  // --------------------------------------------------------------------------
  const mockBubbleRegions = [
    {
      bubbleId: 'cont-shared-balloon',
      geometry: {
        coordinateSpace: 'normalized_1000' as const,
        box_2d: [100, 100, 300, 500] as [number, number, number, number],
        pixelBox: [300, 100, 900, 500] as [number, number, number, number],
        pixelPolygon: [
          [100, 300],
          [500, 300],
          [500, 900],
          [100, 900],
        ] as Array<[number, number]>,
      },
      confidence: 0.98,
      classLabel: 'speech_bubbles' as const,
    },
    {
      bubbleId: 'cont-empty-balloon',
      geometry: {
        coordinateSpace: 'normalized_1000' as const,
        box_2d: [700, 600, 850, 900] as [number, number, number, number],
        pixelBox: [2100, 600, 2550, 900] as [number, number, number, number],
        pixelPolygon: [
          [600, 2100],
          [900, 2100],
          [900, 2550],
          [600, 2550],
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
        box_2d: [110, 120, 190, 480] as [number, number, number, number],
        pixelBox: [330, 120, 570, 480] as [number, number, number, number],
        pixelPolygon: [
          [120, 330],
          [480, 330],
          [480, 570],
          [120, 570],
        ] as Array<[number, number]>,
      },
      confidence: { ocr: 0.95, regionDetection: 0.98 },
      rawOCR: 'First sentence inside balloon.',
      classification: { primaryClass: 'dialogue' as const, confidence: 0.98 },
      order: { sequenceIndex: 1, confidence: 0.95 },
      associations: { bubbleId: 'cont-shared-balloon' },
      flags: [],
      lineSegments: [
        {
          lineId: 'line-shared-1',
          text: 'First sentence inside balloon.',
          recognitionConfidence: 0.95,
          isVertical: false,
          geometry: {
            box_2d: [110, 120, 190, 480] as [number, number, number, number],
            pixelBox: [330, 120, 570, 480] as [number, number, number, number],
          },
        },
      ],
    },
    // Dialogue 2 inside cont-shared-balloon
    {
      regionId: 'reg-shared-2',
      geometry: {
        coordinateSpace: 'normalized_1000' as const,
        box_2d: [210, 120, 290, 480] as [number, number, number, number],
        pixelBox: [630, 120, 870, 480] as [number, number, number, number],
        pixelPolygon: [
          [120, 630],
          [480, 630],
          [480, 870],
          [120, 870],
        ] as Array<[number, number]>,
      },
      confidence: { ocr: 0.93, regionDetection: 0.97 },
      rawOCR: 'Second sentence in same balloon.',
      classification: { primaryClass: 'dialogue' as const, confidence: 0.97 },
      order: { sequenceIndex: 2, confidence: 0.95 },
      associations: { bubbleId: 'cont-shared-balloon' },
      flags: [],
      lineSegments: [
        {
          lineId: 'line-shared-2',
          text: 'Second sentence in same balloon.',
          recognitionConfidence: 0.93,
          isVertical: false,
          geometry: {
            box_2d: [210, 120, 290, 480] as [number, number, number, number],
            pixelBox: [630, 120, 870, 480] as [number, number, number, number],
          },
        },
      ],
    },
    // Borderless text (no container)
    {
      regionId: 'reg-borderless',
      geometry: {
        coordinateSpace: 'normalized_1000' as const,
        box_2d: [400, 50, 480, 400] as [number, number, number, number],
        pixelBox: [1200, 50, 1440, 400] as [number, number, number, number],
        pixelPolygon: [
          [50, 1200],
          [400, 1200],
          [400, 1440],
          [50, 1440],
        ] as Array<[number, number]>,
      },
      confidence: { ocr: 0.91, regionDetection: 0.90 },
      rawOCR: 'Deep narration outside any box.',
      classification: { primaryClass: 'caption' as const, confidence: 0.90 },
      order: { sequenceIndex: 3, confidence: 0.90 },
      associations: {},
      flags: [],
      lineSegments: [
        {
          lineId: 'line-borderless-1',
          text: 'Deep narration outside any box.',
          recognitionConfidence: 0.91,
          isVertical: false,
          geometry: {
            box_2d: [400, 50, 480, 400] as [number, number, number, number],
            pixelBox: [1200, 50, 1440, 400] as [number, number, number, number],
          },
        },
      ],
    },
    // Ruby / furigana text
    {
      regionId: 'reg-ruby-text',
      geometry: {
        coordinateSpace: 'normalized_1000' as const,
        box_2d: [550, 300, 650, 700] as [number, number, number, number],
        pixelBox: [1650, 300, 1950, 700] as [number, number, number, number],
        pixelPolygon: [
          [300, 1650],
          [700, 1650],
          [700, 1950],
          [300, 1950],
        ] as Array<[number, number]>,
      },
      confidence: { ocr: 0.96, regionDetection: 0.95 },
      rawOCR: '漫画',
      classification: { primaryClass: 'dialogue' as const, confidence: 0.95 },
      order: { sequenceIndex: 4, confidence: 0.92 },
      associations: {},
      flags: [],
      lineSegments: [
        {
          lineId: 'line-cjk-base',
          text: '漫画',
          recognitionConfidence: 0.96,
          isVertical: false,
          geometry: {
            box_2d: [550, 300, 650, 700] as [number, number, number, number],
            pixelBox: [1650, 300, 1950, 700] as [number, number, number, number],
          },
        },
        {
          lineId: 'line-cjk-ruby',
          text: 'まんが',
          recognitionConfidence: 0.94,
          isVertical: false,
          isRuby: true,
          parentLineId: 'line-cjk-base',
          geometry: {
            box_2d: [530, 300, 550, 700] as [number, number, number, number],
            pixelBox: [1590, 300, 1650, 700] as [number, number, number, number],
          },
        } as any,
      ],
    },
  ];

  const mockLocalResult: LocalOcrScanResult = {
    scanId: 'mock-manhwa-scan-1',
    pageId,
    status: 'complete',
    sourceDimensions: { width: 1000, height: 3000 },
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
        cropHeight: 3000,
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
        pixelBox: [300, 100, 900, 500],
        rawScore: 0.98,
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
    timings: { totalMs: 140, tilingMs: 5, detectionMs: 50, cropMs: 15, recognitionMs: 50, groupingMs: 20 },
    partialFailures: [],
    warnings: [],
    toCanonicalPageScanResult: () => ({} as any),
  };

  const hybridDeps = {
    getPageBlob: async () => createDummyPngBlob(),
    extractImageDimensions: async () => ({ width: 1000, height: 3000 }),
    getModelProvider: () => ({
      getStatus: async (modelId: string) => ({
        modelId,
        state: 'installed' as const,
        policy: { activationPermitted: true },
      }),
    } as any),
    runLocalOcr: async () => mockLocalResult,
    runGeminiContextPass: async () => ({
      pageContext: 'Long manhwa continuous scroll scene',
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
      translationMap: new Map([
        ['reg-shared-1', { rawText: 'الجملة الأولى داخل الفقاعة.', humanizedText: 'الجملة الأولى داخل الفقاعة.' }],
        ['reg-shared-2', { rawText: 'الجملة الثانية في نفس الفقاعة.', humanizedText: 'الجملة الثانية في نفس الفقاعة.' }],
        ['reg-borderless', { rawText: 'سرد عميق بدون صندوق.', humanizedText: 'سرد عميق بدون صندوق.' }],
        ['reg-ruby-text', { rawText: 'مانجا', humanizedText: 'مانجا' }],
      ]),
    }),
  };

  const liveScanResult = await scanPageWithGemini({
    pageId,
    chapterId,
    apiKey: 'test-key',
    selectedModel: 'gemini-3.8-flash',
    eloquenceLevel: 'standard',
    includeSFX: true,
    hybridDeps,
    scanDeps,
  });

  assert.ok(liveScanResult, 'Live scan result returned');
  assert.equal(liveScanResult.bubbles.length, 5, 'Five bubbles created from scan (1 legacy + 4 scanned)');

  // --------------------------------------------------------------------------
  // STEP 4: Verify persistence of canonical page state and scan evidence
  // --------------------------------------------------------------------------
  const persistedRuns = await getScanRunRecordsForPage(pageId);
  assert.ok(persistedRuns.length >= 1, 'At least one scan run record persisted in IDB');
  const completedRun = persistedRuns[persistedRuns.length - 1];
  assert.ok(completedRun, 'Completed scan run record persisted in IndexedDB');
  assert.equal(completedRun.status, 'completed', 'Latest run status is completed');
  assert.ok(Object.keys(completedRun.detectorObservations).length >= 1);
  assert.ok(Object.keys(completedRun.ocrObservations).length >= 4);

  const persistedDomain = await getPageDomainState(pageId);
  assert.ok(persistedDomain, 'PageDomainState persisted in IndexedDB');
  assert.equal(persistedDomain.pageId, pageId);
  assert.equal(persistedDomain.dimensions.height, 3000, 'Dimensions match long manhwa');
  assert.ok(persistedDomain.containers['cont-shared-balloon'], 'Shared physical container persisted');
  assert.ok(persistedDomain.containers['cont-empty-balloon'], 'Empty physical container persisted');

  // --------------------------------------------------------------------------
  // STEP 5: Load the result into the workspace store
  // --------------------------------------------------------------------------
  await useWorkbenchStore.getState().loadPageBubbles(pageId);

  const loadedBubbles = useWorkbenchStore.getState().bubblesByPage[pageId];
  assert.ok(loadedBubbles && loadedBubbles.length === 5, 'Workspace loaded 5 bubbles');
  const loadedDomain = useWorkbenchStore.getState().pageDomainStates[pageId];
  assert.ok(loadedDomain, 'Workspace store loaded rich canonical domain state');

  // --------------------------------------------------------------------------
  // STEP 6: Edit geometry and text
  // --------------------------------------------------------------------------
  const firstBubble = loadedBubbles.find((b) => b.id !== 'legacy-b1') || loadedBubbles[0];
  const manualTranslation = 'ترجمة يدوية مدققة ومعدلة';
  useWorkbenchStore.getState().updateBubble(pageId, firstBubble.id, {
    translatedText: manualTranslation,
    isManuallyEdited: true,
  });

  const editedDomainAfterText = useWorkbenchStore.getState().pageDomainStates[pageId];
  const matchingCr = Object.values(editedDomainAfterText.contentRecords).find(
    (c) => c.contentId === firstBubble.id || c.regionTargets.some((rt) => rt.regionId === firstBubble.id)
  );
  assert.ok(matchingCr);
  assert.equal(matchingCr.translatedText, manualTranslation, 'Domain content record updated with manual text');
  assert.equal(matchingCr.provenance?.translatedText?.source, 'user_manual', 'Provenance source is user_manual');

  // Edit polygon geometry
  const newPolygon: Array<[number, number]> = [
    [150, 350],
    [450, 350],
    [450, 550],
    [150, 550],
  ];
  useWorkbenchStore.getState().updateManualSelectionGeometry(pageId, firstBubble.id, {
    box_2d: [150, 350, 450, 550],
    polygon: newPolygon,
  });
  const editedDomainAfterGeo = useWorkbenchStore.getState().pageDomainStates[pageId];
  const matchingTr = Object.values(editedDomainAfterGeo.textRegions).find(
    (r) => r.regionId === firstBubble.id || matchingCr?.regionTargets.some((rt) => rt.regionId === r.regionId)
  );
  assert.ok(matchingTr);
  const expectedPixelPolygon: Array<[number, number]> = [
    [150, 1050],
    [450, 1050],
    [450, 1650],
    [150, 1650],
  ];
  assert.deepEqual(
    matchingTr.geometry.pixelPolygon,
    expectedPixelPolygon,
    'TextRegion geometry updated in domain state in original-pixel space'
  );

  // --------------------------------------------------------------------------
  // STEP 7: Split logical content
  // --------------------------------------------------------------------------
  const bubbleToSplit = loadedBubbles.find((b) => b.id !== 'legacy-b1' && b.id !== firstBubble.id) || loadedBubbles[1];
  const splitDomainBefore = useWorkbenchStore.getState().pageDomainStates[pageId];
  const splitCrBefore = Object.values(splitDomainBefore.contentRecords).find(
    (c) => c.contentId === bubbleToSplit.id || c.regionTargets.some((rt) => rt.regionId === bubbleToSplit.id)
  );
  assert.ok(splitCrBefore);
  useWorkbenchStore.getState().splitBubble(pageId, splitCrBefore.contentId, 5);

  const domainAfterSplit = useWorkbenchStore.getState().pageDomainStates[pageId];
  assert.equal(domainAfterSplit.readingSequence.length, splitDomainBefore.readingSequence.length + 1, 'Sequence grew after split');

  // --------------------------------------------------------------------------
  // STEP 8: Undo and redo those edits without losing domain information
  // --------------------------------------------------------------------------
  // Undo split
  useWorkbenchStore.getState().undoBubbleAction(pageId);
  const domainAfterUndo = useWorkbenchStore.getState().pageDomainStates[pageId];
  assert.equal(domainAfterUndo.readingSequence.length, splitDomainBefore.readingSequence.length, 'Split undone');
  assert.ok(domainAfterUndo.contentRecords[matchingCr.contentId], 'Original content record intact');
  assert.deepEqual(
    domainAfterUndo.textRegions[matchingTr.regionId].geometry.pixelPolygon,
    expectedPixelPolygon,
    'Manual geometry preserved across undo in original-pixel space'
  );

  // Redo split
  useWorkbenchStore.getState().redoBubbleAction(pageId);
  const domainAfterRedo = useWorkbenchStore.getState().pageDomainStates[pageId];
  assert.equal(domainAfterRedo.readingSequence.length, splitDomainBefore.readingSequence.length + 1, 'Split restored via redo');

  // Undo back to clean edited state before rescan
  useWorkbenchStore.getState().undoBubbleAction(pageId);

  // --------------------------------------------------------------------------
  // STEP 9: Rescan the page and preserve valid manual edits, translations, and review state
  // --------------------------------------------------------------------------
  // Allow store background persistence to settle
  await new Promise((r) => setTimeout(r, 20));

  const rescanResult = await scanPageWithGemini({
    pageId,
    chapterId,
    apiKey: 'test-key',
    selectedModel: 'gemini-3.8-flash',
    eloquenceLevel: 'standard',
    includeSFX: true,
    hybridDeps,
    scanDeps,
  });

  assert.ok(rescanResult, 'Rescan completed');
  // Load rescanned result
  await useWorkbenchStore.getState().loadPageBubbles(pageId);

  // --------------------------------------------------------------------------
  // STEP 10: Verify translation and review data remain intact
  // --------------------------------------------------------------------------
  const postRescanDomain = useWorkbenchStore.getState().pageDomainStates[pageId];
  const preservedCr = Object.values(postRescanDomain.contentRecords).find(
    (c) => c.contentId === matchingCr.contentId || c.regionTargets.some((rt) => rt.regionId === firstBubble.id)
  );
  assert.ok(preservedCr, 'Preserved content record exists after rescan');
  assert.equal(
    preservedCr.translatedText,
    manualTranslation,
    'Manual translation strictly preserved across rescan'
  );

  // --------------------------------------------------------------------------
  // STEP 11: Verify TypeR export receives the correct content and ordering
  // --------------------------------------------------------------------------
  const currentBubbles = useWorkbenchStore.getState().bubblesByPage[pageId] || [];
  const exportScript = compileTypeRScript({
    chapterName: 'Manhwa Ep 1',
    pages: [{ pageIndex: 1, bubbles: currentBubbles }],
    includePageHeaders: true,
    includeIndexTags: true,
    includePrefixTags: true,
    includeSourceComments: true,
    includeFlagNotes: true,
    includeSFX: true,
  });

  assert.ok(exportScript.includes('// TYPER TRANSLATION SCRIPT // MANHWA EP 1'));
  assert.ok(exportScript.includes('### PAGE 01'));
  assert.ok(exportScript.includes(manualTranslation), 'TypeR export includes manual translation');
  assert.ok(exportScript.includes('#01 '), 'TypeR export starts with index #01');
  assert.ok(exportScript.includes('// Source:'), 'TypeR export includes source comment');

  resetDatabaseConnection();
});
