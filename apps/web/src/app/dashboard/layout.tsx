'use client'

import { ClerkLoading, ClerkLoaded } from '@clerk/nextjs'
import Sidebar from '@/components/Sidebar'
import Spinner from '@/components/Spinner'

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="min-h-screen bg-[#F8F8F6]">
      <Sidebar />

      <main className="ml-60 p-10">
        <ClerkLoading>
          <div className="flex items-center justify-center min-h-[60vh]">
            <Spinner text="Cargando usuario..." />
          </div>
        </ClerkLoading>

        <ClerkLoaded>
          {children}
        </ClerkLoaded>
      </main>
    </div>
  )
}