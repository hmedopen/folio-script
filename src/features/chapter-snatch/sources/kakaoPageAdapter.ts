import type {
  ChapterSourceAdapter,
  ResolvedSourceInfo,
  ChapterManifest,
  ChapterPage,
} from '../core/types';
import { FetchHttpClient } from '../core/httpClient';

/**
 * Dedicated adapter for KakaoPage (page.kakao.com).
 * Uses bff-page.kakao.com gateway API to fetch chapter metadata and image download streams.
 * Handles free chapters directly and reports locked chapters with clear actionable messaging.
 */
export class KakaoPageAdapter implements ChapterSourceAdapter {
  public readonly id = 'kakaopage';
  public readonly name = 'KakaoPage (Korea)';

  public readonly allowedSourceHosts = [
    'page.kakao.com',
    '*.page.kakao.com',
    'bff-page.kakao.com',
    'kakao.com',
    '*.kakao.com',
  ] as const;

  public readonly allowedImageHosts = [
    'page-edge.kakao.com',
    '*.page-edge.kakao.com',
    'dn-img-page.kakao.com',
    '*.kakao.com',
    '*.kakaocdn.net',
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
      return host === 'page.kakao.com' || host.endsWith('.page.kakao.com');
    } catch {
      return false;
    }
  }

  public resolve(url: URL | string): ResolvedSourceInfo {
    const u = typeof url === 'string' ? new URL(url.startsWith('http') ? url : `https://${url}`) : url;
    const pathParts = u.pathname.split('/').filter(Boolean);

    let seriesId: string | null = null;
    let productId: string | null = null;

    const contentIdx = pathParts.indexOf('content');
    if (contentIdx !== -1 && pathParts[contentIdx + 1]) {
      seriesId = pathParts[contentIdx + 1];
      const viewerIdx = pathParts.indexOf('viewer');
      if (viewerIdx !== -1 && pathParts[viewerIdx + 1]) {
        productId = pathParts[viewerIdx + 1];
      }
    }

    if (!seriesId) {
      throw new Error('Invalid KakaoPage URL: Missing series ID in path.');
    }

    const sourceChapterId = productId ? `${seriesId}-${productId}` : seriesId;

    return {
      source: this.id,
      normalizedUrl: productId
        ? `https://${u.hostname}/content/${seriesId}/viewer/${productId}`
        : `https://${u.hostname}/content/${seriesId}`,
      sourceChapterId,
      seriesSlug: seriesId,
      chapterSlug: productId || undefined,
      hostname: u.hostname,
    };
  }

  public async fetchManifest(
    info: ResolvedSourceInfo,
    fetchFn: typeof fetch = fetch,
    signal?: AbortSignal
  ): Promise<ChapterManifest> {
    const seriesId = info.seriesSlug || info.sourceChapterId.split('-')[0];
    let productId = info.chapterSlug || (info.sourceChapterId.includes('-') ? info.sourceChapterId.split('-')[1] : null);

    // If no productId was given, query overview to find the first chapter
    if (!productId) {
      const overviewUrl = `https://bff-page.kakao.com/api/gateway/api/v1/content/overview?series_id=${seriesId}`;
      const ovRes = await this.httpClient.fetchSafe(
        overviewUrl,
        {
          headers: {
            'User-Agent': KakaoPageAdapter.USER_AGENT,
            Accept: 'application/json, text/plain, */*',
            Referer: 'https://page.kakao.com/',
            Origin: 'https://page.kakao.com',
          },
          signal,
          allowedHosts: [...this.allowedSourceHosts],
        },
        fetchFn
      );

      if (!ovRes.ok) {
        throw new Error(`KakaoPage API responded with HTTP ${ovRes.status}`);
      }

      const ovJson = await ovRes.json();
      productId = ovJson.result?.page_continue?.first_read_product_id ? String(ovJson.result.page_continue.first_read_product_id) : null;
      if (!productId) {
        throw new Error('Could not automatically resolve the first chapter for this KakaoPage series. Please open a chapter and paste its viewer link.');
      }
    }

    const viewerUrl = `https://bff-page.kakao.com/api/gateway/api/v1/viewer/data?series_id=${seriesId}&product_id=${productId}`;
    const viewerRes = await this.httpClient.fetchSafe(
      viewerUrl,
      {
        headers: {
          'User-Agent': KakaoPageAdapter.USER_AGENT,
          Accept: 'application/json, text/plain, */*',
          Referer: 'https://page.kakao.com/',
          Origin: 'https://page.kakao.com',
        },
        signal,
        allowedHosts: [...this.allowedSourceHosts],
      },
      fetchFn
    );

    if (!viewerRes.ok) {
      throw new Error(`KakaoPage API responded with HTTP ${viewerRes.status}`);
    }

    const viewerJson = await viewerRes.json();

    if (viewerJson.result_code === -200 || viewerJson.message_key === 'api_content_not_purchased_item') {
      throw new Error('KakaoPage Chapter Locked: This chapter requires purchase or account ("구매하지 않은 상품입니다."). Only free chapters can be snatched.');
    }

    if (!viewerJson.viewer_data && viewerJson.message) {
      throw new Error(`KakaoPage Error: ${viewerJson.message}`);
    }

    const imgDownloadData = viewerJson.viewer_data?.imageDownloadData || viewerJson.viewer_data?.image_download_data;
    const files = imgDownloadData?.files;
    if (!files || !Array.isArray(files) || files.length === 0) {
      throw new Error('No images found in KakaoPage viewer response.');
    }

    const seriesTitle = viewerJson.series_item?.title || 'KakaoPage';
    const chapterTitle = viewerJson.item?.title || `Episode ${productId}`;

    const pages: ChapterPage[] = files.map((file: any, idx: number) => {
      const originalIndex = file.no || (idx + 1);
      const imageUrl = file.secureUrl || file.secure_url;
      let ext = 'jpg';
      if (file.filename) {
        ext = file.filename.split('.').pop()?.toLowerCase() || 'jpg';
        if (ext === 'jpeg') ext = 'jpg';
      }
      return {
        id: `kakao-${seriesId}-${productId}-${originalIndex}`,
        originalIndex,
        filename: `${String(originalIndex).padStart(3, '0')}.${ext}`,
        mimeType: ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg',
        extension: ext,
        sizeBytes: file.size || 0,
        imageUrl,
        downloadStatus: 'pending',
      };
    });

    return {
      metadata: {
        source: this.id,
        sourceChapterId: `${seriesId}-${productId}`,
        seriesTitle,
        chapterTitle,
        chapterNumber: String(viewerJson.item?.order_value || productId),
        sourceUrl: info.normalizedUrl,
        pageCount: pages.length,
      },
      pages,
    };
  }

  public getImageHeaders(_imageUrl: string, _referer?: string): Record<string, string> {
    return {
      'User-Agent': KakaoPageAdapter.USER_AGENT,
      Referer: 'https://page.kakao.com/',
      Origin: 'https://page.kakao.com',
      Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
    };
  }
}

export const kakaoPageAdapter = new KakaoPageAdapter();
