// src/lib/api.ts
import type { Checklist, ImageRole } from '../types';

const BASE = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/+$/, '');
const API_KEY = import.meta.env.VITE_API_KEY as string | undefined;

// Enhanced OCR result type matching your backend response
export interface OcrResult {
  ok: boolean;
  vin: string | null;
  vinValid: boolean;
  candidates: string[];
  confidence: number;
  processingTime: number;
  textExtracted: boolean;
  totalBlocks: number;
  lineCount: number;
  fromCache: boolean;
}


export interface ocrOdoResult {
  ok: boolean;
  km: number | null;
  unit: 'km' | null;
  candidates: { value: number; score: number }[];
  confidence: number;
  processingTime: number;
  textExtracted: boolean;
  totalBlocks: number;
  lineCount: number;
  fromCache: boolean;
}

// OCR error types for better error handling
export interface OcrError {
  error: string;
  message: string;
  processingTime?: number;
  details?: string;
}

// Image compression options for mobile optimization
export interface ImageCompressionOptions {
  maxWidth?: number;
  maxHeight?: number;
  quality?: number;
  format?: 'jpeg' | 'webp';
}

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
  try {
    const u = new URL(BASE, window.location.href);
    return `${u.protocol}//${u.host}`;
  } catch {
    return '';
  }
}

// Image compression utility for mobile photos
export async function compressImage(
  file: File, 
  options: ImageCompressionOptions = {}
): Promise<File> {
  const {
    maxWidth = 1920,
    maxHeight = 1080,
    quality = 0.85,
    format = 'jpeg'
  } = options;

  return new Promise((resolve) => {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d')!;
    const img = new Image();

    img.onload = () => {
      // Calculate new dimensions maintaining aspect ratio
      let { width, height } = img;
      const aspectRatio = width / height;

      if (width > maxWidth) {
        width = maxWidth;
        height = width / aspectRatio;
      }
      if (height > maxHeight) {
        height = maxHeight;
        width = height * aspectRatio;
      }

      canvas.width = width;
      canvas.height = height;

      // Draw and compress
      ctx.drawImage(img, 0, 0, width, height);
      
      canvas.toBlob((blob) => {
        if (blob) {
          const compressedFile = new File([blob], file.name, {
            type: `image/${format}`,
            lastModified: Date.now()
          });
          resolve(compressedFile);
        } else {
          resolve(file); // Fallback to original
        }
      }, `image/${format}`, quality);
    };

    img.onerror = () => resolve(file); // Fallback to original
    img.src = URL.createObjectURL(file);
  });
}


export function validateImageFile(file: File): { valid: boolean; error?: string } {
  if (!file) {
    return { valid: false, error: 'No file selected' }
  }

  if (file.size === 0) {
    return { valid: false, error: 'File is empty. Please try taking the photo again.' }
  }

  if (file.size > 15 * 1024 * 1024) {
    return { valid: false, error: 'Photo is too large (max 15MB). Please try again.' }
  }

  if (!file.type.startsWith('image/')) {
    return { valid: false, error: 'Invalid file type. Only images are allowed.' }
  }

  // Check for common PWA camera issues
  if (file.type === 'image/jpeg' && file.size < 1000) {
    return { valid: false, error: 'Photo seems corrupted. Please try taking it again.' }
  }

  return { valid: true }
}


// Enhanced OCR function with better error handling and progress
export async function ocrOdoFromImage(
  file: File,
  options: {
    compress?: boolean;
    compressionOptions?: ImageCompressionOptions;
    onProgress?: (stage: 'validating' | 'compressing' | 'uploading' | 'processing') => void;
  } = {}
): Promise<ocrOdoResult> {
  const { compress = true, compressionOptions, onProgress } = options;

  try {
    onProgress?.('validating');

    // Validate the image file
    const validation = validateImageFile(file);
    if (!validation.valid) {
      throw new Error(validation.error);
    }

    let processedFile = file;

    // Compress image for better upload/processing
    if (compress) {
      onProgress?.('compressing');
      processedFile = await compressImage(file, compressionOptions);
      console.log(`Image compressed: ${file.size} → ${processedFile.size} bytes`);
    }

    onProgress?.('uploading');

    const form = new FormData();
    form.append("file", processedFile);
    const url = `${BASE}/ocr/odometer`;
    const headers: Record<string, string> = {};
    if (API_KEY) headers["X-Api-Key"] = API_KEY;

    const startTime = Date.now();
    const res = await fetch(url, { 
      method: "POST", 
      headers, 
      body: form 
    });

    if (!res.ok) {
      let errorMessage = `OCR failed (${res.status})`;
      
      try {
        const errorBody = await res.json() as OcrError;
        
        // Provide user-friendly error messages
        switch (errorBody.error) {
          case 'aws_not_configured':
            errorMessage = 'OCR service is not configured. Please contact support.';
            break;
          case 'invalid_image':
            errorMessage = 'Invalid image format or corrupted file. Please try a different photo.';
            break;
          case 'file_too_large':
            errorMessage = errorBody.message || 'Image file is too large. Please use a smaller image.';
            break;
          case 'rate_limit_exceeded':
            errorMessage = 'Too many requests. Please wait a moment and try again.';
            break;
          case 'textract_failed':
            errorMessage = 'OCR processing failed. Please try again with a clearer photo.';
            break;
          default:
            errorMessage = errorBody.message || errorMessage;
        }
      } catch {
        // Fallback to status text if JSON parsing fails
        errorMessage = await res.text().catch(() => `${res.status} ${res.statusText}`);
      }

      throw new Error(errorMessage);
    }

    onProgress?.('processing');

    const result = await res.json() as ocrOdoResult;

    return result;

  } catch (error) {
    console.error('OCR Error:', error);
    throw error;
  }
}

