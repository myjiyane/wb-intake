// src/lib/api.ts
import type { Checklist, ImageRole } from '../types';
import { logger, serializeError } from './logger';
import { normalizeVin as normalizeVinInternal, formatVin as formatVinInternal, isValidVin as isValidVinInternal } from './vin';

const BASE = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/+$/, '');
const API_KEY = import.meta.env.VITE_API_KEY as string | undefined;

const log = logger.withContext({ scope: 'api' });


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

export interface UploadPhotoOptions {
  onProgress?: (p: number) => void;
  context?: Record<string, string | number | boolean>;
  originalFile?: File;
}

async function j<T>(url: string, init?: RequestInit): Promise<T> {
  const initialHeaders: HeadersInit | undefined = init?.headers;
  const headers = new Headers(initialHeaders);
  if (API_KEY) headers.set('X-Api-Key', API_KEY);

  const response = await fetch(url, { ...init, headers });
  if (!response.ok) {
    const contentType = response.headers.get('content-type') ?? '';
    let message = `${response.status} ${response.statusText}`;

    try {
      const body = contentType.includes('application/json')
        ? await response.json()
        : await response.text();

      if (typeof body === 'object' && body !== null && 'error' in body) {
        const details = body as { error?: string; reasons?: unknown };
        const reasons = Array.isArray(details.reasons) ? details.reasons.join(',') : undefined;
        const errorText = details.error ?? response.statusText;
        message = `${response.status} ${errorText}${reasons ? `: ${reasons}` : ''}`;
      } else if (typeof body === 'string' && body.trim().length > 0) {
        message = body;
      }
    } catch (_error) {
      void _error;
      /* ignore parse errors */
    }

    throw new Error(message);
  }

  return response.json() as Promise<T>;
}


export function serverOrigin() {
  try {
    const u = new URL(BASE, window.location.href);
    return `${u.protocol}//${u.host}`;
  } catch (_error) {
    void _error;
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
      log.debug('Compressed odometer image', {
        originalSize: file.size,
        processedSize: processedFile.size,
      });
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
      } catch (_error) {
        void _error;
        // Fallback to status text if JSON parsing fails
        errorMessage = await res.text().catch(() => `${res.status} ${res.statusText}`);
      }

      throw new Error(errorMessage);
    }

    onProgress?.('processing');

    const result = await res.json() as ocrOdoResult;
    const totalTime = Date.now() - startTime;

    log.info('Odometer OCR completed', {
      km: result.km,
      unit: result.unit,
      confidence: result.confidence,
      candidates: result.candidates?.length ?? 0,
      processingTime: result.processingTime,
      totalTime,
      fromCache: result.fromCache,
    });

    return result;

  } catch (error: unknown) {
    log.error('Odometer OCR failed', { error: serializeError(error) });
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
      log.debug('Compressed VIN image', {
        originalSize: file.size,
        processedSize: processedFile.size,
      });
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
      } catch (_error) {
        void _error;
        // Fallback to status text if JSON parsing fails
        errorMessage = await res.text().catch(() => `${res.status} ${res.statusText}`);
      }

      throw new Error(errorMessage);
    }

    onProgress?.('processing');

    const result = await res.json() as OcrResult;
    const totalTime = Date.now() - startTime;

    log.info('VIN OCR completed', {
      vin: result.vin,
      vinValid: result.vinValid,
      confidence: result.confidence,
      candidates: result.candidates?.length ?? 0,
      processingTime: result.processingTime,
      totalTime,
      fromCache: result.fromCache,
    });

    return result;

  } catch (error: unknown) {
    log.error('VIN OCR failed', { error: serializeError(error) });
    throw error;
  }
}

// Legacy function for backward compatibility
export async function ocrVinServer(file: File): Promise<string | null> {
  try {
    const result = await ocrVinFromImage(file);
    return result.vin;
  } catch (error: unknown) {
    log.error('Legacy OCR error', { error: serializeError(error) });
    throw error;
  }
}

export const normalizeVin = normalizeVinInternal;
export const formatVin = formatVinInternal;
export const isValidVin = isValidVinInternal;

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
      stats: Record<string, unknown>;
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
  onProgressOrOptions?: UploadPhotoOptions | ((p: number) => void)
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

  let onProgress: ((p: number) => void) | undefined
  let context: Record<string, string | number | boolean> | undefined
  let originalFile: File | undefined

  if (typeof onProgressOrOptions === 'function') {
    onProgress = onProgressOrOptions
  } else if (onProgressOrOptions) {
    onProgress = onProgressOrOptions.onProgress
    context = onProgressOrOptions.context
    originalFile = onProgressOrOptions.originalFile
  }

  const form = new FormData()
  form.append('vin', vin)
  form.append('role', role)
  form.append('file', file)
  if (originalFile && originalFile !== file) {
    form.append('original_file', originalFile)
  }
  if (context) {
    for (const [key, value] of Object.entries(context)) {
      form.append(`meta_${key}`, String(value))
    }
  }

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
            const parsed: unknown = JSON.parse(errorText)
            if (typeof parsed === 'object' && parsed !== null) {
              const parsedError = parsed as { error?: string; message?: string }
              errorMessage = parsedError.error ?? parsedError.message ?? errorMessage
            } else {
              errorMessage = errorText
            }
          } catch (_error) {
            void _error;
            // Use raw text if not JSON
            errorMessage = errorText
          }
        }
      } catch (_error) {
        void _error;
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

  } catch (error: unknown) {
    log.error('Photo upload failed', {
      error: serializeError(error),
      vin,
      role,
      fileSize: file.size,
    });

    if (error instanceof Error) {
      if (error.name === 'AbortError') {
        throw new Error('Upload timed out. Please check your connection and try again.')
      }

      if (error.name === 'TypeError' && error.message.includes('fetch')) {
        throw new Error('Network error. Please check your connection and try again.')
      }

      if (error.name === 'TypeError' && error.message.includes('NetworkError')) {
        throw new Error('Network connection failed. Please try again.')
      }
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
  return j(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ vin }),
  });
}

export async function initDraft(vin: string, lotId: string, roles?: ImageRole[]) {
  const body = {
    vin,
    lot_id: lotId,
    ...(roles?.length ? { required_photos: roles } : {}),
  };

  return j(`${BASE}/intake/init`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
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





