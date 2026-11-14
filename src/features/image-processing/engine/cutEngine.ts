/**
 * Folio Script — Image Merge & Cut System
 * Core Cut Engine & Slicing Strategy
 */

import type {
  ProcessingSourceImage,
  ProcessingOutput,
  CutOptions,
  ProcessingProgress,
} from '../core/types';
import { decodeImage, cutImageSubRegion } from './imageUtils';

/**
 * Calculates automatic cut segments for selected images.
 * Splits tall webtoon images into standard page segments (e.g. ~2400px - 3000px),
 * strictly recording exact source region coordinates and avoiding missing or duplicated pixels.
 */
export function calculateAutomaticCutSegments(
  sourceImages: ProcessingSourceImage[],
  options: CutOptions = {}
): ProcessingOutput[] {
  if (sourceImages.length === 0) return [];

  const maxSliceHeight = options.maxSliceHeight || 2800;
  const outputs: ProcessingOutput[] = [];
  let globalOutputIndex = 1;

  for (const src of sourceImages) {
    if (src.height <= maxSliceHeight) {
      // If image is already within normal page height, split into 2 halves if user clicked Cut,
      // or keep as single segment if small.
      const numSegments = src.height > 1600 ? 2 : 1;
      const segmentHeight = Math.floor(src.height / numSegments);

      for (let s = 0; s < numSegments; s++) {
        const yStart = s * segmentHeight;
        const yHeight = s === numSegments - 1 ? src.height - yStart : segmentHeight;

        outputs.push({
          id: `out-cut-${globalOutputIndex}-${Date.now()}`,
          outputIndex: globalOutputIndex,
          name: `cut_${String(globalOutputIndex).padStart(3, '0')}.png`,
          operation: 'cut',
          contributingSources: [
            {
              sourceImageId: src.id,
              sourceIndex: 1,
              sourceRegion: {
                x: 0,
                y: yStart,
                width: src.width,
                height: yHeight,
              },
            },
          ],
          width: src.width,
          height: yHeight,
          sizeBytes: 0,
          status: 'pending',
        });
        globalOutputIndex++;
      }
    } else {
      // Extremely tall webtoon image: slice into continuous segments
      let currentY = 0;
      while (currentY < src.height) {
        const remainingH = src.height - currentY;
        let sliceH = Math.min(remainingH, maxSliceHeight);

        // If the leftover remainder would be a sliver under 400px, absorb into this slice
        if (remainingH - sliceH > 0 && remainingH - sliceH < 400) {
          sliceH = remainingH;
        }

        outputs.push({
          id: `out-cut-${globalOutputIndex}-${Date.now()}`,
          outputIndex: globalOutputIndex,
          name: `cut_${String(globalOutputIndex).padStart(3, '0')}.png`,
          operation: 'cut',
          contributingSources: [
            {
              sourceImageId: src.id,
              sourceIndex: 1,
              sourceRegion: {
                x: 0,
                y: currentY,
                width: src.width,
                height: sliceH,
              },
            },
          ],
          width: src.width,
          height: sliceH,
          sizeBytes: 0,
          status: 'pending',
        });

        currentY += sliceH;
        globalOutputIndex++;
      }
    }
  }

  return outputs;
}

/**
 * Renders a single cut output segment from its source image region.
 */
export async function renderSingleCutOutput(
  output: ProcessingOutput,
  sourceImages: ProcessingSourceImage[]
): Promise<ProcessingOutput> {
  const sourceMap = new Map(sourceImages.map((s) => [s.id, s]));
  const primaryContrib = output.contributingSources[0];

  if (!primaryContrib) {
    return {
      ...output,
      status: 'failed',
      error: 'Cut output has no contributing source.',
    };
  }

  const src = sourceMap.get(primaryContrib.sourceImageId);
  if (!src) {
    return {
      ...output,
      status: 'failed',
      error: `Source image ${primaryContrib.sourceImageId} not found in session.`,
    };
  }

  const region = primaryContrib.sourceRegion || {
    x: 0,
    y: 0,
    width: src.width,
    height: src.height,
  };

  let decoded;
  try {
    decoded = await decodeImage(src.blob, src.mimeType);
    const result = await cutImageSubRegion(decoded, region);

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
      error: err?.message || 'Cut rendering failed.',
    };
  } finally {
    if (decoded?.close) {
      try {
        decoded.close();
      } catch {}
    }
  }
}

/**
 * Executes a full cut job with controlled concurrency and progress reporting.
 */
export async function executeCutJob(
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
    message: `Starting cut of ${outputs.length} segment(s)...`,
  });

  const worker = async () => {
    while (currentIndex < outputs.length) {
      if (signal?.aborted) throw new Error('Cut cancelled.');
      const idx = currentIndex++;
      const currentOut = outputs[idx];

      onProgress?.({
        current: completed,
        total,
        message: `Slicing ${currentOut.name} (${completed + 1}/${total})...`,
      });

      const rendered = await renderSingleCutOutput(currentOut, sourceImages);
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
