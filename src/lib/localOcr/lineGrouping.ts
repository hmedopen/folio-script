import type { OcrLineSegment, ScanIssueFlag, TextRegion } from '../../types/scanning.ts';
import type { AssociatedTextCandidate, RawOcrLineDetection } from '../../types/localOcr.ts';
import {
  computeConvexHull,
  originalPixelsToNormalized1000,
  pixelPolygonToPixelBox,
} from './coordinateMapping.ts';
import { detectScriptSignal } from './languageRouter.ts';

export type LineJoinLanguage = 'en' | 'ko' | 'ja' | 'zh';

/**
 * Orders OCR lines within a single logical text candidate according to text orientation.
 * - Vertical CJK: columns ordered Right-to-Left, lines within a column Top-to-Bottom.
 * - Horizontal: rows ordered Top-to-Bottom, items on the same row Left-to-Right.
 */
export function orderOcrLines(
  lines: RawOcrLineDetection[],
  isVertical: boolean
): RawOcrLineDetection[] {
  if (lines.length <= 1) return [...lines];

  const sorted = [...lines];

  if (isVertical) {
    sorted.sort((a, b) => {
      const aCx = (a.pixelBox[1] + a.pixelBox[3]) / 2;
      const bCx = (b.pixelBox[1] + b.pixelBox[3]) / 2;
      const aW = Math.max(4, a.pixelBox[3] - a.pixelBox[1]);
      const bW = Math.max(4, b.pixelBox[3] - b.pixelBox[1]);
      const sameColTol = Math.max(aW, bW) * 0.6;
      if (Math.abs(aCx - bCx) > sameColTol) {
        // Right-to-left column order
        return bCx - aCx;
      }
      return a.pixelBox[0] - b.pixelBox[0];
    });
    return sorted;
  }

  sorted.sort((a, b) => {
    const aCy = (a.pixelBox[0] + a.pixelBox[2]) / 2;
    const bCy = (b.pixelBox[0] + b.pixelBox[2]) / 2;
    const aH = Math.max(4, a.pixelBox[2] - a.pixelBox[0]);
    const bH = Math.max(4, b.pixelBox[2] - b.pixelBox[0]);
    const sameRowTol = Math.max(aH, bH) * 0.5;
    if (Math.abs(aCy - bCy) > sameRowTol) {
      return aCy - bCy;
    }
    return a.pixelBox[1] - b.pixelBox[1];
  });
  return sorted;
}

const CJK_NO_SPACE_CHAR = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u;

/**
 * Script-aware line joining:
 * - English: preserves word spaces and joins trailing line-break hyphens between letters.
 * - Korean: ALWAYS preserves word spaces between wrapped Hangul lines.
 * - Japanese & Chinese: joins wrapped CJK lines without inserting unnecessary spaces.
 */
export function joinLinesByScript(
  rawLines: string[],
  language: LineJoinLanguage
): string {
  const lines = rawLines.map((l) => l.trim()).filter((l) => l.length > 0);
  if (lines.length === 0) return '';
  if (lines.length === 1) return lines[0];

  let result = lines[0];

  for (let i = 1; i < lines.length; i++) {
    const next = lines[i];

    if (language === 'en') {
      const endsWithWordHyphen = /[A-Za-z]-$/.test(result);
      const startsWithWordLetter = /^[A-Za-z]/.test(next);
      if (endsWithWordHyphen && startsWithWordLetter) {
        result = result.slice(0, -1) + next;
      } else {
        result += ' ' + next;
      }
      continue;
    }

    if (language === 'ko') {
      // Korean uses spaces between words (eojeol); never concatenate Hangul lines blindly
      result += ' ' + next;
      continue;
    }

    // Japanese or Chinese: check junction characters
    const prevLast = result.slice(-1);
    const nextFirst = next.charAt(0);
    const scriptHint = detectScriptSignal(result + next);

    if (scriptHint === 'hangul') {
      result += ' ' + next;
    } else if (CJK_NO_SPACE_CHAR.test(prevLast) || CJK_NO_SPACE_CHAR.test(nextFirst)) {
      result += next;
    } else if (/[A-Za-z0-9]$/.test(prevLast) && /^[A-Za-z0-9]/.test(nextFirst)) {
      result += ' ' + next;
    } else {
      result += next;
    }
  }

  return result;
}

