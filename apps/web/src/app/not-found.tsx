'use client'
import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

export default function NotFound() {
  const router = useRouter()

  useEffect(() => {
    router.replace('/dashboard')
  }, [router])

  return (
    <div className="min-h-screen bg-[#F4F7F7] flex items-center justify-center">
      <div className="w-6 h-6 border-2 border-[#3D7A72] border-t-transparent rounded-full animate-spin"/>
    </div>
  )
}
