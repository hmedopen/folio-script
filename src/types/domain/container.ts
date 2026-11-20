import type { ProvenanceMeta } from './primitives.ts';
import type { ContainerGeometry } from './geometry.ts';

export type ContainerType =
  | 'speech_balloon'
  | 'thought_balloon'
  | 'shout_burst'
  | 'whisper_dashed'
  | 'narration_box'
  | 'sign_board'
  | 'in_art_boundary';

export type ContainerLifecycleState = 'active' | 'empty' | 'orphaned_candidate' | 'dismissed';

export interface PhysicalContainer {
  containerId: string;
  pageId: string;
  spatialGroupId?: string | null;
  containerType: ContainerType;
  geometry: ContainerGeometry;
  confidence: number;
  boundaryUncertain: boolean;
  zIndex: number;
  state: ContainerLifecycleState;
  provenance: {
    geometry: ProvenanceMeta;
    containerType: ProvenanceMeta;
  };
}