export interface DetectedRubyResult {
  mainLines: RawOcrLineDetection[];
  rubyAnnotations: Array<{
    rubyId: string;
    rubyLineObservationId: string;
    parentLineObservationId: string;
    parentCharSpan: [number, number];
    rubyText: string;
  }>;
}

/**
 * Detects ruby (furigana) lines positioned alongside base CJK text lines.
 * In vertical CJK: ruby lines are narrow columns to the right of the base column.
 * In horizontal CJK: ruby lines are small rows immediately above the base row.
 */
export function detectRubyLines(
  rawLines: RawOcrLineDetection[],
  isVertical: boolean
): DetectedRubyResult {
  if (rawLines.length <= 1) {
    return { mainLines: [...rawLines], rubyAnnotations: [] };
  }

  const rubyAnnotations: Array<{
    rubyId: string;
    rubyLineObservationId: string;
    parentLineObservationId: string;
    parentCharSpan: [number, number];
    rubyText: string;
  }> = [];

  const rubyLineIds = new Set<string>();

  for (let i = 0; i < rawLines.length; i++) {
    const candidate = rawLines[i];
    const [cy1, cx1, cy2, cx2] = candidate.pixelBox;
    const candW = Math.max(1, cx2 - cx1);
    const candH = Math.max(1, cy2 - cy1);

    for (let j = 0; j < rawLines.length; j++) {
      if (i === j) continue;
      const base = rawLines[j];
      const [by1, bx1, by2, bx2] = base.pixelBox;
      const baseW = Math.max(1, bx2 - bx1);
      const baseH = Math.max(1, by2 - by1);

      if (isVertical) {
        const isNarrower = candW <= baseW * 0.65;
        const xDist = cx1 - bx2;
        const isAdjacentRight = xDist >= -baseW * 0.3 && xDist <= baseW * 0.8;
        const yOverlap = Math.max(0, Math.min(cy2, by2) - Math.max(cy1, by1));
        const hasOverlap = yOverlap / candH >= 0.5;

        if (isNarrower && isAdjacentRight && hasOverlap) {
          candidate.isRuby = true;
          rubyLineIds.add(candidate.lineId);
          rubyAnnotations.push({
            rubyId: `ruby-${candidate.lineId}`,
            rubyLineObservationId: candidate.lineId,
            parentLineObservationId: base.lineId,
            parentCharSpan: [0, base.text.length],
            rubyText: candidate.text,
          });
          break;
        }
      } else {
        const isShorter = candH <= baseH * 0.65;
        const yDist = by1 - cy2;
        const isAdjacentAbove = yDist >= -baseH * 0.3 && yDist <= baseH * 0.8;
        const xOverlap = Math.max(0, Math.min(cx2, bx2) - Math.max(cx1, bx1));
        const hasOverlap = xOverlap / candW >= 0.5;

        if (isShorter && isAdjacentAbove && hasOverlap) {
          candidate.isRuby = true;
          rubyLineIds.add(candidate.lineId);
          rubyAnnotations.push({
            rubyId: `ruby-${candidate.lineId}`,
            rubyLineObservationId: candidate.lineId,
            parentLineObservationId: base.lineId,
            parentCharSpan: [0, base.text.length],
            rubyText: candidate.text,
          });
          break;
        }
      }
    }
  }

  const mainLines = rawLines.filter((l) => !rubyLineIds.has(l.lineId));
  return { mainLines, rubyAnnotations };
}

export interface GroupLinesOptions {
  language: LineJoinLanguage;
  sourceWidth: number;
  sourceHeight: number;
  lowConfidenceThreshold?: number;
}

/**
 * Groups line-level OCR detections belonging to visual speech bubbles or logical text blocks
 * into cohesive TextRegions (preserving lineSegments[] and individual line polygons).
 * - Multiple lines/candidates inside one speech bubble become one logical group.
 * - Text in separate speech bubbles remains separate.
 * - Text outside bubbles forms valid logical groups without being discarded.
 * - Physical bubble boundaries never replace tight text geometry.
 */
