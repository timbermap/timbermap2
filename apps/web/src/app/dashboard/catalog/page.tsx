'use client'
import { useEffect, useState } from 'react'
import { useUser } from '@clerk/nextjs'
import Link from 'next/link'

interface CatalogModel {
  id: string
  name: string
  description: string
  pipeline_type: string
  is_free: boolean
  has_access: boolean
  is_visible: boolean
  upgrade_requested: boolean
}

const PIPELINE_LABELS: Record<string, string> = {
  gap_detection:  'Vegetation analysis',
  blob_detection: 'Object detection',
  hough_lines:    'Line detection',
  zonal_grid:     'Grid analysis',
}

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
        <button onClick={onClose} className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 text-lg">✕</button>
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
                className="w-full bg-[#3D7A72] hover:bg-[#2A5750] text-white font-semibold text-sm py-2.5 rounded-xl transition-colors disabled:opacity-50">
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
        <button onClick={onClose} className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 text-lg">✕</button>
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
                className="w-full bg-[#3D7A72] hover:bg-[#2A5750] text-white font-semibold text-sm py-2.5 rounded-xl transition-colors disabled:opacity-50">
                {sending ? 'Sending...' : 'Send message →'}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  )
}

export default function CatalogPage() {
  const { user } = useUser()
  const [models, setModels] = useState<CatalogModel[]>([])
  const [loading, setLoading] = useState(true)
  const [activating, setActivating] = useState<string | null>(null)
  const [togglingVisibility, setTogglingVisibility] = useState<string | null>(null)
  const [upgradeModel, setUpgradeModel] = useState<CatalogModel | null>(null)
  const [contactOpen, setContactOpen] = useState(false)

  async function load() {
    if (!user) return
    const res = await fetch('/api/catalog/models')
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
    if (togglingVisibility) return
    setTogglingVisibility(model.id)
    try {
      await fetch('/api/catalog/toggle-visibility', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model_id: model.id, visible: !model.is_visible }),
      })
      await load()
    } finally { setTogglingVisibility(null) }
  }

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <div className="w-6 h-6 border-2 border-[#3D7A72] border-t-transparent rounded-full animate-spin"/>
    </div>
  )

  const free = models.filter(m => m.is_free)
  const paid = models.filter(m => !m.is_free)

  function ModelRow({ model }: { model: CatalogModel }) {
    return (
      <div className={`flex items-center gap-4 px-5 py-4 border-b border-gray-100 last:border-0 hover:bg-gray-50 transition-colors ${!model.is_visible && model.has_access ? 'opacity-60' : ''}`}>

        {/* Col 1: Status indicator */}
        <div className="w-20 flex-shrink-0 flex items-center justify-center">
          {model.has_access ? (
            <span className="inline-flex items-center gap-1 bg-[#EEF7F6] text-[#3D7A72] text-xs font-semibold px-2.5 py-1 rounded-full">
              <span className="w-1.5 h-1.5 rounded-full bg-[#3D7A72] inline-block"/>
              Active
            </span>
          ) : model.upgrade_requested ? (
            <span className="inline-flex items-center gap-1 bg-amber-50 text-amber-600 text-xs font-semibold px-2.5 py-1 rounded-full">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400 inline-block"/>
              Pending
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 bg-gray-100 text-gray-400 text-xs font-semibold px-2.5 py-1 rounded-full">
              <span className="w-1.5 h-1.5 rounded-full bg-gray-300 inline-block"/>
              Inactive
            </span>
          )}
        </div>

        {/* Col 2: Model info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${model.is_free ? 'bg-[#EEF7F6] text-[#2A5750]' : 'bg-blue-50 text-blue-700'}`}>
              {model.is_free ? 'Free' : 'Pro'}
            </span>
            <span className="text-xs text-gray-400">{PIPELINE_LABELS[model.pipeline_type] || model.pipeline_type}</span>
          </div>
          <p className="font-medium text-[#1A2624] text-sm">{model.name}</p>
          <p className="text-xs text-gray-400 mt-0.5 truncate max-w-xl">{model.description}</p>
        </div>

        {/* Col 3: Actions */}
        <div className="flex items-center gap-2 flex-shrink-0">
          {model.has_access ? (
            <button
              onClick={() => toggleVisibility(model)}
              disabled={togglingVisibility === model.id}
              className={`text-xs font-medium px-3 py-1.5 rounded-lg border transition-colors ${
                model.is_visible
                  ? 'border-gray-200 text-gray-500 hover:bg-gray-100'
                  : 'border-[#A0CECC] text-[#3D7A72] bg-[#EEF7F6] hover:bg-[#D6EEED]'
              }`}>
              {togglingVisibility === model.id ? '...' : model.is_visible ? 'Hide from models' : 'Show in models'}
            </button>
          ) : model.is_free ? (
            <button
              onClick={() => activateFree(model)}
              disabled={activating === model.id}
              className="bg-[#3D7A72] hover:bg-[#2A5750] text-white text-xs font-semibold px-4 py-1.5 rounded-lg transition-colors disabled:opacity-50">
              {activating === model.id ? 'Activating...' : 'Activate →'}
            </button>
          ) : model.upgrade_requested ? (
            <span className="text-xs text-gray-400 font-medium">—</span>
          ) : (
            <button
              onClick={() => setUpgradeModel(model)}
              className="border border-[#3D7A72] text-[#3D7A72] hover:bg-[#EEF7F6] text-xs font-semibold px-4 py-1.5 rounded-lg transition-colors">
              Request access →
            </button>
          )}
        </div>
      </div>
    )
  }

  // Column headers
  function TableHeader() {
    return (
      <div className="flex items-center gap-4 px-5 py-2 border-b border-gray-100 bg-gray-50/80">
        <div className="w-20 flex-shrink-0">
          <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Status</span>
        </div>
        <div className="flex-1 min-w-0">
          <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Model</span>
        </div>
        <div className="flex-shrink-0 w-36">
          <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Action</span>
        </div>
      </div>
    )
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      {upgradeModel && (
        <UpgradeModal model={upgradeModel} onClose={() => setUpgradeModel(null)} onDone={() => { setUpgradeModel(null); load() }}/>
      )}
      {contactOpen && (
        <ContactModal onClose={() => setContactOpen(false)}/>
      )}

      <div className="flex items-start justify-between mb-6">
        <div>
          <p className="text-xs font-semibold text-[#6AA8A0] uppercase tracking-wide mb-1">Model catalog</p>
          <h1 className="text-2xl font-bold text-[#1A2624]">Available models</h1>
          <p className="text-sm text-gray-500 mt-1">Activate free models instantly. Request access to Pro models. Hide models you don't use.</p>
        </div>
        <Link href="/dashboard/models"
          className="inline-flex items-center gap-2 bg-[#EEF7F6] hover:bg-[#D6EEED] text-[#3D7A72] font-medium text-sm px-3.5 py-2 rounded-xl transition-colors border border-[#A0CECC]/50 flex-shrink-0">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7"/>
          </svg>
          Models
        </Link>
      </div>

      <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden mb-4">
        {free.length > 0 && (
          <>
            <div className="px-5 py-2.5 bg-[#F4F9F9] border-b border-gray-100">
              <span className="text-xs font-semibold text-[#6AA8A0] uppercase tracking-wide">Free — all plans</span>
            </div>
            <TableHeader />
            {free.map(m => <ModelRow key={m.id} model={m}/>)}
          </>
        )}
        {paid.length > 0 && (
          <>
            <div className="px-5 py-2.5 bg-gray-50 border-b border-gray-100">
              <span className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Pro & Premium</span>
            </div>
            <TableHeader />
            {paid.map(m => <ModelRow key={m.id} model={m}/>)}
          </>
        )}
      </div>

      <div className="p-4 rounded-xl border border-dashed border-[#A0CECC] bg-[#F4F9F9]">
        <p className="text-sm font-medium text-[#1A2624] mb-0.5">Need a custom model?</p>
        <p className="text-sm text-gray-500">
          We build models tailored to your species, resolution, and operation.{' '}
          <button onClick={() => setContactOpen(true)} className="text-[#3D7A72] font-medium hover:underline">Contact us →</button>
        </p>
      </div>
    </div>
  )
}
