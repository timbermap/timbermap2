'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { UserButton, useUser } from '@clerk/nextjs'
import { useState, useEffect } from 'react'

const nav = [
  { label: 'Dashboard', href: '/dashboard', icon: <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4 flex-shrink-0"><path fillRule="evenodd" d="M9.293 2.293a1 1 0 0 1 1.414 0l7 7A1 1 0 0 1 17 11h-1v6a1 1 0 0 1-1 1h-2a1 1 0 0 1-1-1v-3a1 1 0 0 0-1-1H9a1 1 0 0 0-1 1v3a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-6H3a1 1 0 0 1-.707-1.707l7-7Z" clipRule="evenodd"/></svg> },
  { label: 'Images',    href: '/dashboard/images', icon: <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4 flex-shrink-0"><path fillRule="evenodd" d="M1 5.25A2.25 2.25 0 0 1 3.25 3h13.5A2.25 2.25 0 0 1 19 5.25v9.5A2.25 2.25 0 0 1 16.75 17H3.25A2.25 2.25 0 0 1 1 14.75v-9.5Zm1.5 5.81v3.69c0 .414.336.75.75.75h13.5a.75.75 0 0 0 .75-.75v-2.69l-2.22-2.219a.75.75 0 0 0-1.06 0l-1.91 1.909.47.47a.75.75 0 1 1-1.06 1.06L6.53 8.091a.75.75 0 0 0-1.06 0l-2.97 2.97ZM12 7a1 1 0 1 1-2 0 1 1 0 0 1 2 0Z" clipRule="evenodd"/></svg> },
  { label: 'Vectors',   href: '/dashboard/vectors', icon: <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4 flex-shrink-0"><path fillRule="evenodd" d="M8.157 2.176a1.5 1.5 0 0 0-1.147 0l-4.084 1.69A1.5 1.5 0 0 0 2 5.25v10.877a1.5 1.5 0 0 0 2.074 1.386l3.51-1.452 4.26 1.762a1.5 1.5 0 0 0 1.146 0l4.083-1.69A1.5 1.5 0 0 0 18 14.75V3.872a1.5 1.5 0 0 0-2.073-1.386l-3.51 1.452-4.26-1.762ZM7.5 5v11.25L5 17.5V5.75l2.5-1.034V5Zm2.5 11.25V5L12.5 3.75v11.25L10 16.25Zm2.5.5v-11.5l2.5-1.034V14.25l-2.5 1.034v-.5.466Z" clipRule="evenodd"/></svg> },
  { label: 'Models',    href: '/dashboard/models', icon: <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4 flex-shrink-0"><path d="M14 6H6v8h8V6Z"/><path fillRule="evenodd" d="M9.25 3V1.75a.75.75 0 0 1 1.5 0V3h1.5V1.75a.75.75 0 0 1 1.5 0V3h.5A2.75 2.75 0 0 1 17 5.75v.5h1.25a.75.75 0 0 1 0 1.5H17v1.5h1.25a.75.75 0 0 1 0 1.5H17v1.5h1.25a.75.75 0 0 1 0 1.5H17v.5A2.75 2.75 0 0 1 14.25 17h-.5v1.25a.75.75 0 0 1-1.5 0V17h-1.5v1.25a.75.75 0 0 1-1.5 0V17h-1.5v1.25a.75.75 0 0 1-1.5 0V17h-.5A2.75 2.75 0 0 1 3 14.25v-.5H1.75a.75.75 0 0 1 0-1.5H3v-1.5H1.75a.75.75 0 0 1 0-1.5H3v-1.5H1.75a.75.75 0 0 1 0-1.5H3v-.5A2.75 2.75 0 0 1 5.75 3h.5V1.75a.75.75 0 0 1 1.5 0V3h1.5ZM4.5 5.75c0-.69.56-1.25 1.25-1.25h8.5c.69 0 1.25.56 1.25 1.25v8.5c0 .69-.56 1.25-1.25 1.25h-8.5c-.69 0-1.25-.56-1.25-1.25v-8.5Z" clipRule="evenodd"/></svg> },
  { label: 'Jobs',      href: '/dashboard/jobs', icon: <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4 flex-shrink-0"><path fillRule="evenodd" d="M15.988 3.012A2.25 2.25 0 0 1 18 5.25v6.5A2.25 2.25 0 0 1 15.75 14H13.5V7A2.5 2.5 0 0 0 11 4.5H8.128a2.252 2.252 0 0 1 1.884-1.488A2.25 2.25 0 0 1 12.25 1h1.5a2.25 2.25 0 0 1 2.238 2.012ZM11.5 3.25a.75.75 0 0 1 .75-.75h1.5a.75.75 0 0 1 .75.75v.25h-3v-.25Z" clipRule="evenodd"/><path fillRule="evenodd" d="M2 7a1 1 0 0 1 1-1h8a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V7Zm2 3.25a.75.75 0 0 1 .75-.75h4.5a.75.75 0 0 1 0 1.5h-4.5a.75.75 0 0 1-.75-.75Zm0 3.5a.75.75 0 0 1 .75-.75h4.5a.75.75 0 0 1 0 1.5h-4.5a.75.75 0 0 1-.75-.75Z" clipRule="evenodd"/></svg> },
  { label: 'Map',       href: '/dashboard/map', icon: <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4 flex-shrink-0"><path fillRule="evenodd" d="m9.69 18.933.003.001C9.89 19.02 10 19 10 19s.11.02.308-.066l.002-.001.006-.003.018-.008a5.741 5.741 0 0 0 .281-.14c.186-.096.446-.24.757-.433.62-.384 1.445-.966 2.274-1.765C15.302 14.988 17 12.493 17 9A7 7 0 1 0 3 9c0 3.492 1.698 5.988 3.355 7.584a13.731 13.731 0 0 0 2.273 1.765 11.842 11.842 0 0 0 .788.472l.018.008.006.003ZM10 11.25a2.25 2.25 0 1 0 0-4.5 2.25 2.25 0 0 0 0 4.5Z" clipRule="evenodd"/></svg> },
]

const API = process.env.NEXT_PUBLIC_API_URL || 'https://timbermap-api-788407107542.us-central1.run.app'

export default function Sidebar() {
  const path = usePathname()
  const { user, isLoaded } = useUser()
  const [collapsed, setCollapsed]     = useState(false)
  const [isSuperadmin, setIsSuperadmin] = useState(false)

  useEffect(() => {
    const stored = localStorage.getItem('sidebar-collapsed')
    if (stored === 'true') setCollapsed(true)
  }, [])

  useEffect(() => {
    if (!isLoaded || !user) return
    fetch(`${API}/superadmin/health`, { headers: { 'x-clerk-id': user.id } })
      .then(r => { if (r.ok) setIsSuperadmin(true) })
      .catch(() => {})
  }, [isLoaded, user])

  function toggle() {
    const next = !collapsed
    setCollapsed(next)
    localStorage.setItem('sidebar-collapsed', String(next))
  }

  const w = collapsed ? 'w-16' : 'w-60'

  return (
    <>
      <aside className={`fixed left-0 top-0 h-full flex flex-col transition-all duration-200 z-30 ${w}`}
        style={{ background: 'linear-gradient(180deg, #1E3835 0%, #162B28 100%)' }}>

        {/* Logo */}
        <div className="px-3 py-4 border-b border-white/8 flex items-center justify-between min-h-[64px]">
          {!collapsed ? (
            <Link href="/" className="flex items-center">
              <svg width="160" height="40" viewBox="0 0 300 72" fill="none" xmlns="http://www.w3.org/2000/svg">
                <circle cx="20" cy="20" r="20" fill="#6AA8A0"/>
                <circle cx="44" cy="20" r="16" fill="#3D7A72"/>
                <circle cx="30" cy="40" r="13" fill="#A0CECC"/>
                <text x="68" y="28" fontFamily="'Plus Jakarta Sans',system-ui,sans-serif" fontSize="26" fontWeight="700" letterSpacing="2" fill="#FFFFFF">TIMBERMAP</text>
                <text x="68" y="46" fontFamily="'Plus Jakarta Sans',system-ui,sans-serif" fontSize="12" fontWeight="400" fill="rgba(255,255,255,0.4)">Powered by Forestech Uy</text>
              </svg>
            </Link>
          ) : (
            <Link href="/" className="mx-auto">
              <svg width="40" height="40" viewBox="0 0 60 72" fill="none" xmlns="http://www.w3.org/2000/svg">
                <circle cx="20" cy="20" r="20" fill="#6AA8A0"/>
                <circle cx="44" cy="20" r="16" fill="#3D7A72"/>
                <circle cx="30" cy="40" r="13" fill="#A0CECC"/>
              </svg>
            </Link>
          )}
        </div>

        {/* Nav */}
        <nav className="flex-1 px-2 py-3 space-y-0.5 overflow-y-auto">
          {nav.map(item => {
            const active = path === item.href || (item.href !== '/dashboard' && path.startsWith(item.href))
            return (
              <Link key={item.href} href={item.href}
                title={collapsed ? item.label : undefined}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition-all ${collapsed ? 'justify-center' : ''} ${
                  active ? 'bg-[#3D7A72]/30 text-white font-medium' : 'text-white/55 hover:text-white hover:bg-white/10'
                }`}>
                <span className={active ? 'text-[#A0CECC]' : 'text-white/35'}>{item.icon}</span>
                {!collapsed && <span className="truncate">{item.label}</span>}
              </Link>
            )
          })}
        </nav>

        {/* Footer */}
        <div className="border-t border-white/8 px-3 py-3">
          <div className={`flex items-center ${collapsed ? 'justify-center' : 'gap-3'} px-1 py-1`}>
            <UserButton>
              {isSuperadmin && (
                <UserButton.MenuItems>
                  <UserButton.Link
                    label="Admin Panel"
                    labelIcon={
                      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" width="16" height="16">
                        <path d="M14 6H6v8h8V6Z"/>
                        <path fillRule="evenodd" d="M9.25 3V1.75a.75.75 0 0 1 1.5 0V3h1.5V1.75a.75.75 0 0 1 1.5 0V3h.5A2.75 2.75 0 0 1 17 5.75v.5h1.25a.75.75 0 0 1 0 1.5H17v1.5h1.25a.75.75 0 0 1 0 1.5H17v1.5h1.25a.75.75 0 0 1 0 1.5H17v.5A2.75 2.75 0 0 1 14.25 17h-.5v1.25a.75.75 0 0 1-1.5 0V17h-1.5v1.25a.75.75 0 0 1-1.5 0V17h-1.5v1.25a.75.75 0 0 1-1.5 0V17h-.5A2.75 2.75 0 0 1 3 14.25v-.5H1.75a.75.75 0 0 1 0-1.5H3v-1.5H1.75a.75.75 0 0 1 0-1.5H3v-1.5H1.75a.75.75 0 0 1 0-1.5H3v-.5A2.75 2.75 0 0 1 5.75 3h.5V1.75a.75.75 0 0 1 1.5 0V3h1.5ZM4.5 5.75c0-.69.56-1.25 1.25-1.25h8.5c.69 0 1.25.56 1.25 1.25v8.5c0 .69-.56 1.25-1.25 1.25h-8.5c-.69 0-1.25-.56-1.25-1.25v-8.5Z" clipRule="evenodd"/>
                      </svg>
                    }
                    href="/dashboard/admin"
                  />
                </UserButton.MenuItems>
              )}
            </UserButton>
            {!collapsed && (
              <span className="text-white/40 text-xs truncate">
                {user?.firstName || user?.emailAddresses?.[0]?.emailAddress?.split('@')[0]}
              </span>
            )}
          </div>
        </div>
      </aside>

      {/* Toggle button */}
      <button onClick={toggle}
        className="fixed top-1/2 -translate-y-1/2 z-40 w-5 h-10 flex items-center justify-center bg-[#1E3835] border border-white/10 rounded-r-lg hover:bg-[#3D7A72] transition-all shadow-md"
        style={{ left: collapsed ? '64px' : '240px' }}
        title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}>
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor"
          className={`w-3 h-3 text-white/50 transition-transform duration-200 ${collapsed ? '' : 'rotate-180'}`}>
          <path fillRule="evenodd" d="M11.78 5.22a.75.75 0 0 1 0 1.06L8.06 10l3.72 3.72a.75.75 0 1 1-1.06 1.06l-4.25-4.25a.75.75 0 0 1 0-1.06l4.25-4.25a.75.75 0 0 1 1.06 0Z" clipRule="evenodd"/>
        </svg>
      </button>
    </>
  )
}