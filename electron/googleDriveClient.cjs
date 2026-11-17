const fs = require('fs');
const path = require('path');
const { googleDriveAuthManager } = require('./googleDriveAuth.cjs');

const DRIVE_API_BASE = 'https://www.googleapis.com/drive/v3';

// Dynamically resolves public Google Drive API key from config or env
function getPublicDriveApiKey() {
  try {
    return googleDriveAuthManager.getApiKey() || process.env.FOLIO_GOOGLE_API_KEY || '';
  } catch {
    return process.env.FOLIO_GOOGLE_API_KEY || '';
  }
}

/**
 * Parses and normalizes various Google Drive URL patterns.
 * Extracts resource ID, resource type hint, and security resourceKey.
 */
function parseDriveUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') return null;
  const trimmed = rawUrl.trim();

  let parsed;
  try {
    parsed = new URL(trimmed.includes('://') ? trimmed : `https://${trimmed}`);
  } catch {
    return null;
  }

  const hostname = parsed.hostname.toLowerCase();
  if (hostname !== 'drive.google.com' && hostname !== 'docs.google.com') {
    return null;
  }

  const pathname = parsed.pathname;
  const resourceKey = parsed.searchParams.get('resourcekey') || undefined;

  // 1. Folders: /drive/folders/{id} or /drive/u/0/folders/{id}
  const folderMatch = pathname.match(/\/drive\/(?:u\/\d+\/)?folders\/([a-zA-Z0-9_-]+)/);
  if (folderMatch) {
    return {
      resourceId: folderMatch[1],
      resourceType: 'folder',
      resourceKey,
      originalUrl: trimmed,
    };
  }

  // 2. Files: /file/d/{id}/view or /file/d/{id}/edit
  const fileMatch = pathname.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
  if (fileMatch) {
    return {
      resourceId: fileMatch[1],
      resourceType: 'file',
      resourceKey,
      originalUrl: trimmed,
    };
  }

  // 3. Query based: /open?id={id} or /uc?id={id}
  const idParam = parsed.searchParams.get('id');
  if (idParam && /^[a-zA-Z0-9_-]+$/.test(idParam)) {
    return {
      resourceId: idParam,
      resourceType: 'unknown',
      resourceKey,
      originalUrl: trimmed,
    };
  }

  return null;
}

/**
 * Builds standard Google Drive request headers including Auth & Resource Keys.
 */
async function buildHeaders(resourceId, resourceKey) {
  const headers = {
    'User-Agent': 'FolioScript-ChapterFetcher/1.0',
    'Accept': 'application/json',
  };

  try {
    const token = await googleDriveAuthManager.getValidAccessToken();
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
  } catch {
    // Unauthenticated: will proceed with public access or API key
  }

  if (resourceKey && resourceId) {
    headers['X-Goog-Drive-Resource-Keys'] = `${resourceId}/${resourceKey}`;
  }

  return headers;
}

/**
 * Retrieves metadata for a specific Drive file or folder.
 */
async function getFileMetadata(fileId, resourceKey) {
  const headers = await buildHeaders(fileId, resourceKey);
  const url = new URL(`${DRIVE_API_BASE}/files/${fileId}`);
  url.searchParams.set('fields', 'id,name,mimeType,size,resourceKey,capabilities(canDownload)');
  url.searchParams.set('supportsAllDrives', 'true');

  const apiKey = getPublicDriveApiKey();
  if (!headers['Authorization'] && apiKey) {
    url.searchParams.set('key', apiKey);
  }

  const resp = await fetch(url.toString(), { headers });

  if (resp.status === 401 || resp.status === 403) {
    const errBody = await resp.json().catch(() => ({}));
    if (errBody?.error?.errors?.[0]?.reason === 'downloadQuotaExceeded') {
      throw new Error('Google Drive download quota exceeded for this item. Please try again later.');
    }
    throw new Error('Access denied. Authentication required to view this Google Drive item.');
  }

  if (resp.status === 404) {
    throw new Error('Item not found on Google Drive. It may have been deleted or moved.');
  }

  if (!resp.ok) {
    throw new Error(`Google Drive API error: HTTP ${resp.status}`);
  }

  return await resp.json();
}

/**
 * Enumerates all files within a Google Drive folder, handling pagination.
 */
async function listFolderFiles(folderId, resourceKey) {
  const headers = await buildHeaders(folderId, resourceKey);
  const allFiles = [];
  let pageToken = undefined;

  do {
    const url = new URL(`${DRIVE_API_BASE}/files`);
    url.searchParams.set('q', `'${folderId}' in parents and trashed = false`);
    url.searchParams.set(
      'fields',
      'nextPageToken, files(id, name, mimeType, size, thumbnailLink, webContentLink, resourceKey)'
    );
    url.searchParams.set('pageSize', '100');
    url.searchParams.set('supportsAllDrives', 'true');
    url.searchParams.set('includeItemsFromAllDrives', 'true');
    if (pageToken) url.searchParams.set('pageToken', pageToken);

    if (!headers['Authorization'] && PUBLIC_DRIVE_API_KEY) {
      url.searchParams.set('key', PUBLIC_DRIVE_API_KEY);
    }

    const resp = await fetch(url.toString(), { headers });

    if (resp.status === 401 || resp.status === 403) {
      throw new Error('Access denied. Sign in to Google Drive to access this folder.');
    }

    if (!resp.ok) {
      throw new Error(`Google Drive API error while listing folder: HTTP ${resp.status}`);
    }

    const data = await resp.json();
    if (data.files && Array.isArray(data.files)) {
      allFiles.push(...data.files);
    }
    pageToken = data.nextPageToken;
  } while (pageToken);

  return allFiles;
}

