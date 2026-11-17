import React from 'react';
import { SettingRow } from '../SettingRow';
import { SettingsSwitch } from '../SettingsSwitch';

export interface TranslateViewProps {
  getVal: <T>(key: string) => T;
  setVal: (key: string, val: any) => void;
}

export const TranslateView: React.FC<TranslateViewProps> = ({ getVal, setVal }) => {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-sm font-mono uppercase font-semibold tracking-wider text-zinc-100">
          Translation & Humanizer
        </h2>
      </div>

      <div className="space-y-1">
        {/* Arabic Eloquence Standard */}
        <SettingRow
          label="Arabic Eloquence Standard"
          description="Dialectal and literary register calibration: 1 = Casual Modern, 2 = Standard Scanlation Literary, 3 = High Classical."
          layout="vertical"
        >
          <div className="grid grid-cols-3 gap-2 mt-1">
            {[
              { level: 1, label: 'Casual Modern' },
              { level: 2, label: 'Standard Literary' },
              { level: 3, label: 'High Classical' },
            ].map((item) => {
              const active = getVal<number>('translation.eloquence') === item.level;
              return (
                <button
                  key={item.level}
                  type="button"
                  onClick={() => setVal('translation.eloquence', item.level)}
                  className={`py-3 px-2 rounded-xl border text-center transition-all cursor-pointer ${
                    active
                      ? 'bg-white border-white text-zinc-950 font-semibold shadow-sm'
                      : 'bg-[#0e0f14] border-white/[0.08] text-zinc-300 hover:text-white hover:bg-white/[0.04]'
                  }`}
                >
                  <div className="text-xs font-medium tracking-tight">{item.label}</div>
                </button>
              );
            })}
          </div>
        </SettingRow>

        {/* Translation Fidelity Mode */}
        <SettingRow
          label="Translation Fidelity Mode"
          description="Fidelity strategy balancing semantic closeness against natural Arabic idiomatic flow."
          layout="vertical"
        >
          <div className="grid grid-cols-3 gap-2 mt-1">
            {[
              { id: 'faithful', name: 'Faithful' },
              { id: 'localized', name: 'Localized' },
              { id: 'expressive', name: 'Expressive' },
            ].map((f) => {
              const active = getVal<string>('translation.fidelity') === f.id;
              return (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setVal('translation.fidelity', f.id)}
                  className={`py-3 px-2 rounded-xl border text-center transition-all cursor-pointer ${
                    active
                      ? 'bg-white border-white text-zinc-950 font-semibold shadow-sm'
                      : 'bg-[#0e0f14] border-white/[0.08] text-zinc-300 hover:text-white hover:bg-white/[0.04]'
                  }`}
                >
                  <div className="text-xs font-medium tracking-tight">{f.name}</div>
                </button>
              );
            })}
          </div>
        </SettingRow>

        {/* Arabic Humanizer Engine */}
        <SettingRow
          label="Arabic Humanizer Engine"
          description="Post-translation neutralization pass that strips synthetic AI cadence and restores human scanlation flow."
        >
          <SettingsSwitch
            id="translation.humanizer_enabled"
            ariaLabel="Arabic Humanizer Engine"
            checked={Boolean(getVal<boolean>('translation.humanizer_enabled'))}
            onChange={(checked) => setVal('translation.humanizer_enabled', checked)}
          />
        </SettingRow>

        {/* Humanizer Intensity (conditional) */}
        {getVal<boolean>('translation.humanizer_enabled') && (
          <SettingRow
            label="Humanizer Intensity Profile"
            description="Aggressiveness of synthetic idiom replacement and rhetorical cadence restoration."
            layout="vertical"
          >
            <div className="grid grid-cols-4 gap-2 mt-1">
              {['light', 'balanced', 'strong', 'maximum'].map((int) => {
                const active = getVal<string>('translation.humanizer_intensity') === int;
                return (
                  <button
                    key={int}
                    type="button"
                    onClick={() => setVal('translation.humanizer_intensity', int)}
                    className={`py-2 px-2 rounded-xl border font-mono text-xs capitalize cursor-pointer text-center transition-all ${
                      active
                        ? 'bg-white border-white text-zinc-950 font-semibold shadow-sm'
                        : 'bg-[#0e0f14] border-white/[0.08] text-zinc-300 hover:text-white hover:bg-white/[0.04]'
                    }`}
                  >
                    {int}
                  </button>
                );
              })}
            </div>
          </SettingRow>
        )}
      </div>
    </div>
  );
};
