import React from 'react';
import { Eye, EyeOff, Activity } from 'lucide-react';
import { SettingRow } from '../SettingRow';
import { SettingsSwitch } from '../SettingsSwitch';
import { GEMINI_MODEL_PROFILES, type GeminiModelKey } from '../../../types/workbench';

export interface GeneralViewProps {
  getVal: <T>(key: string) => T;
  setVal: (key: string, val: any) => void;
  isKeyVisible: boolean;
  setIsKeyVisible: React.Dispatch<React.SetStateAction<boolean>>;
  connectionStatus: 'idle' | 'testing' | 'connected' | 'failed';
  pingMs: number | null;
  errorMessage: string | null;
  onTestConnection: () => void;
}

export const GeneralView: React.FC<GeneralViewProps> = ({
  getVal,
  setVal,
  isKeyVisible,
  setIsKeyVisible,
  connectionStatus,
  pingMs,
  errorMessage,
  onTestConnection,
}) => {
  const currentModel = getVal<string>('translation.model') || 'gemini-3.8-flash';

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-sm font-mono uppercase font-semibold tracking-wider text-zinc-100">
          General Preferences & API Vault
        </h2>
      </div>

      <div className="space-y-1">
        {/* API Key Vault */}
        <SettingRow
          label="Gemini API Key"
          description="Authentication key for Google Gemini multimodal vision, OCR, and Arabic localization requests."
          layout="vertical"
        >
          <div className="relative flex items-center mt-1">
            <input
              type={isKeyVisible ? 'text' : 'password'}
              value={getVal<string>('general.gemini_api_key') || ''}
              onChange={(e) => setVal('general.gemini_api_key', e.target.value)}
              placeholder="Enter Gemini API key (AIzaSy...)"
              className="w-full pl-3 pr-10 py-2 rounded-md bg-[#050508] border border-white/[0.10] text-zinc-100 font-mono text-xs focus:outline-none focus:border-white/30"
            />
            <button
              type="button"
              onClick={() => setIsKeyVisible((prev) => !prev)}
              aria-label={isKeyVisible ? 'Hide API key' : 'Show API key'}
              className="absolute right-2.5 p-1 text-zinc-500 hover:text-zinc-300 transition-colors cursor-pointer"
            >
              {isKeyVisible ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
            </button>
          </div>
        </SettingRow>

        {/* Vision & Translation Model Selector */}
        <SettingRow
          label="Vision & Translation Model"
          description="Multimodal neural model utilized for image OCR, spatial text reasoning, and scanlation translation."
          layout="vertical"
        >
          <div className="space-y-2 mt-1">
            <select
              value={currentModel}
              onChange={(e) => setVal('translation.model', e.target.value)}
              className="w-full px-3 py-2 rounded-md bg-[#050508] border border-white/[0.10] text-zinc-200 text-xs font-mono focus:outline-none focus:border-white/20"
            >
              {Object.keys(GEMINI_MODEL_PROFILES).map((key) => {
                const profile = GEMINI_MODEL_PROFILES[key as GeminiModelKey];
                return (
                  <option key={key} value={key}>
                    {profile.name} — {profile.description}
                  </option>
                );
              })}
            </select>

            {currentModel === 'custom' && (
              <input
                type="text"
                placeholder="Enter custom model endpoint (e.g. gemini-3.8-pro-preview)..."
                value={getVal<string>('translation.custom_model') || ''}
                onChange={(e) => setVal('translation.custom_model', e.target.value)}
                className="w-full px-3 py-1.5 rounded-md bg-[#050508] border border-white/[0.10] text-zinc-200 text-xs font-mono focus:outline-none focus:border-white/20"
              />
            )}
          </div>
        </SettingRow>

        {/* Telemetry Ping */}
        <SettingRow
          label="Hardware Telemetry & Ping"
          description="Runs a direct latency handshake against the configured model endpoint to measure network round-trip time."
          layout="vertical"
        >
          <div className="flex items-center justify-between gap-4 p-3 rounded-md bg-[#09090c] border border-white/[0.06] mt-1">
            <div className="flex items-center gap-2">
              <Activity className="w-4 h-4 text-zinc-400" />
              <span className="text-xs font-mono text-zinc-300">
                {connectionStatus === 'idle' && 'Endpoint Idle'}
                {connectionStatus === 'testing' && 'Testing Connection...'}
                {connectionStatus === 'connected' && `Connected (${pingMs}ms)`}
                {connectionStatus === 'failed' && `Failed: ${errorMessage || 'Error'}`}
              </span>
            </div>
            <button
              type="button"
              onClick={onTestConnection}
              disabled={connectionStatus === 'testing'}
              className="px-3 py-1.5 rounded bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 text-zinc-200 text-xs font-mono font-medium transition-colors cursor-pointer"
            >
              Test Connection
            </button>
          </div>
        </SettingRow>

        {/* Keep Utility Rail Expanded (Moved from Tweaks) */}
        <SettingRow
          label="Keep Utility Rail Expanded"
          description="When enabled, the Utility Rail stays expanded until explicitly collapsed. When disabled, the rail automatically collapses when the pointer leaves or you click outside."
        >
          <SettingsSwitch
            id="general.keep_utility_rail_expanded"
            ariaLabel="Keep Utility Rail Expanded"
            checked={Boolean(getVal<boolean>('general.keep_utility_rail_expanded'))}
            onChange={(checked) => setVal('general.keep_utility_rail_expanded', checked)}
          />
        </SettingRow>

        {/* Double-Click Confirmation (Moved from Tweaks) */}
        <SettingRow
          label="Double-Click Confirmation"
          description="Requires a deliberate second click to confirm critical actions like page deletion, chapter deletion, or returning to hub."
        >
          <SettingsSwitch
            id="workspace.double_click_confirmation"
            ariaLabel="Double-Click Confirmation for Critical Actions"
            checked={getVal<boolean>('workspace.double_click_confirmation') ?? true}
            onChange={(checked) => setVal('workspace.double_click_confirmation', checked)}
          />
        </SettingRow>
      </div>
    </div>
  );
};
