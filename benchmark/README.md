# Folio Script — Detector Evaluation & Benchmark Suite

An isolated, reproducible benchmark environment to evaluate comic speech bubble detectors and instance segmentation engines (RT-DETR-v2 vs. Koharu YOLO26s).

## Directory Structure

```text
benchmark/
├── datasets/
│   ├── types.ts          # Dataset and annotation schema
│   ├── manifest.json     # 16 multi-category benchmark images (Manga, Manhwa, Manhua, Western)
│   ├── images/           # Benchmark image assets
│   └── annotations/      # Annotation fixtures
├── metrics/
│   └── evaluationMetrics.ts # Box IoU, exact scanline Contour IoU, Precision, Recall, F1, Latency
├── models/
│   ├── types.ts          # Detector adapter contracts
│   ├── rtDetrAdapter.ts  # RT-DETR-v2 (Production detector adapter)
│   └── koharuAdapter.ts  # Koharu YOLO26s (Segmentation adapter)
├── segmentation/
│   ├── maskDecoder.ts    # YOLOv8/26 mask prototype reconstruction & logit dot product
│   └── contourExtractor.ts # Moore-Neighbor boundary tracing & Douglas-Peucker simplification
├── runners/
│   └── benchmarkRunner.ts # Automated evaluation runner & console reporting
├── reports/
│   └── benchmarkResults.json # Machine-readable evaluation report
└── tests/
    ├── segmentation.test.ts # Mask decoding & contour extraction unit tests
    ├── metrics.test.ts      # Box and Polygon IoU unit tests
    └── benchmarkIntegration.test.ts # End-to-end benchmark suite test
```

## Running the Benchmark

Execute the automated benchmark runner:
```bash
node --import ./src/test/localOcr/tsResolveHook.mjs benchmark/runners/benchmarkRunner.ts
```

Run benchmark tests:
```bash
node --import ./src/test/localOcr/tsResolveHook.mjs --test benchmark/tests/*.test.ts
```

Run existing scanning regression tests:
```bash
npm run test:local-ocr
```
