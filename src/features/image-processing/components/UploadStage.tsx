/**
 * Folio Script — Image Merge & Cut System
 * Independent Image Upload Stage
 */

import React, { useState } from 'react';
import type { ProcessingSourceImage, CutOptions, MergeOptions } from '../core/types';
import {
  UploadCloud,
  Trash2,
  ChevronUp,
  ChevronDown,
  Layers,
  Scissors,
  FileImage,
} from 'lucide-react';
import {
  pickImageFiles,
  extractFilesFromDataTransfer,
} from '../../../services/fileIngestion';
import { decodeImage } from '../engine/imageUtils';
import { ResolutionTargetModal } from './ResolutionTargetModal';

interface UploadStageProps {
  sourceImages: ProcessingSourceImage[];
  setSourceImages: React.Dispatch<React.SetStateAction<ProcessingSourceImage[]>>;
  onStartMerge: (options?: MergeOptions) => void;
  onStartCut: (options?: CutOptions) => void;
  isProcessing: boolean;
}

export const UploadStage: React.FC<UploadStageProps> = ({
  sourceImages,
  setSourceImages,
  onStartMerge,
  onStartCut,
  isProcessing,
}) => {
  const [isDragOver, setIsDragOver] = useState(false);
  const [isLoadingFiles, setIsLoadingFiles] = useState(false);
  const [targetModalOperation, setTargetModalOperation] = useState<'cut' | 'merge' | null>(null);

  // Ingest files into ProcessingSourceImage items
  const processFiles = async (files: File[]) => {
    if (files.length === 0) return;
    setIsLoadingFiles(true);

    try {
      const newItems: ProcessingSourceImage[] = [];
      const baseIndex = sourceImages.length;

      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const ext = file.name.split('.').pop()?.toLowerCase() || 'png';
        const mimeType = file.type || 'image/png';
        const originalIndex = baseIndex + i + 1;
        const id = `src-upload-${Date.now()}-${originalIndex}-${Math.random().toString(36).substring(2, 6)}`;

        // Fast dimension read and thumbnail creation with resilience
        let width = 800;
        let height = 1200;
        let decoded;
        try {
          decoded = await decodeImage(file, mimeType);
          width = decoded.width;
          height = decoded.height;
        } catch (_err) {
          console.warn(`Fallback dimensions for uploaded file: ${file.name}`);
        } finally {
          if (decoded?.close) decoded.close();
        }

        const thumbnailUrl = URL.createObjectURL(file);

        newItems.push({
          id,
          originalIndex,
          name: file.name,
          mimeType,
          extension: ext,
          width,
          height,
          sizeBytes: file.size,
          thumbnailUrl,
          blob: file,
        });
      }

      setSourceImages((prev) => [...prev, ...newItems]);
    } catch (err) {
      console.error('Failed to process uploaded files:', err);
    } finally {
      setIsLoadingFiles(false);
    }
  };

  const handlePickFiles = async () => {
    try {
      const files = await pickImageFiles();
      await processFiles(files);
    } catch (err) {
      console.error('Failed to pick image files:', err);
    }
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
    try {
      const files = await extractFilesFromDataTransfer(e.dataTransfer);
      const finalFiles = files.length > 0 ? files : Array.from(e.dataTransfer.files || []);
      await processFiles(finalFiles);
    } catch (err) {
      console.error('Failed to drop files:', err);
    }
  };

  const handleMoveUp = (index: number) => {
    if (index <= 0) return;
    setSourceImages((prev) => {
      const next = [...prev];
      const temp = next[index];
      next[index] = next[index - 1];
      next[index - 1] = temp;
      return next.map((item, idx) => ({ ...item, originalIndex: idx + 1 }));
    });
  };

  const handleMoveDown = (index: number) => {
    if (index >= sourceImages.length - 1) return;
    setSourceImages((prev) => {
      const next = [...prev];
      const temp = next[index];
      next[index] = next[index + 1];
      next[index + 1] = temp;
      return next.map((item, idx) => ({ ...item, originalIndex: idx + 1 }));
    });
  };

  const handleRemove = (index: number) => {
    setSourceImages((prev) => {
      const item = prev[index];
      if (item?.thumbnailUrl) {
        try {
          URL.revokeObjectURL(item.thumbnailUrl);
        } catch {}
      }
      const next = prev.filter((_, idx) => idx !== index);
      return next.map((item, idx) => ({ ...item, originalIndex: idx + 1 }));
    });
  };

  const handleClearAll = () => {
    for (const item of sourceImages) {
      if (item.thumbnailUrl) {
        try {
          URL.revokeObjectURL(item.thumbnailUrl);
        } catch {}
      }
    }
    setSourceImages([]);
  };

  return (
    <div
      className="flex-1 flex flex-col min-h-0 overflow-hidden bg-[#0a0a0d] text-zinc-100 select-none"
      onDragOver={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragOver(true);
      }}
      onDragLeave={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragOver(false);
      }}
      onDrop={handleDrop}
    >
      {/* Upload Header Strip without "+ Add Images" button */}
      <div className="px-6 py-3 bg-[#090a0e] border-b border-white/[0.06] flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2">
          <FileImage className="w-4 h-4 text-zinc-400" />
          <span className="text-xs font-semibold text-zinc-200">
            Source Image List ({sourceImages.length})
          </span>
        </div>

        <div className="flex items-center gap-2">
          {sourceImages.length > 0 && (
            <button
              type="button"
              onClick={handleClearAll}
              disabled={isProcessing}
              className="px-2.5 py-1 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-white/[0.08] text-xs font-mono text-zinc-400 hover:text-rose-400 transition-colors cursor-pointer"
            >
              Clear All
            </button>
          )}
        </div>
      </div>

      {/* Main Drop Area & Image Cards (fixed-fit layout, no outer scrollbar on empty state) */}
      <div
        className={`flex-1 overflow-y-auto p-6 custom-scrollbar transition-colors flex flex-col ${
          isDragOver ? 'bg-sky-950/20' : 'bg-[#07070a]'
        }`}
      >
        {sourceImages.length === 0 ? (
          <div
            onClick={handlePickFiles}
            className="w-full max-w-xl max-h-[460px] my-auto mx-auto flex flex-col items-center justify-center text-center p-10 border-2 border-dashed border-white/[0.1] hover:border-white/[0.25] rounded-2xl cursor-pointer transition-colors bg-zinc-900/30"
          >
            {/* Upload icon directly on background, enlarged */}
            <UploadCloud className="w-14 h-14 text-zinc-300 stroke-[1.5] mb-4" />
            <h3 className="text-sm font-semibold text-zinc-100 mb-5">
              Select or Drop Images to Process
            </h3>
            <button
              type="button"
              disabled={isLoadingFiles}
              className="px-5 py-2 rounded-xl bg-white text-zinc-950 font-semibold text-xs shadow-md hover:bg-zinc-200 transition-colors cursor-pointer"
            >
              {isLoadingFiles ? 'Loading Images...' : 'Browse Files'}
            </button>
          </div>
        ) : (
          <div className="space-y-2 pb-6 max-w-4xl mx-auto w-full">
            {sourceImages.map((src, idx) => (
              <div
                key={src.id}
                className="flex items-center justify-between p-2.5 rounded-xl bg-zinc-900/60 border border-white/[0.06] hover:border-white/[0.14] transition-colors gap-4"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <span className="w-8 text-center text-xs font-mono font-bold text-zinc-400 shrink-0">
                    #{src.originalIndex}
                  </span>

                  <div className="w-12 h-14 rounded-lg bg-black border border-white/[0.08] overflow-hidden shrink-0 flex items-center justify-center">
                    {src.thumbnailUrl ? (
                      <img
                        src={src.thumbnailUrl}
                        alt={src.name}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <FileImage className="w-4 h-4 text-zinc-600" />
                    )}
                  </div>

                  <div className="min-w-0 flex flex-col">
                    <span className="text-xs font-semibold text-zinc-200 truncate">
                      {src.name}
                    </span>
                    <div className="flex items-center gap-2 text-[11px] font-mono text-zinc-500 mt-0.5">
                      <span>
                        {src.width} &times; {src.height} px
                      </span>
                      <span>&bull;</span>
                      <span>{(src.sizeBytes / 1024).toFixed(1)} KB</span>
                    </div>
                  </div>
                </div>

                {/* Reorder and Delete Controls */}
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    onClick={() => handleMoveUp(idx)}
                    disabled={idx === 0 || isProcessing}
                    className="p-1 rounded bg-zinc-800 text-zinc-400 hover:text-white disabled:opacity-20 cursor-pointer"
                    title="Move Up"
                  >
                    <ChevronUp className="w-3.5 h-3.5" />
                  </button>

                  <button
                    type="button"
                    onClick={() => handleMoveDown(idx)}
                    disabled={idx === sourceImages.length - 1 || isProcessing}
                    className="p-1 rounded bg-zinc-800 text-zinc-400 hover:text-white disabled:opacity-20 cursor-pointer"
                    title="Move Down"
                  >
                    <ChevronDown className="w-3.5 h-3.5" />
                  </button>

                  <div className="h-4 w-px bg-white/[0.08] mx-1" />

                  <button
                    type="button"
                    onClick={() => handleRemove(idx)}
                    disabled={isProcessing}
                    className="p-1 rounded bg-zinc-800 hover:bg-rose-950/60 text-zinc-400 hover:text-rose-400 transition-colors cursor-pointer"
                    title="Remove from list"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Upload Stage Action Footer */}
      <div className="h-16 px-6 border-t border-white/[0.08] bg-[#08080b] flex items-center justify-between shrink-0">
        <div className="text-xs font-mono text-zinc-500">
          {sourceImages.length > 0 && (
            <span>
              {sourceImages.length} image(s) ready for automatic processing
            </span>
          )}
        </div>

        <div className="flex items-center gap-3">
          {/* Action 1: Cut (Cut on left!) */}
          <button
            type="button"
            onClick={() => setTargetModalOperation('cut')}
            disabled={sourceImages.length === 0 || isProcessing}
            className={`h-9 w-32 px-4 rounded-xl text-xs font-semibold flex items-center justify-center gap-2 transition-all ${
              sourceImages.length === 0 || isProcessing
                ? 'bg-zinc-900 text-zinc-600 border border-white/[0.04] cursor-not-allowed'
                : 'bg-zinc-900 hover:bg-zinc-800 text-zinc-200 hover:text-white border border-white/[0.12] cursor-pointer'
            }`}
            title="Split tall webtoon images into standard page segments"
          >
            <Scissors className="w-3.5 h-3.5" />
            <span>Cut</span>
          </button>

          {/* Action 2: Merge (Merge on right!) */}
          <button
            type="button"
            onClick={() => setTargetModalOperation('merge')}
            disabled={sourceImages.length === 0 || isProcessing}
            className={`h-9 w-32 px-4 rounded-xl text-xs font-semibold flex items-center justify-center gap-2 transition-all ${
              sourceImages.length === 0 || isProcessing
                ? 'bg-zinc-800 text-zinc-600 border border-white/[0.04] cursor-not-allowed'
                : 'bg-white text-zinc-950 hover:bg-zinc-200 active:scale-[0.98] cursor-pointer shadow-md'
            }`}
            title="Combine sequential images into continuous strips"
          >
            <Layers className="w-3.5 h-3.5 text-zinc-950" />
            <span>Merge</span>
          </button>
        </div>
      </div>

      {/* Resolution Target & Estimation Modal */}
      {targetModalOperation && (
        <ResolutionTargetModal
          isOpen={Boolean(targetModalOperation)}
          operation={targetModalOperation}
          sourceImages={sourceImages}
          onClose={() => setTargetModalOperation(null)}
          onConfirm={(opts) => {
            if (targetModalOperation === 'cut') {
              onStartCut(opts);
            } else {
              onStartMerge(opts);
            }
            setTargetModalOperation(null);
          }}
        />
      )}
    </div>
  );
};
