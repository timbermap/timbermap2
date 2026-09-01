'use client'
import { useUser, OrganizationProfile } from '@clerk/nextjs'
import { useRouter } from 'next/navigation'
import { useState, useEffect, useCallback } from 'react'

const API = process.env.NEXT_PUBLIC_API_URL || 'https://timbermap-api-788407107542.us-central1.run.app'

type Teammate = { clerk_id: string; email: string; username: string; org_role: string | null }
type AccountModel = { id: string; name: string; pipeline_type: string }
type AccountInfo = {
  org_role: string | null
  account_plan: string
  teammates: Teammate[]
  account_models: AccountModel[]
  teammate_models: Record<string, string[]>
}

const SpinIcon = () => <svg className="animate-spin w-4 h-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>
const CheckIcon = () => <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" width="14" height="14"><path fillRule="evenodd" d="M16.704 4.153a.75.75 0 0 1 .143 1.052l-8 10.5a.75.75 0 0 1-1.127.075l-4.5-4.5a.75.75 0 0 1 1.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 0 1 1.05-.143Z" clipRule="evenodd"/></svg>

export default function TeamPage() {
  const { user, isLoaded } = useUser()
  const router = useRouter()
  const [info, setInfo]         = useState<AccountInfo | null>(null)
  const [authorized, setAuthorized] = useState<boolean | null>(null)
  const [acting, setActing]     = useState<string | null>(null)
  const h: Record<string, string> = user ? { 'x-clerk-id': user.id } : {}

  const load = useCallback(() => {
    if (!user) return
    fetch(`${API}/account/me`, { headers: { 'x-clerk-id': user.id } })
      .then(r => r.ok ? r.json() : null)
      .then((d: AccountInfo | null) => {
        setInfo(d)
        setAuthorized(!!d && d.org_role === 'admin')
      })
      .catch(() => setAuthorized(false))
  }, [user])

  useEffect(() => { if (isLoaded && user) load() }, [isLoaded, user, load])

  async function toggleModel(teammateClerkId: string, modelId: string, hasAccess: boolean) {
    const key = `${teammateClerkId}:${modelId}`
    setActing(key)
    await fetch(`${API}/account/teammates/${teammateClerkId}/models/${modelId}`, {
      method: hasAccess ? 'DELETE' : 'POST', headers: h,
    })
    load()
    setActing(null)
  }

  if (!isLoaded || authorized === null) {
    return (
      <div className="flex items-center gap-2 text-gray-400 py-16 justify-center">
        <SpinIcon />Checking access...
      </div>
    )
  }

  if (!authorized) {
    return (
      <div className="max-w-md mx-auto py-16 text-center">
        <p className="text-gray-500 font-medium">Access denied</p>
        <p className="text-gray-300 text-sm mt-1">Only an account admin can manage a team</p>
        <button onClick={() => router.push('/dashboard')} className="mt-4 text-sm text-[#6AA8A0] hover:underline">
          Back to dashboard
        </button>
      </div>
    )
  }

  return (
    <div className="w-full max-w-4xl">
      <div className="mb-6">
        <p className="text-xs font-medium tracking-widest uppercase text-[#6AA8A0] mb-1">Admin</p>
        <h1 className="text-2xl font-semibold text-[#1C1C1C]">Your team</h1>
        <p className="text-gray-400 mt-1 text-sm">
          Invite teammates and control which models each of them can use. Storage and processing count against your account&apos;s shared plan.
        </p>
      </div>

      {/* Model access per teammate */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 mb-6">
        <p className="text-xs font-medium tracking-widest uppercase text-gray-400 mb-4">Model access</p>
        {!info || info.teammates.length === 0 ? (
          <p className="text-sm text-gray-300">No teammates yet — invite someone below.</p>
        ) : info.account_models.length === 0 ? (
          <p className="text-sm text-gray-300">You don&apos;t have access to any models yet, so there&apos;s nothing to hand out.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="text-sm w-full">
              <thead>
                <tr className="border-b border-gray-100">
                  <th className="text-left px-3 py-2 text-xs font-medium tracking-widest uppercase text-gray-400">Teammate</th>
                  {info.account_models.map(m => (
                    <th key={m.id} className="text-center px-3 py-2 text-xs font-medium text-gray-400 whitespace-nowrap">{m.name}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {info.teammates.map(t => (
                  <tr key={t.clerk_id} className="border-b border-gray-50">
                    <td className="px-3 py-2.5">
                      <p className="text-gray-700 font-medium">{t.email}</p>
                      <p className="text-xs text-gray-400">{t.username}</p>
                    </td>
                    {info.account_models.map(m => {
                      const hasAccess = (info.teammate_models[t.clerk_id] || []).includes(m.id)
                      const key = `${t.clerk_id}:${m.id}`
                      return (
                        <td key={m.id} className="text-center px-3 py-2.5">
                          <button onClick={() => toggleModel(t.clerk_id, m.id, hasAccess)} disabled={acting === key}
                            className={`inline-flex items-center justify-center w-7 h-7 rounded-lg border transition-colors disabled:opacity-50 ${
                              hasAccess
                                ? 'bg-[#EEF7F6] text-[#3D7A72] border-[#A0CECC]'
                                : 'bg-gray-50 text-gray-300 border-gray-200 hover:border-[#A0CECC] hover:text-[#6AA8A0]'
                            }`}>
                            {acting === key ? <SpinIcon /> : (hasAccess ? <CheckIcon /> : null)}
                          </button>
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Invite / manage members — Clerk's own UI */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="p-5 pb-0">
          <p className="text-xs font-medium tracking-widest uppercase text-gray-400">Invite &amp; manage members</p>
        </div>
        <OrganizationProfile
          routing="hash"
          appearance={{ elements: { rootBox: 'w-full', card: 'shadow-none border-0 w-full' } }}
        />
      </div>
    </div>
  )
}
