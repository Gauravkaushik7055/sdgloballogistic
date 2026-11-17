export const LAPTOP_DB_NAME = 'SDGlobal_IT_CRM_LaptopDB';
export const LAPTOP_DB_VERSION = 1;
const META_STORE = '_meta';
const FILE_HANDLE_STORE = '_file_handles';
const AUTO_SYNC_KEY = 'sdgl_laptop_db_autosync';
const TARGET_PATH_KEY = 'sdgl_laptop_db_target_path';
export const DEFAULT_LAPTOP_DB_PATH = 'D:\\sdglobal.db';

export const LAPTOP_TABLE_SPECS: Array<{
  name: string;
  label: string;
  keyPath: string;
}> = [
  { name: 'tickets', label: 'Support Tickets', keyPath: 'id' },
  { name: 'ticket_activities', label: 'Ticket Activities', keyPath: 'id' },
  { name: 'ticket_comments', label: 'Ticket Comments', keyPath: 'id' },
  { name: 'ticket_assignments', label: 'Ticket Assignments', keyPath: 'id' },
  { name: 'ticket_time_logs', label: 'Ticket Time Logs', keyPath: 'id' },
  { name: 'it_assets', label: 'IT Assets', keyPath: 'id' },
  { name: 'asset_maintenance', label: 'Asset Maintenance', keyPath: 'id' },
  { name: 'asset_history', label: 'Asset Lifecycle History', keyPath: 'id' },
  { name: 'it_budgets', label: 'IT Budgets', keyPath: 'id' },
  { name: 'expenses', label: 'IT Expenses', keyPath: 'id' },
  { name: 'expense_approvals', label: 'Expense Approvals', keyPath: 'id' },
  { name: 'employees', label: 'Employees', keyPath: 'id' },
  { name: 'moderators', label: 'IT Moderators', keyPath: 'id' },
  { name: 'locations', label: 'Hubs & Locations', keyPath: 'id' },
  { name: 'departments', label: 'Departments', keyPath: 'id' },
  { name: 'vendors', label: 'Vendors', keyPath: 'id' },
  { name: 'sla_configurations', label: 'SLA Policies', keyPath: 'id' },
  { name: 'dropdown_options', label: 'Dropdown Options', keyPath: 'id' },
  { name: 'direct_messages', label: 'Direct Chat Messages', keyPath: 'id' },
  { name: 'saved_reports', label: 'Saved Reports', keyPath: 'id' },
  { name: 'broadcast_notifications', label: 'Broadcasts', keyPath: 'id' },
  { name: 'retention_policies', label: 'Retention Policies', keyPath: 'entity_key' },
  { name: 'audit_logs', label: 'Audit Logs', keyPath: 'id' },
];

export interface LaptopSnapshotPayload {
  system: string;
  schemaVersion: number;
  exportedAt: string;
  serverDbBytes?: number;
  tableCounts?: Record<string, number>;
  tables: Record<string, any[]>;
}

export interface LaptopStorageEstimate {
  supported: boolean;
  usageBytes: number;
  quotaBytes: number;
  persisted: boolean;
}

export interface LaptopDbStatus {
  initialized: boolean;
  dbName: string;
  createdAt: string | null;
  lastSyncAt: string | null;
  serverDbBytes: number;
  totalRecords: number;
  tableCounts: Record<string, number>;
  linkedFileName: string | null;
  linkedType: 'directory' | 'file' | null;
  linkedPermission: 'granted' | 'prompt' | 'denied' | 'none';
  autoSync: boolean;
  storage: LaptopStorageEstimate;
}

function openLaptopDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is not supported in this browser.'));
      return;
    }
    const req = indexedDB.open(LAPTOP_DB_NAME, LAPTOP_DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(META_STORE)) {
        db.createObjectStore(META_STORE, { keyPath: 'key' });
      }
      if (!db.objectStoreNames.contains(FILE_HANDLE_STORE)) {
        db.createObjectStore(FILE_HANDLE_STORE, { keyPath: 'id' });
      }
      for (const spec of LAPTOP_TABLE_SPECS) {
        if (!db.objectStoreNames.contains(spec.name)) {
          db.createObjectStore(spec.name, { keyPath: spec.keyPath });
        }
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('Failed to open local laptop database'));
  });
}

function reqToPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('IndexedDB request failed'));
  });
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error('IndexedDB transaction failed'));
    tx.onabort = () => reject(tx.error || new Error('IndexedDB transaction aborted'));
  });
}

export function getAutoSyncEnabled(): boolean {
  try {
    return localStorage.getItem(AUTO_SYNC_KEY) !== '0';
  } catch {
    return true;
  }
}

function emitLaptopDbEvent(detail?: Record<string, any>) {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('sdgl:laptop-db-synced', { detail }));
  }
}

export function setAutoSyncEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(AUTO_SYNC_KEY, enabled ? '1' : '0');
  } catch {
    // ignore storage restriction
  }
  emitLaptopDbEvent({ autoSync: enabled });
}

export function getLaptopTargetPath(): string {
  try {
    return localStorage.getItem(TARGET_PATH_KEY) || DEFAULT_LAPTOP_DB_PATH;
  } catch {
    return DEFAULT_LAPTOP_DB_PATH;
  }
}

export function setLaptopTargetPath(nextPath: string): void {
  try {
    const clean = (nextPath || '').trim() || DEFAULT_LAPTOP_DB_PATH;
    localStorage.setItem(TARGET_PATH_KEY, clean);
  } catch {
    // ignore storage restriction
  }
}

export function getTargetDbFileName(targetPath?: string): string {
  const raw = (targetPath || getLaptopTargetPath()).trim();
  const parts = raw.split(/[\\/]/).filter(Boolean);
  const last = parts[parts.length - 1] || 'sdglobal.db';
  return last.toLowerCase().endsWith('.db') || last.toLowerCase().endsWith('.sqlite') ? last : `${last}.db`;
}

export function detectLaptopOs(): 'windows' | 'macos' | 'linux' {
  if (typeof navigator === 'undefined') return 'windows';
  const ua = (navigator.userAgent || '').toLowerCase();
  if (ua.includes('mac os') || ua.includes('macintosh')) return 'macos';
  if (ua.includes('linux') && !ua.includes('android')) return 'linux';
  return 'windows';
}

export function getLaptopPathsForOs() {
  const os = detectLaptopOs();
  const origin =
    typeof window !== 'undefined'
      ? `${window.location.protocol.replace(':', '')}_${window.location.host.replace(/:/g, '_')}_0.indexeddb.leveldb`
      : 'app_origin_0.indexeddb.leveldb';

  if (os === 'macos') {
    return {
      osLabel: 'macOS',
      indexedDbPath: `~/Library/Application Support/Google/Chrome/Default/IndexedDB/${origin}/`,
      downloadsPath: '~/Downloads/',
      recommendedFolder: '~/Documents/SDGlobal-IT-CRM-DB/',
    };
  }
  if (os === 'linux') {
    return {
      osLabel: 'Linux',
      indexedDbPath: `~/.config/google-chrome/Default/IndexedDB/${origin}/`,
      downloadsPath: '~/Downloads/',
      recommendedFolder: '~/Documents/SDGlobal-IT-CRM-DB/',
    };
  }
  return {
    osLabel: 'Windows',
    indexedDbPath: `C:\\Users\\<YourUsername>\\AppData\\Local\\Google\\Chrome\\User Data\\Default\\IndexedDB\\${origin}\\`,
    downloadsPath: 'C:\\Users\\<YourUsername>\\Downloads\\',
    recommendedFolder: 'C:\\Users\\<YourUsername>\\Documents\\SDGlobal-IT-CRM-DB\\',
  };
}

