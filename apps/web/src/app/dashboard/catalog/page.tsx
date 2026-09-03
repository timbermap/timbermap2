'use client'
import { useEffect, useState } from 'react'
import { useUser } from '@clerk/nextjs'
import Link from 'next/link'

interface CatalogModel {
  id: string
  name: string
  slug: string
  description: string
  pipeline_type: string
  output_types: string[]
  is_free: boolean
  has_access: boolean
  is_visible: boolean
  upgrade_requested: boolean
  sample_image_url: string | null
}

const PIPELINE_LABELS: Record<string, string> = {
  gap_detection:  'Vegetation analysis',
  blob_detection: 'Object detection',
  hough_lines:    'Line detection',
  zonal_grid:     'Grid analysis',
}
const OUTPUT_LABELS: Record<string, string> = {
  raster_cog: 'Raster COG',
  geojson:    'GeoJSON',
  shapefile:  'Shapefile',
  csv:        'CSV',
}

// ── Icons ────────────────────────────────────────────────────────────────────
const CheckCircleIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
    <path fillRule="evenodd" d="M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16Zm3.857-9.809a.75.75 0 0 0-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 1 0-1.06 1.061l2.5 2.5a.75.75 0 0 0 1.137-.089l4-5.5Z" clipRule="evenodd"/>
  </svg>
)
const EyeSlashIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5">
    <path fillRule="evenodd" d="M3.28 2.22a.75.75 0 0 0-1.06 1.06l14.5 14.5a.75.75 0 1 0 1.06-1.06l-1.745-1.745a10.029 10.029 0 0 0 3.3-4.38 1.651 1.651 0 0 0 0-1.185A10.004 10.004 0 0 0 9.999 3a9.956 9.956 0 0 0-4.744 1.194L3.28 2.22ZM7.752 6.69l1.092 1.092a2.5 2.5 0 0 1 3.374 3.373l1.091 1.092a4 4 0 0 0-5.557-5.557Z" clipRule="evenodd"/>
    <path d="M10.748 13.93l2.523 2.523a9.987 9.987 0 0 1-3.27.547c-4.258 0-7.894-2.66-9.337-6.41a1.651 1.651 0 0 1 0-1.186A10.007 10.007 0 0 1 2.839 6.02L6.07 9.252a4 4 0 0 0 4.678 4.678Z"/>
  </svg>
)
const EyeIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5">
    <path d="M10 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z"/>
    <path fillRule="evenodd" d="M.664 10.59a1.651 1.651 0 0 1 0-1.186A10.004 10.004 0 0 1 10 3c4.257 0 7.893 2.66 9.336 6.41.147.381.146.804 0 1.186A10.004 10.004 0 0 1 10 17c-4.257 0-7.893-2.66-9.336-6.41ZM14 10a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z" clipRule="evenodd"/>
  </svg>
)

