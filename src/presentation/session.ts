import { useEffect, useState } from 'react';
import type { CameraPose } from '../animation/director';
export interface Bookmark {
  id: string;
  name: string;
  pose: CameraPose;
}
export function validateBookmarks(value: unknown): Bookmark[] {
  if (!Array.isArray(value) || value.length > 12) throw Error('카메라 북마크 형식을 확인하세요.');
  for (const x of value) {
    if (
      typeof x.id !== 'string' ||
      typeof x.name !== 'string' ||
      !x.pose ||
      ![x.pose.position, x.pose.target].every(
        (p: unknown) => Array.isArray(p) && p.length === 3 && p.every(Number.isFinite),
      ) ||
      (x.pose.fov !== undefined &&
        (!Number.isFinite(x.pose.fov) || x.pose.fov < 10 || x.pose.fov > 100))
    )
      throw Error('카메라 좌표가 올바르지 않습니다.');
  }
  return value as Bookmark[];
}
export function useOffline() {
  const [status, setStatus] = useState<'dev' | 'preparing' | 'ready' | 'unsupported'>(
    import.meta.env.DEV ? 'dev' : 'preparing',
  );
  useEffect(() => {
    if (import.meta.env.DEV) return;
    if (!('serviceWorker' in navigator)) {
      setStatus('unsupported');
      return;
    }
    let mounted = true;
    navigator.serviceWorker
      .register(`${import.meta.env.BASE_URL}sw.js`, { scope: import.meta.env.BASE_URL })
      .then(() => navigator.serviceWorker.ready)
      .then(() => {
        if (mounted) setStatus('ready');
      })
      .catch(() => {
        if (mounted) setStatus('unsupported');
      });
    return () => {
      mounted = false;
    };
  }, []);
  return status;
}
function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('chladni-local-research', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('sessions');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
export async function storeLocalSession(blob: Blob) {
  const db = await database();
  try {
    await new Promise<void>((resolve, reject) => {
      const t = db.transaction('sessions', 'readwrite');
      t.objectStore('sessions').put(blob, 'presentation');
      t.oncomplete = () => resolve();
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    });
  } finally {
    db.close();
  }
}
export async function readLocalSession(): Promise<Blob | null> {
  const db = await database();
  try {
    return await new Promise((resolve, reject) => {
      const request = db.transaction('sessions').objectStore('sessions').get('presentation');
      request.onsuccess = () => resolve(request.result ?? null);
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}
