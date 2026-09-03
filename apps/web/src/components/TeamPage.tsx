'use client'
import { useUser } from '@clerk/nextjs'
import { useState, useEffect, useCallback } from 'react'

const API = process.env.NEXT_PUBLIC_API_URL || 'https://timbermap-api-tjrp7tcqaa-uc.a.run.app'

type Teammate = { clerk_id: string; email: string; username: string; org_role: string | null }
type AccountModel = { id: string; name: string; pipeline_type: string }
type PendingInvite = { id: string; email: string; created_at: string; expires_at: string }
type AccountInfo = {
  org_role: string | null
  is_organization: boolean
  team_name: string | null
  teammates: Teammate[]
  account_models: AccountModel[]
  teammate_models: Record<string, string[]>
  pending_invites: PendingInvite[]
}

const SpinIcon = () => <svg className="animate-spin w-4 h-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>
const CheckIcon = () => <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" width="14" height="14"><path fillRule="evenodd" d="M16.704 4.153a.75.75 0 0 1 .143 1.052l-8 10.5a.75.75 0 0 1-1.127.075l-4.5-4.5a.75.75 0 0 1 1.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 0 1 1.05-.143Z" clipRule="evenodd"/></svg>
const TrashIcon = () => <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" width="14" height="14"><path fillRule="evenodd" d="M8.75 1A2.75 2.75 0 0 0 6 3.75v.443c-.795.077-1.584.176-2.365.298a.75.75 0 1 0 .23 1.482l.149-.022.841 10.518A2.75 2.75 0 0 0 7.596 19h4.807a2.75 2.75 0 0 0 2.742-2.53l.841-10.52.149.023a.75.75 0 0 0 .23-1.482A41.03 41.03 0 0 0 14 4.193V3.75A2.75 2.75 0 0 0 11.25 1h-2.5ZM10 4c.84 0 1.673.025 2.5.075V3.75c0-.69-.56-1.25-1.25-1.25h-2.5c-.69 0-1.25.56-1.25 1.25v.325C8.327 4.025 9.16 4 10 4ZM8.58 7.72a.75.75 0 0 0-1.5.06l.3 7.5a.75.75 0 1 0 1.5-.06l-.3-7.5Zm4.34.06a.75.75 0 1 0-1.5-.06l-.3 7.5a.75.75 0 1 0 1.5.06l.3-7.5Z" clipRule="evenodd"/></svg>

