/**
 * Folio Script — Image Merge & Cut System
 * Resolution Target & Output Count Estimation Modal
 */

import React, { useState, useMemo } from 'react';
import type { ProcessingSourceImage } from '../core/types';
import { X, Scissors, Layers, Sparkles, Sliders } from 'lucide-react';

interface ResolutionTargetModalProps {
  isOpen: boolean;
  operation: 'cut' | 'merge';
  sourceImages: ProcessingSourceImage[];
  onClose: () => void;
  onConfirm: (options: { maxSliceHeight?: number; targetMaxHeight?: number }) => void;
}

export const ResolutionTargetModal: React.FC<ResolutionTargetModalProps> = ({
  isOpen,
  operation,
  sourceImages,
  onClose,
  onConfirm,
}) => {
  // Defaults: 2400px for Cut, 8000px for Merge
  const [cutTargetHeight, setCutTargetHeight] = useState<number>(2400);
  const [mergeTargetHeight, setMergeTargetHeight] = useState<number>(8000);

  const cutPresets = [1600, 2000, 2400, 3000, 4000];
  const mergePresets = [6000, 8000, 10000, 12000];

  // Dynamic live output estimation
  const estimatedOutputs = useMemo(() => {
    if (sourceImages.length === 0) return 0;

    if (operation === 'cut') {
      let count = 0;
      for (const img of sourceImages) {
        count += Math.max(1, Math.ceil(img.height / cutTargetHeight));
      }
      return count;
    } else {
      const totalHeight = sourceImages.reduce((sum, img) => sum + img.height, 0);
      return Math.max(1, Math.ceil(totalHeight / mergeTargetHeight));
    }
  }, [sourceImages, operation, cutTargetHeight, mergeTargetHeight]);

  if (!isOpen) return null;

  const handleConfirm = () => {
    if (operation === 'cut') {
      onConfirm({ maxSliceHeight: cutTargetHeight });
    } else {
      onConfirm({ targetMaxHeight: mergeTargetHeight });
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md animate-in fade-in duration-100 select-none">
      <div className="w-full max-w-md bg-[#0e0f14] border border-white/[0.12] rounded-2xl shadow-2xl overflow-hidden text-zinc-100 font-sans animate-in zoom-in-95 duration-100">
        {/* Header */}
        <div className="h-14 px-5 border-b border-white/[0.08] bg-[#090a0e] flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5">
            {operation === 'cut' ? (
              <Scissors className="w-4 h-4 text-white stroke-[2.2]" />
            ) : (
              <Layers className="w-4 h-4 text-white stroke-[2.2]" />
            )}
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-100">
                {operation === 'cut' ? 'Configure Image Cut' : 'Configure Image Merge'}
              </h3>
              <p className="text-[11px] text-zinc-500">
                {operation === 'cut'
                  ? 'Set slice height target for webtoon segmentation'
                  : 'Set maximum strip height target for combined strips'}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 space-y-5 bg-[#090a0e]/50">
          {/* Target Resolution Setting */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-medium text-zinc-300 flex items-center gap-1.5">
                <Sliders className="w-3.5 h-3.5 text-zinc-400" />
                <span>
                  {operation === 'cut'
                    ? 'Target Height per Slice (px)'
                    : 'Target Max Height per Strip (px)'}
                </span>
              </label>
              <span className="text-xs font-mono font-bold text-white bg-zinc-800 px-2 py-0.5 rounded border border-white/[0.06]">
                {operation === 'cut' ? cutTargetHeight : mergeTargetHeight} px
              </span>
            </div>

            {/* Quick Presets */}
            <div className="flex items-center gap-2 mb-3">
              {(operation === 'cut' ? cutPresets : mergePresets).map((val) => {
                const isSelected =
                  operation === 'cut' ? cutTargetHeight === val : mergeTargetHeight === val;
                return (
                  <button
                    key={val}
                    type="button"
                    onClick={() =>
                      operation === 'cut' ? setCutTargetHeight(val) : setMergeTargetHeight(val)
                    }
                    className={`flex-1 py-1.5 rounded-lg text-xs font-mono font-medium transition-all cursor-pointer ${
                      isSelected
                        ? 'bg-white text-black font-bold shadow-xs'
                        : 'bg-zinc-900 border border-white/[0.08] text-zinc-400 hover:text-white hover:bg-zinc-800'
                    }`}
                  >
                    {val}px
                  </button>
                );
              })}
            </div>

            {/* Range Slider */}
            <input
              type="range"
              min={operation === 'cut' ? 1000 : 3000}
              max={operation === 'cut' ? 5000 : 16000}
              step={operation === 'cut' ? 100 : 500}
              value={operation === 'cut' ? cutTargetHeight : mergeTargetHeight}
              onChange={(e) =>
                operation === 'cut'
                  ? setCutTargetHeight(Number(e.target.value))
                  : setMergeTargetHeight(Number(e.target.value))
              }
              className="w-full accent-white cursor-pointer"
            />
          </div>

          {/* Real-time Output Estimation Card */}
          <div className="p-4 rounded-xl bg-zinc-900/80 border border-white/[0.08] flex items-center justify-between">
            <div>
              <span className="text-xs font-medium text-zinc-400 block mb-0.5">
                Estimated Output
              </span>
              <span className="text-[11px] text-zinc-500 font-mono">
                From {sourceImages.length} input image{sourceImages.length === 1 ? '' : 's'}
              </span>
            </div>

            <div className="flex items-center gap-2">
              <span className="text-xl font-bold font-mono text-white">
                ~{estimatedOutputs}
              </span>
              <span className="text-xs text-zinc-400 font-medium">
                image{estimatedOutputs === 1 ? '' : 's'}
              </span>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="h-16 px-6 border-t border-white/[0.08] bg-[#090a0e] flex items-center justify-end gap-3 shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-xs font-medium text-zinc-400 hover:text-white transition-colors cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            className="px-5 py-2 rounded-xl bg-white text-black font-semibold text-xs hover:bg-zinc-200 active:scale-95 transition-all shadow-md cursor-pointer flex items-center gap-1.5"
          >
            <Sparkles className="w-3.5 h-3.5 text-black" />
            <span>
              {operation === 'cut' ? 'Start Slicing' : 'Start Merging'}
            </span>
          </button>
        </div>
      </div>
    </div>
  );
};
