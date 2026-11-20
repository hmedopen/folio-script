import test from 'node:test';
import assert from 'node:assert/strict';
import type { PageDomainState } from '../../types/domain/index.ts';
import { reconcileDomainStates } from '../../lib/domain/rescanReconciliation.ts';

function createSamplePageState(overrides?: Partial<PageDomainState>): PageDomainState {
  return {
    pageId: 'page-recon-1',
    chapterId: 'ch-1',
    dimensions: { width: 1000, height: 1000 },
    spatialGroups: {},
    containers: {},
    textRegions: {},
    contentRecords: {},
    readingSequence: [],
    issues: [],
    version: 9,
    updatedAt: 1774000000000,
    ...overrides,
  };
}

test('Milestone 4.4: Rescan preserves manual edits, translations, speakers, and custom typers while updating unedited text', () => {
  // Existing state with 2 bubbles:
  // 1. Manually edited with translation and speaker
  // 2. Unedited auto scan
  const existingState = createSamplePageState({
    containers: {
      'c-1': {
        containerId: 'c-1',
        pageId: 'page-recon-1',
        containerType: 'speech_balloon',
        geometry: { bodyContour: [[100, 100], [300, 100], [300, 250], [100, 250]], tails: [] },
        confidence: 0.95,
        boundaryUncertain: false,
        zIndex: 1,
        state: 'active',
        provenance: {
          geometry: { source: 'local_detector', updatedAt: 1774000000000 },
          containerType: { source: 'local_detector', updatedAt: 1774000000000 },
        },
      },
      'c-2': {
        containerId: 'c-2',
        pageId: 'page-recon-1',
        containerType: 'speech_balloon',
        geometry: { bodyContour: [[500, 500], [700, 500], [700, 650], [500, 650]], tails: [] },
        confidence: 0.92,
        boundaryUncertain: false,
        zIndex: 2,
        state: 'active',
        provenance: {
          geometry: { source: 'local_detector', updatedAt: 1774000000000 },
          containerType: { source: 'local_detector', updatedAt: 1774000000000 },
        },
      },
    },
    textRegions: {
      'r-1': {
        regionId: 'r-1',
        pageId: 'page-recon-1',
        containerId: 'c-1',
        containerAssociation: 'associated',
        geometry: { pixelPolygon: [[110, 110], [290, 110], [290, 240], [110, 240]] },
        orientation: 'horizontal',
        lineObservationIds: ['line-old-1'],
        rubyAnnotations: [],
        confidence: 0.95,
        lifecycleState: 'active',
        provenance: {
          geometry: { source: 'ocr_engine', updatedAt: 1774000000000 },
          containerId: { source: 'local_detector', updatedAt: 1774000000000 },
        },
      },
      'r-2': {
        regionId: 'r-2',
        pageId: 'page-recon-1',
        containerId: 'c-2',
        containerAssociation: 'associated',
        geometry: { pixelPolygon: [[510, 510], [690, 510], [690, 640], [510, 640]] },
        orientation: 'horizontal',
        lineObservationIds: ['line-old-2'],
        rubyAnnotations: [],
        confidence: 0.90,
        lifecycleState: 'active',
        provenance: {
          geometry: { source: 'ocr_engine', updatedAt: 1774000000000 },
          containerId: { source: 'local_detector', updatedAt: 1774000000000 },
        },
      },
    },
    contentRecords: {
      'cr-manual-1': {
        contentId: 'cr-manual-1',
        pageId: 'page-recon-1',
        regionTargets: [{ regionId: 'r-1' }],
        contentType: 'dialogue',
        speakerIds: ['char-batman'],
        sourceText: 'I am vengeance! (User corrected)',
        originalOcrText: 'I am vengence',
        translatedText: 'أنا الانتقام!',
        translationHistory: [
          { versionId: 'v1', timestamp: 1774000000000, text: 'أنا الانتقام!', type: 'manual' },
        ],
        typerTag: { id: 'custom_hero_speech', prefix: 'HERO:' },
        status: 'active',
        orderState: { isUserPinned: true, pinnedAt: 1774000000000 },
        reviewFlags: [],
        provenance: {
          sourceText: { source: 'user_manual', updatedAt: 1774000000000 },
          translatedText: { source: 'user_manual', updatedAt: 1774000000000 },
          typerTag: { source: 'user_manual', updatedAt: 1774000000000 },
          speakerIds: { source: 'user_manual', updatedAt: 1774000000000 },
          contentType: { source: 'user_manual', updatedAt: 1774000000000 },
          regionTargets: { source: 'user_manual', updatedAt: 1774000000000 },
        },
      },
      'cr-auto-2': {
        contentId: 'cr-auto-2',
        pageId: 'page-recon-1',
        regionTargets: [{ regionId: 'r-2' }],
        contentType: 'dialogue',
        speakerIds: [],
        sourceText: 'Old noisy text',
        originalOcrText: 'Old noisy text',
        translatedText: '',
        translationHistory: [],
        typerTag: { id: 'speech_bubbles', prefix: '"":' },
        status: 'active',
        orderState: { isUserPinned: false },
        reviewFlags: [],
        provenance: {
          sourceText: { source: 'ocr_engine', updatedAt: 1774000000000 },
          translatedText: { source: 'ocr_engine', updatedAt: 1774000000000 },
          typerTag: { source: 'local_detector', updatedAt: 1774000000000 },
          speakerIds: { source: 'local_detector', updatedAt: 1774000000000 },
          contentType: { source: 'local_detector', updatedAt: 1774000000000 },
          regionTargets: { source: 'ocr_engine', updatedAt: 1774000000000 },
        },
      },
    },
    readingSequence: ['cr-manual-1', 'cr-auto-2'],
  });

  // Rescan state with improved OCR models:
  // Region 1 has slightly different OCR 'I am vengeance!'
  // Region 2 has clean OCR 'Crystal clear text'
  const newState = createSamplePageState({
    containers: { ...existingState.containers },
    textRegions: {
      'r-new-1': {
        regionId: 'r-new-1',
        pageId: 'page-recon-1',
        containerId: 'c-1',
        containerAssociation: 'associated',
        geometry: { pixelPolygon: [[105, 105], [295, 105], [295, 245], [105, 245]] },
        orientation: 'horizontal',
        lineObservationIds: ['line-new-1'],
        rubyAnnotations: [],
        confidence: 0.99,
        lifecycleState: 'active',
        provenance: {
          geometry: { source: 'ocr_engine', updatedAt: 1774000050000 },
          containerId: { source: 'local_detector', updatedAt: 1774000050000 },
        },
      },
      'r-new-2': {
        regionId: 'r-new-2',
        pageId: 'page-recon-1',
        containerId: 'c-2',
        containerAssociation: 'associated',
        geometry: { pixelPolygon: [[505, 505], [695, 505], [695, 645], [505, 645]] },
        orientation: 'horizontal',
        lineObservationIds: ['line-new-2'],
        rubyAnnotations: [],
        confidence: 0.98,
        lifecycleState: 'active',
        provenance: {
          geometry: { source: 'ocr_engine', updatedAt: 1774000050000 },
          containerId: { source: 'local_detector', updatedAt: 1774000050000 },
        },
      },
    },
    contentRecords: {
      'cr-new-1': {
        contentId: 'cr-new-1',
        pageId: 'page-recon-1',
        regionTargets: [{ regionId: 'r-new-1' }],
        contentType: 'dialogue',
        speakerIds: [],
        sourceText: 'I am vengeance!',
        originalOcrText: 'I am vengeance!',
        translatedText: '',
        translationHistory: [],
        typerTag: { id: 'speech_bubbles', prefix: '"":' },
        status: 'active',
        orderState: { isUserPinned: false },
        reviewFlags: [],
        provenance: {
          sourceText: { source: 'ocr_engine', updatedAt: 1774000050000 },
          translatedText: { source: 'ocr_engine', updatedAt: 1774000050000 },
          typerTag: { source: 'local_detector', updatedAt: 1774000050000 },
          speakerIds: { source: 'local_detector', updatedAt: 1774000050000 },
          contentType: { source: 'local_detector', updatedAt: 1774000050000 },
          regionTargets: { source: 'ocr_engine', updatedAt: 1774000050000 },
        },
      },
      'cr-new-2': {
        contentId: 'cr-new-2',
        pageId: 'page-recon-1',
        regionTargets: [{ regionId: 'r-new-2' }],
        contentType: 'dialogue',
        speakerIds: [],
        sourceText: 'Crystal clear text',
        originalOcrText: 'Crystal clear text',
        translatedText: '',
        translationHistory: [],
        typerTag: { id: 'speech_bubbles', prefix: '"":' },
        status: 'active',
        orderState: { isUserPinned: false },
        reviewFlags: [],
        provenance: {
          sourceText: { source: 'ocr_engine', updatedAt: 1774000050000 },
          translatedText: { source: 'ocr_engine', updatedAt: 1774000050000 },
          typerTag: { source: 'local_detector', updatedAt: 1774000050000 },
          speakerIds: { source: 'local_detector', updatedAt: 1774000050000 },
          contentType: { source: 'local_detector', updatedAt: 1774000050000 },
          regionTargets: { source: 'ocr_engine', updatedAt: 1774000050000 },
        },
      },
    },
    readingSequence: ['cr-new-1', 'cr-new-2'],
  });

  const { reconciledState, report } = reconcileDomainStates(existingState, newState);

  assert.equal(report.matchedCount, 2);
  assert.equal(report.preservedManualEditsCount, 1);

  // 1. Verify Identity and Manual Edit Preservation on record 1
  const rec1 = reconciledState.contentRecords['cr-manual-1'];
  assert.ok(rec1, 'Record 1 identity cr-manual-1 must be preserved');
  assert.equal(rec1.sourceText, 'I am vengeance! (User corrected)', 'User manual sourceText must NOT be overwritten');
  assert.equal(rec1.originalOcrText, 'I am vengeance!', 'originalOcrText should reflect new scan');
  assert.equal(rec1.translatedText, 'أنا الانتقام!', 'Manual translation must be preserved');
  assert.equal(rec1.translationHistory.length, 1);
  assert.deepEqual(rec1.speakerIds, ['char-batman'], 'Speaker character must be preserved');
  assert.equal(rec1.typerTag.id, 'custom_hero_speech', 'Custom typer must be preserved');
  assert.equal(rec1.orderState.isUserPinned, true);

  // 2. Verify unedited record 2 was updated with fresh OCR
  const rec2 = reconciledState.contentRecords['cr-auto-2'];
  assert.ok(rec2, 'Record 2 identity cr-auto-2 must be preserved');
  assert.equal(rec2.sourceText, 'Crystal clear text', 'Unedited record must adopt improved OCR text');
  assert.equal(rec2.originalOcrText, 'Crystal clear text');
});

