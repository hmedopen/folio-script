import React, { useState, useEffect } from 'react';
import type { Folder } from '../types';
import type {
  ProjectLoreLedger,
  CharacterLore,
  TermLore,
  SpeakerRelationshipLore,
} from '../types/workbench';
import { getProjectLore, saveProjectLore } from '../services/db';
import {
  X,
  Database,
  Users,
  MapPin,
  GitBranch,
  BookOpen,
  Plus,
  Trash2,
  Save,
  Check,
  Search,
} from 'lucide-react';

interface ProjectDataModalProps {
  folder: Folder | null;
  isOpen: boolean;
  onClose: () => void;
}

type TabType = 'characters' | 'terms' | 'relationships' | 'lore';

export const ProjectDataModal: React.FC<ProjectDataModalProps> = ({
  folder,
  isOpen,
  onClose,
}) => {
  const [activeTab, setActiveTab] = useState<TabType>('characters');
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [saveSuccess, setSaveSuccess] = useState(false);

  // Editable Ledger State
  const [characters, setCharacters] = useState<CharacterLore[]>([]);
  const [terms, setTerms] = useState<TermLore[]>([]);
  const [relationships, setRelationships] = useState<SpeakerRelationshipLore[]>([]);
  const [loreNotes, setLoreNotes] = useState<string>('');

  useEffect(() => {
    if (!isOpen || !folder) return;
    setIsLoading(true);
    setSaveSuccess(false);

    getProjectLore(folder.id)
      .then((ledger) => {
        if (ledger) {
          setCharacters(ledger.characters || []);
          setTerms(ledger.terms || []);
          setRelationships(ledger.speakerRelationships || []);
          // Extract setting / lore notes if stored or synthesize
          const notesTerm = (ledger.terms || []).find((t) => t.category === 'setting_notes');
          setLoreNotes(notesTerm?.definition || '');
        } else {
          setCharacters([]);
          setTerms([]);
          setRelationships([]);
          setLoreNotes('');
        }
      })
      .catch((err) => {
        console.warn('Failed to load project lore:', err);
      })
      .finally(() => {
        setIsLoading(false);
      });
  }, [isOpen, folder]);

  const handleSave = async () => {
    if (!folder) return;
    setIsSaving(true);
    try {
      // Filter out empty entries
      const cleanedCharacters = characters.filter((c) => c.nameOriginal.trim() || c.nameArabic.trim());
      const cleanedTerms = terms.filter((t) => t.category !== 'setting_notes' && (t.termOriginal.trim() || t.termArabic.trim()));
      
      if (loreNotes.trim()) {
        cleanedTerms.push({
          id: 'setting_notes',
          termOriginal: 'Setting & Lore',
          termArabic: 'الإعداد والقصة',
          category: 'setting_notes',
          definition: loreNotes.trim(),
        });
      }

      const ledger: ProjectLoreLedger = {
        projectId: folder.id,
        characters: cleanedCharacters,
        terms: cleanedTerms,
        speakerRelationships: relationships.filter((r) => r.speaker.trim() && r.addressee.trim()),
        lastUpdated: Date.now(),
      };

      await saveProjectLore(folder.id, ledger);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 2500);
    } catch (err) {
      console.error('Failed to save project data:', err);
    } finally {
      setIsSaving(false);
    }
  };

  // Add Handlers
  const handleAddCharacter = () => {
    const newChar: CharacterLore = {
      id: `char_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      nameOriginal: '',
      nameArabic: '',
      gender: 'unknown',
      title: '',
      speakingCadence: '',
      aliases: [],
    };
    setCharacters((prev) => [newChar, ...prev]);
  };

  const handleAddTerm = () => {
    const newTerm: TermLore = {
      id: `term_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      termOriginal: '',
      termArabic: '',
      category: 'place',
      definition: '',
    };
    setTerms((prev) => [newTerm, ...prev]);
  };

  const handleAddRelationship = () => {
    const newRel: SpeakerRelationshipLore = {
      id: `rel_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      speaker: '',
      addressee: '',
      tone: 'neutral',
      hierarchy: 'equal',
    };
    setRelationships((prev) => [newRel, ...prev]);
  };

  if (!isOpen || !folder) return null;

  const filteredCharacters = characters.filter(
    (c) =>
      c.nameOriginal.toLowerCase().includes(searchQuery.toLowerCase()) ||
      c.nameArabic.includes(searchQuery) ||
      (c.title && c.title.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  const filteredTerms = terms.filter(
    (t) =>
      t.category !== 'setting_notes' &&
      (t.termOriginal.toLowerCase().includes(searchQuery.toLowerCase()) ||
        t.termArabic.includes(searchQuery) ||
        (t.definition && t.definition.toLowerCase().includes(searchQuery.toLowerCase())))
  );

  const filteredRelationships = relationships.filter(
    (r) =>
      r.speaker.toLowerCase().includes(searchQuery.toLowerCase()) ||
      r.addressee.toLowerCase().includes(searchQuery.toLowerCase()) ||
      r.tone.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-100 select-none">
      <div className="w-full max-w-4xl h-[85vh] bg-[#0c0d12] border border-white/[0.12] rounded-2xl shadow-2xl flex flex-col overflow-hidden text-zinc-100 font-sans">
        {/* Header */}
        <div className="h-14 px-6 border-b border-white/[0.08] bg-[#08080b] flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <Database className="w-5 h-5 text-white stroke-[2]" />
            <div>
              <div className="flex items-center gap-2">
                <span className="font-semibold text-sm tracking-wide text-zinc-100">
                  Project Data & Intelligence
                </span>
                <span className="px-2 py-0.5 rounded text-[11px] font-mono bg-zinc-800 text-zinc-400 border border-white/[0.06]">
                  {folder.name}
                </span>
              </div>
              <p className="text-[11px] text-zinc-500">
                AI-harvested glossary, character profiles, place names, and world lore.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleSave}
              disabled={isSaving}
              className={`h-8 px-3.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer ${
                saveSuccess
                  ? 'bg-emerald-600 text-white'
                  : 'bg-white text-zinc-950 hover:bg-zinc-200 active:scale-95'
              }`}
            >
              {saveSuccess ? (
                <>
                  <Check className="w-3.5 h-3.5" />
                  <span>Saved</span>
                </>
              ) : (
                <>
                  <Save className="w-3.5 h-3.5" />
                  <span>{isSaving ? 'Saving...' : 'Save Data'}</span>
                </>
              )}
            </button>

            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Tab Strip & Search */}
        <div className="px-6 py-2.5 bg-[#090a0e] border-b border-white/[0.06] flex items-center justify-between shrink-0 gap-4">
          <div className="flex items-center gap-1 bg-zinc-900/80 p-1 rounded-xl border border-white/[0.06]">
            <button
              type="button"
              onClick={() => setActiveTab('characters')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
                activeTab === 'characters'
                  ? 'bg-white text-black font-semibold shadow-xs'
                  : 'text-zinc-400 hover:text-white'
              }`}
            >
              <Users className="w-3.5 h-3.5" />
              <span>Characters ({characters.length})</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('terms')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
                activeTab === 'terms'
                  ? 'bg-white text-black font-semibold shadow-xs'
                  : 'text-zinc-400 hover:text-white'
              }`}
            >
              <MapPin className="w-3.5 h-3.5" />
              <span>Places & Terms ({terms.filter((t) => t.category !== 'setting_notes').length})</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('relationships')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
                activeTab === 'relationships'
                  ? 'bg-white text-black font-semibold shadow-xs'
                  : 'text-zinc-400 hover:text-white'
              }`}
            >
              <GitBranch className="w-3.5 h-3.5" />
              <span>Consistency ({relationships.length})</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('lore')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
                activeTab === 'lore'
                  ? 'bg-white text-black font-semibold shadow-xs'
                  : 'text-zinc-400 hover:text-white'
              }`}
            >
              <BookOpen className="w-3.5 h-3.5" />
              <span>Lore & Setting</span>
            </button>
          </div>

          {activeTab !== 'lore' && (
            <div className="relative w-64">
              <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
              <input
                type="text"
                placeholder="Search gathered data..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-8 pr-3 py-1.5 rounded-lg bg-zinc-900/90 border border-white/[0.08] text-xs text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-white/30"
              />
            </div>
          )}
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto p-6 custom-scrollbar bg-[#08080b]">
          {isLoading ? (
            <div className="h-full flex flex-col items-center justify-center text-zinc-500 text-xs font-mono">
              <span>Loading gathered intelligence...</span>
            </div>
          ) : activeTab === 'characters' ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-zinc-400 font-mono">
                  Canonical character names, honorifics, and gender consistency.
                </span>
                <button
                  type="button"
                  onClick={handleAddCharacter}
                  className="flex items-center gap-1.5 px-3 py-1 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-xs font-semibold text-white transition-colors cursor-pointer"
                >
                  <Plus className="w-3 h-3" />
                  <span>Add Character</span>
                </button>
              </div>

              {filteredCharacters.length === 0 ? (
                <div className="py-12 text-center text-zinc-500 text-xs font-mono border border-dashed border-white/[0.08] rounded-xl">
                  No characters recorded yet. Characters are automatically harvested during chapter scans or added manually.
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {filteredCharacters.map((char, idx) => (
                    <div
                      key={char.id || idx}
                      className="p-3.5 rounded-xl bg-zinc-900/60 border border-white/[0.08] space-y-2.5 relative group"
                    >
                      <button
                        type="button"
                        onClick={() => setCharacters((prev) => prev.filter((_, i) => i !== idx))}
                        className="absolute right-3 top-3 text-zinc-500 hover:text-rose-400 opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                        title="Delete Character"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>

                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="text-[10px] uppercase font-mono text-zinc-500 block mb-1">
                            Original Name
                          </label>
                          <input
                            type="text"
                            value={char.nameOriginal}
                            onChange={(e) => {
                              const val = e.target.value;
                              setCharacters((prev) =>
                                prev.map((c, i) => (i === idx ? { ...c, nameOriginal: val } : c))
                              );
                            }}
                            placeholder="e.g. Sung Jin-Woo"
                            className="w-full px-2.5 py-1.5 rounded-lg bg-black/60 border border-white/[0.08] text-xs text-zinc-200 focus:outline-none focus:border-white/30"
                          />
                        </div>
                        <div>
                          <label className="text-[10px] uppercase font-mono text-zinc-500 block mb-1">
                            Arabic Name
                          </label>
                          <input
                            type="text"
                            value={char.nameArabic}
                            onChange={(e) => {
                              const val = e.target.value;
                              setCharacters((prev) =>
                                prev.map((c, i) => (i === idx ? { ...c, nameArabic: val } : c))
                              );
                            }}
                            dir="rtl"
                            placeholder="e.g. سونغ جين وو"
                            className="w-full px-2.5 py-1.5 rounded-lg bg-black/60 border border-white/[0.08] text-xs text-zinc-200 focus:outline-none focus:border-white/30"
                          />
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="text-[10px] uppercase font-mono text-zinc-500 block mb-1">
                            Role / Title
                          </label>
                          <input
                            type="text"
                            value={char.title || ''}
                            onChange={(e) => {
                              const val = e.target.value;
                              setCharacters((prev) =>
                                prev.map((c, i) => (i === idx ? { ...c, title: val } : c))
                              );
                            }}
                            placeholder="Protagonist / Guild Master"
                            className="w-full px-2.5 py-1.5 rounded-lg bg-black/60 border border-white/[0.08] text-xs text-zinc-200 focus:outline-none focus:border-white/30"
                          />
                        </div>
                        <div>
                          <label className="text-[10px] uppercase font-mono text-zinc-500 block mb-1">
                            Gender
                          </label>
                          <select
                            value={char.gender || 'unknown'}
                            onChange={(e) => {
                              const val = e.target.value as any;
                              setCharacters((prev) =>
                                prev.map((c, i) => (i === idx ? { ...c, gender: val } : c))
                              );
                            }}
                            className="w-full px-2 py-1.5 rounded-lg bg-black/60 border border-white/[0.08] text-xs text-zinc-200 focus:outline-none focus:border-white/30 cursor-pointer"
                          >
                            <option value="unknown">Unknown</option>
                            <option value="male">Male (مذكر)</option>
                            <option value="female">Female (مؤنث)</option>
                          </select>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : activeTab === 'terms' ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-zinc-400 font-mono">
                  Place names, factions, cultivation stages, and technical terms.
                </span>
                <button
                  type="button"
                  onClick={handleAddTerm}
                  className="flex items-center gap-1.5 px-3 py-1 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-xs font-semibold text-white transition-colors cursor-pointer"
                >
                  <Plus className="w-3 h-3" />
                  <span>Add Term / Place</span>
                </button>
              </div>

              {filteredTerms.length === 0 ? (
                <div className="py-12 text-center text-zinc-500 text-xs font-mono border border-dashed border-white/[0.08] rounded-xl">
                  No places or terms recorded yet.
                </div>
              ) : (
                <div className="space-y-2">
                  {filteredTerms.map((t, idx) => (
                    <div
                      key={t.id || idx}
                      className="p-3 rounded-xl bg-zinc-900/60 border border-white/[0.08] flex items-center gap-3 relative group"
                    >
                      <div className="w-28 shrink-0">
                        <select
                          value={t.category || 'place'}
                          onChange={(e) => {
                            const val = e.target.value;
                            setTerms((prev) =>
                              prev.map((item, i) => (i === idx ? { ...item, category: val } : item))
                            );
                          }}
                          className="w-full px-2 py-1.5 rounded-lg bg-black/60 border border-white/[0.08] text-xs text-zinc-300 focus:outline-none focus:border-white/30 capitalize cursor-pointer font-mono"
                        >
                          <option value="place">Place / Location</option>
                          <option value="technique">Technique / Skill</option>
                          <option value="cultivation">Cultivation / Rank</option>
                          <option value="fantasy">Fantasy Item</option>
                          <option value="title">Title / Honorific</option>
                          <option value="lore">Lore Fact</option>
                        </select>
                      </div>

                      <div className="flex-1">
                        <input
                          type="text"
                          value={t.termOriginal}
                          onChange={(e) => {
                            const val = e.target.value;
                            setTerms((prev) =>
                              prev.map((item, i) => (i === idx ? { ...item, termOriginal: val } : item))
                            );
                          }}
                          placeholder="Source Term (e.g. Red Gate)"
                          className="w-full px-2.5 py-1.5 rounded-lg bg-black/60 border border-white/[0.08] text-xs text-zinc-200 focus:outline-none focus:border-white/30"
                        />
                      </div>

                      <div className="flex-1">
                        <input
                          type="text"
                          value={t.termArabic}
                          onChange={(e) => {
                            const val = e.target.value;
                            setTerms((prev) =>
                              prev.map((item, i) => (i === idx ? { ...item, termArabic: val } : item))
                            );
                          }}
                          dir="rtl"
                          placeholder="Arabic Translation (e.g. البوابة الحمراء)"
                          className="w-full px-2.5 py-1.5 rounded-lg bg-black/60 border border-white/[0.08] text-xs text-zinc-200 focus:outline-none focus:border-white/30"
                        />
                      </div>

                      <button
                        type="button"
                        onClick={() => setTerms((prev) => prev.filter((_, i) => i !== idx))}
                        className="p-1.5 rounded-lg text-zinc-500 hover:text-rose-400 opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer shrink-0"
                        title="Delete Term"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : activeTab === 'relationships' ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-zinc-400 font-mono">
                  Speaker relationships, tone consistency, and pronoun alignment.
                </span>
                <button
                  type="button"
                  onClick={handleAddRelationship}
                  className="flex items-center gap-1.5 px-3 py-1 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-xs font-semibold text-white transition-colors cursor-pointer"
                >
                  <Plus className="w-3 h-3" />
                  <span>Add Relationship</span>
                </button>
              </div>

              {filteredRelationships.length === 0 ? (
                <div className="py-12 text-center text-zinc-500 text-xs font-mono border border-dashed border-white/[0.08] rounded-xl">
                  No speaker consistency pairs recorded yet.
                </div>
              ) : (
                <div className="space-y-2">
                  {filteredRelationships.map((rel, idx) => (
                    <div
                      key={rel.id || idx}
                      className="p-3 rounded-xl bg-zinc-900/60 border border-white/[0.08] flex items-center gap-3 relative group"
                    >
                      <div className="flex-1">
                        <input
                          type="text"
                          value={rel.speaker}
                          onChange={(e) => {
                            const val = e.target.value;
                            setRelationships((prev) =>
                              prev.map((item, i) => (i === idx ? { ...item, speaker: val } : item))
                            );
                          }}
                          placeholder="Speaker (e.g. Jin-Woo)"
                          className="w-full px-2.5 py-1.5 rounded-lg bg-black/60 border border-white/[0.08] text-xs text-zinc-200 focus:outline-none focus:border-white/30"
                        />
                      </div>

                      <span className="text-xs text-zinc-500 font-mono">&rarr;</span>

                      <div className="flex-1">
                        <input
                          type="text"
                          value={rel.addressee}
                          onChange={(e) => {
                            const val = e.target.value;
                            setRelationships((prev) =>
                              prev.map((item, i) => (i === idx ? { ...item, addressee: val } : item))
                            );
                          }}
                          placeholder="Addressee (e.g. Hunter Cha)"
                          className="w-full px-2.5 py-1.5 rounded-lg bg-black/60 border border-white/[0.08] text-xs text-zinc-200 focus:outline-none focus:border-white/30"
                        />
                      </div>

                      <div className="w-32">
                        <input
                          type="text"
                          value={rel.tone}
                          onChange={(e) => {
                            const val = e.target.value;
                            setRelationships((prev) =>
                              prev.map((item, i) => (i === idx ? { ...item, tone: val } : item))
                            );
                          }}
                          placeholder="Tone (e.g. Formal, Casual)"
                          className="w-full px-2.5 py-1.5 rounded-lg bg-black/60 border border-white/[0.08] text-xs text-zinc-200 focus:outline-none focus:border-white/30"
                        />
                      </div>

                      <button
                        type="button"
                        onClick={() => setRelationships((prev) => prev.filter((_, i) => i !== idx))}
                        className="p-1.5 rounded-lg text-zinc-500 hover:text-rose-400 opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer shrink-0"
                        title="Delete Relationship"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-4">
              <div>
                <label className="text-xs font-mono uppercase text-zinc-400 block mb-1.5">
                  World Lore, Setting & Key Plot Rules
                </label>
                <textarea
                  value={loreNotes}
                  onChange={(e) => setLoreNotes(e.target.value)}
                  rows={14}
                  placeholder="Record universe background, power systems, faction relationships, or historical events for AI context propagation across chapters..."
                  className="w-full p-4 rounded-xl bg-zinc-900/60 border border-white/[0.08] text-xs text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-white/30 font-mono leading-relaxed custom-scrollbar"
                />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
