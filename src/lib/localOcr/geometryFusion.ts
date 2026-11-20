/**
 * Folio Script — Multi-Signal Cross-Tile Reconciliation & Seam Stitching Engine
 * Reconciles comic detections across overlapping 2D tiles:
 * - Eliminates duplicates using multi-signal matching (IoU + IoS).
 * - Chains multi-tile oversized balloons and narration regions across boundaries.
 * - Enforces anti-transitive graph validation (hard same-tile disjointness, 2D tile connectivity, void filter).
 * - Stitches multi-seam polygon contours while preserving concavities, speech tails, and burst spikes.
 * - Flags un-reconstructed or ambiguous boundary detections without fabricating false geometry.
 */

import type { ScanIssueFlag } from '../../types/scanning.ts';
import type {
  AssociatedTextCandidate,
  ComicDetectorClass,
  FusedComicRegion,
  RawComicDetection,
  TileTransformRecord,
} from '../../types/localOcr.ts';
import { calculateBoxIoU, computeBoxArea } from '../coordinateTransforms.ts';
import { originalPixelsToDerivedNormalized } from './coordinatePipeline.ts';

export type Point2D = [number, number];

function computeIntersectionArea(
  a: [number, number, number, number],
  b: [number, number, number, number]
): number {
  const y1 = Math.max(a[0], b[0]);
  const x1 = Math.max(a[1], b[1]);
  const y2 = Math.min(a[2], b[2]);
  const x2 = Math.min(a[3], b[3]);
  return Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
}

function computeIoMin(
  a: [number, number, number, number],
  b: [number, number, number, number]
): number {
  const inter = computeIntersectionArea(a, b);
  if (inter <= 0) return 0;
  const minArea = Math.min(computeBoxArea(a), computeBoxArea(b));
  return minArea > 0 ? inter / minArea : 0;
}

function unionPixelBoxes(
  a: [number, number, number, number],
  b: [number, number, number, number]
): [number, number, number, number] {
  return [
    Math.min(a[0], b[0]),
    Math.min(a[1], b[1]),
    Math.max(a[2], b[2]),
    Math.max(a[3], b[3]),
  ];
}

function touchesInternalTileBoundary(
  det: RawComicDetection,
  tile: TileTransformRecord | undefined
): boolean {
  if (!tile) return false;
  return (
    (det.touchesTileInnerLeft && !tile.touchesPageLeft) ||
    (det.touchesTileInnerTop && !tile.touchesPageTop) ||
    (det.touchesTileInnerRight && !tile.touchesPageRight) ||
    (det.touchesTileInnerBottom && !tile.touchesPageBottom)
  );
}

/**
 * Checks whether two detections are physically meeting across a shared boundary cut
 * between two geometrically adjacent tiles (vertically or horizontally adjacent).
 */
export function areCrossTileBoundarySplitPieces(
  a: RawComicDetection,
  b: RawComicDetection,
  tileMap: Map<string, TileTransformRecord>
): boolean {
  if (a.tileId === b.tileId) return false;
  const tA = tileMap.get(a.tileId);
  const tB = tileMap.get(b.tileId);
  if (!tA || !tB) return false;

  const [ay1, ax1, ay2, ax2] = a.pixelBox;
  const [by1, bx1, by2, bx2] = b.pixelBox;

  // 1. Horizontally adjacent tiles (vertical seam between cols)
  if (tA.row === tB.row && Math.abs(tA.col - tB.col) === 1) {
    const left = tA.col < tB.col ? a : b;
    const right = tA.col < tB.col ? b : a;
    const yOverlap = Math.max(0, Math.min(ay2, by2) - Math.max(ay1, by1));
    const minH = Math.max(1, Math.min(ay2 - ay1, by2 - by1));
    const yOverlapRatio = yOverlap / minH;

    const touchesSharedEdge =
      (left.touchesTileInnerRight || right.touchesTileInnerLeft) &&
      right.pixelBox[1] <= left.pixelBox[3] + 24;

    if (yOverlapRatio >= 0.5 && touchesSharedEdge) return true;
  }

  // 2. Vertically adjacent tiles (horizontal seam between rows)
  if (tA.col === tB.col && Math.abs(tA.row - tB.row) === 1) {
    const top = tA.row < tB.row ? a : b;
    const bottom = tA.row < tB.row ? b : a;
    const xOverlap = Math.max(0, Math.min(ax2, bx2) - Math.max(ax1, bx1));
    const minW = Math.max(1, Math.min(ax2 - ax1, bx2 - bx1));
    const xOverlapRatio = xOverlap / minW;

    const touchesSharedEdge =
      (top.touchesTileInnerBottom || bottom.touchesTileInnerTop) &&
      bottom.pixelBox[0] <= top.pixelBox[2] + 24;

    if (xOverlapRatio >= 0.5 && touchesSharedEdge) return true;
  }

  return false;
}

