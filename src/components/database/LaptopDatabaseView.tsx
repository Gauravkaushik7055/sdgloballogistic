import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Copy,
  Database,
  Download,
  ExternalLink,
  FileUp,
  FolderOpen,
  FolderSync,
  HardDrive,
  Laptop,
  Link2,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  Trash2,
  Unlink,
} from 'lucide-react';
import { apiFetch, formatDateTime, getAuthToken, uploadWithProgress } from '../../utils/api.ts';
import {
  clearLaptopDb,
  exportLaptopDbSnapshot,
  getLaptopDbStatus,
  getLaptopPathsForOs,
  getLaptopTargetPath,
  getTargetDbFileName,
  LAPTOP_TABLE_SPECS,
  LaptopDbStatus,
  LaptopSnapshotPayload,
  linkLaptopFolderOrFile,
  readLaptopDbTable,
  requestPersistentLaptopStorage,
  saveSnapshotToLaptopDb,
  setAutoSyncEnabled,
  setLaptopTargetPath,
  unlinkLaptopDiskFile,
} from '../../utils/laptopDb.ts';
import { formatBytesCompact } from '../common/MediaPreviewModal.tsx';
import GoogleDriveSyncCard from './GoogleDriveSyncCard.tsx';

export default function LaptopDatabaseView() {
  const [status, setStatus] = useState<LaptopDbStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [downloadingFormat, setDownloadingFormat] = useState<'sqlite' | 'json' | null>(null);
  const [linkingFile, setLinkingFile] = useState(false);
  const [blockedByIframe, setBlockedByIframe] = useState(false);
  const [copiedPath, setCopiedPath] = useState<string | null>(null);

  const [banner, setBanner] = useState('');
  const [error, setError] = useState('');

  const [selectedTable, setSelectedTable] = useState<string>('tickets');
  const [tableRows, setTableRows] = useState<any[]>([]);
  const [loadingRows, setLoadingRows] = useState(false);
  const [confirmRestoreLaptop, setConfirmRestoreLaptop] = useState(false);
  const [targetPath, setTargetPath] = useState<string>(() => getLaptopTargetPath());

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const osPaths = getLaptopPathsForOs();
  const targetFileName = getTargetDbFileName(targetPath);

  const fetchSqliteBlob = useCallback(async (silent = true): Promise<Blob | null> => {
    try {
      const token = getAuthToken();
      const headers = new Headers();
      if (token) headers.set('Authorization', `Bearer ${token}`);
      const res = await fetch(`/api/auth/security/backup?format=sqlite${silent ? '&silent=1' : ''}`, {
        headers,
        credentials: 'include',
      });
      if (!res.ok) return null;
      return await res.blob();
    } catch {
      return null;
    }
  }, []);

  const refreshStatus = useCallback(async () => {
    try {
      const next = await getLaptopDbStatus();
      setStatus(next);
    } catch (err: any) {
      setError(err?.message || 'Unable to inspect laptop IndexedDB storage.');
    } finally {
      setLoading(false);
    }
  }, []);

  const loadSelectedTableRows = useCallback(async (tableName: string) => {
    setLoadingRows(true);
    try {
      const rows = await readLaptopDbTable(tableName, 80);
      setTableRows(rows);
    } catch {
      setTableRows([]);
    } finally {
      setLoadingRows(false);
    }
  }, []);

  useEffect(() => {
    refreshStatus();
    const onSynced = () => {
      refreshStatus();
    };
    window.addEventListener('sdgl:laptop-db-synced', onSynced);
    return () => {
      window.removeEventListener('sdgl:laptop-db-synced', onSynced);
    };
  }, [refreshStatus]);

  useEffect(() => {
    if (status?.initialized) {
      loadSelectedTableRows(selectedTable);
    } else {
      setTableRows([]);
    }
  }, [status?.initialized, status?.lastSyncAt, selectedTable, loadSelectedTableRows]);

  const triggerDownload = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 15000);
  };

  const handleCreateOrSyncLaptopDb = async (interactive = true) => {
    setSyncing(true);
    setError('');
    setBanner('');
    try {
      const currentStatus = status || (await getLaptopDbStatus());
      const snapshot = await apiFetch<LaptopSnapshotPayload>('/api/auth/security/laptop-snapshot');
      const sqliteBlob = currentStatus.linkedFileName ? await fetchSqliteBlob() : null;
      const result = await saveSnapshotToLaptopDb(snapshot, { sqliteBlob, interactive });
      setAutoSyncEnabled(true);
      await refreshStatus();
      await loadSelectedTableRows(selectedTable);

      const fileNote = result.linkedFileResult.wrote
        ? ` Also updated attached laptop ${result.linkedFileResult.type === 'directory' ? 'folder' : 'file'} "${result.linkedFileResult.fileName}".`
        : result.linkedFileResult.reason
        ? ` (${result.linkedFileResult.reason})`
        : '';
      const persistNote = result.persisted ? ' Persistent laptop storage locked.' : '';
      setBanner(
        `Laptop database synced (${result.totalRecords.toLocaleString()} records stored on your device, auto-sync enabled).${persistNote}${fileNote}`
      );
    } catch (err: any) {
      setError(err?.message || 'Failed to sync CRM database to laptop storage.');
    } finally {
      setSyncing(false);
    }
  };

  const handleToggleAutoSync = async (nextVal: boolean) => {
    setAutoSyncEnabled(nextVal);
    if (nextVal) {
      await handleCreateOrSyncLaptopDb(false);
    } else {
      await refreshStatus();
    }
  };

  const handleRequestPersistence = async () => {
    setError('');
    const granted = await requestPersistentLaptopStorage();
    await refreshStatus();
    if (granted) {
      setBanner('Browser granted persistent storage so your laptop database will not be auto-evicted.');
    } else {
      setError('Browser kept standard storage mode. Save a .db or .json copy to your laptop folder below.');
    }
  };

  const handleLinkLaptopTarget = async (mode: 'file' | 'directory' = 'file') => {
    setLinkingFile(true);
    setError('');
    setBanner('');
    setBlockedByIframe(false);
    setLaptopTargetPath(targetPath);
    try {
      const snapshot = await apiFetch<LaptopSnapshotPayload>('/api/auth/security/laptop-snapshot');
      const sqliteBlob = await fetchSqliteBlob();
      await saveSnapshotToLaptopDb(snapshot);
      setAutoSyncEnabled(true);

      const res = await linkLaptopFolderOrFile(snapshot, sqliteBlob, mode);
      if (res.linked) {
        await refreshStatus();
        setBanner(
          res.type === 'directory'
            ? `Linked laptop folder "${res.fileName}". Saved ${targetFileName} and sdglobal-it-crm-database.json inside your folder and enabled auto-sync.`
            : `Linked laptop database file "${res.fileName}" (${targetPath}) and wrote live SQLite database with auto-sync enabled.`
        );
      } else if (res.cancelled) {
        // user cancelled picker
      } else if (res.blockedByFrame) {
        setBlockedByIframe(true);
        if (sqliteBlob) {
          triggerDownload(sqliteBlob, targetFileName);
          setBanner(
            `Saved ${targetFileName} to your Downloads folder and synced Laptop IndexedDB. Browser preview frames block direct access to ${targetPath} — click "Open in Full Tab" to bind ${targetPath} directly, or move ${targetFileName} to ${targetPath}.`
          );
        } else {
          setError(res.error || `Picker blocked in embedded frame for ${targetPath}.`);
        }
        await refreshStatus();
      } else {
        setError(res.error || 'Could not link local laptop file.');
      }
    } catch (err: any) {
      setError(err?.message || 'Failed to set up laptop database location.');
    } finally {
      setLinkingFile(false);
    }
  };

  const handleSaveTargetPath = () => {
    setLaptopTargetPath(targetPath);
    setBanner(`Target laptop database path set to "${targetPath.trim() || 'D:\\sdglobal.db'}".`);
  };

  const handleUnlinkDiskFile = async () => {
    await unlinkLaptopDiskFile();
    await refreshStatus();
    setBanner('Unlinked laptop folder/file handle. Laptop IndexedDB database remains intact.');
  };

  const handleDownloadToLaptop = async (format: 'sqlite' | 'json') => {
    setDownloadingFormat(format);
    setError('');
    try {
      const stamp = new Date().toISOString().slice(0, 10);
      if (format === 'json') {
        const snapshot = status?.initialized
          ? await exportLaptopDbSnapshot()
          : await apiFetch<LaptopSnapshotPayload>('/api/auth/security/laptop-snapshot');
        const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' });
        triggerDownload(blob, `sdglobal-it-crm-${stamp}.json`);
        setBanner(`Saved sdglobal-it-crm-${stamp}.json to your laptop Downloads folder.`);
        return;
      }

      const sqliteBlob = await fetchSqliteBlob();
      if (!sqliteBlob) throw new Error('Failed to export SQLite .db file from server.');
      triggerDownload(sqliteBlob, targetFileName);
      setBanner(`Saved ${targetFileName} to your laptop Downloads folder (target path: ${targetPath}).`);
    } catch (err: any) {
      setError(err?.message || 'Failed to download database file.');
    } finally {
      setDownloadingFormat(null);
    }
  };

  const handleRestoreFromLaptopIndexedDb = async () => {
    if (!status?.initialized) return;
    setRestoring(true);
    setError('');
    setBanner('');
    try {
      const snapshot = await exportLaptopDbSnapshot();
      const res = await apiFetch<{ ok: boolean; restoredCounts: Record<string, number> }>('/api/auth/security/restore', {
        method: 'POST',
        body: JSON.stringify({ ...snapshot, source: 'laptop_indexeddb' }),
      });
      const total = Object.values(res.restoredCounts || {}).reduce((acc, n) => acc + Number(n || 0), 0);
      setConfirmRestoreLaptop(false);
      setBanner(`Restored ${total.toLocaleString()} record(s) from your laptop database into the active CRM.`);
    } catch (err: any) {
      setError(err?.message || 'Failed to restore from laptop database.');
    } finally {
      setRestoring(false);
    }
  };

  const handleFileUploadRestore = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    setRestoring(true);
    setError('');
    setBanner('');

    try {
      const lower = file.name.toLowerCase();
      if (lower.endsWith('.db') || lower.endsWith('.sqlite')) {
        const fd = new FormData();
        fd.append('database', file);
        const res = await uploadWithProgress<{ ok: boolean; restoredCounts: Record<string, number> }>(
          '/api/auth/security/restore-sqlite',
          fd
        );
        const total = Object.values(res.restoredCounts || {}).reduce((acc, n) => acc + Number(n || 0), 0);
        setBanner(`Imported SQLite file "${file.name}" (${total.toLocaleString()} records restored) and synced laptop DB.`);
        await handleCreateOrSyncLaptopDb(false);
      } else if (lower.endsWith('.json')) {
        const text = await file.text();
        const parsed = JSON.parse(text);
        if (!parsed?.tables || typeof parsed.tables !== 'object') {
          throw new Error('Selected JSON file is not a valid SD Global IT CRM database export.');
        }
        const res = await apiFetch<{ ok: boolean; restoredCounts: Record<string, number> }>('/api/auth/security/restore', {
          method: 'POST',
          body: JSON.stringify({ ...parsed, source: `file:${file.name}` }),
        });
        await saveSnapshotToLaptopDb(parsed);
        await refreshStatus();
        const total = Object.values(res.restoredCounts || {}).reduce((acc, n) => acc + Number(n || 0), 0);
        setBanner(`Imported JSON database "${file.name}" (${total.toLocaleString()} records restored).`);
      } else {
        throw new Error('Unsupported file format. Choose a .db, .sqlite, or .json database file.');
      }
    } catch (err: any) {
      setError(err?.message || 'Failed to import database file from laptop.');
    } finally {
      setRestoring(false);
    }
  };

  const handleClearLaptopDb = async () => {
    setError('');
    setBanner('');
    await clearLaptopDb();
    await refreshStatus();
    setTableRows([]);
    setBanner('Cleared local laptop IndexedDB copy. Server data was not affected.');
  };

  const copyPath = (label: string, value: string) => {
    navigator.clipboard?.writeText(value).catch(() => {});
    setCopiedPath(label);
    setTimeout(() => setCopiedPath(null), 1800);
  };

  const activeColumns = tableRows.length > 0 ? Object.keys(tableRows[0]).slice(0, 7) : [];

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="p-2.5 rounded-xl bg-blue-50 dark:bg-blue-950/50 border border-blue-200 dark:border-blue-900 text-blue-700 dark:text-blue-400 shrink-0">
            <Laptop className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-base font-display font-bold text-slate-900 dark:text-white">
              Laptop Local Storage Database
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 max-w-2xl">
              Store the complete SD Global IT CRM database on your laptop — both in your browser&apos;s persistent
              <span className="font-mono"> SDGlobal_IT_CRM_LaptopDB</span> and in your own chosen laptop folder as
              <span className="font-mono"> .db</span> (SQLite) and <span className="font-mono">.json</span> files.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          <button
            type="button"
            disabled={linkingFile}
            onClick={() => handleLinkLaptopTarget('file')}
            className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-60 cursor-pointer"
          >
            <FolderOpen className="w-3.5 h-3.5 text-blue-600" />
            <span>{linkingFile ? 'Opening Picker...' : `Bind ${targetFileName} on Laptop`}</span>
          </button>

          <button
            type="button"
            disabled={syncing}
            onClick={() => handleCreateOrSyncLaptopDb(true)}
            className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold rounded-lg bg-blue-700 hover:bg-blue-800 text-white disabled:opacity-60 cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${syncing ? 'animate-spin' : ''}`} />
            <span>
              {syncing
                ? 'Syncing to Laptop...'
                : status?.initialized
                ? 'Sync Now to Laptop DB'
                : 'Create & Store Laptop Database'}
            </span>
          </button>
        </div>
      </div>

      {error && (
        <div className="p-3.5 rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 text-xs text-red-700 dark:text-red-300">
          {error}
        </div>
      )}
      {banner && (
        <div className="p-3.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900 text-xs text-emerald-700 dark:text-emerald-300 flex flex-wrap items-center justify-between gap-3">
          <span className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            <span>{banner}</span>
          </span>
          {blockedByIframe && (
            <a
              href={window.location.href}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white font-semibold whitespace-nowrap"
            >
              <span>Open in Full Tab for Folder Picker</span>
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
          )}
        </div>
      )}

      {/* Google Drive Real-Time 1-Second Folder Sync */}
      <GoogleDriveSyncCard />

      {/* Attached Laptop File & Auto-Sync Status Panel */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div
          className={`rounded-xl border p-4 flex flex-col justify-between gap-3 ${
            status?.autoSync
              ? 'bg-emerald-50/60 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-900'
              : 'bg-amber-50/60 dark:bg-amber-950/20 border-amber-200 dark:border-amber-900'
          }`}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-2.5">
              <RefreshCw
                className={`w-4 h-4 mt-0.5 shrink-0 ${
                  status?.autoSync ? 'text-emerald-700 dark:text-emerald-400' : 'text-amber-700 dark:text-amber-400'
                }`}
              />
              <div>
                <div className="text-xs font-semibold text-slate-900 dark:text-white flex items-center gap-2">
                  <span>Server ↔ Laptop Auto-Sync</span>
                  <span
                    className={`text-[11px] font-mono font-bold ${
                      status?.autoSync ? 'text-emerald-700 dark:text-emerald-400' : 'text-amber-700 dark:text-amber-400'
                    }`}
                  >
                    {status?.autoSync ? 'ENABLED' : 'PAUSED'}
                  </span>
                </div>
                <p className="text-[11px] text-slate-600 dark:text-slate-300 mt-1">
                  {status?.autoSync
                    ? 'Automatically mirrors server database changes to your laptop DB on login, real-time CRM updates, and every 2 minutes.'
                    : 'Background syncing is paused. Re-enable to keep your laptop database synchronized automatically.'}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => handleToggleAutoSync(!status?.autoSync)}
              className="px-3 py-1.5 text-[11px] font-semibold rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 shrink-0 cursor-pointer"
            >
              {status?.autoSync ? 'Pause' : 'Enable Auto-Sync'}
            </button>
          </div>
        </div>

        <div
          className={`rounded-xl border p-4 flex flex-col justify-between gap-3 ${
            status?.linkedFileName && status?.linkedPermission === 'granted'
              ? 'bg-emerald-50/60 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-900'
              : 'bg-amber-50/60 dark:bg-amber-950/20 border-amber-200 dark:border-amber-900'
          }`}
        >
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div className="flex items-start gap-2.5 min-w-0 flex-1">
              {status?.linkedFileName && status?.linkedPermission === 'granted' ? (
                <Link2 className="w-4 h-4 mt-0.5 text-emerald-700 dark:text-emerald-400 shrink-0" />
              ) : (
                <AlertTriangle className="w-4 h-4 mt-0.5 text-amber-700 dark:text-amber-400 shrink-0" />
              )}
              <div className="min-w-0">
                <div className="text-xs font-semibold text-slate-900 dark:text-white flex flex-wrap items-center gap-2">
                  <span>Attached Disk File ({targetFileName})</span>
                  <span
                    className={`text-[11px] font-mono font-bold ${
                      status?.linkedFileName && status?.linkedPermission === 'granted'
                        ? 'text-emerald-700 dark:text-emerald-400'
                        : 'text-amber-700 dark:text-amber-400'
                    }`}
                  >
                    {!status?.linkedFileName
                      ? 'NOT ATTACHED'
                      : status.linkedPermission === 'granted'
                      ? 'ATTACHED & WRITABLE'
                      : status.linkedPermission === 'prompt'
                      ? 'NEEDS 1-CLICK RESUME'
                      : 'PERMISSION DENIED'}
                  </span>
                </div>
                <p className="text-[11px] text-slate-600 dark:text-slate-300 mt-1 break-words">
                  {status?.linkedFileName && status.linkedPermission === 'granted' ? (
                    <>
                      Attached to <span className="font-mono font-semibold">{status.linkedFileName}</span> (target:{' '}
                      <span className="font-mono">{targetPath}</span>). Auto-sync writes live SQLite updates directly
                      to this file.
                    </>
                  ) : status?.linkedFileName && status.linkedPermission === 'prompt' ? (
                    <>
                      <span className="font-mono font-semibold">{status.linkedFileName}</span> is attached, but the
                      browser paused disk write permission after reload. Click Resume once to re-enable live writes.
                    </>
                  ) : (
                    <>
                      Browser IndexedDB is auto-synced, but <span className="font-mono">{targetPath}</span> is not yet
                      attached for direct disk writes. Attach it once in a full browser tab.
                    </>
                  )}
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 shrink-0">
              {status?.linkedFileName && status.linkedPermission === 'prompt' ? (
                <button
                  type="button"
                  disabled={syncing}
                  onClick={() => handleCreateOrSyncLaptopDb(true)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-semibold rounded-lg bg-amber-600 hover:bg-amber-700 text-white disabled:opacity-60 cursor-pointer"
                >
                  <ShieldCheck className="w-3.5 h-3.5" />
                  Resume Auto-Sync Write Access
                </button>
              ) : !status?.linkedFileName || status.linkedPermission === 'denied' ? (
                <>
                  <button
                    type="button"
                    disabled={linkingFile}
                    onClick={() => handleLinkLaptopTarget('file')}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-semibold rounded-lg bg-blue-700 hover:bg-blue-800 text-white disabled:opacity-60 cursor-pointer"
                  >
                    <FolderOpen className="w-3.5 h-3.5" />
                    {linkingFile ? 'Opening Picker...' : `Attach ${targetFileName}`}
                  </button>
                  <a
                    href={window.location.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-medium rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800"
                  >
                    <ExternalLink className="w-3 h-3" />
                    Full Tab
                  </a>
                </>
              ) : (
                <button
                  type="button"
                  disabled={syncing}
                  onClick={() => handleCreateOrSyncLaptopDb(true)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-semibold rounded-lg border border-emerald-300 dark:border-emerald-800 bg-white dark:bg-slate-900 text-emerald-800 dark:text-emerald-300 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 disabled:opacity-60 cursor-pointer"
                >
                  <RefreshCw className={`w-3 h-3 ${syncing ? 'animate-spin' : ''}`} />
                  Write Now
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Telemetry Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
          <div className="text-xs text-slate-500">Laptop Database Status</div>
          <div className="mt-1.5 flex items-center justify-between gap-2">
            <span
              className={`text-sm font-display font-bold ${
                status?.initialized ? 'text-emerald-700 dark:text-emerald-400' : 'text-amber-700 dark:text-amber-400'
              }`}
            >
              {loading ? 'Checking...' : status?.initialized ? 'Active on Laptop' : 'Not Created Yet'}
            </span>
            <Database className="w-4 h-4 text-slate-400" />
          </div>
          <div className="mt-1 text-[11px] font-mono text-slate-500">
            {status?.lastSyncAt ? `Last sync: ${formatDateTime(status.lastSyncAt)}` : 'Click Create & Store above'}
          </div>
        </div>

        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
          <div className="text-xs text-slate-500">Records Stored on Laptop</div>
          <div className="mt-1.5 text-xl font-mono font-bold tabular-nums text-slate-900 dark:text-white">
            {(status?.totalRecords ?? 0).toLocaleString()}
          </div>
          <div className="mt-1 text-[11px] text-slate-500">
            Across {LAPTOP_TABLE_SPECS.length} local IndexedDB tables
          </div>
        </div>

        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
          <div className="text-xs text-slate-500">Laptop Browser Storage Used</div>
          <div className="mt-1.5 text-xl font-mono font-bold tabular-nums text-slate-900 dark:text-white">
            {status?.storage?.supported ? formatBytesCompact(status.storage.usageBytes) : '—'}
          </div>
          <div className="mt-1 text-[11px] font-mono text-slate-500">
            {status?.storage?.quotaBytes
              ? `Quota: ${formatBytesCompact(status.storage.quotaBytes)}`
              : 'Origin storage estimate'}
          </div>
        </div>

        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
          <div className="text-xs text-slate-500">Persistence &amp; Auto-Sync</div>
          <div className="mt-1.5 flex items-center justify-between gap-2">
            <span className="text-sm font-semibold text-slate-900 dark:text-white">
              {status?.storage?.persisted ? 'Persistent Lock' : 'Standard Origin'}
            </span>
            {!status?.storage?.persisted && (
              <button
                type="button"
                onClick={handleRequestPersistence}
                className="text-[11px] font-semibold text-blue-700 dark:text-blue-400 hover:underline cursor-pointer"
              >
                Lock Storage
              </button>
            )}
          </div>
          <label className="mt-2 inline-flex items-center gap-2 text-[11px] text-slate-600 dark:text-slate-300 cursor-pointer">
            <input
              type="checkbox"
              checked={Boolean(status?.autoSync)}
              onChange={(e) => handleToggleAutoSync(e.target.checked)}
            />
            <span>Auto-sync CRM changes to laptop</span>
          </label>
        </div>
      </div>

      {/* Laptop Storage Location Configuration */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-display font-bold">
              Configured Laptop Database Location ({osPaths.osLabel} Detected)
            </h3>
            <p className="text-xs text-slate-500">
              Your target path is set to <span className="font-mono font-semibold">{targetPath}</span>. Because browsers
              sandbox local drives, click <span className="font-semibold">Bind {targetFileName} on Laptop</span> once in
              a full browser tab and select <span className="font-mono">{targetPath}</span> to allow direct writes.
            </p>
          </div>
          <a
            href={window.location.href}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-300 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800"
          >
            <ExternalLink className="w-3.5 h-3.5" />
            Open Full Browser Tab
          </a>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <input
            type="text"
            value={targetPath}
            onChange={(e) => setTargetPath(e.target.value)}
            placeholder="D:\sdglobal.db"
            className="flex-1 min-w-[240px] px-3 py-2 text-xs font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
          />
          <button
            type="button"
            onClick={handleSaveTargetPath}
            className="px-3.5 py-2 text-xs font-semibold rounded-lg border border-slate-300 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
          >
            Save Target Path
          </button>
          <button
            type="button"
            disabled={linkingFile}
            onClick={() => handleLinkLaptopTarget('file')}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-lg bg-blue-700 hover:bg-blue-800 text-white disabled:opacity-50 cursor-pointer"
          >
            <FolderOpen className="w-3.5 h-3.5" />
            Select &amp; Write {targetFileName}
          </button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 text-xs">
          <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 space-y-1">
            <div className="flex items-center justify-between gap-2">
              <span className="font-semibold text-slate-700 dark:text-slate-300">
                1. Browser IndexedDB Folder (Auto-Synced)
              </span>
              <button
                type="button"
                onClick={() => copyPath('idb', osPaths.indexedDbPath)}
                className="inline-flex items-center gap-1 text-[11px] text-blue-700 dark:text-blue-400 hover:underline cursor-pointer"
              >
                <Copy className="w-3 h-3" />
                {copiedPath === 'idb' ? 'Copied' : 'Copy'}
              </button>
            </div>
            <div className="font-mono text-[11px] text-slate-500 break-all">{osPaths.indexedDbPath}</div>
          </div>

          <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 space-y-1">
            <div className="flex items-center justify-between gap-2">
              <span className="font-semibold text-slate-700 dark:text-slate-300">
                2. Target Disk Database File
              </span>
              <button
                type="button"
                onClick={() => copyPath('dl', targetPath)}
                className="inline-flex items-center gap-1 text-[11px] text-blue-700 dark:text-blue-400 hover:underline cursor-pointer"
              >
                <Copy className="w-3 h-3" />
                {copiedPath === 'dl' ? 'Copied' : 'Copy'}
              </button>
            </div>
            <div className="font-mono text-[11px] text-slate-500 break-all">
              {status?.linkedFileName
                ? `Linked ${status.linkedType === 'directory' ? 'Folder' : 'File'}: ${status.linkedFileName} (target: ${targetPath})`
                : `${targetPath} (Downloads fallback: ${osPaths.downloadsPath}${targetFileName})`}
            </div>
          </div>
        </div>
      </div>

      {/* Save to Laptop Disk + Restore from Laptop */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        {/* Card 1: Direct Laptop Hard-Drive File & Backups */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="text-sm font-display font-bold flex items-center gap-2">
                <FolderSync className="w-4 h-4 text-blue-600" />
                Save Database to Laptop Hard Drive
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Link your own laptop folder so updates write <span className="font-mono">.db</span> and{' '}
                <span className="font-mono">.json</span> straight to your disk, or save standalone database files.
              </p>
            </div>
          </div>

          <div className="p-3.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/60 flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                {status?.linkedFileName
                  ? `Linked ${status.linkedType === 'directory' ? 'Laptop Folder' : 'Laptop File'}: ${status.linkedFileName}`
                  : 'No Custom Laptop Folder Linked Yet'}
              </div>
              <div className="text-[11px] text-slate-500 mt-0.5">
                {status?.linkedFileName
                  ? 'Every sync updates sdglobal-it-crm-database.db and .json inside your chosen laptop folder.'
                  : 'Pick any folder on your laptop (e.g. Documents/SDGlobal-IT-CRM-DB) in Chrome/Edge.'}
              </div>
            </div>
            {status?.linkedFileName ? (
              <button
                type="button"
                onClick={handleUnlinkDiskFile}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-300 dark:border-slate-700 hover:bg-white dark:hover:bg-slate-900 cursor-pointer"
              >
                <Unlink className="w-3.5 h-3.5" />
                Unlink Folder
              </button>
            ) : (
              <button
                type="button"
                disabled={linkingFile}
                onClick={() => handleLinkLaptopTarget('directory')}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold rounded-lg bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 hover:opacity-90 disabled:opacity-50 cursor-pointer"
              >
                <FolderOpen className="w-3.5 h-3.5" />
                {linkingFile ? 'Selecting...' : 'Choose Laptop Folder'}
              </button>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <button
              type="button"
              disabled={downloadingFormat !== null}
              onClick={() => handleDownloadToLaptop('sqlite')}
              className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 hover:border-blue-600 text-left space-y-1 cursor-pointer disabled:opacity-50"
            >
              <div className="flex items-center justify-between">
                <Database className="w-4 h-4 text-blue-600" />
                <Download className="w-3.5 h-3.5 text-slate-400" />
              </div>
              <div className="text-xs font-semibold">
                {downloadingFormat === 'sqlite' ? 'Exporting .db...' : 'Save SQLite (.db) to Laptop'}
              </div>
              <div className="text-[11px] text-slate-500">Full SQLite binary database file</div>
            </button>

            <button
              type="button"
              disabled={downloadingFormat !== null}
              onClick={() => handleDownloadToLaptop('json')}
              className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 hover:border-blue-600 text-left space-y-1 cursor-pointer disabled:opacity-50"
            >
              <div className="flex items-center justify-between">
                <HardDrive className="w-4 h-4 text-emerald-600" />
                <Download className="w-3.5 h-3.5 text-slate-400" />
              </div>
              <div className="text-xs font-semibold">
                {downloadingFormat === 'json' ? 'Exporting .json...' : 'Save JSON DB to Laptop'}
              </div>
              <div className="text-[11px] text-slate-500">Portable JSON database bundle</div>
            </button>
          </div>
        </div>

        {/* Card 2: Restore CRM Data from Laptop Storage */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-4">
          <div>
            <h3 className="text-sm font-display font-bold flex items-center gap-2">
              <RotateCcw className="w-4 h-4 text-emerald-600" />
              Restore Database from Laptop Storage
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Restore tickets, assets, budgets, employees, and settings from your laptop&apos;s IndexedDB database or by
              selecting a <span className="font-mono">.db</span> / <span className="font-mono">.json</span> file from your computer.
            </p>
          </div>

          <div className="space-y-3">
            <div className="p-3.5 rounded-lg border border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-xs font-semibold">Restore from Laptop IndexedDB</div>
                <div className="text-[11px] text-slate-500">
                  {status?.initialized
                    ? `${status.totalRecords.toLocaleString()} records ready in browser storage`
                    : 'Sync your laptop database first to enable instant restore'}
                </div>
              </div>

              {confirmRestoreLaptop ? (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={restoring}
                    onClick={handleRestoreFromLaptopIndexedDb}
                    className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white cursor-pointer disabled:opacity-50"
                  >
                    {restoring ? 'Restoring...' : 'Confirm Restore'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmRestoreLaptop(false)}
                    className="px-2.5 py-1.5 text-xs rounded-lg border border-slate-300 dark:border-slate-700 cursor-pointer"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  disabled={!status?.initialized || restoring}
                  onClick={() => setConfirmRestoreLaptop(true)}
                  className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold rounded-lg border border-emerald-600 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-950/30 disabled:opacity-40 cursor-pointer"
                >
                  <ShieldCheck className="w-3.5 h-3.5" />
                  Restore from Laptop DB
                </button>
              )}
            </div>

            <div className="p-3.5 rounded-lg border border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-xs font-semibold">Import Database File (.db or .json)</div>
                <div className="text-[11px] text-slate-500">
                  Load a previously saved SQLite or JSON database file from your laptop.
                </div>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept=".db,.sqlite,.json"
                onChange={handleFileUploadRestore}
                className="hidden"
              />
              <button
                type="button"
                disabled={restoring}
                onClick={() => fileInputRef.current?.click()}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold rounded-lg bg-blue-700 hover:bg-blue-800 text-white disabled:opacity-50 cursor-pointer"
              >
                <FileUp className="w-3.5 h-3.5" />
                {restoring ? 'Importing...' : 'Import File from Laptop'}
              </button>
            </div>
          </div>

          {status?.initialized && (
            <div className="pt-2 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between text-xs">
              <span className="text-slate-500">Need to reset the local browser copy?</span>
              <button
                type="button"
                onClick={handleClearLaptopDb}
                className="inline-flex items-center gap-1 text-red-600 hover:underline cursor-pointer font-medium"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Clear Laptop Cache
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Live Laptop IndexedDB Table Inspector */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-display font-bold">Laptop Storage Database Tables</h3>
            <p className="text-xs text-slate-500">
              Browse records stored locally inside your laptop&apos;s IndexedDB object stores.
            </p>
          </div>
          <select
            value={selectedTable}
            onChange={(e) => setSelectedTable(e.target.value)}
            className="px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
          >
            {LAPTOP_TABLE_SPECS.map((t) => (
              <option key={t.name} value={t.name}>
                {t.label} ({status?.tableCounts?.[t.name] ?? 0})
              </option>
            ))}
          </select>
        </div>

        <div className="px-5 py-3 border-b border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-950/40 flex flex-wrap gap-2">
          {LAPTOP_TABLE_SPECS.slice(0, 12).map((t) => {
            const count = status?.tableCounts?.[t.name] ?? 0;
            const active = selectedTable === t.name;
            return (
              <button
                key={t.name}
                type="button"
                onClick={() => setSelectedTable(t.name)}
                className={`px-2.5 py-1 text-[11px] rounded-md border cursor-pointer font-medium ${
                  active
                    ? 'border-blue-600 bg-blue-50 dark:bg-blue-950/50 text-blue-700 dark:text-blue-300'
                    : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300'
                }`}
              >
                {t.label} <span className="font-mono ml-1 text-slate-400">{count}</span>
              </button>
            );
          })}
        </div>

        <div className="overflow-x-auto max-h-80 overflow-y-auto">
          {!status?.initialized ? (
            <div className="py-12 text-center text-xs text-slate-500">
              Click <span className="font-semibold text-slate-700 dark:text-slate-300">Choose Laptop Folder &amp; Save</span> or{' '}
              <span className="font-semibold text-slate-700 dark:text-slate-300">Create &amp; Store Laptop Database</span> above to initialize your local storage tables.
            </div>
          ) : loadingRows ? (
            <div className="py-10 text-center text-xs text-slate-500">Loading records from laptop storage...</div>
          ) : tableRows.length === 0 ? (
            <div className="py-10 text-center text-xs text-slate-500">No records in this table yet.</div>
          ) : (
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/50 text-slate-500">
                  {activeColumns.map((col) => (
                    <th key={col} className="py-2.5 px-3 font-mono font-semibold whitespace-nowrap">
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {tableRows.map((row, idx) => (
                  <tr key={row.id ?? row.entity_key ?? idx} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                    {activeColumns.map((col) => {
                      const val = row[col];
                      const display =
                        val === null || val === undefined
                          ? '—'
                          : typeof val === 'object'
                          ? JSON.stringify(val)
                          : String(val);
                      return (
                        <td key={col} className="py-2 px-3 max-w-[220px] truncate font-mono text-[11px]">
                          {display}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
