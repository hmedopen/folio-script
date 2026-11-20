import test from 'node:test';
import assert from 'node:assert/strict';
import { indexedDB } from 'fake-indexeddb';
import { useWorkbenchStore } from '../../store/workbenchStore.ts';
import {
  savePageDomainState,
  getPageDomainState,
  savePageBubbles,
  resetDatabaseConnection,
} from '../../services/db.ts';
import type { PageDomainState } from '../../types/domain/index.ts';
import type { BubbleItem } from '../../types/workbench.ts';

(globalThis as any).indexedDB = indexedDB;

function createRichPageDomainState(pageId: string): PageDomainState {
  return {
    pageId,
    chapterId: 'ch-test-1',
    dimensions: { width: 1000, height: 1600 },
    spatialGroups: {},
    containers: {
      'balloon-starburst': {
        containerId: 'balloon-starburst',
        pageId,
        containerType: 'shout_burst',
        geometry: {
          bodyContour: [
            [200, 200],
            [280, 240],
            [350, 210],
            [320, 290],
            [380, 340],
            [300, 360],
            [270, 430],
            [230, 360],
            [170, 390],
            [190, 310],
            [150, 260],
            [220, 260],
          ],
          tails: [[[320, 360], [380, 450], [310, 390]]],
        },
        confidence: 0.98,
        boundaryUncertain: false,
        zIndex: 1,
        state: 'active',
        provenance: {
          geometry: { source: 'local_detector', updatedAt: 1000 },
          containerType: { source: 'local_detector', updatedAt: 1000 },
        },
      },
    },
    textRegions: {
      'reg-dialogue-1': {
        regionId: 'reg-dialogue-1',
        pageId,
        containerId: 'balloon-starburst',
        containerAssociation: 'associated',
        geometry: {
          pixelPolygon: [
            [220, 240],
            [330, 240],
            [330, 290],
            [220, 290],
          ],
        },
        orientation: 'horizontal',
        lineObservationIds: ['line-main-1'],
        rubyAnnotations: [
          {
            rubyId: 'ruby-1',
            rubyLineObservationId: 'line-ruby-1',
            parentLineObservationId: 'line-main-1',
            parentCharSpan: [0, 2],
            rubyText: 'furigana',
          },
        ],
        confidence: 0.96,
        lifecycleState: 'active',
        provenance: {
          geometry: { source: 'ocr_engine', updatedAt: 1000 },
          containerId: { source: 'local_detector', updatedAt: 1000 },
        },
      },
      'reg-dialogue-2': {
        regionId: 'reg-dialogue-2',
        pageId,
        containerId: 'balloon-starburst',
        containerAssociation: 'associated',
        geometry: {
          pixelPolygon: [
            [220, 300],
            [330, 300],
            [330, 350],
            [220, 350],
          ],
        },
        orientation: 'horizontal',
        lineObservationIds: ['line-main-2'],
        rubyAnnotations: [],
        confidence: 0.94,
        lifecycleState: 'active',
        provenance: {
          geometry: { source: 'ocr_engine', updatedAt: 1000 },
          containerId: { source: 'local_detector', updatedAt: 1000 },
        },
      },
    },
    contentRecords: {
      'cr-dial-1': {
        contentId: 'cr-dial-1',
        pageId,
        regionTargets: [{ regionId: 'reg-dialogue-1' }],
        contentType: 'dialogue',
        speakerIds: ['speaker-hero'],
        sourceText: 'First sentence!',
        originalOcrText: 'First sentence!',
        translatedText: 'الجملة الأولى!',
        translationHistory: [
          { versionId: 'v1', timestamp: 1000, text: 'الجملة الأولى!', type: 'manual' },
        ],
        typerTag: { id: 'shout_burst', prefix: 'SHOUT:' },
        status: 'active',
        orderState: { isUserPinned: true, pinnedAt: 1000 },
        reviewFlags: [],
        provenance: {
          sourceText: { source: 'ocr_engine', updatedAt: 1000 },
          translatedText: { source: 'user_manual', updatedAt: 1000 },
          typerTag: { source: 'user_manual', updatedAt: 1000 },
          speakerIds: { source: 'user_manual', updatedAt: 1000 },
          contentType: { source: 'local_detector', updatedAt: 1000 },
          regionTargets: { source: 'ocr_engine', updatedAt: 1000 },
        },
      },
      'cr-dial-2': {
        contentId: 'cr-dial-2',
        pageId,
        regionTargets: [{ regionId: 'reg-dialogue-2' }],
        contentType: 'dialogue',
        speakerIds: ['speaker-hero'],
        sourceText: 'Second sentence in same balloon.',
        originalOcrText: 'Second sentence in same balloon.',
        translatedText: 'الجملة الثانية في نفس البالون.',
        translationHistory: [
          { versionId: 'v2', timestamp: 1000, text: 'الجملة الثانية في نفس البالون.', type: 'manual' },
        ],
        typerTag: { id: 'shout_burst', prefix: 'SHOUT:' },
        status: 'active',
        orderState: { isUserPinned: true, pinnedAt: 1000 },
        reviewFlags: [],
        provenance: {
          sourceText: { source: 'ocr_engine', updatedAt: 1000 },
          translatedText: { source: 'user_manual', updatedAt: 1000 },
          typerTag: { source: 'user_manual', updatedAt: 1000 },
          speakerIds: { source: 'user_manual', updatedAt: 1000 },
          contentType: { source: 'local_detector', updatedAt: 1000 },
          regionTargets: { source: 'ocr_engine', updatedAt: 1000 },
        },
      },
    },
    readingSequence: ['cr-dial-1', 'cr-dial-2'],
    issues: [],
    version: 9,
    updatedAt: 1000,
  };
}

