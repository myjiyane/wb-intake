import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import {
  getChecklist,
  seedRequiredPhotos,
  uploadPhotoDev,
  getPassport,
  serverOrigin,
  sealStrict,
  // If you applied my api.ts patch, uncomment the next two:
  // setDekraUrl,
  // setOdometer,
} from '../lib/api'
import type { Checklist, ImageRole } from '../types'
import { Camera, RefreshCcw, CheckCircle2, AlertTriangle, Image as Img } from 'lucide-react'

const DEFAULT_ROLES: ImageRole[] = [
  'exterior_front_34', 'exterior_rear_34', 'left_side', 'right_side',
  'interior_front', 'interior_rear', 'dash_odo', 'engine_bay',
  'tyre_fl', 'tyre_fr', 'tyre_rl', 'tyre_rr'
]

// --- NEW: logical groups to render sections inline
const GROUPS: Record<string, ImageRole[]> = {
  Exterior: ['exterior_front_34', 'exterior_rear_34', 'left_side', 'right_side'],
  Interior: ['interior_front', 'interior_rear'],
  'Dash/Odometer': ['dash_odo'],
  'Engine bay': ['engine_bay'],
  Tyres: ['tyre_fl', 'tyre_fr', 'tyre_rl', 'tyre_rr'],
}

type PhotoItem = { role: ImageRole; url?: string; object_key?: string }
type PassportRecord = {
  draft?: { images?: { items?: PhotoItem[] } }
  sealed?: { images?: { items?: PhotoItem[] } }
}

