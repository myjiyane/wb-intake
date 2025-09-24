// src/pages/Start.tsx
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import VinScanner from '../components/VinScanner'
import { initDraft } from '../lib/api'
import { formatVin, normalizeVin, isValidVin } from '../lib/vin'
import type { ImageRole } from '../types'
import { AlertTriangle, CheckCircle2, Scan, Camera, Shield, Eye, Edit3 } from 'lucide-react'

const DEFAULT_ROLES: ImageRole[] = [
  'exterior_front_34','exterior_rear_34','left_side','right_side',
  'interior_front','interior_rear','dash_odo','engine_bay',
  'tyre_fl','tyre_fr','tyre_rl','tyre_rr'
]

interface ScanResult {
  vin: string
  confidence: number
  candidates: string[]
  valid: boolean
  timestamp: number
  method: 'live_scan' | 'photo_ocr'
}

export default function Start() {
  const [scannedVin, setScannedVin] = useState<ScanResult | null>(null)
  const [correctedVin, setCorrectedVin] = useState('')
  const [lot, setLot] = useState('WB-POC-001')
  const [busy, setBusy] = useState(false)
  const [scanOpen, setScanOpen] = useState(false)
  const [manualCorrectionMade, setManualCorrectionMade] = useState(false)
  const [requiresJustification, setRequiresJustification] = useState(false)
  const [justification, setJustification] = useState('')
  
  const vinInputRef = useRef<HTMLInputElement | null>(null)
  const nav = useNavigate()

  function getManufacturerInfo(wmi: string): string {
    const saManufacturers: { [key: string]: string } = {
      'AAV': '(Volkswagen SA)',
      'ABA': '(BMW SA)', 
      'ACA': '(Nissan SA)',
      'AHA': '(Toyota SA)',
      'AJA': '(Ford SA)',
      'AKA': '(Mercedes-Benz SA)',
      'ALA': '(General Motors SA)',
    };
    
    if (saManufacturers[wmi]) {
      return saManufacturers[wmi];
    }
    
    if (wmi.startsWith('A')) {
      return '(South African manufacturer)';
    }
    
    return '(World Manufacturer ID)';
  }

  function getModelYear(char: string): string {
    const yearMap: { [key: string]: string } = {
      'A': '2010', 'B': '2011', 'C': '2012', 'D': '2013', 'E': '2014',
      'F': '2015', 'G': '2016', 'H': '2017', 'J': '2018', 'K': '2019',
      'L': '2020', 'M': '2021', 'N': '2022', 'P': '2023', 'R': '2024',
      'S': '2025', 'T': '2026', 'V': '2027', 'W': '2028', 'X': '2029',
      'Y': '2030', '1': '2001', '2': '2002', '3': '2003', '4': '2004',
      '5': '2005', '6': '2006', '7': '2007', '8': '2008', '9': '2009'
    };
    
    return yearMap[char] || 'Unknown';
  }

  // Handle successful VIN scan
  function handleScanResult(scannedVinValue: string, method: 'live_scan' | 'photo_ocr' = 'live_scan') {
    const formatted = formatVin(scannedVinValue)
    const scanResult: ScanResult = {
      vin: formatted,
      confidence: method === 'live_scan' ? 100 : 95, // Live scanning assumed high confidence
      candidates: [formatted],
      valid: isValidVin(formatted),
      timestamp: Date.now(),
      method
    }
    
    setScannedVin(scanResult)
    setCorrectedVin(formatted)
    setManualCorrectionMade(false)
    setRequiresJustification(false)
    setJustification('')
    setScanOpen(false)

    // Auto-focus correction field for verification
    setTimeout(() => {
      vinInputRef.current?.focus()
      vinInputRef.current?.select()
    }, 100)
  }

  // Handle manual corrections to scanned VIN
  function handleVinCorrection(value: string) {
    const normalized = normalizeVin(value)
    setCorrectedVin(normalized)
    
    if (scannedVin && normalized !== scannedVin.vin) {
      setManualCorrectionMade(true)
      // Require justification for significant changes
      if (normalized.length >= 11 && Math.abs(normalized.length - scannedVin.vin.length) > 2) {
        setRequiresJustification(true)
      }
    } else {
      setManualCorrectionMade(false)
      setRequiresJustification(false)
      setJustification('')
    }
  }

  // Reset scan to try again
  function resetScan() {
    setScannedVin(null)
    setCorrectedVin('')
    setManualCorrectionMade(false)
    setRequiresJustification(false)
    setJustification('')
  }

  // Proceed to inspection
  async function proceedToInspection() {
    const finalVin = correctedVin || scannedVin?.vin
    if (!finalVin || finalVin.length < 11) {
      alert('Valid VIN required to proceed')
      return
    }

    // Log any manual corrections for audit trail
    if (manualCorrectionMade && scannedVin) {
      console.log('VIN Manual Correction Logged:', {
        originalScanned: scannedVin.vin,
        correctedTo: correctedVin,
        scanConfidence: scannedVin.confidence,
        scanMethod: scannedVin.method,
        justification: justification || 'No justification provided',
        timestamp: new Date().toISOString(),
        lotId: lot
      })
      
      // In a real system, this would be sent to an audit API
      // await logManualCorrection({ ... })
    }

    setBusy(true)
    try {
      await initDraft(finalVin, lot, DEFAULT_ROLES)
      nav(`/vin/${finalVin}?lot=${encodeURIComponent(lot)}`)
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn('init failed:', message);
      nav(`/vin/${finalVin}?lot=${encodeURIComponent(lot)}`)
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    if (!scanOpen) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [scanOpen])

  const finalVin = correctedVin || scannedVin?.vin || ''
  const canProceed = finalVin.length >= 11 && (!requiresJustification || justification.trim().length > 0)
  const vinStatus = finalVin ? (isValidVin(finalVin) ? 'valid' : 'invalid') : null

  return (
    <div className="space-y-6 max-w-md mx-auto">
      {/* Header */}
      <div className="text-center space-y-2">
        <h1 className="text-xl font-semibold text-slate-800">Digital Vehicle Passport</h1>
        <p className="text-sm text-slate-600">
          Auction passport made easy
        </p>
      </div>

      {/* Primary VIN Scanning Section */}
      <div className="rounded-xl border-2 border-blue-200 bg-blue-50/50 p-4 space-y-4">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center">
            <Scan className="w-4 h-4 text-white" />
          </div>
          <div>
            <h2 className="font-semibold text-slate-800">Step 1: Scan VIN</h2>
            <p className="text-xs text-slate-600">Required for vehicle identification</p>
          </div>
        </div>

        {!scannedVin ? (
          <div className="space-y-3">
            <button
              onClick={() => setScanOpen(true)}
              disabled={busy}
              className="w-full bg-blue-600 hover:bg-blue-700 text-white py-4 px-4 rounded-xl font-semibold 
                        flex items-center justify-center gap-3 transition-all active:scale-[0.99] disabled:opacity-50"
            >
              <Camera className="w-5 h-5" />
              <div className="text-left">
                <div>SCAN VIN</div>
                <div className="text-xs opacity-90 font-normal">
                  Windshield, dashboard, or engine bay
                </div>
              </div>
            </button>
            
            <div className="text-xs text-slate-500 text-center">
              VIN scanning ensures accuracy and prevents data entry errors
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {/* Scan Success Indicator */}
            <div className="flex items-center gap-2 text-sm text-green-700 bg-green-50 px-3 py-2 rounded-lg border border-green-200">
              <CheckCircle2 className="w-4 h-4" />
              <span>VIN scanned successfully</span>
              <button 
                onClick={resetScan}
                className="ml-auto text-xs px-2 py-1 bg-green-200 hover:bg-green-300 rounded transition-colors"
              >
                Scan Again
              </button>
            </div>

            {/* Scan Details */}
            <div className="bg-white border border-slate-200 rounded-lg p-3 space-y-2">
              <div className="flex items-center justify-between text-xs text-slate-600">
                <span>Scanned VIN:</span>
                <span className="flex items-center gap-1">
                  <Eye className="w-3 h-3" />
                  {scannedVin.confidence.toFixed(0)}% confidence
                </span>
              </div>
              <div className="font-mono text-sm bg-slate-50 px-3 py-2 rounded border">
                {scannedVin.vin}
              </div>
              <div className="flex items-center gap-2 text-xs">
                <div className={`w-2 h-2 rounded-full ${scannedVin.valid ? 'bg-green-500' : 'bg-yellow-500'}`} />
                <span className="text-slate-600">
                  {scannedVin.valid ? 'Valid VIN format' : 'Invalid check digit - verify manually'}
                </span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* VIN Correction Section - Only shown after scan */}
      {scannedVin && (
        <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-4">
          <div className="flex items-center gap-3">
            <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
              manualCorrectionMade ? 'bg-amber-600' : 'bg-green-600'
            }`}>
              <Edit3 className="w-4 h-4 text-white" />
            </div>
            <div>
              <h2 className="font-semibold text-slate-800">Step 2: Verify & Correct</h2>
              <p className="text-xs text-slate-600">
                {manualCorrectionMade ? 'Manual correction detected' : 'Verify scanned VIN is accurate'}
              </p>
            </div>
          </div>

          <div className="space-y-3">
            <label className="block text-sm font-medium text-slate-700">
              Final VIN {manualCorrectionMade && <span className="text-amber-600">(Modified)</span>}
            </label>
            
            <div className="relative">
              <input
                ref={vinInputRef}
                value={correctedVin}
                onChange={e => handleVinCorrection(e.target.value)}
                className={`w-full border rounded-lg px-4 py-3 text-lg font-mono tracking-wider
                  ${vinStatus === 'valid' ? 'border-green-300 bg-green-50' :
                    vinStatus === 'invalid' ? 'border-yellow-300 bg-yellow-50' :
                    'border-slate-300 bg-white'}
                  ${manualCorrectionMade ? 'ring-2 ring-amber-200' : ''}
                `}
                placeholder="Verify VIN accuracy"
                disabled={busy}
                inputMode="text"
                autoCapitalize="characters"
                maxLength={17}
              />
              
              {vinStatus && (
                <div className="absolute right-3 top-1/2 transform -translate-y-1/2">
                  {vinStatus === 'valid' ? (
                    <CheckCircle2 className="w-5 h-5 text-green-600" />
                  ) : (
                    <AlertTriangle className="w-5 h-5 text-amber-600" />
                  )}
                </div>
              )}
            </div>

            {/* Manual correction warning */}
            {manualCorrectionMade && (
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
                  <div className="text-sm text-amber-700">
                    <div className="font-medium">Manual correction detected</div>
                    <div className="text-xs mt-1">
                      Original: <span className="font-mono">{scannedVin.vin}</span><br/>
                      Modified: <span className="font-mono">{correctedVin}</span>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Justification field for significant changes */}
            {requiresJustification && (
              <div className="space-y-2">
                <label className="block text-sm font-medium text-amber-700">
                  Correction Justification Required
                </label>
                <textarea
                  value={justification}
                  onChange={e => setJustification(e.target.value)}
                  placeholder="Explain why the VIN was manually corrected (e.g. incorrect result, damaged licence disk, poor lighting, etc.)"
                  className="w-full border border-amber-300 rounded-lg px-3 py-2 text-sm bg-amber-50"
                  rows={3}
                  disabled={busy}
                />
              </div>
            )}

            {/* VIN Analysis */}
            {finalVin.length >= 11 && (
            <div className="text-xs text-slate-500 bg-slate-50 rounded-lg p-3">
              <div className="font-medium mb-1">VIN Analysis:</div>
              <div className="space-y-1">
                <div>Length: {finalVin.length}/17 characters</div>
                <div>Format: {isValidVin(finalVin) ? 'Valid checksum' : finalVin.length === 17 ? 'Invalid checksum' : 'Partial VIN'}</div>
                {finalVin.length >= 3 && (
                  <div>WMI: {finalVin.substring(0, 3)} {getManufacturerInfo(finalVin.substring(0, 3))}</div>
                )}
                {finalVin.length >= 10 && (
                  <div>Year: {getModelYear(finalVin[9])}</div>
                )}
                {finalVin.startsWith('A') && (
                  <div className="text-emerald-600">South African assembled vehicle</div>
                )}
              </div>
            </div>
          )}
          </div>
        </div>
      )}

      {/* Lot ID Section */}
      <div className="space-y-2">
        <label className="block text-sm font-medium text-slate-700">
          Lot ID
        </label>
        <input
          value={lot}
          onChange={e => setLot(e.target.value)}
          placeholder="WB-LOT-001"
          className="w-full border border-slate-300 rounded-lg px-4 py-3 text-sm"
          disabled={busy}
        />
      </div>

      {/* Proceed Button */}
      <button
        onClick={proceedToInspection}
        disabled={!canProceed || busy}
        className={`w-full rounded-xl py-4 font-semibold text-white transition-all
          ${!canProceed || busy ? 'bg-slate-300 cursor-not-allowed' :
            'bg-teal-600 hover:bg-teal-700 active:scale-[0.99]'}
        `}
      >
        {busy ? (
          <div className="flex items-center justify-center gap-2">
            <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
            Preparing inspection...
          </div>
        ) : !scannedVin ? (
          'Scan VIN to continue'
        ) : !canProceed ? (
          requiresJustification ? 'Justification required' : 'Verify VIN to continue'
        ) : (
          <div className="flex items-center justify-center gap-2">
            <Shield className="w-5 h-5" />
            Start Inspection
          </div>
        )}
      </button>

      {/* Development info */}
      {import.meta.env.DEV && (
        <div className="text-xs text-slate-400 text-center mt-6 p-3 bg-slate-50 rounded">
          API: {import.meta.env.VITE_API_BASE_URL || 'Not configured'}
        </div>
      )}

      {/* Enhanced VIN Scanner */}
      {scanOpen && (
        <VinScanner
          onResult={handleScanResult}
          onClose={() => setScanOpen(false)}
          showValidation={true}
          allowInvalidVins={true}
        />
      )}
    </div>
  )
}

