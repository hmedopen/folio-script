import type {
  ChapterSourceAdapter,
  ResolvedSourceInfo,
  ChapterManifest,
  ChapterPage,
} from '../core/types';
import { FetchHttpClient } from '../core/httpClient';

/**
 * Dedicated adapter for Korean Naver Webtoon (comic.naver.com).
 * Extracts reader pages from div.wt_viewer with image-comic.pstatic.net links.
 * Works natively for all free/published chapters without account or phone gate.
 */
export class NaverWebtoonAdapter implements ChapterSourceAdapter {
  public readonly id = 'naver-webtoon';
  public readonly name = 'Naver Webtoon (Korea)';

  public readonly allowedSourceHosts = [
    'comic.naver.com',
    '*.comic.naver.com',
    'naver.com',
    '*.naver.com',
  ] as const;

  public readonly allowedImageHosts = [
    'image-comic.pstatic.net',
    '*.pstatic.net',
    'webtoon-phinf.pstatic.net',
  ] as const;

  public static readonly USER_AGENT =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

  private httpClient = new FetchHttpClient({
    defaultTimeoutMs: 15000,
    defaultMaxRetries: 3,
    defaultAllowedHosts: [...this.allowedSourceHosts],
  });

  public canHandle(url: URL | string): boolean {
    try {
      const u = typeof url === 'string' ? new URL(url.startsWith('http') ? url : `https://${url}`) : url;
      const host = u.hostname.toLowerCase();
      return host === 'comic.naver.com' || host.endsWith('.comic.naver.com');
    } catch {
      return false;
    }
  }

  public resolve(url: URL | string): ResolvedSourceInfo {
    const u = typeof url === 'string' ? new URL(url.startsWith('http') ? url : `https://${url}`) : url;

    // Pattern: https://comic.naver.com/webtoon/detail?titleId=183559&no=600
    const titleId = u.searchParams.get('titleId');
    const no = u.searchParams.get('no');

    if (!titleId || !no) {
      throw new Error('Invalid Naver Webtoon URL: Missing titleId or no query parameter.');
    }

    const sourceChapterId = `${titleId}-${no}`;

    return {
      source: this.id,
      normalizedUrl: `https://${u.hostname}/webtoon/detail?titleId=${titleId}&no=${no}`,
      sourceChapterId,
      seriesSlug: titleId,
      chapterSlug: no,
      hostname: u.hostname,
    };
  }

  public async fetchManifest(
    info: ResolvedSourceInfo,
    fetchFn: typeof fetch = fetch,
    signal?: AbortSignal
  ): Promise<ChapterManifest> {
    const response = await this.httpClient.fetchSafe(
      info.normalizedUrl,
      {
        headers: {
          'User-Agent': NaverWebtoonAdapter.USER_AGENT,
          Referer: 'https://comic.naver.com/',
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        },
        signal,
        allowedHosts: [...this.allowedSourceHosts],
      },
      fetchFn
    );

    if (!response.ok) {
      throw new Error(`Naver Webtoon responded with HTTP ${response.status}`);
    }

    const html = await response.text();

    if (html.includes('연령 확인') || html.includes('성인 인증') || html.includes('login.naver.com')) {
      throw new Error('This Naver Webtoon chapter requires Naver 19+ age verification or cookie login.');
    }

    const viewerMatch = html.match(/<div[^>]*class=["'][^"']*wt_viewer[^"']*["'][^>]*>([\s\S]*?)<\/div>/i);
    const container = viewerMatch ? viewerMatch[1] : html;
    const imgMatches = [...container.matchAll(/<img([^>]+)>/gi)];
    const imageUrls: string[] = [];

    for (const match of imgMatches) {
      const attrs = match[1];
      const srcMatch = attrs.match(/src=["']([^"']+)["']/i);
      const target = srcMatch ? srcMatch[1].trim() : null;
      if (!target || !target.includes('image-comic.pstatic.net') || target.includes('thumbnail')) continue;
      imageUrls.push(target);
    }

    if (imageUrls.length === 0) {
      throw new Error('Could not find chapter pages in the Naver Webtoon response.');
    }

    let seriesTitle = 'Naver Webtoon';
    let chapterTitle: string | undefined;
    const ogTitle = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i);
    if (ogTitle && ogTitle[1]) {
      const cleanOg = ogTitle[1].trim();
      if (cleanOg.includes(' - ')) {
        const parts = cleanOg.split(' - ');
        seriesTitle = parts[0].trim();
        chapterTitle = parts.slice(1).join(' - ').trim();
      } else {
        seriesTitle = cleanOg;
      }
    }

    const pages: ChapterPage[] = imageUrls.map((u, idx) => {
      const originalIndex = idx + 1;
      const cleanUrl = u.split('?')[0];
      const ext = cleanUrl.split('.').pop()?.toLowerCase() || 'jpg';
      return {
        id: `${info.sourceChapterId}-${originalIndex}`,
        originalIndex,
        filename: `${String(originalIndex).padStart(3, '0')}.${ext}`,
        mimeType: ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg',
        extension: ext,
        sizeBytes: 0,
        imageUrl: u,
        downloadStatus: 'pending',
      };
    });

    return {
      metadata: {
        source: this.id,
        sourceChapterId: info.sourceChapterId,
        seriesTitle,
        chapterTitle,
        chapterNumber: info.chapterSlug,
        sourceUrl: info.normalizedUrl,
        pageCount: pages.length,
      },
      pages,
    };
  }

  public getImageHeaders(_imageUrl: string, _referer?: string): Record<string, string> {
    return {
      'User-Agent': NaverWebtoonAdapter.USER_AGENT,
      Referer: 'https://comic.naver.com/',
      Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
    };
  }
}

export const naverWebtoonAdapter = new NaverWebtoonAdapter();
