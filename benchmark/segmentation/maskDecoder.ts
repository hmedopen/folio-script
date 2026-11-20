/**
 * Folio Script — Instance Segmentation Mask Decoder
 * Reconstructs binary instance masks from YOLO segmentation outputs:
 * Output0: [batch, instances, 38] -> [x1, y1, x2, y2, conf, class_id, c0..c31]
 * Output1: [batch, 32, protoH, protoW] -> prototype masks
 */

export interface DecodedDetectionInstance {
  index: number;
  classId: number;
  confidence: number;
  box: [number, number, number, number]; // [x1, y1, x2, y2] in tile/input pixel coordinates
  maskCoefficients: Float32Array; // 32 coefficients
}

export interface ReconstructedMask {
  width: number;
  height: number;
  data: Uint8Array; // 1 for foreground (balloon interior), 0 for background
  boxRoi: [number, number, number, number]; // [px1, py1, px2, py2] in prototype pixel space
  foregroundPixelCount: number;
}

/**
 * Parses raw detections from Output0 [batch, instances, 38].
 */
export function parseYoloSegDetections(
  output0Data: Float32Array | ArrayLike<number>,
  numInstances: number,
  confidenceThreshold = 0.35
): DecodedDetectionInstance[] {
  const instances: DecodedDetectionInstance[] = [];
  const stride = 38;

  for (let i = 0; i < numInstances; i++) {
    const offset = i * stride;
    const x1 = Number(output0Data[offset]);
    const y1 = Number(output0Data[offset + 1]);
    const x2 = Number(output0Data[offset + 2]);
    const y2 = Number(output0Data[offset + 3]);
    const confidence = Number(output0Data[offset + 4]);
    const classId = Math.round(Number(output0Data[offset + 5]));

    if (!Number.isFinite(confidence) || confidence < confidenceThreshold) {
      continue;
    }
    if (x2 <= x1 || y2 <= y1) {
      continue;
    }

    const maskCoefficients = new Float32Array(32);
    for (let c = 0; c < 32; c++) {
      maskCoefficients[c] = Number(output0Data[offset + 6 + c]);
    }

    instances.push({
      index: i,
      classId,
      confidence,
      box: [x1, y1, x2, y2],
      maskCoefficients,
    });
  }

  return instances;
}

/**
 * Reconstructs binary mask for a single detected instance by performing
 * vector-matrix multiplication: mask = sigmoid(coefficients @ prototypes).
 * Optimizations:
 * - Computes only within the bounding box ROI mapped to prototype resolution.
 * - Compares logit >= 0.0 directly (equivalent to sigmoid(logit) >= 0.5) avoiding exp().
 */
export function reconstructInstanceMask(
  detection: DecodedDetectionInstance,
  prototypeData: Float32Array | ArrayLike<number>,
  protoWidth: number,
  protoHeight: number,
  inputWidth: number,
  inputHeight: number,
  logitThreshold = 0.0
): ReconstructedMask {
  const mask = new Uint8Array(protoWidth * protoHeight);
  const [x1, y1, x2, y2] = detection.box;
  const coeff = detection.maskCoefficients;

  const scaleX = protoWidth / inputWidth;
  const scaleY = protoHeight / inputHeight;

  const px1 = Math.max(0, Math.min(protoWidth - 1, Math.floor(x1 * scaleX)));
  const py1 = Math.max(0, Math.min(protoHeight - 1, Math.floor(y1 * scaleY)));
  const px2 = Math.max(0, Math.min(protoWidth - 1, Math.ceil(x2 * scaleX)));
  const py2 = Math.max(0, Math.min(protoHeight - 1, Math.ceil(y2 * scaleY)));

  const protoPlaneSize = protoWidth * protoHeight;
  let foregroundPixelCount = 0;

  for (let py = py1; py <= py2; py++) {
    const rowOffset = py * protoWidth;
    for (let px = px1; px <= px2; px++) {
      const pixelIndex = rowOffset + px;

      // Dot product: sum(coeff[c] * prototype[c, py, px])
      let logit = 0.0;
      for (let c = 0; c < 32; c++) {
        logit += coeff[c] * Number(prototypeData[c * protoPlaneSize + pixelIndex]);
      }

      if (logit > logitThreshold) {
        mask[pixelIndex] = 1;
        foregroundPixelCount++;
      }
    }
  }

  return {
    width: protoWidth,
    height: protoHeight,
    data: mask,
    boxRoi: [px1, py1, px2, py2],
    foregroundPixelCount,
  };
}

/**
 * Resamples a prototype-resolution binary mask [protoH, protoW] to crop ROI or full image dimensions.
 */
export function resampleBinaryMask(
  sourceMask: Uint8Array,
  srcW: number,
  srcH: number,
  dstW: number,
  dstH: number
): Uint8Array {
  const dst = new Uint8Array(dstW * dstH);
  const scaleX = srcW / dstW;
  const scaleY = srcH / dstH;

  for (let dy = 0; dy < dstH; dy++) {
    const sy = Math.min(srcH - 1, Math.floor(dy * scaleY));
    const srcRow = sy * srcW;
    const dstRow = dy * dstW;

    for (let dx = 0; dx < dstW; dx++) {
      const sx = Math.min(srcW - 1, Math.floor(dx * scaleX));
      dst[dstRow + dx] = sourceMask[srcRow + sx];
    }
  }

  return dst;
}
