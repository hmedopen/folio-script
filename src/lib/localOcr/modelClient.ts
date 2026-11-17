import type {
  ModelAssetPayload,
  ModelDownloadProgress,
  ModelStatusInfo,
} from '../../types/localOcr.ts';
import type { LocalModelManifest } from './modelManifest.ts';

export interface LocalModelAssetProvider {
  getManifest: () => Promise<LocalModelManifest>;
  getStatus: (modelId?: string) => Promise<ModelStatusInfo | ModelStatusInfo[]>;
  downloadModel: (modelId: string) => Promise<ModelStatusInfo>;
  cancelDownload: (modelId: string) => Promise<boolean>;
  removeModel: (modelId: string) => Promise<ModelStatusInfo>;
  readModelAssets: (modelId: string) => Promise<ModelAssetPayload>;
  onDownloadProgress?: (listener: (progress: ModelDownloadProgress) => void) => () => void;
}

interface ElectronLocalModelsBridge {
  getManifest: () => Promise<LocalModelManifest>;
  getStatus: (modelId?: string) => Promise<ModelStatusInfo | ModelStatusInfo[]>;
  downloadModel: (modelId: string) => Promise<ModelStatusInfo>;
  cancelDownload: (modelId: string) => Promise<boolean>;
  removeModel: (modelId: string) => Promise<ModelStatusInfo>;
  readModelAssets: (modelId: string) => Promise<ModelAssetPayload>;
  onDownloadProgress: (listener: (progress: ModelDownloadProgress) => void) => () => void;
}

function getElectronBridge(): ElectronLocalModelsBridge | undefined {
  const g = globalThis as {
    window?: { folioScript?: { localModels?: ElectronLocalModelsBridge } };
  };
  return g.window?.folioScript?.localModels;
}

export function createElectronModelAssetProvider(): LocalModelAssetProvider {
  const bridge = getElectronBridge();
  if (!bridge) {
    throw new Error(
      'Local model management bridge (window.folioScript.localModels) is unavailable outside the Electron desktop runtime.'
    );
  }
  return {
    getManifest: () => bridge.getManifest(),
    getStatus: (modelId?: string) => bridge.getStatus(modelId),
    downloadModel: (modelId: string) => bridge.downloadModel(modelId),
    cancelDownload: (modelId: string) => bridge.cancelDownload(modelId),
    removeModel: (modelId: string) => bridge.removeModel(modelId),
    readModelAssets: (modelId: string) => bridge.readModelAssets(modelId),
    onDownloadProgress: (listener) => bridge.onDownloadProgress(listener),
  };
}

export function createHttpModelAssetProvider(baseUrl = ''): LocalModelAssetProvider {
  return {
    getManifest: async () => {
      const res = await fetch(`${baseUrl}/api/local-models/manifest`);
      if (!res.ok) throw new Error('Failed to fetch local model manifest');
      return res.json();
    },
    getStatus: async (modelId?: string) => {
      const q = modelId ? `?modelId=${encodeURIComponent(modelId)}` : '';
      const res = await fetch(`${baseUrl}/api/local-models/status${q}`);
      if (!res.ok) throw new Error('Failed to fetch local model status');
      return res.json();
    },
    downloadModel: async (modelId: string) => {
      const res = await fetch(`${baseUrl}/api/local-models/download`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ modelId }),
      });
      if (!res.ok) throw new Error(`Failed to download model "${modelId}"`);
      return res.json();
    },
    cancelDownload: async (modelId: string) => {
      const res = await fetch(`${baseUrl}/api/local-models/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ modelId }),
      });
      return res.ok;
    },
    removeModel: async (modelId: string) => {
      const res = await fetch(`${baseUrl}/api/local-models/remove`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ modelId }),
      });
      if (!res.ok) throw new Error(`Failed to remove model "${modelId}"`);
      return res.json();
    },
    readModelAssets: async (modelId: string): Promise<ModelAssetPayload> => {
      const res = await fetch(`${baseUrl}/api/local-models/assets?modelId=${encodeURIComponent(modelId)}`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: `Failed to read model assets for "${modelId}"` }));
        throw new Error(err.error || `Failed to read model assets for "${modelId}"`);
      }
      const data = await res.json();
      const files: Record<string, Uint8Array> = {};
      for (const [relPath, b64] of Object.entries(data.filesBase64 as Record<string, string>)) {
        const binStr = atob(b64);
        const bytes = new Uint8Array(binStr.length);
        for (let i = 0; i < binStr.length; i++) {
          bytes[i] = binStr.charCodeAt(i);
        }
        files[relPath] = bytes;
      }
      return {
        modelId: data.modelId,
        revisionLabel: data.revisionLabel,
        files,
      };
    },
  };
}

export function createDefaultModelAssetProvider(): LocalModelAssetProvider | null {
  const bridge = getElectronBridge();
  if (bridge) {
    return createElectronModelAssetProvider();
  }
  if (typeof window !== 'undefined' && typeof fetch === 'function') {
    return createHttpModelAssetProvider();
  }
  return null;
}
