// Minimal promise wrapper around a single IndexedDB database used by the whole OS.
const DB_NAME = 'wphone';
const DB_VERSION = 1;
let dbp;

export function openDB() {
  return (dbp ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
      if (!db.objectStoreNames.contains('files')) {
        const s = db.createObjectStore('files', { keyPath: 'path' });
        s.createIndex('parent', 'parent');
      }
      if (!db.objectStoreNames.contains('blobs')) db.createObjectStore('blobs');
      if (!db.objectStoreNames.contains('thumbs')) db.createObjectStore('thumbs');
    };
    req.onsuccess = () => {
      const db = req.result;
      // Another tab (or "reset phone") wants to delete/upgrade the database: let go so it isn't blocked forever.
      db.onversionchange = () => { db.close(); dbp = null; setTimeout(() => location.reload(), 100); };
      resolve(db);
    };
    req.onerror = () => reject(req.error);
    req.onblocked = () => console.warn('IndexedDB upgrade blocked');
  }));
}

const wrap = (req) => new Promise((res, rej) => { req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error); });

export async function tx(stores, mode, fn) {
  const db = await openDB();
  const t = db.transaction(stores, mode);
  const done = new Promise((res, rej) => { t.oncomplete = res; t.onerror = () => rej(t.error); t.onabort = () => rej(t.error); });
  const s = Array.isArray(stores) ? stores.map((n) => t.objectStore(n)) : [t.objectStore(stores)];
  const result = await fn(...s);
  await done;
  return result;
}

export const idb = {
  get: (store, key) => tx(store, 'readonly', (s) => wrap(s.get(key))),
  set: (store, key, val) => tx(store, 'readwrite', (s) => wrap(key === undefined ? s.put(val) : s.put(val, key))),
  del: (store, key) => tx(store, 'readwrite', (s) => wrap(s.delete(key))),
  all: (store, query) => tx(store, 'readonly', (s) => wrap(s.getAll(query))),
  keys: (store, query) => tx(store, 'readonly', (s) => wrap(s.getAllKeys(query))),
  byIndex: (store, index, value) => tx(store, 'readonly', (s) => wrap(s.index(index).getAll(value))),
  clear: (store) => tx(store, 'readwrite', (s) => wrap(s.clear())),
  wrap,
};

export async function wipeDatabase() {
  const db = await openDB();
  db.close();
  dbp = null;
  await wrap(indexedDB.deleteDatabase(DB_NAME));
}
