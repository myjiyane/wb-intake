import { useCallback, useEffect, useRef, useState } from 'react'
import { BrowserMultiFormatReader } from '@zxing/browser'
import type { IScannerControls } from '@zxing/browser'
import { ocrVinFromImage, type OcrResult } from '../lib/api'
import { formatVin, normalizeVin, isValidVin } from '../lib/vin'

// Helper function to get friendly error messages
function getFriendlyError(error: Error, fallback: string): string {
  if (error.name === 'NotAllowedError') {
    return 'Camera permission denied. Please enable camera access and try again.';
  }
  if (error.name === 'NotFoundError') {
    return 'No camera found on this device.';
  }
  if (error.name === 'OverconstrainedError') {
    return 'Camera constraints not supported. Trying fallback resolution.';
  }
  if (error.name === 'NotReadableError') {
    return 'Camera is currently being used by another application.';
  }
  return error.message || fallback;
}

type Props = { 
  onResult: (vin: string) => void; 
  onClose: () => void;
  // New optional props for enhanced functionality
  showValidation?: boolean;
  allowInvalidVins?: boolean;
}

type DecodeCallback = Parameters<BrowserMultiFormatReader['decodeFromVideoDevice']>[2];
type GetUserMediaFn = (constraints?: MediaStreamConstraints) => Promise<MediaStream>;
type LegacyNavigator = Navigator & {
  getUserMedia?: GetUserMediaFn;
  webkitGetUserMedia?: GetUserMediaFn;
  mozGetUserMedia?: GetUserMediaFn;
};

