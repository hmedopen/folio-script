/**
 * Folio Script — Image Merge & Cut System
 * Source-to-Output Reconciliation & Boundary Correction Interface
 */

import React, { useState, useMemo, useEffect } from 'react';
import type {
  ProcessingSourceImage,
  ProcessingOutput,
  BoundaryIntegrityStatus,
} from '../core/types';
import { processingManager } from '../engine/processingManager';
import {
  X,
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  CheckCircle2,
  Undo2,
  RefreshCw,
  Plus,
  Minus,
  ArrowRight,
  ArrowLeft,
  Layers,
  Sparkles,
  Eye,
} from 'lucide-react';

interface SourceReconciliationModalProps {
  initialOutputId: string;
  onClose: () => void;
}

export const SourceReconciliationModal: React.FC<SourceReconciliationModalProps> = ({
  initialOutputId,
  onClose,
}) => {
  const [session, setSession] = useState(() => processingManager.getSession());
  const [selectedOutputId, setSelectedOutputId] = useState(initialOutputId);
  const [isRebuilding, setIsRebuilding] = useState(false);
  const [filterMode, setFilterMode] = useState<'nearby' | 'all'>('nearby');
  const [searchFilter, setSearchFilter] = useState('');

  // Subscribe to processing manager updates
  useEffect(() => {
    const unsub = processingManager.subscribe((s) => {
      setSession(s);
    });
    return () => unsub();
  }, []);

  const outputs = session?.outputs || [];
  const sourceImages = session?.sourceImages || [];

  const currentOutputIndex = outputs.findIndex((o) => o.id === selectedOutputId);
  const currentOutput = outputs[currentOutputIndex] || outputs[0];

  // Set of source IDs currently in this output
  const activeSourceIdSet = useMemo(() => {
    if (!currentOutput) return new Set<string>();
    return new Set(currentOutput.contributingSources.map((c) => c.sourceImageId));
  }, [currentOutput]);

  // Map each source ID to the output(s) it belongs to
  const sourceAllocationMap = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const src of sourceImages) {
      map.set(src.id, []);
    }
    for (const out of outputs) {
      for (const contrib of out.contributingSources) {
        const arr = map.get(contrib.sourceImageId) || [];
        arr.push(out.name);
        map.set(contrib.sourceImageId, arr);
      }
    }
    return map;
  }, [sourceImages, outputs]);

  // Current boundary integrity status
  const boundaryStatus: BoundaryIntegrityStatus = useMemo(() => {
    return processingManager.getBoundaryStatus();
  }, [session?.outputs, session?.sourceImages]);

  // Filter sources: 'nearby' shows sources belonging to current output +/- 5 neighboring sources
  const visibleSources = useMemo(() => {
    if (filterMode === 'all') {
      if (!searchFilter.trim()) return sourceImages;
      return sourceImages.filter(
        (s) =>
          s.name.toLowerCase().includes(searchFilter.toLowerCase()) ||
          String(s.originalIndex).includes(searchFilter)
      );
    }

    // Nearby mode
    if (!currentOutput || currentOutput.contributingSources.length === 0) {
      return sourceImages.slice(0, 30);
    }

    const sourceIndexMap = new Map(sourceImages.map((s, idx) => [s.id, idx]));
    const currentIndices = currentOutput.contributingSources
      .map((c) => sourceIndexMap.get(c.sourceImageId) ?? -1)
      .filter((i) => i >= 0);

    const minIdx = Math.max(0, Math.min(...currentIndices) - 5);
    const maxIdx = Math.min(sourceImages.length - 1, Math.max(...currentIndices) + 5);

    return sourceImages.slice(minIdx, maxIdx + 1);
  }, [sourceImages, currentOutput, filterMode, searchFilter]);

  // Toggle inclusion of a source in the current output
  const handleToggleSource = async (sourceId: string) => {
    if (!currentOutput || isRebuilding) return;

    setIsRebuilding(true);
    try {
      const currentIds = currentOutput.contributingSources.map((c) => c.sourceImageId);
      let updatedIds: string[];

      if (activeSourceIdSet.has(sourceId)) {
        // Exclude
        updatedIds = currentIds.filter((id) => id !== sourceId);
      } else {
        // Include
        updatedIds = [...currentIds, sourceId];
      }

      await processingManager.updateOutputAllocation(currentOutput.id, updatedIds);
    } catch (err) {
      console.error('Failed to update output allocation:', err);
    } finally {
      setIsRebuilding(false);
    }
  };

  // Quick Action: Adopt boundary image from Next Output
  const handleAdoptFromNext = async () => {
    if (currentOutputIndex >= outputs.length - 1 || isRebuilding) return;
    const nextOutput = outputs[currentOutputIndex + 1];
    if (nextOutput.contributingSources.length === 0) return;

    const firstFromNext = nextOutput.contributingSources[0].sourceImageId;
    setIsRebuilding(true);
    try {
      await processingManager.reassignSource(firstFromNext, currentOutput.id);
    } finally {
      setIsRebuilding(false);
    }
  };

  // Quick Action: Shift last image of this output to Next Output
  const handleShiftToNext = async () => {
    if (currentOutputIndex >= outputs.length - 1 || isRebuilding) return;
    if (currentOutput.contributingSources.length <= 1) return;

    const lastOfThis =
      currentOutput.contributingSources[currentOutput.contributingSources.length - 1].sourceImageId;
    const nextOutput = outputs[currentOutputIndex + 1];

    setIsRebuilding(true);
    try {
      await processingManager.reassignSource(lastOfThis, nextOutput.id);
    } finally {
      setIsRebuilding(false);
    }
  };

  // Quick Action: Adopt last image of Previous Output into this output
  const handleAdoptFromPrev = async () => {
    if (currentOutputIndex <= 0 || isRebuilding) return;
    const prevOutput = outputs[currentOutputIndex - 1];
    if (prevOutput.contributingSources.length === 0) return;

    const lastOfPrev =
      prevOutput.contributingSources[prevOutput.contributingSources.length - 1].sourceImageId;

    setIsRebuilding(true);
    try {
      await processingManager.reassignSource(lastOfPrev, currentOutput.id);
    } finally {
      setIsRebuilding(false);
    }
  };

  // Undo
  const handleUndo = async () => {
    if (isRebuilding) return;
    setIsRebuilding(true);
    try {
      await processingManager.undoAllocation();
    } finally {
      setIsRebuilding(false);
    }
  };

  if (!currentOutput) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md animate-in fade-in duration-100 select-none">
      <div className="w-full max-w-7xl h-[92vh] bg-[#0c0d12] border border-white/[0.12] rounded-2xl shadow-2xl flex flex-col overflow-hidden text-zinc-100 font-sans animate-in zoom-in-95 duration-100">
        {/* Header */}
        <div className="h-14 px-6 border-b border-white/[0.08] bg-[#08080b] flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-1.5 rounded-lg bg-zinc-800/90 border border-white/[0.08] text-amber-400">
              <Layers className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-mono text-xs font-semibold tracking-wider uppercase text-zinc-200">
                  Source Reconciliation Screen
                </span>
                <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-zinc-800 text-zinc-400 border border-white/[0.06]">
                  Output {currentOutputIndex + 1} of {outputs.length}
                </span>
              </div>
              <p className="text-[11px] text-zinc-500">
                Adjust boundary images between outputs. Changes rebuild previews live without loss of source quality.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleUndo}
              disabled={session?.history.length === 0 || isRebuilding}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-900 border border-white/[0.1] text-xs font-mono text-zinc-300 hover:text-white disabled:opacity-40 transition-colors cursor-pointer"
              title="Undo last allocation adjustment"
            >
              <Undo2 className="w-3.5 h-3.5" />
              <span>Undo</span>
            </button>

            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
              title="Done Reconciling"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Boundary Integrity Warning Strip */}
        {!boundaryStatus.isValid && (
          <div className="px-6 py-2 bg-amber-950/40 border-b border-amber-500/30 flex items-center justify-between text-xs text-amber-200 font-mono shrink-0 flex-wrap gap-2">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
              <span>
                {boundaryStatus.unassignedSourceIds.length > 0 &&
                  `${boundaryStatus.unassignedSourceIds.length} source image(s) unassigned. `}
                {boundaryStatus.duplicateSourceIds.length > 0 &&
                  `${boundaryStatus.duplicateSourceIds.length} source image(s) assigned to multiple outputs. `}
                {boundaryStatus.gaps.length > 0 &&
                  `${boundaryStatus.gaps.length} sequence gap(s) detected. `}
                {boundaryStatus.emptyOutputIds.length > 0 &&
                  `${boundaryStatus.emptyOutputIds.length} empty output(s).`}
              </span>
            </div>
            <span className="text-[10px] text-amber-400 font-semibold uppercase tracking-wider">
              Allocation Notice
            </span>
          </div>
        )}

        {/* 2-Column Main Workspace */}
        <div className="flex-1 grid grid-cols-12 min-h-0 overflow-hidden">
          {/* Left Column: Rebuilt Output Live Preview (col-span-6) */}
          <div className="col-span-12 lg:col-span-6 h-full flex flex-col border-r border-white/[0.08] bg-[#07070a]">
            {/* Output Navigation Sub-header */}
            <div className="h-12 px-6 border-b border-white/[0.06] bg-[#090a0d] flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    if (currentOutputIndex > 0) {
                      setSelectedOutputId(outputs[currentOutputIndex - 1].id);
                    }
                  }}
                  disabled={currentOutputIndex <= 0 || isRebuilding}
                  className="p-1 rounded-md bg-zinc-900 border border-white/[0.08] text-zinc-300 hover:text-white disabled:opacity-30 cursor-pointer"
                  title="Previous Output"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>

                <span className="text-xs font-semibold text-white">
                  {currentOutput.name}
                </span>

                <button
                  type="button"
                  onClick={() => {
                    if (currentOutputIndex < outputs.length - 1) {
                      setSelectedOutputId(outputs[currentOutputIndex + 1].id);
                    }
                  }}
                  disabled={currentOutputIndex >= outputs.length - 1 || isRebuilding}
                  className="p-1 rounded-md bg-zinc-900 border border-white/[0.08] text-zinc-300 hover:text-white disabled:opacity-30 cursor-pointer"
                  title="Next Output"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>

              <div className="flex items-center gap-2 text-xs font-mono text-zinc-400">
                {isRebuilding ? (
                  <span className="flex items-center gap-1.5 text-amber-400">
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    <span>Rebuilding...</span>
                  </span>
                ) : (
                  <span>
                    {currentOutput.width} &times; {currentOutput.height} px
                  </span>
                )}
                <span>&bull;</span>
                <span className="text-white font-semibold">
                  {currentOutput.contributingSources.length} sources
                </span>
              </div>
            </div>

            {/* Quick Boundary Shift Controls */}
            <div className="px-6 py-2 bg-[#0a0a0f] border-b border-white/[0.04] flex items-center justify-between text-xs font-mono shrink-0">
              <span className="text-zinc-500 text-[11px]">Quick Boundary Shift:</span>
              <div className="flex items-center gap-2">
                {currentOutputIndex > 0 && (
                  <button
                    type="button"
                    onClick={handleAdoptFromPrev}
                    disabled={isRebuilding}
                    className="px-2 py-1 rounded bg-zinc-900 hover:bg-zinc-800 border border-white/[0.08] text-[11px] text-zinc-300 hover:text-white transition-colors cursor-pointer flex items-center gap-1"
                    title="Pull the last source image of the previous output into this output"
                  >
                    <ArrowLeft className="w-3 h-3 text-zinc-400" />
                    <span>Pull from Prev</span>
                  </button>
                )}

                {currentOutputIndex < outputs.length - 1 && (
                  <>
                    <button
                      type="button"
                      onClick={handleAdoptFromNext}
                      disabled={isRebuilding}
                      className="px-2 py-1 rounded bg-zinc-900 hover:bg-zinc-800 border border-white/[0.08] text-[11px] text-zinc-300 hover:text-white transition-colors cursor-pointer flex items-center gap-1"
                      title="Pull the first source image of the next output into this output"
                    >
                      <Plus className="w-3 h-3 text-emerald-400" />
                      <span>Pull from Next</span>
                    </button>

                    <button
                      type="button"
                      onClick={handleShiftToNext}
                      disabled={isRebuilding || currentOutput.contributingSources.length <= 1}
                      className="px-2 py-1 rounded bg-zinc-900 hover:bg-zinc-800 border border-white/[0.08] text-[11px] text-zinc-300 hover:text-white disabled:opacity-40 transition-colors cursor-pointer flex items-center gap-1"
                      title="Shift the last source image of this output into the next output"
                    >
                      <span>Shift to Next</span>
                      <ArrowRight className="w-3 h-3 text-zinc-400" />
                    </button>
                  </>
                )}
              </div>
            </div>

            {/* Output Scrollable Viewport */}
            <div className="flex-1 overflow-y-auto p-6 flex items-center justify-center custom-scrollbar bg-[#050508]">
              {currentOutput.previewUrl ? (
                <div className="max-w-full shadow-2xl rounded border border-white/[0.08] overflow-hidden bg-black">
                  <img
                    src={currentOutput.previewUrl}
                    alt={currentOutput.name}
                    className="max-h-[68vh] object-contain mx-auto"
                  />
                </div>
              ) : (
                <div className="text-zinc-500 font-mono text-xs">
                  {currentOutput.contributingSources.length === 0
                    ? 'No sources assigned. Select original images on the right.'
                    : 'Rebuilding preview...'}
                </div>
              )}
            </div>
          </div>

          {/* Right Column: Original Source Images List & Selector (col-span-6) */}
          <div className="col-span-12 lg:col-span-6 h-full flex flex-col bg-[#08080b]">
            {/* Source Strip Filter Header */}
            <div className="h-12 px-6 border-b border-white/[0.06] bg-[#090a0d] flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-zinc-200">Original Source Images</span>
                <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-zinc-800 text-zinc-400">
                  {sourceImages.length} Total
                </span>
              </div>

              <div className="flex items-center gap-2">
                <div className="flex rounded-lg bg-zinc-900 p-0.5 border border-white/[0.08] text-[11px] font-mono">
                  <button
                    type="button"
                    onClick={() => setFilterMode('nearby')}
                    className={`px-2.5 py-1 rounded-md transition-colors cursor-pointer ${
                      filterMode === 'nearby'
                        ? 'bg-zinc-800 text-white font-semibold'
                        : 'text-zinc-400 hover:text-white'
                    }`}
                  >
                    Boundary Focus
                  </button>
                  <button
                    type="button"
                    onClick={() => setFilterMode('all')}
                    className={`px-2.5 py-1 rounded-md transition-colors cursor-pointer ${
                      filterMode === 'all'
                        ? 'bg-zinc-800 text-white font-semibold'
                        : 'text-zinc-400 hover:text-white'
                    }`}
                  >
                    All {sourceImages.length}
                  </button>
                </div>
              </div>
            </div>

            {filterMode === 'all' && (
              <div className="px-6 py-2 bg-[#090a0f] border-b border-white/[0.04] shrink-0">
                <input
                  type="text"
                  value={searchFilter}
                  onChange={(e) => setSearchFilter(e.target.value)}
                  placeholder="Filter by image index or filename..."
                  className="w-full h-7 px-3 rounded-lg bg-zinc-900 border border-white/[0.08] text-xs font-mono text-zinc-200 placeholder:text-zinc-600 focus:outline-none"
                />
              </div>
            )}

            {/* Source Images Grid */}
            <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2.5">
                {visibleSources.map((src) => {
                  const isContributing = activeSourceIdSet.has(src.id);
                  const assignedOutputs = sourceAllocationMap.get(src.id) || [];
                  const isAssignedElsewhere =
                    !isContributing && assignedOutputs.length > 0;
                  const isUnassigned = assignedOutputs.length === 0;

                  return (
                    <div
                      key={src.id}
                      onClick={() => handleToggleSource(src.id)}
                      className={`group relative flex flex-col p-2 rounded-xl border transition-all cursor-pointer ${
                        isContributing
                          ? 'bg-sky-950/30 border-sky-500/50 shadow-md ring-1 ring-sky-500/30'
                          : isAssignedElsewhere
                          ? 'bg-zinc-900/40 border-white/[0.06] hover:border-white/[0.16]'
                          : 'bg-amber-950/20 border-amber-500/30 hover:border-amber-500/50'
                      }`}
                    >
                      {/* Thumbnail Container */}
                      <div className="w-full aspect-[3/4] rounded-lg bg-black/60 overflow-hidden relative flex items-center justify-center mb-1.5 border border-white/[0.04]">
                        {src.thumbnailUrl ? (
                          <img
                            src={src.thumbnailUrl}
                            alt={src.name}
                            className="w-full h-full object-cover"
                            loading="lazy"
                          />
                        ) : (
                          <span className="text-[10px] font-mono text-zinc-600">No Thumb</span>
                        )}

                        {/* Top-Right Toggle Indicator */}
                        <div className="absolute top-1.5 right-1.5">
                          {isContributing ? (
                            <div className="w-5 h-5 rounded-md bg-sky-500 text-white flex items-center justify-center shadow">
                              <CheckCircle2 className="w-3.5 h-3.5" />
                            </div>
                          ) : (
                            <div className="w-5 h-5 rounded-md bg-zinc-900/80 border border-white/[0.12] text-zinc-400 group-hover:text-white flex items-center justify-center">
                              <Plus className="w-3 h-3" />
                            </div>
                          )}
                        </div>

                        {/* Top-Left Sequential Badge */}
                        <div className="absolute top-1.5 left-1.5">
                          <span className="px-1.5 py-0.5 rounded bg-black/80 backdrop-blur-sm text-[10px] font-mono font-bold text-zinc-200 border border-white/[0.1]">
                            #{src.originalIndex}
                          </span>
                        </div>
                      </div>

                      {/* Card Info */}
                      <div className="flex flex-col min-w-0">
                        <span className="text-[11px] font-mono text-zinc-300 truncate">
                          {src.name}
                        </span>
                        <div className="flex items-center justify-between text-[10px] font-mono mt-0.5">
                          <span className="text-zinc-500">
                            {src.width}&times;{src.height}
                          </span>

                          {isContributing ? (
                            <span className="text-sky-400 font-semibold">Included</span>
                          ) : isAssignedElsewhere ? (
                            <span className="text-zinc-500 truncate max-w-[80px]" title={assignedOutputs.join(', ')}>
                              {assignedOutputs[0]}
                            </span>
                          ) : (
                            <span className="text-amber-400 font-semibold">Unassigned</span>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="h-16 px-6 border-t border-white/[0.08] bg-[#08080b] flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3 text-xs font-mono text-zinc-400">
            <span>
              Original chapter images: <strong className="text-white">{sourceImages.length}</strong>
            </span>
            <span>&bull;</span>
            <span>
              Contributing to {currentOutput.name}:{' '}
              <strong className="text-sky-400">{currentOutput.contributingSources.length}</strong>
            </span>
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onClose}
              className="h-9 px-5 rounded-xl text-xs font-mono font-semibold bg-white text-zinc-950 hover:bg-zinc-200 active:scale-[0.98] transition-all cursor-pointer shadow-md"
            >
              Confirm & Return to Results
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
