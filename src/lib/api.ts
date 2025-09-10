import type { Checklist, ImageRole } from '../types';

const BASE = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/+$/,'');

async function j<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json() as Promise<T>;
}

export async function seedRequiredPhotos(vin: string, lotId: string, roles: ImageRole[]) {
  return j(`${BASE}/intake/seed`, {
    method: 'POST',
    headers: { 'Content-Type':'application/json' },
    body: JSON.stringify({ vin, lot_id: lotId, required_photos: roles })
  });
}

export async function getChecklist(vin: string) {
  return j<Checklist>(`${BASE}/intake/checklist/${encodeURIComponent(vin)}`);
}

export async function uploadPhotoDev(vin: string, role: ImageRole, file: File, onProgress?: (p: number)=>void) {
  const form = new FormData();
  form.append('vin', vin);
  form.append('role', role);
  form.append('file', file);

  return j(`${BASE}/intake/photos/upload`, { method: 'POST', body: form });
}
