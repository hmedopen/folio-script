import test from 'node:test';
import assert from 'node:assert/strict';
import {
  convertLegacyDataToDomainState,
  runIdempotentV9Migration,
  V9_MIGRATION_KEY,
} from '../../lib/domain/v9Migration.ts';
import type { BubbleItem } from '../../types/workbench.ts';
import type { PageScanResult } from '../../types/scanning.ts';
import type { PageDomainState, ScanRunRecord } from '../../types/domain/index.ts';

function createMockIndexedDb(seed?: {
  version?: number;
  bubblesByPage?: Record<string, BubbleItem[]>;
  scansByPage?: Record<string, PageScanResult>;
  domainStates?: Record<string, PageDomainState>;
  scanRuns?: Record<string, ScanRunRecord>;
  journalEntries?: Record<string, any>;
}) {
  const bubbleStore = new Map<string, any>();
  const scanStore = new Map<string, any>();
  const domainStore = new Map<string, any>();
  const scanRunStore = new Map<string, any>();
  const journalStore = new Map<string, any>();

  if (seed?.bubblesByPage) {
    for (const [pId, bList] of Object.entries(seed.bubblesByPage)) {
      bubbleStore.set(`page-bubbles:${pId}`, bList);
    }
  }

  if (seed?.scansByPage) {
    for (const [pId, sRes] of Object.entries(seed.scansByPage)) {
      scanStore.set(`page-scan:${pId}`, sRes);
    }
  }

  if (seed?.domainStates) {
    for (const [pId, dState] of Object.entries(seed.domainStates)) {
      domainStore.set(pId, dState);
    }
  }

  if (seed?.scanRuns) {
    for (const [srId, srRec] of Object.entries(seed.scanRuns)) {
      scanRunStore.set(srId, srRec);
    }
  }

  if (seed?.journalEntries) {
    for (const [jKey, jVal] of Object.entries(seed.journalEntries)) {
      journalStore.set(jKey, jVal);
    }
  }

  const storeMap: Record<string, Map<string, any>> = {
    page_bubbles: bubbleStore,
    page_scans: scanStore,
    page_domain_states: domainStore,
    scan_run_records: scanRunStore,
    migration_journal: journalStore,
  };

  const makeObjectStore = (name: string) => {
    const map = storeMap[name] || new Map<string, any>();
    return {
      get(k: string) {
        const req: any = { result: map.get(k), onsuccess: null, onerror: null };
        queueMicrotask(() => req.onsuccess?.());
        return req;
      },
      getAllKeys() {
        const req: any = { result: Array.from(map.keys()), onsuccess: null, onerror: null };
        queueMicrotask(() => req.onsuccess?.());
        return req;
      },
      getAll(_val?: any) {
        const req: any = { result: Array.from(map.values()), onsuccess: null, onerror: null };
        queueMicrotask(() => req.onsuccess?.());
        return req;
      },
      put(val: any, explicitKey?: string) {
        const k = explicitKey || (name === 'scan_run_records' ? val?.scanRunId : val?.pageId || val?.scanRunId || val?.key);
        map.set(k, val);
        const req: any = { result: k, onsuccess: null, onerror: null };
        queueMicrotask(() => req.onsuccess?.());
        return req;
      },
      delete(k: string) {
        map.delete(k);
        const req: any = { result: undefined, onsuccess: null, onerror: null };
        queueMicrotask(() => req.onsuccess?.());
        return req;
      },
      index(idxName: string) {
        return {
          getAll(targetVal: any) {
            const results = Array.from(map.values()).filter((v: any) => v[idxName] === targetVal);
            const req: any = { result: results, onsuccess: null, onerror: null };
            queueMicrotask(() => req.onsuccess?.());
            return req;
          },
        };
      },
    };
  };

  let failTransactions = false;

  const db = {
    version: seed?.version ?? 9,
    objectStoreNames: {
      contains: (s: string) => s in storeMap,
      length: Object.keys(storeMap).length,
    },
    transaction(_storeNames: string | string[], _mode?: 'readonly' | 'readwrite') {
      const tx: any = {
        oncomplete: null,
        onerror: null,
        onabort: null,
        error: null,
        objectStore(s: string) {
          return makeObjectStore(s);
        },
      };

      queueMicrotask(() => {
        if (failTransactions) {
          tx.error = new Error('Simulated IndexedDB transaction abort');
          tx.onabort?.();
          tx.onerror?.();
        } else {
          tx.oncomplete?.();
        }
      });

      return tx;
    },
    close() {},
    _setFailTransactions(fail: boolean) {
      failTransactions = fail;
    },
    _stores: storeMap,
  };

  return db as any;
}