test('F-05: Undo and Redo preserve complete rich PageDomainState without loss', async () => {
  resetDatabaseConnection();
  const pageId = 'undo-test-page-1';
  const initialDomain = createRichPageDomainState(pageId);

  // Seed DB with rich domain state
  await savePageDomainState(initialDomain);

  // Load into store
  const store = useWorkbenchStore.getState();
  await store.loadPageBubbles(pageId);

  const loadedState = useWorkbenchStore.getState().pageDomainStates[pageId];
  assert.ok(loadedState, 'Domain state should be loaded in store');
  assert.equal(Object.keys(loadedState.contentRecords).length, 2);
  assert.ok(loadedState.containers['balloon-starburst']);
  assert.equal(loadedState.containers['balloon-starburst'].geometry.bodyContour.length, 12, 'Starburst polygon preserved');
  assert.equal(loadedState.textRegions['reg-dialogue-1'].rubyAnnotations.length, 1, 'Ruby annotation preserved');

  // Perform user action: Edit text on first bubble
  useWorkbenchStore.getState().updateBubble(pageId, 'cr-dial-1', {
    translatedText: 'ترجمة معدلة يدويا!',
  });

  const modifiedState = useWorkbenchStore.getState().pageDomainStates[pageId];
  assert.equal(modifiedState.contentRecords['cr-dial-1'].translatedText, 'ترجمة معدلة يدويا!');

  // Perform another user action: Split bubble
  useWorkbenchStore.getState().splitBubble(pageId, 'cr-dial-1', 5);
  const splitState = useWorkbenchStore.getState().pageDomainStates[pageId];
  assert.equal(splitState.readingSequence.length, 3, 'Reading sequence grew to 3 after split');

  // EXECUTE UNDO 1: Reverts split
  useWorkbenchStore.getState().undoBubbleAction(pageId);
  const afterUndo1 = useWorkbenchStore.getState().pageDomainStates[pageId];
  assert.equal(afterUndo1.readingSequence.length, 2, 'Reading sequence reverted to 2');
  assert.equal(afterUndo1.contentRecords['cr-dial-1'].translatedText, 'ترجمة معدلة يدويا!');
  // Verify rich domain attributes are NOT degraded!
  assert.equal(afterUndo1.containers['balloon-starburst'].geometry.bodyContour.length, 12, '12-point concave starburst contour survived undo');
  assert.equal(afterUndo1.containers['balloon-starburst'].geometry.tails.length, 1, 'Tail survived undo');
  assert.equal(afterUndo1.textRegions['reg-dialogue-1'].rubyAnnotations.length, 1, 'Ruby survived undo');

  // EXECUTE UNDO 2: Reverts text update
  useWorkbenchStore.getState().undoBubbleAction(pageId);
  const afterUndo2 = useWorkbenchStore.getState().pageDomainStates[pageId];
  assert.equal(afterUndo2.contentRecords['cr-dial-1'].translatedText, 'الجملة الأولى!', 'Original translation restored');
  assert.equal(afterUndo2.containers['balloon-starburst'].geometry.bodyContour.length, 12, 'Starburst contour intact');
  assert.equal(afterUndo2.textRegions['reg-dialogue-1'].rubyAnnotations.length, 1, 'Ruby intact');

  // EXECUTE REDO 1: Re-applies text update
  useWorkbenchStore.getState().redoBubbleAction(pageId);
  const afterRedo1 = useWorkbenchStore.getState().pageDomainStates[pageId];
  assert.equal(afterRedo1.contentRecords['cr-dial-1'].translatedText, 'ترجمة معدلة يدويا!', 'Redo restored edited text');
  assert.equal(afterRedo1.containers['balloon-starburst'].geometry.bodyContour.length, 12, 'Starburst contour intact after redo');
  assert.equal(afterRedo1.textRegions['reg-dialogue-1'].rubyAnnotations.length, 1, 'Ruby intact after redo');

  // EXECUTE REDO 2: Re-applies split
  useWorkbenchStore.getState().redoBubbleAction(pageId);
  const afterRedo2 = useWorkbenchStore.getState().pageDomainStates[pageId];
  assert.equal(afterRedo2.readingSequence.length, 3, 'Redo restored split');
  assert.equal(afterRedo2.containers['balloon-starburst'].geometry.bodyContour.length, 12, 'Starburst contour intact after redo 2');

  await new Promise((r) => setTimeout(r, 20));
  resetDatabaseConnection();
});