export async function getLaptopStorageEstimate(): Promise<LaptopStorageEstimate> {
  try {
    if (typeof navigator === 'undefined' || !navigator.storage?.estimate) {
      return { supported: false, usageBytes: 0, quotaBytes: 0, persisted: false };
    }
    const [est, persisted] = await Promise.all([
      navigator.storage.estimate(),
      navigator.storage.persisted ? navigator.storage.persisted() : Promise.resolve(false),
    ]);
    return {
      supported: true,
      usageBytes: Number(est.usage || 0),
      quotaBytes: Number(est.quota || 0),
      persisted: Boolean(persisted),
    };
  } catch {
    return { supported: false, usageBytes: 0, quotaBytes: 0, persisted: false };
  }
}

export async function requestPersistentLaptopStorage(): Promise<boolean> {
  try {
    if (typeof navigator !== 'undefined' && navigator.storage?.persist) {
      return await navigator.storage.persist();
    }
  } catch {
    // ignore
  }
  return false;
}

async function getSavedDiskHandle(): Promise<{
  type: 'directory' | 'file';
  handle: any;
  name: string;
} | null> {
  const db = await openLaptopDb();
  try {
    const tx = db.transaction(FILE_HANDLE_STORE, 'readonly');
    const dirRow = await reqToPromise(tx.objectStore(FILE_HANDLE_STORE).get('linked_db_dir'));
    if (dirRow?.handle) {
      return {
        type: 'directory',
        handle: dirRow.handle,
        name: dirRow.handle.name || 'SDGlobal-IT-CRM-DB',
      };
    }
    const fileRow = await reqToPromise(tx.objectStore(FILE_HANDLE_STORE).get('linked_db_file'));
    if (fileRow?.handle) {
      return {
        type: 'file',
        handle: fileRow.handle,
        name: fileRow.handle.name || 'sdglobal-it-crm-database.json',
      };
    }
    return null;
  } catch {
    return null;
  } finally {
    db.close();
  }
}

async function saveDiskHandleRecord(
  entry: { type: 'directory' | 'file'; handle: any } | null
): Promise<void> {
  const db = await openLaptopDb();
  try {
    const tx = db.transaction([FILE_HANDLE_STORE, META_STORE], 'readwrite');
    const fhStore = tx.objectStore(FILE_HANDLE_STORE);
    const metaStore = tx.objectStore(META_STORE);

    fhStore.delete('linked_db_dir');
    fhStore.delete('linked_db_file');

    if (entry) {
      const storeKey = entry.type === 'directory' ? 'linked_db_dir' : 'linked_db_file';
      fhStore.put({ id: storeKey, handle: entry.handle });
      metaStore.put({
        key: 'linkedFileName',
        value: entry.handle.name || (entry.type === 'directory' ? 'Selected Folder' : 'sdglobal-it-crm-database.json'),
      });
      metaStore.put({ key: 'linkedType', value: entry.type });
    } else {
      metaStore.delete('linkedFileName');
      metaStore.delete('linkedType');
    }
    await txDone(tx);
  } finally {
    db.close();
  }
}

async function ensureReadWritePermission(handle: any, interactive: boolean): Promise<boolean> {
  if (!handle) return false;
  if (typeof handle.queryPermission !== 'function') return true;
  let perm = await handle.queryPermission({ mode: 'readwrite' });
  if (perm === 'granted') return true;
  if (interactive && typeof handle.requestPermission === 'function') {
    perm = await handle.requestPermission({ mode: 'readwrite' });
    return perm === 'granted';
  }
  return false;
}