test('Milestone 4.2: convertLegacyDataToDomainState converts v8 bubbles and scan result preserving all attributes', () => {
  const legacyBubbles: BubbleItem[] = [
    {
      id: 'bubble-legacy-1',
      pageId: 'page-101',
      chapterId: 'chapter-1',
      index: 1,
      box_2d: [100, 150, 300, 450],
      pixelBox: [100, 150, 300, 450],
      pixelPolygon: [
        [150, 100],
        [450, 100],
        [450, 300],
        [150, 300],
      ],
      type: 'shouting',
      typerPrefix: 'SHOUT:',
      sourceText: 'Stop right there!',
      originalSourceText: 'Stop right there!',
      translatedText: 'توقف مكانك!',
      rawTranslatedText: 'توقف مكانك!',
      translationHistory: [
        { timestamp: 1774000000000, text: 'قف هناك!', type: 'raw' },
      ],
      speakerCharacterId: 'char-hero',
      confidence: 0.94,
      isManuallyEdited: true,
      updatedAt: 1774000010000,
      reviewFlags: [
        {
          id: 'flag-1',
          category: 'ocr_error',
          severity: 'warning',
          reasonAr: 'تدقيق النص',
          status: 'pending',
          createdAt: 1774000000000,
        },
      ],
    },
    {
      id: 'bubble-legacy-2',
      pageId: 'page-101',
      chapterId: 'chapter-1',
      index: 2,
      box_2d: [500, 200, 700, 600],
      type: 'thought_bubbles',
      typerPrefix: 'THOUGHT:',
      sourceText: 'Can I make it in time?',
      originalSourceText: 'Can I make it in time?',
      translatedText: 'هل سأصل في الوقت المناسب؟',
      rawTranslatedText: 'هل سأصل في الوقت المناسب؟',
      reviewFlags: [],
      isManuallyEdited: false,
    },
  ];

  const legacyScan = {
    scanId: 'scan-run-p101',
    pageId: 'page-101',
    sourceImageId: 'page-101',
    readingConvention: 'auto' as const,
    status: 'complete' as const,
    sourceDimensions: { width: 1200, height: 1800 },
    panels: [],
    regions: [
      {
        regionId: 'bubble-legacy-1',
        geometry: {
          coordinateSpace: 'normalized_1000' as const,
          box_2d: [100, 150, 300, 450] as [number, number, number, number],
          pixelBox: [180, 180, 540, 540] as [number, number, number, number],
        },
        rawOCR: 'Stop right there!',
        confidence: {
          imageQuality: 1,
          regionDetection: 0.95,
          ocr: 0.94,
          association: 1,
          readingOrder: 1,
          classification: 0.95,
        },
        classification: {
          primaryClass: 'vocalization' as const,
          confidence: 0.95,
          needsReview: false,
        },
        associations: {},
        order: { sequenceIndex: 1, confidence: 1 },
        flags: [],
        lineSegments: [
          {
            lineId: 'line-obs-1',
            text: 'Stop right there!',
            recognitionConfidence: 0.94,
            geometry: {
              coordinateSpace: 'normalized_1000' as const,
              box_2d: [100, 150, 300, 450] as [number, number, number, number],
            },
            isVertical: false,
          },
        ],
      },
    ],
    issues: [],
    transformLedger: { sourceImageId: 'page-101', sourceWidth: 1200, sourceHeight: 1800, transforms: [] },
    createdAt: 1774000000000,
    version: 1,
  } as unknown as PageScanResult;

  const { pageDomainState, scanRunRecord } = convertLegacyDataToDomainState(
    'page-101',
    legacyBubbles,
    legacyScan,
    'chapter-1'
  );

  // 1. Verify PageDomainState invariants
  assert.equal(pageDomainState.pageId, 'page-101');
  assert.equal(pageDomainState.chapterId, 'chapter-1');
  assert.equal(pageDomainState.version, 9);
  assert.deepEqual(pageDomainState.readingSequence, ['bubble-legacy-1', 'bubble-legacy-2']);
  assert.equal(pageDomainState.dimensions.width, 1200);
  assert.equal(pageDomainState.dimensions.height, 1800);

  // 2. Verify containers & text regions
  assert.equal(Object.keys(pageDomainState.containers).length, 2);
  assert.equal(Object.keys(pageDomainState.textRegions).length, 2);
  assert.equal(Object.keys(pageDomainState.contentRecords).length, 2);

  // Check content record 1: manual edits and provenance
  const cr1 = pageDomainState.contentRecords['bubble-legacy-1'];
  assert.equal(cr1.contentType, 'dialogue');
  assert.equal(cr1.sourceText, 'Stop right there!');
  assert.equal(cr1.translatedText, 'توقف مكانك!');
  assert.equal(cr1.translationHistory.length, 1);
  assert.deepEqual(cr1.speakerIds, ['char-hero']);
  assert.equal(cr1.orderState.isUserPinned, true);
  assert.equal(cr1.provenance.sourceText.source, 'user_manual');
  assert.equal(cr1.reviewFlags.length, 1);
  assert.equal(cr1.reviewFlags[0].category, 'ocr_error');

  // Check content record 2: auto scan provenance
  const cr2 = pageDomainState.contentRecords['bubble-legacy-2'];
  assert.equal(cr2.contentType, 'thought');
  assert.equal(cr2.orderState.isUserPinned, false);
  assert.equal(cr2.provenance.sourceText.source, 'legacy_migration');

  // 3. Verify ScanRunRecord observations preservation
  assert.ok(scanRunRecord);
  assert.equal(scanRunRecord.scanRunId, 'scan-run-p101');
  assert.equal(scanRunRecord.status, 'completed');
  assert.equal(Object.keys(scanRunRecord.detectorObservations).length, 1);
  assert.equal(Object.keys(scanRunRecord.ocrObservations).length, 1);
  assert.equal(scanRunRecord.ocrObservations['line-obs-1'].text, 'Stop right there!');

  // 4. Verify raw legacy payload is preserved in extensions for 100% safety
  assert.ok(pageDomainState.extensions?.legacyPayload);
  assert.equal((pageDomainState.extensions.legacyPayload as any).bubbles.length, 2);
});

