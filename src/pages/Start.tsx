import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'

export default function Start() {
  const [vin, setVin] = useState('')
  const [lot, setLot] = useState('WB-POC-001')
  const nav = useNavigate()

  function go() {
    const v = vin.toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,17)
    if (v.length < 11) return alert('Enter a VIN (at least 11, ideally 17, characters)')
    nav(`/vin/${v}?lot=${encodeURIComponent(lot)}`)
  }

  return (
    <div className="space-y-4">
      <div className="text-slate-700 text-sm">Enter VIN and (optional) Lot ID to begin intake.</div>
      <input className="w-full border border-slate-300 rounded-lg px-3 py-2"
             placeholder="VIN (e.g., WDD2040082R088866)"
             value={vin} onChange={e=>setVin(e.target.value)} />
      <input className="w-full border border-slate-300 rounded-lg px-3 py-2"
             placeholder="Lot ID (optional)"
             value={lot} onChange={e=>setLot(e.target.value)} />
      <button onClick={go}
              className="w-full rounded-xl bg-teal-600 hover:bg-teal-700 text-white py-3 font-medium">
        Start capture
      </button>
      <div className="text-xs text-slate-500">API: {import.meta.env.VITE_API_BASE_URL}</div>
    </div>
  )
}