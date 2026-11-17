import React, { useState, useEffect } from 'react';
import {
  Plus,
  FileCode,
  Layers,
  Copy,
  Trash2,
  Activity,
  Database,
  ArrowRight,
  ShieldAlert,
  ArrowLeft,
} from 'lucide-react';
import { trainingStorage } from '../../../services/trainingStorage';
import { isTrainingStudioEnabled } from '../../../lib/training/env';
import { ReferenceSetEditor } from '../../Training/ReferenceSetEditor';
import { AgentPackageModal } from '../../Training/AgentPackageModal';
import { TrainingDiagnosticsView } from '../../Training/TrainingDiagnosticsView';
import { normalizePackageToSet } from '../../../lib/training/trainingPackageValidator';
import { SettingsSwitch } from '../SettingsSwitch';
import type { TrainingReferenceSet } from '../../../types/training';

export const TrainingStudioView: React.FC = () => {
  if (!isTrainingStudioEnabled()) {
    return (
      <div className="p-8 text-center max-w-md mx-auto space-y-3">
        <div className="p-3 rounded-full bg-rose-500/10 border border-rose-500/20 text-rose-400 w-12 h-12 flex items-center justify-center mx-auto">
          <ShieldAlert className="w-6 h-6" />
        </div>
        <h2 className="text-sm font-bold text-white uppercase font-mono tracking-wider">
          Development Access Restricted
        </h2>
        <p className="text-xs text-zinc-400 leading-relaxed">
          The Training Studio is restricted to development environments and is excluded from production builds.
        </p>
      </div>
    );
  }

  const [referenceSets, setReferenceSets] = useState<TrainingReferenceSet[]>([]);
  const [activeEditingSetId, setActiveEditingSetId] = useState<string | null>(null);
  const [isDiagnosticsOpen, setIsDiagnosticsOpen] = useState(false);
  const [isAgentPackageOpen, setIsAgentPackageOpen] = useState(false);
  const [exportTargetSet, setExportTargetSet] = useState<TrainingReferenceSet | null>(null);
  const [cleanupMessage, setCleanupMessage] = useState<string | null>(null);

  const loadSets = async () => {
    let sets = await trainingStorage.getAllReferenceSets();
    if (sets.length === 0) {
      try {
        const res = await fetch('/seed_double_balloon_detection.json');
        if (res.ok) {
          const seedPackage = await res.json();
          const { referenceSet, embeddedImagesToStore } = normalizePackageToSet(seedPackage, {
            preserveVerification: false,
          });
          for (const img of embeddedImagesToStore) {
            const byteCharacters = atob(img.base64);
            const byteNumbers = new Array(byteCharacters.length);
            for (let i = 0; i < byteCharacters.length; i++) {
              byteNumbers[i] = byteCharacters.charCodeAt(i);
            }
            const byteArray = new Uint8Array(byteNumbers);
            const blob = new Blob([byteArray], { type: img.mimeType });
            await trainingStorage.saveTrainingBlob(img.blobKey, blob);
          }
          const saved = await trainingStorage.saveReferenceSet(referenceSet);
          sets = [saved];
        }
      } catch (err) {
        console.warn('[TrainingStudio] Could not auto-seed reference set:', err);
      }
    }
    setReferenceSets(sets);
  };

  useEffect(() => {
    loadSets();
  }, []);

  const handleCreateNewSet = async () => {
    const now = Date.now();
    const newSet: TrainingReferenceSet = {
      id: `ref_set_${now}_${Math.random().toString(36).substring(2, 7)}`,
      title: 'New Reference Set',
      description: '',
      generalInstructions: '',
      targetTasks: ['scanning_classification'],
      enabled: false,
      priority: 50,
      version: 1,
      createdAt: now,
      updatedAt: now,
      examples: [],
    };

    const saved = await trainingStorage.saveReferenceSet(newSet);
    await loadSets();
    setActiveEditingSetId(saved.id);
  };

  const handleDuplicateSet = async (id: string) => {
    const duplicated = await trainingStorage.duplicateReferenceSet(id);
    await loadSets();
    setActiveEditingSetId(duplicated.id);
  };

  const handleDeleteSet = async (id: string, title: string) => {
    if (confirm(`Delete Reference Set "${title}" and all its managed screenshot examples?`)) {
      await trainingStorage.deleteReferenceSet(id);
      await loadSets();
      if (activeEditingSetId === id) {
        setActiveEditingSetId(null);
      }
    }
  };

  const handleToggleEnabled = async (set: TrainingReferenceSet, enabled: boolean) => {
    const updated = { ...set, enabled };
    await trainingStorage.saveReferenceSet(updated);
    await loadSets();
  };

  const handleCleanupOrphanedBlobs = async () => {
    const deletedCount = await trainingStorage.cleanupOrphanedBlobs();
    setCleanupMessage(`Cleaned up ${deletedCount} unreferenced blob${deletedCount !== 1 ? 's' : ''}.`);
    setTimeout(() => setCleanupMessage(null), 3000);
  };

  const activeSet = referenceSets.find((s) => s.id === activeEditingSetId) || null;
  if (activeEditingSetId && activeSet) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between pb-3 border-b border-white/[0.08]">
          <button
            type="button"
            onClick={() => {
              setActiveEditingSetId(null);
              loadSets();
            }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-zinc-900 hover:bg-zinc-800 border border-white/[0.08] text-xs font-semibold text-zinc-200 hover:text-white transition-colors cursor-pointer"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Back to Reference Sets</span>
          </button>
          <span className="text-xs font-mono text-zinc-400 truncate max-w-xs">{activeSet.title}</span>
        </div>
        <ReferenceSetEditor
          referenceSet={activeSet}
          onSave={() => loadSets()}
          onBack={() => {
            setActiveEditingSetId(null);
            loadSets();
          }}
          onDelete={(id) => {
            handleDeleteSet(id, activeSet.title);
            setActiveEditingSetId(null);
          }}
        />
      </div>
    );
  }

  return (
    <div className="space-y-6 select-none font-sans">
      {/* Header & Controls Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-mono uppercase font-semibold tracking-wider text-zinc-100">
            Training Studio
          </h2>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {cleanupMessage && (
            <span className="text-[10px] font-mono text-emerald-400 bg-emerald-950/40 px-2 py-1 rounded border border-emerald-500/30">
              {cleanupMessage}
            </span>
          )}

          <button
            type="button"
            onClick={handleCleanupOrphanedBlobs}
            className="p-1.5 rounded-xl bg-zinc-900 hover:bg-zinc-800 border border-white/[0.08] text-zinc-400 hover:text-white transition-colors cursor-pointer"
            title="Purge unreferenced image blobs from IndexedDB"
          >
            <Database className="w-3.5 h-3.5" />
          </button>

          <button
            type="button"
            onClick={() => setIsDiagnosticsOpen(true)}
            className="h-8 px-3 rounded-xl bg-zinc-900 hover:bg-zinc-800 border border-white/[0.08] text-xs font-medium text-zinc-300 hover:text-white flex items-center gap-1.5 transition-colors cursor-pointer"
            title="Inspect dispatches to Gemini"
          >
            <Activity className="w-3.5 h-3.5 text-zinc-400" />
            <span>Diagnostics</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setExportTargetSet(null);
              setIsAgentPackageOpen(true);
            }}
            className="h-8 px-3 rounded-xl bg-zinc-900 hover:bg-zinc-800 border border-white/[0.08] text-xs font-medium text-zinc-300 hover:text-white flex items-center gap-1.5 transition-colors cursor-pointer"
            title="Import or export agent package"
          >
            <FileCode className="w-3.5 h-3.5 text-zinc-400" />
            <span>Agent Package</span>
          </button>

          <button
            type="button"
            onClick={handleCreateNewSet}
            className="h-8 px-3.5 rounded-xl bg-white text-black text-xs font-semibold tracking-tight flex items-center gap-1.5 hover:bg-zinc-100 active:scale-[0.98] transition-all shadow-sm cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5 stroke-[2.5]" />
            <span>New Set</span>
          </button>
        </div>
      </div>

      {/* Main Content Area */}
      {referenceSets.length === 0 ? (
        <div className="max-w-md mx-auto my-8 p-8 rounded-2xl border border-dashed border-white/[0.10] bg-[#07070a] text-center space-y-4">
          <div className="p-3 rounded-2xl bg-zinc-900 border border-white/[0.10] text-zinc-300 w-12 h-12 flex items-center justify-center mx-auto">
            <Layers className="w-6 h-6" />
          </div>

          <div>
            <h3 className="text-sm font-semibold text-white">No Reference Sets Configured</h3>
            <p className="text-xs text-zinc-400 mt-1 leading-relaxed">
              Create a reference set to provide task-scoped multimodal screenshot examples and instructions to Gemini during scanning, classification, and translation.
            </p>
          </div>

          <div className="pt-2 flex items-center justify-center gap-3">
            <button
              type="button"
              onClick={handleCreateNewSet}
              className="px-4 py-2 rounded-xl bg-white text-black text-xs font-semibold hover:bg-zinc-100 transition-colors cursor-pointer"
            >
              Create Reference Set
            </button>
            <button
              type="button"
              onClick={() => {
                setExportTargetSet(null);
                setIsAgentPackageOpen(true);
              }}
              className="px-4 py-2 rounded-xl bg-zinc-900 hover:bg-zinc-800 text-zinc-300 border border-white/[0.08] text-xs font-medium transition-colors cursor-pointer"
            >
              Import Package
            </button>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {referenceSets.map((set) => (
            <div
              key={set.id}
              className={`rounded-xl border p-4 flex flex-col justify-between space-y-3 transition-all ${
                set.enabled
                  ? 'bg-[#09090e] border-white/[0.14] shadow-sm'
                  : 'bg-[#060608] border-white/[0.06] opacity-75 hover:opacity-95'
              }`}
            >
              {/* Top metadata row */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-[10px] px-2 py-0.5 rounded bg-zinc-900 text-zinc-400 border border-white/[0.06]">
                    Priority {set.priority} • v{set.version}
                  </span>

                  <div className="flex items-center gap-2">
                    <span className={`text-[10px] font-mono font-semibold ${set.enabled ? 'text-emerald-400' : 'text-zinc-500'}`}>
                      {set.enabled ? 'ACTIVE' : 'OFF'}
                    </span>
                    <SettingsSwitch
                      id={`training_set_toggle_${set.id}`}
                      ariaLabel={`Toggle ${set.title}`}
                      checked={set.enabled}
                      onChange={(checked) => handleToggleEnabled(set, checked)}
                    />
                  </div>
                </div>

                <h3 className="font-semibold text-white text-xs tracking-tight">{set.title}</h3>
                {set.description ? (
                  <p className="text-zinc-400 text-xs line-clamp-2 leading-relaxed">{set.description}</p>
                ) : (
                  <p className="text-zinc-600 text-xs italic">No description provided</p>
                )}
              </div>

              {/* Target tasks tags */}
              <div className="flex items-center gap-1.5 flex-wrap">
                {(set.targetTasks || []).map((t) => (
                  <span
                    key={t}
                    className="px-2 py-0.5 rounded-md text-[10px] font-mono bg-zinc-900 text-zinc-300 border border-white/[0.06]"
                  >
                    {t}
                  </span>
                ))}
              </div>

              {/* Bottom actions row */}
              <div className="pt-2.5 border-t border-white/[0.06] flex items-center justify-between">
                <span className="font-mono text-xs text-zinc-500">
                  {set.examples.length} example{set.examples.length !== 1 ? 's' : ''}
                </span>

                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => handleDuplicateSet(set.id)}
                    className="p-1.5 rounded-lg text-zinc-500 hover:text-zinc-200 transition-colors cursor-pointer"
                    title="Duplicate Set"
                  >
                    <Copy className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setExportTargetSet(set);
                      setIsAgentPackageOpen(true);
                    }}
                    className="p-1.5 rounded-lg text-zinc-500 hover:text-zinc-200 transition-colors cursor-pointer"
                    title="Export Package"
                  >
                    <FileCode className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDeleteSet(set.id, set.title)}
                    className="p-1.5 rounded-lg text-zinc-500 hover:text-rose-400 transition-colors cursor-pointer"
                    title="Delete Set"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveEditingSetId(set.id)}
                    className="h-7 px-2.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 text-zinc-200 hover:text-white font-mono text-xs font-medium border border-white/[0.08] ml-1 flex items-center gap-1 cursor-pointer transition-colors"
                  >
                    <span>Edit</span>
                    <ArrowRight className="w-3 h-3 text-zinc-400" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Diagnostics Modal */}
      {isDiagnosticsOpen && <TrainingDiagnosticsView onClose={() => setIsDiagnosticsOpen(false)} />}

      {/* Agent Package Modal */}
      {isAgentPackageOpen && (
        <AgentPackageModal
          isOpen={isAgentPackageOpen}
          onClose={() => {
            setIsAgentPackageOpen(false);
            setExportTargetSet(null);
          }}
          onPackageImported={(newSet) => {
            loadSets();
            setActiveEditingSetId(newSet.id);
          }}
          exportSet={exportTargetSet}
        />
      )}
    </div>
  );
};
