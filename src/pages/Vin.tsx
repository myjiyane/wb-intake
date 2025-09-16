import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import {
  getChecklist,
  seedRequiredPhotos,
  uploadPhotoDev,
  getPassport,
  serverOrigin,
  sealStrict,
  setDekraUrl,
  setOdometer
} from '../lib/api'
import type { Checklist, ImageRole } from '../types'
import { Camera, RefreshCcw, CheckCircle2, AlertTriangle, Image as Img, Link as LinkIcon } from 'lucide-react'

const DEFAULT_ROLES: ImageRole[] = [
  'exterior_front_34', 'exterior_rear_34', 'left_side', 'right_side',
  'interior_front', 'interior_rear', 'dash_odo', 'engine_bay',
  'tyre_fl', 'tyre_fr', 'tyre_rl', 'tyre_rr'
]

const GROUPS: Record<string, ImageRole[]> = {
  Exterior: ['exterior_front_34', 'exterior_rear_34', 'left_side', 'right_side'],
  Interior: ['interior_front', 'interior_rear'],
  'Dash/Odometer': ['dash_odo'],
  'Engine bay': ['engine_bay'],
  Tyres: ['tyre_fl', 'tyre_fr', 'tyre_rl', 'tyre_rr'],
}

const ROLE_GUIDE: Record<ImageRole, { title: string; hint: string; img: string }> = {
  exterior_front_34: { title: 'Front 3/4 (Left)', hint: 'Stand ±3–4m at front-left. Capture full car, include wheels and roofline.', img: '/examples/exterior_front_34.jpg' },
  exterior_rear_34:  { title: 'Rear 3/4 (Right)', hint: 'Stand ±3–4m at rear-right. Keep car fully in frame.', img: '/examples/exterior_rear_34.jpg' },
  left_side:         { title: 'Left Side', hint: 'Side-on profile. Keep the whole car level and centered.', img: '/examples/left_side.jpg' },
  right_side:        { title: 'Right Side', hint: 'Side-on profile. Watch reflections; avoid cut-offs.', img: '/examples/right_side.jpg' },
  interior_front:    { title: 'Interior (Front)', hint: 'Capture dashboard + front seats; keep horizon level.', img: '/examples/interior_front.jpg' },
  interior_rear:     { title: 'Interior (Rear)', hint: 'Rear bench + door cards; ensure good light.', img: '/examples/interior_rear.jpg' },
  dash_odo:          { title: 'Dash (Odometer)', hint: 'Focus on odometer; avoid glare; make digits readable.', img: '/examples/dash_odo.jpg' },
  engine_bay:        { title: 'Engine Bay', hint: 'Open bonnet; capture bay from above, well-lit.', img: '/examples/engine_bay.jpg' },
  tyre_fl:           { title: 'Tyre (Front Left)', hint: 'Close-up of tread surface & sidewall (FL).', img: '/examples/tyre_fl.jpg' },
  tyre_fr:           { title: 'Tyre (Front Right)', hint: 'Close-up of tread surface & sidewall (FR).', img: '/examples/tyre_fr.jpg' },
  tyre_rl:           { title: 'Tyre (Rear Left)', hint: 'Close-up of tread surface & sidewall (RL).', img: '/examples/tyre_rl.jpg' },
  tyre_rr:           { title: 'Tyre (Rear Right)', hint: 'Close-up of tread surface & sidewall (RR).', img: '/examples/tyre_rr.jpg' },
};


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

  const [dekraUrlInput, setDekraUrlInput] = useState('')
  const [odoInput, setOdoInput] = useState<number | ''>('')
  const [saving, setSaving] = useState<'dekra'|'odo'|null>(null)

  const [guideRole, setGuideRole] = useState<ImageRole | null>(null)

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
    } catch (e: any) {
      setError(e?.message || String(e))
    } finally {
      setLoading(false)
    }
  }
  
 useEffect(() => {
    if (!guideRole) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [guideRole]);

  useEffect(() => { load() }, [vin])

  // Role → current photo (for thumbs/replace)
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
    if (isSealed) return
    setGuideRole(role)
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file || !activeRole) return
    setUploading(activeRole)
    try {
      // Dev path: can be swapped to presigned in P3
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
  
  function GuidanceModal({
    role,
    onCancel,
    onProceed,
  }: {
    role: ImageRole;
    onCancel: () => void;
    onProceed: () => void;
  }) {
    const g = ROLE_GUIDE[role];
    return (
      <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4"
          role="dialog" aria-modal="true" onClick={onCancel}>
        <div className="w-full sm:max-w-lg bg-white rounded-t-2xl sm:rounded-2xl shadow-xl overflow-hidden"
            onClick={e => e.stopPropagation()}>
          <div className="p-3 border-b border-slate-200">
            <div className="text-sm font-semibold text-slate-800">{g?.title || role.replace(/_/g,' ')}</div>
            <div className="text-xs text-slate-500 mt-0.5">{g?.hint}</div>
          </div>
          <div className="aspect-video w-full bg-slate-100">
            <img src={g?.img} alt={g?.title} className="w-full h-full object-cover" onError={(e:any)=>{ e.currentTarget.style.display='none'; }} />
          </div>
          <div className="p-3 grid grid-cols-2 gap-2">
            <button onClick={onCancel}
                    className="rounded-xl border border-slate-300 bg-white text-slate-700 py-2 text-sm">
              Cancel
            </button>
            <button onClick={onProceed}
                    className="rounded-xl bg-teal-600 hover:bg-teal-700 text-white py-2 text-sm font-medium">
              Open camera
            </button>
          </div>
        </div>
      </div>
    )
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
                {!chk.checklist.hasDekra && (
                  <button
                    className="ml-2 inline-flex items-center gap-1 text-xs px-2 py-1 rounded bg-slate-800 text-white"
                    onClick={() => alert('Set DEKRA link is part of P2. UI is ready; enable /intake/draft/patch to save.')}
                    disabled={isSealed}
                  >
                    <LinkIcon className="w-3.5 h-3.5" /> Set link
                  </button>
                )}
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

          {/* Required photos — grouped with inline thumbs + Replace */}
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
            {guideRole && (
              <GuidanceModal
                role={guideRole}
                onCancel={() => setGuideRole(null)}
                onProceed={() => {
                  setGuideRole(null)
                  setActiveRole(guideRole)
                  fileRef.current?.click()
                }}
              />
            )}

            {uploading && (
              <div className="mt-2 text-xs text-slate-600 inline-flex items-center gap-2">
                <Img className="w-4 h-4" />{rolePretty(uploading)}: uploading…
              </div>
            )}
          </div>

          {/* (Optional) Keep old gallery for continuity; remove later if desired */}
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

          {/* Details: DEKRA + Odometer */}
          <div className="rounded-xl border border-slate-200 bg-white p-3">
            <div className="text-sm font-semibold text-slate-700 mb-2">Details</div>

            {/* DEKRA link */}
            <div className="mb-3">
              <label className="block text-xs text-slate-500 mb-1">DEKRA link (https://…)</label>
              <div className="flex gap-2">
                <input
                  value={dekraUrlInput}
                  onChange={e => setDekraUrlInput(e.target.value)}
                  placeholder="https://dekra.example/report/123"
                  className="flex-1 border border-slate-300 rounded-lg px-3 py-2 text-sm"
                  disabled={isSealed || saving === 'dekra'}
                />
                <button
                  className="px-3 rounded-lg bg-slate-800 text-white text-sm disabled:opacity-50"
                  disabled={isSealed || saving === 'dekra'}
                  onClick={async () => {
                    try {
                      setSaving('dekra')
                      await setDekraUrl(vin, dekraUrlInput.trim())
                      setDekraUrlInput('')
                      await load()
                    } catch (e:any) {
                      alert(e?.message || String(e))
                    } finally {
                      setSaving(null)
                    }
                  }}
                >
                  {saving === 'dekra' ? 'Saving…' : 'Save'}
                </button>
              </div>
            </div>

            {/* Odometer */}
            <div>
              <label className="block text-xs text-slate-500 mb-1">Odometer (km)</label>
              <div className="flex gap-2">
                <input
                  type="number"
                  min={0}
                  value={odoInput}
                  onChange={e => setOdoInput(e.target.value ? Number(e.target.value) : '')}
                  placeholder="e.g. 124000"
                  className="flex-1 border border-slate-300 rounded-lg px-3 py-2 text-sm"
                  disabled={isSealed || saving === 'odo'}
                />
                <button
                  className="px-3 rounded-lg bg-slate-800 text-white text-sm disabled:opacity-50"
                  disabled={isSealed || saving === 'odo' || odoInput === ''}
                  onClick={async () => {
                    try {
                      setSaving('odo')
                      await setOdometer(vin, Number(odoInput))
                      setOdoInput('')
                      await load()
                    } catch (e:any) {
                      alert(e?.message || String(e))
                    } finally {
                      setSaving(null)
                    }
                  }}
                >
                  {saving === 'odo' ? 'Saving…' : 'Save'}
                </button>
              </div>
            </div>
          </div>
 
          {/* Ready / Sealed status */}
          <div className={`rounded-xl p-3 border ${
            isSealed
              ? 'border-emerald-300 bg-emerald-50 text-emerald-800'
              : (chk.ready ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-amber-200 bg-amber-50 text-amber-800')}`}>
            {isSealed ? 'Sealed ✓' : (chk.ready ? 'Ready to seal' : 'Not ready to seal yet')}
          </div>

          {/* Seal action with confirm + safeguards */}
          <button
            disabled={!chk.ready || sealing || isSealed}
            onClick={async () => {
              if (!chk.ready) return
              const ok = confirm('Seal this vehicle passport? Required fields become immutable.')
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
