import type { ProvenanceMeta } from './primitives.ts';
import type { TextRegionGeometry } from './geometry.ts';

export type TextOrientation = 'horizontal' | 'vertical_cjk' | 'stylized_sfx';
export type ContainerAssociationStatus = 'associated' | 'borderless' | 'legacy_unassociated';
export type RegionLifecycleState = 'active' | 'orphaned_candidate' | 'dismissed';

export interface RubyAnnotation {
  rubyId: string;
  rubyLineObservationId: string;
  parentLineObservationId: string;
  parentCharSpan: [number, number];
  rubyText: string;
}

export interface TextRegion {
  regionId: string;
  pageId: string;
  spatialGroupId?: string | null;
  containerId: string | null;
  containerAssociation: ContainerAssociationStatus;
  geometry: TextRegionGeometry;
  orientation: TextOrientation;
  lineObservationIds: string[];
  rubyAnnotations: RubyAnnotation[];
  confidence: number;
  lifecycleState: RegionLifecycleState;
  provenance: {
    geometry: ProvenanceMeta;
    containerId: ProvenanceMeta;
  };
}
