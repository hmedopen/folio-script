/**
 * Folio Script — Image Merge & Cut System
 * Main Studio Container Modal (Fetch Integration & Independent Upload)
 */

import React, { useState, useEffect, useCallback } from 'react';
import type { Folder } from '../../../types';
import type { ProcessingSourceImage, ProcessingSession } from '../core/types';
import { processingManager } from '../engine/processingManager';
import { UploadStage } from './UploadStage';
import { ResultsGallery } from './ResultsGallery';
import { ProcessingExporter } from '../services/processingExporter';
import {
  X,
  Layers,
  Scissors,
  Loader2,
  AlertCircle,
  Sparkles,
} from 'lucide-react';

export interface ImageProcessingModalProps {
  isOpen: boolean;
  onClose: () => void;
  context: 'fetch' | 'upload';
  initialSources?: ProcessingSourceImage[];
  initialOperation?: 'merge' | 'cut';
  title?: string;
  activeFolder: Folder | null;
  folders: Folder[];
  setFolders: React.Dispatch<React.SetStateAction<Folder[]>>;
  openChapter: (chapterId: string, folderId?: string | null, pageId?: string | null) => void;
  showToast?: (msg: string) => void;
  setActiveFolderId?: (folderId: string | null) => void;
  setSelectedChapterId?: (chapterId: string | null) => void;
}

