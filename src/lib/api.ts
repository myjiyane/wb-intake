import type { Checklist, ImageRole } from '../types';

const BASE = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/+$/, ''); // e.g. http://192.168.0.23:3000/api/v1
const API_KEY = import.meta.env.VITE_API_KEY as string | undefined; // optional

async function j<T>(url: string, init?: RequestInit): Promise<T> {
  const headers: Record<string, string> = { ...(init?.headers as any) };
  if (API_KEY) headers['X-Api-Key'] = API_KEY;
  const res = await fetch(url, { ...init, headers });
  if (!res.ok) {
    const ct = res.headers.get('content-type') || '';
    let msg = `${res.status} ${res.statusText}`;
    try {
      const body = ct.includes('application/json') ? await res.json() : await res.text();
      if (typeof body === 'object' && body && 'error' in body) {
        const r = body as any;
        msg = `${res.status} ${r.error}${r.reasons ? ': ' + r.reasons.join(',') : ''}`;
      } else if (typeof body === 'string' && body) {
        msg = body;
      }
    } catch {}
    throw new Error(msg);
  }
  return res.json() as Promise<T>;
}

export function serverOrigin() {
  // Turn BASE (which ends with /api/v1) into just protocol+host for prefixing /uploads/*
  try {
    const u = new URL(BASE, window.location.href);
    return `${u.protocol}//${u.host}`;
  } catch {
    return '';
  }
}

export async function getChecklist(vin: string) {
  return j<Checklist>(`${BASE}/intake/checklist/${encodeURIComponent(vin)}`);
}

export async function seedRequiredPhotos(vin: string, lotId: string, roles: ImageRole[]) {
  return j(`${BASE}/intake/seed`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ vin, lot_id: lotId, required_photos: roles })
  });
}

export async function uploadPhotoDev(vin: string, role: ImageRole, file: File, _onProgress?: (p: number)=>void) {
  const form = new FormData();
  form.append('vin', vin);
  form.append('role', role);
  form.append('file', file);
  return j(`${BASE}/intake/photos/upload`, { method: 'POST', body: form });
}

export async function getPassport(vin: string) {
  // returns the full record (draft+sealed) – shape used loosely in the UI
  return j(`${BASE}/passports/${encodeURIComponent(vin)}`);
}

export async function sealStrict(vin: string, opts?: { force?: boolean }) {
  const url = `${BASE}/passports/seal/strict${opts?.force ? '?force=1' : ''}`;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (API_KEY) headers['X-Api-Key'] = API_KEY;
  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({ vin }),
  });
  if (!res.ok) {
    const ct = res.headers.get('content-type') || '';
    let msg = `${res.status} ${res.statusText}`;
    try {
      const body = ct.includes('application/json') ? await res.json() : await res.text();
      if (typeof body === 'object' && body && 'error' in body) {
        const r = body as any;
        msg = `${res.status} ${r.error}${r.reasons ? ': ' + r.reasons.join(',') : ''}`;
      } else if (typeof body === 'string' && body) {
        msg = body;
      }
    } catch {}
    throw new Error(msg);
  }
  return res.json();
}
