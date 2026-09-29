// Files cannot go in localStorage; IndexedDB keeps the per-chat staged bytes on reload.
const database = () => new Promise<IDBDatabase>((resolve, reject) => {
  const request = indexedDB.open("hermes-mobile-composer", 1);
  request.onupgradeneeded = () => request.result.createObjectStore("attachments");
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});

export async function loadComposerAttachments(key: string): Promise<{ photos: File[]; files: File[] }> {
  if (typeof indexedDB === "undefined") return { photos: [], files: [] };
  const db = await database();
  try {
    return await new Promise((resolve, reject) => {
      const request = db.transaction("attachments", "readonly").objectStore("attachments").get(key);
      request.onsuccess = () => resolve(request.result || { photos: [], files: [] });
      request.onerror = () => reject(request.error);
    });
  } finally { db.close(); }
}

export async function saveComposerAttachments(key: string, photos: File[], files: File[]) {
  if (typeof indexedDB === "undefined") return;
  const db = await database();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction("attachments", "readwrite");
      if (photos.length || files.length) transaction.objectStore("attachments").put({ photos, files }, key);
      else transaction.objectStore("attachments").delete(key);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  } finally { db.close(); }
}
