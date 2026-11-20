import test from 'node:test';
import assert from 'node:assert/strict';
import type { PageDomainState } from '../../types/domain/index.ts';
import {
  domainStateToBubbleViews,
  applyBubblePatchToDomainState,
  deleteBubbleFromDomainState,
  reorderDomainSequence,
  addManualBubbleToDomainState,
  splitBubbleInDomainState,
} from '../../lib/domain/bubbleItemView.ts';
import { compileRawTextExtract, compileTypeRScript } from '../../lib/compileTypeR.ts';

function createSampleDomainState(): PageDomainState {
  return {
    pageId: 'page-facade-1',
    chapterId: 'ch-alpha',
    dimensions: { width: 1200, height: 1800 },
    spatialGroups: {},
    containers: {
      'c-1': {
        containerId: 'c-1',
        pageId: 'page-facade-1',
        containerType: 'speech_balloon',
        geometry: {
          bodyContour: [
            [120, 180],
            [360, 180],
            [360, 360],
            [120, 360],
          ],
          tails: [],
        },
        confidence: 0.96,
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
        pageId: 'page-facade-1',
        containerType: 'narration_box',
        geometry: {
          bodyContour: [
            [600, 720],
            [960, 720],
            [960, 900],
            [600, 900],
          ],
          tails: [],
        },
        confidence: 0.94,
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
        pageId: 'page-facade-1',
        containerId: 'c-1',
        containerAssociation: 'associated',
        geometry: {
          pixelPolygon: [
            [140, 200],
            [340, 200],
            [340, 340],
            [140, 340],
          ],
        },
        orientation: 'horizontal',
        lineObservationIds: ['line-1'],
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
        pageId: 'page-facade-1',
        containerId: 'c-2',
        containerAssociation: 'associated',
        geometry: {
          pixelPolygon: [
            [620, 740],
            [940, 740],
            [940, 880],
            [620, 880],
          ],
        },
        orientation: 'horizontal',
        lineObservationIds: ['line-2'],
        rubyAnnotations: [],
        confidence: 0.92,
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
        pageId: 'page-facade-1',
        regionTargets: [{ regionId: 'r-1' }],
        contentType: 'dialogue',
        speakerIds: ['char-hero'],
        sourceText: 'Look at the stars.',
        originalOcrText: 'Look at the stars.',
        translatedText: 'انظر إلى النجوم.',
        translationHistory: [
          { versionId: 'v1', timestamp: 1774000000000, text: 'انظر إلى النجوم.', type: 'manual' },
        ],
        typerTag: { id: 'speech_bubbles', prefix: '"":' },
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
      'cr-2': {
        contentId: 'cr-2',
        pageId: 'page-facade-1',
        regionTargets: [{ regionId: 'r-2' }],
        contentType: 'narration',
        speakerIds: [],
        sourceText: 'Night had fallen.',
        originalOcrText: 'Night had fallen.',
        translatedText: 'حل الليل.',
        translationHistory: [],
        typerTag: { id: 'square_bubbles', prefix: '[]:' },
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
    readingSequence: ['cr-1', 'cr-2'],
    issues: [],
    version: 9,
    updatedAt: 1774000000000,
  };
}

test('Milestone 4.5: BubbleItemView facade accurately projects canonical PageDomainState', () => {
  const domainState = createSampleDomainState();
  const bubbles = domainStateToBubbleViews(domainState);

  assert.equal(bubbles.length, 2);

  // Bubble 1 verification
  const b1 = bubbles[0];
  assert.equal(b1.id, 'cr-1');
  assert.equal(b1.index, 1);
  assert.equal(b1.pageId, 'page-facade-1');
  assert.equal(b1.chapterId, 'ch-alpha');
  assert.equal(b1.sourceText, 'Look at the stars.');
  assert.equal(b1.translatedText, 'انظر إلى النجوم.');
  assert.equal(b1.speakerCharacterId, 'char-hero');
  assert.equal(b1.type, 'speech_bubbles');
  assert.equal(b1.typerPrefix, '"":');
  assert.equal(b1.isManuallyEdited, true);
  assert.ok(b1.pixelPolygon);
  assert.ok(b1.pixelBox);
  assert.ok(b1.box_2d);

  // Bubble 2 verification
  const b2 = bubbles[1];
  assert.equal(b2.id, 'cr-2');
  assert.equal(b2.index, 2);
  assert.equal(b2.sourceText, 'Night had fallen.');
  assert.equal(b2.translatedText, 'حل الليل.');
  assert.equal(b2.type, 'square_bubbles');
  assert.equal(b2.isManuallyEdited, false);

  // Downstream TypeR compatibility: verify TypeR compiles from facade output
  const extractText = compileRawTextExtract({
    chapterName: 'Chapter Alpha',
    pages: [{ pageIndex: 1, bubbles }],
    includePageHeaders: true,
    includeIndexTags: true,
    includePrefixTags: true,
    symbolPosition: 'start',
    textDirection: 'ltr',
  });

  assert.ok(extractText.includes('CHAPTER ALPHA'));
  assert.ok(extractText.includes('Look at the stars.'));
  assert.ok(extractText.includes('Night had fallen.'));

  const typeRText = compileTypeRScript({
    chapterName: 'Chapter Alpha',
    pages: [{ pageIndex: 1, bubbles }],
    includePageHeaders: true,
    includeIndexTags: true,
    includePrefixTags: true,
    includeSourceComments: false,
    includeFlagNotes: false,
  });

  assert.ok(typeRText.includes('انظر إلى النجوم.'));
  assert.ok(typeRText.includes('حل الليل.'));
});

test('Milestone 4.5: Multiple dialogue content records sharing one physical balloon project as distinct BubbleItems', () => {
  const domainState = createSampleDomainState();

  // Add a second content record targeting the SAME region 'r-1'
  domainState.contentRecords['cr-1-sub'] = {
    contentId: 'cr-1-sub',
    pageId: 'page-facade-1',
    regionTargets: [{ regionId: 'r-1' }], // Shares r-1 with cr-1!
    contentType: 'dialogue',
    speakerIds: ['char-companion'],
    sourceText: 'They are beautiful.',
    originalOcrText: 'They are beautiful.',
    translatedText: 'إنها جميلة.',
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
  };

  domainState.readingSequence = ['cr-1', 'cr-1-sub', 'cr-2'];

  const bubbles = domainStateToBubbleViews(domainState);
  assert.equal(bubbles.length, 3);

  assert.equal(bubbles[0].id, 'cr-1');
  assert.equal(bubbles[0].regionId, 'r-1');
  assert.equal(bubbles[0].sourceText, 'Look at the stars.');

  assert.equal(bubbles[1].id, 'cr-1-sub');
  assert.equal(bubbles[1].regionId, 'r-1'); // Exact same physical region!
  assert.equal(bubbles[1].sourceText, 'They are beautiful.');
  assert.equal(bubbles[1].speakerCharacterId, 'char-companion');

  assert.equal(bubbles[2].id, 'cr-2');
});

test('Milestone 4.5: Editing operations (patch, delete, reorder, split, manual add) update canonical domain state', () => {
  let state = createSampleDomainState();

  // 1. Patch bubble
  state = applyBubblePatchToDomainState(state, 'cr-1', {
    sourceText: 'Look at the shining stars.',
    translatedText: 'انظر إلى النجوم الساطعة.',
    isManuallyEdited: true,
  });

  assert.equal(state.contentRecords['cr-1'].sourceText, 'Look at the shining stars.');
  assert.equal(state.contentRecords['cr-1'].translatedText, 'انظر إلى النجوم الساطعة.');
  assert.equal(state.contentRecords['cr-1'].orderState.isUserPinned, true);
  assert.equal(state.contentRecords['cr-1'].provenance.sourceText.source, 'user_manual');

  // 2. Reorder sequence
  state = reorderDomainSequence(state, ['cr-2', 'cr-1']);
  assert.deepEqual(state.readingSequence, ['cr-2', 'cr-1']);
  assert.equal(state.contentRecords['cr-2'].orderState.isUserPinned, true);

  // 3. Add manual bubble
  state = addManualBubbleToDomainState(state, {
    id: 'manual-bubble-test',
    pageId: 'page-facade-1',
    index: 3,
    box_2d: [100, 100, 300, 300],
    type: 'thought_bubbles',
    typerPrefix: 'THOUGHT:',
    sourceText: 'What is that?',
    originalSourceText: '',
    translatedText: 'ما هذا؟',
    rawTranslatedText: 'ما هذا؟',
    reviewFlags: [],
  });

  assert.equal(state.readingSequence.length, 3);
  assert.ok(state.contentRecords['manual-bubble-test']);
  assert.equal(state.contentRecords['manual-bubble-test'].sourceText, 'What is that?');
  assert.ok(state.containers['c-manual-bubble-test']);
  assert.ok(state.textRegions['r-manual-bubble-test']);

  // 4. Split bubble
  const { domainState: splitState, newBubbleId } = splitBubbleInDomainState(
    state,
    'cr-2',
    5 // Split "Night had fallen." -> "Night" and "had fallen."
  );

  assert.equal(splitState.contentRecords['cr-2'].sourceText, 'Night');
  assert.equal(splitState.contentRecords[newBubbleId].sourceText, 'had fallen.');
  assert.equal(splitState.readingSequence.length, 4);
  assert.equal(
    splitState.contentRecords[newBubbleId].regionTargets[0].regionId,
    splitState.contentRecords['cr-2'].regionTargets[0].regionId,
    'Split record must share the same regionId'
  );

  // 5. Delete bubble
  const deletedState = deleteBubbleFromDomainState(splitState, 'manual-bubble-test');
  assert.equal(deletedState.contentRecords['manual-bubble-test'].status, 'archived');
  assert.equal(deletedState.readingSequence.includes('manual-bubble-test'), false);
});

test('Milestone 4.5: Manual freeform polygonal contours and legacyPayload synchronization are preserved', () => {
  const baseDomain = createSampleDomainState();
  baseDomain.extensions = {
    legacyPayload: {
      bubbles: domainStateToBubbleViews(baseDomain),
    },
  };

  // Add a manual lasso selection with non-rectangular polygon (triangle/star contour)
  const lassoPolygon: Array<[number, number]> = [
    [200, 200],
    [500, 220],
    [350, 600],
    [180, 450],
  ];

  const manualLassoBubble = {
    id: 'lasso-bubble-1',
    pageId: baseDomain.pageId,
    index: 3,
    box_2d: [200, 180, 600, 500] as [number, number, number, number],
    type: 'speech_bubbles' as const,
    typerPrefix: '"":' as const,
    sourceText: 'Lasso text',
    originalSourceText: '',
    translatedText: '',
    rawTranslatedText: '',
    reviewFlags: [],
    manualPolygon: lassoPolygon,
    provenance: 'manual_selection' as const,
    manualSelectionShape: 'lasso' as const,
  };

  const stateWithLasso = addManualBubbleToDomainState(baseDomain, manualLassoBubble);

  // 1. Verify container bodyContour has exact polygon vertices, not 4-point rect
  const cont = stateWithLasso.containers['c-lasso-bubble-1'];
  assert.ok(cont);
  assert.equal(cont.geometry.bodyContour.length, 4);
  // Verify scaled coordinates match manualPolygon
  const expectedP0X = (200 / 1000) * baseDomain.dimensions.width;
  const expectedP0Y = (200 / 1000) * baseDomain.dimensions.height;
  assert.equal(cont.geometry.bodyContour[0][0], expectedP0X);
  assert.equal(cont.geometry.bodyContour[0][1], expectedP0Y);

  // 2. Patch geometry with updated manualPolygon
  const updatedLassoPolygon: Array<[number, number]> = [
    [250, 250],
    [550, 270],
    [400, 650],
    [220, 500],
    [190, 300],
  ];

  const statePatched = applyBubblePatchToDomainState(stateWithLasso, 'lasso-bubble-1', {
    manualPolygon: updatedLassoPolygon,
    sourceText: 'Updated lasso text',
  });

  const contPatched = statePatched.containers['c-lasso-bubble-1'];
  assert.equal(contPatched.geometry.bodyContour.length, 5);

  // 3. Verify legacyPayload bubbles list stays synchronized
  const legacyBubbles = statePatched.extensions?.legacyPayload?.bubbles as any[];
  assert.ok(legacyBubbles);
  const foundInLegacy = legacyBubbles.find((b) => b.id === 'lasso-bubble-1');
  assert.ok(foundInLegacy);
  assert.equal(foundInLegacy.sourceText, 'Updated lasso text');

  // 4. Delete bubble and verify legacyPayload synchronizes removal
  const stateAfterDelete = deleteBubbleFromDomainState(statePatched, 'lasso-bubble-1');
  const legacyAfterDelete = stateAfterDelete.extensions?.legacyPayload?.bubbles as any[];
  assert.equal(legacyAfterDelete.some((b) => b.id === 'lasso-bubble-1'), false);
});

