/**
 * Folio Script — Image Merge & Cut System
 * Source-to-Output Allocation Model & Boundary Integrity Checker
 */

import type {
  ProcessingSourceImage,
  ProcessingOutput,
  OutputSourceContribution,
  BoundaryIntegrityStatus,
} from './types';

/**
 * Evaluates the entire session allocation to ensure no source images are missing,
 * duplicated across outputs, skipped in sequence, or leaving empty outputs.
 */
export function checkBoundaryIntegrity(
  sourceImages: ProcessingSourceImage[],
  outputs: ProcessingOutput[]
): BoundaryIntegrityStatus {
  const allSourceIds = new Set(sourceImages.map((s) => s.id));
  const sourceIndexMap = new Map(sourceImages.map((s, idx) => [s.id, idx]));

  // Track occurrences of each source image in outputs
  const sourceToOutputsMap = new Map<string, string[]>();
  for (const srcId of allSourceIds) {
    sourceToOutputsMap.set(srcId, []);
  }

  const emptyOutputIds: string[] = [];

  for (const output of outputs) {
    if (output.contributingSources.length === 0) {
      emptyOutputIds.push(output.id);
      continue;
    }

    for (const contrib of output.contributingSources) {
      const existing = sourceToOutputsMap.get(contrib.sourceImageId) || [];
      existing.push(output.id);
      sourceToOutputsMap.set(contrib.sourceImageId, existing);
    }
  }

  // 1. Unassigned Sources
  const unassignedSourceIds: string[] = [];
  // 2. Duplicate Sources (assigned to > 1 output)
  const duplicateSourceIds: string[] = [];

  for (const [srcId, outputIds] of sourceToOutputsMap.entries()) {
    if (outputIds.length === 0) {
      unassignedSourceIds.push(srcId);
    } else if (outputIds.length > 1) {
      duplicateSourceIds.push(srcId);
    }
  }

  // 3. Sequential Gaps between consecutive outputs
  const gaps: BoundaryIntegrityStatus['gaps'] = [];
  const validOutputs = outputs.filter((o) => o.contributingSources.length > 0);

  for (let i = 0; i < validOutputs.length - 1; i++) {
    const curOut = validOutputs[i];
    const nextOut = validOutputs[i + 1];

    const curMaxIdx = Math.max(
      ...curOut.contributingSources.map((c) => sourceIndexMap.get(c.sourceImageId) ?? -1)
    );
    const nextMinIdx = Math.min(
      ...nextOut.contributingSources.map((c) => sourceIndexMap.get(c.sourceImageId) ?? 999999)
    );

    if (nextMinIdx > curMaxIdx + 1 && curMaxIdx >= 0 && nextMinIdx < sourceImages.length) {
      const missingSourceIds: string[] = [];
      for (let m = curMaxIdx + 1; m < nextMinIdx; m++) {
        missingSourceIds.push(sourceImages[m].id);
      }
      if (missingSourceIds.length > 0) {
        gaps.push({
          priorOutputIndex: curOut.outputIndex,
          nextOutputIndex: nextOut.outputIndex,
          missingSourceIds,
        });
      }
    }
  }

  const isValid =
    unassignedSourceIds.length === 0 &&
    duplicateSourceIds.length === 0 &&
    gaps.length === 0 &&
    emptyOutputIds.length === 0;

  return {
    unassignedSourceIds,
    duplicateSourceIds,
    gaps,
    emptyOutputIds,
    isValid,
  };
}

/**
 * Reassigns a source image from one output to another, strictly maintaining:
 * 1. Ordering of sources within outputs.
 * 2. Avoiding duplicate assignments unless explicitly requested.
 * 3. Consistent 1-based source indices.
 */
export function reassignSourceImage(
  outputs: ProcessingOutput[],
  sourceImages: ProcessingSourceImage[],
  sourceImageId: string,
  targetOutputId: string,
  removeFromOtherOutputs: boolean = true
): ProcessingOutput[] {
  const sourceIndexMap = new Map(sourceImages.map((s, idx) => [s.id, idx]));

  return outputs.map((out) => {
    // If this is the target output
    if (out.id === targetOutputId) {
      const alreadyHas = out.contributingSources.some((c) => c.sourceImageId === sourceImageId);
      if (alreadyHas) return out;

      const newContribs = [
        ...out.contributingSources,
        { sourceImageId, sourceIndex: 0 },
      ];

      // Sort strictly by original source image order
      newContribs.sort((a, b) => {
        const idxA = sourceIndexMap.get(a.sourceImageId) ?? 0;
        const idxB = sourceIndexMap.get(b.sourceImageId) ?? 0;
        return idxA - idxB;
      });

      // Re-index sequentially 1..N
      const indexed = newContribs.map((c, i) => ({
        ...c,
        sourceIndex: i + 1,
      }));

      return {
        ...out,
        contributingSources: indexed,
        status: 'pending',
      };
    }

    // If this is another output and removeFromOtherOutputs is true
    if (removeFromOtherOutputs) {
      const filtered = out.contributingSources.filter((c) => c.sourceImageId !== sourceImageId);
      if (filtered.length !== out.contributingSources.length) {
        const indexed = filtered.map((c, i) => ({
          ...c,
          sourceIndex: i + 1,
        }));
        return {
          ...out,
          contributingSources: indexed,
          status: 'pending',
        };
      }
    }

    return out;
  });
}

/**
 * Sets the exact contributing source IDs for a specific output,
 * automatically syncing neighbor outputs if removeFromNeighbors is true.
 */
export function setOutputContributions(
  outputs: ProcessingOutput[],
  sourceImages: ProcessingSourceImage[],
  targetOutputId: string,
  newSourceIds: string[],
  removeFromNeighbors: boolean = true
): ProcessingOutput[] {
  const sourceIndexMap = new Map(sourceImages.map((s, idx) => [s.id, idx]));
  const newSet = new Set(newSourceIds);

  return outputs.map((out) => {
    if (out.id === targetOutputId) {
      // Build contributions in original source order
      const contribs: OutputSourceContribution[] = newSourceIds
        .slice()
        .sort((a, b) => (sourceIndexMap.get(a) ?? 0) - (sourceIndexMap.get(b) ?? 0))
        .map((srcId, idx) => ({
          sourceImageId: srcId,
          sourceIndex: idx + 1,
        }));

      return {
        ...out,
        contributingSources: contribs,
        status: 'pending',
      };
    }

    if (removeFromNeighbors) {
      // Remove any sources newly claimed by target output
      const filtered = out.contributingSources.filter((c) => !newSet.has(c.sourceImageId));
      if (filtered.length !== out.contributingSources.length) {
        return {
          ...out,
          contributingSources: filtered.map((c, idx) => ({ ...c, sourceIndex: idx + 1 })),
          status: 'pending',
        };
      }
    }

    return out;
  });
}

/**
 * Creates a serializable snapshot of the current allocation mapping for undo/redo.
 */
export function captureAllocationSnapshot(
  outputs: ProcessingOutput[]
): OutputSourceContribution[][] {
  return outputs.map((o) => o.contributingSources.map((c) => ({ ...c })));
}

/**
 * Restores outputs to an allocation snapshot.
 */
export function restoreAllocationSnapshot(
  outputs: ProcessingOutput[],
  snapshot: OutputSourceContribution[][]
): ProcessingOutput[] {
  return outputs.map((out, idx) => {
    const snapContribs = snapshot[idx];
    if (!snapContribs) return out;
    return {
      ...out,
      contributingSources: snapContribs.map((c) => ({ ...c })),
      status: 'pending',
    };
  });
}
