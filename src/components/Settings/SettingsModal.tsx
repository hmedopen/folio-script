import React, { useState, useEffect, useRef, useCallback } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { settingsService } from '../../services/settings/settingsService';
import { useWorkbenchStore } from '../../store/workbenchStore';
import { SETTINGS_REGISTRY } from '../../services/settings/settingsRegistry';
import { loadTyperSettings, saveTyperSettings, DEFAULT_TYPERS, type TyperSettings } from '../../types/typers';

import { SettingsFooter } from './SettingsFooter';
import { SettingsNavigation, type SettingsNavCategory } from './SettingsNavigation';

import { GeneralView } from './views/GeneralView';
import { PromptsView } from './views/PromptsView';
import { WorkspaceView } from './views/WorkspaceView';
import { TranslateView } from './views/TranslateView';
import { ScanningView } from './views/ScanningView';
import { ReviewView } from './views/ReviewView';
import { MemoryView } from './views/MemoryView';
import { QualityView } from './views/QualityView';
import { TrainingStudioView } from './views/TrainingStudioView';

export interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onOpenBenchmark?: () => void;
  projectId?: string | null;
}

const getInitialSettingsValues = (projectId: string | null) => {
  const vals: Record<string, any> = {};
  for (const key of Object.keys(SETTINGS_REGISTRY)) {
    vals[key] = settingsService.getEffectiveValue(key, { projectId }).value;
  }
  return vals;
};

/**
 * SettingsModal — Master Settings Slide-Out Panel.
 *
 * Structure:
 * - Slides in from the RIGHT edge of the screen
 * - Occupies ~50-65% width with responsive boundaries
 * - Overlays the existing workspace cleanly
 * - 2 parts from top to bottom:
 *   1. Settings Content Area (Left, scrolls independently)
 *   2. Categories Navigation Sidebar (Right, pushed to top)
 * - Settings Footer at bottom with Close & Apply
 */