test('Milestone 4.4: Split detection and missing records are preserved without silent data loss', () => {
  // Existing state has 1 bubble that in reality contains 2 dialogue sections, and 1 manual borderless note
  const existingState = createSamplePageState({
    containers: {
      'c-big': {
        containerId: 'c-big',
        pageId: 'page-recon-1',
        containerType: 'speech_balloon',
        geometry: { bodyContour: [[100, 100], [400, 100], [400, 400], [100, 400]], tails: [] },
        confidence: 0.95,
        boundaryUncertain: false,
        zIndex: 1,
        state: 'active',
        provenance: {
          geometry: { source: 'local_detector', updatedAt: 1774000000000 },
          containerType: { source: 'local_detector', updatedAt: 1774000000000 },
        },
      },
    },
    textRegions: {
      'r-combined': {
        regionId: 'r-combined',
        pageId: 'page-recon-1',
        containerId: 'c-big',
        containerAssociation: 'associated',
        geometry: { pixelPolygon: [[120, 120], [380, 120], [380, 380], [120, 380]] },
        orientation: 'horizontal',
        lineObservationIds: ['line-comb'],
        rubyAnnotations: [],
        confidence: 0.85,
        lifecycleState: 'active',
        provenance: {
          geometry: { source: 'ocr_engine', updatedAt: 1774000000000 },
          containerId: { source: 'local_detector', updatedAt: 1774000000000 },
        },
      },
      'r-missing-manual': {
        regionId: 'r-missing-manual',
        pageId: 'page-recon-1',
        containerId: null,
        containerAssociation: 'borderless',
        geometry: { pixelPolygon: [[800, 800], [950, 800], [950, 900], [800, 900]] },
        orientation: 'horizontal',
        lineObservationIds: ['line-note'],
        rubyAnnotations: [],
        confidence: 1.0,
        lifecycleState: 'active',
        provenance: {
          geometry: { source: 'user_manual', updatedAt: 1774000000000 },
          containerId: { source: 'user_manual', updatedAt: 1774000000000 },
        },
      },
    },
    contentRecords: {
      'cr-existing-bubble': {
        contentId: 'cr-existing-bubble',
        pageId: 'page-recon-1',
        regionTargets: [{ regionId: 'r-combined' }],
        contentType: 'dialogue',
        speakerIds: [],
        sourceText: 'Part one. Part two.',
        originalOcrText: 'Part one. Part two.',
        translatedText: 'الجزء الأول. الجزء الثاني.',
        translationHistory: [],
        typerTag: { id: 'speech_bubbles', prefix: '"":' },
        status: 'active',
        orderState: { isUserPinned: false },
        reviewFlags: [],
        provenance: {
          sourceText: { source: 'ocr_engine', updatedAt: 1774000000000 },
          translatedText: { source: 'ocr_engine', updatedAt: 1774000000000 },
          typerTag: { source: 'local_detector', updatedAt: 1774000000000 },
          speakerIds: { source: 'local_detector', updatedAt: 1774000000000 },
          contentType: { source: 'local_detector', updatedAt: 1774000000000 },
          regionTargets: { source: 'ocr_engine', updatedAt: 1774000000000 },
        },
      },
      'cr-manual-translator-note': {
        contentId: 'cr-manual-translator-note',
        pageId: 'page-recon-1',
        regionTargets: [{ regionId: 'r-missing-manual' }],
        contentType: 'translator_note',
        speakerIds: [],
        sourceText: 'TN: A pun on words',
        originalOcrText: 'TN: A pun on words',
        translatedText: 'ملاحظة: تورية لفظية',
        translationHistory: [],
        typerTag: { id: 'outside_text', prefix: 'TN:' },
        status: 'active',
        orderState: { isUserPinned: true },
        reviewFlags: [],
        provenance: {
          sourceText: { source: 'user_manual', updatedAt: 1774000000000 },
          translatedText: { source: 'user_manual', updatedAt: 1774000000000 },
          typerTag: { source: 'user_manual', updatedAt: 1774000000000 },
          speakerIds: { source: 'user_manual', updatedAt: 1774000000000 },
          contentType: { source: 'user_manual', updatedAt: 1774000000000 },
          regionTargets: { source: 'user_manual', updatedAt: 1774000000000 },
        },
      },
    },
    readingSequence: ['cr-existing-bubble', 'cr-manual-translator-note'],
  });

  // Rescan splits container c-big into 2 distinct sections:
  // Section 1 at top: [120, 120, 200, 380] 'Part one.'
  // Section 2 at bottom: [280, 120, 360, 380] 'Part two.'
  // And the rescan missed the manual translator note!
  const newState = createSamplePageState({
    containers: { ...existingState.containers },
    textRegions: {
      'r-split-1': {
        regionId: 'r-split-1',
        pageId: 'page-recon-1',
        containerId: 'c-big',
        containerAssociation: 'associated',
        geometry: { pixelPolygon: [[120, 120], [380, 120], [380, 200], [120, 200]] },
        orientation: 'horizontal',
        lineObservationIds: ['line-s1'],
        rubyAnnotations: [],
        confidence: 0.95,
        lifecycleState: 'active',
        provenance: {
          geometry: { source: 'ocr_engine', updatedAt: 1774000050000 },
          containerId: { source: 'local_detector', updatedAt: 1774000050000 },
        },
      },
      'r-split-2': {
        regionId: 'r-split-2',
        pageId: 'page-recon-1',
        containerId: 'c-big',
        containerAssociation: 'associated',
        geometry: { pixelPolygon: [[120, 280], [380, 280], [380, 360], [120, 360]] },
        orientation: 'horizontal',
        lineObservationIds: ['line-s2'],
        rubyAnnotations: [],
        confidence: 0.94,
        lifecycleState: 'active',
        provenance: {
          geometry: { source: 'ocr_engine', updatedAt: 1774000050000 },
          containerId: { source: 'local_detector', updatedAt: 1774000050000 },
        },
      },
    },
    contentRecords: {
      'cr-new-part1': {
        contentId: 'cr-new-part1',
        pageId: 'page-recon-1',
        regionTargets: [{ regionId: 'r-split-1' }],
        contentType: 'dialogue',
        speakerIds: [],
        sourceText: 'Part one.',
        originalOcrText: 'Part one.',
        translatedText: '',
        translationHistory: [],
        typerTag: { id: 'speech_bubbles', prefix: '"":' },
        status: 'active',
        orderState: { isUserPinned: false },
        reviewFlags: [],
        provenance: {
          sourceText: { source: 'ocr_engine', updatedAt: 1774000050000 },
          translatedText: { source: 'ocr_engine', updatedAt: 1774000050000 },
          typerTag: { source: 'local_detector', updatedAt: 1774000050000 },
          speakerIds: { source: 'local_detector', updatedAt: 1774000050000 },
          contentType: { source: 'local_detector', updatedAt: 1774000050000 },
          regionTargets: { source: 'ocr_engine', updatedAt: 1774000050000 },
        },
      },
      'cr-new-part2': {
        contentId: 'cr-new-part2',
        pageId: 'page-recon-1',
        regionTargets: [{ regionId: 'r-split-2' }],
        contentType: 'dialogue',
        speakerIds: [],
        sourceText: 'Part two.',
        originalOcrText: 'Part two.',
        translatedText: '',
        translationHistory: [],
        typerTag: { id: 'speech_bubbles', prefix: '"":' },
        status: 'active',
        orderState: { isUserPinned: false },
        reviewFlags: [],
        provenance: {
          sourceText: { source: 'ocr_engine', updatedAt: 1774000050000 },
          translatedText: { source: 'ocr_engine', updatedAt: 1774000050000 },
          typerTag: { source: 'local_detector', updatedAt: 1774000050000 },
          speakerIds: { source: 'local_detector', updatedAt: 1774000050000 },
          contentType: { source: 'local_detector', updatedAt: 1774000050000 },
          regionTargets: { source: 'ocr_engine', updatedAt: 1774000050000 },
        },
      },
    },
    readingSequence: ['cr-new-part1', 'cr-new-part2'],
  });

  const { reconciledState, report } = reconcileDomainStates(existingState, newState);

  // 1. Split Detection verification
  assert.equal(report.splitCount, 1, 'Split detection count must be 1');
  assert.ok(reconciledState.issues.some((i) => i.flag === 'SPLIT_DETECTED'));

  // 2. Missing Record Preservation (Zero Data Loss)
  assert.equal(report.missingPreservedCount, 1, 'Missing record must be preserved');
  const missingNote = reconciledState.contentRecords['cr-manual-translator-note'];
  assert.ok(missingNote, 'Manual translator note must NOT be deleted');
  assert.equal(missingNote.status, 'unattached_content');
  assert.equal(missingNote.sourceText, 'TN: A pun on words');
  assert.equal(missingNote.translatedText, 'ملاحظة: تورية لفظية');
  assert.ok(reconciledState.issues.some((i) => i.flag === 'UNMATCHED_EXISTING_RECORD'));

  // 3. Both split section records exist in the reconciled state
  assert.ok(reconciledState.contentRecords['cr-existing-bubble']);
  const splitSectionRecord =
    reconciledState.contentRecords['cr-new-part1'] ||
    reconciledState.contentRecords['cr-new-part2'];
  assert.ok(splitSectionRecord, 'Split section record must exist');
});

