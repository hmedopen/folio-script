import type {
  PageDomainState,
  PhysicalContainer,
  TextRegion as DomainTextRegion,
  ContentRecord,
  ScanIssue,
  Point2D,
  PixelBox,
} from '../../types/domain/index.ts';
import { calculateBoxIoU, calculateCentroidDistance } from '../coordinateTransforms.ts';
import { calculateTextSimilarity } from '../rescanMerge.ts';
import { computeBoundingBox } from './geometryValidators.ts';

export interface ReconciliationReport {
  matchedCount: number;
  splitCount: number;
  mergeCount: number;
  newlyDetectedCount: number;
  missingPreservedCount: number;
  preservedManualEditsCount: number;
  ambiguousCount: number;
  diagnostics: string[];
}

export interface ReconcileOptions {
  iouThreshold?: number;
  matchScoreThreshold?: number;
  ambiguityDeltaThreshold?: number;
}

export function computeBoxFromPolygon(polygon: Point2D[]): PixelBox {
  return computeBoundingBox(polygon);
}

/**
 * Calculates match score between an existing ContentRecord (and its TextRegion)
 * and a newly scanned TextRegion and ContentRecord.
 */
export function computeDomainMatchScore(
  existingCr: ContentRecord,
  existingTr: DomainTextRegion | undefined,
  newCr: ContentRecord,
  newTr: DomainTextRegion | undefined,
  pageWidth: number,
  pageHeight: number
): {
  totalScore: number;
  iou: number;
  centroidDist: number;
  textSim: number;
  containerMatch: boolean;
} {
  const existingBox: PixelBox = existingTr?.geometry?.pixelPolygon
    ? computeBoxFromPolygon(existingTr.geometry.pixelPolygon)
    : [0, 0, 100, 100];

  const newBox: PixelBox = newTr?.geometry?.pixelPolygon
    ? computeBoxFromPolygon(newTr.geometry.pixelPolygon)
    : [0, 0, 100, 100];

  // 1. Normalized IoU
  const iou = calculateBoxIoU(existingBox, newBox);

  // 2. Centroid distance
  const maxDim = Math.max(pageWidth, pageHeight, 1000);
  const centroidDist = calculateCentroidDistance(existingBox, newBox);
  const centroidScore = Math.max(0, 1.0 - centroidDist / (maxDim * 0.25));

  // 3. Text similarity
  const textSimSource = calculateTextSimilarity(existingCr.sourceText, newCr.sourceText);
  const textSimOrig = existingCr.originalOcrText
    ? calculateTextSimilarity(existingCr.originalOcrText, newCr.sourceText)
    : 0;
  const textSim = Math.max(textSimSource, textSimOrig);

  // 4. Container match
  const containerMatch = Boolean(
    existingTr?.containerId &&
    newTr?.containerId &&
    existingTr.containerId === newTr.containerId
  );

  const hasText = Boolean(existingCr.sourceText?.trim() && newCr.sourceText?.trim());

  let totalScore: number;
  if (hasText) {
    totalScore =
      0.35 * iou +
      0.25 * centroidScore +
      0.30 * textSim +
      (containerMatch ? 0.10 : 0.0);
  } else {
    totalScore =
      0.55 * iou +
      0.35 * centroidScore +
      (containerMatch ? 0.10 : 0.0);
  }

  return {
    totalScore,
    iou,
    centroidDist,
    textSim,
    containerMatch,
  };
}

/**
 * Reconciles an existing PageDomainState with a freshly rescanned PageDomainState.
 * Strict Invariants:
 * - Manual edits, translations, translation history, and user pinned typers/order are NEVER lost.
 * - Missing existing records become unattached_content or orphaned candidates; NEVER silently deleted.
 * - Split, merge, and ambiguous cases are diagnosed and flagged with structured ScanIssues.
 */