export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  onOpenBenchmark,
  projectId = null,
}) => {
  const [activeCategory, setActiveCategory] = useState<SettingsNavCategory>('general');
  const [, setRevision] = useState(() => settingsService.getRevision());

  // Hardware Telemetry state
  const [connectionStatus, setConnectionStatus] = useState<'idle' | 'testing' | 'connected' | 'failed'>('idle');
  const [pingMs, setPingMs] = useState<number | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isKeyVisible, setIsKeyVisible] = useState(false);

  // Staged Draft & Applied Snapshot State for Unsaved Changes Protection
  const appliedSnapshotRef = useRef<{
    values: Record<string, any>;
    typers: TyperSettings;
  }>({
    values: getInitialSettingsValues(projectId),
    typers: JSON.parse(JSON.stringify(loadTyperSettings())),
  });

  const [draftValues, setDraftValues] = useState<Record<string, any>>(() => appliedSnapshotRef.current.values);
  const [typerSettings, setTyperSettings] = useState<TyperSettings>(() => appliedSnapshotRef.current.typers);
  const [showDiscardConfirm, setShowDiscardConfirm] = useState(false);

  // Sync draft and applied snapshot when panel opens or projectId changes
  useEffect(() => {
    if (isOpen) {
      const vals = getInitialSettingsValues(projectId);
      const typers = loadTyperSettings();
      appliedSnapshotRef.current = {
        values: vals,
        typers: JSON.parse(JSON.stringify(typers)),
      };
      setDraftValues(vals);
      setTyperSettings(typers);
      setShowDiscardConfirm(false);
    }
  }, [isOpen, projectId]);

  // Deep comparison to track actual differences between draft and last applied settings
  const hasUnsavedChanges = useCallback((): boolean => {
    const appliedVals = appliedSnapshotRef.current.values;
    for (const key of Object.keys(draftValues)) {
      const draftVal = draftValues[key];
      const appliedVal = appliedVals[key];
      if (JSON.stringify(draftVal) !== JSON.stringify(appliedVal)) {
        return true;
      }
    }
    const appliedTypers = appliedSnapshotRef.current.typers;
    if (JSON.stringify(typerSettings) !== JSON.stringify(appliedTypers)) {
      return true;
    }
    return false;
  }, [draftValues, typerSettings]);

  const handleRequestClose = useCallback(() => {
    if (!hasUnsavedChanges()) {
      onClose();
    } else {
      setShowDiscardConfirm(true);
    }
  }, [hasUnsavedChanges, onClose]);

  // Keyboard shortcut: Esc to close (guarded with unsaved changes confirmation)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        if (showDiscardConfirm) {
          setShowDiscardConfirm(false);
        } else {
          handleRequestClose();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, showDiscardConfirm, handleRequestClose]);

  useEffect(() => {
    const unsub = settingsService.subscribe(() => {
      setRevision(settingsService.getRevision());
    });
    return () => unsub();
  }, []);

  const getVal = <T,>(key: string): T => {
    if (key in draftValues) {
      return draftValues[key] as T;
    }
    return settingsService.getEffectiveValue<T>(key, { projectId }).value;
  };

  const setVal = (key: string, val: any) => {
    setDraftValues((prev) => ({
      ...prev,
      [key]: val,
    }));
  };

  const handleApply = () => {
    try {
      const appliedVals = appliedSnapshotRef.current.values;
      let sfxChanged = false;
      let newSfxVal = false;

      for (const [key, val] of Object.entries(draftValues)) {
        if (JSON.stringify(val) !== JSON.stringify(appliedVals[key])) {
          const def = SETTINGS_REGISTRY[key];
          const isProjectScope = Boolean(projectId && def?.scope?.includes('project'));
          settingsService.setSettingValue(key, val, {
            projectId: isProjectScope ? projectId : undefined,
            scope: isProjectScope ? 'project' : 'global',
          });
          if (key === 'scanning.include_sfx') {
            sfxChanged = true;
            newSfxVal = Boolean(val);
          }
        }
      }

      if (sfxChanged) {
        useWorkbenchStore.getState().reconcileActiveSFXState(newSfxVal);
      }

      if (JSON.stringify(typerSettings) !== JSON.stringify(appliedSnapshotRef.current.typers)) {
        saveTyperSettings(typerSettings);
      }

      appliedSnapshotRef.current = {
        values: { ...draftValues },
        typers: JSON.parse(JSON.stringify(typerSettings)),
      };

      setRevision(settingsService.getRevision());
    } catch (err) {
      console.error('Failed to apply settings:', err);
      alert(`Failed to apply settings: ${err}`);
    }
  };

  // Telemetry Ping test
  const handleTestConnection = async () => {
    const apiKey = getVal<string>('general.gemini_api_key');
    if (!apiKey || !apiKey.trim()) {
      setConnectionStatus('failed');
      setErrorMessage('API key is empty');
      return;
    }

    setConnectionStatus('testing');
    setErrorMessage(null);

    const model = getVal<string>('translation.model') || 'gemini-3.8-flash';
    const customModel = getVal<string>('translation.custom_model');
    const effectiveModel = model === 'custom' && customModel && customModel.trim() ? customModel.trim() : model;
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${effectiveModel}?key=${apiKey.trim()}`;

    const start = performance.now();
    try {
      const res = await fetch(url);
      const latency = Math.round(performance.now() - start);

      if (res.ok) {
        setPingMs(latency);
        setConnectionStatus('connected');
      } else {
        const errorData = await res.json().catch(() => null);
        setConnectionStatus('failed');
        setErrorMessage(errorData?.error?.message || `HTTP ${res.status}`);
      }
    } catch (err: any) {
      setConnectionStatus('failed');
      setErrorMessage(err?.message || 'Network request failed');
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[55] overflow-hidden flex justify-end">
          {/* 1. Backdrop Dimming (Preserves underlying workspace) */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={handleRequestClose}
            className="fixed inset-0 bg-black/50 backdrop-blur-[2px] cursor-pointer"
            aria-hidden="true"
          />

          {/* 2. Sliding Settings Panel from Right */}
          <motion.div
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', damping: 28, stiffness: 280 }}
            className="relative z-10 w-full sm:w-[85vw] md:w-[65vw] lg:w-[50vw] min-w-[480px] max-w-[800px] h-full bg-[#0b0c10] border-l border-white/[0.08] shadow-[-20px_0_40px_rgba(0,0,0,0.7)] flex flex-col overflow-hidden text-zinc-100 font-sans select-none"
          >
            {/* Clean 2-column split from top to bottom */}
            <div className="flex-1 flex min-h-0 overflow-hidden">
              {/* Settings Content Area (Left, Scrolls independently) */}
              <main className="flex-1 overflow-y-auto custom-scrollbar p-6 bg-[#0b0c10]">
                {activeCategory === 'general' && (
                  <GeneralView
                    getVal={getVal}
                    setVal={setVal}
                    isKeyVisible={isKeyVisible}
                    setIsKeyVisible={setIsKeyVisible}
                    connectionStatus={connectionStatus}
                    pingMs={pingMs}
                    errorMessage={errorMessage}
                    onTestConnection={handleTestConnection}
                  />
                )}

                {activeCategory === 'prompts' && (
                  <PromptsView getVal={getVal} setVal={setVal} />
                )}

                {activeCategory === 'workspace' && (
                  <WorkspaceView
                    getVal={getVal}
                    setVal={setVal}
                    typerSettings={typerSettings}
                    setTyperSettings={setTyperSettings}
                  />
                )}

                {activeCategory === 'translate' && (
                  <TranslateView getVal={getVal} setVal={setVal} />
                )}

                {activeCategory === 'scanning' && (
                  <ScanningView getVal={getVal} setVal={setVal} />
                )}

                {activeCategory === 'review' && (
                  <ReviewView getVal={getVal} setVal={setVal} />
                )}

                {activeCategory === 'memory' && (
                  <MemoryView getVal={getVal} setVal={setVal} />
                )}

                {activeCategory === 'quality' && (
                  <QualityView
                    getVal={getVal}
                    setVal={setVal}
                    onOpenBenchmark={onOpenBenchmark}
                    onCloseSettings={onClose}
                  />
                )}

                {activeCategory === 'training' && (
                  <TrainingStudioView />
                )}
              </main>

              {/* Navigation Sidebar (Fixed to Far Right, Pushed to Top) */}
              <SettingsNavigation
                activeCategory={activeCategory}
                onSelectCategory={setActiveCategory}
              />
            </div>

            {/* Settings Footer */}
            <SettingsFooter
              hasUnsavedChanges={hasUnsavedChanges()}
              onClose={handleRequestClose}
              onApply={handleApply}
            />
          </motion.div>

          {/* Unsaved Changes Confirmation Dialog */}
          {showDiscardConfirm && (
            <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-100">
              <div className="w-full max-w-md bg-[#12131a] border border-white/[0.14] rounded-2xl p-6 shadow-2xl space-y-6">
                <h3 className="text-center text-base font-bold text-white font-mono uppercase tracking-wider">
                  Unsaved Settings Changes
                </h3>
                <div className="flex items-center justify-between px-2 pt-1">
                  <button
                    type="button"
                    onClick={() => {
                      setShowDiscardConfirm(false);
                      setDraftValues({ ...appliedSnapshotRef.current.values });
                      setTyperSettings(JSON.parse(JSON.stringify(appliedSnapshotRef.current.typers)));
                      onClose();
                    }}
                    className="w-[40%] py-2.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-300 font-mono text-xs font-semibold cursor-pointer transition-colors text-center"
                  >
                    Discard Changes & Close
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowDiscardConfirm(false)}
                    className="w-[40%] py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-mono text-xs font-semibold cursor-pointer transition-colors shadow-sm text-center"
                  >
                    Keep Editing
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </AnimatePresence>
  );
};