export default function TeamPage({ compact = false }: { compact?: boolean }) {
  const { user, isLoaded } = useUser()
  const [info, setInfo]     = useState<AccountInfo | null>(null)
  const [loading, setLoading] = useState(true)
  const [acting, setActing] = useState<string | null>(null)
  const [teamName, setTeamName] = useState('')
  const [creating, setCreating] = useState(false)
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviting, setInviting] = useState(false)
  const [inviteSent, setInviteSent] = useState(false)
  const [error, setError] = useState('')
  const h: Record<string, string> = user ? { 'x-clerk-id': user.id, 'Content-Type': 'application/json' } : { 'Content-Type': 'application/json' }

  const load = useCallback(() => {
    if (!user) return
    fetch(`${API}/account/me`, { headers: { 'x-clerk-id': user.id } })
      .then(r => r.ok ? r.json() : null)
      .then(setInfo)
      .finally(() => setLoading(false))
  }, [user])

  useEffect(() => { if (isLoaded && user) load() }, [isLoaded, user, load])

  async function handleCreateTeam(e: React.FormEvent) {
    e.preventDefault()
    if (!teamName.trim()) return
    setCreating(true); setError('')
    try {
      const r = await fetch(`${API}/account/team`, { method: 'POST', headers: h, body: JSON.stringify({ name: teamName.trim() }) })
      if (!r.ok) { const d = await r.json().catch(() => ({})); throw new Error(d.detail || 'Failed to create team') }
      setTeamName('')
      load()
    } catch (e) { setError(String(e instanceof Error ? e.message : e)) }
    finally { setCreating(false) }
  }

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault()
    if (!inviteEmail.trim()) return
    setInviting(true); setError('')
    try {
      const r = await fetch(`${API}/account/team/invite`, { method: 'POST', headers: h, body: JSON.stringify({ email: inviteEmail.trim() }) })
      if (!r.ok) { const d = await r.json().catch(() => ({})); throw new Error(d.detail || 'Failed to send invite') }
      setInviteEmail('')
      setInviteSent(true)
      setTimeout(() => setInviteSent(false), 3000)
      load()
    } catch (e) { setError(String(e instanceof Error ? e.message : e)) }
    finally { setInviting(false) }
  }

  async function cancelInvite(id: string) {
    setActing(`invite:${id}`)
    await fetch(`${API}/account/team/invite/${id}`, { method: 'DELETE', headers: h })
    load()
    setActing(null)
  }

  async function leaveTeam() {
    if (!confirm("Leave this team? You'll get your own personal account back on the free plan.")) return
    setActing('leave')
    try {
      const r = await fetch(`${API}/account/team/leave`, { method: 'POST', headers: h })
      if (!r.ok) { const d = await r.json().catch(() => ({})); throw new Error(d.detail || 'Failed to leave team') }
      load()
    } catch (e) { setError(String(e instanceof Error ? e.message : e)) }
    finally { setActing(null) }
  }

  async function removeTeammate(clerkId: string) {
    if (!confirm('Remove this teammate? They’ll get their own personal account back.')) return
    setActing(`remove:${clerkId}`)
    await fetch(`${API}/account/teammates/${clerkId}`, { method: 'DELETE', headers: h })
    load()
    setActing(null)
  }

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
        <form onSubmit={handleCreateTeam} className="bg-white border border-gray-100 rounded-2xl p-5">
          <label className="text-xs font-medium text-gray-500 block mb-1.5">Team name</label>
          <input value={teamName} onChange={e => setTeamName(e.target.value)}
            placeholder="e.g. Acme Forestry"
            className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-800 focus:outline-none focus:border-[#6AA8A0] focus:ring-1 focus:ring-[#6AA8A0] mb-3" />
          {error && <p className="text-xs text-red-500 mb-3">{error}</p>}
          <button type="submit" disabled={creating || !teamName.trim()}
            className="w-full bg-[#3D7A72] hover:bg-[#2A5750] text-white font-semibold text-sm py-2.5 rounded-xl transition-colors disabled:opacity-50 cursor-pointer">
            {creating ? 'Creating...' : 'Create team'}
          </button>
        </form>
      </div>
    )
  }

  // Member of a team, not an admin — read-only view
  if (info.org_role !== 'admin') {
    return (
      <div className={`max-w-lg ${compact ? 'max-h-[70vh] overflow-y-auto pr-1' : ''}`}>
        <h1 className="text-lg font-semibold text-[#1A2624] mb-1">{info.team_name}</h1>
        <p className="text-sm text-gray-400 mb-6">You&apos;re a member of this team. Storage and processing count against your team&apos;s shared plan.</p>
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
        {error && <p className="text-xs text-red-500 mt-3">{error}</p>}
        <button onClick={leaveTeam} disabled={acting === 'leave'}
          className="mt-4 text-sm text-gray-400 hover:text-red-500 transition-colors disabled:opacity-50 cursor-pointer">
          {acting === 'leave' ? 'Leaving...' : 'Leave team'}
        </button>
      </div>
    )
  }

  // Admin — full management
  return (
    <div className={`w-full ${compact ? 'max-h-[70vh] overflow-y-auto pr-1' : ''}`}>
      <div className="mb-6">
        <h1 className="text-lg font-semibold text-[#1A2624] mb-1">{info.team_name}</h1>
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
                  <th></th>
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
                    <td className="text-center px-3 py-2.5">
                      <button onClick={() => removeTeammate(t.clerk_id)} disabled={acting === `remove:${t.clerk_id}`}
                        className="text-gray-300 hover:text-red-500 transition-colors disabled:opacity-50" title="Remove from team">
                        {acting === `remove:${t.clerk_id}` ? <SpinIcon /> : <TrashIcon />}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Invite teammates */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 mb-6">
        <p className="text-xs font-medium tracking-widest uppercase text-gray-400 mb-4">Invite a teammate</p>
        <form onSubmit={handleInvite} className="flex gap-2 mb-2">
          <input type="email" value={inviteEmail} onChange={e => setInviteEmail(e.target.value)}
            placeholder="teammate@company.com" required
            className="flex-1 border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-700 focus:outline-none focus:border-[#6AA8A0] focus:ring-1 focus:ring-[#6AA8A0]" />
          <button type="submit" disabled={inviting}
            className="bg-[#3D7A72] hover:bg-[#2A5750] text-white text-sm font-medium px-4 py-2 rounded-xl transition-colors disabled:opacity-50 cursor-pointer whitespace-nowrap">
            {inviting ? 'Sending...' : 'Send invite'}
          </button>
        </form>
        {inviteSent && <p className="text-xs text-[#3D7A72] font-medium">Invite sent!</p>}
        {error && <p className="text-xs text-red-500">{error}</p>}

        {info.pending_invites.length > 0 && (
          <div className="mt-4 pt-4 border-t border-gray-100">
            <p className="text-xs font-medium tracking-widest uppercase text-gray-400 mb-2">Pending</p>
            <div className="space-y-1.5">
              {info.pending_invites.map(inv => (
                <div key={inv.id} className="flex items-center justify-between py-1">
                  <span className="text-sm text-gray-600">{inv.email}</span>
                  <button onClick={() => cancelInvite(inv.id)} disabled={acting === `invite:${inv.id}`}
                    className="text-xs text-gray-400 hover:text-red-500 transition-colors disabled:opacity-50">
                    {acting === `invite:${inv.id}` ? '...' : 'Cancel'}
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
