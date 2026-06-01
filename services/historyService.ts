/**
 * History service.
 *
 * Cloud-first: when the /api/history endpoint is reachable AND Postgres is
 * configured (i.e. the API doesn't return 503 fallback), records are stored
 * server-side and synced across devices.
 *
 * Fallback: if the cloud is unavailable, we transparently use IndexedDB and
 * a localStorage backup (great for iOS reliability) — same approach the
 * original app used.
 *
 * The exported function signatures are unchanged so the rest of the app
 * works as-is.
 */
import {
  HistoryRecord,
  BulkArticle,
  ReferenceImage,
  CharacterImage,
  AspectRatio,
  CharacterOption,
  ImageStyle,
} from '../types';

const DB_NAME = 'VinalinkAIWriterDB';
const DB_VERSION = 2;
const STORE_NAME = 'history';
const LOCAL_BACKUP_KEY = 'vinalink_latest_backup';
const OWNER_KEY = 'vinalink_owner_id';

const API_BASE =
  (typeof window !== 'undefined' && (window as any).__API_BASE__) || '';

// =================== OWNER ID (anonymous browser id) ===================

const getOwnerId = (): string => {
  try {
    let id = localStorage.getItem(OWNER_KEY);
    if (!id) {
      id =
        'usr_' +
        Date.now().toString(36) +
        '_' +
        Math.random().toString(36).slice(2, 10);
      localStorage.setItem(OWNER_KEY, id);
    }
    return id;
  } catch {
    return 'usr_anonymous';
  }
};

// =================== CLOUD STATE (sticky) ===================

let cloudAvailable: boolean | null = null;

const probeCloudOnce = async (): Promise<boolean> => {
  if (cloudAvailable !== null) return cloudAvailable;
  try {
    const res = await fetch(
      `${API_BASE}/api/history?ownerId=${encodeURIComponent(getOwnerId())}`,
      { method: 'GET' }
    );
    if (res.status === 503) {
      cloudAvailable = false;
      return false;
    }
    if (res.ok) {
      cloudAvailable = true;
      return true;
    }
    cloudAvailable = false;
    return false;
  } catch {
    cloudAvailable = false;
    return false;
  }
};

// =================== INDEXEDDB FALLBACK ===================

const openDB = (): Promise<IDBDatabase | null> => {
  return new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') return resolve(null);
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME))
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
    };
    request.onsuccess = (event) => resolve((event.target as IDBOpenDBRequest).result);
    request.onerror = () => resolve(null);
  });
};

const getLocalBackup = (): HistoryRecord | null => {
  try {
    const raw = localStorage.getItem(LOCAL_BACKUP_KEY);
    return raw ? (JSON.parse(raw) as HistoryRecord) : null;
  } catch {
    return null;
  }
};

const writeLocalBackup = (record: HistoryRecord) => {
  try {
    const backup: HistoryRecord = { ...record };
    if (backup.mode === 'bulk' && backup.bulkContent) {
      backup.bulkContent = backup.bulkContent.map((b) => ({ ...b, imageUrl: null }));
    }
    if (backup.referenceImages) backup.referenceImages = [];
    if (backup.characterImages) backup.characterImages = [];
    localStorage.setItem(LOCAL_BACKUP_KEY, JSON.stringify(backup));
  } catch {
    /* quota exceeded — ignore */
  }
};

const idbGetAll = async (): Promise<HistoryRecord[]> => {
  const db = await openDB();
  if (!db) {
    const backup = getLocalBackup();
    return backup ? [backup] : [];
  }
  return new Promise((resolve) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).getAll();
    req.onsuccess = () => {
      const records = (req.result as HistoryRecord[]) || [];
      if (records.length > 0) {
        records.sort((a, b) => Number(b.timestamp) - Number(a.timestamp));
        resolve(records);
      } else {
        const backup = getLocalBackup();
        resolve(backup ? [backup] : []);
      }
    };
    req.onerror = () => {
      const backup = getLocalBackup();
      resolve(backup ? [backup] : []);
    };
  });
};

const idbGet = async (id: string): Promise<HistoryRecord | undefined> => {
  const backup = getLocalBackup();
  if (backup && backup.id === id) return backup;
  const db = await openDB();
  if (!db) return backup || undefined;
  return new Promise((resolve) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).get(id);
    req.onsuccess = () => resolve((req.result as HistoryRecord) ?? backup ?? undefined);
    req.onerror = () => resolve(backup || undefined);
  });
};

const idbPut = async (record: HistoryRecord): Promise<void> => {
  writeLocalBackup(record);
  const db = await openDB();
  if (!db) return;
  return new Promise((resolve) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(record);
    tx.oncomplete = () => {
      cleanupOldRecords().catch(() => undefined);
      resolve();
    };
    tx.onerror = () => resolve();
  });
};