test('F-07: Source-of-truth rule & reconciliation (legacy-only, canonical-only, both-present, updated-legacy)', async () => {
  resetDatabaseConnection();

  // CASE 1: Canonical-only (canonical exists, no legacy stored)
  const p1 = 'case1-canonical-only';
  const richState1 = createRichPageDomainState(p1);
  await savePageDomainState(richState1);

  await useWorkbenchStore.getState().loadPageBubbles(p1);
  const state1 = useWorkbenchStore.getState().pageDomainStates[p1];
  assert.ok(state1, 'Canonical state loaded');
  assert.equal(state1.containers['balloon-starburst'].geometry.bodyContour.length, 12);
  assert.equal(useWorkbenchStore.getState().bubblesByPage[p1].length, 2);

  // CASE 2: Legacy-only (no canonical domain state exists yet)
  const p2 = 'case2-legacy-only';
  const legacyBubbles: BubbleItem[] = [
    {
      id: 'leg-b1',
      pageId: p2,
      index: 1,
      box_2d: [150, 150, 350, 450],
      type: 'speech_bubbles',
      typerPrefix: '"":',
      sourceText: 'Legacy dialogue',
      translatedText: 'حوار قديم',
      isManuallyEdited: false,
    },
  ];
  await savePageBubbles(p2, legacyBubbles);

  await useWorkbenchStore.getState().loadPageBubbles(p2);
  const state2 = useWorkbenchStore.getState().pageDomainStates[p2];
  assert.ok(state2, 'Canonical state synthesized from legacy');
  assert.equal(state2.contentRecords['leg-b1']?.sourceText, 'Legacy dialogue');
  assert.equal(state2.contentRecords['leg-b1']?.translatedText, 'حوار قديم');
  // Check that synthesized state was persisted to DB
  const persistedState2 = await getPageDomainState(p2);
  assert.ok(persistedState2, 'Synthesized domain state was persisted');

  // CASE 3: Both present, legacy has NEWER timestamp but NO novel user edits
  // In this case, legacy timestamp must NOT silently overwrite or downgrade canonical rich domain data!
  const p3 = 'case3-both-present-newer-legacy-ts';
  const richState3 = createRichPageDomainState(p3);
  richState3.updatedAt = 1000;
  await savePageDomainState(richState3);

  // Legacy bubbles with newer timestamp (e.g. 5000) but same text
  const legacyBubblesSameText: BubbleItem[] = [
    {
      id: 'cr-dial-1',
      pageId: p3,
      index: 1,
      box_2d: [200, 200, 400, 400], // simplified AABB box
      type: 'speech_bubbles',
      sourceText: 'First sentence!',
      translatedText: 'الجملة الأولى!',
      updatedAt: 5000, // newer timestamp!
    },
  ];
  await savePageBubbles(p3, legacyBubblesSameText);

  await useWorkbenchStore.getState().loadPageBubbles(p3);
  const state3 = useWorkbenchStore.getState().pageDomainStates[p3];
  // Rich 12-point starburst contour must NOT be destroyed by newer timestamp!
  assert.equal(state3.containers['balloon-starburst'].geometry.bodyContour.length, 12, 'Starburst contour preserved despite newer legacy timestamp');
  assert.equal(state3.textRegions['reg-dialogue-1'].rubyAnnotations.length, 1, 'Ruby preserved');
  assert.equal(Object.keys(state3.contentRecords).length, 2, 'Both dialogue records preserved');

  // CASE 4: Genuinely updated legacy data (user edited translated text in legacy store)
  const p4 = 'case4-genuinely-updated-legacy';
  const richState4 = createRichPageDomainState(p4);
  await savePageDomainState(richState4);

  const updatedLegacyBubbles: BubbleItem[] = [
    {
      id: 'cr-dial-1',
      pageId: p4,
      index: 1,
      box_2d: [200, 200, 400, 400],
      type: 'shout_burst',
      typerPrefix: 'SHOUT:',
      sourceText: 'First sentence!',
      translatedText: 'ترجمة جديدة من أداة خارجية!',
      isManuallyEdited: true,
      updatedAt: 8000,
    },
  ];
  await savePageBubbles(p4, updatedLegacyBubbles);

  await useWorkbenchStore.getState().loadPageBubbles(p4);
  const state4 = useWorkbenchStore.getState().pageDomainStates[p4];
  // Reconciled: new translated text is accepted
  assert.equal(state4.contentRecords['cr-dial-1'].translatedText, 'ترجمة جديدة من أداة خارجية!');
  // Rich containers and ruby are STILL PRESERVED!
  assert.equal(state4.containers['balloon-starburst'].geometry.bodyContour.length, 12, 'Starburst contour preserved during reconciliation');
  assert.equal(state4.textRegions['reg-dialogue-1'].rubyAnnotations.length, 1, 'Ruby preserved during reconciliation');
  assert.equal(Object.keys(state4.contentRecords).length, 2, 'Second content record in same balloon preserved');

  resetDatabaseConnection();
});
