'use client'
import { useEffect, useState } from 'react'
import { useUser } from '@clerk/nextjs'
import Link from 'next/link'

const API = process.env.NEXT_PUBLIC_API_URL || 'https://timbermap-api-tjrp7tcqaa-uc.a.run.app'

type AccountInfo = {
  account_plan: string; plan_expires_at: string | null; is_organization: boolean
  storage_limit_gb: number | null; weekly_job_limit: number | null; has_custom_limits: boolean
  storage_bytes: number; jobs_this_week: number
}

const TIER_LABEL: Record<string, string> = { basic: 'Basic', active: 'Active', custom: 'Custom' }
const TIER_BADGE: Record<string, string> = {
  basic:  'bg-gray-100 text-gray-500',
  active: 'bg-[#EEF7F6] text-[#3D7A72] border border-[#A0CECC]/50',
  custom: 'bg-[#FBF6EA] text-[#96814A] border border-[#E6D9AE]',
}

function fmtBytes(b: number) {
  if (b > 1e9) return (b / 1e9).toFixed(1) + ' GB'
  if (b > 1e6) return (b / 1e6).toFixed(1) + ' MB'
  return (b / 1e3).toFixed(0) + ' KB'
}
function fmtDate(iso: string) {
  return new Date(iso + 'T00:00:00').toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

export default function SubscriptionPage() {
  const { user, isLoaded } = useUser()
  const [account, setAccount]   = useState<AccountInfo | null>(null)
  const [loading, setLoading]   = useState(true)
  const [message, setMessage]   = useState('')
  const [sending, setSending]   = useState(false)
  const [sent, setSent]         = useState(false)

  useEffect(() => {
    if (!isLoaded || !user) return
    fetch(`${API}/account/me`, { headers: { 'x-clerk-id': user.id } })
      .then(r => r.json())
      .then(setAccount)
      .finally(() => setLoading(false))
  }, [isLoaded, user])

  async function submitRequest() {
    if (!user) return
    setSending(true)
    try {
      await fetch(`${API}/account/request-upgrade`, {
        method: 'POST',
        headers: { 'x-clerk-id': user.id, 'Content-Type': 'application/json' },
        body: JSON.stringify({ message }),
      })
      setSent(true)
    } finally { setSending(false) }
  }

  if (loading || !account) {
    return (
      <div className="flex items-center gap-2 text-gray-400 text-sm py-8">
        <svg className="animate-spin w-4 h-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
        </svg>
        Loading subscription...
      </div>
    )
  }

  const tier = account.account_plan
  const storageLimitBytes = account.storage_limit_gb != null ? account.storage_limit_gb * 1e9 : null
  const storagePct = storageLimitBytes ? Math.min(100, (account.storage_bytes / storageLimitBytes) * 100) : 0

  return (
    <div className="max-w-lg">
      <h1 className="text-lg font-semibold text-[#1A2624] mb-1">Subscription</h1>
      <p className="text-sm text-gray-400 mb-6">Your plan, usage and how to upgrade.</p>

      {/* Plan card */}
      <div className="bg-white border border-gray-100 rounded-2xl p-5 mb-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <p className="text-xs text-gray-400 mb-1">Current plan</p>
            <span className={`inline-flex items-center gap-1.5 text-sm font-semibold px-3 py-1 rounded-full ${TIER_BADGE[tier] || TIER_BADGE.basic}`}>
              {TIER_LABEL[tier] || tier}
            </span>
          </div>
          <div className="text-right">
            <p className="text-xs text-gray-400 mb-1">Renews / expires</p>
            <p className="text-sm font-medium text-[#1A2624]">
              {account.plan_expires_at ? fmtDate(account.plan_expires_at) : (tier === 'custom' ? 'Negotiated with your account manager' : 'No expiration')}
            </p>
          </div>
        </div>

        {/* Storage usage */}
        <div>
          <div className="flex items-center justify-between text-xs text-gray-400 mb-1.5">
            <span>Storage used{account.has_custom_limits && <span className="text-[#96814A]"> · custom limit</span>}</span>
            <span className="font-medium text-gray-600">
              {fmtBytes(account.storage_bytes)}{storageLimitBytes ? ` / ${account.storage_limit_gb} GB` : ' (unlimited)'}
            </span>
          </div>
          {storageLimitBytes && (
            <div className="h-1.5 rounded-full bg-gray-100 overflow-hidden">
              <div className={`h-full rounded-full ${storagePct > 90 ? 'bg-red-400' : 'bg-[#6AA8A0]'}`} style={{ width: `${storagePct}%` }} />
            </div>
          )}
        </div>
        {account.weekly_job_limit != null && (
          <p className="text-xs text-gray-400 mt-3">
            <span className="font-medium text-gray-600">{account.jobs_this_week}</span> / {account.weekly_job_limit} processing jobs used this week
          </p>
        )}
      </div>

      {/* Organization */}
      {account.is_organization ? (
        <div className="bg-[#EEF7F6] border border-[#A0CECC]/50 rounded-2xl p-5 mb-5">
          <p className="text-sm font-semibold text-[#2A5750] mb-1">Team account</p>
          <p className="text-xs text-[#3D7A72] mb-3">Usage above is shared across your whole team.</p>
          <Link href="/dashboard/team" className="text-xs font-semibold text-[#3D7A72] hover:underline">
            Manage team →
          </Link>
        </div>
      ) : (
        <div className="bg-white border border-gray-100 rounded-2xl p-5 mb-5">
          <p className="text-sm font-semibold text-[#1A2624] mb-1">Working alone?</p>
          <p className="text-xs text-gray-500 mb-3">
            Create a team to invite teammates onto this account — everyone keeps their own workspace, usage is pooled together.
          </p>
          <Link href="/create-organization"
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#3D7A72] hover:underline">
            Create team →
          </Link>
        </div>
      )}

      {/* Upgrade */}
      {tier !== 'custom' && (
        <div className="bg-[#FBF6EA] border border-[#E6D9AE] rounded-2xl p-5">
          <p className="text-sm font-semibold text-[#7A6839] mb-1">
            {tier === 'basic' ? 'Upgrade to Active or Custom' : 'Upgrade to Custom'}
          </p>
          <p className="text-xs text-[#96814A] mb-4">
            Card payments aren&apos;t live yet — send us a request and we&apos;ll set it up manually and follow up by email.
          </p>
          {sent ? (
            <div className="flex items-center gap-2 text-sm text-[#7A6839] font-medium">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
                <path fillRule="evenodd" d="M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16Zm3.857-9.809a.75.75 0 0 0-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 1 0-1.06 1.061l2.5 2.5a.75.75 0 0 0 1.137-.089l4-5.5Z" clipRule="evenodd"/>
              </svg>
              Request sent — we&apos;ll be in touch shortly.
            </div>
          ) : (
            <>
              <textarea
                value={message}
                onChange={e => setMessage(e.target.value)}
                placeholder="Tell us about your operation and what you need (optional)"
                rows={3}
                className="w-full text-sm border border-[#E6D9AE] rounded-xl px-3 py-2 mb-3 bg-white focus:outline-none focus:border-[#C9AD6C] resize-none placeholder-[#C4B48A]"
              />
              <button
                onClick={submitRequest}
                disabled={sending}
                className="cursor-pointer inline-flex items-center gap-2 bg-[#96814A] hover:bg-[#7A6839] text-white text-sm font-semibold px-4 py-2 rounded-xl transition-colors disabled:opacity-50">
                {sending ? 'Sending...' : 'Request upgrade'}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  )
}
