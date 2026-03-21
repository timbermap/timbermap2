'use client'
import { useUser } from '@clerk/nextjs'
import { useState, useRef, useEffect, useCallback } from 'react'
import Spinner from '@/components/Spinner'

type Vector = {
  id: string
  filename: string
  epsg: string | null
  geometry_type: string | null
  area_ha: number | null
  filesize: number | null
  status: string
  created_at: string
}

type UploadItem = {
  file: File
  progress: number
  status: 'waiting' | 'uploading' | 'done' | 'error'
  message: string
}

export default function VectorsPage() {
  const { user, isLoaded } = useUser()
  const [uploads, setUploads] = useState<UploadItem[]>([])
  const [vectors, setVectors] = useState<Vector[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [showTransform, setShowTransform] = useState(false)
  const [transforming, setTransforming] = useState(false)
  const [newEpsg, setNewEpsg] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)
  const API = process.env.NEXT_PUBLIC_API_URL || "https://timbermap-api-788407107542.us-central1.run.app"

  const fetchVectors = useCallback(async () => {
    if (!isLoaded) return
    if (!user) { setLoading(false); return }
    const res = await fetch(`${API}/vectors/${user.id}`)
    const data = await res.json()
    setVectors(data.vectors || [])
    setLoading(false)
  }, [user, isLoaded, API])

  useEffect(() => {
    if (isLoaded && user) fetchVectors()
  }, [user, fetchVectors])

  async function uploadSingle(item: UploadItem, index: number) {
    if (!isLoaded) return
    if (!user) { setLoading(false); return }
    const updateItem = (patch: Partial<UploadItem>) =>
      setUploads(prev => prev.map((u, i) => i === index ? { ...u, ...patch } : u))
    updateItem({ status: 'uploading', message: 'Getting upload URL...' })
    try {
      const res = await fetch(`${API}/upload/signed-url`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filename: item.file.name,
          content_type: 'application/zip',
          clerk_id: user.id,
          email: user.emailAddresses[0]?.emailAddress,
          username: user.username || user.firstName || user.id,
          file_type: 'vector',
          filesize: item.file.size,
        }),
      })
      const { url, gcs_path } = await res.json()
      updateItem({ message: 'Uploading...' })
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest()
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable)
            updateItem({ progress: Math.round((e.loaded / e.total) * 100) })
        }
        xhr.onload = () => xhr.status === 200 ? resolve() : reject(xhr.statusText)
        xhr.onerror = () => reject('Upload failed')
        xhr.open('PUT', url)
        xhr.setRequestHeader('Content-Type', 'application/zip')
        xhr.send(item.file)
      })
      updateItem({ message: 'Saving...' })
      await fetch(`${API}/upload/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clerk_id: user.id,
          filename: item.file.name,
          gcs_path,
          filesize: item.file.size,
          file_type: 'vector',
        }),
      })
      updateItem({ status: 'done', progress: 100, message: 'Done' })
    } catch (err) {
      updateItem({ status: 'error', message: 'Failed: ' + String(err) })
    }
  }

  async function handleFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files || [])
    if (!files.length) return
    const items: UploadItem[] = files.map(f => ({
      file: f, progress: 0, status: 'waiting', message: 'Waiting...'
    }))
    setUploads(items)
    await Promise.all(items.map((item, i) => uploadSingle(item, i)))
    await fetchVectors()
    setTimeout(() => setUploads([]), 3000)
    if (fileRef.current) fileRef.current.value = ''
  }

  async function handleTransform() {
    if (!user || !selectedId || !newEpsg) return
    setTransforming(true)
    try {
      await fetch(`${API}/vectors/transform`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clerk_id: user.id, vector_id: selectedId, new_epsg: newEpsg }),
      })
      setShowTransform(false)
      setSelectedId(null)
      setNewEpsg('')
      await fetchVectors()
    } finally {
      setTransforming(false)
    }
  }

  function formatSize(bytes: number | null) {
    if (!bytes) return '—'
    if (bytes > 1e9) return (bytes / 1e9).toFixed(1) + ' GB'
    if (bytes > 1e6) return (bytes / 1e6).toFixed(1) + ' MB'
    return (bytes / 1e3).toFixed(0) + ' KB'
  }

  async function handleDownload(vectorId: string) {
    if (!user) return
    const res = await fetch(`${API}/vectors/${vectorId}/download?clerk_id=${user.id}`)
    const data = await res.json()
    if (data.url) {
      const a = document.createElement('a')
      a.href = data.url
      a.download = ''
      a.click()
    }
  }

  const statusColor: Record<string, string> = {
    uploaded:   'bg-blue-50 text-blue-700',
    processing: 'bg-yellow-50 text-yellow-700',
    ready:      'bg-green-50 text-green-700',
    failed:     'bg-red-50 text-red-700',
  }

  const uploadColor: Record<string, string> = {
    waiting:  'bg-gray-100',
    uploading: 'bg-[#2C5F45]',
    done:     'bg-green-500',
    error:    'bg-red-400',
  }

  return (
    <div className="max-w-6xl">
      <div className="mb-6 flex items-start justify-between">
        <div>
          <p className="text-xs font-medium tracking-widest uppercase text-[#5A9E7C] mb-1">Catalog</p>
          <h1 className="text-2xl font-semibold text-[#1C1C1C]">Vectors</h1>
          <p className="text-gray-400 mt-1 text-sm">Upload and manage your shapefiles</p>
        </div>
        <button onClick={() => fileRef.current?.click()}
          className="bg-[#2C5F45] text-white px-5 py-2.5 rounded-lg text-sm font-medium hover:bg-[#3D7A5A] transition-colors">
          + Upload shapefile
        </button>
        <input ref={fileRef} type="file" accept=".zip" multiple className="hidden" onChange={handleFiles} />
      </div>

      <div className="mb-5 bg-[#EDF4F0] border border-[#C5DDD2] rounded-xl p-4">
        <p className="text-sm font-medium text-[#2C5F45] mb-1.5">How to prepare your shapefile</p>
        <ol className="text-sm text-[#3D7A5A] space-y-0.5 list-decimal list-inside">
          <li>Locate your folder containing .shp, .shx, .dbf, .prj files</li>
          <li>Select all files → right-click → Compress (Mac) or Send to Zip (Windows)</li>
          <li>Upload the .zip file here</li>
        </ol>
      </div>

      {uploads.length > 0 && (
        <div className="mb-5 bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="px-5 py-3 border-b border-gray-50">
            <p className="text-xs font-medium tracking-widest uppercase text-gray-400">
              Uploading {uploads.length} file{uploads.length > 1 ? 's' : ''}
            </p>
          </div>
          <div className="divide-y divide-gray-50">
            {uploads.map((u, i) => (
              <div key={i} className="px-5 py-3">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-sm text-gray-700 font-medium">{u.file.name}</span>
                  <span className="text-xs text-gray-400">{u.message}</span>
                </div>
                <div className="w-full bg-gray-100 rounded-full h-1">
                  <div className={`h-1 rounded-full transition-all duration-300 ${uploadColor[u.status]}`}
                    style={{ width: `${u.progress}%` }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {showTransform && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-6 w-full max-w-sm shadow-xl">
            <h2 className="text-lg font-semibold text-[#1C1C1C] mb-1">Reproject vector</h2>
            <p className="text-sm text-gray-400 mb-5">Enter the target coordinate system</p>
            <div>
              <label className="text-xs font-medium tracking-widest uppercase text-gray-400 block mb-1.5">Target EPSG code</label>
              <input type="text" placeholder="e.g. 4326 or 32718"
                value={newEpsg} onChange={e => setNewEpsg(e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#2C5F45]" />
              <p className="text-xs text-gray-300 mt-1.5">Find EPSG codes at epsg.io</p>
            </div>
            <div className="flex gap-3 mt-6">
              <button onClick={handleTransform} disabled={transforming || !newEpsg}
                className="flex-1 bg-[#2C5F45] text-white py-2.5 rounded-lg text-sm font-medium hover:bg-[#3D7A5A] transition-colors disabled:opacity-50">
                {transforming ? 'Queuing...' : 'Run transform'}
              </button>
              <button onClick={() => { setShowTransform(false); setSelectedId(null) }}
                className="flex-1 border border-gray-200 text-gray-600 py-2.5 rounded-lg text-sm hover:bg-gray-50 transition-colors">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {loading ? (
        <Spinner text="Loading shapefiles..." />
      ) : vectors.length === 0 && uploads.length === 0 ? (
        <div className="bg-white rounded-xl border-2 border-dashed border-gray-200 p-16 text-center cursor-pointer hover:border-[#5A9E7C] transition-colors"
          onClick={() => fileRef.current?.click()}>
          <div className="w-10 h-10 rounded-full bg-[#EDF4F0] flex items-center justify-center mx-auto mb-3">
            <span className="text-[#2C5F45] text-lg">+</span>
          </div>
          <p className="text-gray-500 text-sm font-medium">Click to upload shapefiles</p>
          <p className="text-gray-300 text-xs mt-1">Upload a .zip containing your shapefile components</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50/50">
                <th className="text-left px-5 py-3 text-xs font-medium tracking-widest uppercase text-gray-400">Filename</th>
                <th className="text-left px-5 py-3 text-xs font-medium tracking-widest uppercase text-gray-400">EPSG</th>
                <th className="text-left px-5 py-3 text-xs font-medium tracking-widest uppercase text-gray-400">Geometry</th>
                <th className="text-left px-5 py-3 text-xs font-medium tracking-widest uppercase text-gray-400">Area (ha)</th>
                <th className="text-left px-5 py-3 text-xs font-medium tracking-widest uppercase text-gray-400">Size</th>
                <th className="text-left px-5 py-3 text-xs font-medium tracking-widest uppercase text-gray-400">Status</th>
                <th className="text-left px-5 py-3 text-xs font-medium tracking-widest uppercase text-gray-400">Actions</th>
              </tr>
            </thead>
            <tbody>
              {vectors.map(v => (
                <tr key={v.id} className="border-b border-gray-50 hover:bg-gray-50/50 transition-colors">
                  <td className="px-5 py-3.5 text-gray-900 font-medium">{v.filename}</td>
                  <td className="px-5 py-3.5 text-gray-500">{v.epsg || '—'}</td>
                  <td className="px-5 py-3.5 text-gray-500">{v.geometry_type || '—'}</td>
                  <td className="px-5 py-3.5 text-gray-500">{v.area_ha ? v.area_ha.toLocaleString() : '—'}</td>
                  <td className="px-5 py-3.5 text-gray-500">{formatSize(v.filesize)}</td>
                  <td className="px-5 py-3.5">
                    <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${statusColor[v.status] || 'bg-gray-50 text-gray-500'}`}>
                      {v.status}
                    </span>
                  </td>
                  <td className="px-5 py-3.5">
                    <div className="flex items-center gap-3">
                      <button onClick={() => { setSelectedId(v.id); setShowTransform(true) }}
                        className="text-xs text-[#2C5F45] hover:underline font-medium cursor-pointer">Transform</button>
                      <button onClick={() => handleDownload(v.id)} title="Download" className="text-gray-400 hover:text-[#2C5F45] cursor-pointer transition-colors">
                        <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
