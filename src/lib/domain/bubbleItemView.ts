import type {
  PageDomainState,
  PhysicalContainer,
  TextRegion as DomainTextRegion,
  ContentRecord,
  Point2D,
  PixelBox,
} from '../../types/domain/index.ts';
import type { BubbleItem, BubbleType, ReviewFlagItem, TyperPrefix } from '../../types/workbench.ts';
import { computeBoundingBox } from './geometryValidators.ts';
import { derivePolygonFromBubble } from './v9Migration.ts';

/**
 * Creates a BubbleItemView compatibility facade projecting a canonical ContentRecord
 * into the legacy BubbleItem interface consumed by CanvasPane, DialogueCard, TypeR, etc.
 */
export function createBubbleItemView(
  contentRecord: ContentRecord,
  domainState: PageDomainState,
  index: number
): BubbleItem {
  const width = domainState.dimensions?.width || 1000;
  const height = domainState.dimensions?.height || 1000;

  const targetRegionId = contentRecord.regionTargets[0]?.regionId;
  const targetRegion = targetRegionId ? domainState.textRegions[targetRegionId] : undefined;
  const container = targetRegion?.containerId ? domainState.containers[targetRegion.containerId] : undefined;

  // Authoritative tight geometry: text region polygon -> container body contour -> fallback
  const pixelPolygon =
    targetRegion?.geometry?.pixelPolygon ||
    container?.geometry?.bodyContour ||
    undefined;

  const pixelBox: PixelBox = pixelPolygon && pixelPolygon.length >= 3
    ? computeBoundingBox(pixelPolygon)
    : [0, 0, 100, 100];

  // Normalized 0-1000 bounding box
  const box_2d: [number, number, number, number] = [
    Math.max(0, Math.min(1000, Math.round((pixelBox[0] / height) * 1000))),
    Math.max(0, Math.min(1000, Math.round((pixelBox[1] / width) * 1000))),
    Math.max(0, Math.min(1000, Math.round((pixelBox[2] / height) * 1000))),
    Math.max(0, Math.min(1000, Math.round((pixelBox[3] / width) * 1000))),
  ];

  // Review flags adapter
  const reviewFlags: ReviewFlagItem[] = (contentRecord.reviewFlags || []).map((rf) => ({
    id: rf.flagId,
    category: rf.category as any,
    severity: rf.severity,
    reasonAr: rf.reasonAr,
    status: rf.status,
  }));

  const isManuallyEdited = Boolean(
    contentRecord.orderState?.isUserPinned ||
    contentRecord.provenance?.sourceText?.source === 'user_manual'
  );

  const legacyList = domainState.extensions?.legacyPayload?.bubbles as BubbleItem[] | undefined;
  const legacyItem = legacyList?.find((b) => b.id === contentRecord.contentId);

  return {
    id: contentRecord.contentId,
    pageId: contentRecord.pageId || domainState.pageId,
    chapterId: domainState.chapterId,
    index,
    box_2d,
    pixelBox,
    pixelPolygon,
    regionId: targetRegionId,
    type: (contentRecord.typerTag?.id || legacyItem?.type || 'speech_bubbles') as BubbleType,
    typerPrefix: (contentRecord.typerTag?.prefix ?? legacyItem?.typerPrefix ?? '"":') as TyperPrefix,
    sourceText: contentRecord.sourceText || '',
    originalSourceText: contentRecord.originalOcrText || contentRecord.sourceText || legacyItem?.originalSourceText || '',
    translatedText: contentRecord.translatedText || '',
    rawTranslatedText: contentRecord.translatedText || legacyItem?.rawTranslatedText || '',
    translationHistory: [...(contentRecord.translationHistory || [])],
    reviewFlags,
    speakerCharacterId: contentRecord.speakerIds?.[0] || legacyItem?.speakerCharacterId,
    confidence: targetRegion?.confidence ?? legacyItem?.confidence ?? 0.9,
    isManuallyEdited,
    updatedAt: contentRecord.provenance?.sourceText?.updatedAt || domainState.updatedAt,
    provenance: legacyItem?.provenance ?? (isManuallyEdited ? 'manual_selection' : 'auto_scan'),
    manualSelectionShape: legacyItem?.manualSelectionShape,
    manualPolygon: legacyItem?.manualPolygon,
    manualColorSnapshot: legacyItem?.manualColorSnapshot,
    manualExtractionStatus: legacyItem?.manualExtractionStatus,
    manualExtractionError: legacyItem?.manualExtractionError,
    manualTranslationStatus: legacyItem?.manualTranslationStatus,
    manualTranslationError: legacyItem?.manualTranslationError,
  };
}