/**
 * Downloads a file from Google Drive directly to disk via stream.
 */
async function downloadDriveFileToDisk(fileId, destPath, resourceKey) {
  const headers = await buildHeaders(fileId, resourceKey);
  delete headers['Accept']; // Ensure binary stream is accepted

  const url = new URL(`${DRIVE_API_BASE}/files/${fileId}`);
  url.searchParams.set('alt', 'media');
  url.searchParams.set('supportsAllDrives', 'true');

  const apiKey = getPublicDriveApiKey();
  if (!headers['Authorization'] && apiKey) {
    url.searchParams.set('key', apiKey);
  }

  let resp = await fetch(url.toString(), { headers });

  // Fallback for public files if direct alt=media returns 403 without auth
  if (!resp.ok && !headers['Authorization']) {
    const userContentUrl = `https://drive.usercontent.google.com/download?id=${fileId}&export=download&confirm=t`;
    let fallbackResp = await fetch(userContentUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
    });
    if (fallbackResp.ok) {
      resp = fallbackResp;
    } else {
      const fallbackUrl = `https://drive.google.com/uc?export=download&id=${fileId}&confirm=t`;
      fallbackResp = await fetch(fallbackUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
      });
      if (fallbackResp.ok) {
        resp = fallbackResp;
      }
    }
  }

  if (!resp.ok) {
    if (resp.status === 403) {
      throw new Error('Download blocked. Google Drive quota exceeded or authentication required.');
    }
    throw new Error(`Download failed: HTTP ${resp.status}`);
  }

  // Ensure target directory exists
  fs.mkdirSync(path.dirname(destPath), { recursive: true });

  const fileStream = fs.createWriteStream(destPath);

  // If Body is a ReadableStream (fetch response in Node 18+)
  if (resp.body && typeof resp.body.getReader === 'function') {
    const reader = resp.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      fileStream.write(Buffer.from(value));
    }
    fileStream.end();
  } else if (resp.body && typeof resp.body.pipe === 'function') {
    await new Promise((resolve, reject) => {
      resp.body.pipe(fileStream);
      fileStream.on('finish', resolve);
      fileStream.on('error', reject);
    });
  } else {
    // ArrayBuffer fallback
    const buffer = Buffer.from(await resp.arrayBuffer());
    fs.writeFileSync(destPath, buffer);
  }

  return { success: true, filePath: destPath };
}

/**
 * Lists items for the Native Folio Script Drive Explorer.
 * Returns folders, archives (.zip/.cbz), and images in the current directory.
 */
async function listExplorerDirectory(folderId = 'root') {
  const headers = await buildHeaders(folderId);
  const targetId = folderId || 'root';

  const url = new URL(`${DRIVE_API_BASE}/files`);
  url.searchParams.set('q', `'${targetId}' in parents and trashed = false`);
  url.searchParams.set(
    'fields',
    'files(id, name, mimeType, size, modifiedTime, thumbnailLink, capabilities(canDownload))'
  );
  url.searchParams.set('pageSize', '150');
  url.searchParams.set('orderBy', 'folder,name_natural asc');
  url.searchParams.set('supportsAllDrives', 'true');
  url.searchParams.set('includeItemsFromAllDrives', 'true');

  const resp = await fetch(url.toString(), { headers });

  if (resp.status === 401 || resp.status === 403) {
    throw new Error('Google Drive session expired or not authenticated. Please sign in.');
  }

  if (!resp.ok) {
    throw new Error(`Failed to list Drive contents: HTTP ${resp.status}`);
  }

  const data = await resp.json();
  const rawItems = data.files || [];

  const folders = [];
  const archives = [];
  const images = [];

  for (const item of rawItems) {
    const isFolder = item.mimeType === 'application/vnd.google-apps.folder';
    const lowerName = item.name.toLowerCase();
    const isArchive =
      lowerName.endsWith('.zip') ||
      lowerName.endsWith('.cbz') ||
      item.mimeType === 'application/zip' ||
      item.mimeType === 'application/x-zip-compressed' ||
      item.mimeType === 'application/vnd.comicbook+zip';
    const isImage =
      item.mimeType?.startsWith('image/') ||
      lowerName.endsWith('.png') ||
      lowerName.endsWith('.jpg') ||
      lowerName.endsWith('.jpeg') ||
      lowerName.endsWith('.webp');

    if (isFolder) {
      folders.push({
        id: item.id,
        name: item.name,
        type: 'folder',
        modifiedTime: item.modifiedTime,
      });
    } else if (isArchive) {
      archives.push({
        id: item.id,
        name: item.name,
        type: 'archive',
        size: Number(item.size || 0),
        modifiedTime: item.modifiedTime,
      });
    } else if (isImage) {
      images.push({
        id: item.id,
        name: item.name,
        type: 'image',
        size: Number(item.size || 0),
        thumbnailLink: item.thumbnailLink,
      });
    }
  }

  return {
    folderId: targetId,
    folders,
    archives,
    imageCount: images.length,
    hasImages: images.length > 0,
  };
}

module.exports = {
  parseDriveUrl,
  getFileMetadata,
  listFolderFiles,
  downloadDriveFileToDisk,
  listExplorerDirectory,
};
