import { getApps, initializeApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  User,
} from 'firebase/auth';
import firebaseConfig from '../../firebase-applet-config.json';
import { getBrowserConsoleLogs, getBrowserConsoleSeq } from './consoleCapture.ts';
import type { LaptopSnapshotPayload } from './laptopDb.ts';

export const SCOPES = ['https://www.googleapis.com/auth/drive'];

export const DEFAULT_DRIVE_FOLDER_URL =
  'https://drive.google.com/drive/folders/1ccsXoGskaelOLMpQr6eOX3Woqp7NuzYU?usp=drive_link';
export const DEFAULT_DRIVE_FOLDER_ID = '1ccsXoGskaelOLMpQr6eOX3Woqp7NuzYU';

const FOLDER_URL_KEY = 'sdgl_gdrive_folder_url';
const DRIVE_AUTOSYNC_KEY = 'sdgl_gdrive_autosync';
const DRIVE_INTERVAL_MS_KEY = 'sdgl_gdrive_interval_ms';

const app = getApps().length > 0 ? getApps()[0] : initializeApp(firebaseConfig);
const auth = getAuth(app);

const provider = new GoogleAuthProvider();
for (const scope of SCOPES) {
  provider.addScope(scope);
}
provider.setCustomParameters({ prompt: 'select_account' });

// Access token MUST remain in memory only (never stored in localStorage/sessionStorage)
let isSigningIn = false;
let cachedAccessToken: string | null = null;
let currentGoogleUser: User | null = null;
let sessionWriteConfirmed = false;

export interface DriveSyncedFileInfo {
  name: string;
  fileId: string;
  mimeType: string;
  sizeBytes: number;
  updatedAt: string;
  webViewLink?: string;
}

export interface DriveSyncStateSnapshot {
  authenticated: boolean;
  userEmail: string | null;
  userName: string | null;
  writeConfirmed: boolean;
  autoSyncEnabled: boolean;
  intervalMs: number;
  folderUrl: string;
  folderId: string;
  folderName: string | null;
  lastHeartbeatAt: string | null;
  lastUploadedAt: string | null;
  syncCount: number;
  isUploading: boolean;
  lastError: string | null;
  needsReauth: boolean;
  files: Record<string, DriveSyncedFileInfo>;
}

const fileIdCache = new Map<string, string>();
let stateSnapshot: DriveSyncStateSnapshot = {
  authenticated: false,
  userEmail: null,
  userName: null,
  writeConfirmed: false,
  autoSyncEnabled: getDriveAutoSyncEnabled(),
  intervalMs: getDriveSyncIntervalMs(),
  folderUrl: getDriveFolderUrl(),
  folderId: extractGoogleDriveFolderId(getDriveFolderUrl()),
  folderName: null,
  lastHeartbeatAt: null,
  lastUploadedAt: null,
  syncCount: 0,
  isUploading: false,
  lastError: null,
  needsReauth: false,
  files: {},
};

function emitDriveState(patch?: Partial<DriveSyncStateSnapshot>) {
  if (patch) {
    stateSnapshot = {
      ...stateSnapshot,
      ...patch,
      files: patch.files ? { ...patch.files } : stateSnapshot.files,
    };
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('sdgl:gdrive-status', { detail: stateSnapshot }));
  }
}

export function getDriveSyncState(): DriveSyncStateSnapshot {
  return {
    ...stateSnapshot,
    autoSyncEnabled: getDriveAutoSyncEnabled(),
    intervalMs: getDriveSyncIntervalMs(),
    folderUrl: getDriveFolderUrl(),
    folderId: extractGoogleDriveFolderId(getDriveFolderUrl()),
    files: { ...stateSnapshot.files },
  };
}

export function extractGoogleDriveFolderId(urlOrId: string): string {
  const trimmed = (urlOrId || '').trim();
  if (!trimmed) return DEFAULT_DRIVE_FOLDER_ID;
  const folderMatch = trimmed.match(/\/folders\/([a-zA-Z0-9_-]+)/);
  if (folderMatch?.[1]) return folderMatch[1];
  const idParamMatch = trimmed.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (idParamMatch?.[1]) return idParamMatch[1];
  if (/^[a-zA-Z0-9_-]{10,}$/.test(trimmed)) return trimmed;
  return DEFAULT_DRIVE_FOLDER_ID;
}

export function getDriveFolderUrl(): string {
  try {
    return localStorage.getItem(FOLDER_URL_KEY) || DEFAULT_DRIVE_FOLDER_URL;
  } catch {
    return DEFAULT_DRIVE_FOLDER_URL;
  }
}