export function groupLinesToTextRegions(
  candidates: AssociatedTextCandidate[],
  linesByCandidate: Map<string, RawOcrLineDetection[]>,
  options: GroupLinesOptions
): { textRegions: TextRegion[]; allLineSegments: OcrLineSegment[] } {
  const {
    language,
    sourceWidth,
    sourceHeight,
    lowConfidenceThreshold = 0.65,
  } = options;

  const textRegions: TextRegion[] = [];
  const allLineSegments: OcrLineSegment[] = [];

  // 1. Cluster candidates by speech bubble association, or cluster unassociated nearby text lines
  interface CandidateCluster {
    clusterId: string;
    associatedBubbleId: string | null;
    candidates: AssociatedTextCandidate[];
  }

  const clusters: CandidateCluster[] = [];
  const bubbleClusterMap = new Map<string, CandidateCluster[]>();

  for (const cand of candidates) {
    if (cand.associatedBubbleId) {
      let existingClusters = bubbleClusterMap.get(cand.associatedBubbleId);
      if (!existingClusters) {
        existingClusters = [];
        bubbleClusterMap.set(cand.associatedBubbleId, existingClusters);
      }

      const [cy1, cx1, cy2, cx2] = cand.pixelBox;
      const candH = Math.max(1, cy2 - cy1);
      const candW = Math.max(1, cx2 - cx1);

      // Check if cand can merge into one of the existing clusters for this balloon
      let targetCluster: CandidateCluster | null = null;
      for (const cl of existingClusters) {
        for (const member of cl.candidates) {
          const [my1, mx1, my2, mx2] = member.pixelBox;
          const memberH = Math.max(1, my2 - my1);
          const memberW = Math.max(1, mx2 - mx1);
          const yGap = Math.max(0, Math.max(cy1, my1) - Math.min(cy2, my2));
          const xGap = Math.max(0, Math.max(cx1, mx1) - Math.min(cx2, mx2));

          // If close enough (< 1.8 * line height and < 2.5 * line width), belongs to same dialogue section
          if (yGap <= Math.max(candH, memberH) * 1.8 && xGap <= Math.max(candW, memberW) * 2.5) {
            targetCluster = cl;
            break;
          }
        }
        if (targetCluster) break;
      }

      if (targetCluster) {
        targetCluster.candidates.push(cand);
      } else {
        // Independent dialogue section within the same physical balloon!
        const newCluster: CandidateCluster = {
          clusterId: cand.candidateId,
          associatedBubbleId: cand.associatedBubbleId,
          candidates: [cand],
        };
        existingClusters.push(newCluster);
        clusters.push(newCluster);
      }
    } else {
      // Check if this unassociated candidate can merge with an existing unassociated cluster (e.g. multi-line title/narration)
      let mergedWithCluster = false;
      const [cy1, cx1, cy2, cx2] = cand.pixelBox;
      const candH = Math.max(1, cy2 - cy1);
      const candW = Math.max(1, cx2 - cx1);

      for (const cl of clusters) {
        if (cl.associatedBubbleId !== null) continue;
        // Check spatial proximity with member candidates in unassociated cluster
        for (const member of cl.candidates) {
          const [my1, mx1, my2, mx2] = member.pixelBox;
          const memberH = Math.max(1, my2 - my1);
          const memberW = Math.max(1, mx2 - mx1);
          const xOverlap = Math.max(0, Math.min(cx2, mx2) - Math.max(cx1, mx1));
          const yGap = Math.max(0, Math.max(cy1, my1) - Math.min(cy2, my2));
          const minW = Math.min(candW, memberW);
          const maxLineH = Math.max(candH, memberH);

          // Lines share substantial horizontal alignment and have vertical spacing <= 1.2 line heights
          if (xOverlap / Math.max(1, minW) >= 0.5 && yGap <= maxLineH * 1.2) {
            cl.candidates.push(cand);
            mergedWithCluster = true;
            break;
          }
        }
        if (mergedWithCluster) break;
      }

      if (!mergedWithCluster) {
        clusters.push({
          clusterId: cand.candidateId,
          associatedBubbleId: null,
          candidates: [cand],
        });
      }
    }
  }

  // 2. Process each cluster into one logical TextRegion
  for (let idx = 0; idx < clusters.length; idx++) {
    const cluster = clusters[idx];
    const clusterCandidates = cluster.candidates;

    // Collect all raw lines from all candidates in this cluster
    const rawLines: RawOcrLineDetection[] = [];
    for (const cand of clusterCandidates) {
      const cLines = linesByCandidate.get(cand.candidateId) || [];
      rawLines.push(...cLines);
    }

    const verticalVotes = rawLines.filter((l) => l.isVertical).length;
    const isVertical =
      rawLines.length > 0
        ? verticalVotes > rawLines.length / 2
        : clusterCandidates.some((c) => (c.pixelBox[2] - c.pixelBox[0]) > (c.pixelBox[3] - c.pixelBox[1]) * 1.4) &&
          (language === 'ja' || language === 'zh');

    // Detect ruby annotations and separate main lines
    const { mainLines, rubyAnnotations } = detectRubyLines(rawLines, isVertical);
    const orderedLines = orderOcrLines(mainLines, isVertical);

    const lineSegments: OcrLineSegment[] = orderedLines.map((line) => {
      const normPolygon: Array<[number, number]> = line.pixelPolygon.map(([px, py]) => [
        Math.max(0, Math.min(1000, Math.round((px / Math.max(1, sourceWidth)) * 1000))),
        Math.max(0, Math.min(1000, Math.round((py / Math.max(1, sourceHeight)) * 1000))),
      ]);

      const seg: OcrLineSegment = {
        lineId: line.lineId,
        geometry: {
          coordinateSpace: 'normalized_1000',
          box_2d: line.normalizedBox,
          polygon: normPolygon,
        },
        text: line.text,
        recognitionConfidence: line.rawRecognitionScore,
        detectionConfidence: line.rawDetectionScore,
        isVertical: line.isVertical,
      };
      allLineSegments.push(seg);
      return seg;
    });

    // Also record ruby lines in allLineSegments with ruby metadata
    for (const rAnno of rubyAnnotations) {
      const rLine = rawLines.find((l) => l.lineId === rAnno.rubyLineObservationId);
      if (rLine) {
        const normPolygon: Array<[number, number]> = rLine.pixelPolygon.map(([px, py]) => [
          Math.max(0, Math.min(1000, Math.round((px / Math.max(1, sourceWidth)) * 1000))),
          Math.max(0, Math.min(1000, Math.round((py / Math.max(1, sourceHeight)) * 1000))),
        ]);
        const seg: any = {
          lineId: rLine.lineId,
          geometry: {
            coordinateSpace: 'normalized_1000',
            box_2d: rLine.normalizedBox,
            polygon: normPolygon,
          },
          text: rLine.text,
          recognitionConfidence: rLine.rawRecognitionScore,
          detectionConfidence: rLine.rawDetectionScore,
          isVertical: rLine.isVertical,
          isRuby: true,
          parentLineId: rAnno.parentLineObservationId,
        };
        allLineSegments.push(seg);
        lineSegments.push(seg);
      }
    }

    const joinedText = joinLinesByScript(
      orderedLines.map((l) => l.text),
      language
    );

    // Derive tight text bounding box from OCR lines if available, else candidate union
    let combinedNormBox: [number, number, number, number];
    let finalPixelBox: [number, number, number, number];
    let finalPixelPolygon: Array<[number, number]> | undefined;

    if (orderedLines.length > 0) {
      const allVertices = orderedLines.flatMap((l) => l.pixelPolygon);
      finalPixelBox = pixelPolygonToPixelBox(allVertices, sourceWidth, sourceHeight);
      combinedNormBox = originalPixelsToNormalized1000(finalPixelBox, sourceWidth, sourceHeight, 1);
      if (allVertices.length >= 3) {
        finalPixelPolygon = computeConvexHull(allVertices);
      }
    } else {
      let minY = Infinity;
      let minX = Infinity;
      let maxY = -Infinity;
      let maxX = -Infinity;
      for (const c of clusterCandidates) {
        if (c.pixelBox[0] < minY) minY = c.pixelBox[0];
        if (c.pixelBox[1] < minX) minX = c.pixelBox[1];
        if (c.pixelBox[2] > maxY) maxY = c.pixelBox[2];
        if (c.pixelBox[3] > maxX) maxX = c.pixelBox[3];
      }
      finalPixelBox = [minY, minX, maxY, maxX];
      combinedNormBox = originalPixelsToNormalized1000(finalPixelBox, sourceWidth, sourceHeight, 1);
    }

    // Derive tight aggregate polygon from line polygons via convex hull
    let aggregatePolygon: Array<[number, number]> | undefined;
    if (lineSegments.length > 0) {
      const allNormPoints = lineSegments.flatMap((l) => l.geometry.polygon || []);
      if (allNormPoints.length >= 3) {
        const hull = computeConvexHull(allNormPoints);
        if (hull.length >= 3) {
          aggregatePolygon = hull;
        }
      }
    }
    if (!aggregatePolygon) {
      // Fallback: 4-point quad from tight combined text bounding box
      const [ymin, xmin, ymax, xmax] = combinedNormBox;
      aggregatePolygon = [
        [xmin, ymin],
        [xmax, ymin],
        [xmax, ymax],
        [xmin, ymax],
      ];
    }

    // Actual raw score aggregation
    const rawOcrScore =
      orderedLines.length > 0
        ? orderedLines.reduce((sum, l) => sum + l.rawRecognitionScore, 0) / orderedLines.length
        : 0;

    const clusterFlags: ScanIssueFlag[] = [];
    for (const c of clusterCandidates) {
      for (const f of c.flags) {
        if (!clusterFlags.includes(f)) clusterFlags.push(f);
      }
    }
    if (orderedLines.length === 0 || joinedText.trim().length === 0) {
      if (!clusterFlags.includes('OCR_AMBIGUOUS')) {
        clusterFlags.push('OCR_AMBIGUOUS');
      }
    } else if (rawOcrScore < lowConfidenceThreshold && !clusterFlags.includes('OCR_AMBIGUOUS')) {
      clusterFlags.push('OCR_AMBIGUOUS');
    }

    const isBubble = cluster.associatedBubbleId !== null || clusterCandidates.some((c) => c.kind === 'text_bubble');
    const primaryClass = isBubble ? 'dialogue' : 'unknown';

    const maxCandScore = Math.max(...clusterCandidates.map((c) => c.rawScore));
    const meanAssocConfidence =
      clusterCandidates.reduce((s, c) => s + c.associationConfidence, 0) / clusterCandidates.length;

    textRegions.push({
      regionId: cluster.clusterId,
      geometry: {
        coordinateSpace: 'normalized_1000',
        box_2d: combinedNormBox,
        polygon: aggregatePolygon,
        pixelBox: finalPixelBox,
        pixelPolygon: finalPixelPolygon,
      },
      rawOCR: joinedText,
      normalizedText: joinedText,
      lineSegments,
      confidence: {
        imageQuality: 1,
        regionDetection: maxCandScore,
        ocr: rawOcrScore,
        association: meanAssocConfidence,
        readingOrder: 1,
        classification: isBubble ? maxCandScore : 0.5,
      },
      classification: {
        primaryClass,
        confidence: isBubble ? maxCandScore : 0.5,
        needsReview:
          clusterFlags.length > 0 ||
          clusterCandidates.some((c) => c.boundaryUncertain) ||
          !isBubble,
        evidence: isBubble
          ? 'Detected inside speech bubble by comic geometry detector'
          : 'Detected outside speech bubble (text_free); functional class preserved as unknown pending review',
      },
      associations: {
        bubbleId: cluster.associatedBubbleId,
      },
      order: {
        sequenceIndex: idx + 1,
        confidence: 1,
      },
      flags: clusterFlags,
      sourceLanguage: language,
      isVertical,
      isManuallyEdited: false,
    });
  }

  return { textRegions, allLineSegments };
}
