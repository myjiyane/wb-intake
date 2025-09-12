import React, { useCallback, useEffect, useRef, useState } from 'react'
import { BrowserMultiFormatReader } from '@zxing/browser'
import { extractVinFromImage as xtractVinFromImage } from '../lib/vin-ocr'

type Props = { onResult: (vin: string) => void; onClose: () => void }

export default function VinScanner({ onResult, onClose }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const readerRef = useRef<BrowserMultiFormatReader | null>(null)
  const controlsRef = useRef<ReturnType<BrowserMultiFormatReader['decodeFromVideoDevice']> | null>(null)

  const [detected, setDetected] = useState('')
  const [scanning, setScanning] = useState(false)
  const [err, setErr] = useState<string>('')

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
    // NOTE: decodeFromVideoDevice accepts either a deviceId string or constraints-like object
    controlsRef.current = await reader.decodeFromVideoDevice(
      (constraints ? { video: constraints } : undefined) as any,
      video,
      (result) => {
        const raw = result?.getText?.()
        if (!raw) return
        const vin = normalizeVin(raw)
        if (vin.length >= 11) {
          setDetected(vin)
          stop()
        }
      }
    )
  }, [])

  const startScan = useCallback(async () => {
    setDetected('')
    setErr('')
    // Progressive fallback chain to avoid OverconstrainedError
    try {
      // 1) Environment with modest ideals (older devices dislike exact + high res)
      await startWithConstraints({ facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } })
      return
    } catch (e: any) {
      if (e?.name !== 'OverconstrainedError') setErr(e?.message || String(e))
    }
    try {
      // 2) Environment without size hints
      await startWithConstraints({ facingMode: { ideal: 'environment' } })
      return
    } catch (e: any) {}
    try {
      // 3) Pick a back camera by label/deviceId when available
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
          if (vin.length >= 11) { setDetected(vin); stop() }
        })
        return
      }
    } catch (e: any) {}
    try {
      // 4) Last resort: any available camera
      await startWithConstraints(undefined)
      return
    } catch (e: any) {
      // Give up to still-photo fallback
      setErr(e?.message || 'Camera stream unavailable on this device/origin')
      setScanning(false)
    }
  }, [startWithConstraints])

  useEffect(() => {
    // Feature-detect basic support; otherwise we’ll show still-photo fallback UI
    const nav: any = navigator
    const hasGUM = !!((navigator.mediaDevices && navigator.mediaDevices.getUserMedia) ||
      nav.getUserMedia || nav.webkitGetUserMedia || nav.mozGetUserMedia)
    if (hasGUM) startScan()
    else setErr('Live camera not supported on this origin; use photo capture instead.')
    return () => { stop() }
  }, [startScan])

  
  async function decodeFile(file: File) {
    try {
      setErr('')
      setDetected('')        
      const vin = await xtractVinFromImage(file)
      if (vin) setDetected(vin)
      else setErr('Couldn’t find a valid VIN in that photo. Try closer and well-lit.')
    } catch (e: any) {
      setErr(e?.message || 'Failed to read VIN from photo')
    }
  }


  return (
    <div className="fixed inset-0 z-50">
      {/* video background */}
      <video ref={videoRef} className="w-full h-full object-cover" muted playsInline autoPlay />
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-black/30" />

      {/* top bar */}
      <div className="absolute top-0 left-0 right-0 p-4 pt-[calc(env(safe-area-inset-top,0)+1rem)] flex items-center justify-between">
        <button onClick={() => { stop(); onClose() }} className="pointer-events-auto rounded-lg bg-white/90 px-3 py-2 text-sm font-medium">
          Cancel
        </button>
        <div className="flex gap-2">
          <button onClick={() => (scanning ? stop() : startScan())} className="pointer-events-auto rounded-lg bg-white/90 px-3 py-2 text-sm font-medium">
            {scanning ? 'Pause' : 'Rescan'}
          </button>
          {/* still-photo fallback always available */}
          <label className="pointer-events-auto rounded-lg bg-white/90 px-3 py-2 text-sm font-medium cursor-pointer">
            Take photo
            <input
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={async (e) => {
                const f = e.target.files?.[0]
                if (f) {await decodeFile(f); }
                (e.target as HTMLInputElement).value = ''
              }}
            />
          </label>
        </div>
      </div>

      {/* bottom panel */}
      <div className="absolute left-0 right-0 bottom-0 p-4 pb-[calc(env(safe-area-inset-bottom,0)+1rem)] space-y-3">
        {detected ? (
          <>
            <div className="rounded-xl bg-black/70 text-white px-4 py-3">
              <div className="text-xs opacity-80">Scanned VIN</div>
              <div className="font-mono text-lg tracking-wide">{detected}</div>
            </div>
            <button onClick={() => onResult(detected)} className="w-full rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white py-3 font-semibold tracking-wide">
              Use scanned VIN
            </button>
          </>
        ) : (
          <>
            <div className="rounded-xl bg-black/70 text-white px-4 py-3">
              <div className="text-xs opacity-80">Point camera at te VIN plate/label </div>
              {err && <div className="mt-1 text-[11px] text-rose-300">{err}</div>}
            </div>
            <button onClick={() => (scanning ? stop() : startScan())} className="w-full rounded-xl bg-white/95 text-slate-900 py-3 font-semibold tracking-wide">
              {scanning ? 'Pause scanning' : 'Resume scanning'}
            </button>
          </>
        )}
      </div>
    </div>
  )
}