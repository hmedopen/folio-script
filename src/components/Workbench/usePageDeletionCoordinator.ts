import { useState, useRef, useEffect, useLayoutEffect, useCallback } from 'react';
import type { PageMetadata } from '../../types';
import {
  type DeletionPhase,
  type DeletionTimings,
  DEFAULT_DELETION_TIMINGS,
  REDUCED_MOTION_DELETION_TIMINGS,
  DELETION_EASING,
  calculateReplacementPageId,
  getDisplayedPageNumber,
  checkPrefersReducedMotion,
} from './pageDeletionCoordinator';
import { getPageBlob } from '../../services/db';

export interface UsePageDeletionCoordinatorOptions {
  pages: PageMetadata[];
  effectivePageId: string | null;
  currentImageUrl: string | null;
  containerRef: React.RefObject<HTMLDivElement | null>;
  onDeletePage?: (pageId: string) => void;
  onSelectPage: (pageId: string | null) => void;
  customTimings?: Partial<DeletionTimings>;
}

export interface PageDeletionCoordinatorResult {
  phase: DeletionPhase;
  isTransitionActive: boolean;
  deletedPageId: string | null;
  displayPages: PageMetadata[];
  displayedPageNum: (page: PageMetadata, index: number) => number;
  outgoingImageUrl: string | null;
  isViewerCrossfading: boolean;
  viewerCrossfadeDuration: number;
  startDeletion: (pageId: string) => Promise<boolean>;
  cancelDeletion: () => void;
}

