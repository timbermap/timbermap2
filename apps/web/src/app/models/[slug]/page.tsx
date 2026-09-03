'use client'
import Link from 'next/link'
import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { SignInButton } from '@clerk/nextjs'

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

export default function ModelDetailPage() {
  const { slug } = useParams<{ slug: string }>()
  const [model, setModel] = useState<PublicModel | null | 'notfound'>(null)

  useEffect(() => {
    const API = process.env.NEXT_PUBLIC_API_URL || 'https://timbermap-api-tjrp7tcqaa-uc.a.run.app'
    fetch(`${API}/public/models/${slug}`)
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(setModel)
      .catch(() => setModel('notfound'))
  }, [slug])

  if (model === 'notfound') {
    return (
      <div className="min-h-screen bg-[#F7F8F6] flex flex-col items-center justify-center px-6 text-center">
        <p className="text-gray-500 mb-4">Model not found.</p>
        <Link href="/models" className="text-[#3D7A72] font-medium hover:underline">← Back to catalog</Link>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#F7F8F6]">
      <nav className="border-b border-gray-100 bg-white">
        <div className="max-w-4xl mx-auto px-6 py-4 flex items-center justify-between">
          <Link href="/" className="font-semibold text-[#2C5F45] text-lg tracking-wide">Timbermap</Link>
          <Link href="/models"
            className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-[#2C5F45] transition-colors">
            ← All models
          </Link>
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

          <div className="bg-[#F4F9F9] border border-dashed border-[#A0CECC] rounded-2xl p-6 flex items-center justify-between gap-4 flex-wrap">
            <div>
              <p className="text-sm font-semibold text-[#1A2624] mb-0.5">Ready to run this on your own imagery?</p>
              <p className="text-sm text-gray-500">Sign in to upload an image and get results in minutes.</p>
            </div>
            <SignInButton mode="modal" forceRedirectUrl="/dashboard/models">
              <button className="flex-shrink-0 inline-flex items-center gap-2 bg-[#3D7A72] hover:bg-[#2A5750] text-white text-sm font-semibold px-4 py-2.5 rounded-xl transition-colors shadow-sm cursor-pointer">
                Sign in →
              </button>
            </SignInButton>
          </div>
        </div>
      )}
    </div>
  )
}
