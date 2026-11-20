import type { PixelBox } from './primitives.ts';

export interface SpatialGroup {
  groupId: string;
  pageId: string;
  groupType: 'panel' | 'vignette' | 'spread';
  pixelBox: PixelBox;
  sequenceIndex: number;
  confidence: number;
}