/**
 * Projects an entire canonical PageDomainState into an ordered array of BubbleItem views.
 */
export function domainStateToBubbleViews(domainState: PageDomainState): BubbleItem[] {
  const views: BubbleItem[] = [];
  const seq = domainState.readingSequence || Object.keys(domainState.contentRecords);

  for (let i = 0; i < seq.length; i++) {
    const crId = seq[i];
    const cr = domainState.contentRecords[crId];
    if (cr && cr.status !== 'archived') {
      views.push(createBubbleItemView(cr, domainState, views.length + 1));
    }
  }

  return views;
}

/**
 * Applies a partial BubbleItem update back to the canonical PageDomainState.
 */
export function applyBubblePatchToDomainState(
  domainState: PageDomainState,
  bubbleId: string,
  patch: Partial<BubbleItem>
): PageDomainState {
  const cr = domainState.contentRecords[bubbleId];
  if (!cr) return domainState;

  const now = Date.now();
  const width = domainState.dimensions?.width || 1000;
  const height = domainState.dimensions?.height || 1000;

  const updatedCr: ContentRecord = {
    ...cr,
    ...(patch.sourceText !== undefined ? { sourceText: patch.sourceText } : {}),
    ...(patch.translatedText !== undefined ? { translatedText: patch.translatedText } : {}),
    ...(patch.type !== undefined || patch.typerPrefix !== undefined
      ? {
          typerTag: {
            id: patch.type !== undefined ? patch.type : cr.typerTag?.id || 'speech_bubbles',
            prefix: patch.typerPrefix !== undefined ? patch.typerPrefix : cr.typerTag?.prefix || '"":',
          },
        }
      : {}),
    ...(patch.speakerCharacterId !== undefined
      ? { speakerIds: patch.speakerCharacterId ? [patch.speakerCharacterId] : [] }
      : {}),
    ...(patch.translationHistory !== undefined
      ? {
          translationHistory: patch.translationHistory.map((th, idx) => ({
            versionId: (th as any).versionId || `v-${cr.contentId}-${idx}-${th.timestamp || now}`,
            timestamp: th.timestamp || now,
            text: th.text || '',
            type: th.type || 'manual',
          })),
        }
      : patch.translatedText !== undefined && patch.translatedText !== cr.translatedText
      ? {
          translationHistory: [
            ...cr.translationHistory,
            { versionId: `v-${now}`, timestamp: now, text: patch.translatedText, type: 'manual' },
          ],
        }
      : {}),
    orderState: {
      ...cr.orderState,
      ...(patch.isManuallyEdited ? { isUserPinned: true, pinnedAt: now } : {}),
    },
    provenance: {
      ...cr.provenance,
      ...(patch.sourceText !== undefined ? { sourceText: { source: 'user_manual', updatedAt: now } } : {}),
      ...(patch.translatedText !== undefined ? { translatedText: { source: 'user_manual', updatedAt: now } } : {}),
    },
  };

  const updatedTextRegions = { ...domainState.textRegions };
  const updatedContainers = { ...domainState.containers };
  const targetRegionId = cr.regionTargets[0]?.regionId;

  if (targetRegionId && updatedTextRegions[targetRegionId]) {
    const tr = updatedTextRegions[targetRegionId];
    let newPoly: Point2D[] | undefined;
    if (Array.isArray(patch.pixelPolygon) && patch.pixelPolygon.length >= 3) {
      newPoly = patch.pixelPolygon.map(([x, y]) => [Number(x), Number(y)] as Point2D);
    } else if (Array.isArray(patch.manualPolygon) && patch.manualPolygon.length >= 3) {
      newPoly = patch.manualPolygon.map(([x, y]) => [
        Number(Math.round(((x / 1000) * width) * 1000) / 1000),
        Number(Math.round(((y / 1000) * height) * 1000) / 1000),
      ] as Point2D);
    } else if (Array.isArray(patch.pixelBox) && patch.pixelBox.length === 4) {
      const [minY, minX, maxY, maxX] = patch.pixelBox;
      newPoly = [
        [minX, minY],
        [maxX, minY],
        [maxX, maxY],
        [minX, maxY],
      ];
    } else if (Array.isArray(patch.box_2d) && patch.box_2d.length === 4) {
      const [bMinY, bMinX, bMaxY, bMaxX] = patch.box_2d;
      newPoly = [
        [Math.round(((bMinX / 1000) * width) * 1000) / 1000, Math.round(((bMinY / 1000) * height) * 1000) / 1000],
        [Math.round(((bMaxX / 1000) * width) * 1000) / 1000, Math.round(((bMinY / 1000) * height) * 1000) / 1000],
        [Math.round(((bMaxX / 1000) * width) * 1000) / 1000, Math.round(((bMaxY / 1000) * height) * 1000) / 1000],
        [Math.round(((bMinX / 1000) * width) * 1000) / 1000, Math.round(((bMaxY / 1000) * height) * 1000) / 1000],
      ];
    }

    if (newPoly) {
      updatedTextRegions[targetRegionId] = {
        ...tr,
        geometry: { pixelPolygon: newPoly },
        provenance: { ...tr.provenance, geometry: { source: 'user_manual', updatedAt: now } },
      };

      if (tr.containerId && updatedContainers[tr.containerId]) {
        const cont = updatedContainers[tr.containerId];
        updatedContainers[tr.containerId] = {
          ...cont,
          geometry: {
            ...cont.geometry,
            bodyContour: newPoly,
          },
          provenance: {
            ...cont.provenance,
            geometry: { source: 'user_manual', updatedAt: now },
          },
        };
      }
    }
  }

  let updatedLegacyBubbles = domainState.extensions?.legacyPayload?.bubbles as BubbleItem[] | undefined;
  if (Array.isArray(updatedLegacyBubbles)) {
    updatedLegacyBubbles = updatedLegacyBubbles.map((b) =>
      b.id === bubbleId ? { ...b, ...patch, updatedAt: now } : b
    );
  }

  return {
    ...domainState,
    contentRecords: {
      ...domainState.contentRecords,
      [bubbleId]: updatedCr,
    },
    containers: updatedContainers,
    textRegions: updatedTextRegions,
    updatedAt: now,
    extensions: {
      ...domainState.extensions,
      ...(updatedLegacyBubbles
        ? {
            legacyPayload: {
              ...domainState.extensions?.legacyPayload,
              bubbles: updatedLegacyBubbles,
            },
          }
        : {}),
    },
  };
}

