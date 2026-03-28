'use client'
import Sidebar from '@/components/Sidebar'
import { useState, useEffect } from 'react'

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(false)

  useEffect(() => {
    const sync = () => setCollapsed(localStorage.getItem('sidebar-collapsed') === 'true')
    sync()
    const interval = setInterval(sync, 100)
    return () => clearInterval(interval)
  }, [])

  return (
    <div className="min-h-screen bg-[#F4F7F7]">
      <Sidebar />
      <main
        className="transition-all duration-200 min-h-screen"
        style={{ marginLeft: collapsed ? '64px' : '240px' }}>
        <div className="p-4 sm:p-6 lg:p-8 max-w-[1600px]">
          {children}
        </div>
      </main>
    </div>
  )
}