test('Milestone 4.4: Ambiguous matches generate non-blocking ScanIssues and preserve pinned reading sequence', () => {
  // Existing state has 2 bubbles with pinned order
  const existingState = createSamplePageState({
    contentRecords: {
      'cr-pinned-1': {
        contentId: 'cr-pinned-1',
        pageId: 'page-recon-1',
        regionTargets: [{ regionId: 'r-amb-1' }],
        contentType: 'dialogue',
        speakerIds: [],
        sourceText: 'Who goes there?',
        originalOcrText: 'Who goes there?',
        translatedText: '',
        translationHistory: [],
        typerTag: { id: 'speech_bubbles', prefix: '"":' },
        status: 'active',
        orderState: { isUserPinned: true, pinnedAt: 1774000000000 },
        reviewFlags: [],
        provenance: {
          sourceText: { source: 'ocr_engine', updatedAt: 1774000000000 },
          translatedText: { source: 'ocr_engine', updatedAt: 1774000000000 },
          typerTag: { source: 'local_detector', updatedAt: 1774000000000 },
          speakerIds: { source: 'local_detector', updatedAt: 1774000000000 },
          contentType: { source: 'local_detector', updatedAt: 1774000000000 },
          regionTargets: { source: 'ocr_engine', updatedAt: 1774000000000 },
        },
      },
    },
    readingSequence: ['cr-pinned-1'],
    textRegions: {
      'r-amb-1': {
        regionId: 'r-amb-1',
        pageId: 'page-recon-1',
        containerId: null,
        containerAssociation: 'borderless',
        geometry: { pixelPolygon: [[100, 100], [250, 100], [250, 180], [100, 180]] },
        orientation: 'horizontal',
        lineObservationIds: [],
        rubyAnnotations: [],
        confidence: 0.9,
        lifecycleState: 'active',
        provenance: {
          geometry: { source: 'ocr_engine', updatedAt: 1774000000000 },
          containerId: { source: 'local_detector', updatedAt: 1774000000000 },
        },
      },
    },
  });

  // Rescan has TWO candidate regions with nearly identical geometry and text
  const newState = createSamplePageState({
    textRegions: {
      'r-cand-a': {
        regionId: 'r-cand-a',
        pageId: 'page-recon-1',
        containerId: null,
        containerAssociation: 'borderless',
        geometry: { pixelPolygon: [[102, 102], [252, 102], [252, 182], [102, 182]] },
        orientation: 'horizontal',
        lineObservationIds: [],
        rubyAnnotations: [],
        confidence: 0.9,
        lifecycleState: 'active',
        provenance: {
          geometry: { source: 'ocr_engine', updatedAt: 1774000050000 },
          containerId: { source: 'local_detector', updatedAt: 1774000050000 },
        },
      },
      'r-cand-b': {
        regionId: 'r-cand-b',
        pageId: 'page-recon-1',
        containerId: null,
        containerAssociation: 'borderless',
        geometry: { pixelPolygon: [[104, 104], [254, 104], [254, 184], [104, 184]] },
        orientation: 'horizontal',
        lineObservationIds: [],
        rubyAnnotations: [],
        confidence: 0.9,
        lifecycleState: 'active',
        provenance: {
          geometry: { source: 'ocr_engine', updatedAt: 1774000050000 },
          containerId: { source: 'local_detector', updatedAt: 1774000050000 },
        },
      },
    },
    contentRecords: {
      'cr-cand-a': {
        contentId: 'cr-cand-a',
        pageId: 'page-recon-1',
        regionTargets: [{ regionId: 'r-cand-a' }],
        contentType: 'dialogue',
        speakerIds: [],
        sourceText: 'Who goes there?',
        originalOcrText: 'Who goes there?',
        translatedText: '',
        translationHistory: [],
        typerTag: { id: 'speech_bubbles', prefix: '"":' },
        status: 'active',
        orderState: { isUserPinned: false },
        reviewFlags: [],
        provenance: {
          sourceText: { source: 'ocr_engine', updatedAt: 1774000050000 },
          translatedText: { source: 'ocr_engine', updatedAt: 1774000050000 },
          typerTag: { source: 'local_detector', updatedAt: 1774000050000 },
          speakerIds: { source: 'local_detector', updatedAt: 1774000050000 },
          contentType: { source: 'local_detector', updatedAt: 1774000050000 },
          regionTargets: { source: 'ocr_engine', updatedAt: 1774000050000 },
        },
      },
      'cr-cand-b': {
        contentId: 'cr-cand-b',
        pageId: 'page-recon-1',
        regionTargets: [{ regionId: 'r-cand-b' }],
        contentType: 'dialogue',
        speakerIds: [],
        sourceText: 'Who goes there?',
        originalOcrText: 'Who goes there?',
        translatedText: '',
        translationHistory: [],
        typerTag: { id: 'speech_bubbles', prefix: '"":' },
        status: 'active',
        orderState: { isUserPinned: false },
        reviewFlags: [],
        provenance: {
          sourceText: { source: 'ocr_engine', updatedAt: 1774000050000 },
          translatedText: { source: 'ocr_engine', updatedAt: 1774000050000 },
          typerTag: { source: 'local_detector', updatedAt: 1774000050000 },
          speakerIds: { source: 'local_detector', updatedAt: 1774000050000 },
          contentType: { source: 'local_detector', updatedAt: 1774000050000 },
          regionTargets: { source: 'ocr_engine', updatedAt: 1774000050000 },
        },
      },
    },
    readingSequence: ['cr-cand-a', 'cr-cand-b'],
  });

  const { reconciledState, report } = reconcileDomainStates(existingState, newState, {
    ambiguityDeltaThreshold: 0.08,
  });

  assert.equal(report.ambiguousCount, 1);
  assert.ok(
    reconciledState.issues.some((i) => i.flag === 'MATCH_AMBIGUOUS'),
    'Must issue MATCH_AMBIGUOUS ScanIssue'
  );

  // User-pinned record is preserved at the top of the reading sequence
  assert.equal(reconciledState.readingSequence[0], 'cr-pinned-1');
});

