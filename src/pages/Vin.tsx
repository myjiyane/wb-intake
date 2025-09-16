// src/pages/Vin.tsx
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
  setOdometer,
  ocrVinFromImage,
  isValidVin,
  formatVin
} from '../lib/api'
import type { Checklist, ImageRole } from '../types'
import { 
  Camera, RefreshCcw, CheckCircle2, AlertTriangle, Image as Img, 
  Link as LinkIcon, Scan, Shield, Eye, Zap 
} from 'lucide-react'

const DEFAULT_ROLES: ImageRole[] = [
  'exterior_front_34', 'exterior_rear_34', 'left_side', 'right_side',
  'interior_front', 'interior_rear', 'dash_odo', 'engine_bay',
  'tyre_fl', 'tyre_fr', 'tyre_rl', 'tyre_rr'
]

const ROLE_GUIDE: Record<ImageRole, { title: string; hint: string; img: string; canScanVin?: boolean }> = {
  exterior_front_34: { title: 'Front 3/4 (Left)', hint: 'Stand ±3–4m at front-left. Capture full car, include wheels and roofline.', img: '/examples/exterior_front_34.jpg' },
  exterior_rear_34:  { title: 'Rear 3/4 (Right)', hint: 'Stand ±3–4m at rear-right. Keep car fully in frame.', img: '/examples/exterior_rear_34.jpg' },
  left_side:         { title: 'Left Side', hint: 'Side-on profile. Keep the whole car level and centered.', img: '/examples/left_side.jpg' },
  right_side:        { title: 'Right Side', hint: 'Side-on profile. Watch reflections; avoid cut-offs.', img: '/examples/right_side.jpg' },
  interior_front:    { title: 'Interior (Front)', hint: 'Capture dashboard + front seats; keep horizon level.', img: '/examples/interior_front.jpg' },
  interior_rear:     { title: 'Interior (Rear)', hint: 'Rear bench + door cards; ensure good light.', img: '/examples/interior_rear.jpg' },
  dash_odo:          { title: 'Dash (Odometer)', hint: 'Focus on odometer; avoid glare; make digits readable. VIN may be visible here.', img: '/examples/dash_odo.jpg', canScanVin: true },
  engine_bay:        { title: 'Engine Bay', hint: 'Open bonnet; capture bay from above, well-lit. Check for VIN plates.', img: '/examples/engine_bay.jpg', canScanVin: true },
  tyre_fl:           { title: 'Tyre (Front Left)', hint: 'Close-up of tread surface & sidewall (FL).', img: '/examples/tyre_fl.jpg' },
  tyre_fr:           { title: 'Tyre (Front Right)', hint: 'Close-up of tread surface & sidewall (FR).', img: '/examples/tyre_fr.jpg' },
  tyre_rl:           { title: 'Tyre (Rear Left)', hint: 'Close-up of tread surface & sidewall (RL).', img: '/examples/tyre_rl.jpg' },
  tyre_rr:           { title: 'Tyre (Rear Right)', hint: 'Close-up of tread surface & sidewall (RR).', img: '/examples/tyre_rr.jpg' },
}

type TabKey = 'exterior' | 'interior' | 'wheels' | 'other'

