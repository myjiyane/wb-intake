// src/pages/Start.tsx
import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import VinScanner from '../components/VinScanner'
import { initDraft } from '../lib/api'
import type { ImageRole } from '../types'

const DEFAULT_ROLES: ImageRole[] = [
  'exterior_front_34','exterior_rear_34','left_side','right_side',
  'interior_front','interior_rear','dash_odo','engine_bay',
  'tyre_fl','tyre_fr','tyre_rl','tyre_rr'
]

export default function Start() {
  const [vin, setVin] = useState('')
  const [lot, setLot] = useState('WB-POC-001')
  const [busy, setBusy] = useState(false)
  const [scanOpen, setScanOpen] = useState(false)
  const nav = useNavigate()

  function normalizeVin(input: string) {
    return input
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '')
      .replace(/[IOQ]/g, '')
      .slice(0, 17)
  }

  async function go() {
    const v = normalizeVin(vin)
    if (v.length < 11) return alert('Enter a VIN (at least 11, ideally 17, characters)')
    setBusy(true)
    try {
      await initDraft(v, lot, DEFAULT_ROLES)
    } catch (e:any) {
      console.warn('init failed:', e?.message || e)
    } finally {
      setBusy(false)
      nav(`/vin/${v}?lot=${encodeURIComponent(lot)}`)
    }
  }

  return (
    <div className="space-y-4">
      <div className="text-slate-700 text-sm">Enter VIN and (optional) Lot ID to begin intake.</div>

      {/* Manual VIN entry */}
      <input
        className="w-full border border-slate-300 rounded-lg px-3 py-2"
        placeholder="VIN (e.g., WDD2040082R088866)"
        value={vin}
        onChange={e=>setVin(e.target.value)}
        disabled={busy}
        inputMode="latin"
        autoCapitalize="characters"
      />

      {/* Clear alternative: OR divider */}
      <div className="flex items-center gap-3">
        <div className="flex-1 h-px bg-slate-200" />
        <div className="text-[11px] uppercase tracking-wide text-slate-500">or</div>
        <div className="flex-1 h-px bg-slate-200" />
      </div>

      {/* Filled, prominent scan action */}
      <button
        type="button"
        onClick={() => setScanOpen(true)}
        disabled={busy}
        className={`w-full rounded-xl ${busy ? 'bg-emerald-400' : 'bg-emerald-600 hover:bg-emerald-700'} text-white py-3 font-semibold tracking-wide`}
      >
        SCAN VIN (plate/photo)
      </button>


      {/* Lot input */}
      <input
        className="w-full border border-slate-300 rounded-lg px-3 py-2"
        placeholder="Lot ID (optional)"
        value={lot}
        onChange={e=>setLot(e.target.value)}
        disabled={busy}
      />

      {/* Proceed */}
      <button
        onClick={go}
        disabled={busy}
        className={`w-full rounded-xl ${busy ? 'bg-teal-400' : 'bg-teal-600 hover:bg-teal-700'} text-white py-3 font-medium`}
      >
        {busy ? 'Preparing…' : 'Start capture'}
      </button>

      <div className="text-xs text-slate-500">
        API: {import.meta.env.VITE_API_BASE_URL}
      </div>

      {scanOpen && (
        <VinScanner
          onResult={(scannedVin) => {
            setVin(scannedVin)   // fill the field; user can edit if needed
            setScanOpen(false)
          }}
          onClose={() => setScanOpen(false)}
        />
      )}
    </div>
  )
}