test('Milestone 4.4: Complex rescan with partial merge, partial split, and manual geometry preservation', () => {
  // Existing state: 3 balloons
  // - cr-1: user manually drew tight contour polygon
  // - cr-2 & cr-3: in container c-shared
  const existingState = createSamplePageState({
    containers: {
      'c-1': {
        containerId: 'c-1',
        pageId: 'page-recon-1',
        containerType: 'speech_balloon',
        geometry: { bodyContour: [[50, 50], [180, 50], [180, 150], [50, 150]], tails: [] },
        confidence: 0.95,
        boundaryUncertain: false,
        zIndex: 1,
        state: 'active',
        provenance: {
          geometry: { source: 'user_manual', updatedAt: 1774000000000 },
          containerType: { source: 'user_manual', updatedAt: 1774000000000 },
        },
      },
      'c-shared': {
        containerId: 'c-shared',
        pageId: 'page-recon-1',
        containerType: 'speech_balloon',
        geometry: { bodyContour: [[300, 300], [600, 300], [600, 600], [300, 600]], tails: [] },
        confidence: 0.95,
        boundaryUncertain: false,
        zIndex: 2,
        state: 'active',
        provenance: {
          geometry: { source: 'local_detector', updatedAt: 1774000000000 },
          containerType: { source: 'local_detector', updatedAt: 1774000000000 },
        },
      },
    },
    textRegions: {
      'r-1': {
        regionId: 'r-1',
        pageId: 'page-recon-1',
        containerId: 'c-1',
        containerAssociation: 'associated',
        geometry: { pixelPolygon: [[55, 55], [175, 55], [175, 145], [55, 145]] },
        orientation: 'horizontal',
        lineObservationIds: [],
        rubyAnnotations: [],
        confidence: 0.95,
        lifecycleState: 'active',
        provenance: {
          geometry: { source: 'user_manual', updatedAt: 1774000000000 },
          containerId: { source: 'user_manual', updatedAt: 1774000000000 },
        },
      },
      'r-2': {
        regionId: 'r-2',
        pageId: 'page-recon-1',
        containerId: 'c-shared',
        containerAssociation: 'associated',
        geometry: { pixelPolygon: [[310, 310], [450, 310], [450, 420], [310, 420]] },
        orientation: 'horizontal',
        lineObservationIds: [],
        rubyAnnotations: [],
        confidence: 0.9,
        lifecycleState: 'active',
        provenance: {
          geometry: { source: 'ocr_engine', updatedAt: 1774000000000 },
          containerId: { source: 'local_detector', updatedAt: 1774000000000 },
        },
      },
      'r-3': {
        regionId: 'r-3',
        pageId: 'page-recon-1',
        containerId: 'c-shared',
        containerAssociation: 'associated',
        geometry: { pixelPolygon: [[460, 310], [590, 310], [590, 420], [460, 420]] },
        orientation: 'horizontal',
        lineObservationIds: [],
        rubyAnnotations: [],
        confidence: 0.9,
        lifecycleState: 'active',
        provenance: {
          geometry: { source: 'ocr_engine', updatedAt: 1774000000000 },
          containerId: { source: 'local_detector', updatedAt: 1774000000000 },
        },
      },
    },
    contentRecords: {
      'cr-1': {
        contentId: 'cr-1',
        pageId: 'page-recon-1',
        regionTargets: [{ regionId: 'r-1' }],
        contentType: 'dialogue',
        speakerIds: [],
        sourceText: 'Manual balloon text',
        originalOcrText: 'Manual balloon text',
        translatedText: 'نص يدوي',
        translationHistory: [],
        typerTag: { id: 'speech_bubbles', prefix: '"":' },
        status: 'active',
        orderState: { isUserPinned: true },
        reviewFlags: [],
        provenance: {
          sourceText: { source: 'user_manual', updatedAt: 1774000000000 },
          translatedText: { source: 'user_manual', updatedAt: 1774000000000 },
          typerTag: { source: 'user_manual', updatedAt: 1774000000000 },
          speakerIds: { source: 'user_manual', updatedAt: 1774000000000 },
          contentType: { source: 'user_manual', updatedAt: 1774000000000 },
          regionTargets: { source: 'user_manual', updatedAt: 1774000000000 },
        },
      },
      'cr-2': {
        contentId: 'cr-2',
        pageId: 'page-recon-1',
        regionTargets: [{ regionId: 'r-2' }],
        contentType: 'dialogue',
        speakerIds: [],
        sourceText: 'Part A',
        originalOcrText: 'Part A',
        translatedText: 'الجزء أ',
        translationHistory: [],
        typerTag: { id: 'speech_bubbles', prefix: '"":' },
        status: 'active',
        orderState: { isUserPinned: false },
        reviewFlags: [],
        provenance: {
          sourceText: { source: 'ocr_engine', updatedAt: 1774000000000 },
          translatedText: { source: 'user_manual', updatedAt: 1774000000000 },
          typerTag: { source: 'local_detector', updatedAt: 1774000000000 },
          speakerIds: { source: 'local_detector', updatedAt: 1774000000000 },
          contentType: { source: 'local_detector', updatedAt: 1774000000000 },
          regionTargets: { source: 'ocr_engine', updatedAt: 1774000000000 },
        },
      },
      'cr-3': {
        contentId: 'cr-3',
        pageId: 'page-recon-1',
        regionTargets: [{ regionId: 'r-3' }],
        contentType: 'dialogue',
        speakerIds: [],
        sourceText: 'Part B',
        originalOcrText: 'Part B',
        translatedText: 'الجزء ب',
        translationHistory: [],
        typerTag: { id: 'speech_bubbles', prefix: '"":' },
        status: 'active',
        orderState: { isUserPinned: false },
        reviewFlags: [],
        provenance: {
          sourceText: { source: 'ocr_engine', updatedAt: 1774000000000 },
          translatedText: { source: 'user_manual', updatedAt: 1774000000000 },
          typerTag: { source: 'local_detector', updatedAt: 1774000000000 },
          speakerIds: { source: 'local_detector', updatedAt: 1774000000000 },
          contentType: { source: 'local_detector', updatedAt: 1774000000000 },
          regionTargets: { source: 'ocr_engine', updatedAt: 1774000000000 },
        },
      },
    },
    readingSequence: ['cr-1', 'cr-2', 'cr-3'],
  });

  // Rescan:
  // - cr-1 detected with auto rough box [[40, 40], [200, 40], [200, 160], [40, 160]]
  // - cr-2 & cr-3 merged into a single region r-merged covering Part A and Part B!
  const newState = createSamplePageState({
    containers: {
      'c-new-1': {
        containerId: 'c-new-1',
        pageId: 'page-recon-1',
        containerType: 'speech_balloon',
        geometry: { bodyContour: [[40, 40], [200, 40], [200, 160], [40, 160]], tails: [] },
        confidence: 0.9,
        boundaryUncertain: false,
        zIndex: 1,
        state: 'active',
        provenance: {
          geometry: { source: 'local_detector', updatedAt: 1774000050000 },
          containerType: { source: 'local_detector', updatedAt: 1774000050000 },
        },
      },
      'c-new-merged': {
        containerId: 'c-new-merged',
        pageId: 'page-recon-1',
        containerType: 'speech_balloon',
        geometry: { bodyContour: [[300, 300], [600, 300], [600, 600], [300, 600]], tails: [] },
        confidence: 0.95,
        boundaryUncertain: false,
        zIndex: 2,
        state: 'active',
        provenance: {
          geometry: { source: 'local_detector', updatedAt: 1774000050000 },
          containerType: { source: 'local_detector', updatedAt: 1774000050000 },
        },
      },
    },
    textRegions: {
      'r-new-1': {
        regionId: 'r-new-1',
        pageId: 'page-recon-1',
        containerId: 'c-new-1',
        containerAssociation: 'associated',
        geometry: { pixelPolygon: [[45, 45], [195, 45], [195, 155], [45, 155]] },
        orientation: 'horizontal',
        lineObservationIds: [],
        rubyAnnotations: [],
        confidence: 0.9,
        lifecycleState: 'active',
        provenance: {
          geometry: { source: 'ocr_engine', updatedAt: 1774000050000 },
          containerId: { source: 'local_detector', updatedAt: 1774000050000 },
        },
      },
      'r-new-merged': {
        regionId: 'r-new-merged',
        pageId: 'page-recon-1',
        containerId: 'c-new-merged',
        containerAssociation: 'associated',
        geometry: { pixelPolygon: [[310, 310], [590, 310], [590, 420], [310, 420]] },
        orientation: 'horizontal',
        lineObservationIds: [],
        rubyAnnotations: [],
        confidence: 0.95,
        lifecycleState: 'active',
        provenance: {
          geometry: { source: 'ocr_engine', updatedAt: 1774000050000 },
          containerId: { source: 'local_detector', updatedAt: 1774000050000 },
        },
      },
    },
    contentRecords: {
      'cr-new-1': {
        contentId: 'cr-new-1',
        pageId: 'page-recon-1',
        regionTargets: [{ regionId: 'r-new-1' }],
        contentType: 'dialogue',
        speakerIds: [],
        sourceText: 'Manual balloon text',
        originalOcrText: 'Manual balloon text',
        translatedText: '',
        translationHistory: [],
        typerTag: { id: 'speech_bubbles', prefix: '"":' },
        status: 'active',
        orderState: { isUserPinned: false },
        reviewFlags: [],
        provenance: {
          sourceText: { source: 'ocr_engine', updatedAt: 1774000050000 },
          translatedText: { source: 'ocr_engine', updatedAt: 1774000050000 },
          typerTag: { source: 'local_detector', updatedAt: 1774000050000 },
          speakerIds: { source: 'local_detector', updatedAt: 1774000050000 },
          contentType: { source: 'local_detector', updatedAt: 1774000050000 },
          regionTargets: { source: 'ocr_engine', updatedAt: 1774000050000 },
        },
      },
      'cr-new-merged': {
        contentId: 'cr-new-merged',
        pageId: 'page-recon-1',
        regionTargets: [{ regionId: 'r-new-merged' }],
        contentType: 'dialogue',
        speakerIds: [],
        sourceText: 'Part A Part B',
        originalOcrText: 'Part A Part B',
        translatedText: '',
        translationHistory: [],
        typerTag: { id: 'speech_bubbles', prefix: '"":' },
        status: 'active',
        orderState: { isUserPinned: false },
        reviewFlags: [],
        provenance: {
          sourceText: { source: 'ocr_engine', updatedAt: 1774000050000 },
          translatedText: { source: 'ocr_engine', updatedAt: 1774000050000 },
          typerTag: { source: 'local_detector', updatedAt: 1774000050000 },
          speakerIds: { source: 'local_detector', updatedAt: 1774000050000 },
          contentType: { source: 'local_detector', updatedAt: 1774000050000 },
          regionTargets: { source: 'ocr_engine', updatedAt: 1774000050000 },
        },
      },
    },
    readingSequence: ['cr-new-1', 'cr-new-merged'],
  });

  const { reconciledState, report } = reconcileDomainStates(existingState, newState);

  // 1. Merge count is detected and diagnosed
  assert.ok(report.mergeCount >= 1, 'Must detect merge of Part A and Part B');
  assert.ok(reconciledState.issues.some((i) => i.flag === 'MERGE_DETECTED'), 'Must create MERGE_DETECTED issue');

  // 2. Manual geometry is preserved for cr-1
  const recTr1 = reconciledState.textRegions['r-new-1'];
  assert.deepEqual(recTr1.geometry.pixelPolygon, [[55, 55], [175, 55], [175, 145], [55, 145]], 'Must preserve user manual polygon vertices');
  assert.equal(recTr1.provenance.geometry.source, 'user_manual');

  // 3. User manual container geometry is preserved
  const recC1 = reconciledState.containers['c-new-1'];
  assert.deepEqual(recC1.geometry.bodyContour, [[50, 50], [180, 50], [180, 150], [50, 150]], 'Must preserve user manual container bodyContour');
  assert.equal(recC1.provenance.geometry.source, 'user_manual');

  // 4. Zero loss of manual translations across the merge
  assert.equal(reconciledState.contentRecords['cr-1'].translatedText, 'نص يدوي');
});

