import React, { useState, useEffect } from 'react';
import { Plus, Trash2, Edit2, Check, X, FileText, Sparkles, Terminal } from 'lucide-react';
import { SettingsSwitch } from '../SettingsSwitch';

export interface SavedPromptItem {
  id: string;
  title: string;
  content: string;
  enabled: boolean;
  createdAt: number;
}

const DEFAULT_PROMPT_PRESETS: { label: string; title: string; content: string }[] = [
  {
    label: 'Murim / Cultivation',
    title: 'Murim & Martial Arts Register',
    content:
      'Adopt ancient martial arts terminology. Render internal energy as طاقة داخلية / تشي, martial sects as طوائف, dantian as دانتيان, cultivation realms with solemn classical weight.',
  },
  {
    label: 'Modern Action',
    title: 'Modern Action & Urban Tone',
    content:
      'Keep dialogue punchy, realistic, and street-level. Avoid archaic expressions. Translate modern military and slang with contemporary Arabic equivalents fit for fast visual pacing.',
  },
  {
    label: 'Recruitment Test',
    title: 'Scanlation Test & Strict Fidelity',
    content:
      'Strict adherence to official scanlation test conventions: do not summarize or omit text. Provide full context notes for puns or cultural references, and flag any ambiguous reading orders.',
  },
];

const STORAGE_KEY = 'folio_saved_prompts_v2';

export interface PromptsViewProps {
  getVal: <T>(key: string) => T;
  setVal: (key: string, val: any) => void;
}

