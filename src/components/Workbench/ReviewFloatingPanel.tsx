/**
 * Folio Script — Review Floating Panel
 * Dedicated review floating window with Page / Chapter triggers, criteria flags, and Review settings routing.
 */

import React, { useState } from 'react';
import { 
  Search, 
  Settings, 
  ShieldCheck, 
  CheckCircle2, 
  Loader2,
} from 'lucide-react';
import { FloatingWindow } from '../Tools/FloatingWindow';

interface ReviewFloatingPanelProps {
  isOpen: boolean;
  onClose: () => void;
  onOpenSettings: (category: 'review') => void;
  onReviewThisPage: () => void;
  onReviewChapter: () => void;
  isReviewingSinglePage: boolean;
  isReviewingChapter: boolean;
  flaggedCount?: number;
}

export const ReviewFloatingPanel: React.FC<ReviewFloatingPanelProps> = ({
  isOpen,
  onClose,
  onOpenSettings,
  onReviewThisPage,
  onReviewChapter,
  isReviewingSinglePage,
  isReviewingChapter,
  flaggedCount = 0,
}) => {
  // Configurable inspection criteria
  const [flagAmbiguousFlow, setFlagAmbiguousFlow] = useState(true);
  const [flagGrammarGender, setFlagGrammarGender] = useState(true);
  const [flagOcrError, setFlagOcrError] = useState(true);
  const [flagMissedDialogue, setFlagMissedDialogue] = useState(true);
  const [flagTyperMismatch, setFlagTyperMismatch] = useState(true);
  const [flagHallucination, setFlagHallucination] = useState(true);

  const isBusy = isReviewingSinglePage || isReviewingChapter;

  return (
    <FloatingWindow
      isOpen={isOpen}
      title="Chapter & Page Review"
      storageKey="folio_review_floating_panel_geom_v1"
      defaultGeometry={{ x: 640, y: 120, width: 360, height: 420 }}
      minWidth={320}
      minHeight={360}
      headerRight={
        <button
          type="button"
          onClick={() => onOpenSettings('review')}
          title="Open Review Settings"
          className="w-6 h-6 flex items-center justify-center text-zinc-400 hover:text-white hover:bg-white/10 rounded cursor-pointer transition-colors"
        >
          <Settings className="w-3.5 h-3.5" />
        </button>
      }
      headerBadge={
        flaggedCount > 0 ? (
          <span className="px-1.5 py-0.2 rounded-full bg-amber-500/20 text-amber-300 font-mono text-[10px] border border-amber-400/30">
            {flaggedCount} Flags
          </span>
        ) : undefined
      }
      closeTitle="Close Review"
      onClose={onClose}
    >
      <div className="flex-1 min-h-0 flex flex-col justify-between p-3 gap-3 overflow-hidden text-xs">
        {/* Action Triggers */}
        <div className="space-y-1.5 shrink-0">
          <div className="text-[10px] font-mono uppercase tracking-wider text-zinc-500">
            Inspection Actions
          </div>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              disabled={isBusy}
              onClick={onReviewThisPage}
              className={`h-9 px-3 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 transition-all shadow-xs cursor-pointer ${
                isReviewingSinglePage
                  ? 'bg-amber-500 text-black animate-pulse'
                  : 'bg-zinc-900 border border-white/[0.12] hover:bg-zinc-800 text-white active:scale-95'
              }`}
            >
              {isReviewingSinglePage ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Search className="w-3.5 h-3.5 text-amber-400" />
              )}
              <span>Review Page</span>
            </button>

            <button
              type="button"
              disabled={isBusy}
              onClick={onReviewChapter}
              className={`h-9 px-3 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 transition-all shadow-xs cursor-pointer ${
                isReviewingChapter
                  ? 'bg-amber-400 text-black animate-pulse'
                  : 'bg-amber-500 hover:bg-amber-400 text-black active:scale-95'
              }`}
            >
              {isReviewingChapter ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin text-black" />
              ) : (
                <ShieldCheck className="w-3.5 h-3.5 text-black" />
              )}
              <span>Review All</span>
            </button>
          </div>
        </div>

        {/* Flag Inspection Criteria Switches */}
        <div className="flex-1 min-h-0 bg-[#07070a] border border-white/[0.08] rounded-xl p-3 flex flex-col overflow-y-auto custom-scrollbar space-y-2">
          <div className="text-[10px] font-mono uppercase tracking-wider text-zinc-500 mb-1">
            Quality Inspection Scope
          </div>

          <label className="flex items-center justify-between p-1.5 rounded-lg hover:bg-white/[0.03] cursor-pointer">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-3.5 h-3.5 text-amber-400" />
              <span className="text-zinc-200">Ambiguous Flow & Reading Order</span>
            </div>
            <input
              type="checkbox"
              checked={flagAmbiguousFlow}
              onChange={(e) => setFlagAmbiguousFlow(e.target.checked)}
              className="rounded accent-amber-500 cursor-pointer"
            />
          </label>

          <label className="flex items-center justify-between p-1.5 rounded-lg hover:bg-white/[0.03] cursor-pointer">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-3.5 h-3.5 text-amber-400" />
              <span className="text-zinc-200">Grammar & Gender Agreement</span>
            </div>
            <input
              type="checkbox"
              checked={flagGrammarGender}
              onChange={(e) => setFlagGrammarGender(e.target.checked)}
              className="rounded accent-amber-500 cursor-pointer"
            />
          </label>

          <label className="flex items-center justify-between p-1.5 rounded-lg hover:bg-white/[0.03] cursor-pointer">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-3.5 h-3.5 text-amber-400" />
              <span className="text-zinc-200">OCR Glitch & Corrupt Glyphs</span>
            </div>
            <input
              type="checkbox"
              checked={flagOcrError}
              onChange={(e) => setFlagOcrError(e.target.checked)}
              className="rounded accent-amber-500 cursor-pointer"
            />
          </label>

          <label className="flex items-center justify-between p-1.5 rounded-lg hover:bg-white/[0.03] cursor-pointer">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-3.5 h-3.5 text-amber-400" />
              <span className="text-zinc-200">Untranslated / Missed Dialogue</span>
            </div>
            <input
              type="checkbox"
              checked={flagMissedDialogue}
              onChange={(e) => setFlagMissedDialogue(e.target.checked)}
              className="rounded accent-amber-500 cursor-pointer"
            />
          </label>

          <label className="flex items-center justify-between p-1.5 rounded-lg hover:bg-white/[0.03] cursor-pointer">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-3.5 h-3.5 text-amber-400" />
              <span className="text-zinc-200">Typer Symbol Syntax Mismatch</span>
            </div>
            <input
              type="checkbox"
              checked={flagTyperMismatch}
              onChange={(e) => setFlagTyperMismatch(e.target.checked)}
              className="rounded accent-amber-500 cursor-pointer"
            />
          </label>

          <label className="flex items-center justify-between p-1.5 rounded-lg hover:bg-white/[0.03] cursor-pointer">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-3.5 h-3.5 text-amber-400" />
              <span className="text-zinc-200">Hallucination & Filler Detection</span>
            </div>
            <input
              type="checkbox"
              checked={flagHallucination}
              onChange={(e) => setFlagHallucination(e.target.checked)}
              className="rounded accent-amber-500 cursor-pointer"
            />
          </label>
        </div>

        {/* Footer Note */}
        <div className="text-[11px] font-mono text-zinc-500 px-1 shrink-0 flex items-center justify-between">
          <span>Rule violations trigger actionable inline review flags.</span>
        </div>
      </div>
    </FloatingWindow>
  );
};
