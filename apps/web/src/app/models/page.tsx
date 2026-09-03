'use client'
import Link from 'next/link'
import { useEffect, useState } from 'react'
import { useUser, UserButton } from '@clerk/nextjs'

interface PublicModel {
  id: string
  name: string
  slug: string
  description: string
  output_types: string[]
  is_free: boolean
  required_gsd_cm: number | null
  image_type_note: string | null
  sample_image_small_url: string | null
}

const OUTPUT_LABELS: Record<string, string> = {
  raster_cog: 'Raster COG', geojson: 'GeoJSON', shapefile: 'Shapefile', csv: 'CSV',
}

type Tier = 'all' | 'free' | 'pro'

export default function ModelCatalogPage() {
  const { isSignedIn, isLoaded } = useUser()
  const [models, setModels] = useState<PublicModel[] | null>(null)
  const [search, setSearch] = useState('')
  const [tier, setTier] = useState<Tier>('all')

  useEffect(() => {
    const API = process.env.NEXT_PUBLIC_API_URL || 'https://timbermap-api-tjrp7tcqaa-uc.a.run.app'
    fetch(`${API}/public/models`).then(r => r.ok ? r.json() : []).then(setModels).catch(() => setModels([]))
  }, [])

  const q = search.trim().toLowerCase()
  const filtered = (models || []).filter(m => {
    if (tier === 'free' && !m.is_free) return false
    if (tier === 'pro' && m.is_free) return false
    if (!q) return true
    return m.name.toLowerCase().includes(q) ||
      m.description.toLowerCase().includes(q) ||
      (m.image_type_note || '').toLowerCase().includes(q)
  })
  const freeCount = (models || []).filter(m => m.is_free).length
  const proCount  = (models || []).filter(m => !m.is_free).length

  return (
    <div className="min-h-screen bg-[#F7F8F6]">
      <nav className="border-b border-gray-100 bg-white">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <Link href={isSignedIn ? '/dashboard' : '/'} className="font-semibold text-[#2C5F45] text-lg tracking-wide">
            Timbermap
          </Link>
          {isLoaded && (isSignedIn ? (
            <div className="flex items-center gap-4">
              <Link href="/dashboard/catalog"
                className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-[#2C5F45] transition-colors">
                ← Back to your catalog
              </Link>
              <UserButton />
            </div>
          ) : (
            <Link href="/"
              className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-[#2C5F45] transition-colors">
              ← Back home
            </Link>
          ))}
        </div>
      </nav>

      <div className="max-w-6xl mx-auto px-6 py-12">
        <p className="text-xs font-semibold tracking-widest uppercase text-[#6AA8A0] mb-2">AI Models</p>
        <h1 className="text-3xl font-semibold text-[#1A2624] mb-2">Model Catalog</h1>
        <p className="text-gray-500 max-w-xl mb-10">
          Every model Timbermap runs on your imagery — what it detects, what resolution it needs,
          and what it hands back. Every plantation is different — if you need something specific,
          we can build it for you.
        </p>

        {models === null ? (
          <div className="flex items-center gap-2 text-gray-400 py-16 justify-center text-sm">
            <span className="w-4 h-4 border-2 border-[#3D7A72] border-t-transparent rounded-full animate-spin" />
            Loading models...
          </div>
        ) : (
        <>
          <div className="flex flex-col sm:flex-row gap-3 mb-8">
            <div className="relative flex-1">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor"
                className="w-4 h-4 text-gray-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none">
                <path fillRule="evenodd" d="M9 3.5a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11ZM2 9a7 7 0 1 1 12.452 4.391l3.328 3.329a.75.75 0 1 1-1.06 1.06l-3.329-3.328A7 7 0 0 1 2 9Z" clipRule="evenodd"/>
              </svg>
              <input
                type="text"
                placeholder="Search models by name, sensor, or use case..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="w-full pl-10 pr-10 py-2.5 border border-gray-200 rounded-xl text-sm text-gray-700 bg-white focus:outline-none focus:border-[#6AA8A0] focus:ring-2 focus:ring-[#6AA8A0]/10 transition-all placeholder-gray-400"
              />
              {search && (
                <button onClick={() => setSearch('')}
                  className="absolute right-3.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors">
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
                    <path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z"/>
                  </svg>
                </button>
              )}
            </div>
            <div className="flex gap-1.5 bg-white border border-gray-200 rounded-xl p-1">
              {([
                { key: 'all',  label: `All (${models.length})` },
                { key: 'free', label: `Free (${freeCount})` },
                { key: 'pro',  label: `Pro (${proCount})` },
              ] as const).map(f => (
                <button key={f.key} onClick={() => setTier(f.key)}
                  className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap ${
                    tier === f.key ? 'bg-[#3D7A72] text-white' : 'text-gray-500 hover:bg-gray-50'
                  }`}>
                  {f.label}
                </button>
              ))}
            </div>
          </div>

          {filtered.length === 0 ? (
            <div className="bg-white rounded-2xl border border-dashed border-gray-200 px-6 py-16 text-center">
              <p className="text-gray-400 text-sm">No models match your search.</p>
              <button onClick={() => { setSearch(''); setTier('all') }}
                className="text-xs text-[#3D7A72] hover:underline mt-2 font-medium">Clear filters</button>
            </div>
          ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {filtered.map(m => (
              <Link key={m.id} href={`/models/${m.slug}`}
                className="group bg-white rounded-2xl border border-gray-100 shadow-sm hover:shadow-md hover:border-gray-200 transition-all overflow-hidden">
                <div className="h-40 bg-[#EEF1EF] relative overflow-hidden">
                  {m.sample_image_small_url && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={m.sample_image_small_url} alt={m.name}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
                  )}
                  <span className={`absolute top-3 left-3 text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full ${
                    m.is_free ? 'bg-[#3D7A72] text-white' : 'bg-white/90 text-[#96814A]'
                  }`}>
                    {m.is_free ? 'Free' : 'Pro'}
                  </span>
                </div>
                <div className="p-5">
                  <h2 className="text-sm font-semibold text-[#1A2624] mb-1 group-hover:text-[#3D7A72] transition-colors">
                    {m.name}
                  </h2>
                  <p className="text-xs text-gray-500 leading-relaxed line-clamp-2 mb-3">{m.description}</p>
                  {(m.required_gsd_cm || m.image_type_note) && (
                    <p className="text-xs text-[#6AA8A0] font-medium mb-2">
                      {m.required_gsd_cm && <span>{m.required_gsd_cm}cm/px</span>}
                      {m.required_gsd_cm && m.image_type_note && ' · '}
                      {m.image_type_note}
                    </p>
                  )}
                  <div className="flex flex-wrap gap-1.5">
                    {(m.output_types || []).map((t, i) => (
                      <span key={`${t}-${i}`} className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-500 font-mono">
                        {OUTPUT_LABELS[t] || t}
                      </span>
                    ))}
                  </div>
                </div>
              </Link>
            ))}
          </div>
          )}
        </>
        )}
      </div>
    </div>
  )
}
