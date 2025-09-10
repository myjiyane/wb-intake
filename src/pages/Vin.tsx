import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { getChecklist, seedRequiredPhotos, uploadPhotoDev } from '../lib/api'
import type { Checklist, ImageRole } from '../types'
import { Camera, RefreshCcw, CheckCircle2, AlertTriangle, Image as Img } from 'lucide-react'

const DEFAULT_ROLES: ImageRole[] = [
  'exterior_front_34','exterior_rear_34','left_side','right_side',
  'interior_front','dash_odo','engine_bay',
  'tyre_fl','tyre_fr','tyre_rl','tyre_rr'
]

export default function Vin() {
  const { vin = '' } = useParams()
  const [sp] = useSearchParams()
  const lot = sp.get('lot') || 'WB-POC-001'
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string|null>(null)
  const [chk, setChk] = useState<Checklist | null>(null)
  const [uploading, setUploading] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement|null>(null)
  const [activeRole, setActiveRole] = useState<ImageRole | ''>('')


  async function load() {
    setError(null); setLoading(true)
    try {
      const c = await getChecklist(vin)
      setChk(c)
    } catch (e:any) {
      setError(e?.message || String(e))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [vin])

  const missing = useMemo(() => chk?.checklist.missing || [], [chk])

  async function seed() {
    try {
      await seedRequiredPhotos(vin, lot, DEFAULT_ROLES)
      await load()
    } catch (e:any) {
      alert('Seeding failed: ' + (e?.message || String(e)))
    }
  }

  function choosePhoto(role: ImageRole) {
    setActiveRole(role)
    fileRef.current?.click()
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file || !activeRole) return
    setUploading(activeRole)
    try {
      await uploadPhotoDev(vin, activeRole, file)
      await load()
    } catch (err:any) {
      alert('Upload failed: ' + (err?.message || String(err)))
    } finally {
      setUploading(null)
      e.target.value = '' // reset
    }
  }

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold text-slate-800">VIN: <span className="font-mono">{vin}</span></h2>

      {loading && <div className="text-slate-600">Loading checklist…</div>}
      {error && <div className="text-rose-700">Error: {error}</div>}

      {chk && (
        <>
          <div className="rounded-xl border border-slate-200 bg-white p-3">
            <div className="flex items-center justify-between">
              <div className="text-sm text-slate-600">
                Lot <span className="font-mono">{chk.lot_id || lot}</span>
              </div>
              <button onClick={load} className="text-xs inline-flex items-center gap-1 px-2 py-1 rounded border border-slate-200 hover:bg-slate-50">
                <RefreshCcw className="w-3.5 h-3.5" /> Refresh
              </button>
            </div>
            <ul className="mt-2 text-sm space-y-1">
              <li className="flex items-center gap-2">
                {chk.checklist.hasDekra ? <CheckCircle2 className="w-4 h-4 text-emerald-600"/> : <AlertTriangle className="w-4 h-4 text-amber-600"/>}
                <span>DEKRA link: <b>{chk.checklist.hasDekra ? 'Present' : 'Missing'}</b></span>
              </li>
              <li className="flex items-center gap-2">
                {chk.checklist.hasOdo ? <CheckCircle2 className="w-4 h-4 text-emerald-600"/> : <AlertTriangle className="w-4 h-4 text-amber-600"/>}
                <span>Odometer: <b>{chk.checklist.hasOdo ? 'Present' : 'Missing'}</b></span>
              </li>
              <li className="flex items-center gap-2">
                {chk.checklist.photosOk ? <CheckCircle2 className="w-4 h-4 text-emerald-600"/> : <AlertTriangle className="w-4 h-4 text-amber-600"/>}
                <span>Photos: <b>{chk.checklist.presentCount}/{chk.checklist.requiredCount}</b></span>
              </li>
            </ul>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-3">
            <div className="flex items-center justify-between mb-2">
              <div className="text-sm font-semibold text-slate-700">Required photos</div>
              {!chk.checklist.requiredCount && (
                <button onClick={seed} className="text-xs inline-flex items-center gap-2 rounded-lg border border-teal-300 text-teal-800 bg-teal-50 px-2 py-1">
                  Seed defaults
                </button>
              )}
            </div>
            {chk.checklist.requiredCount ? (
              <div className="grid grid-cols-2 gap-2">
                {(missing.length ? missing : []).map(role => (
                  <button key={role}
                          onClick={() => choosePhoto(role)}
                          className="h-24 rounded-lg border border-slate-200 flex flex-col items-center justify-center gap-2 bg-slate-50 active:scale-[.99]">
                    <Camera className="w-6 h-6 text-slate-500" />
                    <span className="text-[11px] text-slate-700 text-center">{role.replace(/_/g,' ')}</span>
                  </button>
                ))}
                {/* Show a gentle message if none missing */}
                {missing.length === 0 && (
                  <div className="col-span-2 text-center text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg p-3">
                    All required photos captured ✓
                  </div>
                )}
              </div>
            ) : (
              <div className="text-sm text-slate-600">No required roles set. Tap <b>Seed defaults</b> to create the checklist.</div>
            )}
            <input ref={fileRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={onFile} />
            {uploading && <div className="mt-2 text-xs text-slate-600 inline-flex items-center gap-2"><Img className="w-4 h-4"/>{uploading}: uploading…</div>}
          </div>

          <div className={`rounded-xl p-3 border ${chk.ready ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-amber-200 bg-amber-50 text-amber-800'}`}>
            {chk.ready ? 'Ready to seal' : 'Not ready to seal yet'}
          </div>
        </>
      )}
    </div>
  )
}
