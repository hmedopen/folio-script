import type {
  PageDomainState,
  ScanRunRecord,
  MigrationJournalEntry,
  PhysicalContainer,
  TextRegion as DomainTextRegion,
  ContentRecord,
  ContainerType,
  ContentSemanticType,
  Point2D,
  PixelBox,
  DetectorObservation,
  OcrLineObservation,
} from '../../types/domain/index.ts';
import type { BubbleItem } from '../../types/workbench.ts';
import type { PageScanResult } from '../../types/scanning.ts';

export const V9_MIGRATION_KEY = 'storage_v9_domain_migration';

export function mapBubbleTypeToContainerType(type?: string): ContainerType {
  switch (type) {
    case 'thought_bubbles':
    case 'thought':
      return 'thought_balloon';
    case 'shouting':
    case 'scream':
      return 'shout_burst';
    case 'whisper':
      return 'whisper_dashed';
    case 'square_bubbles':
    case 'box':
      return 'narration_box';
    case 'outside_text':
    case 'small_text':
      return 'sign_board';
    case 'sfx':
      return 'in_art_boundary';
    case 'speech_bubbles':
    case 'dialogue':
    default:
      return 'speech_balloon';
  }
}

export function mapBubbleTypeToSemanticContentType(type?: string): ContentSemanticType {
  switch (type) {
    case 'thought_bubbles':
    case 'thought':
      return 'thought';
    case 'square_bubbles':
    case 'box':
      return 'narration';
    case 'outside_text':
    case 'small_text':
      return 'caption';
    case 'sfx':
      return 'sfx';
    case 'translator_note':
      return 'translator_note';
    case 'speech_bubbles':
    case 'shouting':
    case 'scream':
    case 'dialogue':
    default:
      return 'dialogue';
  }
}

/**
 * Builds authoritative polygon vertices [[x, y], ...] from bubble geometry.
 */
export function derivePolygonFromBubble(
  bubble: BubbleItem,
  pageWidth: number,
  pageHeight: number
): Point2D[] {
  if (Array.isArray(bubble.pixelPolygon) && bubble.pixelPolygon.length >= 3) {
    return bubble.pixelPolygon.map(([x, y]) => [Number(x), Number(y)] as Point2D);
  }
  if (Array.isArray(bubble.manualPolygon) && bubble.manualPolygon.length >= 3) {
    return bubble.manualPolygon.map(([x, y]) => [
      Number((x / 1000) * pageWidth),
      Number((y / 1000) * pageHeight),
    ] as Point2D);
  }
  if (Array.isArray(bubble.pixelBox) && bubble.pixelBox.length === 4) {
    const [minY, minX, maxY, maxX] = bubble.pixelBox;
    return [
      [minX, minY],
      [maxX, minY],
      [maxX, maxY],
      [minX, maxY],
    ];
  }
  const [bMinY, bMinX, bMaxY, bMaxX] = bubble.box_2d || [200, 200, 400, 400];
  return [
    [(bMinX / 1000) * pageWidth, (bMinY / 1000) * pageHeight],
    [(bMaxX / 1000) * pageWidth, (bMinY / 1000) * pageHeight],
    [(bMaxX / 1000) * pageWidth, (bMaxY / 1000) * pageHeight],
    [(bMinX / 1000) * pageWidth, (bMaxY / 1000) * pageHeight],
  ];
}

/**
 * Converts legacy BubbleItem[] and optional PageScanResult into canonical PageDomainState and ScanRunRecord.
 */
