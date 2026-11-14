/**
 * Folio Script — Image Merge & Cut System
 * Export to ZIP & Import to Workspace Services
 */

import type { Folder, Chapter } from '../../../types';
import type { ProcessingOutput } from '../core/types';
import { ingestImageFiles } from '../../../services/fileIngestion';
import { ChapterZipExporter } from '../../chapter-snatch/services/zipExporter';

export interface ExportToZipOptions {
  outputs: ProcessingOutput[];
  defaultFilename?: string;
}

export interface ImportToWorkspaceOptions {
  outputs: ProcessingOutput[];
  chapterName: string;
  targetFolder: Folder | null;
  folders: Folder[];
  setFolders: React.Dispatch<React.SetStateAction<Folder[]>>;
  openChapter: (chapterId: string, folderId?: string | null, pageId?: string | null) => void;
  setActiveFolderId?: (folderId: string | null) => void;
  setSelectedChapterId?: (chapterId: string | null) => void;
}

export class ProcessingExporter {
  /**
   * Exports processed output images to a ZIP file.
   */
  public static async exportOutputsToZip(
    options: ExportToZipOptions
  ): Promise<{ saved: boolean; canceled: boolean; filePath?: string; error?: string }> {
    const { outputs, defaultFilename = 'Processed_Chapter.zip' } = options;

    const readyOutputs = outputs.filter((o) => o.status === 'ready' && o.blob);
    if (readyOutputs.length === 0) {
      throw new Error('No ready outputs to export.');
    }

    const win = typeof window !== 'undefined' ? (window as any) : undefined;
    const electronBridge = win?.folioScript?.chapterSnatch;

    // Convert outputs to base64 entries
    const entries: Array<{ filename: string; dataBase64: string }> = [];
    for (const out of readyOutputs) {
      if (!out.blob) continue;
      const buffer = await out.blob.arrayBuffer();
      const base64 = ChapterZipExporter.uint8ArrayToBase64(new Uint8Array(buffer));
      entries.push({
        filename: out.name,
        dataBase64: base64,
      });
    }

    if (electronBridge?.saveZip) {
      return await electronBridge.saveZip({
        defaultFilename,
        entries,
      });
    }

    // Web fallback: construct standard ZIP blob using ChapterZipExporter
    const decodedEntries = entries.map((e) => ({
      filename: e.filename,
      data: ChapterZipExporter.base64ToUint8Array(e.dataBase64),
    }));

    const zipBlob = ChapterZipExporter.createZipBlob(decodedEntries);
    const link = document.createElement('a');
    link.href = URL.createObjectURL(zipBlob);
    link.download = defaultFilename;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);

    return { saved: true, canceled: false };
  }

  /**
   * Imports processed outputs into the workspace as a new chapter.
   */
  public static async importOutputsToWorkspace(
    options: ImportToWorkspaceOptions
  ): Promise<{ success: boolean; chapterId: string; pageCount: number; error?: string }> {
    const {
      outputs,
      chapterName,
      targetFolder,
      folders,
      setFolders,
      openChapter,
      setActiveFolderId,
      setSelectedChapterId,
    } = options;

    const readyOutputs = outputs.filter((o) => o.status === 'ready' && o.blob);
    if (readyOutputs.length === 0) {
      throw new Error('No ready outputs to import.');
    }

    // Convert Blobs into File objects
    const files: File[] = [];
    for (let i = 0; i < readyOutputs.length; i++) {
      const out = readyOutputs[i];
      if (!out.blob) continue;
      const file = new File([out.blob], out.name, {
        type: 'image/png',
        lastModified: Date.now(),
      });
      files.push(file);
    }

    // Ingest into workspace (saves into IndexedDB and computes dimensions)
    const ingestionResult = await ingestImageFiles(files, 1);
    if (ingestionResult.count === 0) {
      throw new Error('Workspace ingestion yielded 0 pages.');
    }

    let folderId = targetFolder?.id;
    if (!folderId) {
      const draftsFolder = folders.find((f) => f.id === 'folder-drafts') || folders[0];
      folderId = draftsFolder?.id || 'folder-drafts';
    }

    const resolvedFolder = folders.find((f) => f.id === folderId) || targetFolder || folders[0];
    const isDraft = Boolean(
      resolvedFolder?.isSystem || resolvedFolder?.isDraft || folderId === 'folder-drafts'
    );
    const chapterId = `${isDraft ? 'dr' : 'chapter'}-${Date.now()}`;

    const newChapter: Chapter = {
      id: chapterId,
      name: chapterName,
      pages: ingestionResult.count,
      createdAt: Date.now(),
      pageList: ingestionResult.pages,
      isDraft,
      status: 'in_progress',
    };

    setFolders((prev) =>
      prev.map((f) => {
        if (f.id === folderId) {
          const updated = [newChapter, ...(f.chapters || [])];
          return {
            ...f,
            chapters: updated,
            badgeCount: updated.length,
          };
        }
        return f;
      })
    );

    if (setActiveFolderId) setActiveFolderId(folderId);
    if (setSelectedChapterId) setSelectedChapterId(newChapter.id);

    const firstPageId = newChapter.pageList?.[0]?.id || null;
    openChapter(newChapter.id, folderId, firstPageId);

    return {
      success: true,
      chapterId: newChapter.id,
      pageCount: newChapter.pages,
    };
  }
}