export function setDriveFolderUrl(nextUrl: string): string {
  const clean = (nextUrl || '').trim() || DEFAULT_DRIVE_FOLDER_URL;
  try {
    localStorage.setItem(FOLDER_URL_KEY, clean);
  } catch {
    // ignore storage errors
  }
  const folderId = extractGoogleDriveFolderId(clean);
  fileIdCache.clear();
  emitDriveState({
    folderUrl: clean,
    folderId,
    folderName: null,
    files: {},
  });
  return folderId;
}

export function getDriveAutoSyncEnabled(): boolean {
  try {
    return localStorage.getItem(DRIVE_AUTOSYNC_KEY) !== '0';
  } catch {
    return true;
  }
}

export function setDriveAutoSyncEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(DRIVE_AUTOSYNC_KEY, enabled ? '1' : '0');
  } catch {
    // ignore
  }
  emitDriveState({ autoSyncEnabled: enabled });
}

export function getDriveSyncIntervalMs(): number {
  try {
    const raw = Number(localStorage.getItem(DRIVE_INTERVAL_MS_KEY) || 1000);
    if (!Number.isFinite(raw) || raw < 1000) return 1000;
    return raw;
  } catch {
    return 1000;
  }
}

export function setDriveSyncIntervalMs(ms: number): void {
  const safe = Math.max(1000, Math.floor(ms || 1000));
  try {
    localStorage.setItem(DRIVE_INTERVAL_MS_KEY, String(safe));
  } catch {
    // ignore
  }
  emitDriveState({ intervalMs: safe });
}

export function setDriveWriteConfirmed(confirmed: boolean): void {
  sessionWriteConfirmed = confirmed;
  emitDriveState({ writeConfirmed: confirmed });
}

export function isDriveWriteConfirmed(): boolean {
  return sessionWriteConfirmed;
}

export const initGoogleDriveAuth = (
  onAuthSuccess?: (user: User, token: string) => void,
  onAuthFailure?: () => void
) => {
  return onAuthStateChanged(auth, (user: User | null) => {
    currentGoogleUser = user;
    if (user && cachedAccessToken) {
      emitDriveState({
        authenticated: true,
        userEmail: user.email,
        userName: user.displayName,
        needsReauth: false,
      });
      if (onAuthSuccess) onAuthSuccess(user, cachedAccessToken);
    } else if (!isSigningIn) {
      if (!user) {
        cachedAccessToken = null;
        sessionWriteConfirmed = false;
      }
      emitDriveState({
        authenticated: Boolean(user && cachedAccessToken),
        userEmail: user?.email || null,
        userName: user?.displayName || null,
        writeConfirmed: sessionWriteConfirmed,
        needsReauth: Boolean(user && !cachedAccessToken),
      });
      if (onAuthFailure) onAuthFailure();
    }
  });
};

export const googleDriveSignIn = async (): Promise<{ user: User; accessToken: string } | null> => {
  try {
    isSigningIn = true;
    const result = await signInWithPopup(auth, provider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    if (!credential?.accessToken) {
      throw new Error('Failed to get Google Drive access token.');
    }
    cachedAccessToken = credential.accessToken;
    currentGoogleUser = result.user;
    emitDriveState({
      authenticated: true,
      userEmail: result.user.email,
      userName: result.user.displayName,
      lastError: null,
      needsReauth: false,
    });
    return { user: result.user, accessToken: cachedAccessToken };
  } finally {
    isSigningIn = false;
  }
};

export const googleDriveSignOut = async () => {
  await auth.signOut();
  cachedAccessToken = null;
  currentGoogleUser = null;
  sessionWriteConfirmed = false;
  fileIdCache.clear();
  emitDriveState({
    authenticated: false,
    userEmail: null,
    userName: null,
    writeConfirmed: false,
    folderName: null,
    needsReauth: false,
    files: {},
  });
};

export const getGoogleDriveAccessToken = (): string | null => cachedAccessToken;
export const getGoogleDriveUser = (): User | null => currentGoogleUser;

export async function verifyDriveFolderAccess(folderId: string): Promise<{
  id: string;
  name: string;
  webViewLink?: string;
} | null> {
  const token = cachedAccessToken;
  if (!token) return null;

  const url = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(
    folderId
  )}?fields=id,name,mimeType,webViewLink&supportsAllDrives=true`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status === 401) {
    cachedAccessToken = null;
    emitDriveState({ authenticated: false, needsReauth: true, lastError: 'Google Drive session expired. Please reconnect.' });
    throw new Error('Google Drive token expired. Reconnect Google Drive.');
  }
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Unable to access Google Drive folder (${res.status}): ${errText || res.statusText}`);
  }
  const data = (await res.json()) as { id: string; name: string; webViewLink?: string };
  emitDriveState({ folderName: data.name, lastError: null });
  return data;
}