export function convertLegacyDataToDomainState(
  pageId: string,
  bubbles: BubbleItem[],
  scanResult?: PageScanResult | null,
  chapterId?: string
): { pageDomainState: PageDomainState; scanRunRecord?: ScanRunRecord } {
  const width = scanResult?.sourceDimensions?.width || 1000;
  const height = scanResult?.sourceDimensions?.height || 1000;

  const containers: Record<string, PhysicalContainer> = {};
  const textRegions: Record<string, DomainTextRegion> = {};
  const contentRecords: Record<string, ContentRecord> = {};

  const sortedBubbles = [...bubbles].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
  const readingSequence: string[] = [];

  for (let i = 0; i < sortedBubbles.length; i++) {
    const b = sortedBubbles[i];
    const contentId = b.id || `cr-${pageId}-${i + 1}`;
    const regionId = b.regionId || `reg-${contentId}`;
    const containerId = `cont-${regionId}`;
    readingSequence.push(contentId);

    const polygon = derivePolygonFromBubble(b, width, height);

    // 1. Physical Container
    containers[containerId] = {
      containerId,
      pageId,
      containerType: mapBubbleTypeToContainerType(b.type),
      geometry: {
        bodyContour: polygon,
        tails: [],
      },
      confidence: b.confidence ?? 0.9,
      boundaryUncertain: false,
      zIndex: i + 1,
      state: 'active',
      provenance: {
        geometry: { source: 'legacy_migration', updatedAt: b.updatedAt || Date.now() },
        containerType: { source: 'legacy_migration', updatedAt: b.updatedAt || Date.now() },
      },
    };

    // 2. Text Region
    textRegions[regionId] = {
      regionId,
      pageId,
      containerId,
      containerAssociation: 'associated',
      geometry: {
        pixelPolygon: polygon,
      },
      orientation: 'horizontal',
      lineObservationIds: b.lineSegments?.map((l) => l.lineId) || [`line-${contentId}`],
      rubyAnnotations: [],
      confidence: b.confidence ?? 0.9,
      lifecycleState: 'active',
      provenance: {
        geometry: { source: 'legacy_migration', updatedAt: b.updatedAt || Date.now() },
        containerId: { source: 'legacy_migration', updatedAt: b.updatedAt || Date.now() },
      },
    };

    // 3. Content Record
    contentRecords[contentId] = {
      contentId,
      pageId,
      regionTargets: [{ regionId }],
      contentType: mapBubbleTypeToSemanticContentType(b.type),
      speakerIds: b.speakerCharacterId ? [b.speakerCharacterId] : [],
      sourceText: b.sourceText || '',
      originalOcrText: b.originalSourceText || b.sourceText || '',
      translatedText: b.translatedText || '',
      translationHistory: Array.isArray(b.translationHistory)
        ? b.translationHistory.map((th, idx) => ({
            versionId: (th as any).versionId || `v-${b.id}-${idx}-${th.timestamp || Date.now()}`,
            timestamp: th.timestamp || Date.now(),
            text: th.text || '',
            type: th.type || 'manual',
          }))
        : [],
      typerTag: {
        id: b.type || 'speech_bubbles',
        prefix: b.typerPrefix !== undefined ? b.typerPrefix : '"":',
      },
      status: 'active',
      orderState: {
        isUserPinned: Boolean(b.isManuallyEdited),
        pinnedAt: b.isManuallyEdited ? b.updatedAt || Date.now() : undefined,
      },
      reviewFlags: Array.isArray(b.reviewFlags)
        ? b.reviewFlags.map((rf) => ({
            flagId: rf.id,
            category: rf.category,
            severity: (rf.severity as 'blocker' | 'warning' | 'suggestion') || 'warning',
            reasonAr: rf.reasonAr || '',
            status: rf.status || 'pending',
          }))
        : [],
      provenance: {
        sourceText: {
          source: b.isManuallyEdited ? 'user_manual' : 'legacy_migration',
          updatedAt: b.updatedAt || Date.now(),
        },
        translatedText: {
          source: b.translatedText ? 'user_manual' : 'legacy_migration',
          updatedAt: b.updatedAt || Date.now(),
        },
        typerTag: {
          source: b.isManuallyEdited ? 'user_manual' : 'legacy_migration',
          updatedAt: b.updatedAt || Date.now(),
        },
        speakerIds: {
          source: b.speakerCharacterId ? 'user_manual' : 'legacy_migration',
          updatedAt: b.updatedAt || Date.now(),
        },
        contentType: { source: 'legacy_migration', updatedAt: b.updatedAt || Date.now() },
        regionTargets: { source: 'legacy_migration', updatedAt: b.updatedAt || Date.now() },
      },
    };
  }

  const pageDomainState: PageDomainState = {
    pageId,
    chapterId: chapterId || sortedBubbles[0]?.chapterId,
    dimensions: { width, height },
    spatialGroups: {},
    containers,
    textRegions,
    contentRecords,
    readingSequence,
    issues: [],
    version: 9,
    updatedAt: Date.now(),
    extensions: {
      legacyPayload: {
        bubbles: sortedBubbles,
        scanResult: scanResult || undefined,
      },
    },
  };

  // Convert scanResult to ScanRunRecord if present
  let scanRunRecord: ScanRunRecord | undefined;
  if (scanResult) {
    const scanRunId = scanResult.scanId || `scan-run-${pageId}-${Date.now()}`;
    pageDomainState.activeScanRunId = scanRunId;

    const detectorObservations: Record<string, DetectorObservation> = {};
    const ocrObservations: Record<string, OcrLineObservation> = {};

    for (let rIdx = 0; rIdx < scanResult.regions.length; rIdx++) {
      const reg = scanResult.regions[rIdx];
      const detectionId = `det-${scanRunId}-${rIdx}`;
      const regBox: PixelBox = reg.geometry.pixelBox || [
        (reg.geometry.box_2d[0] / 1000) * height,
        (reg.geometry.box_2d[1] / 1000) * width,
        (reg.geometry.box_2d[2] / 1000) * height,
        (reg.geometry.box_2d[3] / 1000) * width,
      ];

      detectorObservations[detectionId] = {
        detectionId,
        scanRunId,
        pageId,
        classLabel: 'text_bubble',
        pixelBox: regBox,
        pixelPolygon: reg.geometry.pixelPolygon,
        rawScore: reg.confidence.regionDetection,
        sourceTileIds: [],
        touchesTileInnerBoundary: false,
        timestamp: Date.now(),
      };

      if (reg.lineSegments && reg.lineSegments.length > 0) {
        for (const ls of reg.lineSegments) {
          const lsGeo = ls.geometry;
          const lsBox: PixelBox = (ls as any).pixelBox || lsGeo?.pixelBox || regBox;
          const lsPoly: Point2D[] = (ls as any).pixelPolygon || lsGeo?.pixelPolygon || [
            [regBox[1], regBox[0]],
            [regBox[3], regBox[0]],
            [regBox[3], regBox[2]],
            [regBox[1], regBox[2]],
          ];
          ocrObservations[ls.lineId] = {
            lineId: ls.lineId,
            scanRunId,
            pageId,
            text: ls.text,
            lineScore: (ls as any).recognitionConfidence ?? (ls as any).confidence ?? 0.9,
            pixelBox: lsBox,
            pixelPolygon: lsPoly,
            isVertical: Boolean(ls.isVertical),
            sourceTileIds: [],
            timestamp: Date.now(),
          };
        }
      }
    }

    scanRunRecord = {
      scanRunId,
      pageId,
      chapterId: pageDomainState.chapterId,
      status: scanResult.status === 'complete' ? 'completed' : 'partial',
      startedAt: Date.now(),
      completedAt: Date.now(),
      models: {
        detector: {
          stage: 'detector',
          status: 'executed',
          provider: 'wasm',
          modelId: 'legacy_detector',
        },
        ocr: {
          stage: 'ocr',
          status: 'executed',
          provider: 'wasm',
          modelId: 'legacy_ocr',
        },
      },
      tiles: [],
      detectorObservations,
      ocrObservations,
    };
  }

  return { pageDomainState, scanRunRecord };
}

