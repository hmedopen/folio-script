const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
let electron = null;
try {
  electron = require('electron');
} catch {
  electron = null;
}

// Official application-managed Desktop OAuth Client ID and Secret for Folio Script
const DEFAULT_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const DEFAULT_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || '';
const GOOGLE_AUTH_SCOPE = 'https://www.googleapis.com/auth/drive.readonly';
const GOOGLE_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const GOOGLE_AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';

class GoogleDriveAuthManager {
  constructor() {
    this.cachedTokens = null;
    this.vaultPath = null;
    this.configPath = null;
    this.cachedConfig = null;
  }

  getConfigPath() {
    if (!this.configPath) {
      const userData = electron?.app?.getPath('userData') || process.cwd();
      const authDir = path.join(userData, 'auth');
      fs.mkdirSync(authDir, { recursive: true });
      this.configPath = path.join(authDir, 'google_drive_config.enc');
    }
    return this.configPath;
  }

  loadConfig() {
    if (this.cachedConfig) return this.cachedConfig;
    const cfgPath = this.getConfigPath();
    if (!fs.existsSync(cfgPath)) {
      this.cachedConfig = { clientId: '', apiKey: '' };
      return this.cachedConfig;
    }
    try {
      let jsonStr;
      if (electron?.safeStorage?.isEncryptionAvailable()) {
        const buffer = fs.readFileSync(cfgPath);
        jsonStr = electron.safeStorage.decryptString(buffer);
      } else {
        const b64 = fs.readFileSync(cfgPath, 'utf8');
        jsonStr = Buffer.from(b64, 'base64').toString('utf8');
      }
      this.cachedConfig = JSON.parse(jsonStr);
      return this.cachedConfig;
    } catch {
      this.cachedConfig = { clientId: '', apiKey: '' };
      return this.cachedConfig;
    }
  }

  saveConfig(cfg) {
    this.cachedConfig = { ...this.loadConfig(), ...cfg };
    const jsonStr = JSON.stringify(this.cachedConfig);
    const cfgPath = this.getConfigPath();
    if (electron?.safeStorage?.isEncryptionAvailable()) {
      const encrypted = electron.safeStorage.encryptString(jsonStr);
      fs.writeFileSync(cfgPath, encrypted);
    } else {
      const b64 = Buffer.from(jsonStr, 'utf8').toString('base64');
      fs.writeFileSync(cfgPath, b64, 'utf8');
    }
  }

  getClientId() {
    if (process.env.FOLIO_GOOGLE_CLIENT_ID) {
      return process.env.FOLIO_GOOGLE_CLIENT_ID.trim();
    }
    const cfg = this.loadConfig();
    if (cfg.clientId !== undefined && cfg.clientId !== null) {
      return cfg.clientId.trim();
    }
    return DEFAULT_CLIENT_ID.trim();
  }

  getClientSecret() {
    if (process.env.FOLIO_GOOGLE_CLIENT_SECRET) {
      return process.env.FOLIO_GOOGLE_CLIENT_SECRET.trim();
    }
    const cfg = this.loadConfig();
    if (cfg.clientSecret !== undefined && cfg.clientSecret !== null && cfg.clientSecret !== '') {
      return cfg.clientSecret.trim();
    }
    return DEFAULT_CLIENT_SECRET.trim();
  }

  setClientSecret(clientSecret) {
    const sanitized = typeof clientSecret === 'string' ? clientSecret.trim() : '';
    this.saveConfig({ clientSecret: sanitized });
    return { success: true, clientSecret: sanitized };
  }

  setClientId(clientId) {
    const sanitized = typeof clientId === 'string' ? clientId.trim() : '';
    this.saveConfig({ clientId: sanitized });
    return { success: true, clientId: sanitized };
  }

  getApiKey() {
    if (process.env.FOLIO_GOOGLE_API_KEY) {
      return process.env.FOLIO_GOOGLE_API_KEY.trim();
    }
    const cfg = this.loadConfig();
    return (cfg.apiKey || '').trim();
  }

  setApiKey(apiKey) {
    const sanitized = typeof apiKey === 'string' ? apiKey.trim() : '';
    this.saveConfig({ apiKey: sanitized });
    return { success: true, apiKey: sanitized };
  }

  hasValidClientId() {
    const id = this.getClientId();
    if (!id) return false;
    if (id.includes('sampleclientid') || id.includes('example')) return false;
    return id.endsWith('.apps.googleusercontent.com') && id.includes('-');
  }

  getVaultPath() {
    if (!this.vaultPath) {
      const userData = electron?.app?.getPath('userData') || process.cwd();
      const authDir = path.join(userData, 'auth');
      fs.mkdirSync(authDir, { recursive: true });
      this.vaultPath = path.join(authDir, 'google_drive_vault.enc');
    }
    return this.vaultPath;
  }

