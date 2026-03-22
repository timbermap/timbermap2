'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { UserButton } from '@clerk/nextjs'

const nav = [
  { label: 'Dashboard', href: '/dashboard' },
  { label: 'Images',    href: '/dashboard/images' },
  { label: 'Vectors',   href: '/dashboard/vectors' },
  { label: 'Models',    href: '/dashboard/models' },
  { label: 'Jobs',      href: '/dashboard/jobs' },
  { label: 'Map',       href: '/dashboard/map' },
]

export default function Sidebar() {
  const path = usePathname()
  return (
    <aside className="fixed left-0 top-0 h-full w-60 flex flex-col" style={{ background: '#2C5F45' }}>

      {/* Logo — links to landing */}
      <Link href="/" className="px-7 py-6 border-b border-white/10 flex items-center gap-3 hover:bg-white/5 transition-colors">
        {/* Tree icon */}
        <svg width="28" height="28" viewBox="0 0 28 28" fill="none" xmlns="http://www.w3.org/2000/svg">
          <circle cx="14" cy="14" r="14" fill="white" fillOpacity="0.12"/>
          <path d="M14 5L9 12h3l-3 5h5v4h2v-4h5l-3-5h3L14 5z" fill="white"/>
        </svg>
        <div>
          <span className="text-white font-semibold text-base tracking-wide block leading-tight">
            Timbermap
          </span>
          <p className="text-white/40 text-xs font-light">Geospatial AI Platform</p>
        </div>
      </Link>

      <nav className="flex-1 px-3 py-4 space-y-0.5">
        {nav.map(item => (
          <Link
            key={item.href}
            href={item.href}
            className={`flex items-center px-4 py-2.5 rounded-lg text-sm transition-all ${
              path === item.href
                ? 'bg-white/20 text-white font-medium'
                : 'text-white/55 hover:text-white hover:bg-white/10'
            }`}
          >
            {item.label}
          </Link>
        ))}
      </nav>

      <div className="px-5 py-4 border-t border-white/10 flex items-center gap-3">
        <UserButton />
        <span className="text-white/40 text-xs">Account</span>
      </div>
    </aside>
  )
}
