import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { extractArchive } = require('../../../../electron/archiveExtractor.cjs');
const { createZipBuffer } = require('../../../../electron/chapterSnatchBackend.cjs');

// Valid 1x1 PNG bytes
const SAMPLE_PNG = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
  0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
  0x89, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44, 0x41,
  0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
  0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00,
  0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
  0x42, 0x60, 0x82,
]);

test('archiveExtractor: extracts images and preserves natural alphanumeric order', async () => {
  const tmpDir = path.join(os.tmpdir(), `test-extractor-${Date.now()}`);
  fs.mkdirSync(tmpDir, { recursive: true });

  const testZipPath = path.join(tmpDir, 'test.cbz');
  const destDir = path.join(tmpDir, 'extracted');

  // Create test ZIP with mixed out-of-order names and non-image junk
  const entries = [
    { filename: 'page_10.png', data: SAMPLE_PNG },
    { filename: 'page_2.png', data: SAMPLE_PNG },
    { filename: 'page_1.png', data: SAMPLE_PNG },
    { filename: '__MACOSX/._page_1.png', data: Buffer.from('junk metadata') },
    { filename: '.DS_Store', data: Buffer.from('junk mac os store') },
    { filename: 'chapter_info.txt', data: Buffer.from('some text info') },
  ];

  const zipBuf = createZipBuffer(entries);
  fs.writeFileSync(testZipPath, zipBuf);

  try {
    const result = await extractArchive(testZipPath, destDir);

    assert.equal(result.totalExtracted, 3, 'Should extract exactly 3 images');
    assert.equal(result.skippedNonImages, 1, 'Should skip chapter_info.txt as non-image');

    // Verify natural sort order: page_1, page_2, page_10
    assert.equal(result.pages[0].originalIndex, 1);
    assert.equal(result.pages[0].filename, '001.png');
    assert.equal(result.pages[1].originalIndex, 2);
    assert.equal(result.pages[1].filename, '002.png');
    assert.equal(result.pages[2].originalIndex, 3);
    assert.equal(result.pages[2].filename, '003.png');

    for (const p of result.pages) {
      assert.ok(fs.existsSync(p.filePath), `Extracted file must exist: ${p.filePath}`);
      assert.equal(p.mimeType, 'image/png');
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('archiveExtractor: enforces total uncompressed size limit', async () => {
  const tmpDir = path.join(os.tmpdir(), `test-extractor-limit-${Date.now()}`);
  fs.mkdirSync(tmpDir, { recursive: true });

  const testZipPath = path.join(tmpDir, 'test_large.zip');
  const destDir = path.join(tmpDir, 'extracted');

  const entries = [
    { filename: 'p1.png', data: SAMPLE_PNG },
    { filename: 'p2.png', data: SAMPLE_PNG },
  ];

  const zipBuf = createZipBuffer(entries);
  fs.writeFileSync(testZipPath, zipBuf);

  try {
    // Set maxTotalBytes to 50 bytes (smaller than sample PNG)
    await assert.rejects(
      async () => {
        await extractArchive(testZipPath, destDir, { maxTotalBytes: 50 });
      },
      /Archive exceeds maximum size limit/
    );
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
