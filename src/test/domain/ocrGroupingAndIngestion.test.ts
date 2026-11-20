import test from 'node:test';
import assert from 'node:assert/strict';
import type { AssociatedTextCandidate, RawOcrLineDetection, FusedComicRegion } from '../../types/localOcr.ts';
import { groupLinesToTextRegions, detectRubyLines } from '../../lib/localOcr/lineGrouping.ts';
import { buildCanonicalDomainStateFromOcr } from '../../lib/domain/ocrIngestion.ts';
import { getCanonicalRegionText } from '../../lib/domain/geometryValidators.ts';

test('Milestone 4.3: Multiple independent dialogue sections within one physical balloon are partitioned correctly', () => {
  // One physical balloon containing two independent utterances separated by vertical gap
  const candidates: AssociatedTextCandidate[] = [
    {
      candidateId: 'cand-top-section',
      kind: 'text_bubble',
      pixelBox: [100, 200, 150, 400], // height = 50px
      normalizedBox: [100, 200, 150, 400],
      rawScore: 0.95,
      sourceTileIds: ['tile_1'],
      boundaryUncertain: false,
      flags: [],
      associatedBubbleId: 'balloon-shared-1',
      associationConfidence: 0.98,
    },
    {
      candidateId: 'cand-bottom-section',
      kind: 'text_bubble',
      pixelBox: [350, 200, 400, 400], // height = 50px, gap = 200px (>> 1.8 * 50px)
      normalizedBox: [350, 200, 400, 400],
      rawScore: 0.92,
      sourceTileIds: ['tile_1'],
      boundaryUncertain: false,
      flags: [],
      associatedBubbleId: 'balloon-shared-1',
      associationConfidence: 0.95,
    },
  ];

  const linesByCandidate = new Map<string, RawOcrLineDetection[]>([
    [
      'cand-top-section',
      [
        {
          lineId: 'line-top-1',
          candidateId: 'cand-top-section',
          text: 'Wait for me!',
          rawRecognitionScore: 0.96,
          pixelPolygon: [[200, 100], [400, 100], [400, 150], [200, 150]],
          pixelBox: [100, 200, 150, 400],
          normalizedBox: [100, 200, 150, 400],
          isVertical: false,
        },
      ],
    ],
    [
      'cand-bottom-section',
      [
        {
          lineId: 'line-bot-1',
          candidateId: 'cand-bottom-section',
          text: 'I cannot stop.',
          rawRecognitionScore: 0.93,
          pixelPolygon: [[200, 350], [400, 350], [400, 400], [200, 400]],
          pixelBox: [350, 200, 400, 400],
          normalizedBox: [350, 200, 400, 400],
          isVertical: false,
        },
      ],
    ],
  ]);

  const { textRegions } = groupLinesToTextRegions(candidates, linesByCandidate, {
    language: 'en',
    sourceWidth: 1000,
    sourceHeight: 1000,
  });

  // Verify that two distinct logical TextRegions were formed
  assert.equal(textRegions.length, 2);
  assert.equal(textRegions[0].rawOCR, 'Wait for me!');
  assert.equal(textRegions[0].associations.bubbleId, 'balloon-shared-1');
  assert.equal(textRegions[1].rawOCR, 'I cannot stop.');
  assert.equal(textRegions[1].associations.bubbleId, 'balloon-shared-1');

  // Ingest into domain state
  const fusedBubbles: FusedComicRegion[] = [
    {
      id: 'balloon-shared-1',
      classLabel: 'bubble',
      pixelBox: [80, 180, 420, 420],
      normalizedBox: [80, 180, 420, 420],
      rawScore: 0.97,
      sourceTileIds: ['tile_1'],
      boundaryUncertain: false,
      flags: [],
    },
  ];

  const { pageDomainState } = buildCanonicalDomainStateFromOcr({
    pageId: 'page-shared-balloon',
    sourceDimensions: { width: 1000, height: 1000 },
    fusedBubbles,
    candidates,
    linesByCandidate,
    textRegions,
  });

  // Exactly 1 physical container on page
  assert.equal(Object.keys(pageDomainState.containers).length, 1);
  const container = pageDomainState.containers['balloon-shared-1'];
  assert.equal(container.state, 'active');

  // Exactly 2 text regions sharing this container
  assert.equal(Object.keys(pageDomainState.textRegions).length, 2);
  for (const tr of Object.values(pageDomainState.textRegions)) {
    assert.equal(tr.containerId, 'balloon-shared-1');
    assert.equal(tr.containerAssociation, 'associated');
  }

  // Exactly 2 content records, both in readingSequence
  assert.equal(Object.keys(pageDomainState.contentRecords).length, 2);
  assert.equal(pageDomainState.readingSequence.length, 2);
});

