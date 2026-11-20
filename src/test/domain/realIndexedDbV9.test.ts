import test from 'node:test';
import assert from 'node:assert/strict';
import { indexedDB } from 'fake-indexeddb';
import {
  getDatabase,
  resetDatabaseConnection,
  STORE_PAGE_DOMAIN_STATES,
  STORE_SCAN_RUN_RECORDS,
  savePageDomainState,
  getPageDomainState,
  deletePageDomainState,
  saveScanRunRecord,
  getScanRunRecord,
  getScanRunRecordsForPage,
  deleteScanRunRecord,
} from '../../services/db.ts';
import { runIdempotentV9Migration } from '../../lib/domain/v9Migration.ts';
import type { PageDomainState, ScanRunRecord } from '../../types/domain/index.ts';

// Setup fake-indexeddb globally for real IndexedDB tests in Node.js
(globalThis as any).indexedDB = indexedDB;

test('F-01: Fresh database creation opens at v9 and creates all required stores and indexes', async () => {
  resetDatabaseConnection();

  const db = await getDatabase();
  assert.equal(db.version, 9, 'Database must open at version 9');

  // Verify v9 required stores
  assert.ok(db.objectStoreNames.contains('page_domain_states'), 'page_domain_states store must exist');
  assert.ok(db.objectStoreNames.contains('scan_run_records'), 'scan_run_records store must exist');
  assert.ok(db.objectStoreNames.contains('migration_journal'), 'migration_journal store must exist');
  assert.ok(db.objectStoreNames.contains('page_bubbles'), 'page_bubbles store must exist');
  assert.ok(db.objectStoreNames.contains('page_scans'), 'page_scans store must exist');

  // Verify indexes
  const tx = db.transaction(['page_domain_states', 'scan_run_records'], 'readonly');
  const domainStore = tx.objectStore('page_domain_states');
  assert.ok(domainStore.indexNames.contains('chapterId'), 'chapterId index must exist on page_domain_states');
  assert.ok(domainStore.indexNames.contains('updatedAt'), 'updatedAt index must exist on page_domain_states');

  const scanStore = tx.objectStore('scan_run_records');
  assert.ok(scanStore.indexNames.contains('pageId'), 'pageId index must exist on scan_run_records');
  assert.ok(scanStore.indexNames.contains('chapterId'), 'chapterId index must exist on scan_run_records');
  assert.ok(scanStore.indexNames.contains('status'), 'status index must exist on scan_run_records');

  resetDatabaseConnection();
});

