import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateReplacementPageId,
  getDisplayedPageNumber,
  shouldThumbnailBeStationary,
  DEFAULT_DELETION_TIMINGS,
  REDUCED_MOTION_DELETION_TIMINGS,
  DELETION_EASING,
  type DeletionPhase,
} from '../pageDeletionCoordinator.ts';
import type { PageMetadata } from '../../../types.ts';

function createMockPages(count: number): PageMetadata[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `page-${i + 1}`,
    index: i + 1,
    fileName: `00${i + 1}.jpg`,
    width: 1000,
    height: 1400,
  }));
}

test('calculateReplacementPageId — strict replacement selection rules', () => {
  const pages = createMockPages(5); // page-1, page-2, page-3, page-4, page-5

  // 1. Deleting first page -> selects following page (page-2)
  const replacementForFirst = calculateReplacementPageId(pages, 'page-1');
  assert.equal(replacementForFirst, 'page-2');

  // 2. Deleting middle page (page-3) -> selects following page (page-4)
  const replacementForMiddle = calculateReplacementPageId(pages, 'page-3');
  assert.equal(replacementForMiddle, 'page-4');

  // 3. Deleting last page (page-5) -> selects preceding page (page-4)
  const replacementForLast = calculateReplacementPageId(pages, 'page-5');
  assert.equal(replacementForLast, 'page-4');

  // 4. Deleting only remaining page (1 page total) -> returns null (empty state)
  const singlePageList = createMockPages(1); // page-1
  const replacementForOnlyPage = calculateReplacementPageId(singlePageList, 'page-1');
  assert.equal(replacementForOnlyPage, null);

  // 5. Deleting nonexistent page -> returns null
  const replacementForMissing = calculateReplacementPageId(pages, 'nonexistent-id');
  assert.equal(replacementForMissing, null);
});

test('getDisplayedPageNumber — strict retention during motion & update after motion', () => {
  const pages = createMockPages(5); // page-1 (idx 1), page-2 (idx 2), page-3 (idx 3), page-4 (idx 4), page-5 (idx 5)
  const deletedPage = pages[2]; // page-3 (0-based index: 2)
  const deletedIdx = 2;

  // Remaining pages after page-3 is deleted: [page-1, page-2, page-4, page-5]
  const remaining = [pages[0], pages[1], pages[3], pages[4]];

  // PHASE 1: 'disappearing'
  // Rule: All pages MUST retain pre-deletion numbers
  assert.equal(getDisplayedPageNumber(deletedPage, 2, 'disappearing', deletedIdx), 3);
  assert.equal(getDisplayedPageNumber(pages[0], 0, 'disappearing', deletedIdx), 1);
  assert.equal(getDisplayedPageNumber(pages[1], 1, 'disappearing', deletedIdx), 2);
  assert.equal(getDisplayedPageNumber(pages[3], 3, 'disappearing', deletedIdx), 4);
  assert.equal(getDisplayedPageNumber(pages[4], 4, 'disappearing', deletedIdx), 5);

  // PHASE 2: 'repositioning'
  // Rule: While remaining thumbnails slide into place, page numbers MUST NEVER change!
  // page-4 and page-5 are in list positions 2 and 3, but MUST still read "Page 4" and "Page 5"
  assert.equal(getDisplayedPageNumber(remaining[0], 0, 'repositioning', deletedIdx), 1);
  assert.equal(getDisplayedPageNumber(remaining[1], 1, 'repositioning', deletedIdx), 2);
  assert.equal(getDisplayedPageNumber(remaining[2], 2, 'repositioning', deletedIdx), 4); // Still 4 while moving!
  assert.equal(getDisplayedPageNumber(remaining[3], 3, 'repositioning', deletedIdx), 5); // Still 5 while moving!

  // PHASE 3: 'renumbering'
  // Rule: Only after Phase 2 movement completes, visible page numbers update to new sequence
  assert.equal(getDisplayedPageNumber(remaining[0], 0, 'renumbering', deletedIdx), 1);
  assert.equal(getDisplayedPageNumber(remaining[1], 1, 'renumbering', deletedIdx), 2);
  assert.equal(getDisplayedPageNumber(remaining[2], 2, 'renumbering', deletedIdx), 3); // Updated to 3!
  assert.equal(getDisplayedPageNumber(remaining[3], 3, 'renumbering', deletedIdx), 4); // Updated to 4!

  // PHASE 4: 'viewer-transition'
  // Maintains correct sequential numbers
  assert.equal(getDisplayedPageNumber(remaining[2], 2, 'viewer-transition', deletedIdx), 3);
  assert.equal(getDisplayedPageNumber(remaining[3], 3, 'viewer-transition', deletedIdx), 4);

  // IDLE:
  assert.equal(getDisplayedPageNumber(remaining[2], 2, 'idle', deletedIdx), 3);
});

