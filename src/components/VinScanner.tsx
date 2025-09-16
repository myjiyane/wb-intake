import React, { useCallback, useEffect, useRef, useState } from 'react'
import { BrowserMultiFormatReader } from '@zxing/browser'
import { ocrVinFromImage, isValidVin, formatVin, type OcrResult } from '../lib/api'

type Props = { 
  onResult: (vin: string) => void; 
  onClose: () => void;
  // New optional props for enhanced functionality
  showValidation?: boolean;
  allowInvalidVins?: boolean;
}

export default function VinScanner({ 
  onResult, 
  onClose, 
  showValidation = true,
  allowInvalidVins = false 
}: Props) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const readerRef = useRef<BrowserMultiFormatReader | null>(null)
  const controlsRef = useRef<ReturnType<BrowserMultiFormatReader['decodeFromVideoDevice']> | null>(null)

  const [detected, setDetected] = useState('')
  const [scanning, setScanning] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string>('')
  
  // Enhanced state for OCR results
  const [ocrResult, setOcrResult] = useState<OcrResult | null>(null)
  const [ocrProgress, setOcrProgress] = useState<'validating' | 'compressing' | 'uploading' | 'processing' | null>(null)
  const [showCandidates, setShowCandidates] = useState(false)

  const normalizeVin = (s: string) =>
    s.toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/[IOQ]/g, '').slice(0, 17)

  async function stop() {
    try { controlsRef.current?.stop() } catch {}
    setScanning(false)
  }

  const startWithConstraints = useCallback(async (constraints?: MediaTrackConstraints) => {
    if (!readerRef.current) readerRef.current = new BrowserMultiFormatReader()
    const reader = readerRef.current
    const video = videoRef.current!
    setScanning(true)
    setErr('')
    controlsRef.current = await reader.decodeFromVideoDevice(
      (constraints ? { video: constraints } : undefined) as any,
      video,
      (result) => {
        const raw = result?.getText?.()
        if (!raw) return
        const vin = normalizeVin(raw)
        if (vin.length >= 11) {
          const formatted = formatVin(vin)
          const valid = isValidVin(formatted)
          
          setDetected(formatted)
          setOcrResult({
            ok: true,
            vin: formatted,
            vinValid: valid,
            candidates: [formatted],
            confidence: 100, // Live scan assumed high confidence
            processingTime: 0,
            textExtracted: true,
            totalBlocks: 1,
            lineCount: 1,
            fromCache: false
          })
          
          // Auto-accept if valid, or if invalid VINs are allowed
          if (valid || allowInvalidVins) {
            stop()
            onResult(formatted)
            onClose()
          }
        }
      }
    )
  }, [onClose, onResult, allowInvalidVins])

  const startScan = useCallback(async () => {
    setDetected('')
    setErr('')
    setOcrResult(null)
    try {
      await startWithConstraints({ 
        facingMode: { ideal: 'environment' }, 
        width: { ideal: 1280 }, 
        height: { ideal: 720 } 
      })
      return
    } catch (e: any) { 
      if (e?.name !== 'OverconstrainedError') setErr(e?.message || String(e)) 
    }
    
    try { 
      await startWithConstraints({ facingMode: { ideal: 'environment' } })
      return 
    } catch {}
    
    try {
      const devices = await navigator.mediaDevices?.enumerateDevices?.()
      const vids = (devices || []).filter(d => d.kind === 'videoinput')
      const backFirst = vids.find(d => /back|rear|environment/i.test(d.label)) || vids[vids.length - 1]
      
      if (backFirst?.deviceId) {
        if (!readerRef.current) readerRef.current = new BrowserMultiFormatReader()
        const reader = readerRef.current
        const video = videoRef.current!
        setScanning(true)
        controlsRef.current = await reader.decodeFromVideoDevice(backFirst.deviceId, video, (result) => {
          const raw = result?.getText?.()
          if (!raw) return
          const vin = normalizeVin(raw)
          if (vin.length >= 11) {
            const formatted = formatVin(vin)
            const valid = isValidVin(formatted)
            
            setDetected(formatted)
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
              fromCache: false
            })
            
            if (valid || allowInvalidVins) {
              stop()
              onResult(formatted)
              onClose()
            }
          }
        })
        return
      }
    } catch {}
    
    try { 
      await startWithConstraints(undefined)
      return 
    } catch (e: any) {
      setErr(e?.message || 'Camera stream unavailable on this device/origin')
      setScanning(false)
    }
  }, [startWithConstraints, onClose, onResult, allowInvalidVins])

  useEffect(() => {
    const nav: any = navigator
    const hasGUM = !!((navigator.mediaDevices && navigator.mediaDevices.getUserMedia) ||
      nav.getUserMedia || nav.webkitGetUserMedia || nav.mozGetUserMedia)
    if (hasGUM) startScan()
    else setErr('Live camera not supported on this origin; use photo capture instead.')
    return () => { stop() }
  }, [startScan])

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
    } catch (e: any) {
      setErr(e?.message || 'Failed to read VIN from photo')
      setOcrResult(null)
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
  const ValidationStatus = ({ vin, valid, confidence }: { vin: string, valid: boolean, confidence: number }) => {
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

  return (
    <div className="fixed inset-0 z-50">
      {/* Video background */}
      <video ref={videoRef} className="w-full h-full object-cover" muted playsInline autoPlay />
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-black/30" />

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
              busy 
                ? 'bg-white/60 text-slate-500 cursor-not-allowed' 
                : 'bg-white/90 text-slate-900 hover:bg-white'
            }`}
          >
            {busy ? (ocrProgress ? ocrProgress.charAt(0).toUpperCase() + ocrProgress.slice(1) + '...' : 'Reading...') : 'Take Photo'}
            <input
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              disabled={busy}
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
                <ValidationStatus 
                  vin={detected} 
                  valid={ocrResult.vinValid} 
                  confidence={ocrResult.confidence} 
                />
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
        {process.env.NODE_ENV === 'development' && ocrResult && (
          <div className="rounded-xl bg-black/50 text-white px-4 py-2 text-xs opacity-70">
            <div>Processing: {ocrResult.processingTime}ms • Blocks: {ocrResult.totalBlocks} • Lines: {ocrResult.lineCount}</div>
          </div>
        )}
      </div>
    </div>
  )
}