// Enhanced OCR function with better error handling and progress
export async function ocrVinFromImage(
  file: File,
  options: {
    compress?: boolean;
    compressionOptions?: ImageCompressionOptions;
    onProgress?: (stage: 'validating' | 'compressing' | 'uploading' | 'processing') => void;
  } = {}
): Promise<OcrResult> {
  const { compress = true, compressionOptions, onProgress } = options;

  try {
    onProgress?.('validating');

    // Validate the image file
    const validation = validateImageFile(file);
    if (!validation.valid) {
      throw new Error(validation.error);
    }

    let processedFile = file;

    // Compress image for better upload/processing
    if (compress) {
      onProgress?.('compressing');
      processedFile = await compressImage(file, compressionOptions);
      console.log(`Image compressed: ${file.size} → ${processedFile.size} bytes`);
    }

    onProgress?.('uploading');

    const form = new FormData();
    form.append("file", processedFile);
    const url = `${BASE}/ocr/vin`;
    const headers: Record<string, string> = {};
    if (API_KEY) headers["X-Api-Key"] = API_KEY;

    const startTime = Date.now();
    const res = await fetch(url, { 
      method: "POST", 
      headers, 
      body: form 
    });

    if (!res.ok) {
      let errorMessage = `OCR failed (${res.status})`;
      
      try {
        const errorBody = await res.json() as OcrError;
        
        // Provide user-friendly error messages
        switch (errorBody.error) {
          case 'aws_not_configured':
            errorMessage = 'OCR service is not configured. Please contact support.';
            break;
          case 'invalid_image':
            errorMessage = 'Invalid image format or corrupted file. Please try a different photo.';
            break;
          case 'file_too_large':
            errorMessage = errorBody.message || 'Image file is too large. Please use a smaller image.';
            break;
          case 'rate_limit_exceeded':
            errorMessage = 'Too many requests. Please wait a moment and try again.';
            break;
          case 'textract_failed':
            errorMessage = 'OCR processing failed. Please try again with a clearer photo.';
            break;
          default:
            errorMessage = errorBody.message || errorMessage;
        }
      } catch {
        // Fallback to status text if JSON parsing fails
        errorMessage = await res.text().catch(() => `${res.status} ${res.statusText}`);
      }

      throw new Error(errorMessage);
    }

    onProgress?.('processing');

    const result = await res.json() as OcrResult;
    const totalTime = Date.now() - startTime;

    console.log('OCR Result:', {
      vin: result.vin,
      valid: result.vinValid,
      confidence: result.confidence,
      candidates: result.candidates?.length || 0,
      processingTime: result.processingTime,
      totalTime,
      fromCache: result.fromCache
    });

    return result;

  } catch (error) {
    console.error('OCR Error:', error);
    throw error;
  }
}

// Legacy function for backward compatibility
export async function ocrVinServer(file: File): Promise<string | null> {
  try {
    const result = await ocrVinFromImage(file);
    return result.vin;
  } catch (error) {
    console.error('Legacy OCR error:', error);
    throw error;
  }
}

// Enhanced VIN validation (client-side check)
export function isValidVin(vin: string): boolean {
  if (!vin || vin.length !== 17) return false;
  
  // Basic format check
  if (!/^[A-HJ-NPR-Z0-9]{17}$/i.test(vin)) return false;
  
  // Check digit validation
  const weights = [8, 7, 6, 5, 4, 3, 2, 10, 0, 9, 8, 7, 6, 5, 4, 3, 2];
  const values: { [key: string]: number } = {
    '0': 0, '1': 1, '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9,
    'A': 1, 'B': 2, 'C': 3, 'D': 4, 'E': 5, 'F': 6, 'G': 7, 'H': 8,
    'J': 1, 'K': 2, 'L': 3, 'M': 4, 'N': 5, 'P': 7, 'R': 9, 'S': 2,
    'T': 3, 'U': 4, 'V': 5, 'W': 6, 'X': 7, 'Y': 8, 'Z': 9
  };
  
  const upper = vin.toUpperCase();
  let sum = 0;
  
  for (let i = 0; i < 17; i++) {
    if (i === 8) continue; // skip check digit position
    sum += (values[upper[i]] || 0) * weights[i];
  }
  
  const checkDigit = sum % 11;
  const expectedCheck = checkDigit === 10 ? 'X' : checkDigit.toString();
  return upper[8] === expectedCheck;
}