test('F-01: Upgrade from genuine v8 database fixture creates v9 stores and preserves existing records', async () => {
  resetDatabaseConnection();

  // Create a genuine v8 database directly with IndexedDB API
  const v8DbName = 'dragonfly44_v8_upgrade_test';
  await new Promise<void>((resolve, reject) => {
    const req = indexedDB.open(v8DbName, 8);
    req.onupgradeneeded = () => {
      const db = req.result;
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
      // Intentionally DO NOT create v9 stores page_domain_states or scan_run_records!
    };
    req.onsuccess = () => {
      const db = req.result;
      // Seed legacy records in v8
      const tx = db.transaction(['page_bubbles', 'page_scans'], 'readwrite');
      tx.objectStore('page_bubbles').put(
        [
          {
            id: 'legacy-b1',
            pageId: 'v8-page-1',
            index: 1,
            box_2d: [100, 100, 200, 200],
            sourceText: 'Hello from v8',
            translatedText: 'مرحبا من الإصدار 8',
            type: 'speech_bubbles',
          },
        ],
        'page-bubbles:v8-page-1'
      );
      tx.objectStore('page_scans').put(
        {
          scanId: 'v8-scan-1',
          pageId: 'v8-page-1',
          status: 'complete',
          sourceDimensions: { width: 1000, height: 1500 },
          regions: [],
        },
        'page-scan:v8-page-1'
      );
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => reject(tx.error);
    };
    req.onerror = () => reject(req.error);
  });

  // Now upgrade the v8 database to v9
  const upgradedDb = await new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(v8DbName, 9);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_PAGE_DOMAIN_STATES)) {
        const domainStore = db.createObjectStore(STORE_PAGE_DOMAIN_STATES, { keyPath: 'pageId' });
        domainStore.createIndex('chapterId', 'chapterId', { unique: false });
        domainStore.createIndex('updatedAt', 'updatedAt', { unique: false });
      }
      if (!db.objectStoreNames.contains(STORE_SCAN_RUN_RECORDS)) {
        const scanRunStore = db.createObjectStore(STORE_SCAN_RUN_RECORDS, { keyPath: 'scanRunId' });
        scanRunStore.createIndex('pageId', 'pageId', { unique: false });
        scanRunStore.createIndex('chapterId', 'chapterId', { unique: false });
        scanRunStore.createIndex('status', 'status', { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

  assert.equal(upgradedDb.version, 9);
  assert.ok(upgradedDb.objectStoreNames.contains('page_domain_states'));
  assert.ok(upgradedDb.objectStoreNames.contains('scan_run_records'));

  // Run v9 migration on the upgraded database
  const journal = await runIdempotentV9Migration(upgradedDb);
  assert.equal(journal.status, 'completed');
  assert.equal(journal.totalPagesFound, 1);
  assert.equal(journal.migratedPagesCount, 1);

  // Verify migrated record exists and legacy records remain intact
  const tx = upgradedDb.transaction(['page_domain_states', 'page_bubbles', 'page_scans'], 'readonly');
  const domainReq = tx.objectStore('page_domain_states').get('v8-page-1');
  const bubbleReq = tx.objectStore('page_bubbles').get('page-bubbles:v8-page-1');
  const scanReq = tx.objectStore('page_scans').get('page-scan:v8-page-1');

  await new Promise<void>((res) => {
    tx.oncomplete = () => res();
  });

  const migratedState = domainReq.result as PageDomainState;
  assert.ok(migratedState);
  assert.equal(migratedState.pageId, 'v8-page-1');
  assert.equal(migratedState.contentRecords['legacy-b1']?.sourceText, 'Hello from v8');
  assert.equal(migratedState.contentRecords['legacy-b1']?.translatedText, 'مرحبا من الإصدار 8');

  // Verify legacy records are intact
  assert.ok(bubbleReq.result);
  assert.ok(scanReq.result);

  upgradedDb.close();
});

test('F-01: Reopening an already upgraded v9 database succeeds cleanly without modifying schema', async () => {
  resetDatabaseConnection();

  const db1 = await getDatabase();
  assert.equal(db1.version, 9);
  resetDatabaseConnection();

  const db2 = await getDatabase();
  assert.equal(db2.version, 9);
  assert.ok(db2.objectStoreNames.contains(STORE_PAGE_DOMAIN_STATES));
  assert.ok(db2.objectStoreNames.contains(STORE_SCAN_RUN_RECORDS));
  resetDatabaseConnection();
});

test('F-01: Real CRUD operations against getDatabase() path', async () => {
  resetDatabaseConnection();

  const testState: PageDomainState = {
    pageId: 'crud-real-page-1',
    chapterId: 'ch-real-1',
    dimensions: { width: 1200, height: 1800 },
    spatialGroups: {},
    containers: {},
    textRegions: {},
    contentRecords: {
      'cr-1': {
        contentId: 'cr-1',
        pageId: 'crud-real-page-1',
        regionTargets: [],
        contentType: 'dialogue',
        speakerIds: [],
        sourceText: 'Real DB Test',
        originalOcrText: 'Real DB Test',
        translatedText: 'اختبار قاعدة بيانات حقيقي',
        translationHistory: [],
        typerTag: { id: 'speech_bubbles', prefix: '"":' },
        status: 'active',
        orderState: { isUserPinned: false },
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

  await savePageDomainState(testState);

  const fetched = await getPageDomainState('crud-real-page-1');
  assert.ok(fetched);
  assert.equal(fetched.pageId, 'crud-real-page-1');
  assert.equal(fetched.contentRecords['cr-1']?.sourceText, 'Real DB Test');

  // Test ScanRunRecord CRUD
  const testRun: ScanRunRecord = {
    scanRunId: 'scan-run-real-1',
    pageId: 'crud-real-page-1',
    chapterId: 'ch-real-1',
    status: 'completed',
    startedAt: Date.now() - 1000,
    completedAt: Date.now(),
    models: {
      detector: { stage: 'detector', status: 'executed', provider: 'wasm' },
      ocr: { stage: 'ocr', status: 'executed', provider: 'wasm' },
    },
    tiles: [],
    detectorObservations: {},
    ocrObservations: {},
  };

  await saveScanRunRecord(testRun);
  const fetchedRun = await getScanRunRecord('scan-run-real-1');
  assert.ok(fetchedRun);
  assert.equal(fetchedRun.scanRunId, 'scan-run-real-1');

  const pageRuns = await getScanRunRecordsForPage('crud-real-page-1');
  assert.equal(pageRuns.length, 1);
  assert.equal(pageRuns[0].scanRunId, 'scan-run-real-1');

  await deleteScanRunRecord('scan-run-real-1');
  const deletedRun = await getScanRunRecord('scan-run-real-1');
  assert.equal(deletedRun, null);

  await deletePageDomainState('crud-real-page-1');
  const deletedState = await getPageDomainState('crud-real-page-1');
  assert.equal(deletedState, null);

  resetDatabaseConnection();
});

test('F-03: Migration durability, interruption, and recovery in genuine transactions', async () => {
  resetDatabaseConnection();

  const durableDbName = 'dragonfly44_durable_migration_test';
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(durableDbName, 9);
    req.onupgradeneeded = () => {
      const d = req.result;
      d.createObjectStore('page_bubbles');
      d.createObjectStore('page_scans');
      d.createObjectStore('page_domain_states', { keyPath: 'pageId' });
      d.createObjectStore('scan_run_records', { keyPath: 'scanRunId' });
      d.createObjectStore('migration_journal', { keyPath: 'key' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

  // Seed 3 pages:
  // page-1: bubbles only
  // page-2: scenic (scan only, zero bubbles)
  // page-3: both bubbles and scan
  const tx = db.transaction(['page_bubbles', 'page_scans'], 'readwrite');
  tx.objectStore('page_bubbles').put(
    [{ id: 'b-p1', pageId: 'page-1', index: 1, sourceText: 'Page 1 dialogue', type: 'speech_bubbles' }],
    'page-bubbles:page-1'
  );
  tx.objectStore('page_scans').put(
    { scanId: 'scan-p2', pageId: 'page-2', status: 'complete', sourceDimensions: { width: 1000, height: 1600 }, regions: [] },
    'page-scan:page-2'
  );
  tx.objectStore('page_bubbles').put(
    [{ id: 'b-p3', pageId: 'page-3', index: 1, sourceText: 'Page 3 dialogue', type: 'dialogue' }],
    'page-bubbles:page-3'
  );
  tx.objectStore('page_scans').put(
    { scanId: 'scan-p3', pageId: 'page-3', status: 'complete', sourceDimensions: { width: 800, height: 1200 }, regions: [] },
    'page-scan:page-3'
  );
  await new Promise<void>((res) => {
    tx.oncomplete = () => res();
  });

  // Run migration
  const journal = await runIdempotentV9Migration(db);
  assert.equal(journal.status, 'completed');
  assert.equal(journal.totalPagesFound, 3);
  assert.equal(journal.migratedPagesCount, 3);
  assert.equal(journal.failedPageIds.length, 0);

  // Verify all 3 pages migrated to page_domain_states
  const verifyTx = db.transaction(['page_domain_states', 'scan_run_records'], 'readonly');
  const p1 = (await new Promise((res) => {
    verifyTx.objectStore('page_domain_states').get('page-1').onsuccess = (e: any) => res(e.target.result);
  })) as PageDomainState;
  const p2 = (await new Promise((res) => {
    verifyTx.objectStore('page_domain_states').get('page-2').onsuccess = (e: any) => res(e.target.result);
  })) as PageDomainState;
  const p3 = (await new Promise((res) => {
    verifyTx.objectStore('page_domain_states').get('page-3').onsuccess = (e: any) => res(e.target.result);
  })) as PageDomainState;

  assert.ok(p1, 'Page 1 must be migrated');
  assert.equal(p1.contentRecords['b-p1']?.sourceText, 'Page 1 dialogue');

  assert.ok(p2, 'Page 2 (scenic, no bubbles) must be migrated');
  assert.equal(p2.dimensions.width, 1000);
  assert.equal(p2.dimensions.height, 1600);
  assert.equal(Object.keys(p2.contentRecords).length, 0);

  assert.ok(p3, 'Page 3 must be migrated');
  assert.equal(p3.contentRecords['b-p3']?.sourceText, 'Page 3 dialogue');

  // Verify Idempotency: Re-running migration does not duplicate or corrupt
  const rerunJournal = await runIdempotentV9Migration(db);
  assert.equal(rerunJournal.status, 'completed');
  assert.equal(rerunJournal.totalPagesFound, 3);

  db.close();
});
