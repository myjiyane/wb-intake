import React, { useEffect, useRef } from 'react'
import { BrowserMultiFormatReader } from '@zxing/browser'

export default function VinScanner({
  onResult, onClose,
}: { onResult: (vin: string) => void; onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    const reader = new BrowserMultiFormatReader()
    let active = true
    ;(async () => {
      const video = videoRef.current!
      const controls = await reader.decodeFromVideoDevice(undefined, video, (r) => {
        if (!active) return
        const raw = r?.getText()
        if (!raw) return
        const vin = raw
          .toUpperCase()
          .replace(/[^A-Z0-9]/g, '')   // keep only A–Z0–9
          .replace(/[IOQ]/g, '')       // VIN excludes I, O, Q
          .slice(0, 17)                // 17 max
        if (vin.length >= 11) {        // accept 11–17 for convenience
          active = false
          controls.stop()
          onResult(vin)
        }
      })
    })()
    return () => { active = false }
  }, [onResult])

  return (
    <div className="fixed inset-0 z-50 bg-black/90 flex flex-col">
      <video ref={videoRef} className="w-full h-full object-cover" muted playsInline />
      <button
        className="absolute top-3 right-3 text-white px-3 py-2 rounded-lg bg-white/10"
        onClick={onClose}
      >
        Close
      </button>
    </div>
  )
}