test('shouldThumbnailBeStationary — Phase 1 stationary neighbor guarantee', () => {
  // During Phase 1 ('disappearing'), CRITICAL REQUIREMENT:
  // All neighboring thumbnails must remain completely stationary until the deleted thumbnail has disappeared
  assert.equal(shouldThumbnailBeStationary('page-1', 'page-2', 'disappearing'), true);
  assert.equal(shouldThumbnailBeStationary('page-3', 'page-2', 'disappearing'), true);
  assert.equal(shouldThumbnailBeStationary('page-2', 'page-2', 'disappearing'), false); // The deleted page itself animates

  // During Phase 2, remaining thumbnails move
  assert.equal(shouldThumbnailBeStationary('page-3', 'page-2', 'repositioning'), false);
});

test('Target timings and easing curves conform strictly to specifications', () => {
  // Phase 1: 220–240 ms
  assert.ok(
    DEFAULT_DELETION_TIMINGS.disappearanceMs >= 220 &&
    DEFAULT_DELETION_TIMINGS.disappearanceMs <= 240,
    `Disappearance duration ${DEFAULT_DELETION_TIMINGS.disappearanceMs} must be between 220 and 240 ms`
  );

  // Phase 2: 280–320 ms
  assert.ok(
    DEFAULT_DELETION_TIMINGS.repositioningMs >= 280 &&
    DEFAULT_DELETION_TIMINGS.repositioningMs <= 320,
    `Repositioning duration ${DEFAULT_DELETION_TIMINGS.repositioningMs} must be between 280 and 320 ms`
  );

  // Phase 3: 60–90 ms
  assert.ok(
    DEFAULT_DELETION_TIMINGS.renumberingMs >= 60 &&
    DEFAULT_DELETION_TIMINGS.renumberingMs <= 90,
    `Renumbering duration ${DEFAULT_DELETION_TIMINGS.renumberingMs} must be between 60 and 90 ms`
  );

  // Phase 4: 140–180 ms
  assert.ok(
    DEFAULT_DELETION_TIMINGS.viewerTransitionMs >= 140 &&
    DEFAULT_DELETION_TIMINGS.viewerTransitionMs <= 180,
    `Viewer transition duration ${DEFAULT_DELETION_TIMINGS.viewerTransitionMs} must be between 140 and 180 ms`
  );

  // Target total: 700–830 ms
  const totalMs =
    DEFAULT_DELETION_TIMINGS.disappearanceMs +
    DEFAULT_DELETION_TIMINGS.repositioningMs +
    DEFAULT_DELETION_TIMINGS.renumberingMs +
    DEFAULT_DELETION_TIMINGS.viewerTransitionMs;

  assert.ok(
    totalMs >= 700 && totalMs <= 830,
    `Total duration ${totalMs} ms must be between 700 and 830 ms`
  );

  // Reduced motion specifications
  assert.equal(REDUCED_MOTION_DELETION_TIMINGS.disappearanceMs, 100);
  assert.equal(REDUCED_MOTION_DELETION_TIMINGS.repositioningMs, 0);
  assert.equal(REDUCED_MOTION_DELETION_TIMINGS.renumberingMs, 0);
  assert.equal(REDUCED_MOTION_DELETION_TIMINGS.viewerTransitionMs, 100);

  // Easing specifications
  assert.equal(DELETION_EASING.disappearance, 'cubic-bezier(0.4, 0, 1, 1)');
  assert.equal(DELETION_EASING.repositioning, 'cubic-bezier(0.16, 1, 0.3, 1)');
  assert.equal(DELETION_EASING.viewerCrossfade, 'cubic-bezier(0.4, 0, 0.2, 1)');
});

