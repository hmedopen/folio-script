import type {
  PageDomainState,
  ScanRunRecord,
  PhysicalContainer,
  TextRegion as DomainTextRegion,
  ContentRecord,
  Point2D,
  PixelBox,
  DetectorObservation,
  OcrLineObservation,
  ModelExecutionMetadata,
  TileTransformRecord,
  RubyAnnotation,
} from '../../types/domain/index.ts';
import type {
  RawComicDetection,
  FusedComicRegion,
  AssociatedTextCandidate,
  RawOcrLineDetection,
} from '../../types/localOcr.ts';
import type { TextRegion, OcrLineSegment } from '../../types/scanning.ts';
import { defaultTyperForClass } from '../scanAdapter.ts';
import { DEFAULT_TYPERS } from '../../types/typers.ts';
import { mapBubbleTypeToContainerType, mapBubbleTypeToSemanticContentType } from './v9Migration.ts';

export function derivePolygonFromPixelBox(box?: PixelBox | null): Point2D[] {
  if (!box || !Array.isArray(box) || box.length < 4) {
    return [];
  }
  const [minY, minX, maxY, maxX] = box;
  return [
    [minX, minY],
    [maxX, minY],
    [maxX, maxY],
    [minX, maxY],
  ];
}

export interface BuildDomainFromOcrInput {
  pageId: string;
  chapterId?: string;
  sourceDimensions: { width: number; height: number };
  rawDetections?: RawComicDetection[];
  fusedBubbles?: FusedComicRegion[];
  candidates?: AssociatedTextCandidate[];
  linesByCandidate?: Map<string, RawOcrLineDetection[]>;
  textRegions: TextRegion[];
  allLineSegments?: OcrLineSegment[];
  tiles?: TileTransformRecord[];
  models?: ModelExecutionMetadata;
  scanRunId?: string;
}

/**
 * Ingests canonical OCR observations and grouping results into PageDomainState and ScanRunRecord.
 * Preserves zero-loss provenance, line observations, container emptiness, borderless text, and CJK ruby.
 */
