import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Cloud,
  CloudOff,
  ExternalLink,
  FileCode2,
  FolderCheck,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Terminal,
} from 'lucide-react';
import { apiFetch, formatDateTime, getAuthToken } from '../../utils/api.ts';
import { getTargetDbFileName, LaptopSnapshotPayload } from '../../utils/laptopDb.ts';
import {
  DEFAULT_DRIVE_FOLDER_URL,
  DriveSyncStateSnapshot,
  FullLogsBundlePayload,
  getDriveSyncState,
  googleDriveSignIn,
  googleDriveSignOut,
  setDriveAutoSyncEnabled,
  setDriveFolderUrl,
  setDriveSyncIntervalMs,
  setDriveWriteConfirmed,
  syncAllDatabaseFilesToGoogleDrive,
  verifyDriveFolderAccess,
} from '../../utils/googleDriveSync.ts';
import { formatBytesCompact } from '../common/MediaPreviewModal.tsx';

export default function GoogleDriveSyncCard() {
  const [driveState, setDriveState] = useState<DriveSyncStateSnapshot>(() => getDriveSyncState());
  const [folderUrlInput, setFolderUrlInput] = useState<string>(() => getDriveSyncState().folderUrl);
  const [signingIn, setSigningIn] = useState(false);
  const [manualSyncing, setManualSyncing] = useState(false);
  const [confirmModalOpen, setConfirmModalOpen] = useState(false);
  const [pendingAction, setPendingAction] = useState<'enable_auto' | 'manual_sync'>('enable_auto');
  const [statusMsg, setStatusMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    const syncState = () => setDriveState(getDriveSyncState());
    syncState();
    window.addEventListener('sdgl:gdrive-status', syncState);
    return () => {
      window.removeEventListener('sdgl:gdrive-status', syncState);
    };
  }, []);

  const executeDriveUploadNow = useCallback(async () => {
    setManualSyncing(true);
    setErrorMsg('');
    setStatusMsg('');
    try {
      const token = getAuthToken();
      const headers = new Headers();
      if (token) headers.set('Authorization', `Bearer ${token}`);

      const [snapshot, fullLogs, sqlRes] = await Promise.all([
        apiFetch<LaptopSnapshotPayload>('/api/auth/security/laptop-snapshot'),
        apiFetch<FullLogsBundlePayload>('/api/auth/security/full-logs-bundle'),
        fetch('/api/auth/security/backup?format=sqlite&silent=1', {
          headers,
          credentials: 'include',
        }),
      ]);

      if (!sqlRes.ok) {
        throw new Error('Unable to export SQLite database binary from server.');
      }
      const sqliteBlob = await sqlRes.blob();

      const files = await syncAllDatabaseFilesToGoogleDrive({
        sqliteBlob,
        snapshot,
        fullLogs,
        targetDbFileName: getTargetDbFileName(),
      });

      setStatusMsg(
        `Synced ${Object.keys(files).length} database & log files to Google Drive folder (${getDriveSyncState().folderId}). Live 1-second sync is active.`
      );
      window.dispatchEvent(new CustomEvent('sdgl:force-sync-now'));
    } catch (err: any) {
      setErrorMsg(err?.message || 'Google Drive upload failed.');
    } finally {
      setManualSyncing(false);
    }
  }, []);

  const handleGoogleConnect = async () => {
    setSigningIn(true);
    setErrorMsg('');
    setStatusMsg('');
    try {
      await googleDriveSignIn();
      const folderId = getDriveSyncState().folderId;
      try {
        await verifyDriveFolderAccess(folderId);
      } catch (verifyErr: any) {
        setErrorMsg(verifyErr?.message || 'Signed in, but could not verify target Google Drive folder.');
      }
      setDriveAutoSyncEnabled(true);
      setDriveSyncIntervalMs(1000);
      setPendingAction('enable_auto');
      setConfirmModalOpen(true);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Google Sign-In failed or popup was closed.');
    } finally {
      setSigningIn(false);
    }
  };

  const handleConfirmDriveWrites = async () => {
    setConfirmModalOpen(false);
    setDriveWriteConfirmed(true);
    setDriveAutoSyncEnabled(true);
    setDriveSyncIntervalMs(1000);
    await executeDriveUploadNow();
  };

  const handleSaveFolderUrl = async () => {
    setErrorMsg('');
    setStatusMsg('');
    const nextId = setDriveFolderUrl(folderUrlInput);
    if (driveState.authenticated) {
      try {
        const meta = await verifyDriveFolderAccess(nextId);
        setStatusMsg(`Target Google Drive folder verified: "${meta?.name || nextId}" (${nextId}).`);
        if (driveState.writeConfirmed) {
          await executeDriveUploadNow();
        }
      } catch (err: any) {
        setErrorMsg(err?.message || `Unable to access folder ${nextId}.`);
      }
    } else {
      setStatusMsg(`Google Drive folder ID saved (${nextId}). Sign in with Google below to sync.`);
    }
  };

  const handleManualSyncClick = async () => {
    if (!driveState.writeConfirmed) {
      setPendingAction('manual_sync');
      setConfirmModalOpen(true);
      return;
    }
    await executeDriveUploadNow();
  };

  const activeFolderHref =
    driveState.folderUrl || `https://drive.google.com/drive/folders/${driveState.folderId}`;

  const syncedFilesList = Object.values(driveState.files || {});

  return (
    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-4">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="p-2.5 rounded-xl bg-blue-50 dark:bg-blue-950/50 border border-blue-200 dark:border-blue-900 text-blue-700 dark:text-blue-400 shrink-0">
            <Cloud className="w-5 h-5" />
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-display font-bold text-slate-900 dark:text-white">
                Google Drive Real-Time Database &amp; Logs Sync (Every 1 Second)
              </h3>
              <span
                className={`px-2 py-0.5 text-[11px] font-mono font-semibold rounded border ${
                  driveState.authenticated && driveState.writeConfirmed && driveState.autoSyncEnabled
                    ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-900 text-emerald-700 dark:text-emerald-300'
                    : 'bg-amber-50 dark:bg-amber-950/40 border-amber-200 dark:border-amber-900 text-amber-700 dark:text-amber-300'
                }`}
              >
                {driveState.authenticated && driveState.writeConfirmed && driveState.autoSyncEnabled
                  ? 'LIVE 1s SYNC ACTIVE'
                  : driveState.authenticated && !driveState.writeConfirmed
                  ? 'CONFIRM FOLDER SYNC'
                  : driveState.needsReauth
                  ? 'RECONNECT GOOGLE DRIVE'
                  : 'GOOGLE DRIVE NOT SIGNED IN'}
              </span>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 max-w-3xl">
              Continuously saves your full SQLite file (<span className="font-mono">{getTargetDbFileName()}</span>),
              complete JSON database snapshot, audit &amp; system logs, and server + browser console logs directly into
              your Google Drive folder every 1 second whenever any data or log changes.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {!driveState.authenticated ? (
            <button
              type="button"
              disabled={signingIn}
              onClick={handleGoogleConnect}
              className="gsi-material-button inline-flex items-center gap-2.5 px-4 py-2 rounded-lg border border-[#747775]/40 bg-white text-[#1f1f1f] hover:bg-slate-50 shadow-sm text-xs font-semibold cursor-pointer disabled:opacity-60"
            >
              <span className="w-4 h-4 shrink-0">
                <svg version="1.1" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" className="block w-full h-full">
                  <path
                    fill="#EA4335"
                    d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
                  />
                  <path
                    fill="#4285F4"
                    d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
                  />
                  <path
                    fill="#FBBC05"
                    d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
                  />
                  <path
                    fill="#34A853"
                    d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
                  />
                </svg>
              </span>
              <span>{signingIn ? 'Connecting...' : 'Sign in with Google'}</span>
            </button>
          ) : (
            <>
              {!driveState.writeConfirmed && (
                <button
                  type="button"
                  onClick={() => {
                    setPendingAction('enable_auto');
                    setConfirmModalOpen(true);
                  }}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-lg bg-amber-600 hover:bg-amber-700 text-white cursor-pointer"
                >
                  <ShieldCheck className="w-3.5 h-3.5" />
                  Confirm &amp; Start 1s Sync
                </button>
              )}
              <button
                type="button"
                disabled={manualSyncing || driveState.isUploading}
                onClick={handleManualSyncClick}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-lg bg-blue-700 hover:bg-blue-800 text-white disabled:opacity-60 cursor-pointer"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${manualSyncing || driveState.isUploading ? 'animate-spin' : ''}`} />
                <span>{manualSyncing || driveState.isUploading ? 'Uploading...' : 'Sync Now to Drive'}</span>
              </button>
              <button
                type="button"
                onClick={() => googleDriveSignOut()}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg border border-slate-300 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
              >
                <CloudOff className="w-3.5 h-3.5" />
                Disconnect
              </button>
            </>
          )}
        </div>
      </div>

      {/* Folder Link Editor */}
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="text"
          value={folderUrlInput}
          onChange={(e) => setFolderUrlInput(e.target.value)}
          placeholder={DEFAULT_DRIVE_FOLDER_URL}
          className="flex-1 min-w-[260px] px-3 py-2 text-xs font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
        />
        <button
          type="button"
          onClick={handleSaveFolderUrl}
          className="px-3.5 py-2 text-xs font-semibold rounded-lg border border-slate-300 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
        >
          Apply Drive Folder
        </button>
        <a
          href={activeFolderHref}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-lg border border-blue-200 dark:border-blue-900 bg-blue-50/70 dark:bg-blue-950/30 text-blue-700 dark:text-blue-300 hover:bg-blue-100/70 dark:hover:bg-blue-950/50"
        >
          <ExternalLink className="w-3.5 h-3.5" />
          Open Drive Folder
        </a>
      </div>

      {(errorMsg || driveState.lastError) && (
        <div className="p-3 rounded-lg bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 text-xs text-red-700 dark:text-red-300 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>{errorMsg || driveState.lastError}</span>
        </div>
      )}

      {statusMsg && (
        <div className="p-3 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900 text-xs text-emerald-700 dark:text-emerald-300 flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>{statusMsg}</span>
        </div>
      )}

      {/* Connection & 1s Telemetry Bar */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
        <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 space-y-1">
          <div className="text-slate-500">Connected Google Account</div>
          <div className="font-semibold text-slate-900 dark:text-white truncate">
            {driveState.userEmail || 'Not connected'}
          </div>
          <div className="text-[11px] font-mono text-slate-500 truncate">
            Folder: {driveState.folderName ? `${driveState.folderName} (${driveState.folderId})` : driveState.folderId}
          </div>
        </div>

        <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 space-y-1">
          <div className="text-slate-500 flex items-center justify-between">
            <span>1-Second Sync Heartbeat</span>
            <label className="inline-flex items-center gap-1.5 cursor-pointer text-[11px] text-slate-700 dark:text-slate-300">
              <input
                type="checkbox"
                checked={driveState.autoSyncEnabled}
                onChange={(e) => setDriveAutoSyncEnabled(e.target.checked)}
              />
              <span>Auto (1s)</span>
            </label>
          </div>
          <div className="font-mono font-semibold text-slate-900 dark:text-white">
            {driveState.lastHeartbeatAt
              ? `Checked: ${new Date(driveState.lastHeartbeatAt).toLocaleTimeString()}`
              : 'Waiting for Google sign-in'}
          </div>
          <div className="text-[11px] text-slate-500">
            Polls server DB &amp; console logs every 1,000 ms
          </div>
        </div>

        <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 space-y-1">
          <div className="text-slate-500">Last Upload to Drive Folder</div>
          <div className="font-mono font-semibold text-slate-900 dark:text-white">
            {driveState.lastUploadedAt ? formatDateTime(driveState.lastUploadedAt) : 'Not uploaded yet'}
          </div>
          <div className="text-[11px] font-mono text-slate-500">
            Completed Drive sync cycles: {driveState.syncCount}
          </div>
        </div>
      </div>

      {/* Synced Files List */}
      <div className="rounded-lg border border-slate-200 dark:border-slate-800 overflow-hidden">
        <div className="px-4 py-2.5 bg-slate-50 dark:bg-slate-950 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between text-xs">
          <span className="font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-2">
            <FolderCheck className="w-4 h-4 text-blue-600" />
            Files Automatically Saved in Google Drive Folder ({driveState.folderId})
          </span>
          <span className="text-[11px] text-slate-500 font-mono">4 continuous archive targets</span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x divide-slate-200 dark:divide-slate-800">
          {[
            {
              name: getTargetDbFileName(),
              desc: 'Full live SQLite database binary',
              icon: Cloud,
            },
            {
              name: 'sdglobal-full-database.json',
              desc: 'All CRM tables, tickets, assets & budgets',
              icon: FileCode2,
            },
            {
              name: 'sdglobal-audit-and-system-logs.json',
              desc: 'Audit logs, sessions, traffic & comms logs',
              icon: ShieldCheck,
            },
            {
              name: 'sdglobal-console-logs.log',
              desc: 'Server + browser console logs stream',
              icon: Terminal,
            },
          ].map((spec) => {
            const uploaded = syncedFilesList.find((f) => f.name === spec.name);
            const Icon = spec.icon;
            return (
              <div key={spec.name} className="p-3 space-y-1 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono font-semibold text-slate-900 dark:text-white truncate flex items-center gap-1.5">
                    <Icon className="w-3.5 h-3.5 text-blue-600 shrink-0" />
                    <span className="truncate">{spec.name}</span>
                  </span>
                  {uploaded?.webViewLink && (
                    <a
                      href={uploaded.webViewLink}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[11px] text-blue-600 hover:underline shrink-0"
                    >
                      Open
                    </a>
                  )}
                </div>
                <div className="text-[11px] text-slate-500">{spec.desc}</div>
                <div className="text-[11px] font-mono text-slate-500">
                  {uploaded
                    ? `${formatBytesCompact(uploaded.sizeBytes)} · ${new Date(uploaded.updatedAt).toLocaleTimeString()}`
                    : 'Pending first Drive sync'}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Explicit Confirmation Modal Before Updating/Overwriting User Google Drive Files */}
      {confirmModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-[1px] flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-xl p-5 space-y-4">
            <div className="flex items-start gap-3">
              <div className="p-2 rounded-lg bg-amber-50 dark:bg-amber-950/50 border border-amber-200 dark:border-amber-900 text-amber-700 dark:text-amber-400 shrink-0">
                <ShieldAlert className="w-5 h-5" />
              </div>
              <div>
                <h4 className="text-sm font-display font-bold text-slate-900 dark:text-white">
                  Confirm Google Drive Folder Sync &amp; File Updates
                </h4>
                <p className="text-xs text-slate-600 dark:text-slate-300 mt-1">
                  This will create and overwrite the following files inside your Google Drive folder{' '}
                  <span className="font-mono font-semibold">{driveState.folderId}</span>
                  {pendingAction === 'enable_auto' ? ' and update them automatically every 1 second on changes:' : ':'}
                </p>
              </div>
            </div>

            <ul className="text-xs font-mono bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg p-3 space-y-1 text-slate-700 dark:text-slate-300">
              <li>1. {getTargetDbFileName()} (SQLite DB)</li>
              <li>2. sdglobal-full-database.json (All Tables)</li>
              <li>3. sdglobal-audit-and-system-logs.json (Audit &amp; System Logs)</li>
              <li>4. sdglobal-console-logs.log (Server &amp; Console Logs)</li>
            </ul>

            <div className="flex items-center justify-end gap-2.5">
              <button
                type="button"
                onClick={() => setConfirmModalOpen(false)}
                className="px-3.5 py-2 text-xs font-medium rounded-lg border border-slate-300 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmDriveWrites}
                className="px-4 py-2 text-xs font-semibold rounded-lg bg-blue-700 hover:bg-blue-800 text-white cursor-pointer"
              >
                Confirm &amp; Start 1s Drive Sync
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
