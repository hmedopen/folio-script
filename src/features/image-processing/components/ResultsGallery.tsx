/**
 * Folio Script — Image Merge & Cut System
 * Results Gallery Component with Click-to-Inspect and Hold-to-Reconcile Gestures
 */

import React, { useState, useRef, useEffect, useMemo } from 'react';
import type { ProcessingOutput, BoundaryIntegrityStatus, ProcessingSourceImage } from '../core/types';
import { FullscreenInspector } from './FullscreenInspector';
import { SourceReconciliationModal } from './SourceReconciliationModal';
import { processingManager } from '../engine/processingManager';
import {
  Archive,
  FolderInput,
  ArrowRight,
  Maximize2,
  Layers,
  AlertTriangle,
  CheckCircle2,
  RotateCcw,
  Sliders,
  Scissors,
  Loader2,
} from 'lucide-react';

interface ResultsGalleryProps {
  outputs: ProcessingOutput[];
  sourceImages: ProcessingSourceImage[];
  isBusy: boolean;
  onSaveZip: () => void;
  onMoveToWorkspace: () => void;
  onBackToSources: () => void;
  onRerunMerge?: () => void;
  onRerunCut?: () => void;
}

export const ResultsGallery: React.FC<ResultsGalleryProps> = ({
  outputs,
  sourceImages,
  isBusy,
  onSaveZip,
  onMoveToWorkspace,
  onBackToSources,
  onRerunMerge,
  onRerunCut,
}) => {
  const [inspectIndex, setInspectIndex] = useState<number | null>(null);
  const [reconcileOutputId, setReconcileOutputId] = useState<string | null>(null);

  // Boundary integrity
  const boundaryStatus: BoundaryIntegrityStatus = useMemo(() => {
    return processingManager.getBoundaryStatus();
  }, [outputs, sourceImages]);

  // Long press / hold timer ref
  const holdTimerRef = useRef<number | null>(null);
  const isHoldTriggeredRef = useRef(false);

  const handlePointerDown = (outputId: string) => {
    isHoldTriggeredRef.current = false;
    holdTimerRef.current = window.setTimeout(() => {
      isHoldTriggeredRef.current = true;
      setReconcileOutputId(outputId);
    }, 450); // 450ms hold gesture
  };

  const handlePointerUp = (outputIndex: number) => {
    if (holdTimerRef.current) {
      clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
    // If not triggered as hold, trigger click (inspect)
    if (!isHoldTriggeredRef.current) {
      setInspectIndex(outputIndex);
    }
  };

  const handlePointerLeave = () => {
    if (holdTimerRef.current) {
      clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
  };

  const readyOutputsCount = outputs.filter((o) => o.status === 'ready').length;

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden bg-[#0a0a0d] text-zinc-100 select-none">
      {/* Gallery Header Strip */}
      <div className="px-6 py-3 bg-[#090a0e] border-b border-white/[0.06] flex items-center justify-between shrink-0 flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-white tracking-tight">
                Processing Results
              </span>
              <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-zinc-800 text-zinc-300 border border-white/[0.08]">
                {outputs.length} Output(s) Generated
              </span>
            </div>
            <p className="text-[11px] text-zinc-500">
              Click any output to inspect fullscreen. Hold (or click Reconcile) to adjust source boundaries.
            </p>
          </div>
        </div>

        {/* Boundary Integrity Pill & Re-runs */}
        <div className="flex items-center gap-3">
          {boundaryStatus.isValid ? (
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-950/30 border border-emerald-500/20 text-emerald-400 text-xs font-mono">
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span>All {sourceImages.length} sources preserved</span>
            </div>
          ) : (
            <div
              onClick={() => {
                if (outputs.length > 0) setReconcileOutputId(outputs[0].id);
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-950/40 border border-amber-500/30 text-amber-300 text-xs font-mono cursor-pointer hover:bg-amber-950/60 transition-colors"
              title="Click to resolve allocation issues"
            >
              <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
              <span>
                {boundaryStatus.unassignedSourceIds.length > 0
                  ? `${boundaryStatus.unassignedSourceIds.length} Unassigned`
                  : 'Allocation Notice'}
              </span>
            </div>
          )}

          {onRerunMerge && (
            <button
              type="button"
              onClick={onRerunMerge}
              disabled={isBusy}
              className="px-2.5 py-1.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-white/[0.08] text-xs font-mono text-zinc-300 hover:text-white transition-colors cursor-pointer flex items-center gap-1.5"
              title="Re-run automatic merge grouping"
            >
              <RotateCcw className="w-3 h-3 text-zinc-400" />
              <span>Reset Merge</span>
            </button>
          )}

          {onRerunCut && (
            <button
              type="button"
              onClick={onRerunCut}
              disabled={isBusy}
              className="px-2.5 py-1.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-white/[0.08] text-xs font-mono text-zinc-300 hover:text-white transition-colors cursor-pointer flex items-center gap-1.5"
              title="Re-run automatic cut slicing"
            >
              <Scissors className="w-3 h-3 text-zinc-400" />
              <span>Reset Cut</span>
            </button>
          )}
        </div>
      </div>

      {/* Outputs Grid */}
      <div className="flex-1 overflow-y-auto p-6 custom-scrollbar bg-[#07070a]">
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4 pb-6">
          {outputs.map((out, idx) => {
            const hasContribs = out.contributingSources.length > 0;
            return (
              <div
                key={out.id}
                onPointerDown={() => handlePointerDown(out.id)}
                onPointerUp={() => handlePointerUp(idx)}
                onPointerLeave={handlePointerLeave}
                className="group flex flex-col rounded-xl bg-zinc-900/60 border border-white/[0.08] hover:border-white/[0.25] p-2.5 transition-all cursor-pointer shadow-lg hover:shadow-2xl"
              >
                {/* Thumbnail Image Container */}
                <div className="w-full aspect-[2/3] rounded-lg bg-black/80 overflow-hidden relative flex items-center justify-center mb-2 border border-white/[0.04]">
                  {out.previewUrl ? (
                    <img
                      src={out.previewUrl}
                      alt={out.name}
                      className="w-full h-full object-contain"
                      loading="lazy"
                    />
                  ) : out.status === 'processing' || out.status === 'pending' ? (
                    <div className="flex flex-col items-center gap-1.5 text-zinc-500 font-mono text-xs">
                      <Loader2 className="w-5 h-5 animate-spin" />
                      <span>Rendering...</span>
                    </div>
                  ) : (
                    <span className="text-zinc-600 font-mono text-xs">
                      {out.error || 'Empty'}
                    </span>
                  )}

                  {/* Top-Right Inspect Pill */}
                  <div className="absolute top-1.5 right-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                    <span className="px-1.5 py-0.5 rounded bg-black/80 text-[10px] font-mono text-zinc-300 border border-white/[0.1] flex items-center gap-1">
                      <Maximize2 className="w-3 h-3" />
                      <span>Click</span>
                    </span>
                  </div>

                  {/* Top-Left Output Index Badge */}
                  <div className="absolute top-1.5 left-1.5">
                    <span className="px-2 py-0.5 rounded bg-black/85 backdrop-blur-sm text-[10px] font-mono font-bold text-white border border-white/[0.12]">
                      #{out.outputIndex}
                    </span>
                  </div>

                  {/* Hold Prompt Overlay */}
                  <div className="absolute inset-x-0 bottom-0 py-1 bg-black/75 backdrop-blur-sm text-[10px] font-mono text-zinc-400 text-center opacity-0 group-hover:opacity-100 transition-opacity">
                    Hold to Reconcile
                  </div>
                </div>

                {/* Metadata & Direct Reconcile Button */}
                <div className="flex flex-col min-w-0">
                  <span className="text-xs font-semibold text-zinc-200 truncate">
                    {out.name}
                  </span>
                  <div className="flex items-center justify-between text-[11px] font-mono text-zinc-500 mt-0.5">
                    <span>
                      {out.width}&times;{out.height}
                    </span>
                    <span className="text-zinc-400">
                      {out.contributingSources.length} src
                    </span>
                  </div>

                  <div className="mt-2 pt-2 border-t border-white/[0.04] flex items-center justify-between">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setReconcileOutputId(out.id);
                      }}
                      className="w-full py-1 rounded bg-zinc-800/80 hover:bg-zinc-700 text-zinc-300 hover:text-white border border-white/[0.06] text-[10px] font-mono flex items-center justify-center gap-1 transition-colors cursor-pointer"
                      title="Adjust source images for this output"
                    >
                      <Layers className="w-3 h-3 text-amber-400" />
                      <span>Reconcile Sources</span>
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Gallery Action Footer */}
      <div className="h-16 px-6 border-t border-white/[0.08] bg-[#08080b] flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onBackToSources}
            className="h-9 px-4 rounded-xl text-xs font-mono text-zinc-400 hover:text-white hover:bg-white/10 border border-white/[0.08] transition-colors cursor-pointer"
          >
            &larr; Back to Sources
          </button>
        </div>

        <div className="flex items-center gap-3">
          {/* Destination Action 1: Save as ZIP */}
          <button
            type="button"
            onClick={onSaveZip}
            disabled={readyOutputsCount === 0 || isBusy}
            className={`h-9 px-4 rounded-xl text-xs font-mono font-medium flex items-center gap-2 transition-all ${
              readyOutputsCount === 0 || isBusy
                ? 'bg-zinc-900 text-zinc-600 border border-white/[0.04] cursor-not-allowed'
                : 'bg-zinc-900 hover:bg-zinc-800 text-zinc-200 hover:text-white border border-white/[0.12] cursor-pointer'
            }`}
            title="Save processed outputs as a standard ZIP archive"
          >
            <Archive className="w-3.5 h-3.5" />
            <span>Save as ZIP ({readyOutputsCount})</span>
          </button>

          {/* Destination Action 2: Move to Workspace */}
          <button
            type="button"
            onClick={onMoveToWorkspace}
            disabled={readyOutputsCount === 0 || isBusy}
            className={`h-9 px-4 rounded-xl text-xs font-mono font-semibold flex items-center gap-2 transition-all ${
              readyOutputsCount === 0 || isBusy
                ? 'bg-zinc-800 text-zinc-500 border border-white/[0.04] cursor-not-allowed'
                : 'bg-white text-zinc-950 hover:bg-zinc-200 active:scale-[0.98] cursor-pointer shadow-md'
            }`}
            title="Import processed outputs directly into Folio Script Workspace"
          >
            <FolderInput className="w-3.5 h-3.5 text-zinc-950" />
            <span>Move to Workspace ({readyOutputsCount})</span>
            <ArrowRight className="w-3 h-3 text-zinc-950" />
          </button>
        </div>
      </div>

      {/* Fullscreen Inspector Modal */}
      {inspectIndex !== null && (
        <FullscreenInspector
          outputs={outputs}
          initialOutputIndex={inspectIndex}
          onClose={() => setInspectIndex(null)}
        />
      )}

      {/* Source Reconciliation Modal */}
      {reconcileOutputId !== null && (
        <SourceReconciliationModal
          initialOutputId={reconcileOutputId}
          onClose={() => setReconcileOutputId(null)}
        />
      )}
    </div>
  );
};