export async function writeToLinkedLaptopStorage(
  snapshot: LaptopSnapshotPayload,
  options?: { sqliteBlob?: Blob | null; interactive?: boolean }
): Promise<{
  wrote: boolean;
  fileName?: string;
  type?: 'directory' | 'file';
  reason?: string;
}> {
  const saved = await getSavedDiskHandle();
  if (!saved) return { wrote: false };

  try {
    const allowed = await ensureReadWritePermission(saved.handle, Boolean(options?.interactive));
    if (!allowed) {
      return {
        wrote: false,
        fileName: saved.name,
        type: saved.type,
        reason: 'Permission to write to the linked laptop folder/file was not granted.',
      };
    }

    const targetFileName = getTargetDbFileName();

    if (saved.type === 'directory') {
      const jsonFileHandle = await saved.handle.getFileHandle('sdglobal-it-crm-database.json', {
        create: true,
      });
      const jsonWritable = await jsonFileHandle.createWritable();
      await jsonWritable.write(JSON.stringify(snapshot, null, 2));
      await jsonWritable.close();

      if (options?.sqliteBlob) {
        const dbFileHandle = await saved.handle.getFileHandle(targetFileName, {
          create: true,
        });
        const dbWritable = await dbFileHandle.createWritable();
        await dbWritable.write(options.sqliteBlob);
        await dbWritable.close();
      }

      return { wrote: true, fileName: saved.name, type: 'directory' };
    }

    const writable = await saved.handle.createWritable();
    const isSqliteHandle =
      String(saved.name || '').toLowerCase().endsWith('.db') ||
      String(saved.name || '').toLowerCase().endsWith('.sqlite');

    if (isSqliteHandle && options?.sqliteBlob) {
      await writable.write(options.sqliteBlob);
    } else if (!isSqliteHandle) {
      await writable.write(JSON.stringify(snapshot, null, 2));
    } else {
      await writable.close();
      return {
        wrote: false,
        fileName: saved.name,
        type: 'file',
        reason: 'SQLite binary snapshot unavailable for this sync.',
      };
    }
    await writable.close();
    return { wrote: true, fileName: saved.name, type: 'file' };
  } catch (err: any) {
    return {
      wrote: false,
      fileName: saved.name,
      type: saved.type,
      reason: err?.message || 'Unable to write to linked laptop location.',
    };
  }
}

export async function linkLaptopFolderOrFile(
  snapshot: LaptopSnapshotPayload,
  sqliteBlob?: Blob | null,
  preferredMode: 'file' | 'directory' = 'file'
): Promise<{
  linked: boolean;
  type?: 'directory' | 'file';
  fileName?: string;
  blockedByFrame?: boolean;
  cancelled?: boolean;
  error?: string;
}> {
  const dirPicker = (window as any).showDirectoryPicker;
  const filePicker = (window as any).showSaveFilePicker;
  const targetFileName = getTargetDbFileName();

  if (preferredMode === 'file' && typeof filePicker === 'function') {
    try {
      const handle = await filePicker({
        suggestedName: targetFileName,
        types: [
          {
            description: 'SQLite Database File (.db)',
            accept: { 'application/x-sqlite3': ['.db', '.sqlite'] },
          },
        ],
      });
      const writable = await handle.createWritable();
      if (sqliteBlob) {
        await writable.write(sqliteBlob);
      } else {
        await writable.write(JSON.stringify(snapshot, null, 2));
      }
      await writable.close();
      await saveDiskHandleRecord({ type: 'file', handle });
      emitLaptopDbEvent({ linked: true, type: 'file', fileName: handle.name });
      return { linked: true, type: 'file', fileName: handle.name };
    } catch (err: any) {
      if (err?.name === 'AbortError') {
        return { linked: false, cancelled: true };
      }
      if (err?.name === 'SecurityError') {
        return {
          linked: false,
          blockedByFrame: true,
          error: `Embedded preview frames restrict direct access to ${getLaptopTargetPath()}. Open this app in a full browser tab to bind ${getLaptopTargetPath()}, or save ${targetFileName} to your laptop.`,
        };
      }
      return { linked: false, error: err?.message || 'Failed to bind local laptop database file.' };
    }
  }

  if (typeof dirPicker === 'function') {
    try {
      const dirHandle = await dirPicker({ mode: 'readwrite' });
      const jsonFileHandle = await dirHandle.getFileHandle('sdglobal-it-crm-database.json', {
        create: true,
      });
      const jsonWritable = await jsonFileHandle.createWritable();
      await jsonWritable.write(JSON.stringify(snapshot, null, 2));
      await jsonWritable.close();

      if (sqliteBlob) {
        const dbFileHandle = await dirHandle.getFileHandle(targetFileName, {
          create: true,
        });
        const dbWritable = await dbFileHandle.createWritable();
        await dbWritable.write(sqliteBlob);
        await dbWritable.close();
      }

      await saveDiskHandleRecord({ type: 'directory', handle: dirHandle });
      emitLaptopDbEvent({ linked: true, type: 'directory', fileName: dirHandle.name });
      return { linked: true, type: 'directory', fileName: dirHandle.name };
    } catch (err: any) {
      if (err?.name === 'AbortError') {
        return { linked: false, cancelled: true };
      }
      if (err?.name === 'SecurityError') {
        return {
          linked: false,
          blockedByFrame: true,
          error: `Embedded preview frames restrict folder picking. Open this app in a full browser tab to link ${getLaptopTargetPath()}, or save ${targetFileName} directly.`,
        };
      }
    }
  }

  return {
    linked: false,
    blockedByFrame: true,
    error: `Direct picker for ${getLaptopTargetPath()} is unavailable in this embedded frame; saving ${targetFileName} via download instead.`,
  };
}