// ── Modals ───────────────────────────────────────────────────────────────────
function UpgradeModal({ model, onClose, onDone }: {
  model: CatalogModel; onClose: () => void; onDone: () => void
}) {
  const { user } = useUser()
  const [msg, setMsg] = useState('')
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSending(true)
    try {
      await fetch('/api/catalog/request-upgrade', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model_id: model.id, model_name: model.name, message: msg }),
      })
      setSent(true)
      setTimeout(onDone, 1800)
    } finally { setSending(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl w-full max-w-md p-6 relative shadow-xl">
        <button onClick={onClose} className="cursor-pointer absolute top-4 right-4 text-gray-400 hover:text-gray-600 text-lg leading-none">✕</button>
        {sent ? (
          <div className="text-center py-6">
            <div className="w-12 h-12 rounded-full bg-[#EEF7F6] flex items-center justify-center mx-auto mb-3">
              <svg className="w-6 h-6 text-[#3D7A72]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7"/>
              </svg>
            </div>
            <p className="font-semibold text-gray-800">Request sent!</p>
            <p className="text-sm text-gray-400 mt-1">We'll be in touch at {user?.primaryEmailAddress?.emailAddress}</p>
          </div>
        ) : (
          <>
            <p className="text-xs font-semibold text-[#6AA8A0] uppercase tracking-wide mb-1">Upgrade request</p>
            <h3 className="font-semibold text-gray-900 text-lg mb-1">{model.name}</h3>
            <p className="text-sm text-gray-500 mb-4">{model.description}</p>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide block mb-1.5">Tell us about your operation</label>
                <textarea rows={4} required value={msg} onChange={e => setMsg(e.target.value)}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-800 resize-none focus:outline-none focus:border-[#6AA8A0] focus:ring-1 focus:ring-[#6AA8A0]"
                  placeholder="Plantation type, area size, imagery you have..."/>
              </div>
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

function ContactModal({ onClose }: { onClose: () => void }) {
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
        body: JSON.stringify({ message: msg }),
      })
      setSent(true)
    } finally { setSending(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl w-full max-w-md p-6 relative shadow-xl">
        <button onClick={onClose} className="cursor-pointer absolute top-4 right-4 text-gray-400 hover:text-gray-600 text-lg leading-none">✕</button>
        {sent ? (
          <div className="text-center py-6">
            <div className="w-12 h-12 rounded-full bg-[#EEF7F6] flex items-center justify-center mx-auto mb-3">
              <svg className="w-6 h-6 text-[#3D7A72]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7"/>
              </svg>
            </div>
            <p className="font-semibold text-gray-800">Message sent!</p>
            <p className="text-sm text-gray-400 mt-1">We'll get back to you at {user?.primaryEmailAddress?.emailAddress}</p>
          </div>
        ) : (
          <>
            <p className="text-xs font-semibold text-[#6AA8A0] uppercase tracking-wide mb-1">Custom model inquiry</p>
            <h3 className="font-semibold text-gray-900 text-lg mb-1">Contact us</h3>
            <p className="text-sm text-gray-500 mb-4">Tell us about your operation and what you need. We'll get back to you shortly.</p>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide block mb-1.5">Your message</label>
                <textarea rows={4} required value={msg} onChange={e => setMsg(e.target.value)}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-800 resize-none focus:outline-none focus:border-[#6AA8A0] focus:ring-1 focus:ring-[#6AA8A0]"
                  placeholder="Species, resolution, area size, what you're trying to detect..."/>
              </div>
              <button type="submit" disabled={sending}
                className="cursor-pointer w-full bg-[#3D7A72] hover:bg-[#2A5750] text-white font-semibold text-sm py-2.5 rounded-xl transition-colors disabled:opacity-50">
                {sending ? 'Sending...' : 'Send message →'}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  )
}

// ── Model row — always expanded, no accordion ───────────────────────────────
function ModelCard({
  model, onActivate, onRequestUpgrade, onToggleVisibility,
  activating, toggling,
}: {
  model: CatalogModel
  onActivate: () => void
  onRequestUpgrade: () => void
  onToggleVisibility: () => void
  activating: boolean
  toggling: boolean
}) {
  const statusBadge = model.has_access ? (
    <span className="inline-flex items-center gap-1 bg-[#EEF7F6] text-[#3D7A72] text-xs font-semibold px-2 py-0.5 rounded-full border border-[#A0CECC]/50 whitespace-nowrap">
      <span className="w-1.5 h-1.5 rounded-full bg-[#3D7A72] inline-block"/>
      Active
    </span>
  ) : model.upgrade_requested ? (
    <span className="inline-flex items-center gap-1 bg-[#FBF6EA] text-[#96814A] text-xs font-semibold px-2 py-0.5 rounded-full border border-[#E6D9AE] whitespace-nowrap">
      <span className="w-1.5 h-1.5 rounded-full bg-[#C9AD6C] inline-block"/>
      Pending
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 bg-gray-100 text-gray-400 text-xs font-semibold px-2 py-0.5 rounded-full whitespace-nowrap">
      <span className="w-1.5 h-1.5 rounded-full bg-gray-300 inline-block"/>
      Inactive
    </span>
  )

  const action = model.has_access ? (
    <button
      onClick={onToggleVisibility}
      disabled={toggling}
      title={model.is_visible ? 'Hide from models' : 'Show in models'}
      className={`cursor-pointer inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border transition-colors disabled:opacity-50 whitespace-nowrap ${
        model.is_visible
          ? 'border-gray-200 text-gray-500 hover:bg-gray-50'
          : 'border-[#A0CECC] text-[#3D7A72] bg-[#EEF7F6] hover:bg-[#D6EEED]'
      }`}>
      {toggling ? '...' : model.is_visible ? <><EyeSlashIcon />Hide</> : <><EyeIcon />Show</>}
    </button>
  ) : model.is_free ? (
    <button
      onClick={onActivate}
      disabled={activating}
      className="cursor-pointer inline-flex items-center gap-1.5 bg-[#3D7A72] hover:bg-[#2A5750] text-white text-xs font-semibold px-3.5 py-1.5 rounded-lg transition-colors disabled:opacity-50 shadow-sm whitespace-nowrap">
      {activating ? (
        <><svg className="animate-spin w-3.5 h-3.5" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>Activating...</>
      ) : (
        <><CheckCircleIcon />Activate</>
      )}
    </button>
  ) : model.upgrade_requested ? (
    <span className="inline-flex items-center gap-1.5 text-[#96814A] text-xs font-medium whitespace-nowrap">
      <span className="w-2 h-2 rounded-full bg-[#C9AD6C] inline-block"/>
      Pending
    </span>
  ) : (
    <button
      onClick={onRequestUpgrade}
      className="cursor-pointer inline-flex items-center gap-1.5 border border-[#3D7A72] text-[#3D7A72] hover:bg-[#EEF7F6] text-xs font-semibold px-3.5 py-1.5 rounded-lg transition-colors whitespace-nowrap">
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5">
        <path fillRule="evenodd" d="M10.868 2.884c-.321-.772-1.415-.772-1.736 0l-1.83 4.401-4.753.381c-.833.067-1.171 1.107-.536 1.651l3.62 3.102-1.106 4.637c-.194.813.691 1.449 1.405 1.02L10 15.591l4.069 2.485c.713.436 1.598-.207 1.404-1.02l-1.106-4.637 3.62-3.102c.635-.544.297-1.584-.536-1.65l-4.752-.382-1.831-4.401Z" clipRule="evenodd"/>
      </svg>
      Request access
    </button>
  )

  return (
    <div className={`rounded-2xl border bg-white px-5 py-3.5 grid grid-cols-1 md:grid-cols-[minmax(160px,1.3fr)_minmax(0,2fr)_auto_auto] gap-x-5 gap-y-2 md:items-center transition-colors hover:border-gray-200 hover:shadow-sm ${
      model.has_access ? 'border-[#A0CECC]/60' : 'border-gray-100'
    } ${!model.is_visible && model.has_access ? 'opacity-60' : ''}`}>

      {/* Thumbnail + name + pipeline */}
      <div className="min-w-0 flex items-center gap-3">
        {model.sample_image_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={model.sample_image_url} alt="" className="w-11 h-11 rounded-lg object-cover flex-shrink-0 border border-gray-100"/>
        ) : (
          <div className="w-11 h-11 rounded-lg flex-shrink-0 bg-gray-50 border border-gray-100 flex items-center justify-center">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4 text-gray-300">
              <path fillRule="evenodd" d="M1 5.25A2.25 2.25 0 0 1 3.25 3h13.5A2.25 2.25 0 0 1 19 5.25v9.5A2.25 2.25 0 0 1 16.75 17H3.25A2.25 2.25 0 0 1 1 14.75v-9.5Zm1.5 5.81v3.69c0 .414.336.75.75.75h13.5a.75.75 0 0 0 .75-.75v-2.69l-2.22-2.219a.75.75 0 0 0-1.06 0l-1.91 1.909.47.47a.75.75 0 1 1-1.06 1.06L6.53 8.091a.75.75 0 0 0-1.06 0l-2.97 2.97ZM12 7a1 1 0 1 1 2 0 1 1 0 0 1-2 0Z" clipRule="evenodd"/>
            </svg>
          </div>
        )}
        <div className="min-w-0">
          <Link href={`/models/${model.slug}`}
            className="font-medium text-[#1A2624] text-sm truncate hover:text-[#3D7A72] hover:underline block">
            {model.name}
          </Link>
          <p className="text-xs text-gray-400 truncate">{PIPELINE_LABELS[model.pipeline_type] || model.pipeline_type}</p>
        </div>
      </div>

      {/* Description + output tags */}
      <div className="min-w-0">
        <p className="text-xs text-gray-500 leading-relaxed line-clamp-2">{model.description}</p>
        {model.output_types && model.output_types.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-1.5">
            {model.output_types.map((t, i) => (
              <span key={`${t}-${i}`} className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-500 font-mono">
                {OUTPUT_LABELS[t] || t}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Status */}
      <div className="justify-self-start md:justify-self-end">{statusBadge}</div>

      {/* Action */}
      <div className="justify-self-start md:justify-self-end">{action}</div>
    </div>
  )
}

// ── Page ─────────────────────────────────────────────────────────────────────
export default function CatalogPage() {
  const { user } = useUser()
  const [models, setModels] = useState<CatalogModel[]>([])
  const [loading, setLoading] = useState(true)
  const [activating, setActivating] = useState<string | null>(null)
  const [toggling, setToggling] = useState<string | null>(null)
  const [upgradeModel, setUpgradeModel] = useState<CatalogModel | null>(null)
  const [contactOpen, setContactOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [tier, setTier] = useState<'all' | 'free' | 'pro'>('all')

  async function load() {
    if (!user) return
    const res = await fetch('/api/catalog/models', { cache: 'no-store' })
    if (res.ok) setModels(await res.json())
    setLoading(false)
  }

  useEffect(() => { load() }, [user])

  async function activateFree(model: CatalogModel) {
    if (activating) return
    setActivating(model.id)
    try {
      await fetch('/api/catalog/activate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model_id: model.id }),
      })
      await load()
    } finally { setActivating(null) }
  }

  async function toggleVisibility(model: CatalogModel) {
    if (toggling) return
    setToggling(model.id)
    try {
      await fetch('/api/catalog/toggle-visibility', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model_id: model.id, visible: !model.is_visible }),
      })
      await load()
    } finally { setToggling(null) }
  }

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <div className="w-6 h-6 border-2 border-[#3D7A72] border-t-transparent rounded-full animate-spin"/>
    </div>
  )

  const q = search.trim().toLowerCase()
  const filtered = q
    ? models.filter(m =>
        m.name.toLowerCase().includes(q) ||
        m.description.toLowerCase().includes(q) ||
        (PIPELINE_LABELS[m.pipeline_type] || m.pipeline_type).toLowerCase().includes(q)
      )
    : models

  const pro  = filtered.filter(m => !m.is_free)
  const free = filtered.filter(m => m.is_free)

  const proActive  = pro.filter(m => m.has_access).length
  const freeActive = free.filter(m => m.has_access).length

  return (
    <div className="w-full">
      {upgradeModel && (
        <UpgradeModal model={upgradeModel} onClose={() => setUpgradeModel(null)} onDone={() => { setUpgradeModel(null); load() }}/>
      )}
      {contactOpen && (
        <ContactModal onClose={() => setContactOpen(false)}/>
      )}

      {/* Header */}
      <div className="flex items-start justify-between mb-5">
        <div>
          <p className="text-xs font-medium tracking-widest uppercase text-[#6AA8A0] mb-1">AI Models</p>
          <h1 className="text-2xl font-semibold text-[#1C1C1C]">Model catalog</h1>
          <p className="text-gray-400 mt-1 text-sm">Activate free models instantly · Request access to Pro models</p>
        </div>
        <Link href="/dashboard/models"
          className="flex items-center gap-2 bg-[#EEF7F6] hover:bg-[#D6EEED] text-[#3D7A72] font-medium text-sm px-3.5 py-2 rounded-xl transition-colors border border-[#A0CECC]/50 flex-shrink-0 cursor-pointer">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7"/>
          </svg>
          Models
        </Link>
      </div>

      {/* Search + tier filter */}
      <div className="flex flex-col sm:flex-row gap-3 mb-7">
        <div className="relative flex-1">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor"
            className="w-4 h-4 text-gray-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none">
            <path fillRule="evenodd" d="M9 3.5a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11ZM2 9a7 7 0 1 1 12.452 4.391l3.328 3.329a.75.75 0 1 1-1.06 1.06l-3.329-3.328A7 7 0 0 1 2 9Z" clipRule="evenodd"/>
          </svg>
          <input
            type="text"
            placeholder="Search models by name, type or description..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-10 pr-10 py-2.5 border border-gray-200 rounded-xl text-sm text-gray-700 bg-white focus:outline-none focus:border-[#6AA8A0] focus:ring-2 focus:ring-[#6AA8A0]/10 transition-all placeholder-gray-400"
          />
          {search && (
            <button onClick={() => setSearch('')}
              className="cursor-pointer absolute right-3.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
                <path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z"/>
              </svg>
            </button>
          )}
        </div>
        <div className="flex gap-1.5 bg-white border border-gray-200 rounded-xl p-1">
          {([
            { key: 'all',  label: `All (${models.length})` },
            { key: 'free', label: `Free (${models.filter(m => m.is_free).length})` },
            { key: 'pro',  label: `Pro (${models.filter(m => !m.is_free).length})` },
          ] as const).map(f => (
            <button key={f.key} onClick={() => setTier(f.key)}
              className={`cursor-pointer px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap ${
                tier === f.key ? 'bg-[#3D7A72] text-white' : 'text-gray-500 hover:bg-gray-50'
              }`}>
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* No search results */}
      {q && pro.length === 0 && free.length === 0 && (
        <div className="bg-white rounded-2xl border border-dashed border-gray-200 px-6 py-12 text-center mb-4">
          <p className="text-gray-400 text-sm">No models match <span className="font-medium text-gray-600">&quot;{search}&quot;</span></p>
          <button onClick={() => setSearch('')} className="cursor-pointer text-xs text-[#3D7A72] hover:underline mt-2 font-medium">Clear search</button>
        </div>
      )}

      <div className="space-y-8">

        {/* ── PRO section — shown first for signed-in users ───────────────── */}
        {tier !== 'free' && (pro.length > 0 || !q) && (
        <div>
          <div className="flex items-center gap-3 mb-3">
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full bg-[#FBF6EA] text-[#96814A] border border-[#E6D9AE]">
                <span className="w-1.5 h-1.5 rounded-full bg-[#C9AD6C] inline-block"/>
                Pro
              </span>
              <span className="text-xs text-gray-400 font-medium">Advanced models</span>
            </div>
            {proActive > 0 && (
              <span className="text-xs text-[#3D7A72] font-medium bg-[#EEF7F6] px-2 py-0.5 rounded-full">
                {proActive} active
              </span>
            )}
            <div className="flex-1 h-px bg-gray-100"/>
          </div>

          {pro.length === 0 ? (
            <div className="bg-white rounded-2xl border border-dashed border-gray-200 px-6 py-8 text-center">
              <p className="text-gray-400 text-sm">No pro models available yet.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {pro.map(m => (
                <ModelCard
                  key={m.id}
                  model={m}
                  onActivate={() => activateFree(m)}
                  onRequestUpgrade={() => setUpgradeModel(m)}
                  onToggleVisibility={() => toggleVisibility(m)}
                  activating={activating === m.id}
                  toggling={toggling === m.id}
                />
              ))}
            </div>
          )}
        </div>
        )}

        {/* ── FREE section — below Pro ────────────────────────────────────── */}
        {tier !== 'pro' && (free.length > 0 || !q) && (
        <div>
          <div className="flex items-center gap-3 mb-3">
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full bg-[#EEF7F6] text-[#2A5750] border border-[#A0CECC]/50">
                <span className="w-1.5 h-1.5 rounded-full bg-[#3D7A72] inline-block"/>
                Free
              </span>
              <span className="text-xs text-gray-400 font-medium">All plans</span>
            </div>
            {freeActive > 0 && (
              <span className="text-xs text-[#3D7A72] font-medium bg-[#EEF7F6] px-2 py-0.5 rounded-full">
                {freeActive} active
              </span>
            )}
            <div className="flex-1 h-px bg-gray-100"/>
          </div>

          {free.length === 0 ? (
            <div className="bg-white rounded-2xl border border-dashed border-gray-200 px-6 py-8 text-center">
              <p className="text-gray-400 text-sm">No free models available yet.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {free.map(m => (
                <ModelCard
                  key={m.id}
                  model={m}
                  onActivate={() => activateFree(m)}
                  onRequestUpgrade={() => setUpgradeModel(m)}
                  onToggleVisibility={() => toggleVisibility(m)}
                  activating={activating === m.id}
                  toggling={toggling === m.id}
                />
              ))}
            </div>
          )}
        </div>
        )}

      </div>

      {/* Custom model CTA */}
      <div className="mt-8 p-5 rounded-2xl border border-dashed border-[#A0CECC] bg-[#F4F9F9] flex items-center justify-between gap-4">
        <div>
          <p className="text-sm font-semibold text-[#1A2624] mb-0.5">Need a custom model?</p>
          <p className="text-sm text-gray-500">We build models tailored to your species, resolution, and operation.</p>
        </div>
        <button
          onClick={() => setContactOpen(true)}
          className="cursor-pointer flex-shrink-0 inline-flex items-center gap-2 bg-white hover:bg-gray-50 border border-gray-200 text-gray-700 text-xs font-semibold px-4 py-2.5 rounded-xl transition-colors shadow-sm">
          Contact us →
        </button>
      </div>
    </div>
  )
}