test('Milestone 4.3: Borderless text and empty containers are correctly represented in domain state', () => {
  // Borderless text candidate with no bubble
  const candidates: AssociatedTextCandidate[] = [
    {
      candidateId: 'cand-borderless-sound',
      kind: 'text_free',
      pixelBox: [500, 50, 580, 300],
      normalizedBox: [500, 50, 580, 300],
      rawScore: 0.88,
      sourceTileIds: ['tile_1'],
      boundaryUncertain: false,
      flags: [],
      associatedBubbleId: null, // BORDERLESS
      associationConfidence: 0.0,
    },
  ];

  const linesByCandidate = new Map<string, RawOcrLineDetection[]>([
    [
      'cand-borderless-sound',
      [
        {
          lineId: 'line-sfx-1',
          candidateId: 'cand-borderless-sound',
          text: 'RUMBLE...',
          rawRecognitionScore: 0.89,
          pixelPolygon: [[50, 500], [300, 500], [300, 580], [50, 580]],
          pixelBox: [500, 50, 580, 300],
          normalizedBox: [500, 50, 580, 300],
          isVertical: false,
        },
      ],
    ],
  ]);

  const { textRegions } = groupLinesToTextRegions(candidates, linesByCandidate, {
    language: 'en',
    sourceWidth: 1000,
    sourceHeight: 1000,
  });

  assert.equal(textRegions.length, 1);
  assert.equal(Boolean(textRegions[0].associations.bubbleId), false);

  // One empty visual bubble on the page with NO text inside
  const fusedBubbles: FusedComicRegion[] = [
    {
      id: 'bubble-empty-silence',
      classLabel: 'bubble',
      pixelBox: [100, 100, 250, 250],
      normalizedBox: [100, 100, 250, 250],
      rawScore: 0.93,
      sourceTileIds: ['tile_1'],
      boundaryUncertain: false,
      flags: [],
    },
  ];

  const { pageDomainState, scanRunRecord } = buildCanonicalDomainStateFromOcr({
    pageId: 'page-borderless-and-empty',
    sourceDimensions: { width: 1000, height: 1000 },
    fusedBubbles,
    candidates,
    linesByCandidate,
    textRegions,
  });

  // 1. Verify empty container
  const emptyCont = pageDomainState.containers['bubble-empty-silence'];
  assert.ok(emptyCont);
  assert.equal(emptyCont.state, 'empty');

  // 2. Verify borderless text region
  const tr = Object.values(pageDomainState.textRegions)[0];
  assert.ok(tr);
  assert.equal(tr.containerId, null);
  assert.equal(tr.containerAssociation, 'borderless');

  // 3. Verify scan run record observations
  assert.equal(Object.keys(scanRunRecord.detectorObservations).length, 1);
  assert.equal(Object.keys(scanRunRecord.ocrObservations).length, 1);
  assert.equal(scanRunRecord.ocrObservations['line-sfx-1'].text, 'RUMBLE...');
});

