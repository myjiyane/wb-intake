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
  formatVin,
  setTyreDepths as setTyreDepthsApi,
} from '../lib/api'
import type { Checklist, ImageRole } from '../types'
import {
  Camera, RefreshCcw, CheckCircle2, AlertTriangle,
  Link as LinkIcon, Scan, Shield, Eye, Zap, Gauge, Edit3, Clock
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
  dash_odo:          { title: 'Dashboard (Odometer)', hint: 'Focus on odometer display; avoid glare; make digits readable.', img: '/examples/dash_odo.jpg', canScanVin: true },
  engine_bay:        { title: 'Engine Bay', hint: 'Open bonnet; capture bay from above, well-lit. Check for VIN plates.', img: '/examples/engine_bay.jpg', canScanVin: true },
  tyre_fl:           { title: 'Tyre (Front Left)', hint: 'Close-up of tread surface & sidewall (FL).', img: '/examples/tyre_fl.jpg' },
  tyre_fr:           { title: 'Tyre (Front Right)', hint: 'Close-up of tread surface & sidewall (FR).', img: '/examples/tyre_fr.jpg' },
  tyre_rl:           { title: 'Tyre (Rear Left)', hint: 'Close-up of tread surface & sidewall (RL).', img: '/examples/tyre_rl.jpg' },
  tyre_rr:           { title: 'Tyre (Rear Right)', hint: 'Close-up of tread surface & sidewall (RR).', img: '/examples/tyre_rr.jpg' },
}

type TabKey = 'exterior' | 'interior' | 'wheels' | 'other'

const TABS: { key: TabKey; label: string; roles: ImageRole[] }[] = [
  { key: 'exterior', label: 'Exterior', roles: ['exterior_front_34','exterior_rear_34','left_side','right_side'] },
  { key: 'interior', label: 'Interior', roles: ['interior_front','interior_rear'] },
  { key: 'wheels',   label: 'Wheels',   roles: ['tyre_fl','tyre_fr','tyre_rl','tyre_rr'] },
  { key: 'other',    label: 'Other',    roles: ['engine_bay'] },
]

type PhotoItem = { role: ImageRole; url?: string; object_key?: string }
type PassportRecord = {
  draft?: { 
    images?: { items?: PhotoItem[] }
    tyres_mm?: {
      fl?: number | null
      fr?: number | null
      rl?: number | null
      rr?: number | null
    }
    dekra?: {
      url?: string
      inspection_ts?: string
      site?: string
    }
  }
  sealed?: { 
    images?: { items?: PhotoItem[] }
    tyres_mm?: {
      fl?: number | null
      fr?: number | null
      rl?: number | null
      rr?: number | null
    }
    dekra?: {
      url?: string
      inspection_ts?: string
      site?: string
    }
  }
}

interface OdometerReading {
  km: number | null
  confidence: number
  rawText: string
  photo?: string
  timestamp: number
  manuallyAdjusted: boolean
  adjustmentReason?: string
}

