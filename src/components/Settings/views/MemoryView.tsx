import React from 'react';
import { SettingRow } from '../SettingRow';
import { SettingsSwitch } from '../SettingsSwitch';

export interface MemoryViewProps {
  getVal: <T>(key: string) => T;
  setVal: (key: string, val: any) => void;
}

export const MemoryView: React.FC<MemoryViewProps> = ({ getVal, setVal }) => {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-sm font-mono uppercase font-semibold tracking-wider text-zinc-100">
          Project Memory
        </h2>
      </div>

      <div className="space-y-1">
        {/* Knowledge Learning Mode */}
        <SettingRow
          label="Knowledge Learning Mode"
          description="Dictates how character relationships, glossary entries, and proper nouns are ingested into series memory."
          layout="vertical"
        >
          <div className="grid grid-cols-3 gap-2 mt-1">
            {[
              { id: 'candidate_only', name: 'Candidate Only' },
              { id: 'autonomous_observed', name: 'Autonomous' },
              { id: 'disabled', name: 'Disabled' },
            ].map((m) => {
              const active = getVal<string>('memory.learning_mode') === m.id;
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setVal('memory.learning_mode', m.id)}
                  className={`py-3 px-2 rounded-xl border text-center transition-all cursor-pointer ${
                    active
                      ? 'bg-white border-white text-zinc-950 font-semibold shadow-sm'
                      : 'bg-[#0e0f14] border-white/[0.08] text-zinc-300 hover:text-white hover:bg-white/[0.04]'
                  }`}
                >
                  <div className="text-xs font-medium tracking-tight">{m.name}</div>
                </button>
              );
            })}
          </div>
        </SettingRow>

        {/* Cross-Chapter Knowledge Propagation */}
        <SettingRow
          label="Cross-Chapter Knowledge Propagation"
          description="Propagates verified characters, glossary terminology, and honorific rules across all project chapters."
        >
          <SettingsSwitch
            id="memory.cross_chapter_learning"
            ariaLabel="Cross-Chapter Knowledge Propagation"
            checked={Boolean(getVal<boolean>('memory.cross_chapter_learning'))}
            onChange={(checked) => setVal('memory.cross_chapter_learning', checked)}
          />
        </SettingRow>

        {/* Context Token Budget Cap */}
        <SettingRow
          label="Context Token Budget Cap"
          description="Maximum token allocation reserved for series memory injection into prompt windows."
          layout="vertical"
        >
          <div className="space-y-1.5 mt-1">
            <div className="flex justify-between text-xs font-mono text-zinc-400">
              <span>Token Budget</span>
              <span className="text-zinc-200 font-medium">
                {getVal<number>('memory.context_budget_tokens') ?? 2000} tokens
              </span>
            </div>
            <input
              type="range"
              min={500}
              max={6000}
              step={250}
              value={getVal<number>('memory.context_budget_tokens') ?? 2000}
              onChange={(e) => setVal('memory.context_budget_tokens', Number(e.target.value))}
              className="w-full accent-white"
            />
          </div>
        </SettingRow>
      </div>
    </div>
  );
};