export async function unlinkLaptopDiskFile(): Promise<void> {
  await saveDiskHandleRecord(null);
  emitLaptopDbEvent({ linked: false });
}

export async function saveSnapshotToLaptopDb(
  snapshot: LaptopSnapshotPayload,
  options?: { sqliteBlob?: Blob | null; interactive?: boolean }
): Promise<{
  totalRecords: number;
  tableCounts: Record<string, number>;
  persisted: boolean;
  linkedFileResult: { wrote: boolean; fileName?: string; type?: 'directory' | 'file'; reason?: string };
}> {
  const persisted = await requestPersistentLaptopStorage();
  const db = await openLaptopDb();

  const tableCounts: Record<string, number> = {};
  let totalRecords = 0;

  try {
    const storeNames = [META_STORE, ...LAPTOP_TABLE_SPECS.map((s) => s.name)];
    const tx = db.transaction(storeNames, 'readwrite');
    const metaStore = tx.objectStore(META_STORE);

    const existingCreated = await reqToPromise(metaStore.get('createdAt'));
    const createdAt = existingCreated?.value || new Date().toISOString();
    const lastSyncAt = new Date().toISOString();

    for (const spec of LAPTOP_TABLE_SPECS) {
      const store = tx.objectStore(spec.name);
      store.clear();
      const rows = Array.isArray(snapshot.tables?.[spec.name]) ? snapshot.tables[spec.name] : [];
      let count = 0;
      for (const row of rows) {
        if (row && row[spec.keyPath] !== undefined && row[spec.keyPath] !== null) {
          store.put(row);
          count += 1;
        }
      }
      tableCounts[spec.name] = count;
      totalRecords += count;
    }

    metaStore.put({ key: 'initialized', value: true });
    metaStore.put({ key: 'createdAt', value: createdAt });
    metaStore.put({ key: 'lastSyncAt', value: lastSyncAt });
    metaStore.put({ key: 'serverDbBytes', value: Number(snapshot.serverDbBytes || 0) });
    metaStore.put({ key: 'tableCounts', value: tableCounts });

    await txDone(tx);
  } finally {
    db.close();
  }

  const linkedFileResult = await writeToLinkedLaptopStorage(snapshot, options);
  emitLaptopDbEvent({ totalRecords, linkedFileResult, syncedAt: new Date().toISOString() });
  return { totalRecords, tableCounts, persisted, linkedFileResult };
}

