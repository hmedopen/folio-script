/**
 * Folio Script — Image Merge & Cut System
 * Core Merge Engine & Automatic Grouping Strategy
 */

import type {
  ProcessingSourceImage,
  ProcessingOutput,
  MergeOptions,
  ProcessingProgress,
} from '../core/types';
import { decodeImage, mergeImagesVertically, type DecodedImage } from './imageUtils';

/**
 * Calculates automatic merge groupings based on sensible webtoon translation defaults.
 * Groups sequential images so that each strip stays under ~8,000px to 10,000px or ~10 images.
 */
export function calculateAutomaticMergeGroups(
  sourceImages: ProcessingSourceImage[],
  options: MergeOptions = {}
): ProcessingOutput[] {
  if (sourceImages.length === 0) return [];

  const targetMaxHeight = options.targetMaxHeight || 9000;
  const targetChunkCount = options.targetChunkCount || 10;

  const groups: ProcessingSourceImage[][] = [];
  let currentGroup: ProcessingSourceImage[] = [];
  let currentGroupHeight = 0;

  for (let i = 0; i < sourceImages.length; i++) {
    const src = sourceImages[i];
    const wouldExceedHeight =
      currentGroupHeight + src.height > targetMaxHeight && currentGroup.length > 0;
    const reachedTargetCount = currentGroup.length >= targetChunkCount;

    if (wouldExceedHeight || reachedTargetCount) {
      groups.push(currentGroup);
      currentGroup = [src];
      currentGroupHeight = src.height;
    } else {
      currentGroup.push(src);
      currentGroupHeight += src.height;
    }
  }

  if (currentGroup.length > 0) {
    groups.push(currentGroup);
  }

  // Build ProcessingOutput structures
  return groups.map((group, groupIdx) => {
    const outputIndex = groupIdx + 1;
    const name = `merged_${String(outputIndex).padStart(3, '0')}.png`;

    let totalH = 0;
    let maxW = 0;
    const contributions = group.map((src, srcIdx) => {
      totalH += src.height;
      maxW = Math.max(maxW, src.width);
      return {
        sourceImageId: src.id,
        sourceIndex: srcIdx + 1,
      };
    });

    return {
      id: `out-merge-${outputIndex}-${Date.now()}`,
      outputIndex,
      name,
      operation: 'merge',
      contributingSources: contributions,
      width: maxW,
      height: totalH,
      sizeBytes: 0,
      status: 'pending',
    };
  });
}

/**
 * Executes rendering for a single output using its contributing source images.
 */
export async function renderSingleMergedOutput(
  output: ProcessingOutput,
  sourceImages: ProcessingSourceImage[]
): Promise<ProcessingOutput> {
  const sourceMap = new Map(sourceImages.map((s) => [s.id, s]));
  const decodedList: DecodedImage[] = [];

  try {
    for (const contrib of output.contributingSources) {
      const src = sourceMap.get(contrib.sourceImageId);
      if (!src) {
        throw new Error(`Source image ${contrib.sourceImageId} not found in session.`);
      }
      const decoded = await decodeImage(src.blob, src.mimeType);
      decodedList.push(decoded);
    }

    const result = await mergeImagesVertically(decodedList);

    // Create preview URL
    let previewUrl: string | undefined = undefined;
    if (typeof URL !== 'undefined') {
      try {
        previewUrl = URL.createObjectURL(result.blob);
      } catch {}
    }

    return {
      ...output,
      width: result.width,
      height: result.height,
      sizeBytes: result.blob.size,
      blob: result.blob,
      previewUrl,
      status: 'ready',
      error: undefined,
    };
  } catch (err: any) {
    return {
      ...output,
      status: 'failed',
      error: err?.message || 'Merge rendering failed.',
    };
  } finally {
    // Strictly close decoded bitmaps to avoid memory leaks
    for (const img of decodedList) {
      if (img.close) {
        try {
          img.close();
        } catch {}
      }
    }
  }
}

/**
 * Executes a full merge job across all outputs with controlled concurrency (max 3 at a time)
 * to maintain strict memory safety.
 */
export async function executeMergeJob(
  outputs: ProcessingOutput[],
  sourceImages: ProcessingSourceImage[],
  onProgress?: (progress: ProcessingProgress) => void,
  signal?: AbortSignal
): Promise<ProcessingOutput[]> {
  const results: ProcessingOutput[] = [...outputs];
  const concurrency = 3;
  let currentIndex = 0;
  let completed = 0;

  const total = outputs.length;
  onProgress?.({
    current: 0,
    total,
    message: `Starting merge of ${outputs.length} output(s)...`,
  });

  const worker = async () => {
    while (currentIndex < outputs.length) {
      if (signal?.aborted) throw new Error('Merge cancelled.');
      const idx = currentIndex++;
      const currentOut = outputs[idx];

      onProgress?.({
        current: completed,
        total,
        message: `Rendering ${currentOut.name} (${completed + 1}/${total})...`,
      });

      const rendered = await renderSingleMergedOutput(currentOut, sourceImages);
      results[idx] = rendered;
      completed++;

      onProgress?.({
        current: completed,
        total,
        message: `Completed ${rendered.name} (${completed}/${total}).`,
      });
    }
  };

  const workers = Array.from({ length: Math.min(concurrency, outputs.length) }, () => worker());
  await Promise.all(workers);

  return results;
}
