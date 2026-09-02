'use client'
import { useUser, useOrganization, OrganizationProfile, CreateOrganization } from '@clerk/nextjs'
import { useState, useEffect, useCallback } from 'react'

const API = process.env.NEXT_PUBLIC_API_URL || 'https://timbermap-api-tjrp7tcqaa-uc.a.run.app'

type Teammate = { clerk_id: string; email: string; username: string; org_role: string | null }
type AccountModel = { id: string; name: string; pipeline_type: string }
type AccountInfo = {
  org_role: string | null
  is_organization: boolean
  teammates: Teammate[]
  account_models: AccountModel[]
  teammate_models: Record<string, string[]>
}

const SpinIcon = () => <svg className="animate-spin w-4 h-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>
const CheckIcon = () => <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" width="14" height="14"><path fillRule="evenodd" d="M16.704 4.153a.75.75 0 0 1 .143 1.052l-8 10.5a.75.75 0 0 1-1.127.075l-4.5-4.5a.75.75 0 0 1 1.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 0 1 1.05-.143Z" clipRule="evenodd"/></svg>

export default function TeamPage({ compact = false }: { compact?: boolean }) {
  const { user, isLoaded } = useUser()
  const { organization } = useOrganization()
  const [info, setInfo]     = useState<AccountInfo | null>(null)
  const [loading, setLoading] = useState(true)
  const [acting, setActing] = useState<string | null>(null)
  const h: Record<string, string> = user ? { 'x-clerk-id': user.id } : {}

  const load = useCallback(() => {
    if (!user) return
    fetch(`${API}/account/me`, { headers: { 'x-clerk-id': user.id } })
      .then(r => r.ok ? r.json() : null)
      .then(setInfo)
      .finally(() => setLoading(false))
  }, [user])

  useEffect(() => { if (isLoaded && user) load() }, [isLoaded, user, load])
  // Clerk sets the newly created org as active on its own client-side state
  // immediately — no navigation needed, just re-check our own DB once that
  // happens (the webhook that syncs it usually beats this by a beat, but
  // load() is cheap and harmless to call again if it hasn't yet).
  // Keyed on organization?.id, not the object itself — Clerk hands out a
  // new object reference on every internal revalidation (several per
  // second right after creating an org), which was retriggering load() in
  // a tight loop and made the UI look permanently stuck on "Loading team".
  useEffect(() => { if (organization && isLoaded && user) load() }, [organization?.id, isLoaded, user, load])

  async function toggleModel(teammateClerkId: string, modelId: string, hasAccess: boolean) {
    const key = `${teammateClerkId}:${modelId}`
    setActing(key)
    await fetch(`${API}/account/teammates/${teammateClerkId}/models/${modelId}`, {
      method: hasAccess ? 'DELETE' : 'POST', headers: h,
    })
    load()
    setActing(null)
  }

  if (!isLoaded || loading) {
    return (
      <div className="flex items-center gap-2 text-gray-400 py-16 justify-center text-sm">
        <SpinIcon />Loading team...
      </div>
    )
  }

  // Not part of a team yet
  if (!info || !info.is_organization) {
    return (
      <div className={`max-w-lg ${compact ? 'max-h-[70vh] overflow-y-auto pr-1' : ''}`}>
        <h1 className="text-lg font-semibold text-[#1A2624] mb-1">Team</h1>
        <p className="text-sm text-gray-400 mb-6">You&apos;re not part of a team yet.</p>
        <div className="bg-white border border-gray-100 rounded-2xl p-5 mb-5">
          <p className="text-sm font-semibold text-[#1A2624] mb-3">Creating a team lets you:</p>
          <ul className="space-y-2">
            {[
              'Invite teammates onto your account',
              'Share storage and processing quota across everyone',
              'Control which models each teammate can access',
            ].map(line => (
              <li key={line} className="flex items-start gap-2 text-sm text-gray-600">
                <span className="text-[#3D7A72] mt-0.5"><CheckIcon /></span>
                {line}
              </li>
            ))}
          </ul>
        </div>
        <div className="bg-white border border-gray-100 rounded-2xl overflow-hidden">
          <CreateOrganization
            appearance={{
              elements: {
                rootBox: 'w-full', card: 'shadow-none border-0 w-full p-4',
                headerTitle: 'hidden', headerSubtitle: 'hidden',
                formButtonPrimary: 'bg-[#3D7A72] hover:bg-[#2A5750] text-white',
                footerActionLink: 'text-[#3D7A72] hover:text-[#2A5750]',
              },
            }}
          />
        </div>
      </div>
    )
  }

  // Member of a team, not an admin — read-only view
  if (info.org_role !== 'admin') {
    return (
      <div className={`max-w-lg ${compact ? 'max-h-[70vh] overflow-y-auto pr-1' : ''}`}>
        <h1 className="text-lg font-semibold text-[#1A2624] mb-1">Team</h1>
        <p className="text-sm text-gray-400 mb-6">You&apos;re a member of a team. Storage and processing count against your team&apos;s shared plan.</p>
        <div className="bg-white border border-gray-100 rounded-2xl p-5">
          <p className="text-xs font-medium tracking-widest uppercase text-gray-400 mb-3">Members</p>
          <div className="space-y-2">
            {info.teammates.map(t => (
              <div key={t.clerk_id} className="flex items-center justify-between py-1.5">
                <div>
                  <p className="text-sm text-gray-700 font-medium">{t.email}</p>
                  <p className="text-xs text-gray-400">{t.username}</p>
                </div>
                {t.org_role && <span className="text-xs px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-500 font-medium">{t.org_role}</span>}
              </div>
            ))}
          </div>
          <p className="text-xs text-gray-300 mt-4">Ask your team admin to invite others or change model access.</p>
        </div>
      </div>
    )
  }

  // Admin — full management
  return (
    <div className={`w-full ${compact ? 'max-h-[70vh] overflow-y-auto pr-1' : ''}`}>
      <div className="mb-6">
        <h1 className="text-lg font-semibold text-[#1A2624] mb-1">Team</h1>
        <p className="text-sm text-gray-400">
          Invite teammates and control which models each of them can use. Storage and processing count against your team&apos;s shared plan.
        </p>
      </div>

      {/* Model access per teammate */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 mb-6">
        <p className="text-xs font-medium tracking-widest uppercase text-gray-400 mb-4">Model access</p>
        {info.teammates.length === 0 ? (
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

      {/* Invite / manage members — Clerk's own UI, embedded inline. Never a
          link to another page — the whole tab (including this) scrolls as
          one unit in the user-menu popover instead. */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="p-5 pb-0">
          <p className="text-xs font-medium tracking-widest uppercase text-gray-400">Invite &amp; manage members</p>
        </div>
        <OrganizationProfile
          appearance={{ elements: { rootBox: 'w-full', card: 'shadow-none border-0 w-full' } }}
        />
      </div>
    </div>
  )
}