export const PromptsView: React.FC<PromptsViewProps> = ({ getVal, setVal }) => {
  const [prompts, setPrompts] = useState<SavedPromptItem[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch (e) {
      console.warn('Failed to parse saved prompts', e);
    }

    // Seed from legacy master prompt override if present
    const legacyPrompt = getVal<string>('translation.master_prompt_override');
    const legacyActive = Boolean(getVal<boolean>('translation.master_prompt_active'));

    if (legacyPrompt && legacyPrompt.trim().length > 0) {
      return [
        {
          id: `prompt_${Date.now()}`,
          title: 'Primary Custom Directive',
          content: legacyPrompt.trim(),
          enabled: legacyActive,
          createdAt: Date.now(),
        },
      ];
    }

    // Default seeded presets (disabled initially)
    return DEFAULT_PROMPT_PRESETS.map((p, idx) => ({
      id: `prompt_seed_${idx}`,
      title: p.title,
      content: p.content,
      enabled: false,
      createdAt: Date.now() + idx,
    }));
  });

  // State for creating a new prompt
  const [isCreating, setIsCreating] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newContent, setNewContent] = useState('');

  // State for editing an existing prompt
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editContent, setEditContent] = useState('');

  // Sync prompts to localStorage and settings pipeline
  const syncPrompts = (nextPrompts: SavedPromptItem[]) => {
    setPrompts(nextPrompts);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(nextPrompts));
    } catch (e) {
      console.warn('Failed to persist prompts to localStorage', e);
    }

    // Compile enabled prompts into master directive
    const enabledPrompts = nextPrompts.filter((p) => p.enabled);
    const combinedContent = enabledPrompts.map((p) => `### ${p.title}\n${p.content}`).join('\n\n');
    const isActive = enabledPrompts.length > 0 && combinedContent.trim().length > 0;

    setVal('translation.master_prompt_override', combinedContent);
    setVal('translation.master_prompt_active', isActive);
  };

  const handleTogglePrompt = (id: string, enabled: boolean) => {
    const next = prompts.map((p) => (p.id === id ? { ...p, enabled } : p));
    syncPrompts(next);
  };

  const handleDeletePrompt = (id: string) => {
    const next = prompts.filter((p) => p.id !== id);
    syncPrompts(next);
    if (editingId === id) setEditingId(null);
  };

  const handleStartCreate = () => {
    setIsCreating(true);
    setNewTitle('');
    setNewContent('');
    setEditingId(null);
  };

  const handleSaveCreate = () => {
    if (!newTitle.trim() || !newContent.trim()) return;
    const newPrompt: SavedPromptItem = {
      id: `prompt_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      title: newTitle.trim(),
      content: newContent.trim(),
      enabled: true,
      createdAt: Date.now(),
    };
    const next = [newPrompt, ...prompts];
    syncPrompts(next);
    setIsCreating(false);
    setNewTitle('');
    setNewContent('');
  };

  const handleStartEdit = (p: SavedPromptItem) => {
    setEditingId(p.id);
    setEditTitle(p.title);
    setEditContent(p.content);
    setIsCreating(false);
  };

  const handleSaveEdit = (id: string) => {
    if (!editTitle.trim() || !editContent.trim()) return;
    const next = prompts.map((p) =>
      p.id === id ? { ...p, title: editTitle.trim(), content: editContent.trim() } : p
    );
    syncPrompts(next);
    setEditingId(null);
  };

  const handleAddPreset = (preset: (typeof DEFAULT_PROMPT_PRESETS)[0]) => {
    const newPrompt: SavedPromptItem = {
      id: `prompt_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      title: preset.title,
      content: preset.content,
      enabled: true,
      createdAt: Date.now(),
    };
    const next = [newPrompt, ...prompts];
    syncPrompts(next);
  };

  const activeCount = prompts.filter((p) => p.enabled).length;

  return (
    <div className="space-y-6 select-none font-sans">
      {/* Top Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-mono uppercase font-semibold tracking-wider text-zinc-100">
            Custom Prompts & Directives
          </h2>
        </div>

        <button
          type="button"
          onClick={handleStartCreate}
          className="h-8 px-3 rounded-xl bg-white text-black text-xs font-semibold tracking-tight flex items-center gap-1.5 hover:bg-zinc-100 active:scale-[0.98] transition-all shadow-sm cursor-pointer"
        >
          <Plus className="w-3.5 h-3.5 stroke-[2.5]" />
          <span>New Prompt</span>
        </button>
      </div>

      {/* Quick Presets Bar */}
      <div className="p-3 rounded-xl bg-[#07070a] border border-white/[0.06] space-y-2">
        <div className="flex items-center gap-1.5 text-zinc-400">
          <Sparkles className="w-3.5 h-3.5 text-amber-400" />
          <span className="text-[11px] font-mono uppercase font-medium text-zinc-300">
            Quick Preset Directives
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {DEFAULT_PROMPT_PRESETS.map((preset) => (
            <button
              key={preset.label}
              type="button"
              onClick={() => handleAddPreset(preset)}
              className="px-2.5 py-1 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-white/[0.08] text-xs font-medium text-zinc-300 hover:text-white transition-colors cursor-pointer"
            >
              + {preset.label}
            </button>
          ))}
        </div>
      </div>

      {/* Create Prompt Form Drawer */}
      {isCreating && (
        <div className="p-4 rounded-xl bg-[#090a0f] border border-white/[0.14] space-y-3 animate-in fade-in duration-150">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-white tracking-tight flex items-center gap-1.5">
              <FileText className="w-3.5 h-3.5 text-zinc-400" />
              Create New Directive
            </span>
            <button
              type="button"
              onClick={() => setIsCreating(false)}
              className="p-1 rounded text-zinc-500 hover:text-white transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <input
            type="text"
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            placeholder="Prompt Title (e.g. Ancient Murim Terms, Combat Slang)..."
            className="w-full px-3 py-2 rounded-lg bg-[#040406] border border-white/[0.10] text-zinc-100 text-xs font-medium focus:outline-none focus:border-white/30"
          />

          <textarea
            rows={4}
            value={newContent}
            onChange={(e) => setNewContent(e.target.value)}
            placeholder="Enter highest-priority directive instructions injected into model prompt..."
            className="w-full p-3 rounded-lg bg-[#040406] border border-white/[0.10] text-zinc-200 font-mono text-xs focus:outline-none focus:border-white/30 resize-y leading-relaxed"
          />

          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={() => setIsCreating(false)}
              className="px-3 py-1.5 rounded-lg text-xs font-mono text-zinc-400 hover:text-zinc-200 transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSaveCreate}
              disabled={!newTitle.trim() || !newContent.trim()}
              className="px-4 py-1.5 rounded-lg bg-white text-black text-xs font-semibold tracking-tight hover:bg-zinc-100 disabled:opacity-40 transition-all cursor-pointer"
            >
              Save & Enable
            </button>
          </div>
        </div>
      )}

      {/* Prompts List */}
      <div className="space-y-3">
        <div className="flex items-center justify-between text-xs font-mono text-zinc-500 px-1">
          <span>Configured Directives ({prompts.length})</span>
          <span>{activeCount} active</span>
        </div>

        {prompts.length === 0 ? (
          <div className="p-8 text-center rounded-xl border border-dashed border-white/[0.08] bg-[#07070a] space-y-3">
            <Terminal className="w-8 h-8 text-zinc-600 mx-auto" />
            <p className="text-xs text-zinc-400">No custom directives configured.</p>
            <button
              type="button"
              onClick={handleStartCreate}
              className="px-4 py-2 rounded-xl bg-white text-black text-xs font-semibold cursor-pointer hover:bg-zinc-100 transition-colors"
            >
              Create First Prompt
            </button>
          </div>
        ) : (
          prompts.map((p) => {
            const isEditing = editingId === p.id;

            return (
              <div
                key={p.id}
                className={`p-4 rounded-xl border transition-all ${
                  p.enabled
                    ? 'bg-[#09090e] border-white/[0.12] shadow-sm'
                    : 'bg-[#060608] border-white/[0.04] opacity-70 hover:opacity-90'
                }`}
              >
                {isEditing ? (
                  <div className="space-y-3">
                    <input
                      type="text"
                      value={editTitle}
                      onChange={(e) => setEditTitle(e.target.value)}
                      className="w-full px-3 py-1.5 rounded-lg bg-[#030305] border border-white/[0.12] text-zinc-100 text-xs font-medium focus:outline-none focus:border-white/30"
                    />
                    <textarea
                      rows={4}
                      value={editContent}
                      onChange={(e) => setEditContent(e.target.value)}
                      className="w-full p-2.5 rounded-lg bg-[#030305] border border-white/[0.12] text-zinc-200 font-mono text-xs focus:outline-none focus:border-white/30 resize-y leading-relaxed"
                    />
                    <div className="flex items-center justify-end gap-2 pt-1">
                      <button
                        type="button"
                        onClick={() => setEditingId(null)}
                        className="px-3 py-1 rounded-lg text-xs font-mono text-zinc-400 hover:text-zinc-200"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={() => handleSaveEdit(p.id)}
                        className="px-3.5 py-1 rounded-lg bg-white text-black text-xs font-semibold hover:bg-zinc-100"
                      >
                        Save
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-2.5">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <span className="text-xs font-semibold text-white tracking-tight truncate">
                          {p.title}
                        </span>
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-mono font-medium ${
                            p.enabled
                              ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30'
                              : 'bg-zinc-800 text-zinc-500 border border-white/[0.04]'
                          }`}
                        >
                          {p.enabled ? 'ACTIVE' : 'OFF'}
                        </span>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        <SettingsSwitch
                          id={`prompt_toggle_${p.id}`}
                          ariaLabel={`Toggle ${p.title}`}
                          checked={p.enabled}
                          onChange={(checked) => handleTogglePrompt(p.id, checked)}
                        />
                        <button
                          type="button"
                          onClick={() => handleStartEdit(p)}
                          className="p-1 rounded-md text-zinc-500 hover:text-zinc-200 transition-colors cursor-pointer"
                          title="Edit directive"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeletePrompt(p.id)}
                          className="p-1 rounded-md text-zinc-500 hover:text-red-400 transition-colors cursor-pointer"
                          title="Delete directive"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>

                    <p className="text-xs font-mono text-zinc-300 bg-[#040406] p-2.5 rounded-lg border border-white/[0.04] leading-relaxed whitespace-pre-wrap select-text">
                      {p.content}
                    </p>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
