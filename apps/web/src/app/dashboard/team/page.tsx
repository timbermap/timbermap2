'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useUser } from '@clerk/nextjs'
import TeamPage from '@/components/TeamPage'

const API = process.env.NEXT_PUBLIC_API_URL || 'https://timbermap-api-tjrp7tcqaa-uc.a.run.app'

export default function TeamRoute() {
  const { user, isLoaded } = useUser()
  const router = useRouter()
  const [allowed, setAllowed] = useState<boolean | null>(null)

  useEffect(() => {
    if (!isLoaded || !user) return
    fetch(`${API}/account/me`, { headers: { 'x-clerk-id': user.id } })
      .then(r => r.ok ? r.json() : null)
      .then(d => setAllowed(d?.account_plan !== 'basic'))
      .catch(() => setAllowed(true))
  }, [isLoaded, user])

  useEffect(() => {
    if (allowed === false) router.replace('/dashboard')
  }, [allowed, router])

  if (!isLoaded || allowed === null || allowed === false) {
    return (
      <div className="flex items-center gap-2 text-gray-400 py-16 justify-center text-sm">
        <span className="w-4 h-4 border-2 border-[#3D7A72] border-t-transparent rounded-full animate-spin"/>
        Loading...
      </div>
    )
  }

  return (
    <div className="w-full max-w-4xl">
      <TeamPage />
    </div>
  )
}