/**
 * Validates candidate cluster graph to prevent false transitive merging:
 * 1. Same-Tile Invariant: A cluster can never contain multiple detections from the same tile.
 * 2. 2D Spatial Connectivity: Member tiles must form a connected subgraph.
 * 3. Density / Void Ratio: Sum of member areas divided by union box area must be >= 0.15.
 */
export function validateClusterGraph(
  members: RawComicDetection[],
  tileMap: Map<string, TileTransformRecord>
): boolean {
  if (members.length <= 1) return true;

  // 1. Hard Invariant: Same-Tile Disjointness
  const tileIds = members.map((m) => m.tileId);
  if (new Set(tileIds).size !== tileIds.length) {
    return false; // Multiple detections from the same tile cannot be the same physical balloon
  }

  // 2. 2D Spatial Tile Graph Connectivity
  const memberTileSet = new Set(tileIds);
  const visited = new Set<string>();
  const queue = [tileIds[0]];
  visited.add(tileIds[0]);

  while (queue.length > 0) {
    const currId = queue.shift()!;
    const tCurr = tileMap.get(currId);
    if (!tCurr) continue;

    for (const otherId of memberTileSet) {
      if (visited.has(otherId)) continue;
      const tOther = tileMap.get(otherId);
      if (!tOther) continue;

      // Check if tCurr and tOther share a horizontal or vertical overlap in original pixels
      const xOverlap = Math.max(
        0,
        Math.min(tCurr.originX + tCurr.cropWidth, tOther.originX + tOther.cropWidth) -
          Math.max(tCurr.originX, tOther.originX)
      );
      const yOverlap = Math.max(
        0,
        Math.min(tCurr.originY + tCurr.cropHeight, tOther.originY + tOther.cropHeight) -
          Math.max(tCurr.originY, tOther.originY)
      );

      if (xOverlap > 0 && yOverlap > 0) {
        visited.add(otherId);
        queue.push(otherId);
      }
    }
  }

  if (visited.size !== memberTileSet.size) {
    return false; // Disjoint tiles cannot be merged
  }

  // 3. Cluster Density Check (avoids chaining distant balloons across empty voids)
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  let sumArea = 0;

  for (const m of members) {
    minX = Math.min(minX, m.pixelBox[1]);
    minY = Math.min(minY, m.pixelBox[0]);
    maxX = Math.max(maxX, m.pixelBox[3]);
    maxY = Math.max(maxY, m.pixelBox[2]);
    sumArea += (m.pixelBox[3] - m.pixelBox[1]) * (m.pixelBox[2] - m.pixelBox[0]);
  }

  const unionArea = (maxX - minX) * (maxY - minY);
  if (unionArea <= 0) return false;

  // Real connected balloons and narration strips have area density >= 0.15
  if (sumArea / unionArea < 0.15) {
    return false;
  }

  return true;
}

/**
 * Generalized multi-seam polygon welding across a horizontal boundary line.
 * Handles multiple entry/exit ports (e.g. burst balloon spikes or speech tails).
 */
export function stitchSeamPolygons(
  polyA: Point2D[], // Upper tile contour (y <= seamY)
  polyB: Point2D[], // Lower tile contour (y >= seamY)
  seamY: number
): { stitched: Point2D[] | null; isAmbiguous: boolean } {
  if (!polyA || polyA.length < 3 || !polyB || polyB.length < 3) {
    return { stitched: null, isAmbiguous: true };
  }

  // Find all X intersection points with seam line y = seamY
  const findIntersects = (poly: Point2D[]): number[] => {
    const xs: number[] = [];
    const n = poly.length;
    for (let i = 0; i < n; i++) {
      const p1 = poly[i];
      const p2 = poly[(i + 1) % n];
      if ((p1[1] <= seamY && p2[1] > seamY) || (p2[1] <= seamY && p1[1] > seamY)) {
        const dy = p2[1] - p1[1];
        if (Math.abs(dy) > 1e-4) {
          const t = (seamY - p1[1]) / dy;
          xs.push(p1[0] + t * (p2[0] - p1[0]));
        }
      }
    }
    return xs.sort((a, b) => a - b);
  };

  const xA = findIntersects(polyA);
  const xB = findIntersects(polyB);

  // If both have even non-zero intersection points
  if (xA.length >= 2 && xB.length >= 2 && xA.length % 2 === 0 && xB.length % 2 === 0) {
    // Check if intervals overlap
    const portOverlap =
      Math.max(0, Math.min(xA[xA.length - 1], xB[xB.length - 1]) - Math.max(xA[0], xB[0])) /
      Math.max(1, Math.max(xA[xA.length - 1], xB[xB.length - 1]) - Math.min(xA[0], xB[0]));

    if (portOverlap >= 0.5) {
      // Weld exterior points: points of A with y <= seamY + points of B with y >= seamY
      const ptsA = polyA.filter((p) => p[1] <= seamY + 2);
      const ptsB = polyB.filter((p) => p[1] >= seamY - 2);

      const welded = [...ptsA, ...ptsB];
      if (welded.length >= 4) {
        // Close loop
        if (
          welded[0][0] !== welded[welded.length - 1][0] ||
          welded[0][1] !== welded[welded.length - 1][1]
        ) {
          welded.push([welded[0][0], welded[0][1]]);
        }
        return { stitched: welded, isAmbiguous: false };
      }
    }
  }

  return { stitched: null, isAmbiguous: true };
}