export async function getLaptopDbStatus(): Promise<LaptopDbStatus> {
  const storage = await getLaptopStorageEstimate();
  const autoSync = getAutoSyncEnabled();
  const savedHandle = await getSavedDiskHandle();
  let linkedPermission: 'granted' | 'prompt' | 'denied' | 'none' = 'none';
  if (savedHandle?.handle) {
    try {
      if (typeof savedHandle.handle.queryPermission === 'function') {
        const perm = await savedHandle.handle.queryPermission({ mode: 'readwrite' });
        linkedPermission = perm === 'granted' || perm === 'denied' ? perm : 'prompt';
      } else {
        linkedPermission = 'granted';
      }
    } catch {
      linkedPermission = 'prompt';
    }
  }

  const db = await openLaptopDb();

  try {
    const tx = db.transaction([META_STORE, ...LAPTOP_TABLE_SPECS.map((s) => s.name)], 'readonly');
    const metaStore = tx.objectStore(META_STORE);

    const [initializedRow, createdRow, syncRow, bytesRow, linkedNameRow, linkedTypeRow] = await Promise.all([
      reqToPromise(metaStore.get('initialized')),
      reqToPromise(metaStore.get('createdAt')),
      reqToPromise(metaStore.get('lastSyncAt')),
      reqToPromise(metaStore.get('serverDbBytes')),
      reqToPromise(metaStore.get('linkedFileName')),
      reqToPromise(metaStore.get('linkedType')),
    ]);

    const countPromises = LAPTOP_TABLE_SPECS.map(async (spec) => {
      const count = await reqToPromise(tx.objectStore(spec.name).count());
      return [spec.name, count] as const;
    });
    const pairs = await Promise.all(countPromises);
    const tableCounts: Record<string, number> = {};
    let totalRecords = 0;
    for (const [name, count] of pairs) {
      tableCounts[name] = count;
      totalRecords += count;
    }

    return {
      initialized: Boolean(initializedRow?.value),
      dbName: LAPTOP_DB_NAME,
      createdAt: createdRow?.value || null,
      lastSyncAt: syncRow?.value || null,
      serverDbBytes: Number(bytesRow?.value || 0),
      totalRecords,
      tableCounts,
      linkedFileName: linkedNameRow?.value || savedHandle?.name || null,
      linkedType: linkedTypeRow?.value || savedHandle?.type || null,
      linkedPermission,
      autoSync,
      storage,
    };
  } finally {
    db.close();
  }
}

export async function readLaptopDbTable(tableName: string, limit = 100): Promise<any[]> {
  const spec = LAPTOP_TABLE_SPECS.find((s) => s.name === tableName);
  if (!spec) return [];

  const db = await openLaptopDb();
  try {
    const tx = db.transaction(spec.name, 'readonly');
    const allRows = await reqToPromise(tx.objectStore(spec.name).getAll());
    if (!Array.isArray(allRows)) return [];
    return allRows.slice(0, limit);
  } finally {
    db.close();
  }
}

export async function exportLaptopDbSnapshot(): Promise<LaptopSnapshotPayload> {
  const db = await openLaptopDb();
  try {
    const storeNames = LAPTOP_TABLE_SPECS.map((s) => s.name);
    const tx = db.transaction(storeNames, 'readonly');
    const tables: Record<string, any[]> = {};
    const tableCounts: Record<string, number> = {};

    await Promise.all(
      LAPTOP_TABLE_SPECS.map(async (spec) => {
        const rows = await reqToPromise(tx.objectStore(spec.name).getAll());
        tables[spec.name] = Array.isArray(rows) ? rows : [];
        tableCounts[spec.name] = tables[spec.name].length;
      })
    );

    return {
      system: 'SD Global IT CRM',
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      tableCounts,
      tables,
    };
  } finally {
    db.close();
  }
}

export async function clearLaptopDb(): Promise<void> {
  const db = await openLaptopDb();
  try {
    const storeNames = [META_STORE, FILE_HANDLE_STORE, ...LAPTOP_TABLE_SPECS.map((s) => s.name)];
    const tx = db.transaction(storeNames, 'readwrite');
    for (const name of storeNames) {
      tx.objectStore(name).clear();
    }
    await txDone(tx);
  } finally {
    db.close();
  }
  emitLaptopDbEvent({ cleared: true });
}
