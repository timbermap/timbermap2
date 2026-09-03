'use client'
import Link from 'next/link'
import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { SignInButton, UserButton, useUser } from '@clerk/nextjs'

interface RequiredVectorInput {
  label: string
  help_text?: string
  required_fields?: string[]
}
interface PublicModel {
  id: string
  name: string
  slug: string
  description: string
  output_types: string[]
  is_free: boolean
  required_gsd_cm: number | null
  image_type_note: string | null
  required_vector_input: RequiredVectorInput | null
  sample_image_large_url: string | null
}

const OUTPUT_LABELS: Record<string, string> = {
  raster_cog: 'Raster COG', geojson: 'GeoJSON', shapefile: 'Shapefile', csv: 'CSV',
}
const OUTPUT_DESCRIPTIONS: Record<string, string> = {
  raster_cog: 'A cloud-optimized raster you can view directly on the map.',
  geojson: 'Vector features (points, lines or polygons) in GeoJSON.',
  shapefile: 'Vector features as a downloadable shapefile.',
  csv: 'Tabular statistics as a CSV file.',
}

function ContactModal({ modelName, onClose }: { modelName: string; onClose: () => void }) {
  const { user } = useUser()
  const [name, setName] = useState(user?.fullName || '')
  const [email, setEmail] = useState(user?.primaryEmailAddress?.emailAddress || '')
  const [msg, setMsg] = useState('')
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSending(true)
    setError('')
    try {
      const formData = new FormData()
      formData.set('name', name)
      formData.set('email', email)
      formData.set('message', `[Re: ${modelName}]\n\n${msg}`)
      const r = await fetch('/api/contact', { method: 'POST', body: formData })
      if (!r.ok) throw new Error()
      setSent(true)
    } catch {
      setError('Something went wrong — please try again.')
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
            <p className="text-sm text-gray-400 mt-1">We&apos;ll get back to you shortly.</p>
          </div>
        ) : (
          <>
            <p className="text-xs font-semibold text-[#6AA8A0] uppercase tracking-wide mb-1">Question about {modelName}</p>
            <h3 className="font-semibold text-gray-900 text-lg mb-4">Ask us anything</h3>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <input type="text" required value={name} onChange={e => setName(e.target.value)}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-800 focus:outline-none focus:border-[#6AA8A0] focus:ring-1 focus:ring-[#6AA8A0]"
                  placeholder="Your name"/>
                <input type="email" required value={email} onChange={e => setEmail(e.target.value)}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-800 focus:outline-none focus:border-[#6AA8A0] focus:ring-1 focus:ring-[#6AA8A0]"
                  placeholder="Your email"/>
              </div>
              <textarea rows={4} required value={msg} onChange={e => setMsg(e.target.value)}
                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-800 resize-none focus:outline-none focus:border-[#6AA8A0] focus:ring-1 focus:ring-[#6AA8A0]"
                placeholder="What would you like to know?"/>
              {error && <p className="text-xs text-red-500">{error}</p>}
              <button type="submit" disabled={sending}
                className="cursor-pointer w-full bg-[#3D7A72] hover:bg-[#2A5750] text-white font-semibold text-sm py-2.5 rounded-xl transition-colors disabled:opacity-50">
                {sending ? 'Sending...' : 'Send →'}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  )
}

export default function ModelDetailPage() {
  const { slug } = useParams<{ slug: string }>()
  const { isSignedIn, isLoaded } = useUser()
  const [model, setModel] = useState<PublicModel | null | 'notfound'>(null)
  const [contactOpen, setContactOpen] = useState(false)

  useEffect(() => {
    const API = process.env.NEXT_PUBLIC_API_URL || 'https://timbermap-api-tjrp7tcqaa-uc.a.run.app'
    fetch(`${API}/public/models/${slug}`)
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(setModel)
      .catch(() => setModel('notfound'))
  }, [slug])

  const backHref = isSignedIn ? '/dashboard/catalog' : '/models'

  if (model === 'notfound') {
    return (
      <div className="min-h-screen bg-[#F7F8F6] flex flex-col items-center justify-center px-6 text-center">
        <p className="text-gray-500 mb-4">Model not found.</p>
        <Link href={backHref} className="text-[#3D7A72] font-medium hover:underline">← Back to catalog</Link>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#F7F8F6]">
      <nav className="border-b border-gray-100 bg-white">
        <div className="max-w-4xl mx-auto px-6 py-4 flex items-center justify-between">
          <Link href={isSignedIn ? '/dashboard' : '/'} className="font-semibold text-[#2C5F45] text-lg tracking-wide">
            Timbermap
          </Link>
          {isLoaded && (
            <div className="flex items-center gap-4">
              <Link href={backHref}
                className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-[#2C5F45] transition-colors">
                {isSignedIn ? '← Back to your catalog' : '← All models'}
              </Link>
              {isSignedIn && <UserButton />}
            </div>
          )}
        </div>
      </nav>

      {model === null ? (
        <div className="flex items-center gap-2 text-gray-400 py-24 justify-center text-sm">
          <span className="w-4 h-4 border-2 border-[#3D7A72] border-t-transparent rounded-full animate-spin" />
          Loading...
        </div>
      ) : (
        <div className="max-w-4xl mx-auto px-6 py-12">
          {model.sample_image_large_url && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={model.sample_image_large_url} alt={model.name}
              className="w-full h-64 object-cover rounded-2xl mb-8 border border-gray-100" />
          )}

          <div className="flex items-center gap-2 mb-3">
            <span className={`text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full ${
              model.is_free ? 'bg-[#EEF7F6] text-[#3D7A72]' : 'bg-[#FBF6EA] text-[#96814A]'
            }`}>
              {model.is_free ? 'Free' : 'Pro'}
            </span>
          </div>
          <h1 className="text-3xl font-semibold text-[#1A2624] mb-4">{model.name}</h1>
          <p className="text-gray-600 leading-relaxed max-w-2xl mb-10">{model.description}</p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 mb-10">
            <div className="bg-white rounded-2xl border border-gray-100 p-5">
              <p className="text-xs font-semibold tracking-widest uppercase text-gray-400 mb-3">Input</p>
              <ul className="space-y-2 text-sm text-gray-600">
                <li>
                  Imagery{model.image_type_note ? ` — ${model.image_type_note}` : ''}
                  {model.required_gsd_cm && ` · optimized for ${model.required_gsd_cm}cm/px`}
                </li>
                {model.required_vector_input && (
                  <li>
                    {model.required_vector_input.label} (required)
                    {model.required_vector_input.help_text && (
                      <span className="block text-xs text-gray-400 mt-0.5">{model.required_vector_input.help_text}</span>
                    )}
                  </li>
                )}
              </ul>
            </div>
            <div className="bg-white rounded-2xl border border-gray-100 p-5">
              <p className="text-xs font-semibold tracking-widest uppercase text-gray-400 mb-3">Output</p>
              <ul className="space-y-2 text-sm text-gray-600">
                {(model.output_types || []).map((t, i) => (
                  <li key={`${t}-${i}`}>
                    <span className="font-medium text-[#1A2624]">{OUTPUT_LABELS[t] || t}</span>
                    {OUTPUT_DESCRIPTIONS[t] && <span className="block text-xs text-gray-400 mt-0.5">{OUTPUT_DESCRIPTIONS[t]}</span>}
                  </li>
                ))}
                {(!model.output_types || model.output_types.length === 0) && (
                  <li className="text-gray-300">Not specified yet.</li>
                )}
              </ul>
            </div>
          </div>

          {contactOpen && <ContactModal modelName={model.name} onClose={() => setContactOpen(false)} />}

          <div className="bg-[#F4F9F9] border border-dashed border-[#A0CECC] rounded-2xl p-6 flex items-center justify-between gap-4 flex-wrap">
            {isSignedIn ? (
              <>
                <div>
                  <p className="text-sm font-semibold text-[#1A2624] mb-0.5">Have more questions about this model?</p>
                  <p className="text-sm text-gray-500">We&apos;re happy to walk you through it before you run it.</p>
                </div>
                <button onClick={() => setContactOpen(true)}
                  className="flex-shrink-0 inline-flex items-center gap-2 bg-[#3D7A72] hover:bg-[#2A5750] text-white text-sm font-semibold px-4 py-2.5 rounded-xl transition-colors shadow-sm cursor-pointer">
                  Contact us →
                </button>
              </>
            ) : (
              <>
                <div>
                  <p className="text-sm font-semibold text-[#1A2624] mb-0.5">Ready to run this on your own imagery?</p>
                  <p className="text-sm text-gray-500">Sign in to upload an image and get results in minutes.</p>
                </div>
                <SignInButton mode="modal" forceRedirectUrl="/dashboard/models">
                  <button className="flex-shrink-0 inline-flex items-center gap-2 bg-[#3D7A72] hover:bg-[#2A5750] text-white text-sm font-semibold px-4 py-2.5 rounded-xl transition-colors shadow-sm cursor-pointer">
                    Sign in →
                  </button>
                </SignInButton>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
