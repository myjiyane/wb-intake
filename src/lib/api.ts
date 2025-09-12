import type { Checklist, ImageRole } from '../types';

const BASE = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/+$/, '');
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


export async function initDraft(vin: string, lotId: string, roles?: ImageRole[]) {
  const BASE = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/+$/,'');
  const headers: Record<string,string> = { 'Content-Type': 'application/json' };
  const body = {
    vin,
    lot_id: lotId,
    ...(roles?.length ? { required_photos: roles } : {})
  };
  const res = await fetch(`${BASE}/intake/init`, { method: 'POST', headers, body: JSON.stringify(body) });
  if (!res.ok) {
    const txt = await res.text().catch(()=>'');
    throw new Error(`${res.status} ${txt || res.statusText}`);
  }
  return res.json();
}


export async function setDekraUrl(vin: string, dekraUrl: string) {
  if (!/^https:\/\//i.test(dekraUrl)) throw new Error('Please enter a valid https:// DEKRA link');
  return j(`${BASE}/intake/init`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ vin, dekra_url: dekraUrl }),
  });
}

export async function setOdometer(vin: string, km: number) {
  if (!Number.isFinite(km) || km < 0) throw new Error('Enter a valid odometer (km)');
  return j(`${BASE}/intake/init`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ vin, odometer_km: Math.floor(km), odometer_source: 'manual' }),
  });
}



