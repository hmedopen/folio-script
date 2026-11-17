import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { googleDriveAdapter } from '../sources/googleDriveAdapter.ts';
import { sourceRegistry } from '../core/sourceRegistry.ts';
import { ChapterWorkspaceImporter } from '../services/workspaceImporter.ts';
import { ChapterZipExporter } from '../services/zipExporter.ts';
import type { ChapterPage, DownloadedImageData } from '../core/types.ts';
import type { Folder } from '../../../types.ts';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { parseDriveUrl } = require('../../../../electron/googleDriveClient.cjs');
const { extractArchive } = require('../../../../electron/archiveExtractor.cjs');
const { createZipBuffer } = require('../../../../electron/chapterSnatchBackend.cjs');
const { googleDriveAuthManager } = require('../../../../electron/googleDriveAuth.cjs');

// Valid 1x1 test image bytes
const TINY_PNG = new Uint8Array([
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

function setupMockIndexedDb() {
  const storeMap = new Map<string, any>();
  const makeStore = () => ({
    get(k: string) {
      const req: any = { result: storeMap.get(k), error: null, onsuccess: null, onerror: null };
      queueMicrotask(() => req.onsuccess?.());
      return req;
    },
    put(v: any, explicitKey?: string) {
      const k = explicitKey || v?.id;
      storeMap.set(k, v);
      const req: any = { result: k, error: null, onsuccess: null, onerror: null };
      queueMicrotask(() => req.onsuccess?.());
      return req;
    },
  });

  const tx = { objectStore: () => makeStore() };
  const db = {
    version: 8,
    objectStoreNames: { contains: () => true, length: 20 },
    transaction: () => tx,
    createObjectStore: () => ({ createIndex: () => {} }),
    close() {},
  };

  (globalThis as any).indexedDB = {
    open: () => {
      const req: any = { result: db, error: null, onsuccess: null, onerror: null };
      queueMicrotask(() => req.onsuccess?.());
      return req;
    },
  };
}

test('googleDriveAdapter: canHandle accurately detects Google Drive URLs', () => {
  assert.equal(googleDriveAdapter.canHandle('https://drive.google.com/drive/folders/12345'), true);
  assert.equal(googleDriveAdapter.canHandle('https://docs.google.com/uc?id=12345'), true);
  assert.equal(googleDriveAdapter.canHandle('drive.google.com/file/d/12345/view'), true);
  assert.equal(googleDriveAdapter.canHandle('https://mangadex.org/chapter/12345'), false);
  assert.equal(googleDriveAdapter.canHandle('https://example.com/notdrive'), false);
});

test('googleDriveAdapter: resolve parses folder, file, and query URLs', () => {
  // 1. Folder URL
  const folderInfo = googleDriveAdapter.resolve('https://drive.google.com/drive/folders/1A2B3C4D5E?usp=sharing');
  assert.equal(folderInfo.source, 'googledrive');
  assert.equal(folderInfo.sourceChapterId, '1A2B3C4D5E');
  assert.equal(folderInfo.normalizedUrl, 'https://drive.google.com/drive/folders/1A2B3C4D5E');

  // 2. Folder URL with resourcekey
  const folderKeyInfo = googleDriveAdapter.resolve('https://drive.google.com/drive/folders/1FolderID?resourcekey=0-ResKey123');
  assert.equal(folderKeyInfo.sourceChapterId, '1FolderID');
  assert.equal(folderKeyInfo.normalizedUrl, 'https://drive.google.com/drive/folders/1FolderID?resourcekey=0-ResKey123');

  // 3. File URL
  const fileInfo = googleDriveAdapter.resolve('https://drive.google.com/file/d/1FileArchiveID/view');
  assert.equal(fileInfo.sourceChapterId, '1FileArchiveID');
  assert.equal(fileInfo.normalizedUrl, 'https://drive.google.com/file/d/1FileArchiveID/view');

  // 4. Open with ID URL
  const openInfo = googleDriveAdapter.resolve('https://drive.google.com/open?id=1OpenId123');
  assert.equal(openInfo.sourceChapterId, '1OpenId123');
  assert.equal(openInfo.normalizedUrl, 'https://drive.google.com/open?id=1OpenId123');

  // 5. Invalid URL throws
  assert.throws(() => {
    googleDriveAdapter.resolve('https://drive.google.com/invalid/path/without/id');
  }, /Invalid Google Drive link/);
});

test('electron/googleDriveClient: parseDriveUrl extracts resources and keys accurately', () => {
  const f = parseDriveUrl('https://drive.google.com/drive/u/0/folders/folder_123_abc?resourcekey=key_xyz');
  assert.ok(f);
  assert.equal(f.resourceId, 'folder_123_abc');
  assert.equal(f.resourceType, 'folder');
  assert.equal(f.resourceKey, 'key_xyz');

  const file = parseDriveUrl('https://drive.google.com/file/d/archive_file_789/view?usp=sharing');
  assert.ok(file);
  assert.equal(file.resourceId, 'archive_file_789');
  assert.equal(file.resourceType, 'file');

  const invalid = parseDriveUrl('https://other.com/file/d/123');
  assert.equal(invalid, null);
});

test('sourceRegistry: automatically resolves Google Drive URLs to googleDriveAdapter', () => {
  const resolved = sourceRegistry.resolve('https://drive.google.com/drive/folders/1OfficialFolderId');
  assert.equal(resolved.adapter.id, 'googledrive');
  assert.equal(resolved.adapter.name, 'Google Drive');
  assert.equal(resolved.info.sourceChapterId, '1OfficialFolderId');
});

test('Downstream Compatibility: Google Drive chapter pages cleanly import into Workspace', async () => {
  setupMockIndexedDb();

  const pages: ChapterPage[] = [
    {
      id: 'gdrive-p1',
      originalIndex: 1,
      filename: '001.png',
      mimeType: 'image/png',
      extension: 'png',
      sizeBytes: TINY_PNG.length,
      imageUrl: 'https://www.googleapis.com/drive/v3/files/sample1?alt=media',
      downloadStatus: 'ready',
    },
    {
      id: 'gdrive-p2',
      originalIndex: 2,
      filename: '002.png',
      mimeType: 'image/png',
      extension: 'png',
      sizeBytes: TINY_PNG.length,
      imageUrl: 'https://www.googleapis.com/drive/v3/files/sample2?alt=media',
      downloadStatus: 'ready',
    },
  ];

  const imageMap = new Map<string, DownloadedImageData>([
    ['gdrive-p1', { data: TINY_PNG, mimeType: 'image/png', extension: 'png', sizeBytes: TINY_PNG.length }],
    ['gdrive-p2', { data: TINY_PNG, mimeType: 'image/png', extension: 'png', sizeBytes: TINY_PNG.length }],
  ]);

  const targetFolder: Folder = {
    id: 'test-folder-1',
    name: 'Manga Project',
    badgeCount: 0,
    createdAt: Date.now(),
    chapters: [],
    isDraft: false,
  };

  let updatedFolders: Folder[] = [targetFolder];
  const setFolders = (action: any) => {
    updatedFolders = typeof action === 'function' ? action(updatedFolders) : action;
  };

  let openedChapterId: string | null = null;
  const openChapter = (id: string) => {
    openedChapterId = id;
  };

  const importResult = await ChapterWorkspaceImporter.importPagesToWorkspace({
    selectedPages: pages,
    imageMap,
    metadata: {
      source: 'googledrive',
      sourceChapterId: 'folder_abc_123',
      seriesTitle: 'Tower of God',
      chapterNumber: '420',
      chapterTitle: 'Chapter 420',
      sourceUrl: 'https://drive.google.com/drive/folders/folder_abc_123',
      pageCount: 2,
    },
    targetFolder,
    folders: updatedFolders,
    setFolders,
    openChapter,
  });

  assert.equal(importResult.success, true);
  assert.equal(importResult.pageCount, 2);
  assert.equal(importResult.chapterName, 'Chapter 420 — Chapter 420');

  const f = updatedFolders.find((x) => x.id === 'test-folder-1');
  assert.ok(f);
  assert.equal(f.chapters.length, 1);
  assert.equal(f.chapters[0].pages, 2);
  assert.equal(f.chapters[0].pageList?.[0].index, 1);
  assert.equal(f.chapters[0].pageList?.[1].index, 2);
  assert.equal(openedChapterId, f.chapters[0].id);
});

test('Downstream Compatibility: Google Drive pages export to spec-compliant ZIP archive', () => {
  const entries = [
    { filename: '001.png', data: TINY_PNG },
    { filename: '002.png', data: TINY_PNG },
  ];

  const zipBytes = ChapterZipExporter.createZip(entries);
  assert.ok(zipBytes.length > 50, 'ZIP bytes must be generated');

  // Verify ZIP End of Central Directory signature (0x06054b50)
  ChapterZipExporter.verifyArchive(zipBytes, 2);
});

test('Security Guard: Archive extraction rejects Zip Slip directory traversal', async () => {
  const tmpDir = path.join(os.tmpdir(), `test-zipslip-${Date.now()}`);
  fs.mkdirSync(tmpDir, { recursive: true });

  const testZipPath = path.join(tmpDir, 'malicious.zip');
  const destDir = path.join(tmpDir, 'extracted');

  // Create an archive with directory traversal path
  const maliciousEntries = [
    { filename: '../../escape.png', data: Buffer.from(TINY_PNG) },
  ];

  const zipBuf = createZipBuffer(maliciousEntries);
  fs.writeFileSync(testZipPath, zipBuf);

  try {
    await assert.rejects(
      async () => {
        await extractArchive(testZipPath, destDir);
      },
      /Security Exception|directory traversal|invalid relative path/
    );
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('googleDriveAuthManager: dynamic credential storage and pre-flight validation', async () => {
  // Clear any default or previously set client ID for testing isolation
  googleDriveAuthManager.setClientId('');
  assert.equal(googleDriveAuthManager.hasValidClientId(), false);

  // 2. Sample or invalid client ID rejection
  googleDriveAuthManager.setClientId('1054321689254-folioscriptsampleclientid.apps.googleusercontent.com');
  assert.equal(googleDriveAuthManager.hasValidClientId(), false);

  googleDriveAuthManager.setClientId('invalid_client_id_without_domain');
  assert.equal(googleDriveAuthManager.hasValidClientId(), false);

  // 3. Pre-flight rejection on authenticate()
  await assert.rejects(
    async () => {
      await googleDriveAuthManager.authenticate();
    },
    /NO_CLIENT_ID_CONFIGURED/
  );

  // 4. Valid client ID format acceptance
  googleDriveAuthManager.setClientId('1234567890-abcdefg123456.apps.googleusercontent.com');
  assert.equal(googleDriveAuthManager.hasValidClientId(), true);
  assert.equal(googleDriveAuthManager.getClientId(), '1234567890-abcdefg123456.apps.googleusercontent.com');

  // 5. API key set and get
  googleDriveAuthManager.setApiKey('AIzaSyCustomTestApiKey123');
  assert.equal(googleDriveAuthManager.getApiKey(), 'AIzaSyCustomTestApiKey123');

  // 6. Auth state reflects configuration
  const state = googleDriveAuthManager.getAuthState();
  assert.equal(state.hasClientId, true);
  assert.equal(state.clientId, '1234567890-abcdefg123456.apps.googleusercontent.com');

  // Cleanup back to empty
  googleDriveAuthManager.setClientId('');
  googleDriveAuthManager.setApiKey('');
});