/**
 * Removes a bubble from the reading sequence and marks it archived.
 */
export function deleteBubbleFromDomainState(
  domainState: PageDomainState,
  bubbleId: string
): PageDomainState {
  const cr = domainState.contentRecords[bubbleId];
  if (!cr) return domainState;

  const now = Date.now();
  const updatedSeq = domainState.readingSequence.filter((id) => id !== bubbleId);
  const updatedCr: ContentRecord = {
    ...cr,
    status: 'archived',
  };

  let updatedLegacyBubbles = domainState.extensions?.legacyPayload?.bubbles as BubbleItem[] | undefined;
  if (Array.isArray(updatedLegacyBubbles)) {
    updatedLegacyBubbles = updatedLegacyBubbles.filter((b) => b.id !== bubbleId);
  }

  return {
    ...domainState,
    contentRecords: {
      ...domainState.contentRecords,
      [bubbleId]: updatedCr,
    },
    readingSequence: updatedSeq,
    updatedAt: now,
    extensions: {
      ...domainState.extensions,
      ...(updatedLegacyBubbles
        ? {
            legacyPayload: {
              ...domainState.extensions?.legacyPayload,
              bubbles: updatedLegacyBubbles,
            },
          }
        : {}),
    },
  };
}

/**
 * Reorders the reading sequence and pins the records.
 */
