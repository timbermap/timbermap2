'use client'
import { useUser } from '@clerk/nextjs'
import { useState, useEffect } from 'react'
import Link from 'next/link'

type ImageFile = { id: string; filename: string; status: string; area_ha: number | null; created_at: string }
type VectorFile = { id: string; filename: string; status: string; area_ha: number | null; created_at: string }
type Job = {
  id: string; type: string; status: string
  model_name?: string; image_filename?: string
  created_at: string; started_at?: string; finished_at?: string
}
type Model = { id: string; name: string; is_free: boolean; has_access: boolean }

const API = process.env.NEXT_PUBLIC_API_URL || 'https://timbermap-api-tjrp7tcqaa-uc.a.run.app'

const TYPE_LABEL: Record<string, string> = {
  raster_ingest:    'Raster ingest',
  vector_ingest:    'Vector ingest',
  raster_transform: 'Image transform',
  vector_transform: 'Vector transform',
  ml_inference:     'AI inference',
  model_run:        'AI inference',
  delete:           'Delete',
}

const STATUS: Record<string, { label: string; cls: string }> = {
  done:    { label: 'Completed', cls: 'bg-[#EEF7F6] text-[#3D7A72]' },
  running: { label: 'Running',   cls: 'bg-blue-50 text-blue-600' },
  queued:  { label: 'Queued',    cls: 'bg-amber-50 text-amber-600' },
  failed:  { label: 'Failed',    cls: 'bg-red-50 text-red-500' },
}

function formatDuration(s?: string, f?: string) {
  if (!s || !f) return null
  const ms = new Date(f).getTime() - new Date(s).getTime()
  if (ms <= 0) return null
  const sec = Math.floor(ms / 1000)
  const min = Math.floor(sec / 60)
  return min === 0 ? `${sec}s` : `${min}m ${sec % 60}s`
}

function formatRelative(iso: string) {
  const diff = Date.now() - new Date(iso).getTime()
  const h = Math.floor(diff / 3600000)
  if (h < 1) { const m = Math.floor(diff / 60000); return m <= 0 ? 'just now' : `${m}m ago` }
  if (h < 24) return `${h}h ago`
  if (h < 48) return 'Yesterday'
  return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })
}

function formatHa(ha: number) {
  if (ha >= 10000) return `${(ha / 1000).toFixed(0)}k`
  if (ha >= 1000) return `${(ha / 1000).toFixed(1)}k`
  return Math.round(ha).toLocaleString()
}

function isThisWeek(iso: string) {
  return new Date(iso) >= new Date(Date.now() - 7 * 24 * 3600_000)
}

// ── Icons ─────────────────────────────────────────────────────────────────────
const JobIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5 text-[#6AA8A0]">
    <path d="M14 6H6v8h8V6Z"/>
    <path fillRule="evenodd" d="M9.25 3V1.75a.75.75 0 0 1 1.5 0V3h1.5V1.75a.75.75 0 0 1 1.5 0V3h.5A2.75 2.75 0 0 1 17 5.75v.5h1.25a.75.75 0 0 1 0 1.5H17v1.5h1.25a.75.75 0 0 1 0 1.5H17v1.5h1.25a.75.75 0 0 1 0 1.5H17v.5A2.75 2.75 0 0 1 14.25 17h-.5v1.25a.75.75 0 0 1-1.5 0V17h-1.5v1.25a.75.75 0 0 1-1.5 0V17h-1.5v1.25a.75.75 0 0 1-1.5 0V17h-.5A2.75 2.75 0 0 1 3 14.25v-.5H1.75a.75.75 0 0 1 0-1.5H3v-1.5H1.75a.75.75 0 0 1 0-1.5H3v-1.5H1.75a.75.75 0 0 1 0-1.5H3v-.5A2.75 2.75 0 0 1 5.75 3h.5V1.75a.75.75 0 0 1 1.5 0V3h1.5ZM4.5 5.75c0-.69.56-1.25 1.25-1.25h8.5c.69 0 1.25.56 1.25 1.25v8.5c0 .69-.56 1.25-1.25 1.25h-8.5c-.69 0-1.25-.56-1.25-1.25v-8.5Z" clipRule="evenodd"/>
  </svg>
)
const IngestIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5 text-[#6AA8A0]">
    <path d="M9.25 13.25a.75.75 0 0 0 1.5 0V4.636l2.955 3.129a.75.75 0 0 0 1.09-1.03l-4.25-4.5a.75.75 0 0 0-1.09 0l-4.25 4.5a.75.75 0 1 0 1.09 1.03L9.25 4.636v8.614Z"/>
    <path d="M3.5 12.75a.75.75 0 0 0-1.5 0v2.5A2.75 2.75 0 0 0 4.75 18h10.5A2.75 2.75 0 0 0 18 15.25v-2.5a.75.75 0 0 0-1.5 0v2.5c0 .69-.56 1.25-1.25 1.25H4.75c-.69 0-1.25-.56-1.25-1.25v-2.5Z"/>
  </svg>
)
const CloseIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5">
    <path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z"/>
  </svg>
)