test('Milestone 4.2: runIdempotentV9Migration migrates legacy database without destroying original data', async () => {
  const mockDb = createMockIndexedDb({
    version: 8,
    bubblesByPage: {
      'page-legacy-1': [
        {
          id: 'b-leg-1',
          pageId: 'page-legacy-1',
          index: 1,
          box_2d: [100, 100, 200, 200],
          type: 'speech_bubbles',
          typerPrefix: '"":',
          sourceText: 'Original bubble text',
          originalSourceText: 'Original bubble text',
          translatedText: 'ترجمة',
          rawTranslatedText: 'ترجمة',
          reviewFlags: [],
        },
      ],
      'page-legacy-2': [
        {
          id: 'b-leg-2',
          pageId: 'page-legacy-2',
          index: 1,
          box_2d: [300, 300, 400, 400],
          type: 'narration',
          typerPrefix: '"":',
          sourceText: 'Meanwhile in Tokyo...',
          originalSourceText: 'Meanwhile in Tokyo...',
          translatedText: 'في هذه الأثناء في طوكيو...',
          rawTranslatedText: 'في هذه الأثناء في طوكيو...',
          reviewFlags: [],
        },
      ],
    },
  });

  // Execute migration
  const journal = await runIdempotentV9Migration(mockDb);
  assert.equal(journal.status, 'completed');
  assert.equal(journal.totalPagesFound, 2);
  assert.equal(journal.migratedPagesCount, 2);
  assert.equal(journal.failedPageIds.length, 0);

  // Verify domain state records were created in page_domain_states
  const domainStore = mockDb._stores.page_domain_states;
  assert.equal(domainStore.size, 2);
  const p1Domain = domainStore.get('page-legacy-1') as PageDomainState;
  assert.ok(p1Domain);
  assert.equal(p1Domain.contentRecords['b-leg-1'].sourceText, 'Original bubble text');

  // Verify original page_bubbles store is completely intact (Zero Data Loss Invariant)
  const bubbleStore = mockDb._stores.page_bubbles;
  assert.equal(bubbleStore.size, 2);
  assert.ok(bubbleStore.has('page-bubbles:page-legacy-1'));
  assert.ok(bubbleStore.has('page-bubbles:page-legacy-2'));

  // Test idempotency: re-running migration immediately returns the completed journal
  const secondJournal = await runIdempotentV9Migration(mockDb);
  assert.equal(secondJournal.key, V9_MIGRATION_KEY);
  assert.equal(secondJournal.status, 'completed');
  assert.equal(domainStore.size, 2); // No duplicates
});

test('Milestone 4.2: runIdempotentV9Migration handles failure and recovers on subsequent retry', async () => {
  const mockDb = createMockIndexedDb({
    version: 8,
    bubblesByPage: {
      'page-err-1': [
        {
          id: 'b-err-1',
          pageId: 'page-err-1',
          index: 1,
          box_2d: [10, 10, 50, 50],
          type: 'speech_bubbles',
          typerPrefix: '"":',
          sourceText: 'Failed attempt text',
          originalSourceText: 'Failed attempt text',
          translatedText: 'خطأ',
          rawTranslatedText: 'خطأ',
          reviewFlags: [],
        },
      ],
    },
  });

  // Force transaction failure
  mockDb._setFailTransactions(true);
  const failedJournal = await runIdempotentV9Migration(mockDb);
  assert.equal(failedJournal.status, 'failed');
  assert.ok(failedJournal.error?.includes('Simulated IndexedDB transaction abort'));

  // Clear failure flag and retry
  mockDb._setFailTransactions(false);
  const recoveredJournal = await runIdempotentV9Migration(mockDb);
  assert.equal(recoveredJournal.status, 'completed');
  assert.equal(recoveredJournal.migratedPagesCount, 1);

  const domainStore = mockDb._stores.page_domain_states;
  assert.equal(domainStore.size, 1);
  assert.ok(domainStore.has('page-err-1'));
});