export function reorderDomainSequence(
  domainState: PageDomainState,
  newOrderIds: string[]
): PageDomainState {
  const now = Date.now();
  const updatedCrs = { ...domainState.contentRecords };

  for (const id of newOrderIds) {
    if (updatedCrs[id]) {
      updatedCrs[id] = {
        ...updatedCrs[id],
        orderState: {
          ...updatedCrs[id].orderState,
          isUserPinned: true,
          pinnedAt: now,
        },
      };
    }
  }

  return {
    ...domainState,
    contentRecords: updatedCrs,
    readingSequence: [...newOrderIds],
    updatedAt: now,
  };
}

/**
 * Adds a manually created bubble to canonical domain state.
 */
export function addManualBubbleToDomainState(
  domainState: PageDomainState,
  bubble: BubbleItem
): PageDomainState {
  const now = Date.now();
  const width = domainState.dimensions?.width || 1000;
  const height = domainState.dimensions?.height || 1000;

  const poly: Point2D[] = derivePolygonFromBubble(bubble, width, height);

  const containerId = `c-${bubble.id}`;
  const regionId = `r-${bubble.id}`;
  const contentId = bubble.id;

  const newContainer: PhysicalContainer = {
    containerId,
    pageId: domainState.pageId,
    containerType: 'speech_balloon',
    geometry: { bodyContour: poly, tails: [] },
    confidence: 1.0,
    boundaryUncertain: false,
    zIndex: domainState.readingSequence.length + 1,
    state: 'active',
    provenance: {
      geometry: { source: 'user_manual', updatedAt: now },
      containerType: { source: 'user_manual', updatedAt: now },
    },
  };

  const newRegion: DomainTextRegion = {
    regionId,
    pageId: domainState.pageId,
    containerId,
    containerAssociation: 'associated',
    geometry: { pixelPolygon: poly },
    orientation: 'horizontal',
    lineObservationIds: [`line-${contentId}`],
    rubyAnnotations: [],
    confidence: 1.0,
    lifecycleState: 'active',
    provenance: {
      geometry: { source: 'user_manual', updatedAt: now },
      containerId: { source: 'user_manual', updatedAt: now },
    },
  };

  const newCr: ContentRecord = {
    contentId,
    pageId: domainState.pageId,
    regionTargets: [{ regionId }],
    contentType: 'dialogue',
    speakerIds: [],
    sourceText: bubble.sourceText || '',
    originalOcrText: '',
    translatedText: bubble.translatedText || '',
    translationHistory: [],
    typerTag: {
      id: bubble.type || 'speech_bubbles',
      prefix: bubble.typerPrefix !== undefined ? bubble.typerPrefix : '"":',
    },
    status: 'active',
    orderState: { isUserPinned: true, pinnedAt: now },
    reviewFlags: [],
    provenance: {
      sourceText: { source: 'user_manual', updatedAt: now },
      translatedText: { source: 'user_manual', updatedAt: now },
      typerTag: { source: 'user_manual', updatedAt: now },
      speakerIds: { source: 'user_manual', updatedAt: now },
      contentType: { source: 'user_manual', updatedAt: now },
      regionTargets: { source: 'user_manual', updatedAt: now },
    },
  };

  const existingBubbles = (domainState.extensions?.legacyPayload?.bubbles as BubbleItem[] | undefined) || [];
  const updatedBubbles = [...existingBubbles, bubble];

  return {
    ...domainState,
    containers: { ...domainState.containers, [containerId]: newContainer },
    textRegions: { ...domainState.textRegions, [regionId]: newRegion },
    contentRecords: { ...domainState.contentRecords, [contentId]: newCr },
    readingSequence: [...domainState.readingSequence, contentId],
    updatedAt: now,
    extensions: {
      ...domainState.extensions,
      legacyPayload: {
        ...domainState.extensions?.legacyPayload,
        bubbles: updatedBubbles,
      },
    },
  };
}