/**
 * Class-aware duplicate suppression and multi-tile boundary reconstruction.
 */
export function fuseTiledComicDetections(
  rawDetections: RawComicDetection[],
  tiles: TileTransformRecord[],
  sourceWidth: number,
  sourceHeight: number
): FusedComicRegion[] {
  const tileMap = new Map(tiles.map((t) => [t.tileId, t]));
  const classes: ComicDetectorClass[] = ['bubble', 'text_bubble', 'text_free'];
  const fusedAll: FusedComicRegion[] = [];

  for (const cls of classes) {
    const items = rawDetections
      .filter((d) => d.classLabel === cls)
      .sort((a, b) => b.rawScore - a.rawScore);

    interface Cluster {
      members: RawComicDetection[];
      pixelBox: [number, number, number, number];
      reconstructedCrossBoundary: boolean;
      pixelPolygon?: Point2D[];
      isAmbiguousPolygon?: boolean;
    }

    const clusters: Cluster[] = [];

    for (const det of items) {
      let matchedCluster: Cluster | null = null;
      let matchedViaBoundarySplit = false;

      for (const cluster of clusters) {
        // Enforce hard invariant: never match another detection from the SAME tile
        const sharesTile = cluster.members.some((m) => m.tileId === det.tileId);
        if (sharesTile) continue;

        const detTile = tileMap.get(det.tileId);
        const detTouchesInner = touchesInternalTileBoundary(det, detTile);

        // Candidate check: can det be added without violating cluster invariants?
        const candidateMembers = [...cluster.members, det];
        if (!validateClusterGraph(candidateMembers, tileMap)) {
          continue;
        }

        for (const member of cluster.members) {
          const iou = calculateBoxIoU(det.pixelBox, member.pixelBox);
          const ioMin = computeIoMin(det.pixelBox, member.pixelBox);
          const memberTouchesInner = touchesInternalTileBoundary(
            member,
            tileMap.get(member.tileId)
          );

          if (areCrossTileBoundarySplitPieces(det, member, tileMap)) {
            matchedCluster = cluster;
            matchedViaBoundarySplit = true;
            break;
          }

          if (iou >= 0.48) {
            matchedCluster = cluster;
            break;
          }

          if ((detTouchesInner || memberTouchesInner) && ioMin >= 0.75) {
            matchedCluster = cluster;
            break;
          }
        }

        if (matchedCluster) break;
      }

      if (!matchedCluster) {
        clusters.push({
          members: [det],
          pixelBox: [...det.pixelBox],
          reconstructedCrossBoundary: false,
          pixelPolygon: det.pixelPolygon ? [...det.pixelPolygon] : undefined,
        });
      } else {
        matchedCluster.members.push(det);

        if (matchedViaBoundarySplit) {
          matchedCluster.reconstructedCrossBoundary = true;
          matchedCluster.pixelBox = unionPixelBoxes(matchedCluster.pixelBox, det.pixelBox);

          // Attempt polygon seam welding if both members have contours
          if (matchedCluster.pixelPolygon && det.pixelPolygon) {
            const seamY = (det.pixelBox[0] + matchedCluster.pixelBox[2]) / 2;
            const stitchRes = stitchSeamPolygons(
              matchedCluster.pixelPolygon,
              det.pixelPolygon,
              seamY
            );
            if (stitchRes.stitched) {
              matchedCluster.pixelPolygon = stitchRes.stitched;
            } else {
              matchedCluster.isAmbiguousPolygon = true;
            }
          }
        } else {
          // Complete duplicate in overlap band: prefer member furthest from tile edges, else higher confidence
          const bestNonClipped = matchedCluster.members
            .filter((m) => !touchesInternalTileBoundary(m, tileMap.get(m.tileId)))
            .sort((a, b) => b.rawScore - a.rawScore)[0];

          if (bestNonClipped) {
            matchedCluster.pixelBox = [...bestNonClipped.pixelBox];
            if (bestNonClipped.pixelPolygon) {
              matchedCluster.pixelPolygon = [...bestNonClipped.pixelPolygon];
            }
          } else {
            matchedCluster.pixelBox = unionPixelBoxes(matchedCluster.pixelBox, det.pixelBox);
          }
        }
      }
    }

    for (let i = 0; i < clusters.length; i++) {
      const cluster = clusters[i];
      const topMember = [...cluster.members].sort((a, b) => b.rawScore - a.rawScore)[0];
      const sourceTileIds = Array.from(new Set(cluster.members.map((m) => m.tileId)));

      const allClippedAtInner = cluster.members.every((m) =>
        touchesInternalTileBoundary(m, tileMap.get(m.tileId))
      );
      const boundaryUncertain =
        (allClippedAtInner && !cluster.reconstructedCrossBoundary) ||
        Boolean(cluster.isAmbiguousPolygon);

      const flags: ScanIssueFlag[] = boundaryUncertain ? ['REGION_BOUNDARY_UNCERTAIN'] : [];

      // Derived normalized coordinates using exact floating-point pipeline
      const normalizedBox = originalPixelsToDerivedNormalized(
        cluster.pixelBox,
        sourceWidth,
        sourceHeight
      );

      fusedAll.push({
        id: `${cls}-${i + 1}`,
        classLabel: cls,
        pixelBox: cluster.pixelBox,
        normalizedBox,
        pixelPolygon: cluster.pixelPolygon,
        rawScore: topMember.rawScore,
        sourceTileIds,
        boundaryUncertain,
        flags,
      });
    }
  }

  return fusedAll;
}