/**
 * Runs the idempotent, atomic, recoverable v8-to-v9 migration on IndexedDB.
 * Stage 1: Caller opens the v9 database with required stores created.
 * Stage 2: Persists in_progress journal state in its own committed transaction before migration.
 * Stage 3: Discovers legacy pages and processes in bounded, atomic per-page units.
 * Stage 4: Each page and its progress are committed in their own transaction; failed pages do not corrupt others.
 * Stage 5: Marks completed only after verifying that migrated domain states exist.
 */
export async function runIdempotentV9Migration(db: IDBDatabase): Promise<MigrationJournalEntry> {
  const STORE_PAGE_BUBBLES = 'page_bubbles';
  const STORE_PAGE_SCANS = 'page_scans';
  const STORE_PAGE_DOMAIN_STATES = 'page_domain_states';
  const STORE_SCAN_RUN_RECORDS = 'scan_run_records';
  const STORE_MIGRATION_JOURNAL = 'migration_journal';

  // 1. Check existing journal entry
  const existingJournal = await getJournalRecord(db);
  if (existingJournal && existingJournal.status === 'completed') {
    return existingJournal;
  }

  // 2. Read all legacy page keys from page_bubbles and page_scans (zero-loss discovery)
  const bubbleKeys = await getAllStoreKeys(db, STORE_PAGE_BUBBLES, 'page-bubbles:');
  const scanKeys = await getAllStoreKeys(db, STORE_PAGE_SCANS, 'page-scan:');
  const pageKeys = Array.from(new Set([...bubbleKeys, ...scanKeys]));

  const journalEntry: MigrationJournalEntry = {
    key: V9_MIGRATION_KEY,
    version: 9,
    status: 'in_progress',
    startedAt: existingJournal?.startedAt || Date.now(),
    totalPagesFound: pageKeys.length,
    migratedPagesCount: existingJournal?.migratedPagesCount || 0,
    failedPageIds: existingJournal?.failedPageIds ? [...existingJournal.failedPageIds] : [],
  };

  // Stage 2: Persist in_progress journal state in its own committed transaction FIRST
  await saveJournalRecord(db, journalEntry);

  if (pageKeys.length === 0) {
    journalEntry.status = 'completed';
    journalEntry.completedAt = Date.now();
    await saveJournalRecord(db, journalEntry);
    return journalEntry;
  }

  // Stage 3 & 4: Process legacy data in bounded, atomic, resumable per-page units
  let successfulMigrations = 0;
  for (const pageId of pageKeys) {
    try {
      const bubbles = await getLegacyBubbles(db, pageId);
      const scanResult = await getLegacyScan(db, pageId);
      const conv = convertLegacyDataToDomainState(pageId, bubbles, scanResult);

      // Commit this page and progress in an atomic per-page transaction
      await new Promise<void>((resolve, reject) => {
        const txStores = [STORE_PAGE_DOMAIN_STATES, STORE_SCAN_RUN_RECORDS, STORE_MIGRATION_JOURNAL];
        const tx = db.transaction(txStores, 'readwrite');
        const domainStore = tx.objectStore(STORE_PAGE_DOMAIN_STATES);
        const scanStore = tx.objectStore(STORE_SCAN_RUN_RECORDS);
        const jStore = tx.objectStore(STORE_MIGRATION_JOURNAL);

        domainStore.put(conv.pageDomainState);
        if (conv.scanRunRecord) {
          scanStore.put(conv.scanRunRecord);
        }

        const failedIdx = journalEntry.failedPageIds.indexOf(pageId);
        if (failedIdx !== -1) {
          journalEntry.failedPageIds.splice(failedIdx, 1);
        }
        successfulMigrations++;
        journalEntry.migratedPagesCount = successfulMigrations;
        jStore.put(journalEntry);

        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error || new Error(`Migration transaction failed for page ${pageId}`));
        tx.onabort = () => reject(tx.error || new Error(`Migration transaction aborted for page ${pageId}`));
      });
    } catch (pageErr: any) {
      if (!journalEntry.failedPageIds.includes(pageId)) {
        journalEntry.failedPageIds.push(pageId);
      }
      journalEntry.error = pageErr?.message || String(pageErr);
      // Persist failure record in its own transaction so progress is preserved
      await saveJournalRecord(db, journalEntry).catch(() => {});
    }
  }

  // Stage 5: Validation - ensure migrated records exist in STORE_PAGE_DOMAIN_STATES
  let allValid = true;
  for (const pageId of pageKeys) {
    if (journalEntry.failedPageIds.includes(pageId)) {
      continue;
    }
    const exists = await checkPageDomainStateExists(db, pageId);
    if (!exists) {
      allValid = false;
      if (!journalEntry.failedPageIds.includes(pageId)) {
        journalEntry.failedPageIds.push(pageId);
      }
    }
  }

  journalEntry.status = allValid && journalEntry.failedPageIds.length === 0 ? 'completed' : 'failed';
  journalEntry.completedAt = Date.now();
  await saveJournalRecord(db, journalEntry);

  return journalEntry;
}

