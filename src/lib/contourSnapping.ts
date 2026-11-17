/**
 * Folio Script - High Precision Bubble Contour Snapping Engine
 * 
 * Analyzes image pixels around candidate bounding boxes in memory and snaps
 * approximate coordinates to true physical speech bubble contours.
 * 
 * Prevents vertical drift on tall webtoons and loose/misaligned fits on standard manga pages.
 */

export interface ContourSnapOptions {
  paddingFactor?: number;      // Search neighborhood around box (default: 0.15 = 15%)
  whiteThreshold?: number;     // Minimum luminance to consider interior bubble pixel (0-255)
  edgeThreshold?: number;      // Gradient magnitude for dark border edge
  minAspectRatio?: number;     // Sanity bounds on snapped dimensions
  maxAspectRatio?: number;
}

/**
 * Snaps a normalized [ymin, xmin, ymax, xmax] (0-1000 scale) bounding box
 * to the true physical contour of the speech bubble on the underlying RGBA image data.
 */
export function snapBoxToBubbleContour(
  box: [number, number, number, number],
  rgbaData: Uint8ClampedArray | Uint8Array,
  imageWidth: number,
  imageHeight: number,
  options: ContourSnapOptions = {}
): [number, number, number, number] {
  const {
    paddingFactor = 0.18,
    whiteThreshold = 210,
    edgeThreshold = 35,
  } = options;

  if (imageWidth <= 0 || imageHeight <= 0 || !rgbaData || rgbaData.length === 0) {
    return box;
  }

  // Convert 0-1000 normalized to pixel coordinates
  const [normYmin, normXmin, normYmax, normXmax] = box;
  const pYmin = Math.round((normYmin / 1000) * imageHeight);
  const pXmin = Math.round((normXmin / 1000) * imageWidth);
  const pYmax = Math.round((normYmax / 1000) * imageHeight);
  const pXmax = Math.round((normXmax / 1000) * imageWidth);

  const boxW = Math.max(pXmax - pXmin, 8);
  const boxH = Math.max(pYmax - pYmin, 8);

  // If box is massive (>70% of image), don't snap (likely background/panel)
  if (boxW > imageWidth * 0.7 && boxH > imageHeight * 0.7) {
    return box;
  }

  // Expand search ROI by paddingFactor
  const padX = Math.round(boxW * paddingFactor);
  const padY = Math.round(boxH * paddingFactor);

  const roiX1 = Math.max(0, pXmin - padX);
  const roiY1 = Math.max(0, pYmin - padY);
  const roiX2 = Math.min(imageWidth - 1, pXmax + padX);
  const roiY2 = Math.min(imageHeight - 1, pYmax + padY);

  const roiW = roiX2 - roiX1 + 1;
  const roiH = roiY2 - roiY1 + 1;

  if (roiW < 10 || roiH < 10) {
    return box;
  }

  // Helper to sample grayscale luminance from RGBA buffer
  const getLum = (x: number, y: number): number => {
    const idx = (y * imageWidth + x) * 4;
    const r = rgbaData[idx];
    const g = rgbaData[idx + 1];
    const b = rgbaData[idx + 2];
    // Standard perceptual luminance
    return 0.299 * r + 0.587 * g + 0.114 * b;
  };

  // 1. Sample central region of the candidate box to verify if interior is high-luminance (bubble)
  const centerX = Math.round((pXmin + pXmax) / 2);
  const centerY = Math.round((pYmin + pYmax) / 2);
  const sampleRadius = Math.min(5, Math.floor(Math.min(boxW, boxH) / 4));

  let centerLumSum = 0;
  let centerSamples = 0;
  for (let dy = -sampleRadius; dy <= sampleRadius; dy++) {
    for (let dx = -sampleRadius; dx <= sampleRadius; dx++) {
      const sx = Math.max(0, Math.min(imageWidth - 1, centerX + dx));
      const sy = Math.max(0, Math.min(imageHeight - 1, centerY + dy));
      centerLumSum += getLum(sx, sy);
      centerSamples++;
    }
  }

  const avgCenterLum = centerSamples > 0 ? centerLumSum / centerSamples : 0;
  // If center is dark (e.g. black speech bubble or dark artwork), contour snapping to white bubble does not apply
  const isLightBubble = avgCenterLum >= 180;
  if (!isLightBubble) {
    return box;
  }

  // 2. Scan outward along 4 cardinal directions from center to find boundary transition
  // Raycast UP
  let foundYmin = pYmin;
  for (let y = centerY; y >= roiY1; y--) {
    const lum = getLum(centerX, y);
    const lumNext = y > 0 ? getLum(centerX, y - 1) : 0;
    const diff = Math.abs(lum - lumNext);
    if (lum < whiteThreshold || diff >= edgeThreshold) {
      foundYmin = y;
      break;
    }
  }

  // Raycast DOWN
  let foundYmax = pYmax;
  for (let y = centerY; y <= roiY2; y++) {
    const lum = getLum(centerX, y);
    const lumNext = y < imageHeight - 1 ? getLum(centerX, y + 1) : 0;
    const diff = Math.abs(lum - lumNext);
    if (lum < whiteThreshold || diff >= edgeThreshold) {
      foundYmax = y;
      break;
    }
  }

  // Raycast LEFT
  let foundXmin = pXmin;
  for (let x = centerX; x >= roiX1; x--) {
    const lum = getLum(x, centerY);
    const lumNext = x > 0 ? getLum(x - 1, centerY) : 0;
    const diff = Math.abs(lum - lumNext);
    if (lum < whiteThreshold || diff >= edgeThreshold) {
      foundXmin = x;
      break;
    }
  }

  // Raycast RIGHT
  let foundXmax = pXmax;
  for (let x = centerX; x <= roiX2; x++) {
    const lum = getLum(x, centerY);
    const lumNext = x < imageWidth - 1 ? getLum(x + 1, centerY) : 0;
    const diff = Math.abs(lum - lumNext);
    if (lum < whiteThreshold || diff >= edgeThreshold) {
      foundXmax = x;
      break;
    }
  }

  // 3. Sanity check: Ensure snapped box has reasonable proportions and didn't collapse or explode
  const snappedW = foundXmax - foundXmin;
  const snappedH = foundYmax - foundYmin;

  if (
    snappedW < boxW * 0.4 ||
    snappedW > boxW * 2.2 ||
    snappedH < boxH * 0.4 ||
    snappedH > boxH * 2.2
  ) {
    // If raycast hit a hollow edge or collapsed, fallback safely to original candidate box
    return box;
  }

  // Convert snapped pixel coordinates back to 0-1000 normalized space
  const finalNormYmin = Math.max(0, Math.min(1000, Math.round((foundYmin / imageHeight) * 1000)));
  const finalNormXmin = Math.max(0, Math.min(1000, Math.round((foundXmin / imageWidth) * 1000)));
  const finalNormYmax = Math.max(0, Math.min(1000, Math.round((foundYmax / imageHeight) * 1000)));
  const finalNormXmax = Math.max(0, Math.min(1000, Math.round((foundXmax / imageWidth) * 1000)));

  // Ensure minimum dimensions
  if (finalNormYmax - finalNormYmin < 5 || finalNormXmax - finalNormXmin < 5) {
    return box;
  }

  return [finalNormYmin, finalNormXmin, finalNormYmax, finalNormXmax];
}
