/**
 * VMware Dashboard - API Configuration
 *
 * Central configuration for API endpoints.
 * The backend origin can be overridden at runtime via localStorage,
 * allowing the user to change the API base URL from the Settings page
 * without touching environment files.
 */

const LS_ORIGIN_KEY = 'vm-api-origin';

/**
 * Returns the stored API origin (e.g. "http://your-api-host:8000").
 * Returns "" when using the default Vite proxy (relative /api paths).
 */
export function getApiOrigin(): string {
  try {
    return localStorage.getItem(LS_ORIGIN_KEY) || '';
  } catch {
    return '';
  }
}

/**
 * Persists a custom API origin. Pass "" to reset to the Vite proxy mode.
 * The page should be reloaded after calling this so all in-flight hooks
 * pick up the new base URL.
 */
export function setApiOrigin(url: string): void {
  try {
    const cleaned = url.trim().replace(/\/+$/, '');
    if (cleaned) {
      localStorage.setItem(LS_ORIGIN_KEY, cleaned);
    } else {
      localStorage.removeItem(LS_ORIGIN_KEY);
    }
  } catch {}
}

/**
 * Returns the full API base prefix, e.g. "/api" (proxy mode)
 * or "http://your-api-host:8000/api" (direct mode).
 * Call this at fetch time so the value is always current.
 */
export function getApiBase(): string {
  return `${getApiOrigin()}/api`;
}

// ── Legacy export kept so existing imports compile without changes ──────────
export const API_BASE = '';

// Helper function to build API URLs
export function apiUrl(path: string): string {
  const cleanPath = path.startsWith('/') ? path : '/' + path;
  return `${getApiBase()}${cleanPath}`;
}