/**
 * Resolves text candidate associations to enclosing bubbles.
 */
export function associateTextCandidatesToBubbles(
  fused: FusedComicRegion[]
): {
  bubbles: FusedComicRegion[];
  textCandidates: AssociatedTextCandidate[];
} {
  const bubbles = fused.filter((f) => f.classLabel === 'bubble');
  const textRegions = deduplicateOverlappingTextClasses(
    bubbles,
    fused.filter((f) => f.classLabel === 'text_bubble' || f.classLabel === 'text_free')
  );

  const textCandidates: AssociatedTextCandidate[] = textRegions.map((txt) => {
    let bestBubble: FusedComicRegion | null = null;
    let bestScore = 0;
    const candidates: string[] = [];

    for (const b of bubbles) {
      const ioMin = computeIoMin(txt.pixelBox, b.pixelBox);
      const iou = calculateBoxIoU(txt.pixelBox, b.pixelBox);
      const score = Math.max(ioMin, iou);

      if (score >= 0.35) {
        candidates.push(b.id);
        if (score > bestScore) {
          bestScore = score;
          bestBubble = b;
        }
      }
    }

    const isAmbiguous = candidates.length > 1 && bestScore < 0.85;
    const flags: ScanIssueFlag[] = [...txt.flags];
    if (isAmbiguous) {
      flags.push('BUBBLE_ASSOCIATION_AMBIGUOUS');
    }

    return {
      candidateId: txt.id,
      kind: txt.classLabel as 'text_bubble' | 'text_free',
      pixelBox: txt.pixelBox,
      normalizedBox: txt.normalizedBox,
      rawScore: txt.rawScore,
      sourceTileIds: txt.sourceTileIds,
      boundaryUncertain: txt.boundaryUncertain,
      flags,
      associatedBubbleId: bestBubble ? bestBubble.id : null,
      associationConfidence: Math.round(bestScore * 100) / 100,
      candidateBubbleIds: candidates.length > 0 ? candidates : undefined,
    };
  });

  return { bubbles, textCandidates };
}

function deduplicateOverlappingTextClasses(
  bubbles: FusedComicRegion[],
  textRegions: FusedComicRegion[]
): FusedComicRegion[] {
  const sorted = [...textRegions].sort((a, b) => {
    const aInBubble = bubbles.some((bu) => computeIoMin(a.pixelBox, bu.pixelBox) >= 0.6);
    const bInBubble = bubbles.some((bu) => computeIoMin(b.pixelBox, bu.pixelBox) >= 0.6);
    const aBonus = a.classLabel === 'text_bubble' && aInBubble ? 0.08 : 0;
    const bBonus = b.classLabel === 'text_bubble' && bInBubble ? 0.08 : 0;
    return b.rawScore + bBonus - (a.rawScore + aBonus);
  });

  const kept: FusedComicRegion[] = [];
  for (const item of sorted) {
    const dup = kept.find((k) => calculateBoxIoU(item.pixelBox, k.pixelBox) >= 0.65);
    if (!dup) {
      kept.push(item);
    }
  }

  return kept;
}