export function usePageDeletionCoordinator({
  pages,
  effectivePageId,
  currentImageUrl,
  containerRef,
  onDeletePage,
  onSelectPage,
  customTimings,
}: UsePageDeletionCoordinatorOptions): PageDeletionCoordinatorResult {
  const [phase, setPhase] = useState<DeletionPhase>('idle');
  const [deletedPageId, setDeletedPageId] = useState<string | null>(null);
  const [deletedPageIndex, setDeletedPageIndex] = useState<number | null>(null);
  const [displayPagesState, setDisplayPagesState] = useState<PageMetadata[] | null>(null);
  const [outgoingImageUrl, setOutgoingImageUrl] = useState<string | null>(null);
  const [isViewerCrossfading, setIsViewerCrossfading] = useState(false);

  // Active timers / animations for safe cleanup
  const activeAnimationsRef = useRef<Animation[]>([]);
  const activeTimersRef = useRef<NodeJS.Timeout[]>([]);
  const isMountedRef = useRef(true);
  const preloadedBlobUrlsRef = useRef<string[]>([]);

  // Pending FLIP promise resolver for Phase 2
  const pendingFlipRef = useRef<{
    shiftX: number;
    affectedIds: Set<string>;
    resolve: () => void;
  } | null>(null);

  // Latest props ref to avoid stale closures during async phases
  const propsRef = useRef({
    pages,
    effectivePageId,
    currentImageUrl,
    onDeletePage,
    onSelectPage,
  });

  useEffect(() => {
    propsRef.current = {
      pages,
      effectivePageId,
      currentImageUrl,
      onDeletePage,
      onSelectPage,
    };
  });

  // Cleanup on unmount
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      // Stop in-flight animations
      activeAnimationsRef.current.forEach((a) => {
        try {
          a.cancel();
        } catch {
          // ignore
        }
      });
      activeAnimationsRef.current = [];

      // Clear timeouts
      activeTimersRef.current.forEach((t) => clearTimeout(t));
      activeTimersRef.current = [];

      // Revoke any preloaded blob URLs
      preloadedBlobUrlsRef.current.forEach((url) => {
        try {
          URL.revokeObjectURL(url);
        } catch {
          // ignore
        }
      });
      preloadedBlobUrlsRef.current = [];
    };
  }, []);

  // Safe timeout helper tracked for cleanup
  const safeSleep = useCallback((ms: number): Promise<void> => {
    if (ms <= 0) return Promise.resolve();
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        activeTimersRef.current = activeTimersRef.current.filter((t) => t !== timer);
        resolve();
      }, ms);
      activeTimersRef.current.push(timer);
    });
  }, []);

  // Synchronous FLIP layout effect for Phase 2
  useLayoutEffect(() => {
    if (phase === 'repositioning' && pendingFlipRef.current) {
      const { shiftX, affectedIds, resolve } = pendingFlipRef.current;
      pendingFlipRef.current = null;

      const container = containerRef.current;
      const isReduced = checkPrefersReducedMotion();

      if (!container || isReduced || shiftX === 0 || affectedIds.size === 0) {
        resolve();
        return;
      }

      const elements = container.querySelectorAll<HTMLElement>('[data-page-id]');
      const anims: Animation[] = [];
      const timings: DeletionTimings = {
        ...DEFAULT_DELETION_TIMINGS,
        ...customTimings,
      };

      elements.forEach((el) => {
        const pid = el.getAttribute('data-page-id');
        if (pid && affectedIds.has(pid)) {
          if (typeof el.animate === 'function') {
            try {
              const anim = el.animate(
                [
                  { transform: `translateX(${shiftX}px)` },
                  { transform: 'translateX(0px)' },
                ],
                {
                  duration: timings.repositioningMs,
                  easing: DELETION_EASING.repositioning,
                  fill: 'none',
                }
              );
              anims.push(anim);
              activeAnimationsRef.current.push(anim);
            } catch {
              // fallback
            }
          }
        }
      });

      if (anims.length === 0) {
        resolve();
      } else {
        Promise.all(anims.map((a) => a.finished.catch(() => {}))).then(() => {
          activeAnimationsRef.current = activeAnimationsRef.current.filter(
            (a) => !anims.includes(a)
          );
          resolve();
        });
      }
    }
  }, [phase, containerRef, customTimings]);

  // Cancel deletion and reset to idle
  const cancelDeletion = useCallback(() => {
    activeAnimationsRef.current.forEach((a) => {
      try {
        a.cancel();
      } catch {
        // ignore
      }
    });
    activeAnimationsRef.current = [];
    activeTimersRef.current.forEach((t) => clearTimeout(t));
    activeTimersRef.current = [];

    setPhase('idle');
    setDeletedPageId(null);
    setDeletedPageIndex(null);
    setDisplayPagesState(null);
    setOutgoingImageUrl(null);
    setIsViewerCrossfading(false);
  }, []);

  // Main Deletion Transition Coordinator
  const startDeletion = useCallback(
    async (pageId: string): Promise<boolean> => {
      // 1. Guard against duplicate deletion requests
      if (phase !== 'idle') {
        return false;
      }

      const {
        pages: currentPages,
        effectivePageId: currentEffectiveId,
        currentImageUrl: currentImg,
        onDeletePage: doDelete,
        onSelectPage: doSelect,
      } = propsRef.current;

      const deletedIdx = currentPages.findIndex((p) => p.id === pageId);
      if (deletedIdx === -1) {
        return false;
      }

      const wasSelected = pageId === currentEffectiveId;
      const replacementPageId = calculateReplacementPageId(currentPages, pageId);

      const isReduced = checkPrefersReducedMotion();
      const timings: DeletionTimings = isReduced
        ? REDUCED_MOTION_DELETION_TIMINGS
        : {
            ...DEFAULT_DELETION_TIMINGS,
            ...customTimings,
          };

      // Measure deleted pill element geometry before layout changes
      let shiftX = 82; // fallback: 76px inactive + 6px gap
      const container = containerRef.current;
      if (container) {
        const deletedEl = container.querySelector(`[data-page-id="${pageId}"]`) as HTMLElement | null;
        if (deletedEl) {
          const width = deletedEl.offsetWidth || (wasSelected ? 104 : 76);
          const gap = 6; // gap-1.5 = 6px
          shiftX = width + gap;
        }
      }

      // Snapshot of pages before deletion
      const pagesSnapshot = [...currentPages];
      setDeletedPageId(pageId);
      setDeletedPageIndex(deletedIdx);
      setDisplayPagesState(pagesSnapshot);

      // Cache outgoing image URL for viewer retention if this page is selected
      if (wasSelected && currentImg) {
        setOutgoingImageUrl(currentImg);
      }

      // Preload replacement page blob immediately so Phase 4 crossfade is instant
      let preloadedBlobUrl: string | null = null;
      if (wasSelected && replacementPageId) {
        getPageBlob(replacementPageId)
          .then((blob) => {
            if (blob && isMountedRef.current) {
              const url = URL.createObjectURL(blob);
              preloadedBlobUrlsRef.current.push(url);
              preloadedBlobUrl = url;
            }
          })
          .catch((err) => {
            console.warn('Preload blob for replacement page caught error', err);
          });
      }

      // =========================================================================
      // PHASE 1 — Deleted Thumbnail Disappearance (220–240ms, default 230ms)
      // =========================================================================
      setPhase('disappearing');

      if (container) {
        const deletedEl = container.querySelector(`[data-page-id="${pageId}"]`) as HTMLElement | null;
        if (deletedEl && typeof deletedEl.animate === 'function') {
          const keyframes = isReduced
            ? [{ opacity: 1 }, { opacity: 0 }]
            : [
                { opacity: 1, transform: 'scale(1) translateY(0px)' },
                { opacity: 0, transform: 'scale(0.97) translateY(-2px)' },
              ];

          try {
            const anim = deletedEl.animate(keyframes, {
              duration: timings.disappearanceMs,
              easing: DELETION_EASING.disappearance,
              fill: 'forwards',
            });
            activeAnimationsRef.current.push(anim);
            await anim.finished;
            activeAnimationsRef.current = activeAnimationsRef.current.filter((a) => a !== anim);
          } catch {
            await safeSleep(timings.disappearanceMs);
          }
        } else {
          await safeSleep(timings.disappearanceMs);
        }
      } else {
        await safeSleep(timings.disappearanceMs);
      }

      if (!isMountedRef.current) return false;

      // =========================================================================
      // PHASE 2 — Remaining Thumbnails Reposition (280–320ms, default 300ms)
      // =========================================================================
      // Remove deleted thumbnail from layout space
      const remainingPages = pagesSnapshot.filter((p) => p.id !== pageId);
      const affectedIds = new Set(
        pagesSnapshot.slice(deletedIdx + 1).map((p) => p.id)
      );

      // Create FLIP completion promise
      const flipPromise = new Promise<void>((resolve) => {
        pendingFlipRef.current = {
          shiftX,
          affectedIds,
          resolve,
        };
      });

      // Update state to trigger useLayoutEffect FLIP animation
      setDisplayPagesState(remainingPages);
      setPhase('repositioning');

      // Await genuine completion of Phase 2 motion
      await flipPromise;

      if (!isMountedRef.current) return false;

      // =========================================================================
      // PHASE 3 — Page Renumbering (60–90ms, default 75ms)
      // =========================================================================
      setPhase('renumbering');
      await safeSleep(timings.renumberingMs);

      if (!isMountedRef.current) return false;

      // =========================================================================
      // PHASE 4 — Main Viewer Transition (140–180ms, default 160ms)
      // =========================================================================
      if (wasSelected) {
        setPhase('viewer-transition');
        setIsViewerCrossfading(true);

        // Select replacement page
        doSelect(replacementPageId);

        // Allow crossfade duration to settle
        await safeSleep(timings.viewerTransitionMs);
      }

      if (!isMountedRef.current) return false;

      // =========================================================================
      // PERSISTENCE & FINAL CLEANUP
      // =========================================================================
      try {
        doDelete?.(pageId);
      } catch (err) {
        console.error('Failed to commit page deletion persistence', err);
      }

      // Cleanup preloaded blobs
      if (preloadedBlobUrl) {
        try {
          URL.revokeObjectURL(preloadedBlobUrl);
        } catch {
          // ignore
        }
      }

      if (isMountedRef.current) {
        setPhase('idle');
        setDeletedPageId(null);
        setDeletedPageIndex(null);
        setDisplayPagesState(null);
        setOutgoingImageUrl(null);
        setIsViewerCrossfading(false);
      }

      return true;
    },
    [phase, customTimings, containerRef, safeSleep]
  );

  // Active display pages: during transition, use coordinator's displayPagesState; else fallback to prop
  const activeDisplayPages = displayPagesState ?? pages;

  // Number calculator adhering strictly to Phase 1/2 retention rule
  const displayedPageNum = useCallback(
    (page: PageMetadata, index: number) => {
      return getDisplayedPageNumber(page, index, phase, deletedPageIndex);
    },
    [phase, deletedPageIndex]
  );

  return {
    phase,
    isTransitionActive: phase !== 'idle',
    deletedPageId,
    displayPages: activeDisplayPages,
    displayedPageNum,
    outgoingImageUrl,
    isViewerCrossfading,
    viewerCrossfadeDuration: customTimings?.viewerTransitionMs ?? DEFAULT_DELETION_TIMINGS.viewerTransitionMs,
    startDeletion,
    cancelDeletion,
  };
}
