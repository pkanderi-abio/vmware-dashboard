import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

const IPV4_RE = /^\d{1,3}(\.\d{1,3}){3}(:\d+)?$/;

/**
 * Trim the DNS suffix off a fully-qualified name so tables read cleanly:
 *   "esx01.corp.example.com" → "esx01"
 * IPv4 / IPv6 strings are returned unchanged — dot-splitting them turns
 * "192.168.1.100" into "192", which is what the old inline pattern did.
 */
export function shortHost(name?: string | null): string {
  if (!name) return "";
  const s = String(name);
  if (IPV4_RE.test(s)) return s;
  if (s.includes(":")) return s;              // IPv6
  return s.split(".")[0] || s;
}