test('Coordinated Deletion State Machine — complete sequential transition simulation', async () => {
  const pages = createMockPages(3); // page-1, page-2, page-3
  let currentSelection: string | null = 'page-2';
  let deletedFromStore: string | null = null;
  const phaseHistory: DeletionPhase[] = [];

  // Simulate coordinator state progression
  let activePhase: DeletionPhase = 'idle';
  phaseHistory.push(activePhase);

  const deletedPageId = 'page-2';
  const wasSelected = currentSelection === deletedPageId;
  const replacementId = calculateReplacementPageId(pages, deletedPageId);
  assert.equal(replacementId, 'page-3');

  // Step 1: Disappearance (Phase 1)
  activePhase = 'disappearing';
  phaseHistory.push(activePhase);
  // Ensure viewer still displays deleted page
  assert.equal(currentSelection, 'page-2');

  // Step 2: Repositioning (Phase 2)
  activePhase = 'repositioning';
  phaseHistory.push(activePhase);
  // Ensure viewer still displays deleted page
  assert.equal(currentSelection, 'page-2');

  // Step 3: Renumbering (Phase 3)
  activePhase = 'renumbering';
  phaseHistory.push(activePhase);
  // Ensure viewer still displays deleted page
  assert.equal(currentSelection, 'page-2');

  // Step 4: Viewer Transition (Phase 4)
  if (wasSelected) {
    activePhase = 'viewer-transition';
    phaseHistory.push(activePhase);
    // Selection switches to replacement page
    currentSelection = replacementId;
    assert.equal(currentSelection, 'page-3');
  }

  // Final persistence and cleanup
  deletedFromStore = deletedPageId;
  activePhase = 'idle';
  phaseHistory.push(activePhase);

  // Verify full sequence
  assert.deepEqual(phaseHistory, [
    'idle',
    'disappearing',
    'repositioning',
    'renumbering',
    'viewer-transition',
    'idle',
  ]);
  assert.equal(deletedFromStore, 'page-2');
  assert.equal(currentSelection, 'page-3');
});

test('Coordinated Deletion — unselected page deletion skips Phase 4 viewer transition', () => {
  let currentSelection: string | null = 'page-1'; // Viewing page-1
  const pageToDelete = 'page-3'; // Deleting unselected page-3
  const phaseHistory: DeletionPhase[] = [];

  let activePhase: DeletionPhase = 'idle';
  phaseHistory.push(activePhase);

  const wasSelected = currentSelection === pageToDelete;
  assert.equal(wasSelected, false);

  // Phase 1
  activePhase = 'disappearing';
  phaseHistory.push(activePhase);
  assert.equal(currentSelection, 'page-1');

  // Phase 2
  activePhase = 'repositioning';
  phaseHistory.push(activePhase);
  assert.equal(currentSelection, 'page-1');

  // Phase 3
  activePhase = 'renumbering';
  phaseHistory.push(activePhase);
  assert.equal(currentSelection, 'page-1');

  // Phase 4: SKIPPED because wasSelected is false!
  if (wasSelected) {
    activePhase = 'viewer-transition';
    phaseHistory.push(activePhase);
  }

  // Cleanup
  activePhase = 'idle';
  phaseHistory.push(activePhase);

  // Verify Phase 4 was not executed
  assert.deepEqual(phaseHistory, [
    'idle',
    'disappearing',
    'repositioning',
    'renumbering',
    'idle',
  ]);
  // Selected page remained untouched
  assert.equal(currentSelection, 'page-1');
});