async function getJournalRecord(db: IDBDatabase): Promise<MigrationJournalEntry | null> {
  const STORE_MIGRATION_JOURNAL = 'migration_journal';
  if (!db.objectStoreNames.contains(STORE_MIGRATION_JOURNAL)) return null;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_MIGRATION_JOURNAL, 'readonly');
      const store = tx.objectStore(STORE_MIGRATION_JOURNAL);
      const req = store.get(V9_MIGRATION_KEY);
      req.onsuccess = () => resolve((req.result as MigrationJournalEntry) || null);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function getAllStoreKeys(db: IDBDatabase, storeName: string, prefixToStrip: string): Promise<string[]> {
  if (!db.objectStoreNames.contains(storeName)) return [];
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(storeName, 'readonly');
      const store = tx.objectStore(storeName);
      const req = store.getAllKeys();
      req.onsuccess = () => {
        const rawKeys = req.result || [];
        const ids = rawKeys.map((k) => String(k).replace(new RegExp(`^${prefixToStrip}`), ''));
        resolve(ids);
      };
      req.onerror = () => resolve([]);
    } catch {
      resolve([]);
    }
  });
}

async function getLegacyBubbles(db: IDBDatabase, pageId: string): Promise<BubbleItem[]> {
  const STORE_PAGE_BUBBLES = 'page_bubbles';
  if (!db.objectStoreNames.contains(STORE_PAGE_BUBBLES)) return [];
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_PAGE_BUBBLES, 'readonly');
      const store = tx.objectStore(STORE_PAGE_BUBBLES);
      const req = store.get(`page-bubbles:${pageId}`);
      req.onsuccess = () => resolve(Array.isArray(req.result) ? req.result : []);
      req.onerror = () => resolve([]);
    } catch {
      resolve([]);
    }
  });
}