test('Milestone 4.4: Missing unattached records are re-anchored to their local context in reading sequence', () => {
  // Existing state with 3 bubbles in sequence: ['cr-first', 'cr-middle-note', 'cr-last']
  // 'cr-middle-note' is a manual note in the middle of dialogue
  const existingState = createSamplePageState({
    containers: {},
    textRegions: {
      'r-first': {
        regionId: 'r-first',
        pageId: 'page-recon-1',
        containerId: null,
        containerAssociation: 'borderless',
        geometry: { pixelPolygon: [[100, 100], [200, 100], [200, 150], [100, 150]] },
        orientation: 'horizontal',
        lineObservationIds: ['l-1'],
        rubyAnnotations: [],
        confidence: 0.95,
        lifecycleState: 'active',
        provenance: {
          geometry: { source: 'ocr_engine', updatedAt: 1774000000000 },
          containerId: { source: 'local_detector', updatedAt: 1774000000000 },
        },
      },
      'r-middle': {
        regionId: 'r-middle',
        pageId: 'page-recon-1',
        containerId: null,
        containerAssociation: 'borderless',
        geometry: { pixelPolygon: [[300, 100], [400, 100], [400, 150], [300, 150]] },
        orientation: 'horizontal',
        lineObservationIds: ['l-2'],
        rubyAnnotations: [],
        confidence: 1.0,
        lifecycleState: 'active',
        provenance: {
          geometry: { source: 'user_manual', updatedAt: 1774000000000 },
          containerId: { source: 'user_manual', updatedAt: 1774000000000 },
        },
      },
      'r-last': {
        regionId: 'r-last',
        pageId: 'page-recon-1',
        containerId: null,
        containerAssociation: 'borderless',
        geometry: { pixelPolygon: [[500, 100], [600, 100], [600, 150], [500, 150]] },
        orientation: 'horizontal',
        lineObservationIds: ['l-3'],
        rubyAnnotations: [],
        confidence: 0.95,
        lifecycleState: 'active',
        provenance: {
          geometry: { source: 'ocr_engine', updatedAt: 1774000000000 },
          containerId: { source: 'local_detector', updatedAt: 1774000000000 },
        },
      },
    },
    contentRecords: {
      'cr-first': {
        contentId: 'cr-first',
        pageId: 'page-recon-1',
        regionTargets: [{ regionId: 'r-first' }],
        contentType: 'dialogue',
        speakerIds: [],
        sourceText: 'First sentence',
        originalOcrText: 'First sentence',
        translatedText: '',
        translationHistory: [],
        typerTag: { id: 'speech_bubbles', prefix: '"":' },
        status: 'active',
        orderState: { isUserPinned: false },
        reviewFlags: [],
        provenance: {
          sourceText: { source: 'ocr_engine', updatedAt: 1774000000000 },
          translatedText: { source: 'ocr_engine', updatedAt: 1774000000000 },
          typerTag: { source: 'local_detector', updatedAt: 1774000000000 },
          speakerIds: { source: 'local_detector', updatedAt: 1774000000000 },
          contentType: { source: 'local_detector', updatedAt: 1774000000000 },
          regionTargets: { source: 'ocr_engine', updatedAt: 1774000000000 },
        },
      },
      'cr-middle-note': {
        contentId: 'cr-middle-note',
        pageId: 'page-recon-1',
        regionTargets: [{ regionId: 'r-middle' }],
        contentType: 'translator_note',
        speakerIds: [],
        sourceText: 'Middle note',
        originalOcrText: 'Middle note',
        translatedText: '',
        translationHistory: [],
        typerTag: { id: 'outside_text', prefix: 'TN:' },
        status: 'active',
        orderState: { isUserPinned: true },
        reviewFlags: [],
        provenance: {
          sourceText: { source: 'user_manual', updatedAt: 1774000000000 },
          translatedText: { source: 'user_manual', updatedAt: 1774000000000 },
          typerTag: { source: 'user_manual', updatedAt: 1774000000000 },
          speakerIds: { source: 'user_manual', updatedAt: 1774000000000 },
          contentType: { source: 'user_manual', updatedAt: 1774000000000 },
          regionTargets: { source: 'user_manual', updatedAt: 1774000000000 },
        },
      },
      'cr-last': {
        contentId: 'cr-last',
        pageId: 'page-recon-1',
        regionTargets: [{ regionId: 'r-last' }],
        contentType: 'dialogue',
        speakerIds: [],
        sourceText: 'Last sentence',
        originalOcrText: 'Last sentence',
        translatedText: '',
        translationHistory: [],
        typerTag: { id: 'speech_bubbles', prefix: '"":' },
        status: 'active',
        orderState: { isUserPinned: false },
        reviewFlags: [],
        provenance: {
          sourceText: { source: 'ocr_engine', updatedAt: 1774000000000 },
          translatedText: { source: 'ocr_engine', updatedAt: 1774000000000 },
          typerTag: { source: 'local_detector', updatedAt: 1774000000000 },
          speakerIds: { source: 'local_detector', updatedAt: 1774000000000 },
          contentType: { source: 'local_detector', updatedAt: 1774000000000 },
          regionTargets: { source: 'ocr_engine', updatedAt: 1774000000000 },
        },
      },
    },
    readingSequence: ['cr-first', 'cr-middle-note', 'cr-last'],
  });

  // Rescan detects 'cr-first' and 'cr-last', but misses 'cr-middle-note'
  const newState = createSamplePageState({
    containers: {},
    textRegions: {
      'r-new-first': {
        regionId: 'r-new-first',
        pageId: 'page-recon-1',
        containerId: null,
        containerAssociation: 'borderless',
        geometry: { pixelPolygon: [[100, 100], [200, 100], [200, 150], [100, 150]] },
        orientation: 'horizontal',
        lineObservationIds: ['l-new-1'],
        rubyAnnotations: [],
        confidence: 0.98,
        lifecycleState: 'active',
        provenance: {
          geometry: { source: 'ocr_engine', updatedAt: 1774000050000 },
          containerId: { source: 'local_detector', updatedAt: 1774000050000 },
        },
      },
      'r-new-last': {
        regionId: 'r-new-last',
        pageId: 'page-recon-1',
        containerId: null,
        containerAssociation: 'borderless',
        geometry: { pixelPolygon: [[500, 100], [600, 100], [600, 150], [500, 150]] },
        orientation: 'horizontal',
        lineObservationIds: ['l-new-3'],
        rubyAnnotations: [],
        confidence: 0.98,
        lifecycleState: 'active',
        provenance: {
          geometry: { source: 'ocr_engine', updatedAt: 1774000050000 },
          containerId: { source: 'local_detector', updatedAt: 1774000050000 },
        },
      },
    },
    contentRecords: {
      'cr-new-first': {
        contentId: 'cr-new-first',
        pageId: 'page-recon-1',
        regionTargets: [{ regionId: 'r-new-first' }],
        contentType: 'dialogue',
        speakerIds: [],
        sourceText: 'First sentence',
        originalOcrText: 'First sentence',
        translatedText: '',
        translationHistory: [],
        typerTag: { id: 'speech_bubbles', prefix: '"":' },
        status: 'active',
        orderState: { isUserPinned: false },
        reviewFlags: [],
        provenance: {
          sourceText: { source: 'ocr_engine', updatedAt: 1774000050000 },
          translatedText: { source: 'ocr_engine', updatedAt: 1774000050000 },
          typerTag: { source: 'local_detector', updatedAt: 1774000050000 },
          speakerIds: { source: 'local_detector', updatedAt: 1774000050000 },
          contentType: { source: 'local_detector', updatedAt: 1774000050000 },
          regionTargets: { source: 'ocr_engine', updatedAt: 1774000050000 },
        },
      },
      'cr-new-last': {
        contentId: 'cr-new-last',
        pageId: 'page-recon-1',
        regionTargets: [{ regionId: 'r-new-last' }],
        contentType: 'dialogue',
        speakerIds: [],
        sourceText: 'Last sentence',
        originalOcrText: 'Last sentence',
        translatedText: '',
        translationHistory: [],
        typerTag: { id: 'speech_bubbles', prefix: '"":' },
        status: 'active',
        orderState: { isUserPinned: false },
        reviewFlags: [],
        provenance: {
          sourceText: { source: 'ocr_engine', updatedAt: 1774000050000 },
          translatedText: { source: 'ocr_engine', updatedAt: 1774000050000 },
          typerTag: { source: 'local_detector', updatedAt: 1774000050000 },
          speakerIds: { source: 'local_detector', updatedAt: 1774000050000 },
          contentType: { source: 'local_detector', updatedAt: 1774000050000 },
          regionTargets: { source: 'ocr_engine', updatedAt: 1774000050000 },
        },
      },
    },
    readingSequence: ['cr-new-first', 'cr-new-last'],
  });

  const { reconciledState } = reconcileDomainStates(existingState, newState);

  // Reconciled sequence must preserve cr-middle-note in the middle between cr-first and cr-last!
  assert.deepEqual(
    reconciledState.readingSequence,
    ['cr-first', 'cr-middle-note', 'cr-last'],
    'cr-middle-note must be re-anchored between its original neighbors, not pushed to the end'
  );
});

