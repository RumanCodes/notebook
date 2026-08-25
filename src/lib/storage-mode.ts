import type { StorageMode } from '../types';

const STORAGE_MODE_KEY = 'notebook_storage_mode';

export function getStorageMode(): StorageMode | null {
  if (typeof window === 'undefined') return null;
  try {
    const value = window.localStorage.getItem(STORAGE_MODE_KEY);
    return value === 'local' || value === 'cloud' ? value : null;
  } catch {
    return null;
  }
}

export function setStorageMode(mode: StorageMode): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_MODE_KEY, mode);
  } catch {
    // The mode is a convenience preference. IndexedDB remains authoritative.
  }
}

export function clearStorageMode(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(STORAGE_MODE_KEY);
  } catch {
    // Ignore storage restrictions; the next boot can show the chooser again.
  }
}
