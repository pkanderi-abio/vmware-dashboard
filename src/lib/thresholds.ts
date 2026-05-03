const STORAGE_KEY = 'vm-dashboard-thresholds';

export interface Thresholds {
  cpuWarning: number;
  cpuCritical: number;
  memWarning: number;
  memCritical: number;
  storageWarning: number;
  storageCritical: number;
  snapshotOldDays: number;
  snapshotVeryOldDays: number;
}

export const DEFAULT_THRESHOLDS: Thresholds = {
  cpuWarning: 80,
  cpuCritical: 90,
  memWarning: 80,
  memCritical: 90,
  storageWarning: 85,
  storageCritical: 95,
  snapshotOldDays: 7,
  snapshotVeryOldDays: 30,
};

export function getThresholds(): Thresholds {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) return { ...DEFAULT_THRESHOLDS, ...JSON.parse(stored) };
  } catch { /* ignore */ }
  return { ...DEFAULT_THRESHOLDS };
}

export function saveThresholds(t: Thresholds): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(t));
}