export const ImageProcessingModal: React.FC<ImageProcessingModalProps> = ({
  isOpen,
  onClose,
  context,
  initialSources = [],
  initialOperation,
  title = 'Image Merge & Cut',
  activeFolder,
  folders,
  setFolders,
  openChapter,
  showToast,
  setActiveFolderId,
  setSelectedChapterId,
}) => {
  const [sourceImages, setSourceImages] = useState<ProcessingSourceImage[]>(initialSources);
  const [viewState, setViewState] = useState<'stage' | 'results'>('stage');
  const [session, setSession] = useState<ProcessingSession | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);

  // Subscribe to processing manager
  useEffect(() => {
    const unsub = processingManager.subscribe((s) => {
      setSession(s);
    });
    return () => unsub();
  }, []);

  // Initialize session whenever opened or sources change
  useEffect(() => {
    if (!isOpen) return;

    if (context === 'fetch' && initialSources.length > 0) {
      setSourceImages(initialSources);
      processingManager.initSession('fetch', title, initialSources);

      if (initialOperation === 'merge') {
        setViewState('results');
        processingManager.runMerge().catch((err) => {
          setErrorMessage(err?.message || 'Merge processing failed.');
        });
      } else if (initialOperation === 'cut') {
        setViewState('results');
        processingManager.runCut().catch((err) => {
          setErrorMessage(err?.message || 'Cut processing failed.');
        });
      } else {
        setViewState('stage');
      }
    } else if (context === 'upload') {
      setSourceImages([]);
      processingManager.initSession('upload', title, []);
      setViewState('stage');
    }
  }, [isOpen, context, initialSources, initialOperation, title]);

  const handleStartMerge = async () => {
    if (sourceImages.length === 0) return;
    setErrorMessage(null);
    processingManager.initSession(context, title, sourceImages);
    setViewState('results');

    try {
      await processingManager.runMerge();
    } catch (err: any) {
      setErrorMessage(err?.message || 'Merge failed.');
    }
  };

  const handleStartCut = async () => {
    if (sourceImages.length === 0) return;
    setErrorMessage(null);
    processingManager.initSession(context, title, sourceImages);
    setViewState('results');

    try {
      await processingManager.runCut();
    } catch (err: any) {
      setErrorMessage(err?.message || 'Cut failed.');
    }
  };

  const handleSaveZip = async () => {
    if (!session || isExporting) return;
    setIsExporting(true);
    setErrorMessage(null);

    try {
      const defaultFilename = `${title.replace(/[^a-zA-Z0-9_-]/g, '_')}_processed.zip`;
      const res = await ProcessingExporter.exportOutputsToZip({
        outputs: session.outputs,
        defaultFilename,
      });

      if (res.saved) {
        showToast?.(`Exported ZIP with ${session.outputs.length} outputs.`);
      }
    } catch (err: any) {
      setErrorMessage(err?.message || 'Failed to export ZIP archive.');
    } finally {
      setIsExporting(false);
    }
  };

  const handleMoveToWorkspace = async () => {
    if (!session || isExporting) return;
    setIsExporting(true);
    setErrorMessage(null);

    try {
      const chapterName = `${title} (Processed)`;
      const res = await ProcessingExporter.importOutputsToWorkspace({
        outputs: session.outputs,
        chapterName,
        targetFolder: activeFolder,
        folders,
        setFolders,
        openChapter,
        setActiveFolderId,
        setSelectedChapterId,
      });

      if (res.success) {
        showToast?.(`Imported "${chapterName}" (${res.pageCount} pages)`);
        onClose();
      }
    } catch (err: any) {
      setErrorMessage(err?.message || 'Failed to import into Workspace.');
    } finally {
      setIsExporting(false);
    }
  };

  const handleClose = () => {
    processingManager.cleanupSession();
    onClose();
  };

  if (!isOpen) return null;

  const isProcessing = session?.status === 'processing';
  const outputs = session?.outputs || [];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md animate-in fade-in duration-100 select-none">
      <div className="w-full max-w-6xl h-[90vh] bg-[#0c0d12] border border-white/[0.12] rounded-2xl shadow-2xl flex flex-col overflow-hidden text-zinc-100 font-sans animate-in zoom-in-95 duration-100 relative">
        {/* Modal Top Header */}
        <div className="h-14 px-6 border-b border-white/[0.08] bg-[#08080b] flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-1.5 rounded-lg bg-zinc-800 border border-white/[0.08] text-white">
              {initialOperation === 'cut' ? (
                <Scissors className="w-4 h-4 text-zinc-300" />
              ) : (
                <Layers className="w-4 h-4 text-zinc-300" />
              )}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-mono text-xs font-semibold tracking-wider uppercase text-zinc-200">
                  {title}
                </span>
                <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-zinc-800 text-zinc-400 border border-white/[0.06]">
                  {context === 'fetch' ? 'Fetch Session' : 'Independent Upload'}
                </span>
              </div>
              <p className="text-[11px] text-zinc-500">
                Reliable translator-focused image merging and cutting with boundary reconciliation.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleClose}
              className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
              title="Close"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Error Banner */}
        {errorMessage && (
          <div className="px-6 py-2.5 bg-rose-950/40 border-b border-rose-500/30 flex items-center justify-between text-xs text-rose-300 font-mono shrink-0">
            <div className="flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
              <span>{errorMessage}</span>
            </div>
            <button
              type="button"
              onClick={() => setErrorMessage(null)}
              className="text-rose-400 hover:text-white"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Processing Progress Overlay */}
        {isProcessing && (
          <div className="absolute inset-0 z-40 bg-black/70 backdrop-blur-sm flex flex-col items-center justify-center p-6 text-center animate-in fade-in duration-100">
            <div className="p-4 rounded-2xl bg-zinc-900 border border-white/[0.1] shadow-2xl flex flex-col items-center max-w-sm w-full">
              <Loader2 className="w-7 h-7 text-white animate-spin mb-3" />
              <h4 className="text-sm font-semibold text-white mb-1">
                Processing Images
              </h4>
              <p className="text-xs font-mono text-zinc-400 mb-4">
                {session?.progress.message || 'Rendering outputs...'}
              </p>

              {session && session.progress.total > 0 && (
                <div className="w-full bg-zinc-800 h-2 rounded-full overflow-hidden mb-3">
                  <div
                    className="bg-white h-full transition-all duration-200"
                    style={{
                      width: `${Math.round(
                        (session.progress.current / session.progress.total) * 100
                      )}%`,
                    }}
                  />
                </div>
              )}

              <button
                type="button"
                onClick={() => processingManager.cancel()}
                className="px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-xs font-mono text-zinc-300 transition-colors cursor-pointer"
              >
                Cancel Operation
              </button>
            </div>
          </div>
        )}

        {/* Active Stage View */}
        {viewState === 'stage' ? (
          <UploadStage
            sourceImages={sourceImages}
            setSourceImages={setSourceImages}
            onStartMerge={handleStartMerge}
            onStartCut={handleStartCut}
            isProcessing={isProcessing}
          />
        ) : (
          <ResultsGallery
            outputs={outputs}
            sourceImages={sourceImages}
            isBusy={isProcessing || isExporting}
            onSaveZip={handleSaveZip}
            onMoveToWorkspace={handleMoveToWorkspace}
            onBackToSources={() => setViewState('stage')}
            onRerunMerge={handleStartMerge}
            onRerunCut={handleStartCut}
          />
        )}
      </div>
    </div>
  );
};