export default function Vin() {
  const { vin = '' } = useParams()
  const [sp] = useSearchParams()
  const lot = sp.get('lot') || 'WB-POC-001'

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [chk, setChk] = useState<Checklist | null>(null)
  const [photos, setPhotos] = useState<PhotoItem[]>([])
  const [isSealed, setIsSealed] = useState(false)

  const [uploading, setUploading] = useState<ImageRole | null>(null)
  const [sealing, setSealing] = useState(false)

  const fileRef = useRef<HTMLInputElement | null>(null)
  const [activeRole, setActiveRole] = useState<ImageRole | ''>('')

  // --- NEW: details form state (DEKRA link + ODO)
  const [dekraUrlInput, setDekraUrlInput] = useState('')
  const [odoInput, setOdoInput] = useState<number | ''>('')

  function absUrl(u?: string) {
    if (!u) return ''
    return /^https?:\/\//i.test(u) ? u : serverOrigin() + u
  }

  async function load() {
    setError(null); setLoading(true)
    try {
      // checklist + passport → thumbnails + sealed state
      const [c, rec] = await Promise.all([
        getChecklist(vin),
        getPassport(vin) as Promise<PassportRecord>,
      ])
      setChk(c)

      const items = [
        ...(rec.sealed?.images?.items || []),
        ...(rec.draft?.images?.items || []),
      ]
      setPhotos(items)
      setIsSealed(!!rec.sealed)

      // reset details input display hints
      setDekraUrlInput('')
      setOdoInput('')
    } catch (e: any) {
      setError(e?.message || String(e))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [vin])

  const missing = useMemo(() => chk?.checklist.missing || [], [chk])

  // map of role → current photo (for thumbs/replace)
  const presentByRole = useMemo(() => {
    const m = new Map<ImageRole, PhotoItem>()
    photos.forEach(p => m.set(p.role, p))
    return m
  }, [photos])

  function rolePretty(r: ImageRole) { return r.replace(/_/g, ' ') }

  async function seed() {
    try {
      await seedRequiredPhotos(vin, lot, DEFAULT_ROLES)
      await load()
    } catch (e: any) {
      alert('Seeding failed: ' + (e?.message || String(e)))
    }
  }

  function choosePhoto(role: ImageRole) {
    if (isSealed) return // safeguard
    setActiveRole(role)
    fileRef.current?.click()
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file || !activeRole) return
    setUploading(activeRole)
    try {
      // NOTE: still using dev upload path; presigned variant can be swapped later.
      await uploadPhotoDev(vin, activeRole, file)
      await load()
    } catch (err: any) {
      alert('Upload failed: ' + (err?.message || String(err)))
    } finally {
      setUploading(null)
      setActiveRole('')
      e.target.value = '' // reset
    }
  }

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold text-slate-800">
        VIN: <span className="font-mono">{vin}</span>
      </h2>

      {loading && <div className="text-slate-600">Loading checklist…</div>}
      {error && <div className="text-rose-700">Error: {error}</div>}

      {chk && (
        <>
          {/* Summary header */}
          <div className="rounded-xl border border-slate-200 bg-white p-3">
            <div className="flex items-center justify-between">
              <div className="text-sm text-slate-600">
                Lot <span className="font-mono">{chk.lot_id || lot}</span>
              </div>
              <button
                onClick={load}
                className="text-xs inline-flex items-center gap-1 px-2 py-1 rounded border border-slate-200 hover:bg-slate-50"
              >
                <RefreshCcw className="w-3.5 h-3.5" /> Refresh
              </button>
            </div>
            <ul className="mt-2 text-sm space-y-1">
              <li className="flex items-center gap-2">
                {chk.checklist.hasDekra
                  ? <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                  : <AlertTriangle className="w-4 h-4 text-amber-600" />}
                <span>DEKRA link: <b>{chk.checklist.hasDekra ? 'Present' : 'Missing'}</b></span>
              </li>
              <li className="flex items-center gap-2">
                {chk.checklist.hasOdo
                  ? <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                  : <AlertTriangle className="w-4 h-4 text-amber-600" />}
                <span>Odometer: <b>{chk.checklist.hasOdo ? 'Present' : 'Missing'}</b></span>
              </li>
              <li className="flex items-center gap-2">
                {chk.checklist.photosOk
                  ? <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                  : <AlertTriangle className="w-4 h-4 text-amber-600" />}
                <span>Photos: <b>{chk.checklist.presentCount}/{chk.checklist.requiredCount}</b></span>
              </li>
            </ul>
          </div>

          {/* Required photos — now grouped with thumbs + Replace */}
          <div className="rounded-xl border border-slate-200 bg-white p-3">
            <div className="flex items-center justify-between mb-2">
              <div className="text-sm font-semibold text-slate-700">Required photos</div>
              {!chk.checklist.requiredCount && !isSealed && (
                <button
                  onClick={seed}
                  className="text-xs inline-flex items-center gap-2 rounded-lg border border-teal-300 text-teal-800 bg-teal-50 px-2 py-1"
                >
                  Seed defaults
                </button>
              )}
            </div>

            {chk.checklist.requiredCount ? (
              <div className="space-y-3">
                {Object.entries(GROUPS).map(([label, roles]) => (
                  <div key={label}>
                    <div className="text-[12px] font-semibold text-slate-600 mb-1">{label}</div>
                    <div className="grid grid-cols-3 gap-2">
                      {roles.map((role) => {
                        const existing = presentByRole.get(role)
                        const disabled = isSealed || Boolean(uploading)
                        return (
                          <button
                            key={role}
                            onClick={() => choosePhoto(role)}
                            disabled={disabled}
                            className={`aspect-square rounded-lg border border-slate-200 relative overflow-hidden active:scale-[.99] ${
                              existing ? 'bg-white' : 'bg-slate-50'
                            } ${disabled ? 'opacity-60 cursor-not-allowed' : ''}`}
                          >
                            {existing?.url ? (
                              <>
                                <img src={absUrl(existing.url)} alt={role} className="w-full h-full object-cover" />
                                <span className="absolute bottom-1 left-1 right-1 text-[10px] bg-black/50 text-white rounded px-1">
                                  {rolePretty(role)} — Replace
                                </span>
                              </>
                            ) : (
                              <div className="w-full h-full grid place-items-center text-[11px] text-slate-700 px-2 text-center">
                                <Camera className="w-6 h-6 text-slate-500 mb-1" />
                                {rolePretty(role)}
                              </div>
                            )}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                ))}

                {/* If everything present, show a nice state */}
                {chk.checklist.presentCount >= chk.checklist.requiredCount && (
                  <div className="text-center text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg p-3 mt-2">
                    All required photos captured ✓
                  </div>
                )}
              </div>
            ) : (
              <div className="text-sm text-slate-600">
                No required roles set. Tap <b>Seed defaults</b> to create the checklist.
              </div>
            )}

            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={onFile}
            />
            {uploading && (
              <div className="mt-2 text-xs text-slate-600 inline-flex items-center gap-2">
                <Img className="w-4 h-4" />{rolePretty(uploading)}: uploading…
              </div>
            )}
          </div>

          {/* Keep the old "Captured" gallery for continuity (optional to remove later) */}
          {photos.length > 0 && (
            <div className="rounded-xl border border-slate-200 bg-white p-3">
              <div className="text-sm font-semibold text-slate-700 mb-2">Captured</div>
              <div className="grid grid-cols-3 gap-2">
                {photos.map((p, i) => (
                  <div key={`${p.role}-${i}`} className="aspect-square rounded-lg overflow-hidden bg-slate-100 border">
                    {p.url ? (
                      <img src={absUrl(p.url)} alt={p.role} className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full grid place-items-center text-[11px] text-slate-500 px-2 text-center">
                        {rolePretty(p.role)}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* NEW: Details card (DEKRA link + ODO) — requires api.ts patch, else leave for later */}
          <div className="rounded-xl border border-slate-200 bg-white p-3">
            <div className="text-sm font-semibold text-slate-700 mb-2">Details</div>

            <div className="mb-3">
              <label className="block text-xs text-slate-500 mb-1">DEKRA link (https://…)</label>
              <div className="flex gap-2">
                <input
                  value={dekraUrlInput}
                  onChange={e => setDekraUrlInput(e.target.value)}
                  placeholder="https://dekra.example/case/123"
                  className="flex-1 border border-slate-300 rounded-lg px-3 py-2 text-sm" />
                <button
                  className="px-3 rounded-lg bg-slate-800 text-white text-sm disabled:opacity-50"
                  disabled={isSealed}
                  onClick={async () => {
                    try {
                      // @ts-expect-error opt-in only if you added setDekraUrl
                      if (typeof setDekraUrl !== 'function') return alert('API route not available yet')
                      // @ts-expect-error
                      await setDekraUrl(vin, dekraUrlInput)
                      await load()
                      setDekraUrlInput('')
                    } catch (e: any) {
                      alert(e?.message || String(e))
                    }
                  }}>
                  Save
                </button>
              </div>
            </div>

            <div>
              <label className="block text-xs text-slate-500 mb-1">Odometer (km)</label>
              <div className="flex gap-2">
                <input
                  type="number"
                  min={0}
                  value={odoInput}
                  onChange={e => setOdoInput(e.target.value ? Number(e.target.value) : '')}
                  placeholder="e.g. 124000"
                  className="flex-1 border border-slate-300 rounded-lg px-3 py-2 text-sm" />
                <button
                  className="px-3 rounded-lg bg-slate-800 text-white text-sm disabled:opacity-50"
                  disabled={isSealed}
                  onClick={async () => {
                    try {
                      if (odoInput === '' || Number.isNaN(odoInput)) return alert('Enter a valid number')
                      // @ts-expect-error opt-in only if you added setOdometer
                      if (typeof setOdometer !== 'function') return alert('API route not available yet')
                      // @ts-expect-error
                      await setOdometer(vin, Number(odoInput))
                      await load()
                      setOdoInput('')
                    } catch (e: any) {
                      alert(e?.message || String(e))
                    }
                  }}>
                  Save
                </button>
              </div>
            </div>
          </div>

          {/* Ready/Sealed card */}
          <div className={`rounded-xl p-3 border ${
            isSealed
              ? 'border-emerald-300 bg-emerald-50 text-emerald-800'
              : (chk.ready ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-amber-200 bg-amber-50 text-amber-800')}`}>
            {isSealed ? 'Sealed ✓' : (chk.ready ? 'Ready to seal' : 'Not ready to seal yet')}
          </div>

          {/* Seal button with confirm + sealed safeguards */}
          <button
            disabled={!chk.ready || sealing || isSealed}
            onClick={async () => {
              if (!chk.ready) return
              const ok = confirm('Seal this vehicle passport? You will not be able to change required fields afterwards.')
              if (!ok) return
              try {
                setSealing(true)
                await sealStrict(vin) // use { force: true } to override readiness in a pinch
                alert('Sealed ✓')
                await load()
              } catch (e: any) {
                alert('Seal failed: ' + (e?.message || String(e)))
              } finally {
                setSealing(false)
              }
            }}
            className={`mt-3 w-full rounded-xl py-3 font-medium
              ${isSealed ? 'bg-emerald-600 text-white opacity-70' :
                chk.ready ? 'bg-teal-600 hover:bg-teal-700 text-white' :
                'bg-slate-200 text-slate-500 cursor-not-allowed'}`}
          >
            {isSealed ? 'Sealed ✓' : (sealing ? 'Sealing…' : 'Seal now')}
          </button>
        </>
      )}
    </div>
  )
}
