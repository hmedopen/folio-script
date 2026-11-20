import assert from 'node:assert/strict';
import test from 'node:test';
import type {
  PhysicalContainer,
  TextRegion,
  ContentRecord,
  PageDomainState,
  ScanRunRecord,
} from '../../types/domain/index.ts';

test('domain contracts support PhysicalContainer with concave body contour and empty state', () => {
  const container: PhysicalContainer = {
    containerId: 'c-empty-1',
    pageId: 'page-1',
    containerType: 'shout_burst',
    geometry: {
      bodyContour: [
        [0, 0],
        [100, 50],
        [200, 0],
        [200, 200],
        [0, 200],
      ],
      tails: [],
    },
    confidence: 0.98,
    boundaryUncertain: false,
    zIndex: 1,
    state: 'empty',
    provenance: {
      geometry: { source: 'local_detector', updatedAt: 1774044000000 },
      containerType: { source: 'local_detector', updatedAt: 1774044000000 },
    },
  };

  assert.equal(container.state, 'empty');
  assert.equal(container.geometry.bodyContour.length, 5);
  assert.equal(container.geometry.tails.length, 0);
});

test('domain contracts support unattached_content with empty regionTargets', () => {
  const unattachedRecord: ContentRecord = {
    contentId: 'cr-unattached-1',
    pageId: 'page-1',
    regionTargets: [], // 0 targets verified
    contentType: 'dialogue',
    speakerIds: ['char-kenshin'],
    sourceText: 'I will not draw my blade.',
    originalOcrText: 'I will not draw my blade.',
    translatedText: 'لن أسحب سيفي.',
    translationHistory: [],
    typerTag: { id: 'speech_bubbles', prefix: '"":' },
    status: 'unattached_content',
    orderState: { isUserPinned: true, pinnedAt: 1774044000000 },
    reviewFlags: [],
    provenance: {
      sourceText: { source: 'user_manual', updatedAt: 1774044000000 },
      translatedText: { source: 'user_manual', updatedAt: 1774044000000 },
      typerTag: { source: 'user_manual', updatedAt: 1774044000000 },
      speakerIds: { source: 'user_manual', updatedAt: 1774044000000 },
      contentType: { source: 'user_manual', updatedAt: 1774044000000 },
      regionTargets: { source: 'user_manual', updatedAt: 1774044000000 },
    },
  };

  assert.equal(unattachedRecord.status, 'unattached_content');
  assert.equal(unattachedRecord.regionTargets.length, 0);
  assert.equal(unattachedRecord.provenance.sourceText.source, 'user_manual');
});

test('domain contracts support borderless TextRegion with null containerId', () => {
  const borderlessRegion: TextRegion = {
    regionId: 'reg-borderless-1',
    pageId: 'page-1',
    containerId: null, // No container
    containerAssociation: 'borderless',
    geometry: {
      pixelPolygon: [
        [50, 50],
        [200, 50],
        [200, 150],
        [50, 150],
      ],
    },
    orientation: 'horizontal',
    lineObservationIds: ['obs-line-1'],
    rubyAnnotations: [],
    confidence: 0.95,
    lifecycleState: 'active',
    provenance: {
      geometry: { source: 'local_detector', updatedAt: 1774044000000 },
      containerId: { source: 'local_detector', updatedAt: 1774044000000 },
    },
  };

  assert.equal(borderlessRegion.containerId, null);
  assert.equal(borderlessRegion.containerAssociation, 'borderless');
});

test('domain contracts support ScanRunRecord with zero observations for failed or cancelled scans', () => {
  const failedScan: ScanRunRecord = {
    scanRunId: 'scan-cancelled-1',
    pageId: 'page-1',
    status: 'cancelled',
    startedAt: 1774044000000,
    completedAt: 1774044001000,
    models: {
      detector: {
        stage: 'detector',
        status: 'skipped',
        provider: 'none',
        modelId: null,
      },
      ocr: {
        stage: 'ocr',
        status: 'failed',
        provider: 'wasm',
        modelId: 'ppocrv5',
        error: 'Scan aborted by user',
      },
    },
    tiles: [],
    detectorObservations: {}, // Zero observations supported
    ocrObservations: {},      // Zero observations supported
    errorMessage: 'Scan aborted by user signal',
  };

  assert.equal(failedScan.status, 'cancelled');
  assert.equal(Object.keys(failedScan.detectorObservations).length, 0);
  assert.equal(Object.keys(failedScan.ocrObservations).length, 0);
});

test('PageDomainState maintains readingSequence as the sole authoritative order', () => {
  const pageState: PageDomainState = {
    pageId: 'page-1',
    dimensions: { width: 1200, height: 1800 },
    spatialGroups: {},
    containers: {},
    textRegions: {},
    contentRecords: {
      'cr-1': {
        contentId: 'cr-1',
        pageId: 'page-1',
        regionTargets: [{ regionId: 'r-1' }],
        contentType: 'dialogue',
        speakerIds: ['char-1', 'char-2'], // Joint dialogue
        sourceText: 'Hello',
        originalOcrText: 'Hello',
        translatedText: 'مرحبا',
        translationHistory: [],
        typerTag: { id: 'speech_bubbles', prefix: '"":' },
        status: 'active',
        orderState: { isUserPinned: true },
        reviewFlags: [],
        provenance: {
          sourceText: { source: 'user_manual', updatedAt: 1774044000000 },
          translatedText: { source: 'user_manual', updatedAt: 1774044000000 },
          typerTag: { source: 'user_manual', updatedAt: 1774044000000 },
          speakerIds: { source: 'user_manual', updatedAt: 1774044000000 },
          contentType: { source: 'user_manual', updatedAt: 1774044000000 },
          regionTargets: { source: 'user_manual', updatedAt: 1774044000000 },
        },
      },
    },
    readingSequence: ['cr-1'],
    issues: [],
    version: 9,
    updatedAt: 1774044000000,
  };

  assert.deepEqual(pageState.readingSequence, ['cr-1']);
  assert.equal(pageState.contentRecords['cr-1'].speakerIds.length, 2);
});
