/**
 * Folio Script — Image Merge & Cut System
 * Fullscreen Pan & Zoom Inspection View
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import type { ProcessingOutput } from '../core/types';
import {
  X,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  ChevronLeft,
  ChevronRight,
  Maximize2,
} from 'lucide-react';

interface FullscreenInspectorProps {
  outputs: ProcessingOutput[];
  initialOutputIndex: number;
  onClose: () => void;
}

export const FullscreenInspector: React.FC<FullscreenInspectorProps> = ({
  outputs,
  initialOutputIndex,
  onClose,
}) => {
  const [currentIndex, setCurrentIndex] = useState(initialOutputIndex);
  const [scale, setScale] = useState(1);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);

  const dragStartRef = useRef({ x: 0, y: 0 });
  const posStartRef = useRef({ x: 0, y: 0 });

  const currentOutput = outputs[currentIndex];

  const resetTransform = useCallback(() => {
    setScale(1);
    setPosition({ x: 0, y: 0 });
  }, []);

  const handlePrev = useCallback(() => {
    if (currentIndex > 0) {
      setCurrentIndex((idx) => idx - 1);
      resetTransform();
    }
  }, [currentIndex, resetTransform]);

  const handleNext = useCallback(() => {
    if (currentIndex < outputs.length - 1) {
      setCurrentIndex((idx) => idx + 1);
      resetTransform();
    }
  }, [currentIndex, outputs.length, resetTransform]);

  // Keyboard navigation & zoom
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      } else if (e.key === 'ArrowLeft') {
        handlePrev();
      } else if (e.key === 'ArrowRight') {
        handleNext();
      } else if (e.key === '+' || e.key === '=') {
        setScale((s) => Math.min(s * 1.25, 8));
      } else if (e.key === '-') {
        setScale((s) => Math.max(s * 0.8, 0.2));
      } else if (e.key === '0') {
        resetTransform();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handlePrev, handleNext, onClose, resetTransform]);

  // Wheel zoom
  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const zoomFactor = e.deltaY < 0 ? 1.15 : 0.87;
    setScale((prevScale) => {
      const nextScale = prevScale * zoomFactor;
      return Math.min(Math.max(nextScale, 0.2), 8);
    });
  };

  // Drag pan
  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    setIsPanning(true);
    dragStartRef.current = { x: e.clientX, y: e.clientY };
    posStartRef.current = { ...position };
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isPanning) return;
    const dx = e.clientX - dragStartRef.current.x;
    const dy = e.clientY - dragStartRef.current.y;
    setPosition({
      x: posStartRef.current.x + dx,
      y: posStartRef.current.y + dy,
    });
  };

  const handleMouseUp = () => {
    setIsPanning(false);
  };

  if (!currentOutput) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-[#050508] text-zinc-100 select-none animate-in fade-in duration-100"
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
    >
      {/* Top Inspection Control Bar */}
      <div className="h-14 px-6 border-b border-white/[0.08] bg-[#090a0e] flex items-center justify-between shrink-0 z-10">
        <div className="flex items-center gap-3">
          <div className="p-1.5 rounded-lg bg-zinc-800 text-zinc-300 border border-white/[0.08]">
            <Maximize2 className="w-4 h-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-white tracking-tight">
                {currentOutput.name}
              </span>
              <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-zinc-800 text-zinc-400 border border-white/[0.06]">
                {currentIndex + 1} / {outputs.length}
              </span>
            </div>
            <div className="flex items-center gap-2 text-xs font-mono text-zinc-500">
              <span>
                {currentOutput.width} &times; {currentOutput.height} px
              </span>
              <span>&bull;</span>
              <span>{currentOutput.contributingSources.length} source image(s)</span>
            </div>
          </div>
        </div>

        {/* Zoom & Transform Controls */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setScale((s) => Math.min(s * 1.25, 8))}
            className="p-1.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-white/[0.08] text-zinc-300 hover:text-white transition-colors cursor-pointer"
            title="Zoom In (+)"
          >
            <ZoomIn className="w-4 h-4" />
          </button>
          <span className="text-xs font-mono text-zinc-400 min-w-[50px] text-center">
            {Math.round(scale * 100)}%
          </span>
          <button
            type="button"
            onClick={() => setScale((s) => Math.max(s * 0.8, 0.2))}
            className="p-1.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-white/[0.08] text-zinc-300 hover:text-white transition-colors cursor-pointer"
            title="Zoom Out (-)"
          >
            <ZoomOut className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={resetTransform}
            className="p-1.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-white/[0.08] text-zinc-300 hover:text-white transition-colors cursor-pointer"
            title="Reset Zoom & Pan (0)"
          >
            <RotateCcw className="w-4 h-4" />
          </button>

          <div className="h-5 w-px bg-white/[0.1] mx-2" />

          {/* Close */}
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-white/[0.08] text-zinc-300 hover:text-white transition-colors cursor-pointer"
            title="Close Inspector (Esc)"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Main Canvas Viewport */}
      <div
        className="flex-1 overflow-hidden relative flex items-center justify-center cursor-grab active:cursor-grabbing bg-[#030305]"
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
      >
        {currentOutput.previewUrl ? (
          <div
            style={{
              transform: `translate(${position.x}px, ${position.y}px) scale(${scale})`,
              transformOrigin: 'center center',
              transition: isPanning ? 'none' : 'transform 0.08s ease-out',
            }}
            className="pointer-events-none flex items-center justify-center"
          >
            <img
              src={currentOutput.previewUrl}
              alt={currentOutput.name}
              className="max-h-[85vh] max-w-[85vw] object-contain shadow-2xl rounded-sm"
              draggable={false}
            />
          </div>
        ) : (
          <div className="text-zinc-600 font-mono text-xs">Preview unavailable</div>
        )}

        {/* Floating Navigation Controls */}
        {currentIndex > 0 && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              handlePrev();
            }}
            className="absolute left-6 top-1/2 -translate-y-1/2 p-3 rounded-full bg-zinc-900/80 hover:bg-zinc-800 border border-white/[0.12] text-zinc-200 hover:text-white shadow-xl backdrop-blur-md transition-all cursor-pointer"
            title="Previous Output (Left Arrow)"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
        )}

        {currentIndex < outputs.length - 1 && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              handleNext();
            }}
            className="absolute right-6 top-1/2 -translate-y-1/2 p-3 rounded-full bg-zinc-900/80 hover:bg-zinc-800 border border-white/[0.12] text-zinc-200 hover:text-white shadow-xl backdrop-blur-md transition-all cursor-pointer"
            title="Next Output (Right Arrow)"
          >
            <ChevronRight className="w-5 h-5" />
          </button>
        )}
      </div>

      {/* Bottom Inspection Strip */}
      <div className="h-10 px-6 border-t border-white/[0.06] bg-[#07070a] flex items-center justify-between shrink-0 text-[11px] font-mono text-zinc-500">
        <div className="flex items-center gap-4">
          <span>Click and drag to pan</span>
          <span>&bull;</span>
          <span>Scroll wheel to zoom</span>
          <span>&bull;</span>
          <span>Arrow keys to switch outputs</span>
        </div>
        <div>
          <span>Press ESC to return</span>
        </div>
      </div>
    </div>
  );
};
