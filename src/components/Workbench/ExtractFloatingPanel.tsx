/**
 * Folio Script — Extract Floating Panel
 * Rebuilt from TypeR exporter with screenshot defaults, compact floating layout, and Workspace settings hook.
 */

import React, { useState, useMemo } from 'react';
import { 
  Copy, 
  Download, 
  Check, 
  Settings,
} from 'lucide-react';
import { FloatingWindow } from '../Tools/FloatingWindow';
import type { BubbleItem } from '../../types/workbench';
import { loadTyperSettings } from '../../types/typers';
import { compileTypeRScript, compileRawTextExtract } from '../../lib/compileTypeR';
import { settingsService } from '../../services/settings/settingsService';

interface ExtractFloatingPanelProps {
  isOpen: boolean;
  onClose: () => void;
  onOpenSettings: (category: 'workspace') => void;
  bubbles: BubbleItem[];
  allChapterPages?: { pageIndex: number; bubbles: BubbleItem[] }[];
  chapterName?: string;
  activePageIndex?: number;
}

export const ExtractFloatingPanel: React.FC<ExtractFloatingPanelProps> = ({
  isOpen,
  onClose,
  onOpenSettings,
  bubbles,
  allChapterPages,
  chapterName = 'CHAPTER 01',
  activePageIndex = 1,
}) => {
  const [typerSettings] = useState(() => loadTyperSettings());

  // Defaults strictly matched to Screenshot 7
  const [exportMode, setExportMode] = useState<'raw_text' | 'typer_script'>('typer_script');
  const [scope, setScope] = useState<'entire' | 'active'>('entire');
  const [includePageHeaders, setIncludePageHeaders] = useState(true);
  const [includeIndexTags, setIncludeIndexTags] = useState(false);
  const [includePrefixTags, setIncludePrefixTags] = useState(true);
  const [includeSourceComments, setIncludeSourceComments] = useState(false);
  const [includeFlagNotes, setIncludeFlagNotes] = useState(false);
  const [isCopied, setIsCopied] = useState(false);

  // Compile target pages according to selected scope
  const targetPages = useMemo(() => {
    if (scope === 'active' || !allChapterPages || allChapterPages.length === 0) {
      return [{ pageIndex: activePageIndex, bubbles }];
    }
    return allChapterPages;
  }, [scope, allChapterPages, activePageIndex, bubbles]);

  const generatedScript = useMemo(() => {
    const includeSFX = settingsService.getEffectiveValue<boolean>('scanning.include_sfx').value;

    if (exportMode === 'raw_text') {
      return compileRawTextExtract({
        chapterName,
        pages: targetPages,
        includePageHeaders,
        includeIndexTags,
        includePrefixTags,
        symbolPosition: typerSettings.symbolPosition,
        textDirection: typerSettings.textDirection,
        includeSFX,
      });
    }

    return compileTypeRScript({
      chapterName,
      pages: targetPages,
      includePageHeaders,
      includeIndexTags,
      includePrefixTags,
      symbolPosition: typerSettings.symbolPosition,
      includeSourceComments,
      includeFlagNotes,
      includeSFX,
    });
  }, [
    exportMode,
    chapterName,
    targetPages,
    includePageHeaders,
    includeIndexTags,
    includePrefixTags,
    typerSettings.symbolPosition,
    typerSettings.textDirection,
    includeSourceComments,
    includeFlagNotes,
  ]);

  const handleCopy = () => {
    navigator.clipboard.writeText(generatedScript).catch(() => {});
    setIsCopied(true);
    setTimeout(() => setIsCopied(false), 2000);
  };

  const handleDownload = () => {
    const filename = `${chapterName.toLowerCase().replace(/[^a-z0-9_-]/g, '_')}_${exportMode === 'typer_script' ? 'typer' : 'raw'}.txt`;
    const blob = new Blob([generatedScript], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const lineCount = useMemo(() => {
    return generatedScript ? generatedScript.split('\n').length : 0;
  }, [generatedScript]);

  return (
    <FloatingWindow
      isOpen={isOpen}
      title="TypeR Script Exporter"
      storageKey="folio_extract_floating_panel_geom_v1"
      defaultGeometry={{ x: 620, y: 70, width: 440, height: 520 }}
      minWidth={360}
      minHeight={420}
      headerRight={
        <button
          type="button"
          onClick={() => onOpenSettings('workspace')}
          title="Open Workspace Settings"
          className="w-6 h-6 flex items-center justify-center text-zinc-400 hover:text-white hover:bg-white/10 rounded cursor-pointer transition-colors"
        >
          <Settings className="w-3.5 h-3.5" />
        </button>
      }
      closeTitle="Close Exporter"
      onClose={onClose}
    >
      <div className="flex-1 min-h-0 flex flex-col justify-between p-3 gap-2.5 overflow-hidden text-xs">
        {/* Top Controls Split */}
        <div className="grid grid-cols-2 gap-2 shrink-0">
          {/* Format Mode */}
          <div>
            <label className="text-[10px] font-mono uppercase tracking-wider text-zinc-500 block mb-1">
              Format Mode
            </label>
            <div className="flex bg-[#070709] border border-white/[0.08] p-0.5 rounded-lg">
              <button
                type="button"
                onClick={() => setExportMode('raw_text')}
                className={`flex-1 py-1 rounded text-[11px] font-medium transition-colors cursor-pointer ${
                  exportMode === 'raw_text'
                    ? 'bg-white text-black font-semibold shadow-xs'
                    : 'text-zinc-400 hover:text-white'
                }`}
              >
                Raw Text
              </button>
              <button
                type="button"
                onClick={() => setExportMode('typer_script')}
                className={`flex-1 py-1 rounded text-[11px] font-medium transition-colors cursor-pointer ${
                  exportMode === 'typer_script'
                    ? 'bg-sky-600 text-white font-semibold shadow-xs'
                    : 'text-zinc-400 hover:text-white'
                }`}
              >
                TypeR Script
              </button>
            </div>
          </div>

          {/* Export Scope */}
          <div>
            <label className="text-[10px] font-mono uppercase tracking-wider text-zinc-500 block mb-1">
              Export Scope
            </label>
            <div className="flex bg-[#070709] border border-white/[0.08] p-0.5 rounded-lg">
              <button
                type="button"
                onClick={() => setScope('entire')}
                className={`flex-1 py-1 rounded text-[11px] font-medium transition-colors cursor-pointer ${
                  scope === 'entire'
                    ? 'bg-white text-black font-semibold shadow-xs'
                    : 'text-zinc-400 hover:text-white'
                }`}
              >
                Chapter
              </button>
              <button
                type="button"
                onClick={() => setScope('active')}
                className={`flex-1 py-1 rounded text-[11px] font-medium transition-colors cursor-pointer ${
                  scope === 'active'
                    ? 'bg-white text-black font-semibold shadow-xs'
                    : 'text-zinc-400 hover:text-white'
                }`}
              >
                Page {activePageIndex}
              </button>
            </div>
          </div>
        </div>

        {/* Formatting Rules Checks (Solid style checkboxes) */}
        <div className="bg-[#090a0e] border border-white/[0.06] rounded-xl p-2.5 space-y-1.5 shrink-0">
          <label className="text-[10px] font-mono uppercase tracking-wider text-zinc-500 block">
            Formatting Rules
          </label>
          <div className="grid grid-cols-2 gap-x-2 gap-y-1 text-[11px]">
            <label className="flex items-center gap-2 text-zinc-300 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={includePageHeaders}
                onChange={(e) => setIncludePageHeaders(e.target.checked)}
                className="rounded accent-sky-500 cursor-pointer"
              />
              <span>Page Delimiters (###)</span>
            </label>

            <label className="flex items-center gap-2 text-zinc-300 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={includeIndexTags}
                onChange={(e) => setIncludeIndexTags(e.target.checked)}
                className="rounded accent-sky-500 cursor-pointer"
              />
              <span>Bubble Index (#01)</span>
            </label>

            <label className="flex items-center gap-2 text-zinc-300 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={includePrefixTags}
                onChange={(e) => setIncludePrefixTags(e.target.checked)}
                className="rounded accent-sky-500 cursor-pointer"
              />
              <span>Typer Symbols ("", (), %:)</span>
            </label>

            <label className="flex items-center gap-2 text-zinc-300 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={includeSourceComments}
                onChange={(e) => setIncludeSourceComments(e.target.checked)}
                className="rounded accent-sky-500 cursor-pointer"
              />
              <span>Source Comments</span>
            </label>

            <label className="flex items-center gap-2 text-zinc-300 cursor-pointer select-none col-span-2">
              <input
                type="checkbox"
                checked={includeFlagNotes}
                onChange={(e) => setIncludeFlagNotes(e.target.checked)}
                className="rounded accent-sky-500 cursor-pointer"
              />
              <span>QC Flag Notes</span>
            </label>
          </div>
        </div>

        {/* Script Preview Box */}
        <div className="flex-1 min-h-0 flex flex-col bg-[#060709] border border-white/[0.08] rounded-xl overflow-hidden">
          <div className="h-6 px-3 bg-zinc-900/60 border-b border-white/[0.06] flex items-center justify-between text-[10px] font-mono text-zinc-400 shrink-0">
            <span>PREVIEW // UTF-8</span>
            <span>{lineCount} LINES</span>
          </div>
          <pre
            dir="auto"
            className="flex-1 p-2.5 overflow-auto custom-scrollbar font-mono text-[11px] text-zinc-300 whitespace-pre leading-relaxed select-text"
          >
            {generatedScript}
          </pre>
        </div>

        {/* Footer Actions */}
        <div className="flex items-center justify-end gap-2 shrink-0 pt-1">
          <button
            type="button"
            onClick={handleCopy}
            className="h-8 px-3 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-white font-medium text-xs flex items-center gap-1.5 transition-colors cursor-pointer"
          >
            {isCopied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
            <span>{isCopied ? 'Copied' : 'Copy'}</span>
          </button>

          <button
            type="button"
            onClick={handleDownload}
            className="h-8 px-3.5 rounded-lg bg-white hover:bg-zinc-200 text-black font-semibold text-xs flex items-center gap-1.5 transition-colors shadow-sm cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Download .TXT</span>
          </button>
        </div>
      </div>
    </FloatingWindow>
  );
};