export function buildCanonicalDomainStateFromOcr(
  input: BuildDomainFromOcrInput
): { pageDomainState: PageDomainState; scanRunRecord: ScanRunRecord } {
  const {
    pageId,
    chapterId,
    sourceDimensions,
    rawDetections = [],
    fusedBubbles = [],
    linesByCandidate = new Map(),
    textRegions,
    allLineSegments = [],
    tiles = [],
    models = {
      detector: { stage: 'detector', status: 'executed', provider: 'wasm', modelId: 'comic_detector' },
      ocr: { stage: 'ocr', status: 'executed', provider: 'wasm', modelId: 'local_ocr' },
    },
    scanRunId = `scan-${pageId}-${Date.now()}`,
  } = input;

  const now = Date.now();

  // 1. Build ScanRunRecord
  const detectorObservations: Record<string, DetectorObservation> = {};
  const ocrObservations: Record<string, OcrLineObservation> = {};

  // Record raw detections
  for (let idx = 0; idx < rawDetections.length; idx++) {
    const raw = rawDetections[idx];
    const detectionId = `det-raw-${idx + 1}-${raw.tileId}`;
    const touchesInner = Boolean(
      (raw as any).touchesTileInnerBoundary ??
      (raw.touchesTileInnerLeft || raw.touchesTileInnerTop || raw.touchesTileInnerRight || raw.touchesTileInnerBottom)
    );
    detectorObservations[detectionId] = {
      detectionId,
      scanRunId,
      pageId,
      classLabel: raw.classLabel,
      pixelBox: raw.pixelBox,
      pixelPolygon: raw.pixelPolygon,
      rawScore: raw.rawScore,
      sourceTileIds: [raw.tileId],
      touchesTileInnerBoundary: touchesInner,
      timestamp: now,
    };
  }

  // Record fused bubble detections
  for (let idx = 0; idx < fusedBubbles.length; idx++) {
    const fused = fusedBubbles[idx];
    const detectionId = fused.id || (fused as any).fusedId || (fused as any).bubbleId || `det-fused-${idx + 1}`;
    const pBox: PixelBox = fused.pixelBox || (fused as any).geometry?.pixelBox || [0, 0, 0, 0];
    const pPoly: Point2D[] = fused.pixelPolygon || (fused as any).geometry?.pixelPolygon || derivePolygonFromPixelBox(pBox);
    detectorObservations[detectionId] = {
      detectionId,
      scanRunId,
      pageId,
      classLabel: fused.classLabel,
      pixelBox: pBox,
      pixelPolygon: pPoly,
      rawScore: fused.rawScore ?? (fused as any).confidence ?? 0.9,
      sourceTileIds: fused.sourceTileIds || [],
      touchesTileInnerBoundary: false,
      timestamp: now,
    };
  }

  // Record OCR line observations
  for (const [, lineList] of linesByCandidate.entries()) {
    for (const line of lineList) {
      ocrObservations[line.lineId] = {
        lineId: line.lineId,
        scanRunId,
        pageId,
        text: line.text,
        lineScore: line.rawRecognitionScore,
        pixelBox: line.pixelBox,
        pixelPolygon: line.pixelPolygon,
        isVertical: Boolean(line.isVertical),
        isRuby: Boolean(line.isRuby),
        sourceTileIds: [],
        timestamp: now,
      };
    }
  }

  // Also include any line segments not in linesByCandidate
  for (const seg of allLineSegments) {
    if (!ocrObservations[seg.lineId]) {
      const segGeo = seg.geometry;
      const box: PixelBox = (seg as any).pixelBox || segGeo?.pixelBox || [
        (segGeo.box_2d[0] / 1000) * sourceDimensions.height,
        (segGeo.box_2d[1] / 1000) * sourceDimensions.width,
        (segGeo.box_2d[2] / 1000) * sourceDimensions.height,
        (segGeo.box_2d[3] / 1000) * sourceDimensions.width,
      ];
      const pixelPolygon: Point2D[] = (seg as any).pixelPolygon || segGeo?.pixelPolygon || (
        segGeo.polygon
          ? segGeo.polygon.map(([x, y]) => [(x / 1000) * sourceDimensions.width, (y / 1000) * sourceDimensions.height] as Point2D)
          : derivePolygonFromPixelBox(box)
      );
      ocrObservations[seg.lineId] = {
        lineId: seg.lineId,
        scanRunId,
        pageId,
        text: seg.text,
        lineScore: seg.recognitionConfidence,
        pixelBox: box,
        pixelPolygon,
        isVertical: Boolean(seg.isVertical),
        sourceTileIds: [],
        timestamp: now,
      };
    }
  }

  const scanRunRecord: ScanRunRecord = {
    scanRunId,
    pageId,
    chapterId,
    status: 'completed',
    startedAt: now,
    completedAt: now,
    models,
    tiles: tiles.map((t) => ({ ...t })),
    detectorObservations,
    ocrObservations,
  };

  // 2. Build PhysicalContainers
  const containers: Record<string, PhysicalContainer> = {};
  const associatedBubbleIds = new Set<string>();

  for (const tr of textRegions) {
    if (tr.associations?.bubbleId) {
      associatedBubbleIds.add(tr.associations.bubbleId);
    }
  }

  for (let idx = 0; idx < fusedBubbles.length; idx++) {
    const fused = fusedBubbles[idx];
    const containerId = fused.id || (fused as any).fusedId || (fused as any).bubbleId || `cont-${idx + 1}`;
    const pBox: PixelBox | undefined = fused.pixelBox || (fused as any).geometry?.pixelBox;
    const bodyContour = fused.pixelPolygon || (fused as any).geometry?.pixelPolygon || (pBox ? derivePolygonFromPixelBox(pBox) : []);
    const hasAssociatedContent = associatedBubbleIds.has(containerId);

    containers[containerId] = {
      containerId,
      pageId,
      containerType: mapBubbleTypeToContainerType(fused.classLabel),
      geometry: {
        bodyContour,
        tails: [],
      },
      confidence: fused.rawScore ?? (fused as any).confidence ?? 0.9,
      boundaryUncertain: fused.boundaryUncertain,
      zIndex: idx + 1,
      state: hasAssociatedContent ? 'active' : 'empty', // Support empty containers!
      provenance: {
        geometry: { source: 'local_detector', updatedAt: now },
        containerType: { source: 'local_detector', updatedAt: now },
      },
    };
  }

  // 3. Build TextRegions and ContentRecords
  const domainTextRegions: Record<string, DomainTextRegion> = {};
  const domainContentRecords: Record<string, ContentRecord> = {};
  const readingSequence: string[] = [];

  // Sort regions by sequenceIndex or top-to-bottom
  const sortedRegions = [...textRegions].sort((a, b) => {
    const idxA = a.order?.sequenceIndex ?? 0;
    const idxB = b.order?.sequenceIndex ?? 0;
    if (idxA !== idxB) return idxA - idxB;
    return a.geometry.box_2d[0] - b.geometry.box_2d[0];
  });

  for (let rIdx = 0; rIdx < sortedRegions.length; rIdx++) {
    const tr = sortedRegions[rIdx];
    const regionId = tr.regionId;
    const contentId = `cr-${regionId}`;
    readingSequence.push(contentId);

    const bubbleId = tr.associations?.bubbleId || null;
    const isAssociated = Boolean(bubbleId && containers[bubbleId]);
    const containerId = isAssociated ? bubbleId : null;
    const containerAssociation = isAssociated ? 'associated' : 'borderless';

    const pBox: PixelBox = tr.geometry.pixelBox || [
      (tr.geometry.box_2d[0] / 1000) * sourceDimensions.height,
      (tr.geometry.box_2d[1] / 1000) * sourceDimensions.width,
      (tr.geometry.box_2d[2] / 1000) * sourceDimensions.height,
      (tr.geometry.box_2d[3] / 1000) * sourceDimensions.width,
    ];
    const pixelPolygon = tr.geometry.pixelPolygon || derivePolygonFromPixelBox(pBox);

    // Orientation
    const hasVerticalLine = tr.lineSegments?.some((l) => l.isVertical);
    const orientation = hasVerticalLine ? 'vertical_cjk' : 'horizontal';

    // Ruby annotations
    const rubyAnnotations: RubyAnnotation[] = [];
    if (tr.lineSegments) {
      for (const ls of tr.lineSegments) {
        if ((ls as any).isRuby && (ls as any).parentLineId) {
          rubyAnnotations.push({
            rubyId: `ruby-${ls.lineId}`,
            rubyLineObservationId: ls.lineId,
            parentLineObservationId: (ls as any).parentLineId,
            parentCharSpan: [0, 0],
            rubyText: ls.text,
          });
        }
      }
    }

    domainTextRegions[regionId] = {
      regionId,
      pageId,
      containerId,
      containerAssociation,
      geometry: { pixelPolygon },
      orientation,
      lineObservationIds: tr.lineSegments?.filter((l) => !(l as any).isRuby).map((l) => l.lineId) || [],
      rubyAnnotations,
      confidence: tr.confidence.ocr,
      lifecycleState: 'active',
      provenance: {
        geometry: { source: 'ocr_engine', updatedAt: now },
        containerId: { source: 'local_detector', updatedAt: now },
      },
    };

    // Content Record
    const primaryClass = tr.classification?.primaryClass || 'dialogue';
    const typer = defaultTyperForClass(primaryClass, DEFAULT_TYPERS);

    domainContentRecords[contentId] = {
      contentId,
      pageId,
      regionTargets: [{ regionId }],
      contentType: mapBubbleTypeToSemanticContentType(primaryClass),
      speakerIds: [],
      sourceText: tr.rawOCR,
      originalOcrText: tr.rawOCR,
      translatedText: '',
      translationHistory: [],
      typerTag: { id: typer.id, prefix: typer.prefix },
      status: 'active',
      orderState: { isUserPinned: false },
      reviewFlags: [],
      provenance: {
        sourceText: { source: 'ocr_engine', updatedAt: now },
        translatedText: { source: 'ocr_engine', updatedAt: now },
        typerTag: { source: 'local_detector', updatedAt: now },
        speakerIds: { source: 'local_detector', updatedAt: now },
        contentType: { source: 'local_detector', updatedAt: now },
        regionTargets: { source: 'ocr_engine', updatedAt: now },
      },
    };
  }

  const pageDomainState: PageDomainState = {
    pageId,
    chapterId,
    dimensions: sourceDimensions,
    spatialGroups: {},
    containers,
    textRegions: domainTextRegions,
    contentRecords: domainContentRecords,
    readingSequence,
    issues: [],
    activeScanRunId: scanRunId,
    version: 9,
    updatedAt: now,
  };

  return { pageDomainState, scanRunRecord };
}