/**
 * Splits an existing bubble in the canonical domain state into two dialogue content records.
 * Both content records share the same physical visual container/region.
 */
export function splitBubbleInDomainState(
  domainState: PageDomainState,
  bubbleId: string,
  splitIndex: number
): { domainState: PageDomainState; newBubbleId: string } {
  const cr = domainState.contentRecords[bubbleId];
  if (!cr) throw new Error(`Bubble ${bubbleId} not found in domain state`);

  const now = Date.now();
  const text = cr.sourceText || '';
  const firstText = text.slice(0, splitIndex).trim();
  const secondText = text.slice(splitIndex).trim();

  const newBubbleId = `bubble-${now}-${Math.random().toString(36).substring(2, 7)}`;
  const regionId = cr.regionTargets[0]?.regionId || `r-${bubbleId}`;

  // Updated original content record
  const updatedFirstCr: ContentRecord = {
    ...cr,
    sourceText: firstText,
    orderState: { ...cr.orderState, isUserPinned: true, pinnedAt: now },
    provenance: { ...cr.provenance, sourceText: { source: 'user_manual', updatedAt: now } },
  };

  // Second content record sharing the same region and physical balloon!
  const secondCr: ContentRecord = {
    contentId: newBubbleId,
    pageId: domainState.pageId,
    regionTargets: [{ regionId }],
    contentType: cr.contentType,
    speakerIds: [...cr.speakerIds],
    sourceText: secondText,
    originalOcrText: '',
    translatedText: '',
    translationHistory: [],
    typerTag: { ...cr.typerTag },
    status: 'active',
    orderState: { isUserPinned: true, pinnedAt: now },
    reviewFlags: [],
    provenance: {
      sourceText: { source: 'user_manual', updatedAt: now },
      translatedText: { source: 'user_manual', updatedAt: now },
      typerTag: { source: 'user_manual', updatedAt: now },
      speakerIds: { source: 'user_manual', updatedAt: now },
      contentType: { source: 'user_manual', updatedAt: now },
      regionTargets: { source: 'user_manual', updatedAt: now },
    },
  };

  // Insert into reading sequence immediately after bubbleId
  const seqIdx = domainState.readingSequence.indexOf(bubbleId);
  const newSeq = [...domainState.readingSequence];
  if (seqIdx !== -1) {
    newSeq.splice(seqIdx + 1, 0, newBubbleId);
  } else {
    newSeq.push(newBubbleId);
  }

  let updatedLegacyBubbles = domainState.extensions?.legacyPayload?.bubbles as BubbleItem[] | undefined;
  if (Array.isArray(updatedLegacyBubbles)) {
    const existingIdx = updatedLegacyBubbles.findIndex((b) => b.id === bubbleId);
    if (existingIdx !== -1) {
      const origBubble = updatedLegacyBubbles[existingIdx];
      const secondView: BubbleItem = {
        ...origBubble,
        id: newBubbleId,
        sourceText: secondText,
        translatedText: '',
        rawTranslatedText: '',
        translationHistory: [],
        isManuallyEdited: true,
        updatedAt: now,
      };
      updatedLegacyBubbles = [
        ...updatedLegacyBubbles.slice(0, existingIdx),
        { ...origBubble, sourceText: firstText, isManuallyEdited: true, updatedAt: now },
        secondView,
        ...updatedLegacyBubbles.slice(existingIdx + 1),
      ];
    }
  }

  const nextState: PageDomainState = {
    ...domainState,
    contentRecords: {
      ...domainState.contentRecords,
      [bubbleId]: updatedFirstCr,
      [newBubbleId]: secondCr,
    },
    readingSequence: newSeq,
    updatedAt: now,
    extensions: {
      ...domainState.extensions,
      ...(updatedLegacyBubbles
        ? {
            legacyPayload: {
              ...domainState.extensions?.legacyPayload,
              bubbles: updatedLegacyBubbles,
            },
          }
        : {}),
    },
  };

  return { domainState: nextState, newBubbleId };
}

