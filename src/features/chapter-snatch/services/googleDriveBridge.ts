/**
 * Unified Google Drive Bridge
 * Automatically uses Electron IPC when inside the desktop application,
 * and gracefully falls back to local HTTP server API when in browser mode.
 */

export interface GoogleDriveAuthState {
  isAuthenticated: boolean;
  userEmail: string | null;
  hasClientId: boolean;
  clientId: string;
}

export const googleDriveBridge = {
  async getAuthState(): Promise<GoogleDriveAuthState> {
    const win = typeof window !== 'undefined' ? (window as any) : undefined;
    if (win?.folioScript?.googleDrive?.getAuthState) {
      return await win.folioScript.googleDrive.getAuthState();
    }
    const res = await fetch('/api/google-drive/auth-state');
    if (!res.ok) {
      return { isAuthenticated: false, userEmail: null, hasClientId: false, clientId: '' };
    }
    return await res.json();
  },

  async authenticate(): Promise<{ success: boolean; userEmail: string }> {
    const win = typeof window !== 'undefined' ? (window as any) : undefined;
    if (win?.folioScript?.googleDrive?.authenticate) {
      return await win.folioScript.googleDrive.authenticate();
    }
    const res = await fetch('/api/google-drive/authenticate');
    const data = await res.json();
    if (!res.ok || data.error) {
      throw new Error(data.error || 'Authentication failed or was cancelled.');
    }
    return data;
  },

  async signOut(): Promise<{ success: boolean }> {
    const win = typeof window !== 'undefined' ? (window as any) : undefined;
    if (win?.folioScript?.googleDrive?.signOut) {
      return await win.folioScript.googleDrive.signOut();
    }
    const res = await fetch('/api/google-drive/sign-out', { method: 'POST' });
    return await res.json();
  },

  async getClientId(): Promise<string> {
    const win = typeof window !== 'undefined' ? (window as any) : undefined;
    if (win?.folioScript?.googleDrive?.getClientId) {
      return await win.folioScript.googleDrive.getClientId();
    }
    const res = await fetch('/api/google-drive/get-client-id');
    const data = await res.json();
    return data.clientId || '';
  },

  async setClientId(clientId: string): Promise<{ success: boolean; clientId: string }> {
    const win = typeof window !== 'undefined' ? (window as any) : undefined;
    if (win?.folioScript?.googleDrive?.setClientId) {
      return await win.folioScript.googleDrive.setClientId(clientId);
    }
    const res = await fetch(`/api/google-drive/set-client-id?clientId=${encodeURIComponent(clientId)}`, {
      method: 'POST',
    });
    return await res.json();
  },

  async getApiKey(): Promise<string> {
    const win = typeof window !== 'undefined' ? (window as any) : undefined;
    if (win?.folioScript?.googleDrive?.getApiKey) {
      return await win.folioScript.googleDrive.getApiKey();
    }
    const res = await fetch('/api/google-drive/get-api-key');
    const data = await res.json();
    return data.apiKey || '';
  },

  async setApiKey(apiKey: string): Promise<{ success: boolean; apiKey: string }> {
    const win = typeof window !== 'undefined' ? (window as any) : undefined;
    if (win?.folioScript?.googleDrive?.setApiKey) {
      return await win.folioScript.googleDrive.setApiKey(apiKey);
    }
    const res = await fetch(`/api/google-drive/set-api-key?apiKey=${encodeURIComponent(apiKey)}`, {
      method: 'POST',
    });
    return await res.json();
  },

  async listExplorerDirectory(folderId: string = 'root'): Promise<any> {
    const win = typeof window !== 'undefined' ? (window as any) : undefined;
    if (win?.folioScript?.googleDrive?.listExplorerDirectory) {
      return await win.folioScript.googleDrive.listExplorerDirectory(folderId);
    }
    const res = await fetch(`/api/google-drive/list-explorer?folderId=${encodeURIComponent(folderId)}`);
    const data = await res.json();
    if (!res.ok || data.error) {
      throw new Error(data.error || 'Failed to list directory');
    }
    return data;
  },
};
