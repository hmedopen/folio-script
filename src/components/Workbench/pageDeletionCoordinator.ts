import type { PageMetadata } from '../../types';

export type DeletionPhase =
  | 'idle'
  | 'disappearing' // Phase 1: 220–240ms (target: 230ms)
  | 'repositioning' // Phase 2: 280–320ms (target: 300ms)
  | 'renumbering' // Phase 3: 60–90ms (target: 75ms)
  | 'viewer-transition'; // Phase 4: 140–180ms (target: 160ms)

export interface DeletionTimings {
  disappearanceMs: number;
  repositioningMs: number;
  renumberingMs: number;
  viewerTransitionMs: number;
}

/**
 * Target timings complying strictly with design specifications:
 * - Phase 1: 220–240 ms (chosen: 230 ms)
 * - Phase 2: 280–320 ms (chosen: 300 ms)
 * - Phase 3: 60–90 ms (chosen: 75 ms)
 * - Phase 4: 140–180 ms (chosen: 160 ms)
 * Target total: ~765 ms (within 700–830 ms range)
 */
export const DEFAULT_DELETION_TIMINGS: DeletionTimings = {
  disappearanceMs: 230,
  repositioningMs: 300,
  renumberingMs: 75,
  viewerTransitionMs: 160,
};

/**
 * Restrained timings for users with prefers-reduced-motion:
 * No elaborate motion or FLIP sliding, quick subtle fade.
 */
export const REDUCED_MOTION_DELETION_TIMINGS: DeletionTimings = {
  disappearanceMs: 100,
  repositioningMs: 0,
  renumberingMs: 0,
  viewerTransitionMs: 100,
};

/**
 * Standard easing curves:
 * - Phase 1: Controlled ease-in curve
 * - Phase 2: Smooth ease-out curve (no bouncing, no overshooting)
 * - Phase 4: Smooth ease-in-out crossfade
 */
export const DELETION_EASING = {
  disappearance: 'cubic-bezier(0.4, 0, 1, 1)',
  repositioning: 'cubic-bezier(0.16, 1, 0.3, 1)',
  viewerCrossfade: 'cubic-bezier(0.4, 0, 0.2, 1)',
} as const;

export interface DeletionSnapshot {
  deletedPageId: string;
  deletedPageIndex: number;
  deletedPage: PageMetadata;
  replacementPageId: string | null;
  wasSelected: boolean;
  pagesSnapshot: PageMetadata[];
  shiftX: number;
}

/**
 * Calculates the replacement page ID according to strict rules:
 * 1. If a following page exists, select it.
 * 2. Otherwise, select the preceding page.
 * 3. If no pages remain, return null (empty state).
 */
export function calculateReplacementPageId(
  pages: PageMetadata[],
  deletedPageId: string
): string | null {
  const deletedIdx = pages.findIndex((p) => p.id === deletedPageId);
  if (deletedIdx === -1) return null;

  // If a following page exists, select it
  if (deletedIdx + 1 < pages.length) {
    return pages[deletedIdx + 1].id;
  }
  // Otherwise, select the preceding page
  if (deletedIdx > 0) {
    return pages[deletedIdx - 1].id;
  }
  // If no pages remain
  return null;
}

/**
 * Computes the visible page number for a thumbnail during each phase.
 * 
 * CRITICAL RULE:
 * - In Phase 1 ('disappearing') and Phase 2 ('repositioning'):
 *   Page numbers MUST remain at their pre-deletion values.
 *   "Page numbers must never change while thumbnails are still moving."
 * - In Phase 3 ('renumbering'), Phase 4 ('viewer-transition'), and 'idle':
 *   Visible page numbers update to reflect the new sequential order (1-based).
 */
export function getDisplayedPageNumber(
  page: PageMetadata,
  pageIndexInList: number,
  phase: DeletionPhase,
  deletedPageIndex: number | null
): number {
  if (phase === 'disappearing' || phase === 'repositioning') {
    // Hold pre-deletion number while disappearing or moving
    return page.index || pageIndexInList + 1;
  }

  // Phase 3, Phase 4, or idle: renumbered
  if (deletedPageIndex !== null && pageIndexInList >= deletedPageIndex) {
    return pageIndexInList + 1;
  }

  return page.index || pageIndexInList + 1;
}

/**
 * Check whether a thumbnail should remain completely stationary.
 * In Phase 1, ALL neighboring thumbnails must be stationary.
 */
export function shouldThumbnailBeStationary(
  pageId: string,
  deletedPageId: string,
  phase: DeletionPhase
): boolean {
  if (phase === 'disappearing') {
    return pageId !== deletedPageId;
  }
  return false;
}

/**
 * Checks system preference for reduced motion.
 */
export function checkPrefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false;
  }
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
