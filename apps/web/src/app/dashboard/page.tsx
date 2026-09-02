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

// ── Stat card ─────────────────────────────────────────────────────────────────
function StatCard({ label, value, sub, href }: { label: string; value: string | number; sub: string; href?: string }) {
  const inner = (
    <div className="bg-white rounded-2xl p-5 border border-gray-100 shadow-sm h-full hover:shadow-md hover:border-[#A0CECC] transition-all">
      <p className="text-xs font-medium text-gray-400 mb-3">{label}</p>
      <p className="text-3xl font-light text-[#1C1C1C] tabular-nums mb-1">{value}</p>
      <p className="text-xs text-gray-400">{sub}</p>
    </div>
  )
  if (href) return <Link href={href} className="cursor-pointer block">{inner}</Link>
  return <div>{inner}</div>
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
  const planLabel = tier === 'custom' ? 'Custom account' : tier === 'active' ? 'Active account' : 'Basic account'
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

  const displayJobs       = jobs.slice(0, 5)
  const activeModels      = models.filter(m => m.has_access)
  const recentReadyImages = readyImages.slice(0, 3)
  const recentVectors     = vectors.filter(v => v.status === 'ready').slice(0, 3)

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
      {images.length === 0 && vectors.length === 0 && (
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

      {/* ── Row 1: Stats ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        <StatCard
          label="Images"
          value={readyImages.length}
          sub={imagesThisWeek > 0 ? `${imagesThisWeek} this week` : 'none this week'}
          href="/dashboard/images"
        />
        <StatCard
          label="Vectors"
          value={vectors.length}
          sub={vectorsThisWeek > 0 ? `${vectorsThisWeek} this week` : 'none this week'}
          href="/dashboard/vectors"
        />
        <StatCard
          label="Jobs completed"
          value={completedJobsWeek}
          sub="this week"
          href="/dashboard/jobs"
        />
        <StatCard
          label="Hectares processed"
          value={totalHa > 0 ? formatHa(totalHa) : '—'}
          sub={haThisWeek > 0 ? `${formatHa(haThisWeek)} ha this week` : 'total ha'}
          href="/dashboard/stats"
        />
      </div>

      {/* ── Row 2: Active models + Recent jobs ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">

        {/* Active models */}
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
              {!isPro && (
                <div className="pt-3">
                  <button onClick={() => setUpgradeOpen(true)}
                    className="cursor-pointer w-full text-xs text-[#3D7A72] border border-[#A0CECC]/60 hover:bg-[#EEF7F6] rounded-xl py-2 font-medium transition-colors">
                    Upgrade to Pro →
                  </button>
                </div>
              )}
            </div>
          )}

          {activeModels.length === 0 && !isPro && (
            <div className="mt-3">
              <button onClick={() => setUpgradeOpen(true)}
                className="cursor-pointer w-full text-xs text-[#3D7A72] border border-[#A0CECC]/60 hover:bg-[#EEF7F6] rounded-xl py-2 font-medium transition-colors">
                Upgrade to Pro →
              </button>
            </div>
          )}
        </div>

        {/* Recent jobs */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm">
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-50">
            <p className="text-xs font-semibold uppercase tracking-widest text-gray-400">Recent jobs</p>
            <Link href="/dashboard/jobs" className="cursor-pointer text-xs text-[#6AA8A0] hover:text-[#3D7A72] transition-colors font-medium">
              View all →
            </Link>
          </div>
          {displayJobs.length === 0 ? (
            <div className="px-6 py-10 text-center">
              <p className="text-sm text-gray-300">No jobs yet</p>
            </div>
          ) : (
            displayJobs.map(job => {
              const isIngest = ['raster_ingest','vector_ingest'].includes(job.type)
              const dur = formatDuration(job.started_at, job.finished_at)
              const st = STATUS[job.status] || { label: job.status, cls: 'bg-gray-50 text-gray-400' }
              const title = job.model_name || TYPE_LABEL[job.type] || job.type
              const subtitle = [formatRelative(job.created_at), dur].filter(Boolean).join(' · ')
              return (
                <div key={job.id} className="flex items-center gap-4 px-6 py-3.5 border-b border-gray-50 last:border-0 hover:bg-gray-50/50 transition-colors">
                  <div className="w-9 h-9 rounded-xl bg-[#1E3835] flex items-center justify-center flex-shrink-0">
                    {isIngest ? <IngestIcon /> : <JobIcon />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-800 truncate">
                      {title}
                      {job.image_filename && <span className="text-gray-400 font-normal"> — {job.image_filename}</span>}
                    </p>
                    <p className="text-xs text-gray-400 mt-0.5">{subtitle}</p>
                  </div>
                  <span className={`flex-shrink-0 text-xs font-semibold px-2.5 py-1 rounded-full ${st.cls}`}>{st.label}</span>
                </div>
              )
            })
          )}
        </div>
      </div>

      {/* ── Row 3: Recent images + Recent vectors + Resources ── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

        {/* Recent images */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
          <div className="flex items-center justify-between mb-4">
            <p className="text-xs font-semibold uppercase tracking-widest text-gray-400">Recent images</p>
            <Link href="/dashboard/images" className="cursor-pointer text-xs text-[#6AA8A0] hover:text-[#3D7A72] transition-colors font-medium">
              View all →
            </Link>
          </div>
          {recentReadyImages.length === 0 ? (
            <div className="py-6 text-center">
              <p className="text-sm text-gray-300 mb-2">No images yet</p>
              <Link href="/dashboard/images" className="cursor-pointer text-xs text-[#3D7A72] font-medium hover:underline">Upload →</Link>
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-2">
              {recentReadyImages.map(img => (
                <button key={img.id}
                  onClick={() => thumbnails[img.id] && setImageModal({ id: img.id, url: thumbnails[img.id], filename: img.filename })}
                  className={`cursor-pointer aspect-square rounded-xl bg-[#F4F9F8] border border-[#A0CECC]/20 hover:border-[#A0CECC] overflow-hidden flex items-center justify-center transition-colors ${thumbnails[img.id] ? 'hover:opacity-90' : ''}`}
                  title={img.filename}>
                  {thumbnails[img.id] ? (
                    <img src={thumbnails[img.id]} alt={img.filename} className="w-full h-full object-contain"/>
                  ) : (
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-6 h-6 text-[#A0CECC]">
                      <path fillRule="evenodd" d="M1 5.25A2.25 2.25 0 0 1 3.25 3h13.5A2.25 2.25 0 0 1 19 5.25v9.5A2.25 2.25 0 0 1 16.75 17H3.25A2.25 2.25 0 0 1 1 14.75v-9.5Zm1.5 5.81v3.69c0 .414.336.75.75.75h13.5a.75.75 0 0 0 .75-.75v-2.69l-2.22-2.219a.75.75 0 0 0-1.06 0l-1.91 1.909.47.47a.75.75 0 1 1-1.06 1.06L6.53 8.091a.75.75 0 0 0-1.06 0l-2.97 2.97ZM12 7a1 1 0 1 1-2 0 1 1 0 0 1 2 0Z" clipRule="evenodd"/>
                    </svg>
                  )}
                </button>
              ))}
              {Array.from({ length: Math.max(0, 3 - recentReadyImages.length) }).map((_, i) => (
                <div key={`empty-${i}`} className="aspect-square rounded-xl bg-gray-50 border border-dashed border-gray-200"/>
              ))}
            </div>
          )}
        </div>

        {/* Recent vectors */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
          <div className="flex items-center justify-between mb-4">
            <p className="text-xs font-semibold uppercase tracking-widest text-gray-400">Recent vectors</p>
            <Link href="/dashboard/vectors" className="cursor-pointer text-xs text-[#6AA8A0] hover:text-[#3D7A72] transition-colors font-medium">
              View all →
            </Link>
          </div>
          {recentVectors.length === 0 ? (
            <div className="py-6 text-center">
              <p className="text-sm text-gray-300 mb-2">No vectors yet</p>
              <Link href="/dashboard/vectors" className="cursor-pointer text-xs text-[#3D7A72] font-medium hover:underline">Upload →</Link>
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-2">
              {recentVectors.map(v => (
                <button key={v.id}
                  onClick={() => setVectorModal({ id: v.id, filename: v.filename })}
                  className="cursor-pointer aspect-square rounded-xl bg-[#F4F9F8] border border-[#A0CECC]/20 hover:border-[#A0CECC] overflow-hidden flex items-center justify-center transition-colors hover:opacity-90 p-1"
                  title={v.filename}>
                  <img
                    src={`${API}/vectors/${v.id}/preview?clerk_id=${user!.id}`}
                    alt={v.filename}
                    className="w-full h-full object-contain"
                  />
                </button>
              ))}
              {Array.from({ length: Math.max(0, 3 - recentVectors.length) }).map((_, i) => (
                <div key={`empty-${i}`} className="aspect-square rounded-xl bg-gray-50 border border-dashed border-gray-200"/>
              ))}
            </div>
          )}
        </div>

        {/* Plan usage */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
          <div className="flex items-center justify-between mb-5">
            <p className="text-xs font-semibold uppercase tracking-widest text-gray-400">Your plan</p>
            <span className={`text-xs font-semibold px-2 py-0.5 rounded-full capitalize ${
              tier === 'custom' ? 'bg-violet-50 text-violet-600 border border-violet-200'
              : tier === 'active' ? 'bg-[#FBF6EA] text-[#96814A] border border-[#E6D9AE]'
              : 'bg-[#EEF7F6] text-[#2A5750] border border-[#A0CECC]/40'
            }`}>{tier}</span>
          </div>

          {accountInfo && (
            <div className="space-y-5">
              <UsageBar
                label="Storage"
                usedLabel={fmtBytes(accountInfo.storage_bytes)}
                limitLabel={storageLimitBytes !== null ? fmtBytes(storageLimitBytes) : 'Unlimited'}
                pct={storageLimitBytes ? (accountInfo.storage_bytes / storageLimitBytes) * 100 : 0}
                unlimited={storageLimitBytes === null}
              />
              <UsageBar
                label="Jobs this week"
                usedLabel={String(accountInfo.jobs_this_week)}
                limitLabel={jobsLimit !== null ? String(jobsLimit) : 'Unlimited'}
                pct={jobsLimit ? (accountInfo.jobs_this_week / jobsLimit) * 100 : 0}
                unlimited={jobsLimit === null}
              />
            </div>
          )}

          <div className="grid grid-cols-2 gap-3 mt-6 pt-5 border-t border-gray-50">
            <MiniStat label="Images" value={readyImages.length}/>
            <MiniStat label="Vectors" value={vectors.length}/>
            <MiniStat label="Active models" value={activeModels.length}/>
            <MiniStat label="Ha processed" value={totalHa > 0 ? formatHa(totalHa) : 0}/>
          </div>
        </div>

      </div>
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

function MiniStat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="bg-gray-50 rounded-xl px-3.5 py-3">
      <p className="text-lg font-light text-[#1C1C1C] tabular-nums leading-none mb-1">{value}</p>
      <p className="text-xs text-gray-400">{label}</p>
    </div>
  )
}
function fmtBytes(b: number) {
  if (b > 1e9) return (b / 1e9).toFixed(1) + ' GB'
  if (b > 1e6) return (b / 1e6).toFixed(1) + ' MB'
  return (b / 1e3).toFixed(0) + ' KB'
}