  /**
   * Encrypts and writes tokens to disk using OS-backed Electron safeStorage.
   */
  saveTokens(tokens) {
    this.cachedTokens = { ...tokens, savedAt: Date.now() };
    const jsonStr = JSON.stringify(this.cachedTokens);
    const vaultFile = this.getVaultPath();

    if (electron?.safeStorage?.isEncryptionAvailable()) {
      const encrypted = electron.safeStorage.encryptString(jsonStr);
      fs.writeFileSync(vaultFile, encrypted);
    } else {
      // Fallback for non-GUI or dev test environments
      const b64 = Buffer.from(jsonStr, 'utf8').toString('base64');
      fs.writeFileSync(vaultFile, b64, 'utf8');
    }
  }

  /**
   * Reads and decrypts stored tokens from disk.
   */
  loadTokens() {
    if (this.cachedTokens) return this.cachedTokens;
    const vaultFile = this.getVaultPath();
    if (!fs.existsSync(vaultFile)) return null;

    try {
      const raw = fs.readFileSync(vaultFile);
      let jsonStr;
      if (electron?.safeStorage?.isEncryptionAvailable()) {
        jsonStr = electron.safeStorage.decryptString(raw);
      } else {
        jsonStr = Buffer.from(raw.toString('utf8'), 'base64').toString('utf8');
      }
      this.cachedTokens = JSON.parse(jsonStr);
      return this.cachedTokens;
    } catch (e) {
      console.warn('[GoogleDriveAuth] Failed to load saved auth tokens:', e);
      return null;
    }
  }

  /**
   * Returns public authentication status for renderer (no secrets exposed).
   */
  getAuthState() {
    const tokens = this.loadTokens();
    const hasClient = this.hasValidClientId();
    const clientId = this.getClientId();
    if (!tokens || !tokens.access_token) {
      return {
        isAuthenticated: false,
        userEmail: null,
        hasClientId: hasClient,
        clientId,
      };
    }
    return {
      isAuthenticated: true,
      userEmail: tokens.userEmail || 'Google Account',
      hasClientId: hasClient,
      clientId,
    };
  }

  /**
   * Clears tokens and signs out.
   */
  signOut() {
    this.cachedTokens = null;
    const vaultFile = this.getVaultPath();
    if (fs.existsSync(vaultFile)) {
      try {
        fs.unlinkSync(vaultFile);
      } catch {}
    }
    return { success: true };
  }

  /**
   * Returns a valid access token, auto-refreshing if expired.
   */
  async getValidAccessToken() {
    const tokens = this.loadTokens();
    if (!tokens || !tokens.access_token) {
      throw new Error('Not authenticated with Google Drive. Please sign in first.');
    }

    const expiresAt = tokens.savedAt + (tokens.expires_in || 3600) * 1000;
    // If token has at least 2 minutes left, reuse it
    if (Date.now() < expiresAt - 120 * 1000) {
      return tokens.access_token;
    }

    // Refresh token if available
    if (tokens.refresh_token) {
      try {
        const refreshed = await this.refreshAccessToken(tokens.refresh_token);
        this.saveTokens({
          ...tokens,
          access_token: refreshed.access_token,
          expires_in: refreshed.expires_in,
        });
        return refreshed.access_token;
      } catch (err) {
        console.warn('[GoogleDriveAuth] Token refresh failed:', err);
        throw new Error('Google Drive session expired. Please sign in again.');
      }
    }

    return tokens.access_token;
  }

  /**
   * Refreshes an expired access token using the refresh token.
   */
  async refreshAccessToken(refreshToken) {
    const clientId = this.getClientId();
    if (!clientId) {
      throw new Error('No Google Client ID configured.');
    }

    const clientSecret = this.getClientSecret();
    const bodyParams = new URLSearchParams({
      client_id: clientId,
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    });
    if (clientSecret) {
      bodyParams.set('client_secret', clientSecret);
    }

    const response = await fetch(GOOGLE_TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: bodyParams.toString(),
    });

    if (!response.ok) {
      const errJson = await response.json().catch(() => ({}));
      throw new Error(errJson.error_description || `Refresh failed with status ${response.status}`);
    }