async function findFileIdInFolder(
  folderId: string,
  fileName: string,
  token: string
): Promise<string | null> {
  const cacheKey = `${folderId}:${fileName}`;
  const cached = fileIdCache.get(cacheKey);
  if (cached) return cached;

  const escapedName = fileName.replace(/'/g, "\\'");
  const q = `'${folderId}' in parents and name = '${escapedName}' and trashed = false`;
  const listUrl = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(
    q
  )}&fields=files(id,name)&pageSize=5&supportsAllDrives=true&includeItemsFromAllDrives=true`;

  const res = await fetch(listUrl, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status === 401) {
    cachedAccessToken = null;
    emitDriveState({ authenticated: false, needsReauth: true, lastError: 'Google Drive session expired. Please reconnect.' });
    throw new Error('Google Drive session expired. Click Sign in with Google to resume.');
  }
  if (!res.ok) return null;
  const data = (await res.json()) as { files?: Array<{ id: string; name: string }> };
  const found = data.files?.[0]?.id || null;
  if (found) fileIdCache.set(cacheKey, found);
  return found;
}

async function upsertDriveFile(
  folderId: string,
  fileName: string,
  mimeType: string,
  content: Blob | string,
  token: string
): Promise<DriveSyncedFileInfo> {
  const blob = typeof content === 'string' ? new Blob([content], { type: mimeType }) : content;
  const existingId = await findFileIdInFolder(folderId, fileName, token);

  if (existingId) {
    const patchUrl = `https://www.googleapis.com/upload/drive/v3/files/${encodeURIComponent(
      existingId
    )}?uploadType=media&fields=id,name,mimeType,size,modifiedTime,webViewLink&supportsAllDrives=true`;
    const patchRes = await fetch(patchUrl, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': mimeType,
      },
      body: blob,
    });

    if (patchRes.status === 401) {
      cachedAccessToken = null;
      emitDriveState({
        authenticated: false,
        needsReauth: true,
        lastError: 'Google Drive authorization expired. Click Sign in with Google to reconnect.',
      });
      throw new Error('Google Drive session expired');
    }

    if (patchRes.status === 404) {
      fileIdCache.delete(`${folderId}:${fileName}`);
    } else if (!patchRes.ok) {
      const errBody = await patchRes.text().catch(() => '');
      throw new Error(`Drive update failed for ${fileName} (${patchRes.status}): ${errBody}`);
    } else {
      const meta = (await patchRes.json()) as any;
      return {
        name: fileName,
        fileId: meta.id || existingId,
        mimeType,
        sizeBytes: Number(meta.size || blob.size),
        updatedAt: meta.modifiedTime || new Date().toISOString(),
        webViewLink: meta.webViewLink,
      };
    }
  }

  // Create new file inside folderId via multipart/related upload
  const boundary = `sdgl_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  const metadata = JSON.stringify({
    name: fileName,
    parents: [folderId],
    mimeType,
  });

  const multipartBody = new Blob(
    [
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n`,
      `--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`,
      blob,
      `\r\n--${boundary}--`,
    ],
    { type: `multipart/related; boundary=${boundary}` }
  );

  const createRes = await fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,mimeType,size,modifiedTime,webViewLink&supportsAllDrives=true',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
      },
      body: multipartBody,
    }
  );

  if (createRes.status === 401) {
    cachedAccessToken = null;
    emitDriveState({
      authenticated: false,
      needsReauth: true,
      lastError: 'Google Drive authorization expired. Click Sign in with Google to reconnect.',
    });
    throw new Error('Google Drive session expired');
  }

  if (!createRes.ok) {
    const errBody = await createRes.text().catch(() => '');
    throw new Error(`Drive upload failed for ${fileName} (${createRes.status}): ${errBody}`);
  }

  const meta = (await createRes.json()) as any;
  if (meta.id) {
    fileIdCache.set(`${folderId}:${fileName}`, meta.id);
  }
  return {
    name: fileName,
    fileId: meta.id,
    mimeType,
    sizeBytes: Number(meta.size || blob.size),
    updatedAt: meta.modifiedTime || new Date().toISOString(),
    webViewLink: meta.webViewLink,
  };
}

export interface FullLogsBundlePayload {
  system: string;
  generatedAt: string;
  dbPath: string;
  dbSizeBytes: number;
  walSizeBytes: number;
  consoleSeq: number;
  tableCounts: Record<string, number>;
  serverConsoleLogs: Array<{ seq: number; timestamp: string; level: string; message: string }>;
  auditLogs: any[];
  ticketActivities: any[];
  loginSessions: any[];
  emailCommunications: any[];
  whatsappCommunications: any[];
  websiteVisits: any[];
  assetHistory: any[];
  assetImportBatches: any[];
  expenseApprovals: any[];
  notifications: any[];
}

function formatCombinedConsoleLogText(fullLogs: FullLogsBundlePayload): string {
  const browserLogs = getBrowserConsoleLogs(600);
  const lines: string[] = [
    `========================================================================`,
    `SD GLOBAL IT CRM — CONTINUOUS SERVER & CONSOLE LOG ARCHIVE`,
    `Generated At : ${new Date().toISOString()}`,
    `SQLite Path  : ${fullLogs.dbPath} (${fullLogs.dbSizeBytes} bytes, WAL ${fullLogs.walSizeBytes} bytes)`,
    `Server Logs  : ${fullLogs.serverConsoleLogs?.length ?? 0} entries`,
    `Browser Logs : ${browserLogs.length} entries (seq ${getBrowserConsoleSeq()})`,
    `========================================================================`,
    '',
    '--- [SERVER CONSOLE LOGS] ---',
  ];

  for (const entry of fullLogs.serverConsoleLogs || []) {
    lines.push(`[${entry.timestamp}] [SERVER:${entry.level.toUpperCase()}] #${entry.seq} ${entry.message}`);
  }

  lines.push('', '--- [CLIENT / BROWSER CONSOLE LOGS] ---');
  for (const entry of browserLogs) {
    lines.push(`[${entry.timestamp}] [BROWSER:${entry.level.toUpperCase()}] #${entry.seq} ${entry.message}`);
  }

  return lines.join('\n') + '\n';
}

