/**
 * Folio Script — Scan Floating Panel
 * Dedicated scanning floating window with Page / Chapter triggers, engine switches, and Scanning settings routing.
 */

import React, { useState } from 'react';
import { 
  Sparkles, 
  Settings, 
  Loader2,
  Scan,
  CheckCircle2
} from 'lucide-react';
import { FloatingWindow } from '../Tools/FloatingWindow';

interface ScanFloatingPanelProps {
  isOpen: boolean;
  onClose: () => void;
  onOpenSettings: (category: 'scanning') => void;
  onScanThisPage: () => void;
  onScanAll: () => void;
  isScanningSinglePage: boolean;
  isScanningActive: boolean;
  scanProgressText?: string | null;
}

export const ScanFloatingPanel: React.FC<ScanFloatingPanelProps> = ({
  isOpen,
  onClose,
  onOpenSettings,
  onScanThisPage,
  onScanAll,
  isScanningSinglePage,
  isScanningActive,
  scanProgressText,
}) => {
  const [enginePreset, setEnginePreset] = useState<'fast' | 'precision' | 'balanced'>('balanced');
  const [autoDetectBubbles, setAutoDetectBubbles] = useState(true);
  const [contourSnapping, setContourSnapping] = useState(true);
  const [strictSfxGating, setStrictSfxGating] = useState(true);

  const isBusy = isScanningSinglePage || isScanningActive;

  return (
    <FloatingWindow
      isOpen={isOpen}
      title="Scanlation Engine"
      storageKey="folio_scan_floating_panel_geom_v1"
      defaultGeometry={{ x: 600, y: 100, width: 360, height: 420 }}
      minWidth={320}
      minHeight={360}
      headerRight={
        <button
          type="button"
          onClick={() => onOpenSettings('scanning')}
          title="Open Scanning Settings"
          className="w-6 h-6 flex items-center justify-center text-zinc-400 hover:text-white hover:bg-white/10 rounded cursor-pointer transition-colors"
        >
          <Settings className="w-3.5 h-3.5" />
        </button>
      }
      headerBadge={
        isScanningActive ? (
          <span className="px-1.5 py-0.2 rounded-full bg-blue-500/20 text-blue-300 font-mono text-[10px] border border-blue-400/30 animate-pulse">
            Active
          </span>
        ) : undefined
      }
      closeTitle="Close Scanner"
      onClose={onClose}
    >
      <div className="flex-1 min-h-0 flex flex-col justify-between p-3 gap-3 overflow-hidden text-xs">
        {/* Action Triggers */}
        <div className="space-y-1.5 shrink-0">
          <div className="text-[10px] font-mono uppercase tracking-wider text-zinc-500">
            Scan Actions
          </div>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              disabled={isBusy}
              onClick={onScanThisPage}
              className={`h-9 px-3 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 transition-all shadow-xs cursor-pointer ${
                isScanningSinglePage
                  ? 'bg-blue-600 text-white animate-pulse'
                  : 'bg-zinc-900 border border-white/[0.12] hover:bg-zinc-800 text-white active:scale-95'
              }`}
            >
              {isScanningSinglePage ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin text-white" />
              ) : (
                <Sparkles className="w-3.5 h-3.5 text-blue-400" />
              )}
              <span>Scan Page</span>
            </button>

            <button
              type="button"
              disabled={isBusy}
              onClick={onScanAll}
              className={`h-9 px-3 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 transition-all shadow-xs cursor-pointer ${
                isScanningActive
                  ? 'bg-blue-500 text-white animate-pulse'
                  : 'bg-blue-600 hover:bg-blue-500 text-white active:scale-95'
              }`}
            >
              {isScanningActive ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin text-white" />
              ) : (
                <Scan className="w-3.5 h-3.5 text-white" />
              )}
              <span>{isScanningActive && scanProgressText ? scanProgressText : 'Scan All'}</span>
            </button>
          </div>
        </div>

        {/* Engine Preset Selector */}
        <div className="bg-[#090a0e] border border-white/[0.06] rounded-xl p-2.5 space-y-1.5 shrink-0">
          <label className="text-[10px] font-mono uppercase tracking-wider text-zinc-500 block">
            Engine Preset
          </label>
          <div className="grid grid-cols-3 gap-1 bg-[#050608] border border-white/[0.08] p-1 rounded-lg">
            <button
              type="button"
              onClick={() => setEnginePreset('fast')}
              className={`py-1 rounded text-[11px] font-medium transition-colors cursor-pointer ${
                enginePreset === 'fast'
                  ? 'bg-white text-black font-semibold shadow-xs'
                  : 'text-zinc-400 hover:text-white'
              }`}
            >
              Fast
            </button>
            <button
              type="button"
              onClick={() => setEnginePreset('balanced')}
              className={`py-1 rounded text-[11px] font-medium transition-colors cursor-pointer ${
                enginePreset === 'balanced'
                  ? 'bg-blue-600 text-white font-semibold shadow-xs'
                  : 'text-zinc-400 hover:text-white'
              }`}
            >
              Balanced
            </button>
            <button
              type="button"
              onClick={() => setEnginePreset('precision')}
              className={`py-1 rounded text-[11px] font-medium transition-colors cursor-pointer ${
                enginePreset === 'precision'
                  ? 'bg-white text-black font-semibold shadow-xs'
                  : 'text-zinc-400 hover:text-white'
              }`}
            >
              Precision
            </button>
          </div>
        </div>

        {/* Scan Options Switches */}
        <div className="flex-1 min-h-0 bg-[#07070a] border border-white/[0.08] rounded-xl p-3 flex flex-col overflow-y-auto custom-scrollbar space-y-2">
          <div className="text-[10px] font-mono uppercase tracking-wider text-zinc-500 mb-1">
            Engine Controls
          </div>

          <label className="flex items-center justify-between p-1.5 rounded-lg hover:bg-white/[0.03] cursor-pointer">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-3.5 h-3.5 text-blue-400" />
              <span className="text-zinc-200">Auto-Detect Speech Bubbles</span>
            </div>
            <input
              type="checkbox"
              checked={autoDetectBubbles}
              onChange={(e) => setAutoDetectBubbles(e.target.checked)}
              className="rounded accent-blue-500 cursor-pointer"
            />
          </label>

          <label className="flex items-center justify-between p-1.5 rounded-lg hover:bg-white/[0.03] cursor-pointer">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-3.5 h-3.5 text-blue-400" />
              <span className="text-zinc-200">Organic Contour Snapping</span>
            </div>
            <input
              type="checkbox"
              checked={contourSnapping}
              onChange={(e) => setContourSnapping(e.target.checked)}
              className="rounded accent-blue-500 cursor-pointer"
            />
          </label>

          <label className="flex items-center justify-between p-1.5 rounded-lg hover:bg-white/[0.03] cursor-pointer">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-3.5 h-3.5 text-blue-400" />
              <span className="text-zinc-200">Strict SFX Gating</span>
            </div>
            <input
              type="checkbox"
              checked={strictSfxGating}
              onChange={(e) => setStrictSfxGating(e.target.checked)}
              className="rounded accent-blue-500 cursor-pointer"
            />
          </label>
        </div>

        {/* Footer Note */}
        <div className="text-[11px] font-mono text-zinc-500 px-1 shrink-0 flex items-center justify-between">
          <span>Engine presets calibrate speed and segmentation depth.</span>
        </div>
      </div>
    </FloatingWindow>
  );
};