/**
 * Reconciles external or legacy bubble modifications into an authoritative PageDomainState
 * without degrading rich domain structures (physical containers, concave contours, ruby annotations, observations).
 * Canonical domain state remains authoritative: only genuine changes in legacy text or typers are ingested.
 */
export function reconcileLegacyChangesIntoDomainState(
  domainState: PageDomainState,
  legacyBubbles: BubbleItem[]
): { reconciledState: PageDomainState; hasChanges: boolean } {
  if (!Array.isArray(legacyBubbles) || legacyBubbles.length === 0) {
    return { reconciledState: domainState, hasChanges: false };
  }

  let hasChanges = false;
  let nextContentRecords = { ...domainState.contentRecords };
  let nextReadingSequence = [...domainState.readingSequence];
  let nextState = { ...domainState };
  const now = Date.now();

  for (const b of legacyBubbles) {
    // Match against content records by contentId or regionId
    const cr =
      nextContentRecords[b.id] ||
      Object.values(nextContentRecords).find((c) =>
        c.regionTargets.some((rt) => rt.regionId === b.id || rt.regionId === b.regionId)
      );

    if (cr) {
      const crUpdated = cr.provenance?.sourceText?.updatedAt || 0;
      const bUpdated = b.updatedAt || 0;

      // Only apply if legacy item has actual distinct text or newer user edit
      const sourceDiff = b.sourceText !== undefined && b.sourceText.trim() !== (cr.sourceText || '').trim();
      const transDiff = b.translatedText !== undefined && b.translatedText.trim() !== (cr.translatedText || '').trim();
      const typeDiff = b.type !== undefined && b.type !== cr.typerTag?.id;

      if ((sourceDiff || transDiff || typeDiff) && (bUpdated >= crUpdated || b.isManuallyEdited)) {
        hasChanges = true;
        const updatedCr: ContentRecord = {
          ...cr,
          ...(sourceDiff ? { sourceText: b.sourceText } : {}),
          ...(transDiff ? { translatedText: b.translatedText } : {}),
          ...(typeDiff ? { typerTag: { id: b.type!, prefix: b.typerPrefix ?? cr.typerTag?.prefix ?? '"":' } } : {}),
          provenance: {
            ...cr.provenance,
            ...(sourceDiff ? { sourceText: { source: 'user_manual', updatedAt: now } } : {}),
            ...(transDiff ? { translatedText: { source: 'user_manual', updatedAt: now } } : {}),
            ...(typeDiff ? { typerTag: { source: 'user_manual', updatedAt: now } } : {}),
          },
        };
        nextContentRecords[cr.contentId] = updatedCr;
      }
    } else {
      // Legacy bubble is a new record not known to domain state
      hasChanges = true;
      nextState = addManualBubbleToDomainState(nextState, b);
      nextContentRecords = { ...nextState.contentRecords };
      nextReadingSequence = [...nextState.readingSequence];
    }
  }

  if (!hasChanges) {
    return { reconciledState: domainState, hasChanges: false };
  }

  const finalState: PageDomainState = {
    ...nextState,
    contentRecords: nextContentRecords,
    readingSequence: nextReadingSequence,
    updatedAt: now,
  };

  return { reconciledState: finalState, hasChanges: true };
}
