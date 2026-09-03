'use client'
import Link from 'next/link'
import { useEffect, useState } from 'react'

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

export default function ModelCatalogPage() {
  const [models, setModels] = useState<PublicModel[] | null>(null)

  useEffect(() => {
    const API = process.env.NEXT_PUBLIC_API_URL || 'https://timbermap-api-tjrp7tcqaa-uc.a.run.app'
    fetch(`${API}/public/models`).then(r => r.ok ? r.json() : []).then(setModels).catch(() => setModels([]))
  }, [])

  return (
    <div className="min-h-screen bg-[#F7F8F6]">
      <nav className="border-b border-gray-100 bg-white">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <Link href="/" className="font-semibold text-[#2C5F45] text-lg tracking-wide">Timbermap</Link>
          <Link href="/"
            className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-[#2C5F45] transition-colors">
            ← Back home
          </Link>
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
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {models.map(m => (
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
      </div>
    </div>
  )
}
