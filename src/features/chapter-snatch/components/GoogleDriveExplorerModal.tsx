import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  X,
  Folder,
  FolderArchive,
  ChevronRight,
  ChevronLeft,
  Search,
  Loader2,
  AlertCircle,
  HardDrive,
  Check,
  RefreshCw,
} from 'lucide-react';
import { googleDriveBridge } from '../services/googleDriveBridge';

interface DriveFolderItem {
  id: string;
  name: string;
  type: 'folder';
  modifiedTime?: string;
}

interface DriveArchiveItem {
  id: string;
  name: string;
  type: 'archive';
  size: number;
  modifiedTime?: string;
}

interface ExplorerDirectoryResult {
  folderId: string;
  folders: DriveFolderItem[];
  archives: DriveArchiveItem[];
  imageCount: number;
  hasImages: boolean;
}

interface GoogleDriveExplorerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectResource: (url: string) => void;
}

export const GoogleDriveExplorerModal: React.FC<GoogleDriveExplorerModalProps> = ({
  isOpen,
  onClose,
  onSelectResource,
}) => {
  const [history, setHistory] = useState<Array<{ id: string; name: string }>>([
    { id: 'root', name: 'My Drive' },
  ]);
  const [items, setItems] = useState<ExplorerDirectoryResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');

  const currentFolder = history[history.length - 1];

  const fetchDirectory = useCallback(async (folderId: string) => {
    setIsLoading(true);
    setError(null);
    try {
      const result: ExplorerDirectoryResult = await googleDriveBridge.listExplorerDirectory(folderId);
      setItems(result);
    } catch (err: any) {
      setError(err?.message || 'Failed to list Google Drive contents.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      void fetchDirectory(currentFolder.id);
    }
  }, [isOpen, currentFolder.id, fetchDirectory]);

  const handleEnterFolder = (folder: DriveFolderItem) => {
    setSearchTerm('');
    setHistory((prev) => [...prev, { id: folder.id, name: folder.name }]);
  };

  const handleGoBack = () => {
    if (history.length <= 1) return;
    setSearchTerm('');
    setHistory((prev) => prev.slice(0, prev.length - 1));
  };

  const handleBreadcrumbClick = (idx: number) => {
    if (idx === history.length - 1) return;
    setSearchTerm('');
    setHistory((prev) => prev.slice(0, idx + 1));
  };

  const filteredFolders = useMemo(() => {
    if (!items?.folders) return [];
    if (!searchTerm.trim()) return items.folders;
    const term = searchTerm.toLowerCase();
    return items.folders.filter((f) => f.name.toLowerCase().includes(term));
  }, [items?.folders, searchTerm]);

  const filteredArchives = useMemo(() => {
    if (!items?.archives) return [];
    if (!searchTerm.trim()) return items.archives;
    const term = searchTerm.toLowerCase();
    return items.archives.filter((a) => a.name.toLowerCase().includes(term));
  }, [items?.archives, searchTerm]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-70 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-150 select-none">
      <div className="w-full max-w-3xl h-[75vh] bg-[#0c0d12] border border-white/[0.14] rounded-2xl shadow-2xl flex flex-col overflow-hidden text-zinc-100 font-sans animate-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="h-14 px-6 border-b border-white/[0.08] bg-[#090a0e] flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-1.5 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-400">
              <HardDrive className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-mono text-xs font-semibold tracking-wider uppercase text-zinc-200">
                  Google Drive Explorer
                </span>
              </div>
              <p className="text-[11px] text-zinc-500">
                Browse and select a chapter folder or ZIP/CBZ archive to import.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
            title="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Navigation & Breadcrumb Bar */}
        <div className="px-6 py-2.5 bg-[#0a0a0f] border-b border-white/[0.06] flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-1 overflow-x-auto text-xs font-mono py-0.5 custom-scrollbar">
            <button
              type="button"
              onClick={handleGoBack}
              disabled={history.length <= 1}
              className={`p-1 rounded mr-1 transition-colors ${
                history.length <= 1
                  ? 'text-zinc-600 cursor-not-allowed'
                  : 'text-zinc-300 hover:text-white hover:bg-white/10 cursor-pointer'
              }`}
              title="Go to parent folder"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>

            {history.map((h, idx) => (
              <React.Fragment key={h.id}>
                {idx > 0 && <ChevronRight className="w-3.5 h-3.5 text-zinc-600 shrink-0" />}
                <button
                  type="button"
                  onClick={() => handleBreadcrumbClick(idx)}
                  className={`px-2 py-0.5 rounded transition-colors truncate max-w-[150px] ${
                    idx === history.length - 1
                      ? 'text-white font-medium bg-zinc-800/80 border border-white/[0.08]'
                      : 'text-zinc-400 hover:text-zinc-200 hover:bg-white/5 cursor-pointer'
                  }`}
                  title={h.name}
                >
                  {h.name}
                </button>
              </React.Fragment>
            ))}
          </div>

          {/* Current Folder Selection Action if it contains images */}
          {items && items.hasImages && currentFolder.id !== 'root' && (
            <button
              type="button"
              onClick={() => onSelectResource(`https://drive.google.com/drive/folders/${currentFolder.id}`)}
              className="h-8 px-3 rounded-lg text-xs font-mono font-semibold bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/30 transition-all cursor-pointer flex items-center gap-1.5 shrink-0"
              title="Import this folder as the chapter"
            >
              <Check className="w-3.5 h-3.5" />
              <span>Import This Folder ({items.imageCount} imgs)</span>
            </button>
          )}
        </div>

        {/* Filter Input */}
        <div className="px-6 py-2 bg-[#08080b] border-b border-white/[0.04] flex items-center gap-2 shrink-0">
          <div className="flex-1 relative flex items-center">
            <Search className="w-3.5 h-3.5 text-zinc-500 absolute left-3 pointer-events-none" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Filter current folder contents..."
              className="w-full h-8 pl-8 pr-3 rounded-lg bg-zinc-900/80 border border-white/[0.08] text-xs font-mono text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-white/20 transition-colors"
            />
          </div>
          <button
            type="button"
            onClick={() => fetchDirectory(currentFolder.id)}
            disabled={isLoading}
            className="p-2 rounded-lg text-zinc-400 hover:text-white hover:bg-white/5 transition-colors cursor-pointer"
            title="Refresh directory"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
          </button>
        </div>

        {/* Main Directory Listing */}
        <div className="flex-1 overflow-y-auto p-6 custom-scrollbar bg-[#0a0a0d]">
          {isLoading ? (
            <div className="h-full flex flex-col items-center justify-center text-center p-8">
              <Loader2 className="w-6 h-6 text-zinc-400 animate-spin mb-3" />
              <p className="text-xs font-mono text-zinc-500">Reading Google Drive directory...</p>
            </div>
          ) : error ? (
            <div className="h-full flex flex-col items-center justify-center text-center p-8 max-w-md mx-auto">
              <AlertCircle className="w-8 h-8 text-rose-400 mb-3" />
              <h4 className="text-sm font-semibold text-rose-200 mb-1">Access Error</h4>
              <p className="text-xs font-mono text-rose-300 leading-relaxed mb-4">{error}</p>
              <button
                type="button"
                onClick={() => fetchDirectory(currentFolder.id)}
                className="px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-xs font-mono text-zinc-200 transition-colors cursor-pointer"
              >
                Retry
              </button>
            </div>
          ) : (filteredFolders.length === 0 && filteredArchives.length === 0) ? (
            <div className="h-full flex flex-col items-center justify-center text-center p-8 max-w-sm mx-auto">
              <div className="w-10 h-10 rounded-xl bg-zinc-900 border border-white/[0.06] flex items-center justify-center mb-3 text-zinc-500">
                <Folder className="w-5 h-5 stroke-[1.5]" />
              </div>
              <h4 className="text-xs font-medium text-zinc-300 mb-1">No items found</h4>
              <p className="text-[11px] font-mono text-zinc-500">
                {items?.hasImages
                  ? `This folder contains ${items.imageCount} image(s). Click "Import This Folder" above to import.`
                  : 'No subfolders or ZIP/CBZ archives in this directory.'}
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Archives Section */}
              {filteredArchives.length > 0 && (
                <div>
                  <h5 className="text-[11px] font-mono font-semibold tracking-wider text-zinc-400 uppercase mb-2 px-1">
                    ZIP & CBZ Archives ({filteredArchives.length})
                  </h5>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    {filteredArchives.map((archive) => (
                      <div
                        key={archive.id}
                        className="p-3 rounded-xl bg-zinc-900/60 border border-white/[0.06] hover:border-amber-500/30 hover:bg-zinc-900/90 transition-all flex items-center justify-between gap-3 group"
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="p-2 rounded-lg bg-amber-500/10 text-amber-400 shrink-0">
                            <FolderArchive className="w-4 h-4" />
                          </div>
                          <div className="min-w-0">
                            <p className="text-xs font-semibold text-zinc-200 truncate group-hover:text-white" title={archive.name}>
                              {archive.name}
                            </p>
                            <p className="text-[10px] font-mono text-zinc-500">
                              {archive.size > 0 ? `${(archive.size / (1024 * 1024)).toFixed(1)} MB` : 'Archive'}
                            </p>
                          </div>
                        </div>

                        <button
                          type="button"
                          onClick={() => onSelectResource(`https://drive.google.com/file/d/${archive.id}/view`)}
                          className="px-2.5 py-1.5 rounded-lg text-xs font-mono font-semibold bg-white text-zinc-950 hover:bg-zinc-200 transition-colors cursor-pointer shrink-0"
                          title="Import this archive"
                        >
                          Select
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Folders Section */}
              {filteredFolders.length > 0 && (
                <div>
                  <h5 className="text-[11px] font-mono font-semibold tracking-wider text-zinc-400 uppercase mb-2 px-1">
                    Folders ({filteredFolders.length})
                  </h5>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    {filteredFolders.map((folder) => (
                      <div
                        key={folder.id}
                        className="p-3 rounded-xl bg-zinc-900/40 border border-white/[0.06] hover:border-white/[0.14] hover:bg-zinc-900/80 transition-all flex items-center justify-between gap-3 group cursor-pointer"
                        onClick={() => handleEnterFolder(folder)}
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="p-2 rounded-lg bg-zinc-800 text-zinc-300 group-hover:text-white group-hover:bg-zinc-700 shrink-0 transition-colors">
                            <Folder className="w-4 h-4" />
                          </div>
                          <div className="min-w-0">
                            <p className="text-xs font-medium text-zinc-200 truncate group-hover:text-white" title={folder.name}>
                              {folder.name}
                            </p>
                            <span className="text-[10px] font-mono text-zinc-500">Open Folder</span>
                          </div>
                        </div>

                        <div className="flex items-center gap-1.5 shrink-0">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              onSelectResource(`https://drive.google.com/drive/folders/${folder.id}`);
                            }}
                            className="px-2 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-white text-[11px] font-mono transition-colors cursor-pointer"
                            title="Select this folder as chapter"
                          >
                            Import
                          </button>
                          <ChevronRight className="w-4 h-4 text-zinc-600 group-hover:text-zinc-300 transition-colors" />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
