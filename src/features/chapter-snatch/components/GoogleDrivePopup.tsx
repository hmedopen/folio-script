import React, { useState, useEffect, useRef } from 'react';
import {
  HardDrive,
  FolderOpen,
  Link as LinkIcon,
  X,
  Loader2,
  CheckCircle2,
  LogOut,
  LogIn,
  ArrowRight,
  ArrowLeft,
  AlertCircle,
  Settings,
  ExternalLink,
  Key,
} from 'lucide-react';
import { GoogleDriveExplorerModal } from './GoogleDriveExplorerModal';
import { googleDriveBridge } from '../services/googleDriveBridge';

interface GoogleDrivePopupProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmitUrl: (url: string) => void;
  isBusy?: boolean;
}

export const GoogleDrivePopup: React.FC<GoogleDrivePopupProps> = ({
  isOpen,
  onClose,
  onSubmitUrl,
  isBusy = false,
}) => {
  const [authState, setAuthState] = useState<{ isAuthenticated: boolean; userEmail: string | null }>({
    isAuthenticated: false,
    userEmail: null,
  });
  const [hasClientId, setHasClientId] = useState(false);
  const [isSetupOpen, setIsSetupOpen] = useState(false);
  const [clientIdInput, setClientIdInput] = useState('');
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [linkInput, setLinkInput] = useState('');
  const [isExplorerOpen, setIsExplorerOpen] = useState(false);
  const popupRef = useRef<HTMLDivElement>(null);

  // Read current auth state & stored credentials on open
  useEffect(() => {
    if (!isOpen) return;

    googleDriveBridge
      .getAuthState()
      .then((state) => {
        if (state) {
          setAuthState({ isAuthenticated: !!state.isAuthenticated, userEmail: state.userEmail || null });
          setHasClientId(!!state.hasClientId);
          if (state.clientId) {
            setClientIdInput(state.clientId);
          }
        }
      })
      .catch(() => {});

    googleDriveBridge
      .getApiKey()
      .then((key) => {
        if (key) setApiKeyInput(key);
      })
      .catch(() => {});
  }, [isOpen]);

  // Click outside to dismiss
  useEffect(() => {
    if (!isOpen || isExplorerOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (popupRef.current && !popupRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, isExplorerOpen, onClose]);

  const handleSignIn = async () => {
    if (!hasClientId && !clientIdInput.trim()) {
      setIsSetupOpen(true);
      return;
    }
    setIsAuthenticating(true);
    setAuthError(null);
    try {
      const res = await googleDriveBridge.authenticate();
      if (res.success) {
        setAuthState({ isAuthenticated: true, userEmail: res.userEmail });
        setHasClientId(true);
        setIsSetupOpen(false);
      }
    } catch (err: any) {
      if (err?.message?.includes('NO_CLIENT_ID_CONFIGURED')) {
        setIsSetupOpen(true);
        setAuthError('Please enter your Google Cloud Desktop Client ID to continue.');
      } else if (err?.message?.includes('access_denied')) {
        setAuthError('Google blocked access (Error 403: access_denied). Please add your Google account email under "OAuth consent screen -> Test users" in Google Cloud Console.');
      } else {
        setAuthError(err?.message || 'Authentication failed or was cancelled.');
      }
    } finally {
      setIsAuthenticating(false);
    }
  };

  const handleSignOut = async () => {
    try {
      await googleDriveBridge.signOut();
      setAuthState({ isAuthenticated: false, userEmail: null });
    } catch {}
  };

  const handleBrowseDrive = async () => {
    if (!hasClientId && !clientIdInput.trim()) {
      setIsSetupOpen(true);
      return;
    }
    if (!authState.isAuthenticated) {
      setIsAuthenticating(true);
      setAuthError(null);
      try {
        const res = await googleDriveBridge.authenticate();
        if (res.success) {
          setAuthState({ isAuthenticated: true, userEmail: res.userEmail });
          setHasClientId(true);
          setIsSetupOpen(false);
          setIsExplorerOpen(true);
        }
      } catch (err: any) {
        if (err?.message?.includes('NO_CLIENT_ID_CONFIGURED')) {
          setIsSetupOpen(true);
          setAuthError('Please enter your Google Cloud Desktop Client ID to browse Drive.');
        } else if (err?.message?.includes('access_denied')) {
          setAuthError('Google blocked access (Error 403: access_denied). Please add your Google account email under "OAuth consent screen -> Test users" in Google Cloud Console.');
        } else {
          setAuthError(err?.message || 'Authentication required to browse Drive.');
        }
      } finally {
        setIsAuthenticating(false);
      }
      return;
    }
    setIsExplorerOpen(true);
  };

  const handleSaveCredentials = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedId = clientIdInput.trim();
    if (!trimmedId) {
      setAuthError('Google Client ID is required.');
      return;
    }
    if (!trimmedId.endsWith('.apps.googleusercontent.com')) {
      setAuthError('Client ID must end with .apps.googleusercontent.com');
      return;
    }

    try {
      await googleDriveBridge.setClientId(trimmedId);
      if (apiKeyInput.trim()) {
        await googleDriveBridge.setApiKey(apiKeyInput.trim());
      }
      setHasClientId(true);
      setAuthError(null);

      // Immediately trigger sign-in with newly saved credentials
      setIsAuthenticating(true);
      const res = await googleDriveBridge.authenticate();
      if (res.success) {
        setAuthState({ isAuthenticated: true, userEmail: res.userEmail });
        setIsSetupOpen(false);
      }
    } catch (err: any) {
      if (err?.message?.includes('access_denied')) {
        setAuthError('Google blocked access (Error 403: access_denied). Please add your Google account email under "OAuth consent screen -> Test users" in Google Cloud Console.');
      } else {
        setAuthError(err?.message || 'Authentication error with provided credentials.');
      }
    } finally {
      setIsAuthenticating(false);
    }
  };

  const handlePasteSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = linkInput.trim();
    if (!trimmed) return;
    onSubmitUrl(trimmed);
    onClose();
  };

  const handleExplorerSelect = (url: string) => {
    setIsExplorerOpen(false);
    onSubmitUrl(url);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-100">
        <div
          ref={popupRef}
          className="w-full max-w-sm bg-[#0e0f15] border border-white/[0.14] rounded-2xl shadow-2xl flex flex-col overflow-hidden text-zinc-100 font-sans animate-in zoom-in-95 duration-100"
        >
          {/* Header */}
          <div className="h-12 px-4 border-b border-white/[0.08] bg-[#090a0e] flex items-center justify-between shrink-0">
            <div className="flex items-center gap-2">
              {isSetupOpen ? (
                <button
                  type="button"
                  onClick={() => setIsSetupOpen(false)}
                  className="p-1 rounded-md text-zinc-400 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
                  title="Back to options"
                >
                  <ArrowLeft className="w-3.5 h-3.5" />
                </button>
              ) : (
                <div className="p-1 rounded-md bg-amber-500/10 text-amber-400">
                  <HardDrive className="w-3.5 h-3.5" />
                </div>
              )}
              <span className="font-mono text-xs font-semibold tracking-wider uppercase text-zinc-200">
                {isSetupOpen ? 'Google Drive Setup' : 'Google Drive Importer'}
              </span>
            </div>
            <div className="flex items-center gap-1">
              {!isSetupOpen && (
                <button
                  type="button"
                  onClick={() => setIsSetupOpen(true)}
                  className="p-1 rounded-md text-zinc-400 hover:text-zinc-200 hover:bg-white/10 transition-colors cursor-pointer"
                  title="Configure Google Credentials"
                >
                  <Settings className="w-3.5 h-3.5" />
                </button>
              )}
              <button
                type="button"
                onClick={onClose}
                className="p-1 rounded-md text-zinc-400 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* Body */}
          <div className="p-4 space-y-3.5 max-h-[75vh] overflow-y-auto">
            {/* Error Message */}
            {authError && (
              <div className="p-2.5 rounded-xl bg-rose-950/30 border border-rose-500/30 flex items-start gap-2 text-[11px] font-mono text-rose-300">
                <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                <span className="break-words">{authError}</span>
              </div>
            )}

            {isSetupOpen ? (
              /* Setup View */
              <div className="space-y-3">
                <div className="p-3 rounded-xl bg-zinc-900/80 border border-white/[0.08] text-[11px] font-mono text-zinc-300 space-y-2">
                  <div className="flex items-center gap-1.5 text-amber-400 font-semibold">
                    <Key className="w-3.5 h-3.5" />
                    <span>Google Cloud Desktop OAuth</span>
                  </div>
                  <p className="text-zinc-400 leading-relaxed text-[10px]">
                    To access your private Google Drive folders with your personal Google Cloud project:
                  </p>
                  <ol className="list-decimal pl-4 space-y-1.5 text-zinc-400 text-[10px]">
                    <li>Enable <strong>Google Drive API</strong> in Google Cloud Console.</li>
                    <li>
                      Under <strong>OAuth consent screen &rarr; Test users</strong>, click <strong>+ ADD USERS</strong> and add your Google account email (prevents Google Error 403: access_denied).
                    </li>
                    <li>
                      Under <strong>Credentials</strong>, create an OAuth Client ID with application type <strong>Desktop app</strong>.
                    </li>
                    <li>Paste the Client ID below and click <strong>Save & Sign In</strong>.</li>
                  </ol>
                  <div className="flex items-center gap-3 pt-1">
                    <button
                      type="button"
                      onClick={() => {
                        if (typeof window !== 'undefined') {
                          window.open('https://console.cloud.google.com/apis/credentials/consent', '_blank');
                        }
                      }}
                      className="flex items-center gap-1 text-[10px] text-amber-400 hover:text-amber-300 underline cursor-pointer"
                    >
                      <span>Add Test User</span>
                      <ExternalLink className="w-3 h-3" />
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (typeof window !== 'undefined') {
                          window.open('https://console.cloud.google.com/apis/credentials', '_blank');
                        }
                      }}
                      className="flex items-center gap-1 text-[10px] text-zinc-400 hover:text-zinc-200 underline cursor-pointer"
                    >
                      <span>Credentials</span>
                      <ExternalLink className="w-3 h-3" />
                    </button>
                  </div>
                </div>

                <form onSubmit={handleSaveCredentials} className="space-y-3">
                  <div className="space-y-1">
                    <label className="text-[10px] font-mono uppercase text-zinc-400 font-semibold">
                      Client ID <span className="text-rose-400">*</span>
                    </label>
                    <input
                      type="text"
                      value={clientIdInput}
                      onChange={(e) => setClientIdInput(e.target.value)}
                      placeholder="123456789-xxxx.apps.googleusercontent.com"
                      className="w-full h-8 px-2.5 rounded-lg bg-zinc-900 border border-white/[0.1] text-xs font-mono text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-white/30 transition-colors"
                      required
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-[10px] font-mono uppercase text-zinc-400 font-semibold">
                      API Key <span className="text-zinc-500 font-normal">(Optional for public links)</span>
                    </label>
                    <input
                      type="text"
                      value={apiKeyInput}
                      onChange={(e) => setApiKeyInput(e.target.value)}
                      placeholder="AIzaSy... (optional)"
                      className="w-full h-8 px-2.5 rounded-lg bg-zinc-900 border border-white/[0.1] text-xs font-mono text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-white/30 transition-colors"
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={isAuthenticating || !clientIdInput.trim()}
                    className={`w-full h-8 px-3 rounded-lg text-xs font-mono font-semibold transition-all flex items-center justify-center gap-2 ${
                      isAuthenticating || !clientIdInput.trim()
                        ? 'bg-zinc-800 text-zinc-500 cursor-not-allowed border border-white/[0.04]'
                        : 'bg-white text-zinc-950 hover:bg-zinc-200 active:scale-[0.98] cursor-pointer shadow-sm'
                    }`}
                  >
                    {isAuthenticating ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        <span>Signing in...</span>
                      </>
                    ) : (
                      <>
                        <span>Save & Sign In</span>
                        <ArrowRight className="w-3.5 h-3.5" />
                      </>
                    )}
                  </button>
                </form>
              </div>
            ) : (
              /* Main Mode */
              <>
                {!hasClientId && (
                  <div
                    onClick={() => setIsSetupOpen(true)}
                    className="p-2.5 rounded-xl bg-amber-950/20 border border-amber-500/30 flex items-center justify-between text-[11px] font-mono text-amber-300 cursor-pointer hover:bg-amber-950/30 transition-colors"
                  >
                    <span className="flex items-center gap-1.5">
                      <Key className="w-3.5 h-3.5" />
                      <span>Setup OAuth Client ID</span>
                    </span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </div>
                )}

                {/* Option A: Browse Google Drive */}
                <div className="p-3.5 rounded-xl bg-zinc-900/60 border border-white/[0.08] hover:border-amber-500/30 transition-all">
                  <div className="flex items-center justify-between mb-1.5">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-mono font-bold tracking-wider uppercase px-1.5 py-0.5 rounded bg-zinc-800 text-amber-400">
                        Option A
                      </span>
                      <span className="text-xs font-semibold text-zinc-200">Browse Google Drive</span>
                    </div>
                  </div>
                  <p className="text-[11px] font-mono text-zinc-400 mb-3 leading-relaxed">
                    Open Drive explorer to navigate folders and select a chapter folder or ZIP/CBZ.
                  </p>
                  <button
                    type="button"
                    onClick={handleBrowseDrive}
                    disabled={isAuthenticating || isBusy}
                    className="w-full h-8 px-3 rounded-lg text-xs font-mono font-semibold bg-white text-zinc-950 hover:bg-zinc-200 active:scale-[0.98] transition-all cursor-pointer flex items-center justify-center gap-2 shadow-sm"
                  >
                    {isAuthenticating ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        <span>Signing in...</span>
                      </>
                    ) : (
                      <>
                        <FolderOpen className="w-3.5 h-3.5" />
                        <span>Browse Google Drive</span>
                        <ArrowRight className="w-3 h-3 text-zinc-600" />
                      </>
                    )}
                  </button>
                </div>

                {/* Option B: Paste a Drive Link */}
                <div className="p-3.5 rounded-xl bg-zinc-900/60 border border-white/[0.08] transition-all">
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className="text-[10px] font-mono font-bold tracking-wider uppercase px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400">
                      Option B
                    </span>
                    <span className="text-xs font-semibold text-zinc-200">Paste a Drive Link</span>
                  </div>
                  <p className="text-[11px] font-mono text-zinc-400 mb-2.5 leading-relaxed">
                    Paste a link to any public or private folder or ZIP/CBZ archive.
                  </p>
                  <form onSubmit={handlePasteSubmit} className="space-y-2">
                    <div className="relative flex items-center">
                      <LinkIcon className="w-3.5 h-3.5 text-zinc-500 absolute left-2.5 pointer-events-none" />
                      <input
                        type="text"
                        value={linkInput}
                        onChange={(e) => setLinkInput(e.target.value)}
                        placeholder="https://drive.google.com/..."
                        className="w-full h-8 pl-8 pr-3 rounded-lg bg-zinc-900 border border-white/[0.1] text-xs font-mono text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-white/30 transition-colors"
                      />
                    </div>
                    <button
                      type="submit"
                      disabled={!linkInput.trim() || isBusy}
                      className={`w-full h-8 px-3 rounded-lg text-xs font-mono font-semibold transition-all flex items-center justify-center gap-1.5 ${
                        !linkInput.trim() || isBusy
                          ? 'bg-zinc-800 text-zinc-500 cursor-not-allowed border border-white/[0.04]'
                          : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-100 hover:text-white border border-white/[0.1] cursor-pointer'
                      }`}
                    >
                      <span>Retrieve Chapter</span>
                      <ArrowRight className="w-3 h-3" />
                    </button>
                  </form>
                </div>
              </>
            )}
          </div>

          {/* Account Footer Bar */}
          <div className="px-4 py-2.5 bg-[#090a0e] border-t border-white/[0.06] flex items-center justify-between text-xs font-mono">
            {authState.isAuthenticated ? (
              <div className="flex items-center justify-between w-full">
                <div className="flex items-center gap-1.5 min-w-0">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                  <span className="text-zinc-400 truncate max-w-[170px]" title={authState.userEmail || ''}>
                    {authState.userEmail}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={handleSignOut}
                  className="text-[11px] text-zinc-500 hover:text-zinc-300 transition-colors cursor-pointer flex items-center gap-1"
                  title="Sign out of Google Drive"
                >
                  <LogOut className="w-3 h-3" />
                  <span>Sign Out</span>
                </button>
              </div>
            ) : (
              <div className="flex items-center justify-between w-full">
                <span className="text-[11px] text-zinc-500">Not signed in to Google</span>
                <button
                  type="button"
                  onClick={handleSignIn}
                  disabled={isAuthenticating}
                  className="text-[11px] text-amber-400 hover:text-amber-300 font-medium transition-colors cursor-pointer flex items-center gap-1"
                >
                  <LogIn className="w-3 h-3" />
                  <span>Sign In</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Explorer Modal */}
      <GoogleDriveExplorerModal
        isOpen={isExplorerOpen}
        onClose={() => setIsExplorerOpen(false)}
        onSelectResource={handleExplorerSelect}
      />
    </>
  );
};