    return await response.json();
  }

  /**
   * Initiates RFC 8252 loopback sign-in in the user's default browser with PKCE.
   */
  authenticate() {
    return new Promise((resolve, reject) => {
      const clientId = this.getClientId();
      if (!this.hasValidClientId()) {
        return reject(
          new Error('NO_CLIENT_ID_CONFIGURED: A valid Google Cloud Desktop Client ID (*.apps.googleusercontent.com) is required.')
        );
      }

      // 1. Generate PKCE code verifier and challenge
      const codeVerifier = crypto.randomBytes(48).toString('base64url');
      const codeChallenge = crypto
        .createHash('sha256')
        .update(codeVerifier)
        .digest('base64url');
      const state = crypto.randomBytes(24).toString('hex');

      // 2. Start ephemeral loopback server on port 0 (OS chooses unused port)
      const server = http.createServer();
      server.listen(0, '127.0.0.1', () => {
        const address = server.address();
        const port = address.port;
        const redirectUri = `http://127.0.0.1:${port}/oauth2callback`;

        // 3. Assemble Google OAuth URL
        const authUrl = new URL(GOOGLE_AUTH_ENDPOINT);
        authUrl.searchParams.set('client_id', clientId);
        authUrl.searchParams.set('redirect_uri', redirectUri);
        authUrl.searchParams.set('response_type', 'code');
        authUrl.searchParams.set('scope', GOOGLE_AUTH_SCOPE);
        authUrl.searchParams.set('code_challenge', codeChallenge);
        authUrl.searchParams.set('code_challenge_method', 'S256');
        authUrl.searchParams.set('state', state);
        authUrl.searchParams.set('access_type', 'offline');
        authUrl.searchParams.set('prompt', 'consent');

        let timeoutHandle = null;

        const cleanup = () => {
          if (timeoutHandle) clearTimeout(timeoutHandle);
          try {
            server.close();
          } catch {}
        };

        // 5-minute timeout for user authentication
        timeoutHandle = setTimeout(() => {
          cleanup();
          reject(new Error('Google Drive sign-in timed out. Please try again.'));
        }, 5 * 60 * 1000);

        // 4. Handle redirect callback
        server.on('request', async (req, res) => {
          const reqUrl = new URL(req.url, `http://127.0.0.1:${port}`);
          if (reqUrl.pathname !== '/oauth2callback') {
            res.writeHead(404);
            res.end();
            return;
          }

          const callbackCode = reqUrl.searchParams.get('code');
          const callbackState = reqUrl.searchParams.get('state');
          const callbackError = reqUrl.searchParams.get('error');

          if (callbackError) {
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(this.getHtmlFeedback('Sign-in Cancelled', 'Google sign-in was cancelled or declined.', false));
            cleanup();
            return reject(new Error(`Google sign-in was declined: ${callbackError}`));
          }

          if (!callbackCode || callbackState !== state) {
            res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(this.getHtmlFeedback('Security Error', 'Invalid or tampered authorization state.', false));
            cleanup();
            return reject(new Error('Security error: OAuth state verification mismatch.'));
          }

          // Exchange authorization code for tokens
          try {
            const clientSecret = this.getClientSecret();
            const tokenParams = new URLSearchParams({
              client_id: clientId,
              code: callbackCode,
              code_verifier: codeVerifier,
              grant_type: 'authorization_code',
              redirect_uri: redirectUri,
            });
            if (clientSecret) {
              tokenParams.set('client_secret', clientSecret);
            }

            const tokenResp = await fetch(GOOGLE_TOKEN_ENDPOINT, {
              method: 'POST',
              headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
              body: tokenParams.toString(),
            });

            if (!tokenResp.ok) {
              const errBody = await tokenResp.json().catch(() => ({}));
              throw new Error(errBody.error_description || `Token exchange error (${tokenResp.status})`);
            }

            const tokenData = await tokenResp.json();

            // Decode user email from id_token if available
            let userEmail = 'Google Account';
            if (tokenData.id_token) {
              try {
                const parts = tokenData.id_token.split('.');
                if (parts.length >= 2) {
                  const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString('utf8'));
                  if (payload.email) userEmail = payload.email;
                }
              } catch {}
            }

            this.saveTokens({
              ...tokenData,
              userEmail,
            });

            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(
              this.getHtmlFeedback(
                'Signed In Successfully',
                `Connected as <strong>${userEmail}</strong>. You may now close this browser tab and return to Folio Script.`,
                true
              )
            );

            cleanup();
            resolve({ success: true, userEmail });
          } catch (exchangeErr) {
            res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(this.getHtmlFeedback('Token Error', exchangeErr.message, false));
            cleanup();
            reject(exchangeErr);
          }
        });

        // 5. Open system browser
        if (electron?.shell?.openExternal) {
          electron.shell.openExternal(authUrl.toString());
        } else {
          console.log(`[GoogleDriveAuth] Open browser URL: ${authUrl.toString()}`);
        }
      });

      server.on('error', (sErr) => {
        reject(new Error(`Failed to bind local loopback port for authentication: ${sErr.message}`));
      });
    });
  }

  getHtmlFeedback(title, message, isSuccess) {
    const accentColor = isSuccess ? '#10b981' : '#f43f5e';
    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Folio Script — Google Drive Authentication</title>
  <style>
    body {
      background-color: #0c0d12;
      color: #f4f4f5;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      display: flex;
      align-items: center;
      justify-content: center;
      height: 100vh;
      margin: 0;
    }
    .card {
      background-color: #18181b;
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 16px;
      padding: 32px;
      max-width: 420px;
      text-align: center;
      box-shadow: 0 20px 40px rgba(0, 0, 0, 0.5);
    }
    h2 { margin: 0 0 12px; font-size: 18px; color: ${accentColor}; font-weight: 600; }
    p { margin: 0; font-size: 14px; color: #a1a1aa; line-height: 1.5; }
    strong { color: #ffffff; }
  </style>
</head>
<body>
  <div class="card">
    <h2>${title}</h2>
    <p>${message}</p>
  </div>
</body>
</html>`;
  }
}

const googleDriveAuthManager = new GoogleDriveAuthManager();

module.exports = {
  googleDriveAuthManager,
  GoogleDriveAuthManager,
  GOOGLE_AUTH_SCOPE,
};