export default function VinScanner({ 
  onResult, 
  onClose, 
  showValidation = true,
  allowInvalidVins = false 
}: Props) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const readerRef = useRef<BrowserMultiFormatReader | null>(null)
  const controlsRef = useRef<IScannerControls | null>(null)

  const [detected, setDetected] = useState('')
  const [scanning, setScanning] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string>('')
  
  // Enhanced state for OCR results
  const [ocrResult, setOcrResult] = useState<OcrResult | null>(null)
  const [ocrProgress, setOcrProgress] = useState<'validating' | 'compressing' | 'uploading' | 'processing' | null>(null)
  const [showCandidates, setShowCandidates] = useState(false)
  const framingReady = true // For now, assume framing is always ready

  const stop = useCallback(() => {
    controlsRef.current?.stop();
    setScanning(false);
  }, []);

  const handleDecoded = useCallback<DecodeCallback>((result) => {
    const raw = result?.getText?.();
    if (!raw) return;

    const vinCandidate = normalizeVin(raw);
    if (vinCandidate.length < 11) return;

    const formatted = formatVin(vinCandidate);
    const valid = isValidVin(formatted);

    setDetected(formatted);
    setOcrResult({
      ok: true,
      vin: formatted,
      vinValid: valid,
      candidates: [formatted],
      confidence: 100,
      processingTime: 0,
      textExtracted: true,
      totalBlocks: 1,
      lineCount: 1,
      fromCache: false,
    });

    if (valid || allowInvalidVins) {
      stop();
      onResult(formatted);
      onClose();
    }
  }, [allowInvalidVins, onClose, onResult, stop]);

  const startWithConstraints = useCallback(async (constraints?: MediaTrackConstraints) => {
    if (!readerRef.current) readerRef.current = new BrowserMultiFormatReader();
    const reader = readerRef.current;
    const video = videoRef.current;
    if (!video) return;

    setScanning(true);
    setErr('');

    if (constraints) {
      const mediaConstraints: MediaStreamConstraints = { video: constraints };
      controlsRef.current = await reader.decodeFromConstraints(mediaConstraints, video, handleDecoded);
      return;
    }

    controlsRef.current = await reader.decodeFromVideoDevice(undefined, video, handleDecoded);
  }, [handleDecoded]);

  const startScan = useCallback(async () => {
    setDetected('');
    setErr('');
    setOcrResult(null);

    const primaryConstraints: MediaTrackConstraints = {
      facingMode: { ideal: 'environment' },
      width: { ideal: 1280 },
      height: { ideal: 720 },
    };

    try {
      await startWithConstraints(primaryConstraints);
      return;
    } catch (error: unknown) {
      setScanning(false);
      if (error instanceof Error && error.name !== 'OverconstrainedError') {
        setErr(getFriendlyError(error, 'Unable to start camera with requested resolution.'));
      }
    }

    try {
      await startWithConstraints({ facingMode: { ideal: 'environment' } });
      return;
    } catch (error: unknown) {
      setScanning(false);
      void error;
    }

    try {
      const devices = await navigator.mediaDevices?.enumerateDevices?.();
      const videoDevices = (devices ?? []).filter(device => device.kind === 'videoinput');
      const fallbackDevice = videoDevices.find(device => /back|rear|environment/i.test(device.label))
        ?? videoDevices[videoDevices.length - 1];

      if (fallbackDevice?.deviceId) {
        if (!readerRef.current) readerRef.current = new BrowserMultiFormatReader();
        const reader = readerRef.current;
        const video = videoRef.current;
        if (!video) return;

        setScanning(true);
        setErr('');
        controlsRef.current = await reader.decodeFromVideoDevice(fallbackDevice.deviceId, video, handleDecoded);
        return;
      }
    } catch (error: unknown) {
      setScanning(false);
      if (error instanceof Error) {
        setErr(getFriendlyError(error, 'Unable to start camera with requested resolution.'));
      }
    }

    setErr('Camera stream unavailable on this device/origin');
  }, [handleDecoded, startWithConstraints]);

  useEffect(() => {
    const legacyNavigator = navigator as LegacyNavigator;
    const hasGetUserMedia =
      typeof navigator.mediaDevices?.getUserMedia === 'function' ||
      typeof legacyNavigator.getUserMedia === 'function' ||
      typeof legacyNavigator.webkitGetUserMedia === 'function' ||
      typeof legacyNavigator.mozGetUserMedia === 'function';

    if (hasGetUserMedia) {
      startScan().catch(() => undefined);
    } else {
      setErr('Live camera not supported on this origin; use photo capture instead.');
    }

    return () => {
      stop();
    };
  }, [startScan, stop]);

  // Enhanced OCR with progress tracking and better error handling
  async function decodeFile(file: File) {
    try {
      setErr('')
      setDetected('')
      setOcrResult(null)
      setBusy(true)
      setOcrProgress('validating')
      
      const result = await ocrVinFromImage(file, {
        compress: true,
        compressionOptions: {
          maxWidth: 1600,
          maxHeight: 900,
          quality: 0.9
        },
        onProgress: (stage) => {
          setOcrProgress(stage)
        }
      })
      
      setOcrResult(result)
      setOcrProgress(null)
      
      if (result.vin) {
        const formatted = formatVin(result.vin)
        setDetected(formatted)
        
        // Auto-accept if valid VIN or if invalid VINs are allowed
        if (result.vinValid || allowInvalidVins) {
          onResult(formatted)
          onClose()
          return
        }
        
        // Show validation warning but don't auto-close
        if (!result.vinValid && showValidation) {
          setErr(`VIN "${formatted}" failed validation check. ${result.candidates.length > 1 ? 'Check other candidates below.' : 'Try a clearer photo.'}`)
        }
      } else {
        // No VIN found - show helpful message and candidates if any
        if (result.candidates.length > 0) {
          setErr(`No valid VIN detected. Found ${result.candidates.length} candidate(s) - check below or try a clearer photo.`)
          setShowCandidates(true)
        } else if (result.textExtracted) {
          setErr(`Text was found but no VIN detected. Make sure the VIN is clearly visible and well-lit.`)
        } else {
          setErr(`No text detected in photo. Try getting closer or improving lighting.`)
        }
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Failed to read VIN from photo';
      setErr(message);
      setOcrResult(null);
    } finally {
      setBusy(false)
      setOcrProgress(null)
    }
  }

  // Handle candidate selection
  const selectCandidate = (candidate: string) => {
    const formatted = formatVin(candidate)
    const valid = isValidVin(formatted)
    
    setDetected(formatted)
    if (ocrResult) {
      setOcrResult({
        ...ocrResult,
        vin: formatted,
        vinValid: valid
      })
    }
    setShowCandidates(false)
    
    if (valid || allowInvalidVins) {
      onResult(formatted)
      onClose()
    } else if (showValidation) {
      setErr(`VIN "${formatted}" failed validation check. You can still use it if needed.`)
    }
  }

  // Progress message helper
  const getProgressMessage = () => {
    switch (ocrProgress) {
      case 'validating': return 'Validating image...'
      case 'compressing': return 'Optimizing photo...'
      case 'uploading': return 'Uploading to OCR service...'
      case 'processing': return 'Reading text from image...'
      default: return busy ? 'Processing...' : 'Point camera at the VIN label'
    }
  }

  // Validation status component
  const ValidationStatus = ({ valid, confidence }: { valid: boolean; confidence: number }) => {
    if (!showValidation) return null
    
    return (
      <div className="mt-2 flex items-center gap-2 text-xs">
        <div className={`w-2 h-2 rounded-full ${valid ? 'bg-green-400' : 'bg-yellow-400'}`} />
        <span className={valid ? 'text-green-200' : 'text-yellow-200'}>
          {valid ? 'Valid VIN' : 'Invalid check digit'} • {confidence.toFixed(1)}% confidence
        </span>
      </div>
    )
  }

  const shutterDisabled = busy || !framingReady;

  return (
    <div className="fixed inset-0 z-50">
      {/* Video background */}
      <video ref={videoRef} className="w-full h-full object-cover" muted playsInline autoPlay />
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-black/30" />
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
        <div className={`relative w-[72%] max-w-xs aspect-[4/3] rounded-lg border-2 ${framingReady ? 'border-emerald-400' : 'border-amber-300'}`}>
          <div className="absolute inset-0 border border-white/30 rounded-lg pointer-events-none" />
          <div className="absolute inset-0 flex justify-center">
            <div className="w-px h-full bg-white/20" />
          </div>
          <div className="absolute inset-0 flex items-center">
            <div className="h-px w-full bg-white/20" />
          </div>
        </div>
      </div>
      {!framingReady && !busy && !scanning && (
        <div className="pointer-events-none absolute bottom-32 left-0 right-0 flex justify-center">
          <div className="bg-amber-500/90 text-white text-xs px-3 py-2 rounded-full shadow">Align the VIN within the guide to enable capture</div>
        </div>
      )}

      {/* Top bar */}
      <div className="absolute top-0 left-0 right-0 p-4 pt-[calc(env(safe-area-inset-top,0)+1rem)] flex items-center justify-between">
        <button
          onClick={() => { stop(); onClose() }}
          className="pointer-events-auto rounded-lg bg-white/90 px-3 py-2 text-sm font-medium hover:bg-white transition-colors"
          disabled={busy}
        >
          Cancel
        </button>
        <div className="flex gap-2">
          <button
            onClick={() => (scanning ? stop() : startScan())}
            className="pointer-events-auto rounded-lg bg-white/90 px-3 py-2 text-sm font-medium hover:bg-white transition-colors"
            disabled={busy}
          >
            {scanning ? 'Pause' : 'Rescan'}
          </button>

          {/* Still-photo capture with progress indication */}
          <label
            className={`pointer-events-auto rounded-lg px-3 py-2 text-sm font-medium cursor-pointer transition-colors ${
              shutterDisabled 
                ? 'bg-white/60 text-slate-500 cursor-not-allowed pointer-events-none' 
                : 'bg-white/90 text-slate-900 hover:bg-white'
            }`}
            aria-disabled={shutterDisabled}
          >
            {busy ? (ocrProgress ? ocrProgress.charAt(0).toUpperCase() + ocrProgress.slice(1) + '...' : 'Reading...') : 'Take Photo'}
            <input
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              disabled={shutterDisabled}
              onChange={async (e) => {
                const f = e.target.files?.[0]
                if (f) { await decodeFile(f) }
                (e.target as HTMLInputElement).value = ''
              }}
            />
          </label>
        </div>
      </div>

      {/* Bottom panel */}
      <div className="absolute left-0 right-0 bottom-0 p-4 pb-[calc(env(safe-area-inset-bottom,0)+1rem)] space-y-3 max-h-[60vh] overflow-y-auto">
        {detected ? (
          <>
            <div className="rounded-xl bg-black/70 text-white px-4 py-3">
              <div className="text-xs opacity-80">Scanned VIN</div>
              <div className="font-mono text-lg tracking-wide break-all">{detected}</div>
              {ocrResult && (
                <ValidationStatus valid={ocrResult.vinValid} confidence={ocrResult.confidence} />
              )}
              {ocrResult?.fromCache && (
                <div className="mt-1 text-xs text-blue-300">⚡ Cached result</div>
              )}
            </div>
            
            <div className="flex gap-2">
              <button
                onClick={() => { onResult(detected); onClose() }}
                className={`flex-1 rounded-xl py-3 font-semibold tracking-wide transition-colors ${
                  ocrResult?.vinValid || allowInvalidVins
                    ? 'bg-emerald-600 hover:bg-emerald-700 text-white'
                    : 'bg-yellow-600 hover:bg-yellow-700 text-white'
                }`}
                disabled={busy}
              >
                {ocrResult?.vinValid || allowInvalidVins ? 'Use VIN' : 'Use Anyway'}
              </button>
              
              {ocrResult?.candidates && ocrResult.candidates.length > 1 && (
                <button
                  onClick={() => setShowCandidates(!showCandidates)}
                  className="rounded-xl bg-white/20 hover:bg-white/30 text-white px-4 py-3 text-sm transition-colors"
                  disabled={busy}
                >
                  {showCandidates ? 'Hide' : `+${ocrResult.candidates.length - 1}`}
                </button>
              )}
            </div>
          </>
        ) : (
          <>
            <div className="rounded-xl bg-black/70 text-white px-4 py-3">
              <div className="text-xs opacity-80">
                {getProgressMessage()}
              </div>
              {err && (
                <div className="mt-2 text-[11px] text-rose-300 leading-relaxed">
                  {err}
                </div>
              )}
              {ocrResult && !ocrResult.vin && ocrResult.textExtracted && (
                <div className="mt-2 text-[11px] text-blue-300">
                  💡 Text detected but no VIN found. Try centering the VIN label in the photo.
                </div>
              )}
            </div>
            
            <button
              onClick={() => (scanning ? stop() : startScan())}
              className="w-full rounded-xl bg-white/95 hover:bg-white text-slate-900 py-3 font-semibold tracking-wide transition-colors"
              disabled={busy}
            >
              {scanning ? 'Pause scanning' : 'Resume scanning'}
            </button>
          </>
        )}

        {/* Candidate selection */}
        {showCandidates && ocrResult?.candidates && (
          <div className="rounded-xl bg-black/70 text-white px-4 py-3">
            <div className="text-xs opacity-80 mb-3">Other candidates found:</div>
            <div className="space-y-2">
              {ocrResult.candidates.slice(1, 6).map((candidate, idx) => {
                const formatted = formatVin(candidate)
                const valid = isValidVin(formatted)
                return (
                  <button
                    key={idx}
                    onClick={() => selectCandidate(candidate)}
                    className="w-full text-left rounded-lg bg-white/10 hover:bg-white/20 p-3 transition-colors"
                  >
                    <div className="font-mono text-sm">{formatted}</div>
                    <div className="flex items-center gap-2 mt-1">
                      <div className={`w-1.5 h-1.5 rounded-full ${valid ? 'bg-green-400' : 'bg-yellow-400'}`} />
                      <span className="text-xs opacity-70">
                        {valid ? 'Valid' : 'Invalid check digit'}
                      </span>
                    </div>
                  </button>
                )
              })}
            </div>
          </div>
        )}

        {/* OCR processing stats (dev mode) */}
        {import.meta.env.DEV && ocrResult && (
          <div className="rounded-xl bg-black/50 text-white px-4 py-2 text-xs opacity-70">
            <div>Processing: {ocrResult.processingTime}ms • Blocks: {ocrResult.totalBlocks} • Lines: {ocrResult.lineCount}</div>
          </div>
        )}
      </div>
    </div>
  )
}