type TyreDepths = { fl: number | ''; fr: number | ''; rl: number | ''; rr: number | '' }

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
  const odometerFileRef = useRef<HTMLInputElement | null>(null)
  const [activeRole, setActiveRole] = useState<ImageRole | ''>('')

  const [dekraUrlInput, setDekraUrlInput] = useState('')
  const [saving, setSaving] = useState<'dekra'|'odo'|'tyres'|null>(null)

  const [guideRole, setGuideRole] = useState<ImageRole | null>(null)
  const [activeTab, setActiveTab] = useState<TabKey>('exterior')

  const [dekraUrl, setDekraUrl] = useState<string>('')

  // Enhanced OCR states
  const [ocrScanning, setOcrScanning] = useState(false)
  const [lastVinScan, setLastVinScan] = useState<{
    vin: string | null
    confidence: number
    candidates: string[]
    valid: boolean
    timestamp: number
  } | null>(null)

  // Odometer-specific states
  const [odometerReading, setOdometerReading] = useState<OdometerReading | null>(null)
  const [odometerInput, setOdometerInput] = useState<number | ''>('')
  const [odometerJustification, setOdometerJustification] = useState('')
  const [odometerScanning, setOdometerScanning] = useState(false)

  // Tyre depths (required by this screen)
  const [tyreDepths, setTyreDepths] = useState<TyreDepths>({ fl: '', fr: '', rl: '', rr: '' })

  // Validation for required tyre fields
  const allTyreFieldsCompleted = useMemo(() => {
    const { fl, fr, rl, rr } = tyreDepths;
    return fl !== '' && fr !== '' && rl !== '' && rr !== '' &&
           typeof fl === 'number' && fl >= 0 && fl <= 12 &&
           typeof fr === 'number' && fr >= 0 && fr <= 12 &&
           typeof rl === 'number' && rl >= 0 && rl <= 12 &&
           typeof rr === 'number' && rr >= 0 && rr <= 12;
  }, [tyreDepths]);

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

      // Populate tyre depths from saved data
      const savedTyres = rec.sealed?.tyres_mm || rec.draft?.tyres_mm
      if (savedTyres) {
        setTyreDepths({
          fl: savedTyres.fl ?? '',
          fr: savedTyres.fr ?? '',
          rl: savedTyres.rl ?? '',
          rr: savedTyres.rr ?? '',
        })
      }

      // Populate DEKRA URL from saved data
      const savedDekraUrl = rec.sealed?.dekra?.url || rec.draft?.dekra?.url
      if (savedDekraUrl) {
        setDekraUrl(savedDekraUrl)
      }
      
    } catch (e: any) {
      setError(e?.message || String(e))
    } finally {
      setLoading(false)
    }
  }

  // Extract odometer reading from OCR text
  function extractOdometerFromText(text: string): number | null {
    const patterns = [
      /(?:odometer|mileage|miles|km|kilometers)[\s:]*([0-9]{3,6})/gi,
      /\b([0-9]{3,6})\s*(?:km|miles|mi)\b/gi,
      /\b([0-9]{1,3}[,.]?[0-9]{3,6})\b/g
    ]
    const candidates: number[] = []
    for (const pattern of patterns) {
      const matches = text.matchAll(pattern)
      for (const match of matches) {
        const numStr = (match[1] || '').replace(/[,.](?=\d{3})/g, '')
        const num = parseInt(numStr, 10)
        if (!Number.isNaN(num) && num >= 100 && num <= 999999) {
          candidates.push(num)
        }
      }
    }
    return candidates.length > 0 ? Math.max(...candidates) : null
  }
   
  function getTyreCondition(depth: number): { condition: string; color: string; bgColor: string } {
    if (depth >= 8) return { condition: 'New', color: 'text-green-700', bgColor: 'bg-green-100 border-green-300' }
    if (depth >= 4) return { condition: 'Good', color: 'text-green-600', bgColor: 'bg-green-50 border-green-200' }
    if (depth >= 2) return { condition: 'Fair', color: 'text-yellow-600', bgColor: 'bg-yellow-50 border-yellow-200' }
    return { condition: 'Replace Required', color: 'text-red-600', bgColor: 'bg-red-50 border-red-200' }
  }


  function TyreInputField({ 
    label, 
    position, 
    value, 
    onChange, 
    disabled 
  }: {
    label: string
    position: 'fl' | 'fr' | 'rl' | 'rr'
    value: number | ''
    onChange: (value: number | '') => void
    disabled: boolean
  }) {
    const isEmpty = value === null || value === undefined || value === ''
    const condition = typeof value === 'number' ? getTyreCondition(value) : null

    return (
      <div className="space-y-2">
        <label className="block text-sm font-medium text-slate-700">
          {label} <span className="text-red-500">*</span>
        </label>
        <div className="relative">
          <input
            type="number"
            min="0"
            max="12"
            step="0.1"
            value={value || ''}
            onChange={e => onChange(e.target.value ? Number(e.target.value) : '')}
            placeholder="Enter depth"
            className={`w-full border rounded-lg px-3 py-3 text-sm pr-8 ${
              isEmpty 
                ? 'border-red-300 bg-red-50' 
                : condition 
                  ? `border-green-300 ${condition.bgColor}`
                  : 'border-green-300 bg-green-50'
            }`}
            disabled={disabled}
            required
          />
          <span className="absolute right-3 top-1/2 transform -translate-y-1/2 text-xs text-slate-500">mm</span>
        </div>
      </div>
    )
  }
  
  async function captureOdometer() {
    odometerFileRef.current?.click()
  }

  
  async function onOdometerFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    try {
      setOdometerScanning(true)
      const result = await ocrVinFromImage(file, {
        compress: true,
        onProgress: (stage: string) => console.log(`Odometer OCR ${stage}...`)
      })
      const extractedKm = extractOdometerFromText(result.fullText || '')
      const photoUrl = URL.createObjectURL(file)
      const reading: OdometerReading = {
        km: extractedKm,
        confidence: result.confidence,
        rawText: result.fullText || '',
        photo: photoUrl,
        timestamp: Date.now(),
        manuallyAdjusted: false
      }
      setOdometerReading(reading)
      setOdometerInput(extractedKm || '')
      setOdometerJustification('')

      // Also upload the dash_odo photo to the regular photo collection
      setUploading('dash_odo')
      try {
        await uploadPhotoDev(vin, 'dash_odo', file)
        await load()
      } catch (err) {
        console.warn('Failed to upload odometer photo to collection:', err)
      } finally {
        setUploading(null)
      }

      e.target.value = ''
    } catch (error: any) {
      alert(`Odometer scanning failed: ${error.message}`)
    } finally {
      setOdometerScanning(false)
    }
  }

  // Handle manual odometer adjustment
  function handleOdometerAdjustment(value: number | string) {
    const numValue = typeof value === 'string' ? (value === '' ? '' : Number(value)) : value
    setOdometerInput(numValue)
    if (odometerReading && numValue !== odometerReading.km) {
      setOdometerReading({ ...odometerReading, manuallyAdjusted: true })
    }
  }

  // Save odometer reading
  async function saveOdometer() {
    const finalReading = typeof odometerInput === 'number' ? odometerInput : null
    if (!finalReading || finalReading < 0) {
      alert('Please enter a valid odometer reading')
      return
    }
    if (odometerReading?.manuallyAdjusted) {
      console.log('Odometer Manual Adjustment Logged:', {
        originalExtracted: odometerReading.km,
        adjustedTo: finalReading,
        ocrConfidence: odometerReading.confidence,
        rawOcrText: odometerReading.rawText,
        justification: odometerJustification || 'No justification provided',
        timestamp: new Date().toISOString(),
        vin,
        photo: odometerReading.photo ? 'attached' : 'none'
      })
    }
    try {
      setSaving('odo')
      await setOdometer(vin, finalReading, 'ocr')
      await load()
    } catch (e: any) {
      alert(e?.message || String(e))
    } finally {
      setSaving(null)
    }
  }

  // Tyre depths save
  async function saveTyreDepths() {
    const payload = {
      fl: typeof tyreDepths.fl === 'number' ? tyreDepths.fl : null,
      fr: typeof tyreDepths.fr === 'number' ? tyreDepths.fr : null,
      rl: typeof tyreDepths.rl === 'number' ? tyreDepths.rl : null,
      rr: typeof tyreDepths.rr === 'number' ? tyreDepths.rr : null,
    }
    try {
      setSaving('tyres')
      await setTyreDepthsApi(vin, payload)
      await load()
    } catch (e: any) {
      alert(e?.message || String(e))
    } finally {
      setSaving(null)
    }
  }

  useEffect(() => {
    if (!guideRole) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [guideRole])

  useEffect(() => { load() }, [vin])

  const presentByRole = useMemo(() => {
    const m = new Map<ImageRole, PhotoItem>()
    photos.forEach(p => m.set(p.role, p))
    return m
  }, [photos])

  const missingSet = useMemo(() => new Set(chk?.checklist.missing || []), [chk])

  const missingCountByTab = useMemo(() => {
    const map = new Map<TabKey, number>()
    for (const t of TABS) {
      const count = t.roles.reduce((acc, r) => acc + (missingSet.has(r) ? 1 : 0), 0)
      map.set(t.key, count)
    }
    return map
  }, [missingSet])

  const allRolesCaptured = chk
    ? chk.checklist.presentCount >= chk.checklist.requiredCount && chk.checklist.requiredCount > 0
    : false

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

  // Enhanced file handling with VIN scanning for applicable photos
  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file || !activeRole) return

    setUploading(activeRole)
    try {
      const canScanVin = ROLE_GUIDE[activeRole]?.canScanVin
      if (canScanVin && !isSealed) {
        const shouldOcr = confirm('This photo may contain a visible VIN. Scan for verification?')
        if (shouldOcr) {
          try {
            setOcrScanning(true)
            const result = await ocrVinFromImage(file, {
              compress: true,
              onProgress: (stage: string) => console.log(`VIN OCR ${stage}...`)
            })
            if (result.vin) {
              const formatted = formatVin(result.vin)
              setLastVinScan({
                vin: formatted,
                confidence: result.confidence,
                candidates: result.candidates,
                valid: result.vinValid,
                timestamp: Date.now()
              })
              setTimeout(() => {
                const matches = formatted === vin
                const message = `VIN detected: ${formatted}\nConfidence: ${result.confidence.toFixed(1)}%\n\n${
                  matches ? '✓ Matches expected VIN' : '⚠ Does NOT match expected VIN'
                }\nExpected: ${vin}`
                alert(message)
              }, 1000)
            }
          } catch (ocrError: any) {
            console.warn('VIN OCR failed:', ocrError.message)
          } finally {
            setOcrScanning(false)
          }
        }
      }

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

  // Standalone VIN verification
  async function scanVinFromPhoto() {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'image/*'
    ;(input as any).capture = 'environment'
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0]
      if (!file) return
      try {
        setOcrScanning(true)
        const result = await ocrVinFromImage(file, {
          compress: true,
          onProgress: (stage: string) => console.log(`VIN verification ${stage}...`)
        })
        setLastVinScan({
          vin: result.vin,
          confidence: result.confidence,
          candidates: result.candidates,
          valid: result.vinValid || false,
          timestamp: Date.now()
        })
        const message = result.vin
          ? `VIN: ${result.vin}\nConfidence: ${result.confidence.toFixed(1)}%\nValid: ${result.vinValid ? 'Yes' : 'No'}\n\n${
              result.vin === vin ? '✓ Matches expected!' : '⚠ Does NOT match expected VIN'
            }`
          : 'No VIN detected. Try windshield, dashboard, or engine bay VIN plate.'
        alert(message)
      } catch (error: any) {
        alert(`VIN scanning failed: ${error.message}`)
      } finally {
        setOcrScanning(false)
      }
    }
    input.click()
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
    const g = ROLE_GUIDE[role]
    const canScanVin = g?.canScanVin && !isSealed
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
                    className="w-full rounded-xl bg-teal-600 hover:bg-teal-700 text-white py-3 text-sm font-medium">
              📷 Take {g?.title} Photo
            </button>
            {canScanVin && (
              <button
                onClick={() => {
                  onCancel()
                  scanVinFromPhoto()
                }}
                className="w-full rounded-xl bg-blue-600 hover:bg-blue-700 text-white py-2 text-sm font-medium">
                🔍 Scan VIN Only
              </button>
            )}
            <button onClick={onCancel}
                    className="w-full rounded-xl border border-slate-300 bg-white text-slate-700 py-2 text-sm">
              Cancel
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Enhanced header with VIN status */}
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
              </span>
            </div>

            {lastVinScan && (
              <div className={`mt-2 text-xs px-2 py-1 rounded-md border flex items-center gap-2 ${
                lastVinScan.valid && lastVinScan.vin === vin
                  ? 'bg-green-50 text-green-700 border-green-200'
                  : 'bg-yellow-50 text-yellow-700 border-yellow-200'
              }`}>
                <Zap className="w-3 h-3" />
                <span>Last scan: {lastVinScan.vin || 'No VIN'} ({lastVinScan.confidence.toFixed(0)}%)</span>
                {lastVinScan.vin === vin && <CheckCircle2 className="w-3 h-3" />}
              </div>
            )}
          </div>

          <button
            onClick={scanVinFromPhoto}
            disabled={ocrScanning || isSealed}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium disabled:opacity-50"
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
                Lot Site <span className="font-mono">{chk.lot_id || lot}</span>
              </div>
              <div className="text-sm">
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
                <span>Report link: <b>{chk.checklist.hasDekra ? 'Present' : 'Missing'}</b></span>
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
 
          {/* Odometer Reading */}
          <div className="rounded-xl border-2 border-emerald-200 bg-emerald-50/50 p-4 space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 bg-emerald-600 rounded-lg flex items-center justify-center">
                <Gauge className="w-4 h-4 text-white" />
              </div>
              <div>
                <h3 className="font-semibold text-slate-800">Critical: Odometer Reading</h3>
                <p className="text-xs text-slate-600">Required for accurate vehicle valuation</p>
              </div>
            </div>

            {!odometerReading ? (
              <div className="space-y-3">
                <button
                  onClick={captureOdometer}
                  disabled={odometerScanning || isSealed}
                  className="w-full bg-emerald-600 hover:bg-emerald-700 text-white py-4 px-4 rounded-xl font-semibold 
                            flex items-center justify-center gap-3 disabled:opacity-50"
                >
                  {odometerScanning ? (
                    <>
                      <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      Reading odometer...
                    </>
                  ) : (
                    <>
                      <Camera className="w-5 h-5" />
                      <div className="text-center">
                        <div>CAPTURE ODOMETER</div>
                        <div className="text-xs opacity-90 font-normal">Dashboard display</div>
                      </div>
                    </>
                  )}
                </button>

                <div className="text-xs text-slate-500 text-center">
                  Automatic reading extraction prevents manual entry errors
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                {/* Captured photo and extracted reading */}
                <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
                  {odometerReading.photo && (
                    <img
                      src={odometerReading.photo}
                      alt="Odometer"
                      className="w-full h-32 object-cover"
                    />
                  )}

                  <div className="p-3 space-y-2">
                    <div className="flex items-center justify-between text-xs text-slate-600">
                      <span>Extracted Reading:</span>
                      <span className="flex items-center gap-1">
                        <Eye className="w-3 h-3" />
                        {odometerReading.confidence.toFixed(0)}% confidence
                      </span>
                    </div>

                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        value={odometerInput}
                        onChange={e => handleOdometerAdjustment(e.target.value)}
                        placeholder="Verify/correct reading"
                        className={`flex-1 border rounded-lg px-3 py-2 text-lg font-mono
                          ${odometerReading.manuallyAdjusted ? 'border-amber-300 bg-amber-50 ring-2 ring-amber-200' : 'border-slate-300'}
                        `}
                        disabled={isSealed}
                        min={0}
                        max={999999}
                      />
                      <span className="text-sm text-slate-600 font-medium">km</span>
                    </div>

                    {odometerReading.manuallyAdjusted && (
                      <div className="bg-amber-50 border border-amber-200 rounded-lg p-2">
                        <div className="flex items-start gap-2">
                          <Edit3 className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
                          <div className="text-xs text-amber-700">
                            <div className="font-medium">Manual adjustment detected</div>
                            <div className="mt-1">
                              Original: <span className="font-mono">{odometerReading.km || 'Not detected'}</span><br/>
                              Adjusted: <span className="font-mono">{odometerInput}</span>
                            </div>
                          </div>
                        </div>

                        <textarea
                          value={odometerJustification}
                          onChange={e => setOdometerJustification(e.target.value)}
                          placeholder="Why was the reading manually adjusted? (e.g., display unclear, partial obstruction)"
                          className="w-full mt-2 border border-amber-300 rounded px-2 py-1 text-xs bg-white"
                          rows={2}
                          disabled={isSealed}
                        />
                      </div>
                    )}

                    <div className="flex gap-2">
                      <button
                        onClick={saveOdometer}
                        disabled={saving === 'odo' || isSealed || !odometerInput}
                        className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white py-2 px-3 rounded-lg text-sm font-medium disabled:opacity-50"
                      >
                        {saving === 'odo' ? 'Saving...' : 'Save Reading'}
                      </button>

                      <button
                        onClick={() => {
                          setOdometerReading(null)
                          setOdometerInput('')
                          setOdometerJustification('')
                        }}
                        disabled={isSealed}
                        className="px-3 py-2 border border-slate-300 rounded-lg text-sm hover:bg-slate-50"
                      >
                        Retake
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/*  Tyre Measurements section */}
          <div className="rounded-xl border-2 border-orange-200 bg-orange-50/50 p-4 space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 bg-orange-600 rounded-lg flex items-center justify-center">
                <Gauge className="w-4 h-4 text-white" />
              </div>
              <div>
                <h3 className="font-semibold text-slate-800">Tyre Tread Depths</h3>
                <p className="text-xs text-slate-600">
                  {isSealed ? 'Sealed measurements with condition assessment' : 'Measure with tread depth gauge (mm) - All required'}
                </p>
              </div>
            </div>

            <div className="space-y-4">
              {/* Visual tyre position guide */}
              <div className="bg-white border border-slate-200 rounded-lg p-3">
                <div className="text-xs text-slate-600 mb-2 text-center">Vehicle Position Guide</div>
                <div className="grid grid-cols-2 gap-4 max-w-48 mx-auto">
                  <div className="text-center">
                    <div className="w-16 h-20 bg-slate-800 rounded-lg mx-auto mb-1 flex items-center justify-center">
                      <div className="text-white text-xs font-mono">FL</div>
                    </div>
                    <div className="text-[10px] text-slate-500">Front Left</div>
                  </div>
                  <div className="text-center">
                    <div className="w-16 h-20 bg-slate-800 rounded-lg mx-auto mb-1 flex items-center justify-center">
                      <div className="text-white text-xs font-mono">FR</div>
                    </div>
                    <div className="text-[10px] text-slate-500">Front Right</div>
                  </div>
                  <div className="text-center">
                    <div className="w-16 h-20 bg-slate-600 rounded-lg mx-auto mb-1 flex items-center justify-center">
                      <div className="text-white text-xs font-mono">RL</div>
                    </div>
                    <div className="text-[10px] text-slate-500">Rear Left</div>
                  </div>
                  <div className="text-center">
                    <div className="w-16 h-20 bg-slate-600 rounded-lg mx-auto mb-1 flex items-center justify-center">
                      <div className="text-white text-xs font-mono">RR</div>
                    </div>
                    <div className="text-[10px] text-slate-500">Rear Right</div>
                  </div>
                </div>
              </div>

              {/* Vertical tyre depth input fields with condition display */}
              <div className="space-y-3">
                <TyreInputField
                  label="Front Left Tyre"
                  position="fl"
                  value={tyreDepths.fl}
                  onChange={(value) => setTyreDepths(prev => ({ ...prev, fl: value }))}
                  disabled={isSealed}
                />

                <TyreInputField
                  label="Front Right Tyre"
                  position="fr"
                  value={tyreDepths.fr}
                  onChange={(value) => setTyreDepths(prev => ({ ...prev, fr: value }))}
                  disabled={isSealed}
                />

                <TyreInputField
                  label="Rear Left Tyre"
                  position="rl"
                  value={tyreDepths.rl}
                  onChange={(value) => setTyreDepths(prev => ({ ...prev, rl: value }))}
                  disabled={isSealed}
                />

                <TyreInputField
                  label="Rear Right Tyre"
                  position="rr"
                  value={tyreDepths.rr}
                  onChange={(value) => setTyreDepths(prev => ({ ...prev, rr: value }))}
                  disabled={isSealed}
                />
              </div>

              {/* Overall tyre condition summary for sealed passports */}
              {isSealed && allTyreFieldsCompleted && (
                <div className="bg-white border border-slate-200 rounded-lg p-3">
                  <div className="text-sm font-medium text-slate-700 mb-2">Tyre Condition Summary</div>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    {Object.entries(tyreDepths).map(([pos, depth]) => {
                      if (typeof depth !== 'number') return null
                      const condition = getTyreCondition(depth)
                      const posLabel = { fl: 'Front Left', fr: 'Front Right', rl: 'Rear Left', rr: 'Rear Right' }[pos]
                      return (
                        <div key={pos} className={`flex justify-between items-center p-2 rounded border ${condition.bgColor} ${condition.color}`}>
                          <span className="font-medium">{posLabel}:</span>
                          <span>{depth.toFixed(1)}mm ({condition.condition})</span>
                        </div>
                      )
                    })}
                  </div>
                  
                  {/* Overall assessment */}
                  <div className="mt-3 p-2 bg-slate-50 border border-slate-200 rounded text-xs">
                    <div className="font-medium text-slate-700">Overall Assessment:</div>
                    <div className="text-slate-600">
                      {(() => {
                        const depths = Object.values(tyreDepths).filter(d => typeof d === 'number') as number[]
                        const minDepth = Math.min(...depths)
                        const avgDepth = depths.reduce((sum, d) => sum + d, 0) / depths.length
                        
                        if (minDepth < 2) return '⚠️ Immediate replacement required'
                        if (minDepth < 4) return '⚠️ Replacement recommended soon'
                        if (avgDepth >= 8) return '✅ All tyres in excellent condition'
                        return '✅ All tyres in good condition'
                      })()}
                    </div>
                  </div>
                </div>
              )}

              {/* Progress indicator - only show for unsealed */}
              {!isSealed && (
                <div className="bg-slate-50 border border-slate-200 rounded-lg p-3">
                  <div className="flex items-center justify-between text-xs text-slate-600 mb-1">
                    <span>Progress:</span>
                    <span>{Object.values(tyreDepths).filter(v => v !== null && v !== undefined && v !== '').length}/4 completed</span>
                  </div>
                  <div className="w-full bg-slate-200 rounded-full h-2">
                    <div 
                      className="bg-orange-600 h-2 rounded-full transition-all duration-300"
                      style={{ 
                        width: `${(Object.values(tyreDepths).filter(v => v !== null && v !== undefined && v !== '').length / 4) * 100}%` 
                      }}
                    />
                  </div>
                </div>
              )}

              {/* Quick reference guide */}
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                <div className="text-xs text-blue-700">
                  <div className="font-medium mb-1">Tread Depth Guide:</div>
                  <div className="space-y-1">
                    <div>• <strong>8-12mm:</strong> New tyre</div>
                    <div>• <strong>4-8mm:</strong> Good condition</div>
                    <div>• <strong>2-4mm:</strong> Fair condition</div>
                    <div>• <strong>0-2mm:</strong> Replace required</div>
                  </div>
                </div>
              </div>

              {/* Save button - hide if sealed */}
              {!isSealed && (
                <>
                  <button
                    onClick={saveTyreDepths}
                    disabled={
                      saving === 'tyres' || 
                      !allTyreFieldsCompleted
                    }
                    className={`w-full py-3 px-4 rounded-xl font-medium transition-colors ${
                      allTyreFieldsCompleted && saving !== 'tyres'
                        ? 'bg-orange-600 hover:bg-orange-700 text-white'
                        : 'bg-slate-300 text-slate-500 cursor-not-allowed'
                    }`}
                  >
                    {saving === 'tyres' ? 'Saving...' : 'Save'}
                  </button>

                  {/* Validation message */}
                  {!allTyreFieldsCompleted && (
                    <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg p-2">
                      All tyre measurements are required. Please complete all fields.
                    </div>
                  )}
                </>
              )}

              {/* Sealed status */}
              {isSealed && (
                <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3 text-center">
                  <div className="text-sm text-emerald-700 flex items-center justify-center gap-2">
                    <Shield className="w-4 h-4" />
                    Tyre measurements sealed and validated
                  </div>
                </div>
              )}
            </div>
          </div> 

          {/* Report Link Section */}
          <div className="rounded-xl border border-slate-200 bg-white p-3">
            <div className="text-sm font-semibold text-slate-700 mb-2 flex items-center gap-2">
              <LinkIcon className="w-4 h-4" />
              Report Link
            </div>
            
            {dekraUrl ? (
              <div className="bg-green-50 border border-green-200 rounded-lg p-3">
                <a 
                  href={dekraUrl} 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="text-blue-600 hover:text-blue-800 underline text-sm break-all"
                >
                  {dekraUrl}
                </a>
              </div>
            ) : !isSealed ? (
              <div className="flex gap-2">
                <input
                  value={dekraUrlInput}
                  onChange={e => setDekraUrlInput(e.target.value)}
                  placeholder="https://dekra.example/report/123"
                  className="flex-1 border border-slate-300 rounded-lg px-3 py-2 text-sm"
                  disabled={saving === 'dekra'}
                />
                <button
                  className="px-3 rounded-lg bg-slate-800 text-white text-sm disabled:opacity-50 hover:bg-slate-700"
                  disabled={saving === 'dekra'}
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
            ) : (
              <div className="bg-slate-50 border border-slate-200 rounded-lg p-3">
                <div className="text-sm text-slate-600">
                  No report link available
                </div>
              </div>
            )}
          </div>

          {/* Photo Documentation Section */}
          <div className="rounded-xl border border-slate-200 bg-white p-3">
            <div className="flex items-center justify-between mb-2">
              <div className="text-sm font-semibold text-slate-700">Photo Documentation</div>
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
                const missing = missingCountByTab.get(t.key) || 0
                const isActive = activeTab === t.key
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
                )
              })}
            </div>

            {chk.checklist.requiredCount ? (
              <>
                <div className="grid grid-cols-3 gap-2">
                  {TABS.find(t => t.key === activeTab)!.roles.map((role) => {
                    const existing = presentByRole.get(role)
                    const disabled = isSealed || Boolean(uploading)
                    const hasPhoto = !!existing?.url || !!existing?.object_key
                    const src = existing?.url ?? (existing?.object_key ? `/uploads/${existing.object_key}` : undefined)
                    const canScanVin = ROLE_GUIDE[role]?.canScanVin

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
                    )
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

            {/* File inputs and modal */}
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              {...({ capture: 'environment' } as any)}
              className="hidden"
              onChange={onFile}
            />

            <input
              ref={odometerFileRef}
              type="file"
              accept="image/*"
              {...({ capture: 'environment' } as any)}
              className="hidden"
              onChange={onOdometerFile}
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

            {(uploading || ocrScanning || odometerScanning) && (
              <div className="mt-2 text-xs text-slate-600 inline-flex items-center gap-2">
                <div className="w-4 h-4 border-2 border-slate-400 border-t-transparent rounded-full animate-spin" />
                {ocrScanning ? 'Reading VIN from photo...' :
                 odometerScanning ? 'Processing odometer...' :
                 `${rolePretty(uploading!)}: uploading...`}
              </div>
            )}
          </div>

          {/* Ready / Sealed status */}
          <div className={`rounded-xl p-3 border ${
            isSealed
              ? 'border-emerald-300 bg-emerald-50 text-emerald-800'
              : (chk.ready ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-amber-200 bg-amber-50 text-amber-800')}`}>
            <div className="flex items-center gap-2">
              {isSealed ? <Shield className="w-4 h-4" /> : <Clock className="w-4 h-4" />}
              <span>{isSealed ? 'Sealed ✓' : (chk.ready ? 'Ready to seal' : 'Not ready to seal yet')}</span>
            </div>
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