const TABS: { key: TabKey; label: string; roles: ImageRole[] }[] = [
  { key: 'exterior', label: 'Exterior', roles: ['exterior_front_34','exterior_rear_34','left_side','right_side'] },
  { key: 'interior', label: 'Interior', roles: ['interior_front','interior_rear','dash_odo'] },
  { key: 'wheels',   label: 'Wheels',   roles: ['tyre_fl','tyre_fr','tyre_rl','tyre_rr'] },
  { key: 'other',    label: 'Other',    roles: ['engine_bay'] },
]

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
  const [activeTab, setActiveTab] = useState<TabKey>('exterior')

  // Enhanced OCR states
  const [ocrScanning, setOcrScanning] = useState(false)
  const [lastOcrResult, setLastOcrResult] = useState<{
    vin: string | null
    confidence: number
    candidates: string[]
    valid: boolean
    timestamp: number
  } | null>(null)

  function absUrl(u?: string) {
    if (!u) return ''
    return /^https?:\/\//i.test(u) ? u : serverOrigin() + u
  }

  async function load() {
    setError(null); setLoading(true)
    try {
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

  const presentByRole = useMemo(() => {
    const m = new Map<ImageRole, PhotoItem>()
    photos.forEach(p => m.set(p.role, p))
    return m
  }, [photos])
  
  const missingSet = useMemo(() => new Set(chk?.checklist.missing || []), [chk]);

  const missingCountByTab = useMemo(() => {
    const map = new Map<TabKey, number>();
    for (const t of TABS) {
      const count = t.roles.reduce((acc, r) => acc + (missingSet.has(r) ? 1 : 0), 0);
      map.set(t.key, count);
    }
    return map;
  }, [missingSet]);

  const allRolesCaptured = chk
    ? chk.checklist.presentCount >= chk.checklist.requiredCount && chk.checklist.requiredCount > 0
    : false;

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

  // Enhanced file handling with OCR integration
  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file || !activeRole) return
    
    setUploading(activeRole)
    try {
      // Check if this photo type commonly contains VINs and offer OCR
      const canScanVin = ROLE_GUIDE[activeRole]?.canScanVin
      if (canScanVin && !isSealed) {
        const shouldOcr = confirm('This photo may contain a visible VIN. Scan for VIN to verify vehicle identity?')
        if (shouldOcr) {
          try {
            setOcrScanning(true)
            const result = await ocrVinFromImage(file, {
              compress: true,
              onProgress: (stage) => console.log(`OCR ${stage}...`)
            })
            
            if (result.vin) {
              const formatted = formatVin(result.vin)
              setLastOcrResult({
                vin: formatted,
                confidence: result.confidence,
                candidates: result.candidates,
                valid: result.vinValid,
                timestamp: Date.now()
              })
              
              // Show results after upload
              setTimeout(() => {
                const matches = formatted === vin
                const message = result.vinValid 
                  ? `VIN detected: ${formatted}\nConfidence: ${result.confidence.toFixed(1)}%\n\n${
                      matches ? '✓ Matches expected VIN' : '⚠ Does NOT match expected VIN'
                    }\nExpected: ${vin}`
                  : `VIN candidate: ${formatted}\n(Invalid check digit)\nConfidence: ${result.confidence.toFixed(1)}%\n\nExpected: ${vin}`
                
                alert(message)
                
                if (!matches) {
                  const useDetected = confirm(`Detected VIN differs from expected!\n\nDetected: ${formatted}\nExpected: ${vin}\n\nUse detected VIN instead?`)
                  if (useDetected && result.vinValid) {
                    // Could redirect to correct VIN page, but keeping simple for now
                    console.log('User chose to use detected VIN:', formatted)
                  }
                }
              }, 1000)
            } else {
              console.log('No VIN found in', activeRole, 'photo')
            }
          } catch (ocrError: any) {
            console.warn('OCR failed:', ocrError.message)
          } finally {
            setOcrScanning(false)
          }
        }
      }

      // Regular photo upload
      await uploadPhotoDev(vin, activeRole, file)
      await load()
    } catch (err: any) {
      alert('Upload failed: ' + (err?.message || String(err)))
    } finally {
      setUploading(null)
      setActiveRole('')
      e.target.value = ''
    }
  }

  // Standalone VIN scanning from any photo
  async function scanVinFromPhoto() {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'image/*'
    input.capture = 'environment'
    
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0]
      if (!file) return
      
      try {
        setOcrScanning(true)
        const result = await ocrVinFromImage(file, {
          compress: true,
          onProgress: (stage) => console.log(`VIN OCR ${stage}...`)
        })
        
        setLastOcrResult({
          vin: result.vin,
          confidence: result.confidence,
          candidates: result.candidates,
          valid: result.vinValid || false,
          timestamp: Date.now()
        })
        
        if (result.vin) {
          const formatted = formatVin(result.vin)
          const matches = formatted === vin
          
          const message = `VIN Scan Result:\n\n${formatted}\n\nConfidence: ${result.confidence.toFixed(1)}%\nValid: ${result.vinValid ? 'Yes' : 'No'}\n\n${
            matches 
              ? '✓ Matches expected VIN!' 
              : `⚠ Does NOT match!\n\nExpected: ${vin}\nDetected: ${formatted}`
          }`
          
          alert(message)
        } else {
          const message = result.candidates.length > 0
            ? `No valid VIN found.\n\nCandidates detected:\n${result.candidates.slice(0, 3).join('\n')}\n\nTips:\n• Try windshield VIN plate\n• Improve lighting\n• Get closer to VIN label`
            : `No VIN detected.\n\nTips for better results:\n• Look for VIN on windshield (driver side)\n• Check dashboard near steering wheel\n• Try engine bay VIN plate\n• Ensure good lighting\n• Hold camera steady`
          
          alert(message)
        }
      } catch (error: any) {
        alert(`VIN scanning failed: ${error.message}`)
        setLastOcrResult(null)
      } finally {
        setOcrScanning(false)
      }
    }
    
    input.click()
  }

  // Enhanced guidance modal with VIN scanning option
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
    const canScanVin = g?.canScanVin && !isSealed;
    
    return (
      <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4"
          role="dialog" aria-modal="true" onClick={onCancel}>
        <div className="w-full sm:max-w-lg bg-white rounded-t-2xl sm:rounded-2xl shadow-xl overflow-hidden"
            onClick={e => e.stopPropagation()}>
          <div className="p-4 border-b border-slate-200">
            <div className="text-sm font-semibold text-slate-800">{g?.title || role.replace(/_/g,' ')}</div>
            <div className="text-xs text-slate-500 mt-1">{g?.hint}</div>
            {canScanVin && (
              <div className="mt-3 text-xs text-blue-600 bg-blue-50 rounded-lg p-2 border border-blue-200">
                💡 VIN often visible in this area - we can scan it for verification!
              </div>
            )}
          </div>
          <div className="aspect-video w-full bg-slate-100">
            <img 
              src={g?.img} 
              alt={g?.title} 
              className="w-full h-full object-cover" 
              onError={(e:any)=>{ e.currentTarget.style.display='none'; }} 
            />
          </div>
          <div className="p-4 space-y-2">
            <button onClick={onProceed}
                    className="w-full rounded-xl bg-teal-600 hover:bg-teal-700 text-white py-3 text-sm font-medium transition-colors">
              📸 Take {g?.title} Photo
            </button>
            {canScanVin && (
              <button 
                onClick={() => {
                  onCancel();
                  scanVinFromPhoto();
                }}
                className="w-full rounded-xl bg-blue-600 hover:bg-blue-700 text-white py-2 text-sm font-medium transition-colors">
                🔍 Scan VIN Only
              </button>
            )}
            <button onClick={onCancel}
                    className="w-full rounded-xl border border-slate-300 bg-white text-slate-700 py-2 text-sm transition-colors hover:bg-slate-50">
              Cancel
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Enhanced header with VIN validation and scan option */}
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <h2 className="text-lg font-semibold text-slate-800">
              VIN: <span className="font-mono text-base">{vin}</span>
            </h2>
            <div className="flex items-center gap-2 mt-1">
              <div className={`w-2 h-2 rounded-full ${isValidVin(vin) ? 'bg-green-500' : 'bg-yellow-500'}`} />
              <span className="text-xs text-slate-600">
                {isValidVin(vin) ? 'Valid VIN format' : 'Invalid check digit'}
                {vin.length !== 17 && ` • ${vin.length}/17 chars`}
              </span>
            </div>
            
            {/* Recent OCR result display */}
            {lastOcrResult && (
              <div className={`mt-2 text-xs px-2 py-1 rounded-md border ${
                lastOcrResult.valid && lastOcrResult.vin === vin
                  ? 'bg-green-50 text-green-700 border-green-200'
                  : 'bg-yellow-50 text-yellow-700 border-yellow-200'
              }`}>
                <div className="flex items-center gap-1">
                  <Zap className="w-3 h-3" />
                  <span>Last scan: {lastOcrResult.vin || 'No VIN found'} ({lastOcrResult.confidence.toFixed(0)}%)</span>
                  {lastOcrResult.vin === vin && <CheckCircle2 className="w-3 h-3" />}
                </div>
              </div>
            )}
          </div>
          
          {/* VIN scanning button */}
          <button
            onClick={scanVinFromPhoto}
            disabled={ocrScanning || isSealed}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium disabled:opacity-50 transition-colors"
          >
            {ocrScanning ? (
              <>
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                Scanning...
              </>
            ) : (
              <>
                <Scan className="w-4 h-4" />
                Verify VIN
              </>
            )}
          </button>
        </div>
      </div>

      {loading && <div className="text-slate-600">Loading checklist...</div>}
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

          {/* Required photos with enhanced tabs */}
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

            {/* Tabs */}
            <div className="mb-3 flex gap-2 overflow-x-auto no-scrollbar">
              {TABS.map(t => {
                const missing = missingCountByTab.get(t.key) || 0;
                const isActive = activeTab === t.key;
                return (
                  <button
                    key={t.key}
                    onClick={() => setActiveTab(t.key)}
                    className={`relative inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-sm border transition-colors
                      ${isActive ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'}
                    `}
                  >
                    <span className="font-medium">{t.label}</span>
                    {missing > 0 ? (
                      <span className="inline-flex items-center justify-center min-w-[1.25rem] h-5 text-[11px] rounded-full bg-rose-100 text-rose-700 border border-rose-200 px-1">
                        {missing}
                      </span>
                    ) : (
                      <span className="inline-flex items-center justify-center min-w-[1.25rem] h-5 text-[11px] rounded-full bg-emerald-100 text-emerald-700 border border-emerald-200 px-1">
                        ✓
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            {chk.checklist.requiredCount ? (
              <>
                <div className="grid grid-cols-3 gap-2">
                  {TABS.find(t => t.key === activeTab)!.roles.map((role) => {
                    const existing = presentByRole.get(role);
                    const disabled = isSealed || Boolean(uploading);
                    const hasPhoto = !!existing?.url || !!existing?.object_key;
                    const src = existing?.url ?? (existing?.object_key ? `/uploads/${existing.object_key}` : undefined);
                    const canScanVin = ROLE_GUIDE[role]?.canScanVin;

                    return (
                      <button
                        key={role}
                        onClick={() => choosePhoto(role)}
                        disabled={disabled}
                        className={`aspect-square rounded-lg border relative overflow-hidden active:scale-[.99] transition-transform
                          ${hasPhoto ? 'bg-white border-slate-200' : 'bg-slate-50 border-slate-200'}
                          ${disabled ? 'opacity-60 cursor-not-allowed' : 'hover:border-slate-300'}
                        `}
                      >
                        {hasPhoto && src ? (
                          <>
                            <img src={absUrl(src)} alt={role} className="w-full h-full object-cover" />
                            <span className="absolute bottom-1 left-1 right-1 text-[10px] bg-black/70 text-white rounded px-1">
                              {rolePretty(role)} — Replace
                            </span>
                            {canScanVin && (
                              <span className="absolute top-1 left-1 bg-blue-600 text-white rounded p-1">
                                <Eye className="w-3 h-3" />
                              </span>
                            )}
                          </>
                        ) : (
                          <div className="w-full h-full grid place-items-center text-[11px] text-slate-700 px-2 text-center">
                            <div className="space-y-1">
                              <Camera className="w-6 h-6 text-slate-500 mx-auto" />
                              <div>{rolePretty(role)}</div>
                              {canScanVin && (
                                <div className="text-[9px] text-blue-600">VIN area</div>
                              )}
                            </div>
                          </div>
                        )}

                        {/* Missing indicator */}
                        {missingSet.has(role) && (
                          <span className="absolute top-1 right-1 inline-flex items-center justify-center w-5 h-5 rounded-full bg-rose-100 text-rose-700 border border-rose-200 text-[10px]">!</span>
                        )}
                      </button>
                    );
                  })}
                </div>

                {allRolesCaptured && (
                  <div className="text-center text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg p-3 mt-3">
                    <Shield className="w-4 h-4 inline-block mr-1" />
                    All required photos captured ✓
                  </div>
                )}
              </>
            ) : (
              <div className="text-sm text-slate-600">
                No required roles set. Tap <b>Seed defaults</b> to create the checklist.
              </div>
            )}

            {/* File input and modal */}
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

            {/* Upload progress */}
            {(uploading || ocrScanning) && (
              <div className="mt-2 text-xs text-slate-600 inline-flex items-center gap-2">
                <div className="w-4 h-4 border-2 border-slate-400 border-t-transparent rounded-full animate-spin" />
                {ocrScanning ? 'Reading VIN from photo...' : `${rolePretty(uploading!)}: uploading...`}
              </div>
            )}
          </div>

          {/* Details: DEKRA + Odometer */}
          <div className="rounded-xl border border-slate-200 bg-white p-3">
            <div className="text-sm font-semibold text-slate-700 mb-2">Details</div>

            {/* DEKRA link */}
            <div className="mb-3">
              <label className="block text-xs text-slate-500 mb-1">DEKRA link (https://...)</label>
              <div className="flex gap-2">
                <input
                  value={dekraUrlInput}
                  onChange={e => setDekraUrlInput(e.target.value)}
                  placeholder="https://dekra.example/report/123"
                  className="flex-1 border border-slate-300 rounded-lg px-3 py-2 text-sm"
                  disabled={isSealed || saving === 'dekra'}
                />
                <button
                  className="px-3 rounded-lg bg-slate-800 text-white text-sm disabled:opacity-50 transition-colors hover:bg-slate-700"
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
                  {saving === 'dekra' ? 'Saving...' : 'Save'}
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
                  className="px-3 rounded-lg bg-slate-800 text-white text-sm disabled:opacity-50 transition-colors hover:bg-slate-700"
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
                  {saving === 'odo' ? 'Saving...' : 'Save'}
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

          {/* Seal action */}
          <button
            disabled={!chk.ready || sealing || isSealed}
            onClick={async () => {
              if (!chk.ready) return
              const ok = confirm('Seal this vehicle passport? Required fields become immutable.')
              if (!ok) return
              try {
                setSealing(true)
                await sealStrict(vin)
                alert('Sealed ✓')
                await load()
              } catch (e: any) {
                alert('Seal failed: ' + (e?.message || String(e)))
              } finally {
                setSealing(false)
              }
            }}
            className={`mt-3 w-full rounded-xl py-3 font-medium transition-colors
              ${isSealed ? 'bg-emerald-600 text-white opacity-70' :
                chk.ready ? 'bg-teal-600 hover:bg-teal-700 text-white' :
                'bg-slate-200 text-slate-500 cursor-not-allowed'}`}
          >
            {isSealed ? 'Sealed ✓' : (sealing ? 'Sealing...' : 'Seal now')}
          </button>
        </>
      )}
    </div>
  )
}