async function getLegacyScan(db: IDBDatabase, pageId: string): Promise<PageScanResult | null> {
  const STORE_PAGE_SCANS = 'page_scans';
  if (!db.objectStoreNames.contains(STORE_PAGE_SCANS)) return null;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_PAGE_SCANS, 'readonly');
      const store = tx.objectStore(STORE_PAGE_SCANS);
      const req = store.get(`page-scan:${pageId}`);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function checkPageDomainStateExists(db: IDBDatabase, pageId: string): Promise<boolean> {
  const STORE_PAGE_DOMAIN_STATES = 'page_domain_states';
  if (!db.objectStoreNames.contains(STORE_PAGE_DOMAIN_STATES)) return false;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_PAGE_DOMAIN_STATES, 'readonly');
      const store = tx.objectStore(STORE_PAGE_DOMAIN_STATES);
      const req = store.get(pageId);
      req.onsuccess = () => resolve(Boolean(req.result));
      req.onerror = () => resolve(false);
    } catch {
      resolve(false);
    }
  });
}

async function saveJournalRecord(db: IDBDatabase, entry: MigrationJournalEntry): Promise<void> {
  const STORE_MIGRATION_JOURNAL = 'migration_journal';
  if (!db.objectStoreNames.contains(STORE_MIGRATION_JOURNAL)) return;
  return new Promise((resolve, reject) => {
    try {
      const tx = db.transaction(STORE_MIGRATION_JOURNAL, 'readwrite');
      const store = tx.objectStore(STORE_MIGRATION_JOURNAL);
      const req = store.put(entry);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    } catch (err: any) {
      if (err?.name === 'InvalidStateError') {
        resolve();
        return;
      }
      reject(err);
    }
  });
}