// ── Upgrade modal ─────────────────────────────────────────────────────────────
function UpgradeModal({ onClose }: { onClose: () => void }) {
  const { user } = useUser()
  const [msg, setMsg] = useState('')
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSending(true)
    try {
      await fetch('/api/catalog/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: `Upgrade request from dashboard:\n${msg}` }),
      })
      setSent(true)
    } finally { setSending(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-md p-6 relative shadow-xl" onClick={e => e.stopPropagation()}>
        <button onClick={onClose} className="cursor-pointer absolute top-4 right-4 text-gray-400 hover:text-gray-600"><CloseIcon /></button>
        {sent ? (
          <div className="text-center py-6">
            <div className="w-12 h-12 rounded-full bg-[#EEF7F6] flex items-center justify-center mx-auto mb-3">
              <svg className="w-6 h-6 text-[#3D7A72]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7"/>
              </svg>
            </div>
            <p className="font-semibold text-gray-800">Request sent!</p>
            <p className="text-sm text-gray-400 mt-1">We&apos;ll be in touch at {user?.primaryEmailAddress?.emailAddress}</p>
          </div>
        ) : (
          <>
            <p className="text-xs font-semibold text-[#6AA8A0] uppercase tracking-wide mb-1">Upgrade account</p>
            <h3 className="font-semibold text-gray-900 text-lg mb-1">Unlock Pro models</h3>
            <p className="text-sm text-gray-500 mb-4">Tell us about your operation and we&apos;ll get back to you with a Pro plan.</p>
            <form onSubmit={handleSubmit} className="space-y-4">
              <textarea rows={4} required value={msg} onChange={e => setMsg(e.target.value)}
                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-800 resize-none focus:outline-none focus:border-[#6AA8A0] focus:ring-1 focus:ring-[#6AA8A0]"
                placeholder="Plantation type, area size, species..."/>
              <button type="submit" disabled={sending}
                className="cursor-pointer w-full bg-[#3D7A72] hover:bg-[#2A5750] text-white font-semibold text-sm py-2.5 rounded-xl transition-colors disabled:opacity-50">
                {sending ? 'Sending...' : 'Send request →'}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  )
}

// ── Image preview modal ───────────────────────────────────────────────────────
function ImageModal({ url, filename, onClose }: { url: string; filename: string; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4" onClick={onClose}>
      <div className="relative max-w-4xl w-full max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-2 px-1">
          <p className="text-white/80 text-sm truncate">{filename}</p>
          <button onClick={onClose} className="cursor-pointer text-white/60 hover:text-white ml-4 flex-shrink-0"><CloseIcon /></button>
        </div>
        <div className="flex-1 rounded-2xl overflow-hidden bg-[#111] flex items-center justify-center min-h-0" style={{ maxHeight: '80vh' }}>
          <img src={url} alt={filename} className="max-w-full max-h-full object-contain"/>
        </div>
      </div>
    </div>
  )
}

// ── Vector preview modal ──────────────────────────────────────────────────────
function VectorModal({ vectorId, filename, userId, onClose }: { vectorId: string; filename: string; userId: string; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4" onClick={onClose}>
      <div className="relative max-w-2xl w-full" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-2 px-1">
          <p className="text-white/80 text-sm truncate">{filename}</p>
          <button onClick={onClose} className="cursor-pointer text-white/60 hover:text-white ml-4 flex-shrink-0"><CloseIcon /></button>
        </div>
        <div className="rounded-2xl overflow-hidden bg-[#F4F9F8] flex items-center justify-center" style={{ minHeight: 320 }}>
          <img
            src={`${API}/vectors/${vectorId}/preview?clerk_id=${userId}`}
            alt={filename}
            className="max-w-full max-h-[70vh] object-contain p-4"
          />
        </div>
      </div>
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default function Dashboard() {
  const { user, isLoaded } = useUser()
  const [images,     setImages]     = useState<ImageFile[]>([])
  const [vectors,    setVectors]    = useState<VectorFile[]>([])
  const [jobs,       setJobs]       = useState<Job[]>([])
  const [models,     setModels]     = useState<Model[]>([])
  const [thumbnails, setThumbnails] = useState<Record<string, string>>({})
  const [loading,    setLoading]    = useState(true)

  const [imageModal,  setImageModal]  = useState<{ id: string; url: string; filename: string } | null>(null)
  const [vectorModal, setVectorModal] = useState<{ id: string; filename: string } | null>(null)
  const [upgradeOpen, setUpgradeOpen] = useState(false)

  const [accountInfo, setAccountInfo] = useState<{ account_plan: string; storage_bytes: number; jobs_this_week: number; storage_limit_gb: number | null; weekly_job_limit: number | null } | null>(null)

  useEffect(() => {
    if (!isLoaded || !user) return
    async function load() {
      try {
        const [iR, vR, jR, mR, aR] = await Promise.all([
          fetch(`${API}/images/${user!.id}`).catch(() => null),
          fetch(`${API}/vectors/${user!.id}`).catch(() => null),
          fetch(`${API}/jobs/${user!.id}`).catch(() => null),
          fetch('/api/catalog/models').catch(() => null),
          fetch(`${API}/account/me`, { headers: { 'x-clerk-id': user!.id } }).catch(() => null),
        ])
        const [iD, vD, jD, mD, aD] = await Promise.all([
          (iR?.ok ? iR.json().catch(() => ({})) : {}) as { images?: ImageFile[] },
          (vR?.ok ? vR.json().catch(() => ({})) : {}) as { vectors?: VectorFile[] },
          (jR?.ok ? jR.json().catch(() => ({})) : {}) as { jobs?: Job[] },
          (mR?.ok ? mR.json().catch(() => []) : [])   as Model[],
          (aR?.ok ? aR.json().catch(() => null) : null) as { account_plan: string; storage_bytes: number; jobs_this_week: number; storage_limit_gb: number | null; weekly_job_limit: number | null } | null,
        ])
        const imgs: ImageFile[] = iD.images || []
        setImages(imgs)
        setVectors(vD.vectors || [])
        setJobs(jD.jobs || [])
        setModels(Array.isArray(mD) ? mD : [])
        setAccountInfo(aD)
        setLoading(false)

        // Fetch thumbnails for 3 most recent ready images
        const recent = imgs.filter(i => i.status === 'ready').slice(0, 3)
        const results = await Promise.allSettled(
          recent.map(async img => {
            const r = await fetch(`${API}/images/${img.id}/thumbnail?clerk_id=${user!.id}`)
            if (!r.ok) return null
            const d = await r.json()
            return { id: img.id, url: d.url as string }
          })
        )
        const map: Record<string, string> = {}
        results.forEach(r => { if (r.status === 'fulfilled' && r.value) map[r.value.id] = r.value.url })
        setThumbnails(map)
      } catch (e) { console.error(e); setLoading(false) }
    }
    load()
  }, [isLoaded, user])

  const name    = user?.firstName || user?.emailAddresses?.[0]?.emailAddress?.split('@')[0] || 'there'
  const isPro   = models.some(m => !m.is_free && m.has_access)
  const tier = accountInfo?.account_plan || 'basic'
  const planLabel = tier === 'custom' ? 'Custom account' : tier === 'pro' ? 'Pro account' : 'Basic account'
  const storageLimitBytes = accountInfo?.storage_limit_gb != null ? accountInfo.storage_limit_gb * 1e9 : null
  const jobsLimit = accountInfo?.weekly_job_limit ?? null

  const readyImages       = images.filter(i => i.status === 'ready')
  const imagesThisWeek    = images.filter(i => i.created_at && isThisWeek(i.created_at)).length
  const vectorsThisWeek   = vectors.filter(v => v.created_at && isThisWeek(v.created_at)).length
  const completedJobsWeek = jobs.filter(j => j.status === 'done' && j.finished_at && isThisWeek(j.finished_at)).length
  const haThisWeek        = readyImages
    .filter(i => i.created_at && isThisWeek(i.created_at))
    .reduce((s, i) => s + (i.area_ha || 0), 0)
  const totalHa           = readyImages.reduce((s, i) => s + (i.area_ha || 0), 0)

  const activeModels      = models.filter(m => m.has_access)
  const isNewAccount      = images.length === 0 && vectors.length === 0

  // ── Unified activity feed — uploads + jobs merged chronologically ──
  type FeedEntry = {
    key: string; title: string; meta: string; created_at: string
    status: { label: string; cls: string }; icon: 'job' | 'ingest'
    thumb?: string; onClick?: () => void
  }
  const feedEntries: FeedEntry[] = [
    ...jobs.map(job => {
      const isIngest = ['raster_ingest', 'vector_ingest'].includes(job.type)
      const dur = formatDuration(job.started_at, job.finished_at)
      const st = STATUS[job.status] || { label: job.status, cls: 'bg-gray-50 text-gray-400' }
      const title = job.model_name || TYPE_LABEL[job.type] || job.type
      return {
        key: `job-${job.id}`,
        title: job.image_filename ? `${title} — ${job.image_filename}` : title,
        meta: [formatRelative(job.created_at), dur].filter(Boolean).join(' · '),
        created_at: job.created_at, status: st, icon: isIngest ? 'ingest' as const : 'job' as const,
      }
    }),
    ...images.map(img => ({
      key: `img-${img.id}`,
      title: `Uploaded ${img.filename}`,
      meta: formatRelative(img.created_at),
      created_at: img.created_at,
      status: img.status === 'ready' ? { label: 'Ready', cls: 'bg-[#EEF7F6] text-[#3D7A72]' } : { label: img.status, cls: 'bg-amber-50 text-amber-600' },
      icon: 'ingest' as const,
      thumb: thumbnails[img.id],
      onClick: thumbnails[img.id] ? () => setImageModal({ id: img.id, url: thumbnails[img.id], filename: img.filename }) : undefined,
    })),
    ...vectors.map(v => ({
      key: `vec-${v.id}`,
      title: `Uploaded ${v.filename}`,
      meta: formatRelative(v.created_at),
      created_at: v.created_at,
      status: v.status === 'ready' ? { label: 'Ready', cls: 'bg-[#EEF7F6] text-[#3D7A72]' } : { label: v.status, cls: 'bg-amber-50 text-amber-600' },
      icon: 'ingest' as const,
      thumb: v.status === 'ready' && user ? `${API}/vectors/${v.id}/preview?clerk_id=${user.id}` : undefined,
      onClick: v.status === 'ready' ? () => setVectorModal({ id: v.id, filename: v.filename }) : undefined,
    })),
  ].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()).slice(0, 7)

  // ── Hero state — what matters most right now ──
  const activeJob   = jobs.find(j => j.status === 'running' || j.status === 'queued')
  const storagePct  = accountInfo && storageLimitBytes ? (accountInfo.storage_bytes / storageLimitBytes) * 100 : 0
  const jobsPct     = accountInfo && jobsLimit ? (accountInfo.jobs_this_week / jobsLimit) * 100 : 0
  const nearLimit   = storagePct >= 90 || jobsPct >= 90
  const heroState: 'warning' | 'processing' | 'ready' = nearLimit ? 'warning' : activeJob ? 'processing' : 'ready'

  if (!isLoaded || loading) return (
    <div className="w-full">
      <div className="flex items-center justify-between mb-7 pt-1">
        <div>
          <h1 className="text-2xl font-semibold text-[#1C1C1C]">Dashboard</h1>
          <p className="text-gray-400 mt-0.5 text-sm">Welcome back, {isLoaded ? name : '...'}</p>
        </div>
      </div>
      <div className="flex items-center justify-center py-24">
        <div className="w-6 h-6 border-2 border-[#3D7A72] border-t-transparent rounded-full animate-spin"/>
      </div>
    </div>
  )

  return (
    <div className="w-full">

      {/* Modals */}
      {upgradeOpen   && <UpgradeModal onClose={() => setUpgradeOpen(false)}/>}
      {imageModal    && <ImageModal  url={imageModal.url} filename={imageModal.filename} onClose={() => setImageModal(null)}/>}
      {vectorModal   && <VectorModal vectorId={vectorModal.id} filename={vectorModal.filename} userId={user!.id} onClose={() => setVectorModal(null)}/>}

      {/* ── Header ── */}
      <div className="flex items-center justify-between mb-7 pt-1">
        <div>
          <h1 className="text-2xl font-semibold text-[#1C1C1C]">Dashboard</h1>
          <p className="text-gray-400 mt-0.5 text-sm">
            Welcome back, {name}
            {' · '}
            <span className={`font-medium ${tier !== 'basic' ? 'text-[#96814A]' : 'text-[#6AA8A0]'}`}>{planLabel}</span>
          </p>
        </div>
        <Link href="/dashboard/catalog"
          className="cursor-pointer flex items-center gap-2 bg-[#EEF7F6] hover:bg-[#D6EEED] text-[#3D7A72] font-medium text-sm px-4 py-2.5 rounded-xl transition-colors border border-[#A0CECC]/50">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
            <path d="M14 6H6v8h8V6Z"/>
            <path fillRule="evenodd" d="M9.25 3V1.75a.75.75 0 0 1 1.5 0V3h1.5V1.75a.75.75 0 0 1 1.5 0V3h.5A2.75 2.75 0 0 1 17 5.75v.5h1.25a.75.75 0 0 1 0 1.5H17v1.5h1.25a.75.75 0 0 1 0 1.5H17v1.5h1.25a.75.75 0 0 1 0 1.5H17v.5A2.75 2.75 0 0 1 14.25 17h-.5v1.25a.75.75 0 0 1-1.5 0V17h-1.5v1.25a.75.75 0 0 1-1.5 0V17h-1.5v1.25a.75.75 0 0 1-1.5 0V17h-.5A2.75 2.75 0 0 1 3 14.25v-.5H1.75a.75.75 0 0 1 0-1.5H3v-1.5H1.75a.75.75 0 0 1 0-1.5H3v-1.5H1.75a.75.75 0 0 1 0-1.5H3v-.5A2.75 2.75 0 0 1 5.75 3h.5V1.75a.75.75 0 0 1 1.5 0V3h1.5ZM4.5 5.75c0-.69.56-1.25 1.25-1.25h8.5c.69 0 1.25.56 1.25 1.25v8.5c0 .69-.56 1.25-1.25 1.25h-8.5c-.69 0-1.25-.56-1.25-1.25v-8.5Z" clipRule="evenodd"/>
          </svg>
          Model catalog
        </Link>
      </div>

      {/* ── Getting started (new accounts only) ── */}
      {isNewAccount && (
        <div className="rounded-2xl border border-[#A0CECC]/50 bg-gradient-to-br from-[#EEF7F6] to-white p-6 mb-4">
          <h2 className="text-lg font-semibold text-[#1C1C1C] mb-1">Welcome to Timbermap</h2>
          <p className="text-sm text-gray-500 mb-5">Three steps to your first result — start with whichever you have on hand.</p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {[
              {
                n: '1', title: 'Upload your imagery',
                body: 'A raster (orthomosaic, satellite scene) or a shapefile — whatever you’re starting from.',
                cta: 'Upload images', href: '/dashboard/images',
              },
              {
                n: '2', title: 'Pick an AI model',
                body: 'Choose from the catalog — tree crown counts, tillage lines, fault detection, and more.',
                cta: 'Browse catalog', href: '/dashboard/catalog',
              },
              {
                n: '3', title: 'Run it and explore',
                body: 'Kick off a job, then view the results layered on the interactive map.',
                cta: 'Open map', href: '/dashboard/map',
              },
            ].map(step => (
              <div key={step.n} className="bg-white rounded-xl border border-gray-100 p-4 flex flex-col">
                <div className="w-7 h-7 rounded-full bg-[#3D7A72] text-white text-xs font-semibold flex items-center justify-center mb-3">
                  {step.n}
                </div>
                <p className="text-sm font-semibold text-[#1C1C1C] mb-1">{step.title}</p>
                <p className="text-xs text-gray-400 leading-relaxed mb-3 flex-1">{step.body}</p>
                <Link href={step.href} className="text-xs font-medium text-[#3D7A72] hover:text-[#2A5750] transition-colors">
                  {step.cta} →
                </Link>
              </div>
            ))}
          </div>
        </div>
      )}

      {!isNewAccount && (
      <>
      {/* ── Hero — what to do next, adapts to account state ── */}
      {heroState === 'warning' ? (
        <div className="rounded-2xl border border-[#F0CBA8] bg-[#FCEFE4] p-5 mb-4 flex items-center justify-between gap-4 flex-wrap">
          <div>
            <p className="text-sm font-semibold text-[#1A2624]">You&apos;re close to your plan limit</p>
            <p className="text-xs text-gray-500 mt-0.5">
              {storagePct >= 90 ? `Storage is at ${Math.round(storagePct)}% — ` : `You've used ${Math.round(jobsPct)}% of this week's jobs — `}
              clean something up or upgrade for more room.
            </p>
          </div>
          <div className="flex gap-2 flex-shrink-0">
            <Link href="/dashboard/images" className="cursor-pointer bg-white border border-gray-200 text-gray-600 text-xs font-semibold px-3.5 py-2 rounded-xl hover:bg-gray-50 transition-colors">Manage storage</Link>
            <button onClick={() => setUpgradeOpen(true)} className="cursor-pointer bg-[#3D7A72] hover:bg-[#2A5750] text-white text-xs font-semibold px-3.5 py-2 rounded-xl transition-colors">Upgrade →</button>
          </div>
        </div>
      ) : heroState === 'processing' && activeJob ? (
        <div className="rounded-2xl border border-[#A0CECC]/50 bg-gradient-to-br from-[#EEF7F6] to-white p-5 mb-4 flex items-center justify-between gap-4 flex-wrap">
          <div>
            <p className="text-sm font-semibold text-[#1A2624]">
              {activeJob.status === 'running' ? 'Processing your job' : 'Job queued'}
            </p>
            <p className="text-xs text-gray-500 mt-0.5">
              {activeJob.model_name || TYPE_LABEL[activeJob.type] || activeJob.type}
              {activeJob.image_filename && ` — ${activeJob.image_filename}`}
            </p>
          </div>
          <Link href="/dashboard/jobs" className="cursor-pointer flex-shrink-0 bg-white border border-[#A0CECC]/60 text-[#3D7A72] text-xs font-semibold px-3.5 py-2 rounded-xl hover:bg-[#EEF7F6] transition-colors">View jobs →</Link>
        </div>
      ) : (
        <div className="rounded-2xl border border-[#A0CECC]/50 bg-gradient-to-br from-[#EEF7F6] to-white p-5 mb-4 flex items-center justify-between gap-4 flex-wrap">
          <div>
            <p className="text-sm font-semibold text-[#1A2624]">Ready when you are</p>
            <p className="text-xs text-gray-500 mt-0.5">
              {imagesThisWeek > 0 ? `${imagesThisWeek} image${imagesThisWeek === 1 ? '' : 's'} uploaded this week, nothing queued right now.` : 'Nothing queued right now — upload imagery or pick a model to get started.'}
            </p>
          </div>
          <div className="flex gap-2 flex-shrink-0">
            <Link href="/dashboard/images" className="cursor-pointer bg-white border border-gray-200 text-gray-600 text-xs font-semibold px-3.5 py-2 rounded-xl hover:bg-gray-50 transition-colors">Upload imagery</Link>
            <Link href="/dashboard/catalog" className="cursor-pointer bg-[#3D7A72] hover:bg-[#2A5750] text-white text-xs font-semibold px-3.5 py-2 rounded-xl transition-colors">Browse models →</Link>
          </div>
        </div>
      )}

      {/* ── Mini stats strip ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-px bg-gray-100 border border-gray-100 rounded-2xl overflow-hidden mb-4">
        <Link href="/dashboard/images" className="cursor-pointer bg-white px-5 py-3.5 hover:bg-gray-50/70 transition-colors">
          <p className="text-[11px] font-medium text-gray-400 uppercase tracking-wide">Images</p>
          <p className="text-xl font-light text-[#1C1C1C] tabular-nums mt-0.5">{readyImages.length}{imagesThisWeek > 0 && <span className="text-xs text-[#6AA8A0] font-semibold ml-1.5">+{imagesThisWeek}</span>}</p>
        </Link>
        <Link href="/dashboard/vectors" className="cursor-pointer bg-white px-5 py-3.5 hover:bg-gray-50/70 transition-colors">
          <p className="text-[11px] font-medium text-gray-400 uppercase tracking-wide">Vectors</p>
          <p className="text-xl font-light text-[#1C1C1C] tabular-nums mt-0.5">{vectors.length}{vectorsThisWeek > 0 && <span className="text-xs text-[#6AA8A0] font-semibold ml-1.5">+{vectorsThisWeek}</span>}</p>
        </Link>
        <Link href="/dashboard/jobs" className="cursor-pointer bg-white px-5 py-3.5 hover:bg-gray-50/70 transition-colors">
          <p className="text-[11px] font-medium text-gray-400 uppercase tracking-wide">Jobs done</p>
          <p className="text-xl font-light text-[#1C1C1C] tabular-nums mt-0.5">{completedJobsWeek}<span className="text-xs text-gray-400 font-semibold ml-1.5">this wk</span></p>
        </Link>
        <Link href="/dashboard/stats" className="cursor-pointer bg-white px-5 py-3.5 hover:bg-gray-50/70 transition-colors">
          <p className="text-[11px] font-medium text-gray-400 uppercase tracking-wide">Hectares</p>
          <p className="text-xl font-light text-[#1C1C1C] tabular-nums mt-0.5">{totalHa > 0 ? formatHa(totalHa) : '—'}</p>
        </Link>
      </div>

      {/* ── Unified activity feed ── */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm mb-4">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-50">
          <p className="text-xs font-semibold uppercase tracking-widest text-gray-400">Recent activity</p>
          <Link href="/dashboard/jobs" className="cursor-pointer text-xs text-[#6AA8A0] hover:text-[#3D7A72] transition-colors font-medium">
            View all →
          </Link>
        </div>
        {feedEntries.length === 0 ? (
          <div className="px-6 py-10 text-center">
            <p className="text-sm text-gray-300">No activity yet</p>
          </div>
        ) : (
          feedEntries.map(entry => {
            const Tag = entry.onClick ? 'button' : 'div'
            return (
              <Tag key={entry.key} onClick={entry.onClick}
                className={`w-full flex items-center gap-4 px-6 py-3.5 border-b border-gray-50 last:border-0 transition-colors text-left ${entry.onClick ? 'cursor-pointer hover:bg-gray-50/50' : ''}`}>
                {entry.thumb ? (
                  <img src={entry.thumb} alt="" className="w-9 h-9 rounded-xl object-cover flex-shrink-0 border border-gray-100"/>
                ) : (
                  <div className="w-9 h-9 rounded-xl bg-[#1E3835] flex items-center justify-center flex-shrink-0">
                    {entry.icon === 'ingest' ? <IngestIcon /> : <JobIcon />}
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-800 truncate">{entry.title}</p>
                  <p className="text-xs text-gray-400 mt-0.5">{entry.meta}</p>
                </div>
                <span className={`flex-shrink-0 text-xs font-semibold px-2.5 py-1 rounded-full ${entry.status.cls}`}>{entry.status.label}</span>
              </Tag>
            )
          })
        )}
      </div>

      {/* ── Lower row: Active models + Plan usage ── */}
      <div className="grid grid-cols-1 lg:grid-cols-[2.1fr_1fr] gap-4">

        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
          <div className="flex items-center justify-between mb-4">
            <p className="text-xs font-semibold uppercase tracking-widest text-gray-400">Active models</p>
            <Link href="/dashboard/catalog"
              className="cursor-pointer text-xs text-[#6AA8A0] hover:text-[#3D7A72] transition-colors font-medium">
              Catalog →
            </Link>
          </div>

          {activeModels.length === 0 ? (
            <div className="py-6 text-center">
              <p className="text-sm text-gray-300 mb-2">No models enabled</p>
              <Link href="/dashboard/catalog"
                className="cursor-pointer inline-flex items-center gap-1 text-xs text-[#3D7A72] font-medium hover:underline">
                Browse catalog →
              </Link>
            </div>
          ) : (
            <div className="space-y-0.5">
              {activeModels.map(m => (
                <div key={m.id} className="flex items-center gap-3 py-2.5 border-b border-gray-50 last:border-0">
                  <span className="w-2 h-2 rounded-full bg-[#3D7A72] flex-shrink-0"/>
                  <span className="text-sm text-gray-700 flex-1 truncate">{m.name}</span>
                  <span className={`text-xs font-semibold px-2 py-0.5 rounded-full flex-shrink-0 ${
                    m.is_free
                      ? 'bg-[#EEF7F6] text-[#2A5750] border border-[#A0CECC]/40'
                      : 'bg-[#FBF6EA] text-[#96814A] border border-[#E6D9AE]'
                  }`}>
                    {m.is_free ? 'Free' : 'Pro'}
                  </span>
                </div>
              ))}
            </div>
          )}

          {!isPro && (
            <div className="mt-3">
              <button onClick={() => setUpgradeOpen(true)}
                className="cursor-pointer w-full text-xs text-[#3D7A72] border border-[#A0CECC]/60 hover:bg-[#EEF7F6] rounded-xl py-2 font-medium transition-colors">
                Upgrade to Pro →
              </button>
            </div>
          )}
        </div>

        {/* Plan usage */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
          <div className="flex items-center justify-between mb-5">
            <p className="text-xs font-semibold uppercase tracking-widest text-gray-400">Your plan</p>
            <span className={`text-xs font-semibold px-2 py-0.5 rounded-full capitalize ${
              tier === 'custom' ? 'bg-violet-50 text-violet-600 border border-violet-200'
              : tier === 'pro' ? 'bg-[#FBF6EA] text-[#96814A] border border-[#E6D9AE]'
              : 'bg-[#EEF7F6] text-[#2A5750] border border-[#A0CECC]/40'
            }`}>{tier}</span>
          </div>

          {accountInfo && (
            <div className="space-y-5">
              <UsageBar
                label="Storage"
                usedLabel={fmtBytes(accountInfo.storage_bytes)}
                limitLabel={storageLimitBytes !== null ? fmtBytes(storageLimitBytes) : 'Unlimited'}
                pct={storagePct}
                unlimited={storageLimitBytes === null}
              />
              <UsageBar
                label="Jobs this week"
                usedLabel={String(accountInfo.jobs_this_week)}
                limitLabel={jobsLimit !== null ? String(jobsLimit) : 'Unlimited'}
                pct={jobsPct}
                unlimited={jobsLimit === null}
              />
            </div>
          )}
        </div>

      </div>
      </>
      )}
    </div>
  )
}

function UsageBar({ label, usedLabel, limitLabel, pct, unlimited }: {
  label: string; usedLabel: string; limitLabel: string; pct: number; unlimited: boolean
}) {
  const width = Math.min(100, Math.max(0, pct))
  const over = pct > 100
  const barColor = unlimited ? 'bg-[#A0CECC]' : over ? 'bg-red-400' : pct >= 90 ? 'bg-[#D9A441]' : 'bg-[#3D7A72]'
  return (
    <div>
      <div className="flex items-baseline justify-between mb-2">
        <span className="text-sm text-gray-600 font-medium">{label}</span>
        <span className="text-sm tabular-nums">
          <span className="font-semibold text-gray-800">{usedLabel}</span>
          <span className="text-gray-400"> / {limitLabel}</span>
        </span>
      </div>
      <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all ${barColor}`} style={{ width: unlimited ? '4px' : `${width}%` }} />
      </div>
      {over && <p className="text-xs text-red-500 mt-1">Over your plan limit</p>}
    </div>
  )
}

function fmtBytes(b: number) {
  if (b > 1e9) return (b / 1e9).toFixed(1) + ' GB'
  if (b > 1e6) return (b / 1e6).toFixed(1) + ' MB'
  return (b / 1e3).toFixed(0) + ' KB'
}