export function reconcileDomainStates(
  existingState: PageDomainState,
  newState: PageDomainState,
  options: ReconcileOptions = {}
): {
  reconciledState: PageDomainState;
  report: ReconciliationReport;
} {
  const {
    iouThreshold = 0.40,
    matchScoreThreshold = 0.42,
    ambiguityDeltaThreshold = 0.08,
  } = options;

  const now = Date.now();
  const width = existingState.dimensions.width || newState.dimensions.width || 1000;
  const height = existingState.dimensions.height || newState.dimensions.height || 1000;

  const report: ReconciliationReport = {
    matchedCount: 0,
    splitCount: 0,
    mergeCount: 0,
    newlyDetectedCount: 0,
    missingPreservedCount: 0,
    preservedManualEditsCount: 0,
    ambiguousCount: 0,
    diagnostics: [],
  };

  const existingCrs = Object.values(existingState.contentRecords);
  const newCrs = Object.values(newState.contentRecords);

  // Pairwise scoring
  interface MatchPair {
    existingCr: ContentRecord;
    newCr: ContentRecord;
    score: number;
    iou: number;
    textSim: number;
  }

  const pairs: MatchPair[] = [];

  for (const eCr of existingCrs) {
    const eTr = existingState.textRegions[eCr.regionTargets[0]?.regionId];
    for (const nCr of newCrs) {
      const nTr = newState.textRegions[nCr.regionTargets[0]?.regionId];
      const match = computeDomainMatchScore(eCr, eTr, nCr, nTr, width, height);

      const isQualified =
        match.totalScore >= matchScoreThreshold ||
        match.iou >= iouThreshold ||
        (match.iou >= 0.15 && match.textSim >= 0.60);

      if (isQualified) {
        pairs.push({
          existingCr: eCr,
          newCr: nCr,
          score: match.totalScore,
          iou: match.iou,
          textSim: match.textSim,
        });
      }
    }
  }

  // Sort descending by score
  pairs.sort((a, b) => b.score - a.score);

  const matchedExistingToNew = new Map<string, ContentRecord>();
  const matchedNewToExisting = new Map<string, ContentRecord>();
  const candidatesPerExisting = new Map<string, MatchPair[]>();

  for (const pair of pairs) {
    const eId = pair.existingCr.contentId;
    if (!candidatesPerExisting.has(eId)) {
      candidatesPerExisting.set(eId, []);
    }
    candidatesPerExisting.get(eId)!.push(pair);
  }

  // Check for merge detection: multiple existing records matching the same newly detected region
  const candidatesPerNew = new Map<string, MatchPair[]>();
  for (const pair of pairs) {
    const nId = pair.newCr.contentId;
    if (!candidatesPerNew.has(nId)) {
      candidatesPerNew.set(nId, []);
    }
    candidatesPerNew.get(nId)!.push(pair);
  }

  const mergedNewIds = new Set<string>();
  for (const [nId, candList] of candidatesPerNew.entries()) {
    if (candList.length >= 2) {
      const distinctExisting = candList.filter((c, idx, arr) =>
        arr.findIndex((o) => o.existingCr.contentId === c.existingCr.contentId) === idx
      );
      if (distinctExisting.length >= 2) {
        const top2 = distinctExisting[1];
        if (top2.score >= 0.35 || top2.iou >= 0.15) {
          mergedNewIds.add(nId);
          report.mergeCount++;
          report.diagnostics.push(
            `Merge detection: previous records ${distinctExisting.map((c) => c.existingCr.contentId).join(', ')} merged into single detected region ${nId}.`
          );
        }
      }
    }
  }

  // Check for ambiguous matches
  const ambiguousExistingIds = new Set<string>();
  for (const [eId, candList] of candidatesPerExisting.entries()) {
    if (candList.length >= 2) {
      const [top1, top2] = candList;
      if (Math.abs(top1.score - top2.score) < ambiguityDeltaThreshold && top2.score >= 0.40) {
        ambiguousExistingIds.add(eId);
        report.ambiguousCount++;
        report.diagnostics.push(
          `Ambiguous match for existing record ${eId} between ${top1.newCr.contentId} (score: ${top1.score.toFixed(2)}) and ${top2.newCr.contentId} (score: ${top2.score.toFixed(2)})`
        );
      }
    }
  }

  // Greedy 1-to-1 matching
  for (const pair of pairs) {
    const eId = pair.existingCr.contentId;
    const nId = pair.newCr.contentId;
    if (!matchedExistingToNew.has(eId) && !matchedNewToExisting.has(nId)) {
      matchedExistingToNew.set(eId, pair.newCr);
      matchedNewToExisting.set(nId, pair.existingCr);
      report.matchedCount++;
    }
  }

  // Reconciled containers, text regions, content records, reading sequence, issues
  const reconciledContainers: Record<string, PhysicalContainer> = { ...newState.containers };
  const reconciledTextRegions: Record<string, DomainTextRegion> = { ...newState.textRegions };
  const reconciledContentRecords: Record<string, ContentRecord> = {};
  const reconciledSequence: string[] = [];
  const reconciledIssues: ScanIssue[] = [...(newState.issues || [])];

  // Record merge issues for detected merges
  for (const nId of mergedNewIds) {
    const associatedPairs = candidatesPerNew.get(nId) || [];
    const involvedExistingIds = Array.from(new Set(associatedPairs.map((p) => p.existingCr.contentId)));
    reconciledIssues.push({
      issueId: `issue-merge-${nId}-${now}`,
      flag: 'MERGE_DETECTED',
      severity: 'suggestion',
      affectedEntityIds: [nId, ...involvedExistingIds],
      reason: `New scan merged previous distinct dialogue records (${involvedExistingIds.join(', ')}) into a single region.`,
      retryable: false,
    });
  }

  // 1. Process Matched Existing Records
  for (const eCr of existingCrs) {
    const eId = eCr.contentId;
    const matchedNewCr = matchedExistingToNew.get(eId);

    if (matchedNewCr) {
      const isManual = Boolean(
        eCr.orderState?.isUserPinned ||
        eCr.provenance?.sourceText?.source === 'user_manual'
      );

      if (isManual) {
        report.preservedManualEditsCount++;
      }

      // Check manual geometry preservation: preserve manual polygons/boxes across rescan
      const existingTrId = eCr.regionTargets[0]?.regionId;
      const existingTr = existingTrId ? existingState.textRegions[existingTrId] : undefined;
      const hasManualGeometry = Boolean(
        existingTr?.provenance?.geometry?.source === 'user_manual' ||
        eCr.orderState?.isUserPinned
      );

      if (hasManualGeometry && existingTr) {
        const targetNewRegionId = matchedNewCr.regionTargets[0]?.regionId;
        if (targetNewRegionId && reconciledTextRegions[targetNewRegionId]) {
          reconciledTextRegions[targetNewRegionId] = {
            ...reconciledTextRegions[targetNewRegionId],
            geometry: existingTr.geometry,
            provenance: {
              ...reconciledTextRegions[targetNewRegionId].provenance,
              geometry: existingTr.provenance.geometry,
            },
          };
        }
        if (existingTr.containerId && existingState.containers[existingTr.containerId]) {
          const origCont = existingState.containers[existingTr.containerId];
          if (origCont.provenance?.geometry?.source === 'user_manual') {
            const newContId = targetNewRegionId ? reconciledTextRegions[targetNewRegionId]?.containerId : undefined;
            if (newContId && reconciledContainers[newContId]) {
              reconciledContainers[newContId] = {
                ...reconciledContainers[newContId],
                geometry: origCont.geometry,
                provenance: {
                  ...reconciledContainers[newContId].provenance,
                  geometry: origCont.provenance.geometry,
                },
              };
            }
          }
        }
      }

      // Preserve existing manual edits, translations, speakers, typer, and review decisions
      const reconciledCr: ContentRecord = {
        ...matchedNewCr,
        contentId: eId, // PRESERVE IDENTITY!
        pageId: existingState.pageId,
        sourceText: isManual ? eCr.sourceText : matchedNewCr.sourceText,
        originalOcrText: matchedNewCr.sourceText,
        translatedText: eCr.translatedText || '',
        translationHistory: [...eCr.translationHistory],
        speakerIds: eCr.speakerIds?.length > 0 ? [...eCr.speakerIds] : [...matchedNewCr.speakerIds],
        typerTag: eCr.typerTag || matchedNewCr.typerTag,
        status: 'active',
        orderState: {
          isUserPinned: eCr.orderState?.isUserPinned || false,
          pinnedAt: eCr.orderState?.pinnedAt,
        },
        reviewFlags: [...eCr.reviewFlags],
        provenance: {
          sourceText: isManual
            ? (eCr.provenance?.sourceText || { source: 'user_manual', updatedAt: now })
            : { source: 'ocr_engine', updatedAt: now },
          translatedText: eCr.translatedText
            ? (eCr.provenance?.translatedText || { source: 'user_manual', updatedAt: now })
            : { source: 'ocr_engine', updatedAt: now },
          typerTag: eCr.typerTag
            ? (eCr.provenance?.typerTag || { source: 'user_manual', updatedAt: now })
            : { source: 'local_detector', updatedAt: now },
          speakerIds: eCr.speakerIds?.length > 0
            ? (eCr.provenance?.speakerIds || { source: 'user_manual', updatedAt: now })
            : { source: 'local_detector', updatedAt: now },
          contentType: eCr.provenance?.contentType || { source: 'local_detector', updatedAt: now },
          regionTargets: matchedNewCr.provenance?.regionTargets || { source: 'ocr_engine', updatedAt: now },
        },
      };

      if (ambiguousExistingIds.has(eId)) {
        reconciledIssues.push({
          issueId: `issue-ambiguous-${eId}-${now}`,
          flag: 'MATCH_AMBIGUOUS',
          severity: 'warning',
          affectedEntityIds: [eId],
          reason: `Multiple newly detected text candidates matched record ${eId} with close confidence scores.`,
          retryable: false,
        });
      }

      reconciledContentRecords[eId] = reconciledCr;
    } else {
      // 2. Process Missing Existing Records (Zero Deletion Invariant)
      report.missingPreservedCount++;
      report.diagnostics.push(`Existing record ${eId} had no match in new scan; preserved as unattached_content.`);

      const preservedMissingCr: ContentRecord = {
        ...eCr,
        status: 'unattached_content',
      };
      reconciledContentRecords[eId] = preservedMissingCr;

      // Preserve its text region and container if existing
      const origRegionId = eCr.regionTargets[0]?.regionId;
      if (origRegionId && existingState.textRegions[origRegionId]) {
        const origTr = existingState.textRegions[origRegionId];
        reconciledTextRegions[origRegionId] = {
          ...origTr,
          lifecycleState: 'orphaned_candidate',
        };
        if (origTr.containerId && existingState.containers[origTr.containerId]) {
          const origCont = existingState.containers[origTr.containerId];
          reconciledContainers[origTr.containerId] = {
            ...origCont,
            state: 'orphaned_candidate',
          };
        }
      }

      reconciledIssues.push({
        issueId: `issue-unmatched-${eId}-${now}`,
        flag: 'UNMATCHED_EXISTING_RECORD',
        severity: 'warning',
        affectedEntityIds: [eId],
        reason: `Existing text record "${eCr.sourceText.slice(0, 30)}" was not detected in the rescan. It has been preserved as unattached content.`,
        retryable: true,
      });
    }
  }

  // 3. Process Newly Detected Records (in new scan but not matched to existing)
  const newlyDetectedNewCrs: ContentRecord[] = [];
  for (const nCr of newCrs) {
    if (!matchedNewToExisting.has(nCr.contentId)) {
      report.newlyDetectedCount++;
      newlyDetectedNewCrs.push(nCr);
      reconciledContentRecords[nCr.contentId] = nCr;

      // Check if this newly detected record shares a container with a matched existing record (Split Detection!)
      const nTr = newState.textRegions[nCr.regionTargets[0]?.regionId];
      if (nTr?.containerId) {
        const sharesContainer = Object.values(reconciledContentRecords).some((r) => {
          if (r.contentId === nCr.contentId) return false;
          const tr = reconciledTextRegions[r.regionTargets[0]?.regionId];
          return tr?.containerId === nTr.containerId;
        });

        if (sharesContainer) {
          report.splitCount++;
          report.diagnostics.push(
            `Split detection: container ${nTr.containerId} now contains newly detected dialogue section ${nCr.contentId}.`
          );
          reconciledIssues.push({
            issueId: `issue-split-${nCr.contentId}-${now}`,
            flag: 'SPLIT_DETECTED',
            severity: 'suggestion',
            affectedEntityIds: [nCr.contentId],
            reason: `New scan detected multiple distinct dialogue sections inside container ${nTr.containerId}.`,
            retryable: false,
          });
        }
      }
    }
  }

  // 4. Reconstruct Reading Sequence Preserving Pinned Decisions and Local Re-anchoring
  const existingPinnedSequence = existingState.readingSequence.filter((id) =>
    reconciledContentRecords[id]?.orderState?.isUserPinned
  );

  const matchedOrderMap = new Map<string, number>();
  for (let idx = 0; idx < newState.readingSequence.length; idx++) {
    const nId = newState.readingSequence[idx];
    const eCr = matchedNewToExisting.get(nId);
    if (eCr) {
      matchedOrderMap.set(eCr.contentId, idx);
    } else {
      matchedOrderMap.set(nId, idx);
    }
  }

  // Re-anchoring helper: computes an effective position for any record not directly in matchedOrderMap
  const getEffectiveOrder = (id: string): number => {
    if (matchedOrderMap.has(id)) {
      return matchedOrderMap.get(id)!;
    }

    // If this record was in existingState.readingSequence, anchor to nearest matched neighbor
    const existIdx = existingState.readingSequence.indexOf(id);
    if (existIdx !== -1) {
      let prevOrder: number | null = null;
      for (let i = existIdx - 1; i >= 0; i--) {
        const neighborId = existingState.readingSequence[i];
        if (matchedOrderMap.has(neighborId)) {
          prevOrder = matchedOrderMap.get(neighborId)!;
          break;
        }
      }

      let nextOrder: number | null = null;
      for (let i = existIdx + 1; i < existingState.readingSequence.length; i++) {
        const neighborId = existingState.readingSequence[i];
        if (matchedOrderMap.has(neighborId)) {
          nextOrder = matchedOrderMap.get(neighborId)!;
          break;
        }
      }

      if (prevOrder !== null && nextOrder !== null) {
        return (prevOrder + nextOrder) / 2;
      }
      if (prevOrder !== null) {
        return prevOrder + 0.1;
      }
      if (nextOrder !== null) {
        return nextOrder - 0.1;
      }
      return existIdx * 100;
    }

    return 9999;
  };

  const allReconciledIds = Object.keys(reconciledContentRecords);
  allReconciledIds.sort((a, b) => {
    const aIsPinned = Boolean(reconciledContentRecords[a]?.orderState?.isUserPinned);
    const bIsPinned = Boolean(reconciledContentRecords[b]?.orderState?.isUserPinned);

    if (aIsPinned && bIsPinned) {
      const idxA = existingPinnedSequence.indexOf(a);
      const idxB = existingPinnedSequence.indexOf(b);
      if (idxA !== -1 && idxB !== -1) return idxA - idxB;
    }

    const orderA = getEffectiveOrder(a);
    const orderB = getEffectiveOrder(b);
    return orderA - orderB;
  });

  reconciledSequence.push(...allReconciledIds);

  const reconciledState: PageDomainState = {
    pageId: existingState.pageId,
    chapterId: existingState.chapterId || newState.chapterId,
    dimensions: { width, height },
    spatialGroups: { ...newState.spatialGroups, ...existingState.spatialGroups },
    containers: reconciledContainers,
    textRegions: reconciledTextRegions,
    contentRecords: reconciledContentRecords,
    readingSequence: reconciledSequence,
    issues: reconciledIssues,
    activeScanRunId: newState.activeScanRunId || existingState.activeScanRunId,
    version: 9,
    updatedAt: now,
    extensions: {
      legacyPayload: {
        lastReconciledAt: now,
        report,
      },
    },
  };

  return { reconciledState, report };
}
