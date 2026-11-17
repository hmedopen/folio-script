import React from 'react';
import { SettingRow } from '../SettingRow';
import { SettingsSwitch } from '../SettingsSwitch';

export interface ReviewViewProps {
  getVal: <T>(key: string) => T;
  setVal: (key: string, val: any) => void;
}

export const ReviewView: React.FC<ReviewViewProps> = ({ getVal, setVal }) => {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-sm font-mono uppercase font-semibold tracking-wider text-zinc-100">
          Review & Quality Control
        </h2>
      </div>

      <div className="space-y-1">
        {/* Strictness Profile */}
        <SettingRow
          label="Review Strictness Profile"
          description="Governs the sensitivity and audit depth of grammatical, contextual, and terminology checkers."
          layout="vertical"
        >
          <div className="grid grid-cols-3 gap-2 mt-1">
            {[
              { id: 'conservative', name: 'Conservative' },
              { id: 'balanced', name: 'Balanced' },
              { id: 'thorough', name: 'Thorough' },
            ].map((p) => {
              const active = getVal<string>('review.profile') === p.id;
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setVal('review.profile', p.id)}
                  className={`py-3 px-2 rounded-xl border text-center transition-all cursor-pointer ${
                    active
                      ? 'bg-white border-white text-zinc-950 font-semibold shadow-sm'
                      : 'bg-[#0e0f14] border-white/[0.08] text-zinc-300 hover:text-white hover:bg-white/[0.04]'
                  }`}
                >
                  <div className="text-xs font-medium tracking-tight">{p.name}</div>
                </button>
              );
            })}
          </div>
        </SettingRow>

        {/* Source Reliability Gate */}
        <SettingRow
          label="Source Reliability Gate (Abstain on Ambiguous OCR)"
          description="Strictly abstains from raising speculative error flags when source artwork OCR is low-confidence or degraded."
        >
          <SettingsSwitch
            id="review.ambiguous_ocr_abstention"
            ariaLabel="Source Reliability Gate (Abstain on Ambiguous OCR)"
            checked={Boolean(getVal<boolean>('review.ambiguous_ocr_abstention'))}
            onChange={(checked) => setVal('review.ambiguous_ocr_abstention', checked)}
          />
        </SettingRow>

        {/* Automated Correction Batching */}
        <SettingRow
          label="Permit Automated Correction Batching"
          description="Allows verified mechanical corrections (whitespace, punctuation, common typos) to be batch-applied safely."
        >
          <SettingsSwitch
            id="review.auto_correction_eligibility"
            ariaLabel="Permit Automated Correction Batching"
            checked={Boolean(getVal<boolean>('review.auto_correction_eligibility'))}
            onChange={(checked) => setVal('review.auto_correction_eligibility', checked)}
          />
        </SettingRow>
      </div>
    </div>
  );
};