test('Milestone 4.3: Supported CJK and Ruby (furigana) detection isolates phonetic annotations from canonical text', () => {
  // Japanese vertical text with base kanji column and adjacent narrow ruby column
  const rawLines: RawOcrLineDetection[] = [
    {
      lineId: 'line-kanji-base',
      candidateId: 'cand-cjk-1',
      text: '東京',
      rawRecognitionScore: 0.98,
      pixelPolygon: [[200, 100], [250, 100], [250, 300], [200, 300]],
      pixelBox: [100, 200, 300, 250], // width = 50px, height = 200px
      normalizedBox: [100, 200, 300, 250],
      isVertical: true,
    },
    {
      lineId: 'line-ruby-furigana',
      candidateId: 'cand-cjk-1',
      text: 'とうきょう',
      rawRecognitionScore: 0.91,
      // Narrow column situated immediately to the right: x in [255, 275], width = 20px (40% of 50px)
      pixelPolygon: [[255, 100], [275, 100], [275, 300], [255, 300]],
      pixelBox: [100, 255, 300, 275],
      normalizedBox: [100, 255, 300, 275],
      isVertical: true,
    },
  ];

  const rubyResult = detectRubyLines(rawLines, true);
  assert.equal(rubyResult.mainLines.length, 1);
  assert.equal(rubyResult.mainLines[0].lineId, 'line-kanji-base');
  assert.equal(rubyResult.rubyAnnotations.length, 1);
  assert.equal(rubyResult.rubyAnnotations[0].rubyText, 'とうきょう');
  assert.equal(rubyResult.rubyAnnotations[0].parentLineObservationId, 'line-kanji-base');

  const candidates: AssociatedTextCandidate[] = [
    {
      candidateId: 'cand-cjk-1',
      kind: 'text_bubble',
      pixelBox: [100, 200, 300, 275],
      normalizedBox: [100, 200, 300, 275],
      rawScore: 0.96,
      sourceTileIds: ['tile_1'],
      boundaryUncertain: false,
      flags: [],
      associatedBubbleId: 'bubble-cjk-1',
      associationConfidence: 0.99,
    },
  ];

  const linesByCandidate = new Map<string, RawOcrLineDetection[]>([['cand-cjk-1', rawLines]]);

  const { textRegions } = groupLinesToTextRegions(candidates, linesByCandidate, {
    language: 'ja',
    sourceWidth: 1000,
    sourceHeight: 1000,
  });

  assert.equal(textRegions.length, 1);
  // Crucial invariant: rawOCR must contain the kanji base, without furigana string appended!
  assert.equal(textRegions[0].rawOCR, '東京');

  // Verify domain ingestion isolates ruby from lineObservationIds into rubyAnnotations
  const { pageDomainState, scanRunRecord } = buildCanonicalDomainStateFromOcr({
    pageId: 'page-cjk-ruby',
    sourceDimensions: { width: 1000, height: 1000 },
    candidates,
    linesByCandidate,
    textRegions,
  });

  const domainTr = Object.values(pageDomainState.textRegions)[0];
  assert.ok(domainTr);
  // lineObservationIds must contain ONLY the main text line
  assert.deepEqual(domainTr.lineObservationIds, ['line-kanji-base']);
  // rubyAnnotations must contain the ruby line observation
  assert.equal(domainTr.rubyAnnotations.length, 1);
  assert.equal(domainTr.rubyAnnotations[0].rubyText, 'とうきょう');
  assert.equal(domainTr.rubyAnnotations[0].parentLineObservationId, 'line-kanji-base');
  // Both observations are safely registered in ScanRunRecord
  assert.ok(scanRunRecord.ocrObservations['line-kanji-base']);
  assert.ok(scanRunRecord.ocrObservations['line-ruby-furigana']);

  // Check canonical region text derivation strictly excludes ruby
  const canonical = getCanonicalRegionText([
    { text: '東京', isRuby: false },
    { text: 'とうきょう', isRuby: true },
  ]);
  assert.equal(canonical, '東京');
});
