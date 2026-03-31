'use client'
import { useUser } from '@clerk/nextjs'
import { useState, useEffect, useCallback } from 'react'
import Spinner from '@/components/Spinner'

type Model = {
  id: string
  name: string
  slug: string
  description: string
  pipeline_type: string
  output_types: string[]
  is_active: boolean
}
type ImageFile = {
  id: string; filename: string; status: string
  epsg: string | null; area_ha: number | null
}
type VectorFile = { id: string; filename: string; status: string }
type RunState = {
  modelId: string; imageId: string; vectorId: string
  aoiMode: 'none' | 'vector' | 'geojson'
  aoiGeojson: string
  running: boolean; jobId: string | null; error: string | null
}

// ── Heroicons (solid, 20px) ───────────────────────────────────────────────────
const PlayIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5">
    <path d="M6.3 2.84A1.5 1.5 0 0 0 4 4.11v11.78a1.5 1.5 0 0 0 2.3 1.27l9.344-5.891a1.5 1.5 0 0 0 0-2.538L6.3 2.841Z"/>
  </svg>
)
const XMarkIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5">
    <path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z"/>
  </svg>
)
const SpinnerIcon = () => (
  <svg className="animate-spin w-3.5 h-3.5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
  </svg>
)
const CheckIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5">
    <path fillRule="evenodd" d="M16.704 4.153a.75.75 0 0 1 .143 1.052l-8 10.5a.75.75 0 0 1-1.127.075l-4.5-4.5a.75.75 0 0 1 1.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 0 1 1.05-.143Z" clipRule="evenodd"/>
  </svg>
)
const ArrowRightIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-3 h-3">
    <path fillRule="evenodd" d="M3 10a.75.75 0 0 1 .75-.75h10.638L10.23 5.29a.75.75 0 1 1 1.04-1.08l5.5 5.25a.75.75 0 0 1 0 1.08l-5.5 5.25a.75.75 0 1 1-1.04-1.08l4.158-3.96H3.75A.75.75 0 0 1 3 10Z" clipRule="evenodd"/>
  </svg>
)
const PhotoIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5">
    <path fillRule="evenodd" d="M1 5.25A2.25 2.25 0 0 1 3.25 3h13.5A2.25 2.25 0 0 1 19 5.25v9.5A2.25 2.25 0 0 1 16.75 17H3.25A2.25 2.25 0 0 1 1 14.75v-9.5Zm1.5 5.81v3.69c0 .414.336.75.75.75h13.5a.75.75 0 0 0 .75-.75v-2.69l-2.22-2.219a.75.75 0 0 0-1.06 0l-1.91 1.909.47.47a.75.75 0 1 1-1.06 1.06L6.53 8.091a.75.75 0 0 0-1.06 0l-2.97 2.97ZM12 7a1 1 0 1 1-2 0 1 1 0 0 1 2 0Z" clipRule="evenodd"/>
  </svg>
)
const MapPinIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5">
    <path fillRule="evenodd" d="m9.69 18.933.003.001C9.89 19.02 10 19 10 19s.11.02.308-.066l.002-.001.006-.003.018-.008a5.741 5.741 0 0 0 .281-.14c.186-.096.446-.24.757-.433.62-.384 1.445-.966 2.274-1.765C15.302 14.988 17 12.493 17 9A7 7 0 1 0 3 9c0 3.492 1.698 5.988 3.355 7.584a13.731 13.731 0 0 0 2.273 1.765 11.842 11.842 0 0 0 .788.472l.018.008.006.003ZM10 11.25a2.25 2.25 0 1 0 0-4.5 2.25 2.25 0 0 0 0 4.5Z" clipRule="evenodd"/>
  </svg>
)
const WarnIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5 flex-shrink-0">
    <path fillRule="evenodd" d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495ZM10 5a.75.75 0 0 1 .75.75v3.5a.75.75 0 0 1-1.5 0v-3.5A.75.75 0 0 1 10 5Zm0 9a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z" clipRule="evenodd"/>
  </svg>
)