const idbDelete = async (id: string): Promise<void> => {
  const backup = getLocalBackup();
  if (backup && backup.id === id) localStorage.removeItem(LOCAL_BACKUP_KEY);
  const db = await openDB();
  if (!db) return;
  return new Promise((resolve) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
  });
};

const idbClear = async (): Promise<void> => {
  localStorage.removeItem(LOCAL_BACKUP_KEY);
  const db = await openDB();
  if (!db) return;
  return new Promise((resolve) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
  });
};

const cleanupOldRecords = async () => {
  const db = await openDB();
  if (!db) return;
  const tx = db.transaction(STORE_NAME, 'readwrite');
  const st = tx.objectStore(STORE_NAME);
  const keyReq = st.getAllKeys();
  keyReq.onsuccess = () => {
    const keys = keyReq.result as string[];
    const LIMIT = 20;
    if (keys.length > LIMIT) {
      keys.sort((a, b) => Number(a) - Number(b));
      keys.slice(0, keys.length - LIMIT).forEach((k) => st.delete(k));
    }
  };
};

// =================== PUBLIC API ===================

export const getHistory = async (): Promise<HistoryRecord[]> => {
  const cloud = await probeCloudOnce();
  if (cloud) {
    try {
      const res = await fetch(
        `${API_BASE}/api/history?ownerId=${encodeURIComponent(getOwnerId())}`
      );
      const json = await res.json();
      if (json?.ok && Array.isArray(json.data)) return json.data as HistoryRecord[];
    } catch {
      cloudAvailable = false;
    }
  }
  return idbGetAll();
};

export const getHistoryById = async (id: string): Promise<HistoryRecord | undefined> => {
  // Try cloud first
  if (await probeCloudOnce()) {
    try {
      const res = await fetch(
        `${API_BASE}/api/history?ownerId=${encodeURIComponent(getOwnerId())}&id=${encodeURIComponent(id)}`
      );
      const json = await res.json();
      if (json?.ok && json.data) return json.data as HistoryRecord;
    } catch {
      cloudAvailable = false;
    }
  }
  return idbGet(id);
};

interface ImageContext {
  referenceImages?: ReferenceImage[];
  characterImages?: CharacterImage[];
  aspectRatio?: AspectRatio;
  characterOption?: CharacterOption;
  imageStyle?: ImageStyle;
}

export const saveHistory = async (
  mode: 'single' | 'bulk',
  data: string | BulkArticle[],
  forcedId?: string,
  context?: ImageContext
): Promise<string> => {
  const timestamp = Date.now();
  const id = forcedId || timestamp.toString();

  let title = '';
  let newRecord: HistoryRecord;

  if (mode === 'single') {
    const content = data as string;
    const firstLine = content.split('\n')[0].replace(/[#*]/g, '').trim();
    title = firstLine || 'Bài viết không tiêu đề';
    newRecord = { id, timestamp, mode, title, singleContent: content, ...context };
  } else {
    const content = data as BulkArticle[];
    const successCount = content.filter((c) => !c.error).length;
    const firstTitle = content[0]?.title || 'Loạt bài viết';
    title = `Loạt ${content.length} bài (${successCount} thành công) - ${firstTitle.substring(0, 30)}...`;
    newRecord = { id, timestamp, mode, title, bulkContent: content, ...context };
  }

  // Always write local backup synchronously for iOS reliability.
  writeLocalBackup(newRecord);

  if (await probeCloudOnce()) {
    try {
      const res = await fetch(`${API_BASE}/api/history`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ownerId: getOwnerId(), record: newRecord }),
      });
      if (res.ok) {
        // Also keep IDB in sync as offline cache.
        idbPut(newRecord).catch(() => undefined);
        return id;
      }
      cloudAvailable = false;
    } catch {
      cloudAvailable = false;
    }
  }

  await idbPut(newRecord);
  return id;
};

export const deleteHistoryItem = async (id: string): Promise<void> => {
  if (await probeCloudOnce()) {
    try {
      await fetch(
        `${API_BASE}/api/history?ownerId=${encodeURIComponent(getOwnerId())}&id=${encodeURIComponent(id)}`,
        { method: 'DELETE' }
      );
    } catch {
      cloudAvailable = false;
    }
  }
  await idbDelete(id);
};

export const clearHistory = async (): Promise<void> => {
  if (await probeCloudOnce()) {
    try {
      await fetch(
        `${API_BASE}/api/history?ownerId=${encodeURIComponent(getOwnerId())}`,
        { method: 'DELETE' }
      );
    } catch {
      cloudAvailable = false;
    }
  }
  await idbClear();
};
