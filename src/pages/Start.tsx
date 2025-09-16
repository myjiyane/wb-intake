// src/pages/Start.tsx
import React, { useRef, useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import VinScanner from '../components/VinScanner'
import { initDraft, isValidVin, formatVin } from '../lib/api'
import type { ImageRole } from '../types'
import { AlertTriangle, CheckCircle2, Scan, Camera } from 'lucide-react'

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
  const [validationError, setValidationError] = useState<string | null>(null)
  const vinInputRef = useRef<HTMLInputElement | null>(null)

  const nav = useNavigate()

  function normalizeVin(input: string) {
    return input
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '')
      .replace(/[IOQ]/g, '')
      .slice(0, 17)
  }

  // Enhanced VIN validation with real-time feedback
  function validateVinInput(value: string) {
    const normalized = normalizeVin(value)
    setVin(normalized)
    
    if (!normalized) {
      setValidationError(null)
      return
    }
    
    if (normalized.length < 11) {
      setValidationError('VIN too short (minimum 11 characters)')
      return
    }
    
    if (normalized.length === 17) {
      if (isValidVin(normalized)) {
        setValidationError(null)
      } else {
        setValidationError('Invalid VIN check digit - may still work for older vehicles')
      }
    } else {
      setValidationError('Partial VIN (full VIN is 17 characters)')
    }
  }

  async function go() {
    const v = normalizeVin(vin)
    if (v.length < 11) {
      alert('Enter a VIN (at least 11, ideally 17, characters)')
      vinInputRef.current?.focus()
      return
    }
    
    setBusy(true)
    try {
      await initDraft(v, lot, DEFAULT_ROLES)
      nav(`/vin/${v}?lot=${encodeURIComponent(lot)}`)
    } catch (e: any) {
      console.warn('init failed:', e?.message || e)
      // Still navigate - init failure shouldn't block workflow
      nav(`/vin/${v}?lot=${encodeURIComponent(lot)}`)
    } finally {
      setBusy(false)
    }
  }

  // Enhanced scan result handler with validation feedback
  function handleScanResult(scannedVin: string) {
    const v = normalizeVin(scannedVin)
    const formatted = formatVin(v)
    
    setVin(formatted)
    setScanOpen(false)
    
    // Provide immediate feedback about scan quality
    if (isValidVin(formatted)) {
      setValidationError(null)
    } else if (formatted.length === 17) {
      setValidationError('Scanned VIN has invalid check digit - verify manually')
    } else {
      setValidationError('Partial VIN scanned - verify complete VIN')
    }

    setTimeout(() => {
      vinInputRef.current?.focus()
      vinInputRef.current?.select()
    }, 100)
  }
  
  useEffect(() => {
    if (!scanOpen) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [scanOpen])

  // Get validation status for UI
  const vinStatus = (() => {
    if (!vin) return null
    if (vin.length < 11) return 'too-short'
    if (vin.length === 17 && isValidVin(vin)) return 'valid'
    if (vin.length === 17) return 'invalid-checksum'
    return 'partial'
  })()

  const canProceed = vin.length >= 11

  return (
    <div className="space-y-6">
      {/* Header with better context */}
      <div className="text-center space-y-2">
        <h1 className="text-xl font-semibold text-slate-800">Vehicle Inspection</h1>
        <p className="text-sm text-slate-600">
          Enter or scan the VIN to begin DEKRA-style documentation
        </p>
      </div>

      {/* Enhanced VIN input with validation */}
      <div className="space-y-3">
        <label className="block text-sm font-medium text-slate-700">
          Vehicle Identification Number (VIN)
        </label>
        
        <div className="relative">
          <input
            ref={vinInputRef}
            className={`w-full border rounded-lg px-4 py-3 text-lg font-mono tracking-wider
              ${vinStatus === 'valid' ? 'border-green-300 bg-green-50' :
                vinStatus === 'invalid-checksum' ? 'border-yellow-300 bg-yellow-50' :
                vinStatus === 'too-short' ? 'border-rose-300 bg-rose-50' :
                'border-slate-300 bg-white'}
              ${busy ? 'opacity-50' : ''}
            `}
            placeholder="WDD2040082R088866"
            value={vin}
            onChange={e => validateVinInput(e.target.value)}
            disabled={busy}
            inputMode="latin"
            autoCapitalize="characters"
            maxLength={17}
          />
          
          {/* Validation indicator */}
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

        {/* Validation feedback */}
        {validationError && (
          <div className={`text-xs px-3 py-2 rounded-lg flex items-center gap-2
            ${vinStatus === 'invalid-checksum' ? 'bg-yellow-50 text-yellow-700 border border-yellow-200' :
              'bg-rose-50 text-rose-700 border border-rose-200'}
          `}>
            <AlertTriangle className="w-4 h-4 flex-shrink-0" />
            {validationError}
          </div>
        )}

        {/* VIN info helper */}
        {vin && vin.length >= 11 && (
          <div className="text-xs text-slate-500 bg-slate-50 rounded-lg p-3">
            <div className="font-medium mb-1">VIN Analysis:</div>
            <div className="space-y-1">
              <div>Length: {vin.length}/17 characters</div>
              <div>Format: {isValidVin(vin) ? 'Valid checksum' : 'Invalid/partial'}</div>
              {vin.length >= 3 && (
                <div>Manufacturer: {vin.substring(0, 3)} (World Manufacturer Identifier)</div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Enhanced scanning options */}
      <div className="space-y-3">
        <div className="flex items-center gap-3">
          <div className="flex-1 h-px bg-slate-200" />
          <div className="text-xs uppercase tracking-wide text-slate-500 font-medium">
            Or scan VIN
          </div>
          <div className="flex-1 h-px bg-slate-200" />
        </div>

        {/* Prominent scan button with better description */}
        <button
          type="button"
          onClick={() => setScanOpen(true)}
          disabled={busy}
          className={`w-full rounded-xl py-4 font-semibold tracking-wide text-white
            flex items-center justify-center gap-3 transition-all
            ${busy ? 'bg-emerald-400' : 'bg-emerald-600 hover:bg-emerald-700 active:scale-[0.99]'}
          `}
        >
          <div className="flex items-center gap-3">
            <Camera className="w-5 h-5" />
            <div className="text-left">
              <div>Scan VIN</div>
              <div className="text-xs opacity-90 font-normal">
                Windshield, dashboard, or engine bay
              </div>
            </div>
          </div>
        </button>

        <div className="text-xs text-slate-500 text-center">
          VIN is typically found on the windshield (driver side), dashboard, or engine bay
        </div>
      </div>

      {/* Lot input with better spacing */}
      <div className="space-y-2">
        <label className="block text-sm font-medium text-slate-700">
          Lot ID (optional)
        </label>
        <input
          className="w-full border border-slate-300 rounded-lg px-4 py-3 text-sm"
          placeholder="WB-POC-001"
          value={lot}
          onChange={e => setLot(e.target.value)}
          disabled={busy}
        />
      </div>

      {/* Enhanced proceed button */}
      <button
        onClick={go}
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
        ) : !canProceed ? (
          'Enter VIN to continue'
        ) : (
          <div className="flex items-center justify-center gap-2">
            <Scan className="w-5 h-5" />
            Start Vehicle Inspection
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
          allowInvalidVins={false} // Force validation on entry page
        />
      )}
    </div>
  )
}