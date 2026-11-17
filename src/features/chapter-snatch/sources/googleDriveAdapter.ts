import type {
  ChapterSourceAdapter,
  ResolvedSourceInfo,
  ChapterManifest,
} from '../core/types';

export class GoogleDriveAdapter implements ChapterSourceAdapter {
  public readonly id = 'googledrive';
  public readonly name = 'Google Drive';

  public readonly allowedSourceHosts = [
    'drive.google.com',
    'docs.google.com',
    'googleapis.com',
    '*.googleapis.com',
  ] as const;

  public readonly allowedImageHosts = [
    'drive.google.com',
    'docs.google.com',
    'googleusercontent.com',
    '*.googleusercontent.com',
    'googleapis.com',
    '*.googleapis.com',
  ] as const;

  public canHandle(url: URL | string): boolean {
    try {
      const u = typeof url === 'string' ? new URL(url.includes('://') ? url : `https://${url}`) : url;
      const host = u.hostname.toLowerCase();
      return host === 'drive.google.com' || host === 'docs.google.com';
    } catch {
      return false;
    }
  }

  public resolve(url: URL | string): ResolvedSourceInfo {
    const u = typeof url === 'string' ? new URL(url.includes('://') ? url : `https://${url}`) : url;
    const pathname = u.pathname;
    const resourceKey = u.searchParams.get('resourcekey') || undefined;

    // 1. Folders: /drive/folders/{id} or /drive/u/0/folders/{id}
    const folderMatch = pathname.match(/\/drive\/(?:u\/\d+\/)?folders\/([a-zA-Z0-9_-]+)/);
    if (folderMatch) {
      const folderId = folderMatch[1];
      const normalized = `https://drive.google.com/drive/folders/${folderId}${resourceKey ? `?resourcekey=${resourceKey}` : ''}`;
      return {
        source: 'googledrive',
        normalizedUrl: normalized,
        sourceChapterId: folderId,
        hostname: u.hostname,
      };
    }

    // 2. Files: /file/d/{id}/view or /file/d/{id}/edit
    const fileMatch = pathname.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
    if (fileMatch) {
      const fileId = fileMatch[1];
      const normalized = `https://drive.google.com/file/d/${fileId}/view${resourceKey ? `?resourcekey=${resourceKey}` : ''}`;
      return {
        source: 'googledrive',
        normalizedUrl: normalized,
        sourceChapterId: fileId,
        hostname: u.hostname,
      };
    }

    // 3. Query based: /open?id={id} or /uc?id={id}
    const idParam = u.searchParams.get('id');
    if (idParam && /^[a-zA-Z0-9_-]+$/.test(idParam)) {
      const normalized = `https://drive.google.com/open?id=${idParam}${resourceKey ? `&resourcekey=${resourceKey}` : ''}`;
      return {
        source: 'googledrive',
        normalizedUrl: normalized,
        sourceChapterId: idParam,
        hostname: u.hostname,
      };
    }

    throw new Error(
      'Invalid Google Drive link. Please provide a link to a Google Drive folder or ZIP/CBZ archive.'
    );
  }

  public async fetchManifest(
    info: ResolvedSourceInfo,
    _fetchFn?: (url: string | URL | Request, init?: RequestInit) => Promise<Response>,
    _signal?: AbortSignal
  ): Promise<ChapterManifest> {
    const win = typeof window !== 'undefined' ? (window as any) : undefined;
    const electronBridge = win?.folioScript?.chapterSnatch;

    if (electronBridge?.fetchMetadata) {
      const result = await electronBridge.fetchMetadata(info.normalizedUrl);
      return result;
    }

    // Fallback for Node / test runtime
    try {
      // @ts-ignore
      const { fetchMetadata } = await import('../../../../electron/chapterSnatchBackend.cjs');
      const result = await fetchMetadata(info.normalizedUrl);
      return result;
    } catch (e: any) {
      throw new Error(`Google Drive acquisition failed: ${e?.message || 'Unknown error'}`);
    }
  }
}

export const googleDriveAdapter = new GoogleDriveAdapter();