export async function syncAllDatabaseFilesToGoogleDrive(params: {
  sqliteBlob: Blob;
  snapshot: LaptopSnapshotPayload;
  fullLogs: FullLogsBundlePayload;
  targetDbFileName?: string;
}): Promise<Record<string, DriveSyncedFileInfo>> {
  const token = cachedAccessToken;
  if (!token) {
    throw new Error('Not signed in to Google Drive.');
  }
  if (!sessionWriteConfirmed) {
    throw new Error('Google Drive write confirmation required before updating files.');
  }

  const folderId = extractGoogleDriveFolderId(getDriveFolderUrl());
  emitDriveState({ isUploading: true, lastError: null });

  try {
    if (!stateSnapshot.folderName) {
      await verifyDriveFolderAccess(folderId);
    }

    const dbName = params.targetDbFileName || 'sdglobal.db';
    const consoleText = formatCombinedConsoleLogText(params.fullLogs);
    const enrichedLogsBundle = {
      ...params.fullLogs,
      browserConsoleLogs: getBrowserConsoleLogs(600),
      browserConsoleSeq: getBrowserConsoleSeq(),
    };

    const [dbFile, snapshotFile, logsFile, consoleFile] = await Promise.all([
      upsertDriveFile(folderId, dbName, 'application/x-sqlite3', params.sqliteBlob, token),
      upsertDriveFile(
        folderId,
        'sdglobal-full-database.json',
        'application/json',
        JSON.stringify(params.snapshot, null, 2),
        token
      ),
      upsertDriveFile(
        folderId,
        'sdglobal-audit-and-system-logs.json',
        'application/json',
        JSON.stringify(enrichedLogsBundle, null, 2),
        token
      ),
      upsertDriveFile(folderId, 'sdglobal-console-logs.log', 'text/plain', consoleText, token),
    ]);

    const files: Record<string, DriveSyncedFileInfo> = {
      [dbFile.name]: dbFile,
      [snapshotFile.name]: snapshotFile,
      [logsFile.name]: logsFile,
      [consoleFile.name]: consoleFile,
    };

    const now = new Date().toISOString();
    emitDriveState({
      isUploading: false,
      lastUploadedAt: now,
      lastHeartbeatAt: now,
      syncCount: stateSnapshot.syncCount + 1,
      lastError: null,
      files,
    });

    return files;
  } catch (err: any) {
    emitDriveState({
      isUploading: false,
      lastError: err?.message || 'Google Drive upload failed',
    });
    throw err;
  }
}

export function recordDriveHeartbeatCheck() {
  emitDriveState({ lastHeartbeatAt: new Date().toISOString() });
}
