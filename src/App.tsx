import { Outlet, Link } from 'react-router-dom'
import { Car } from 'lucide-react'

export default function App() {
  return (
    <div className="min-h-full max-w-md mx-auto">
      <header className="sticky top-0 z-10 bg-teal-600 text-white">
        <div className="px-4 py-3 flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-white/15 grid place-items-center"><Car className="w-4 h-4"/></div>
          <div>
            <div className="text-xs uppercase opacity-90">WesBank Intake</div>
            <div className="text-sm font-semibold">Capture & Checklist</div>
          </div>
          <div className="ml-auto text-xs opacity-90"><Link to="/" className="underline">Home</Link></div>
        </div>
      </header>
      <main className="p-4 pb-24">
        <Outlet />
      </main>
    </div>
  )
}

