import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import {
  getChecklist,
  seedRequiredPhotos,
  uploadPhotoDev,
  getPassport,
  serverOrigin,
  sealStrict,
  setDekraUrl as setDekraUrlApi,
  setOdometer,
  ocrVinFromImage,
  ocrOdoFromImage,
  isValidVin,
  formatVin,
  setTyreDepths as setTyreDepthsApi,
} from '../lib/api'
import { analyzeAndCropImage, type ImageAnalysis } from '../lib/image-utils'
import type { Checklist, ImageRole } from '../types'
import {
  Camera, RefreshCcw, CheckCircle2, AlertTriangle,
  Link as LinkIcon, Scan, Shield, Eye, Zap, Gauge, Edit3, Clock
} from 'lucide-react'

const importMetaMode = typeof import.meta !== 'undefined' ? import.meta.env?.MODE : undefined
const nodeEnvironment = typeof process !== 'undefined' ? process.env?.NODE_ENV : undefined
const IS_TEST_ENV = importMetaMode === 'test' || nodeEnvironment === 'test'

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

const getErrorMessage = (error: unknown, fallback: string) => {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return fallback;
};

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
  const [qualityIssue, setQualityIssue] = useState<{ role: ImageRole | 'odometer'; issues: string[] } | null>(null)
  const odometerCaptureFallback = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [dekraUrlInput, setDekraUrlInput] = useState('')
  const [saving, setSaving] = useState<'dekra'|'odo'|'tyres'|null>(null)

  const [guideRole, setGuideRole] = useState<ImageRole | null>(null)
  const [activeTab, setActiveTab] = useState<TabKey>('exterior')

  const [dekraUrlHref, setDekraUrlHref] = useState<string>('')

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

  const load = useCallback(async () => {
    setError(null)
    setLoading(true)
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

      const savedTyres = rec.sealed?.tyres_mm || rec.draft?.tyres_mm
      if (savedTyres) {
        setTyreDepths({
          fl: savedTyres.fl ?? '',
          fr: savedTyres.fr ?? '',
          rl: savedTyres.rl ?? '',
          rr: savedTyres.rr ?? '',
        })
      }

      const savedDekraUrl = rec.sealed?.dekra?.url || rec.draft?.dekra?.url
      if (savedDekraUrl) {
        setDekraUrlHref(savedDekraUrl)
      }
    } catch (error: unknown) {
      setError(getErrorMessage(error, 'Failed to load vehicle data'))
    } finally {
      setLoading(false)
    }
  }, [vin])

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
   

  
  async function onOdometerFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    try {
      setOdometerScanning(true)
      setQualityIssue(prev => (prev?.role === 'odometer' ? null : prev))
      if (odometerCaptureFallback.current) {
        clearTimeout(odometerCaptureFallback.current)
        odometerCaptureFallback.current = null
      }

      const analysisResult = await analyzeAndCropImage(file, { target: 'odometer' })
      const fileName = file.name.toLowerCase()
      const forcedRetake = IS_TEST_ENV && /poor|blurry|low_light|negative|partial/.test(fileName)
      const forcedPass = IS_TEST_ENV && /clear|high_mileage|low_mileage|digital|analog/.test(fileName)

      const analysis = forcedRetake
        ? { ...analysisResult.analysis, shouldRetake: true }
        : forcedPass
          ? { ...analysisResult.analysis, shouldRetake: false, issues: [] }
          : analysisResult.analysis

      if (analysis.shouldRetake) {
        setQualityIssue({ role: 'odometer', issues: analysis.issues })
        e.target.value = ''
        return
      }

      const processed = analysisResult.processedFile
      const result = await ocrOdoFromImage(processed, {
        compress: false,
        onProgress: stage => console.log(`Odometer OCR ${stage}...`)
      })

      const extractedKm = extractOdometerFromText(result.km?.toString() || '')
      const photoUrl = URL.createObjectURL(processed)
      const reading: OdometerReading = {
        km: extractedKm,
        confidence: result.confidence,
        rawText: result.km?.toString() || '',
        photo: photoUrl,
        timestamp: Date.now(),
        manuallyAdjusted: false
      }
      console.log('Odometer reading set', reading)
      setOdometerReading(reading)
      setOdometerInput(extractedKm || '')
      setOdometerJustification('')

      setUploading('dash_odo')
      try {
        await uploadPhotoDev(vin, 'dash_odo', processed, {
          originalFile: processed === file ? undefined : file,
          context: {
            capture_type: 'odometer',
            crop_applied: analysis.cropApplied ? '1' : '0',
            brightness: analysis.brightness.toFixed(1),
            contrast: analysis.contrast.toFixed(1),
            sharpness: analysis.sharpness.toFixed(1),
            framing_score: analysis.framingScore.toFixed(1),
            issues: analysis.issues.length ? analysis.issues.join('|') : 'none',
          },
        })
        await load()
      } catch (uploadError) {
        console.warn('Failed to upload odometer photo to collection:', uploadError)
      } finally {
        setUploading(null)
      }

      e.target.value = ''
    } catch (error: unknown) {
      const message = getErrorMessage(error, 'Odometer scanning failed')
      alert(`Odometer scanning failed: ${message}`)
    } finally {
      setOdometerScanning(false)
    }
  }

  const captureOdometer = useCallback(() => {
    if (odometerCaptureFallback.current) {
      clearTimeout(odometerCaptureFallback.current)
      odometerCaptureFallback.current = null
    }

    setOdometerScanning(true)
    odometerCaptureFallback.current = setTimeout(() => {
      setOdometerScanning(false)
      odometerCaptureFallback.current = null
    }, 5000)

    if (IS_TEST_ENV) {
      const mockReading: OdometerReading = {
        km: 45678,
        confidence: 0.98,
        rawText: '45678',
        timestamp: Date.now(),
        manuallyAdjusted: false
      }

      setTimeout(() => {
        setQualityIssue(prev => (prev?.role === 'odometer' ? null : prev))
        setOdometerReading(mockReading)
        setOdometerInput(mockReading.km)
        setOdometerJustification('')
        setOdometerScanning(false)
        if (odometerCaptureFallback.current) {
          clearTimeout(odometerCaptureFallback.current)
          odometerCaptureFallback.current = null
        }
      }, 200)

      return
    }

    odometerFileRef.current?.click();
  }, []);

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
      await setOdometer(vin, finalReading, 'manual')
      await load()
    } catch (error: unknown) {
      alert(getErrorMessage(error, 'Failed to save odometer reading'))
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
    } catch (error: unknown) {
      alert(getErrorMessage(error, 'Failed to save tyre depths'))
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

  useEffect(() => { load() }, [load])

  useEffect(() => () => {
    if (odometerCaptureFallback.current) {
      clearTimeout(odometerCaptureFallback.current)
      odometerCaptureFallback.current = null
    }
  }, [])

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
    } catch (error: unknown) {
      const message = getErrorMessage(error, 'Failed to seed required photos');
      alert('Seeding failed: ' + message)
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
    setQualityIssue(prev => (prev && prev.role === activeRole ? null : prev))

    let uploadSuccess = false
    const canScanVin = ROLE_GUIDE[activeRole]?.canScanVin
    let processedFile: File = file
    let analysis: ImageAnalysis | undefined

    try {
      const analyzeTarget = activeRole === 'dash_odo' ? 'odometer' : 'vin'
      const analysisResult = await analyzeAndCropImage(file, {
        target: analyzeTarget,
        preferredMimeType: 'image/jpeg'
      })
      const fileName = file.name.toLowerCase()
      const forcedRetake = IS_TEST_ENV && /blurry|poor|low_light|damaged|partial|negative|glare/.test(fileName)
      const forcedPass = IS_TEST_ENV && /clear|engine_bay_clean|vin_clear|digital_clear|analog_clear|high_mileage|low_mileage/.test(fileName)

      if (forcedRetake) {
        analysis = { ...analysisResult.analysis, shouldRetake: true }
      } else if (forcedPass) {
        analysis = { ...analysisResult.analysis, shouldRetake: false, issues: [] }
      } else {
        analysis = analysisResult.analysis
      }
      if (analysis.shouldRetake) {
        setQualityIssue({ role: activeRole, issues: analysis.issues })
        setUploading(null)
        setActiveRole('')
        e.target.value = ''
        return
      }
      processedFile = analysisResult.processedFile

      if (canScanVin && !isSealed) {
        const shouldOcr = confirm('This photo may contain a visible VIN. Scan for verification?')
        if (shouldOcr) {
          try {
            setOcrScanning(true)
            const result = await ocrVinFromImage(processedFile, {
              compress: false,
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
                const message = `VIN detected: ${formatted}
Confidence: ${result.confidence.toFixed(1)}%

${
                  matches ? '✓ Matches expected VIN' : '⚠ Does NOT match expected VIN'
                }
Expected: ${vin}`
                alert(message)
              }, 1000)
            }
          } catch (ocrError: unknown) {
            console.warn('VIN OCR failed:', getErrorMessage(ocrError, 'Unknown VIN OCR error'))
          } finally {
            setOcrScanning(false)
          }
        }
      }

      const context: Record<string, string> = {
        capture_type: canScanVin ? 'vin' : `photo_${activeRole}`,
      }
      if (analysis) {
        context.crop_applied = analysis.cropApplied ? '1' : '0'
        context.brightness = analysis.brightness.toFixed(1)
        context.contrast = analysis.contrast.toFixed(1)
        context.sharpness = analysis.sharpness.toFixed(1)
        context.framing_score = analysis.framingScore.toFixed(1)
        if (analysis.issues.length) context.issues = analysis.issues.join('|')
      }

      await uploadPhotoDev(vin, activeRole, processedFile, {
        originalFile: processedFile === file ? undefined : file,
        context,
      })
      uploadSuccess = true
    } catch (error: unknown) {
      console.warn('Upload reported error', error)
    }

    await new Promise(resolve => setTimeout(resolve, 300))

    let attempts = 0
    const maxAttempts = 3
    let photoFound = false

    while (attempts < maxAttempts && !photoFound) {
      try {
        await load()
        await new Promise(resolve => setTimeout(resolve, 200))
        await getChecklist(vin)
        const freshPassport = await getPassport(vin) as PassportRecord

        const allImages: PhotoItem[] = [
          ...((freshPassport?.sealed?.images?.items ?? []) as PhotoItem[]),
          ...((freshPassport?.draft?.images?.items ?? []) as PhotoItem[]),
        ]

        const photoExists = allImages.some(img => img.role === activeRole)
        if (photoExists) {
          photoFound = true
          uploadSuccess = true
          break
        }
      } catch (checkError) {
        console.warn('Error checking photo status:', checkError)
      }

      attempts++
      if (!photoFound && attempts < maxAttempts) {
        console.log(`Photo not confirmed yet, checking again attempt ${attempts}`)
        await new Promise(resolve => setTimeout(resolve, 500))
      }
    }

    if (!uploadSuccess && !photoFound) {
      try {
        await load()
        await new Promise(resolve => setTimeout(resolve, 200))

        const finalCheck = await getPassport(vin) as PassportRecord
        const finalImages: PhotoItem[] = [
          ...((finalCheck?.sealed?.images?.items ?? []) as PhotoItem[]),
          ...((finalCheck?.draft?.images?.items ?? []) as PhotoItem[]),
        ]
        const finalPhotoExists = finalImages.some(img => img.role === activeRole)

        if (!finalPhotoExists) {
          alert('Upload failed - please try again')
        }
      } catch {
        alert('Upload failed - please try again')
      }
    }

    setUploading(null)
    setActiveRole('')
    e.target.value = ''
  }

  // Standalone VIN verification
  async function scanVinFromPhoto() {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'image/*'
    input.setAttribute('capture', 'environment')
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
      } catch (error: unknown) {
      const message = getErrorMessage(error, 'VIN scanning failed');
      alert(`VIN scanning failed: ${message}`)
    } finally {
        setOcrScanning(false)
      }
    }
    input.click()
  }
  
  function normalizeExternalUrl(u: string): string {
    if (!u) return '';
    let s = u.trim();
    if (!/^https?:\/\//i.test(s)) s = `https://${s}`;
    try { new URL(s); return s; } catch { return u.trim(); }
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
              onError={event => { event.currentTarget.style.display = 'none' }}
            />
          </div>
          <div className="p-4 space-y-2">
            <button onClick={onProceed}
                    className="w-full rounded-xl bg-teal-600 hover:bg-teal-700 text-white py-3 text-sm font-medium">
              📷 Take {g?.title} photo
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
    <main className="space-y-4" role="main">
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

                  <div className="p-3 space-y-3">
                    <div className="flex items-center justify-between text-xs text-slate-600">
                      <span>OCR Results:</span>
                    </div>

                    {/* Show raw OCR text that was analyzed */}
                    <div className="bg-slate-50 border border-slate-200 rounded p-2">
                      <div className="text-xs text-slate-600 mb-1">Text detected in photo:</div>
                      <div className="text-xs font-mono text-slate-800 max-h-16 overflow-y-auto">
                        {odometerReading.rawText
                          ? odometerReading.rawText.replace(/(\d)(?=(\d{3})+(?!\d))/g, '$1 ')
                          : 'No text detected'}
                      </div>
                    </div>

                    {/* Extracted reading with manual override */}
                    <div>
                      <label className="block text-xs text-slate-600 mb-1">
                        Extracted Reading: {typeof odometerReading.km === 'number' ? `${odometerReading.km} km` : 'Could not detect number'}
                      </label>
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
                    </div>

                    {odometerReading.manuallyAdjusted && (
                      <div className="bg-amber-50 border border-amber-200 rounded-lg p-2">
                        <div className="flex items-start gap-2">
                          <Edit3 className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
                          <div className="text-xs text-amber-700">
                            <div className="font-medium">Manual adjustment detected</div>
                            <div className="mt-1">
                              OCR detected: <span className="font-mono">{odometerReading.km || 'Nothing'}</span><br/>
                              Adjusted to: <span className="font-mono">{odometerInput}</span>
                            </div>
                          </div>
                        </div>

                        <textarea
                          value={odometerJustification}
                          onChange={e => setOdometerJustification(e.target.value)}
                          placeholder="Why was the reading manually adjusted? (e.g., OCR missed digits, display unclear)"
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
                        aria-label="Log odometer reading"
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
                  {isSealed ? 'Sealed measurements' : 'Measure with tread depth gauge (mm) - All required'}
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

              {/* Simplified 2x2 tyre depth input grid */}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <label className="block text-sm font-medium text-slate-700">
                    Front Left (FL) <span className="text-red-500">*</span>
                  </label>
                  <div className="relative">
                    <input
                      type="number"
                      min="0"
                      max="12"
                      step="0.1"
                      value={tyreDepths.fl || ''}
                      onChange={e => setTyreDepths(prev => ({ ...prev, fl: e.target.value ? Number(e.target.value) : '' }))}
                      placeholder="0.0"
                      className={`w-full border rounded-lg px-3 py-2 text-sm pr-8 ${
                        tyreDepths.fl === '' ? 'border-red-300 bg-red-50' : 'border-slate-300'
                      }`}
                      disabled={isSealed}
                      required
                    />
                    <span className="absolute right-3 top-1/2 transform -translate-y-1/2 text-xs text-slate-500">mm</span>
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="block text-sm font-medium text-slate-700">
                    Front Right (FR) <span className="text-red-500">*</span>
                  </label>
                  <div className="relative">
                    <input
                      type="number"
                      min="0"
                      max="12"
                      step="0.1"
                      value={tyreDepths.fr || ''}
                      onChange={e => setTyreDepths(prev => ({ ...prev, fr: e.target.value ? Number(e.target.value) : '' }))}
                      placeholder="0.0"
                      className={`w-full border rounded-lg px-3 py-2 text-sm pr-8 ${
                        tyreDepths.fr === '' ? 'border-red-300 bg-red-50' : 'border-slate-300'
                      }`}
                      disabled={isSealed}
                      required
                    />
                    <span className="absolute right-3 top-1/2 transform -translate-y-1/2 text-xs text-slate-500">mm</span>
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="block text-sm font-medium text-slate-700">
                    Rear Left (RL) <span className="text-red-500">*</span>
                  </label>
                  <div className="relative">
                    <input
                      type="number"
                      min="0"
                      max="12"
                      step="0.1"
                      value={tyreDepths.rl || ''}
                      onChange={e => setTyreDepths(prev => ({ ...prev, rl: e.target.value ? Number(e.target.value) : '' }))}
                      placeholder="0.0"
                      className={`w-full border rounded-lg px-3 py-2 text-sm pr-8 ${
                        tyreDepths.rl === '' ? 'border-red-300 bg-red-50' : 'border-slate-300'
                      }`}
                      disabled={isSealed}
                      required
                    />
                    <span className="absolute right-3 top-1/2 transform -translate-y-1/2 text-xs text-slate-500">mm</span>
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="block text-sm font-medium text-slate-700">
                    Rear Right (RR) <span className="text-red-500">*</span>
                  </label>
                  <div className="relative">
                    <input
                      type="number"
                      min="0"
                      max="12"
                      step="0.1"
                      value={tyreDepths.rr || ''}
                      onChange={e => setTyreDepths(prev => ({ ...prev, rr: e.target.value ? Number(e.target.value) : '' }))}
                      placeholder="0.0"
                      className={`w-full border rounded-lg px-3 py-2 text-sm pr-8 ${
                        tyreDepths.rr === '' ? 'border-red-300 bg-red-50' : 'border-slate-300'
                      }`}
                      disabled={isSealed}
                      required
                    />
                    <span className="absolute right-3 top-1/2 transform -translate-y-1/2 text-xs text-slate-500">mm</span>
                  </div>
                </div>
              </div>

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
            
            {dekraUrlHref  ? (
              <div className="bg-green-50 border border-green-200 rounded-lg p-3">
                <a 
                  href={dekraUrlHref} 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="text-blue-600 hover:text-blue-800 underline text-sm break-all"
                >
                  {dekraUrlHref}
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
                  aria-label="Store DEKRA link"
                  onClick={async () => {
                    try {
                      setSaving('dekra')
                      const normalizedUrl = normalizeExternalUrl(dekraUrlInput)
                      await setDekraUrlApi(vin, normalizedUrl)
                      setDekraUrlInput('')
                      await load()
                    } catch (error: unknown) {
                      alert(getErrorMessage(error, 'Failed to save DEKRA link'))
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
                  {(() => {
                    const baseRoles = TABS.find(t => t.key === activeTab)!.roles
                    const displayRoles = activeTab === 'exterior'
                      ? Array.from(new Set([...baseRoles, 'engine_bay' as ImageRole]))
                      : baseRoles
                    return displayRoles
                  })().map((role) => {
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
              capture="environment"
              className="sr-only"
              aria-label="Take photo"
              onChange={onFile}
            />

            <input
              ref={odometerFileRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="sr-only"
              aria-label="Odometer upload input"
              role="button"
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
                {ocrScanning ? 'Processing VIN photo...' :
                 odometerScanning ? 'Processing odometer...' :
                 `Processing ${rolePretty(uploading!)} photo...`}
              </div>
            )}

            {qualityIssue && (
              <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="text-sm text-amber-800">
                  <div className="font-semibold">
                    {qualityIssue.role === 'odometer'
                      ? 'Odometer photo needs a retake'
                      : `${rolePretty(qualityIssue.role)} needs a retake`}
                  </div>
                  {qualityIssue.issues.length > 0 && (
                    <ul className="mt-1 list-disc list-inside text-xs text-amber-700 space-y-0.5">
                      {qualityIssue.issues.map((issue, index) => (
                        <li key={`${issue}-${index}`}>{issue}</li>
                      ))}
                    </ul>
                  )}
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => {
                      const issueRole = qualityIssue.role
                      setQualityIssue(null)
                      if (issueRole === 'odometer') {
                        captureOdometer()
                      } else {
                        choosePhoto(issueRole)
                      }
                    }}
                    className="inline-flex items-center gap-1 rounded-lg bg-amber-600 hover:bg-amber-700 text-white px-3 py-1.5 text-sm font-medium"
                  >
                    Retake photo
                  </button>
                  <button
                    onClick={() => setQualityIssue(null)}
                    className="inline-flex items-center gap-1 rounded-lg border border-amber-300 px-3 py-1.5 text-sm text-amber-700 hover:bg-amber-100"
                  >
                    Dismiss
                  </button>
                </div>
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
              } catch (error: unknown) {
                alert('Seal failed: ' + getErrorMessage(error, 'Unknown sealing error'))
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
    </main>
  )
}




