const pipelineLabel: Record<string, string> = {
  blob_detection: 'Object Detection',
  hough_lines:    'Line Detection',
  zonal_grid:     'Zonal Analysis',
}
const outputLabel: Record<string, string> = {
  raster_cog: 'Raster COG',
  geojson:    'GeoJSON',
  shapefile:  'Shapefile',
  csv:        'CSV',
}

export default function ModelsPage() {
  const { user, isLoaded } = useUser()
  const [models,   setModels]   = useState<Model[]>([])
  const [images,   setImages]   = useState<ImageFile[]>([])
  const [vectors,  setVectors]  = useState<VectorFile[]>([])
  const [loading,  setLoading]  = useState(true)
  const [selected, setSelected] = useState<string | null>(null)
  const [run, setRun] = useState<RunState>({
    modelId: '', imageId: '', vectorId: '', aoiMode: 'none', aoiGeojson: '', running: false, jobId: null, error: null,
  })
  const API = process.env.NEXT_PUBLIC_API_URL || 'https://timbermap-api-788407107542.us-central1.run.app'

  const fetchAll = useCallback(async () => {
    if (!isLoaded || !user) return
    try {
      const [mR, iR, vR] = await Promise.all([
        fetch(`${API}/models/available`, { headers: { 'x-clerk-id': user.id } }),
        fetch(`${API}/images/${user.id}`),
        fetch(`${API}/vectors/${user.id}`),
      ])
      const [mD, iD, vD] = await Promise.all([mR.json(), iR.json(), vR.json()])
      setModels(mD.models || [])
      setImages((iD.images || []).filter((i: ImageFile) => i.status === 'ready'))
      setVectors((vD.vectors || []).filter((v: VectorFile) => v.status === 'ready'))
    } catch (e) { console.error(e) }
    finally { setLoading(false) }
  }, [user, isLoaded, API])

  useEffect(() => { if (isLoaded && user) fetchAll() }, [isLoaded, user, fetchAll])

  async function handleRun(modelId: string) {
    if (!run.imageId) return
    setRun(r => ({ ...r, running: true, error: null, jobId: null }))
    try {
      const res = await fetch(`${API}/jobs/run-model`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clerk_id: user!.id, model_id: modelId,
          image_id: run.imageId,
          vector_id: run.aoiMode === 'vector' ? (run.vectorId || null) : null,
          params: run.aoiMode === 'geojson' && run.aoiGeojson
            ? { aoi_geojson: JSON.parse(run.aoiGeojson) }
            : {},
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.detail || 'Failed')
      setRun(r => ({ ...r, running: false, jobId: data.job_id }))
    } catch (e) {
      setRun(r => ({ ...r, running: false, error: String(e) }))
    }
  }

  if (!isLoaded || loading) return (
    <div className="w-full">
      <div className="flex items-start justify-between mb-6">
        <div>
          <p className="text-xs font-medium tracking-widest uppercase text-[#6AA8A0] mb-1">AI Models</p>
          <h1 className="text-2xl font-semibold text-[#1C1C1C]">Models</h1>
        </div>
        <a href="/dashboard/catalog"
          className="flex items-center gap-2 bg-[#EEF7F6] hover:bg-[#D6EEED] text-[#3D7A72] font-medium text-sm px-3.5 py-2 rounded-xl transition-colors border border-[#A0CECC]/50">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4">
            <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6A2.25 2.25 0 0 1 6 3.75h2.25A2.25 2.25 0 0 1 10.5 6v2.25a2.25 2.25 0 0 1-2.25 2.25H6a2.25 2.25 0 0 1-2.25-2.25V6ZM3.75 15.75A2.25 2.25 0 0 1 6 13.5h2.25a2.25 2.25 0 0 1 2.25 2.25V18a2.25 2.25 0 0 1-2.25 2.25H6A2.25 2.25 0 0 1 3.75 18v-2.25ZM13.5 6a2.25 2.25 0 0 1 2.25-2.25H18A2.25 2.25 0 0 1 20.25 6v2.25A2.25 2.25 0 0 1 18 10.5h-2.25a2.25 2.25 0 0 1-2.25-2.25V6ZM13.5 15.75a2.25 2.25 0 0 1 2.25-2.25H18a2.25 2.25 0 0 1 2.25 2.25V18A2.25 2.25 0 0 1 18 20.25h-2.25A2.25 2.25 0 0 1 13.5 18v-2.25Z"/>
          </svg>
          Model catalog
        </a>
      </div>
      <Spinner text="Loading models..." />
    </div>
  )

  return (
    <div className="w-full">
      {/* Header */}
      <div className="mb-7">
        <div className="flex items-start justify-between mb-1">
          <div>
            <p className="text-xs font-medium tracking-widest uppercase text-[#6AA8A0] mb-1">AI Models</p>
            <h1 className="text-2xl font-semibold text-[#1C1C1C]">Models</h1>
          </div>
          <a href="/dashboard/catalog"
            className="flex items-center gap-2 bg-[#EEF7F6] hover:bg-[#D6EEED] text-[#3D7A72] font-medium text-sm px-3.5 py-2 rounded-xl transition-colors border border-[#A0CECC]/50">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6A2.25 2.25 0 0 1 6 3.75h2.25A2.25 2.25 0 0 1 10.5 6v2.25a2.25 2.25 0 0 1-2.25 2.25H6a2.25 2.25 0 0 1-2.25-2.25V6ZM3.75 15.75A2.25 2.25 0 0 1 6 13.5h2.25a2.25 2.25 0 0 1 2.25 2.25V18a2.25 2.25 0 0 1-2.25 2.25H6A2.25 2.25 0 0 1 3.75 18v-2.25ZM13.5 6a2.25 2.25 0 0 1 2.25-2.25H18A2.25 2.25 0 0 1 20.25 6v2.25A2.25 2.25 0 0 1 18 10.5h-2.25a2.25 2.25 0 0 1-2.25-2.25V6ZM13.5 15.75a2.25 2.25 0 0 1 2.25-2.25H18a2.25 2.25 0 0 1 2.25 2.25V18A2.25 2.25 0 0 1 18 20.25h-2.25A2.25 2.25 0 0 1 13.5 18v-2.25Z"/>
            </svg>
            Model catalog
          </a>
        </div>
        <p className="text-gray-400 mt-1 text-sm">Select a model and run it on your geospatial imagery</p>
      </div>

      {models.length === 0 ? (
        <div className="bg-white rounded-2xl border-2 border-dashed border-gray-200 p-20 text-center">
          <p className="text-gray-400 text-sm font-medium">No models available yet</p>
          <p className="text-gray-300 text-xs mt-1">Contact your administrator to request access</p>
        </div>
      ) : (
        <div className="space-y-3">
          {models.map((model, idx) => {
            const isOpen        = selected === model.id
            const isThisRunning = run.running && run.modelId === model.id
            const thisJobId     = run.modelId === model.id ? run.jobId : null
            const thisError     = run.modelId === model.id ? run.error : null

            return (
              <div key={model.id}
                className={`rounded-2xl overflow-hidden border transition-all duration-200 ${
                  isOpen
                    ? 'border-[#A0CECC] shadow-sm'
                    : 'border-gray-100 bg-white shadow-sm hover:shadow-md hover:border-gray-200'
                }`}>

                {/* Card header */}
                <div className={`px-6 py-5 flex items-start gap-5 ${isOpen ? 'bg-[#EEF7F6]' : 'bg-white'}`}>
                  {/* Number badge */}
                  <div className={`flex-shrink-0 w-8 h-8 rounded-xl flex items-center justify-center text-xs font-bold tabular-nums mt-0.5 ${
                    isOpen ? 'bg-[#A0CECC] text-[#3D7A72]' : 'bg-[#EEF7F6] text-[#6AA8A0]'
                  }`}>
                    {String(idx + 1).padStart(2, '0')}
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1.5">
                      <h2 className="text-sm font-semibold text-[#1C1C1C]">{model.name}</h2>
                      <span className="inline-flex items-center text-xs px-2 py-0.5 rounded-full font-medium bg-[#EEF7F6] text-[#3D7A72] border border-[#A0CECC]">
                        {pipelineLabel[model.pipeline_type] || model.pipeline_type}
                      </span>
                    </div>

                    <p className="text-sm text-gray-500 leading-relaxed">{model.description}</p>

                    {model.output_types?.length > 0 && (
                      <div className="flex items-center gap-1.5 mt-2.5 flex-wrap">
                        <span className="text-xs text-gray-400">Outputs:</span>
                        {model.output_types.map((t, i) => (
                          <span key={`${t}-${i}`}
                            className="text-xs px-1.5 py-0.5 rounded-md bg-gray-100 text-gray-500 font-mono">
                            {outputLabel[t] || t}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Button */}
                  <button
                    onClick={() => {
                      setSelected(isOpen ? null : model.id)
                      setRun({ modelId: model.id, imageId: '', vectorId: '', aoiMode: 'none', aoiGeojson: '', running: false, jobId: null, error: null })
                    }}
                    className={`flex-shrink-0 inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-medium transition-all ${
                      isOpen
                        ? 'bg-white text-gray-500 hover:bg-gray-50 border border-gray-200'
                        : 'bg-[#3D7A72] text-white hover:bg-[#2A5750] shadow-sm'
                    }`}>
                    {isOpen ? <><XMarkIcon />Cancel</> : <><PlayIcon />Run</>}
                  </button>
                </div>

                {/* Run panel */}
                {isOpen && (
                  <div className="border-t border-[#A0CECC]/60 bg-white px-6 py-5">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">

                      {/* Image */}
                      <div>
                        <label className="flex items-center gap-1.5 text-xs font-medium text-gray-500 mb-2">
                          <span className="text-[#6AA8A0]"><PhotoIcon /></span>
                          Image <span className="text-red-400">*</span>
                        </label>
                        {images.length === 0 ? (
                          <div className="flex items-start gap-2 text-xs text-amber-600 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2.5">
                            <WarnIcon />
                            No processed images. Upload one first.
                          </div>
                        ) : (
                          <select
                            value={run.imageId}
                            onChange={e => setRun(r => ({ ...r, imageId: e.target.value }))}
                            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-700 bg-white focus:outline-none focus:border-[#6AA8A0] focus:ring-2 focus:ring-[#6AA8A0]/10 transition-all">
                            <option value="">Select an image...</option>
                            {images.map(img => (
                              <option key={img.id} value={img.id}>
                                {img.filename}{img.area_ha ? ` · ${img.area_ha.toLocaleString()} ha` : ''}{img.epsg ? ` · EPSG:${img.epsg}` : ''}
                              </option>
                            ))}
                          </select>
                        )}
                      </div>

                      {/* AOI */}
                      <div>
                        <label className="flex items-center gap-1.5 text-xs font-medium text-gray-500 mb-2">
                          <span className="text-[#6AA8A0]"><MapPinIcon /></span>
                          AOI
                          <span className="text-gray-300 font-normal">(optional)</span>
                        </label>

                        {/* Mode tabs */}
                        <div className="flex gap-1 mb-2">
                          {([
                            { key: 'none',    label: 'None' },
                            { key: 'vector',  label: 'Shapefile' },
                            { key: 'geojson', label: 'GeoJSON' },
                          ] as const).map(m => (
                            <button key={m.key}
                              onClick={() => setRun(r => ({ ...r, aoiMode: m.key }))}
                              className={`text-xs px-2.5 py-1 rounded-lg font-medium border transition-all ${
                                run.aoiMode === m.key
                                  ? 'bg-[#3D7A72] text-white border-[#3D7A72]'
                                  : 'bg-white text-gray-500 border-gray-200 hover:border-gray-300'
                              }`}>
                              {m.label}
                            </button>
                          ))}
                        </div>

                        {run.aoiMode === 'vector' && (
                          <select
                            value={run.vectorId}
                            onChange={e => setRun(r => ({ ...r, vectorId: e.target.value }))}
                            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-700 bg-white focus:outline-none focus:border-[#6AA8A0] focus:ring-2 focus:ring-[#6AA8A0]/10 transition-all">
                            <option value="">Select shapefile...</option>
                            {vectors.map(vec => (
                              <option key={vec.id} value={vec.id}>{vec.filename}</option>
                            ))}
                          </select>
                        )}

                        {run.aoiMode === 'geojson' && (
                          <div>
                            <textarea
                              value={run.aoiGeojson}
                              onChange={e => setRun(r => ({ ...r, aoiGeojson: e.target.value }))}
                              placeholder={'Paste GeoJSON here...\n{"type":"FeatureCollection","features":[...]}'}
                              rows={4}
                              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-xs font-mono text-gray-700 bg-white focus:outline-none focus:border-[#6AA8A0] focus:ring-2 focus:ring-[#6AA8A0]/10 transition-all resize-none" />
                            <div className="flex items-center gap-2 mt-1.5">
                              <p className="text-xs text-gray-400 flex-1">
                                Paste any GeoJSON — Feature, FeatureCollection, or Geometry
                              </p>
                              <button
                                onClick={() => {
                                  const stored = localStorage.getItem('map_drawn_aoi')
                                  if (stored) setRun(r => ({ ...r, aoiGeojson: stored }))
                                  else alert('No drawn AOI found. Draw a polygon on the Map page first.')
                                }}
                                className="text-xs text-[#6AA8A0] hover:text-[#3D7A72] font-medium whitespace-nowrap">
                                Use drawn AOI →
                              </button>
                            </div>
                          </div>
                        )}

                        {model.pipeline_type === 'hough_lines' && run.aoiMode !== 'none' && (
                          <p className="flex items-center gap-1.5 text-xs text-amber-600 mt-1.5">
                            <WarnIcon />
                            Shapefile must include CD_USO_SOLO, CD_SGF and RODAL for stand statistics.
                          </p>
                        )}
                      </div>
                    </div>

                    {/* Error */}
                    {thisError && (
                      <div className="mb-4 flex items-start gap-2 px-3.5 py-3 bg-red-50 border border-red-100 rounded-xl text-xs text-red-600">
                        <WarnIcon />{thisError}
                      </div>
                    )}

                    {/* Success */}
                    {thisJobId && (
                      <div className="mb-4 flex items-center justify-between px-3.5 py-3 bg-[#EEF7F6] border border-[#A0CECC] rounded-xl">
                        <div className="flex items-center gap-2 text-[#3D7A72] text-xs font-medium">
                          <CheckIcon />Job queued successfully
                        </div>
                        <a href="/dashboard/jobs"
                          className="inline-flex items-center gap-1 text-xs text-[#3D7A72] hover:underline font-medium">
                          View in Jobs <ArrowRightIcon />
                        </a>
                      </div>
                    )}

                    {/* Run button */}
                    <button
                      onClick={() => handleRun(model.id)}
                      disabled={!run.imageId || isThisRunning || (run.aoiMode === 'geojson' && !run.aoiGeojson)}
                      className="inline-flex items-center gap-2 px-4 py-2 bg-[#3D7A72] text-white rounded-xl text-xs font-medium hover:bg-[#2A5750] transition-colors disabled:opacity-40 disabled:cursor-not-allowed shadow-sm">
                      {isThisRunning ? <><SpinnerIcon />Queuing...</> : <><PlayIcon />Run model</>}
                    </button>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