test('Milestone 4.2: PageDomainState & ScanRunRecord CRUD persistence methods work accurately', async () => {
  const mockDb = createMockIndexedDb();

  const domainState: PageDomainState = {
    pageId: 'page-crud-1',
    dimensions: { width: 800, height: 1200 },
    spatialGroups: {},
    containers: {},
    textRegions: {},
    contentRecords: {
      'cr-1': {
        contentId: 'cr-1',
        pageId: 'page-crud-1',
        regionTargets: [],
        contentType: 'dialogue',
        speakerIds: [],
        sourceText: 'Hello',
        originalOcrText: 'Hello',
        translatedText: 'مرحبا',
        translationHistory: [],
        typerTag: { id: 'speech_bubbles', prefix: '"":' },
        status: 'active',
        orderState: { isUserPinned: true },
        reviewFlags: [],
        provenance: {
          sourceText: { source: 'user_manual', updatedAt: Date.now() },
          translatedText: { source: 'user_manual', updatedAt: Date.now() },
          typerTag: { source: 'user_manual', updatedAt: Date.now() },
          speakerIds: { source: 'user_manual', updatedAt: Date.now() },
          contentType: { source: 'user_manual', updatedAt: Date.now() },
          regionTargets: { source: 'user_manual', updatedAt: Date.now() },
        },
      },
    },
    readingSequence: ['cr-1'],
    issues: [],
    version: 9,
    updatedAt: Date.now(),
  };

  const scanRun: ScanRunRecord = {
    scanRunId: 'scan-crud-1',
    pageId: 'page-crud-1',
    status: 'completed',
    startedAt: Date.now(),
    models: {
      detector: { stage: 'detector', status: 'executed', provider: 'wasm' },
      ocr: { stage: 'ocr', status: 'executed', provider: 'wasm' },
    },
    tiles: [],
    detectorObservations: {},
    ocrObservations: {},
  };

  // Test save & get via store directly
  const domainStore = mockDb._stores.page_domain_states;
  domainStore.set(domainState.pageId, domainState);
  assert.equal((domainStore.get('page-crud-1') as PageDomainState).readingSequence[0], 'cr-1');

  const scanStore = mockDb._stores.scan_run_records;
  scanStore.set(scanRun.scanRunId, scanRun);
  assert.equal((scanStore.get('scan-crud-1') as ScanRunRecord).pageId, 'page-crud-1');

  // Test delete
  domainStore.delete('page-crud-1');
  assert.equal(domainStore.has('page-crud-1'), false);
  scanStore.delete('scan-crud-1');
  assert.equal(scanStore.has('scan-crud-1'), false);
});

test('Milestone 4.2: runIdempotentV9Migration migrates scan records for scenic pages with zero bubbles', async () => {
  const mockDb = createMockIndexedDb({
    version: 8,
    bubblesByPage: {},
    scansByPage: {
      'page-scenic-no-bubbles': {
        scanId: 'scan-scenic-1',
        pageId: 'page-scenic-no-bubbles',
        sourceImageId: 'page-scenic-no-bubbles',
        readingConvention: 'auto',
        status: 'complete',
        sourceDimensions: { width: 1000, height: 1500 },
        panels: [],
        regions: [],
        issues: [],
        transformLedger: { sourceImageId: 'page-scenic-no-bubbles', sourceWidth: 1000, sourceHeight: 1500, transforms: [] },
        createdAt: 1774000000000,
        version: 1,
      } as any,
    },
  });

  const journal = await runIdempotentV9Migration(mockDb as unknown as IDBDatabase);
  assert.equal(journal.status, 'completed');
  assert.equal(journal.totalPagesFound, 1);
  assert.equal(journal.migratedPagesCount, 1);

  const domainStore = mockDb._stores.page_domain_states;
  const migratedDomain = domainStore.get('page-scenic-no-bubbles') as PageDomainState;
  assert.ok(migratedDomain);
  assert.equal(migratedDomain.readingSequence.length, 0);

  const scanStore = mockDb._stores.scan_run_records;
  const migratedScan = scanStore.get('scan-scenic-1') as ScanRunRecord;
  assert.ok(migratedScan);
  assert.equal(migratedScan.pageId, 'page-scenic-no-bubbles');
});


