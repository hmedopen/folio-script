/**
 * Folio Script — Benchmark Detector Adapter Interfaces
 */

import type { BenchmarkImageMetadata } from '../datasets/types';
import type { ModelPrediction } from '../metrics/evaluationMetrics';

export interface DetectorAdapter {
  readonly name: string;
  readonly modelArchitecture: string;
  readonly hasInstanceSegmentation: boolean;
  detect(image: BenchmarkImageMetadata): Promise<{
    predictions: ModelPrediction[];
    latencyMs: number;
  }>;
}