// VIN formatting utility
export function formatVin(vin: string): string {
  return vin.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 17);
}

// Get OCR processing statistics
export async function getOcrMetrics() {
  return j<{
    totalRequests: number;
    successfulRequests: number;
    averageProcessingTime: number;
    vinDetectionRate: number;
    cacheHits: number;
    successRate: string;
    cacheHitRate: string;
  }>(`${BASE}/metrics/ocr`);
}

// Check backend health including AWS status
export async function getHealthStatus() {
  return j<{
    ok: boolean;
    dataDir: string;
    hasPrivateKey: boolean;
    hasPublicKey: boolean;
    aws: {
      configured: boolean;
      region: string;
      textractAvailable: boolean;
    };
    cache: {
      keys: number;
      stats: any;
    };
  }>(`${BASE}/healthz`);
}

// Existing functions remain unchanged
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

// Enhanced uploadPhotoDev function for src/lib/api.ts
// Replace existing uploadPhotoDev function with this improved version

export async function uploadPhotoDev(
  vin: string, 
  role: ImageRole, 
  file: File, 
  onProgress?: (p: number) => void
) {
  // Validate file before upload
  if (!file || file.size === 0) {
    throw new Error('Invalid file: No file data')
  }

  // PWA Camera File Validation
  if (file.size > 15 * 1024 * 1024) { // 15MB limit
    throw new Error('File too large: Please compress the image or take a new photo')
  }

  // Validate file type
  if (!file.type.startsWith('image/')) {
    throw new Error('Invalid file type: Only images are allowed')
  }

  const form = new FormData()
  form.append('vin', vin)
  form.append('role', role)
  form.append('file', file)

  const headers: Record<string, string> = {}
  if (API_KEY) headers['X-Api-Key'] = API_KEY

  // Enhanced fetch with better error handling for PWA
  try {
    onProgress?.(10) // Starting upload

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 30000) // 30 second timeout

    const response = await fetch(`${BASE}/intake/photos/upload`, { 
      method: 'POST', 
      headers, 
      body: form,
      signal: controller.signal
    })

    clearTimeout(timeoutId)
    onProgress?.(90) // Upload complete, processing

    if (!response.ok) {
      let errorMessage = `Upload failed (${response.status})`
      
      try {
        const errorText = await response.text()
        if (errorText) {
          // Try to parse JSON error
          try {
            const errorJson = JSON.parse(errorText)
            errorMessage = errorJson.error || errorJson.message || errorMessage
          } catch {
            // Use raw text if not JSON
            errorMessage = errorText
          }
        }
      } catch {
        // Use status-based error message
        if (response.status === 413) {
          errorMessage = 'Photo is too large. Please try taking a smaller photo.'
        } else if (response.status === 415) {
          errorMessage = 'Photo format not supported. Please try again.'
        } else if (response.status >= 500) {
          errorMessage = 'Server error. Please try again in a moment.'
        }
      }

      throw new Error(errorMessage)
    }

    const result = await response.json()
    onProgress?.(100) // Complete

    return result

  } catch (error: any) {
    // Enhanced error handling for common PWA issues
    if (error.name === 'AbortError') {
      throw new Error('Upload timed out. Please check your connection and try again.')
    }
    
    if (error.name === 'TypeError' && error.message.includes('fetch')) {
      throw new Error('Network error. Please check your connection and try again.')
    }

    if (error.name === 'TypeError' && error.message.includes('NetworkError')) {
      throw new Error('Network connection failed. Please try again.')
    }

    // Re-throw with original message if it's already a handled error
    throw error
  }
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
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const body = {
    vin,
    lot_id: lotId,
    ...(roles?.length ? { required_photos: roles } : {})
  };
  const res = await fetch(`${BASE}/intake/init`, { 
    method: 'POST', 
    headers, 
    body: JSON.stringify(body) 
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
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

export async function setOdometer(vin: string, km: number, source: 'manual' | 'dekra' = 'manual') {
  if (!Number.isFinite(km) || km < 0) throw new Error('Enter a valid odometer (km)');
  return j(`${BASE}/intake/init`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ vin, odometer_km: Math.floor(km), odometer_source: source }),
  });
}

export async function setTyreDepths(vin: string, depths: {
  fl: number | null;
  fr: number | null;
  rl: number | null;
  rr: number | null;
}) {
  if (!vin) throw new Error('VIN required');
  
  // Validate measurements
  const validDepth = (val: number | null) => val === null || (typeof val === 'number' && val >= 0 && val <= 12);
  if (!validDepth(depths.fl) || !validDepth(depths.fr) || !validDepth(depths.rl) || !validDepth(depths.rr)) {
    throw new Error('Invalid tyre measurements (must be 0-12mm or null)');
  }

  return j(`${BASE}/intake/tyres`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ vin, tyres_mm: depths }),
  });
}