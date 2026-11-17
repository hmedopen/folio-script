const http = require('http');
const fs = require('fs');
const path = require('path');
const {
  fetchMetadata,
  downloadPageImage,
} = require('./electron/chapterSnatchBackend.cjs');
const { googleDriveAuthManager } = require('./electron/googleDriveAuth.cjs');
const { listExplorerDirectory } = require('./electron/googleDriveClient.cjs');
const { createModelManager, isValidModelId } = require('./electron/modelManager.cjs');

const userDataDir = process.env.APPDATA
  ? path.join(process.env.APPDATA, 'Folio Script')
  : path.join(process.env.HOME || '', '.folio-script');
const modelManager = createModelManager({ userDataDir, isProduction: false });

const PORT = 5173;
const DIST_DIR = path.join(__dirname, 'dist');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

const server = http.createServer(async (req, res) => {
  const urlObj = new URL(req.url, `http://${req.headers.host || '127.0.0.1:5173'}`);

  // Handle Chapter Snatch Backend APIs (zero CORS, honest User-Agent, SSRF-guarded)
  if (urlObj.pathname === '/api/chapter-snatch/metadata') {
    const targetUrl = urlObj.searchParams.get('url');
    if (!targetUrl) {
      res.writeHead(400, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ error: 'Missing "url" parameter.' }));
      return;
    }
    try {
      const data = await fetchMetadata(targetUrl);
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify(data));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ error: err.message || 'Failed to fetch chapter metadata.' }));
    }
    return;
  }

  if (urlObj.pathname === '/api/chapter-snatch/download-page') {
    const imageUrl = urlObj.searchParams.get('url');
    const referer = urlObj.searchParams.get('referer') || undefined;
    const acquisitionId = urlObj.searchParams.get('acquisitionId') || undefined;
    const filename = urlObj.searchParams.get('filename') || undefined;
    if (!imageUrl) {
      res.writeHead(400, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ error: 'Missing "url" parameter.' }));
      return;
    }
    try {
      const data = await downloadPageImage(imageUrl, referer, { acquisitionId, filename });
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify(data));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ error: err.message || 'Failed to download page image.' }));
    }
    return;
  }

  // Handle Google Drive Importer APIs (Zero-Electron in-browser fallback)
  if (urlObj.pathname === '/api/google-drive/auth-state') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify(googleDriveAuthManager.getAuthState()));
    return;
  }

  if (urlObj.pathname === '/api/google-drive/authenticate') {
    try {
      const authResult = await googleDriveAuthManager.authenticate();
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify(authResult));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ error: err.message || 'Authentication failed' }));
    }
    return;
  }

  if (urlObj.pathname === '/api/google-drive/sign-out') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify(googleDriveAuthManager.signOut()));
    return;
  }

  if (urlObj.pathname === '/api/google-drive/get-client-id') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify({ clientId: googleDriveAuthManager.getClientId() }));
    return;
  }

  if (urlObj.pathname === '/api/google-drive/set-client-id') {
    const clientId = urlObj.searchParams.get('clientId') || '';
    const result = googleDriveAuthManager.setClientId(clientId);
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify(result));
    return;
  }

  if (urlObj.pathname === '/api/google-drive/get-api-key') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify({ apiKey: googleDriveAuthManager.getApiKey() }));
    return;
  }

  if (urlObj.pathname === '/api/google-drive/set-api-key') {
    const apiKey = urlObj.searchParams.get('apiKey') || '';
    const result = googleDriveAuthManager.setApiKey(apiKey);
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify(result));
    return;
  }

  if (urlObj.pathname === '/api/google-drive/list-explorer') {
    try {
      const folderId = urlObj.searchParams.get('folderId') || 'root';
      const items = await listExplorerDirectory(folderId);
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify(items));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ error: err.message || 'Failed to list directory' }));
    }
    return;
  }

  // Handle Local OCR Model Management APIs (Zero-Electron in-browser fallback)
  if (urlObj.pathname === '/api/local-models/manifest') {
    try {
      const manifest = modelManager.getManifest();
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify(manifest));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ error: err.message || 'Failed to get manifest' }));
    }
    return;
  }

  if (urlObj.pathname === '/api/local-models/status') {
    try {
      const modelId = urlObj.searchParams.get('modelId') || undefined;
      if (modelId && !isValidModelId(modelId)) {
        res.writeHead(400, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ error: 'Invalid modelId' }));
        return;
      }
      const status = await modelManager.getModelStatus(modelId);
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify(status));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ error: err.message || 'Failed to get status' }));
    }
    return;
  }

  if (urlObj.pathname === '/api/local-models/assets') {
    try {
      const modelId = urlObj.searchParams.get('modelId');
      if (!modelId || !isValidModelId(modelId)) {
        res.writeHead(400, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ error: 'Missing or invalid modelId parameter' }));
        return;
      }
      const assets = await modelManager.readModelAssets(modelId);
      const filesBase64 = {};
      for (const [relPath, uint8] of Object.entries(assets.files)) {
        filesBase64[relPath] = Buffer.from(uint8).toString('base64');
      }
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({
        modelId: assets.modelId,
        revisionLabel: assets.revisionLabel,
        filesBase64,
      }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ error: err.message || 'Failed to read model assets' }));
    }
    return;
  }

  if (urlObj.pathname === '/api/local-models/download' && req.method === 'POST') {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', async () => {
      try {
        const payload = JSON.parse(body || '{}');
        const modelId = payload.modelId;
        if (!modelId || !isValidModelId(modelId)) {
          res.writeHead(400, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
          res.end(JSON.stringify({ error: 'Invalid modelId' }));
          return;
        }
        const status = await modelManager.downloadModel(modelId);
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify(status));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ error: err.message || 'Download failed' }));
      }
    });
    return;
  }

  if (urlObj.pathname === '/api/local-models/remove' && req.method === 'POST') {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', async () => {
      try {
        const payload = JSON.parse(body || '{}');
        const modelId = payload.modelId;
        if (!modelId || !isValidModelId(modelId)) {
          res.writeHead(400, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
          res.end(JSON.stringify({ error: 'Invalid modelId' }));
          return;
        }
        const status = await modelManager.removeModel(modelId);
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify(status));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ error: err.message || 'Remove failed' }));
      }
    });
    return;
  }

  // Static File Serving
  let reqPath = decodeURI(urlObj.pathname);
  if (reqPath === '/') reqPath = '/index.html';

  let filePath = path.join(DIST_DIR, reqPath);

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      filePath = path.join(DIST_DIR, 'index.html');
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    fs.readFile(filePath, (readErr, content) => {
      if (readErr) {
        res.writeHead(500);
        res.end('Server Error');
        return;
      }
      res.writeHead(200, {
        'Content-Type': contentType,
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0',
      });
      res.end(content);
    });
  });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Folio Script core active on http://127.0.0.1:${PORT}`);
});
