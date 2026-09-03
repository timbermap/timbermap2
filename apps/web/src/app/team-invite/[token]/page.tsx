'use client'
import Link from 'next/link'
import { useEffect, useState, useCallback, useRef } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useUser, SignInButton } from '@clerk/nextjs'

const API = process.env.NEXT_PUBLIC_API_URL || 'https://timbermap-api-tjrp7tcqaa-uc.a.run.app'

type Invite = { email: string; team_name: string; status: string; expires_at: string }

export default function TeamInvitePage() {
  const { token } = useParams<{ token: string }>()
  const router = useRouter()
  const { user, isSignedIn, isLoaded } = useUser()
  const [invite, setInvite] = useState<Invite | null | 'notfound'>(null)
  const [error, setError] = useState('')
  const attempted = useRef(false)

  const loadInvite = useCallback(() => {
    fetch(`${API}/account/team/invite/${token}`)
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(setInvite)
      .catch(() => setInvite('notfound'))
  }, [token])

  useEffect(() => { loadInvite() }, [loadInvite])

  const handleAccept = useCallback(async () => {
    if (!user) return
    setError('')
    try {
      const r = await fetch(`${API}/account/team/invite/${token}/accept`, {
        method: 'POST',
        headers: { 'x-clerk-id': user.id, 'Content-Type': 'application/json' },
      })
      if (!r.ok) { const d = await r.json().catch(() => ({})); throw new Error(d.detail || 'Failed to accept invite') }
      router.push('/dashboard')
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e))
      attempted.current = false
    }
  }, [user, token, router])

  // Auto-accept the moment we know who's signed in — including right after
  // bouncing back from an SSO provider — so there's no extra manual click
  // needed on top of the unavoidable OAuth redirect.
  useEffect(() => {
    if (!isLoaded || !isSignedIn || !invite || invite === 'notfound') return
    if (invite.status !== 'pending' || new Date(invite.expires_at) < new Date()) return
    if (attempted.current) return
    attempted.current = true
    handleAccept()
  }, [isLoaded, isSignedIn, invite, handleAccept])

  return (
    <div className="min-h-screen bg-[#F7F8F6] flex flex-col items-center justify-center px-6 text-center">
      <Link href="/" className="font-semibold text-[#2C5F45] text-lg tracking-wide mb-10">Timbermap</Link>

      {invite === null && (
        <div className="flex items-center gap-2 text-gray-400 text-sm">
          <span className="w-4 h-4 border-2 border-[#3D7A72] border-t-transparent rounded-full animate-spin" />
          Loading invite...
        </div>
      )}

      {invite === 'notfound' && (
        <div className="bg-white border border-gray-100 rounded-2xl p-8 max-w-sm">
          <p className="text-gray-500 text-sm">This invite doesn&apos;t exist or has been cancelled.</p>
          <Link href="/" className="text-[#3D7A72] font-medium hover:underline text-sm mt-3 inline-block">← Back home</Link>
        </div>
      )}

      {invite && invite !== 'notfound' && (
        <div className="bg-white border border-gray-100 rounded-2xl p-8 max-w-sm w-full">
          {invite.status === 'accepted' ? (
            <p className="text-gray-500 text-sm">This invite has already been accepted.</p>
          ) : invite.status !== 'pending' || new Date(invite.expires_at) < new Date() ? (
            <p className="text-gray-500 text-sm">This invite is no longer valid — ask your team admin to send a new one.</p>
          ) : (
            <>
              <p className="text-xs font-semibold text-[#6AA8A0] uppercase tracking-wide mb-1">Team invite</p>
              <h1 className="text-xl font-semibold text-[#1A2624] mb-2">Join {invite.team_name}</h1>
              <p className="text-sm text-gray-500 mb-6">Invited as {invite.email}</p>

              {!isLoaded ? (
                <div className="flex items-center gap-2 text-gray-400 text-sm justify-center py-2">
                  <span className="w-4 h-4 border-2 border-[#3D7A72] border-t-transparent rounded-full animate-spin" />
                </div>
              ) : isSignedIn ? (
                <>
                  {error ? (
                    <>
                      <p className="text-xs text-red-500 mb-3">{error}</p>
                      <button onClick={() => { attempted.current = false; handleAccept() }}
                        className="w-full bg-[#3D7A72] hover:bg-[#2A5750] text-white font-semibold text-sm py-2.5 rounded-xl transition-colors cursor-pointer">
                        Try again →
                      </button>
                    </>
                  ) : (
                    <div className="flex items-center gap-2 text-gray-400 text-sm justify-center py-2">
                      <span className="w-4 h-4 border-2 border-[#3D7A72] border-t-transparent rounded-full animate-spin" />
                      Joining {invite.team_name}...
                    </div>
                  )}
                  {user?.primaryEmailAddress?.emailAddress !== invite.email && (
                    <p className="text-xs text-amber-600 mt-3">
                      You&apos;re signed in as {user?.primaryEmailAddress?.emailAddress}, not the invited address —
                      joining anyway.
                    </p>
                  )}
                </>
              ) : (
                <SignInButton mode="modal" forceRedirectUrl={`/team-invite/${token}`}>
                  <button className="w-full bg-[#3D7A72] hover:bg-[#2A5750] text-white font-semibold text-sm py-2.5 rounded-xl transition-colors cursor-pointer">
                    Sign in to accept →
                  </button>
                </SignInButton>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}
