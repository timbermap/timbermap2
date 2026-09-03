'use client'
import Sidebar from '@/components/Sidebar'
import { useState, useEffect } from 'react'
import { useUser } from '@clerk/nextjs'

const API = process.env.NEXT_PUBLIC_API_URL || 'https://timbermap-api-tjrp7tcqaa-uc.a.run.app'

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(true)
  const { user, isLoaded } = useUser()
  const [accountReady, setAccountReady] = useState(false)

  useEffect(() => {
    const sync = () => {
      const val = localStorage.getItem('sidebar-collapsed')
      setCollapsed(val === null ? true : val === 'true')
    }
    sync()
    const interval = setInterval(sync, 100)
    return () => clearInterval(interval)
  }, [])

  // Provisions the users row if the Clerk webhook hasn't landed yet (still
  // not registered as of writing) — without this, a brand-new user 404s on
  // any dashboard endpoint until their first file upload. Sidebar and all
  // page content wait on this instead of firing in parallel with it, so
  // there's no race where another fetch (e.g. Sidebar's own /account/me)
  // reaches the DB before this row exists.
  useEffect(() => {
    if (!isLoaded || !user) return
    fetch(`${API}/account/ensure`, {
      method: 'POST',
      headers: { 'x-clerk-id': user.id, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: user.primaryEmailAddress?.emailAddress || '',
        username: user.username || user.primaryEmailAddress?.emailAddress?.split('@')[0] || '',
      }),
    }).catch(() => {}).finally(() => setAccountReady(true))
  }, [isLoaded, user])

  if (!isLoaded || !accountReady) {
    return (
      <div className="min-h-screen bg-[#F4F7F7] flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-[#3D7A72] border-t-transparent rounded-full animate-spin"/>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#F4F7F7]">
      <Sidebar />
      <main
        className="transition-all duration-200 min-h-screen"
        style={{ marginLeft: collapsed ? '64px' : '240px' }}>
        <div className="p-4 sm:p-6 lg:p-8">
          {children}
        </div>
      </main>
    </div>
  )
}
