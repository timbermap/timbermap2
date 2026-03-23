'use client'
import { useUser } from '@clerk/nextjs'
import { useState, useRef, useEffect, useCallback } from 'react'
import Spinner from '@/components/Spinner'

type ImageFile = {
  id: string
  filename: string
  epsg: string | null
  num_bands: number | null
  area_ha: number | null
  filesize: number | null
  pixel_size_x: number | null
  status: string
  created_at: string
}

type Job = {
  id: string
  type: string
  status: string
  input_ref: Record<string, unknown> | null
}

type UploadItem = {
  file: File
  progress: number
  status: 'waiting' | 'uploading' | 'done' | 'error'
  message: string
}

type TransformForm = {
  new_epsg: string
  new_resolution_x: string
  new_resolution_y: string
}

export default function ImagesPage() {
  const { user, isLoaded } = useUser()
  const [uploads, setUploads] = useState<UploadItem[]>([])
  const [images, setImages] = useState<ImageFile[]>([])
  const [activeImageIds, setActiveImageIds] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [showTransform, setShowTransform] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)
  const [transforming, setTransforming] = useState(false)
  const [transform, setTransform] = useState<TransformForm>({
    new_epsg: '', new_resolution_x: '', new_resolution_y: ''
  })
  const fileRef = useRef<HTMLInputElement>(null)
  const API = process.env.NEXT_PUBLIC_API_URL || "https://timbermap-api-788407107542.us-central1.run.app"

  const fetchData = useCallback(async () => {
    if (!isLoaded || !user) { setLoading(false); return }
    try {
      const [imgRes, jobsRes] = await Promise.all([
        fetch(`${API}/images/${user.id}`),
        fetch(`${API}/jobs/${user.id}`),
      ])
      const imgData = await imgRes.json()
      const jobsData = await jobsRes.json()
      setImages(imgData.images || [])
      const active = new Set<string>()
      for (const job of (jobsData.jobs || []) as Job[]) {
        if (job.status === 'queued' || job.status === 'running') {
          const iid = job.input_ref?.image_id as string | undefined
          if (iid) active.add(iid)
        }
      }
      setActiveImageIds(active)
    } catch (e) {
      console.error('fetchData failed', e)
    } finally {
      setLoading(false)
    }
  }, [user, isLoaded, API])

  useEffect(() => { if (isLoaded && user) fetchData() }, [user, fetchData])
  useEffect(() => {
    const interval = setInterval(fetchData, 5000)
    return () => clearInterval(interval)
  }, [fetchData])

  async function uploadSingle(item: UploadItem, index: number) {
    if (!isLoaded || !user) { setLoading(false); return }
    const updateItem = (patch: Partial<UploadItem>) =>
      setUploads(prev => prev.map((u, i) => i === index ? { ...u, ...patch } : u))
    updateItem({ status: 'uploading', message: 'Getting upload URL...' })
    try {
      const res = await fetch(`${API}/upload/signed-url`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filename: item.file.name, content_type: item.file.type || 'image/tiff',
          clerk_id: user.id, email: user.emailAddresses[0]?.emailAddress,
          username: user.username || user.firstName || user.id,
          file_type: 'raster', filesize: item.file.size,
        }),
      })
      const { url, gcs_path } = await res.json()
      updateItem({ message: 'Uploading...' })
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest()
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) updateItem({ progress: Math.round((e.loaded / e.total) * 100) })
        }
        xhr.onload = () => xhr.status === 200 ? resolve() : reject(xhr.statusText)
        xhr.onerror = () => reject('Upload failed')
        xhr.open('PUT', url)
        xhr.setRequestHeader('Content-Type', item.file.type || 'image/tiff')
        xhr.send(item.file)
      })
      updateItem({ message: 'Saving...' })
      await fetch(`${API}/upload/confirm`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clerk_id: user.id, filename: item.file.name,
          gcs_path, filesize: item.file.size, file_type: 'raster',
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
    const items: UploadItem[] = files.map(f => ({ file: f, progress: 0, status: 'waiting', message: 'Waiting...' }))
    setUploads(items)
    await Promise.all(items.map((item, i) => uploadSingle(item, i)))
    await fetchData()
    setTimeout(() => setUploads([]), 3000)
    if (fileRef.current) fileRef.current.value = ''
  }

  async function handleTransform() {
    if (!user || !selectedId) return
    setTransforming(true)
    try {
      await fetch(`${API}/images/transform`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clerk_id: user.id, image_id: selectedId,
          new_epsg: transform.new_epsg || null,
          new_resolution_x: transform.new_resolution_x ? parseFloat(transform.new_resolution_x) : null,
          new_resolution_y: transform.new_resolution_y ? parseFloat(transform.new_resolution_y) : null,
        }),
      })
      setShowTransform(false)
      setSelectedId(null)
      setTransform({ new_epsg: '', new_resolution_x: '', new_resolution_y: '' })
      await fetchData()
    } finally {
      setTransforming(false)
    }
  }

  async function handleDelete() {
    if (!user || !deletingId) return
    setIsDeleting(true)
    try {
      await fetch(`${API}/images/${deletingId}?clerk_id=${user.id}`, { method: 'DELETE' })
      setShowDeleteConfirm(false)
      setDeletingId(null)
      await fetchData()
    } catch (err) {
      console.error('Delete failed', err)
    } finally {
      setIsDeleting(false)
    }
  }




  function formatSize(bytes: number | null) {
    if (!bytes) return '—'
    if (bytes > 1e9) return (bytes / 1e9).toFixed(1) + ' GB'
    if (bytes > 1e6) return (bytes / 1e6).toFixed(1) + ' MB'
    return (bytes / 1e3).toFixed(0) + ' KB'
  }

  function formatDate(iso: string | null) {
    if (!iso) return '—'
    const d = new Date(iso)
    return d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' })
  }

  function formatGSD(pixelSize: number | null, epsg: string | null) {
    if (!pixelSize) return '—'
    let meters = pixelSize
    // If EPSG:4326, pixel size is in degrees → convert to meters
    if (epsg === '4326' || epsg === 'EPSG:4326') {
      meters = pixelSize * 111320
    }
    if (meters < 1) return (meters * 100).toFixed(1) + ' cm'
    return meters.toFixed(2) + ' m'
  }

  async function handleDownload(imageId: string) {
    if (!user) return
    const res = await fetch(`${API}/images/${imageId}/download?clerk_id=${user.id}`)
    const data = await res.json()
    if (data.url) { const a = document.createElement('a'); a.href = data.url; a.download = ''; a.click() }
  }

  const statusColor: Record<string, string> = {
    uploaded: 'bg-blue-50 text-blue-700', processing: 'bg-yellow-50 text-yellow-700',
    ready: 'bg-green-50 text-green-700', failed: 'bg-red-50 text-red-700',
  }
  const uploadColor: Record<string, string> = {
    waiting: 'bg-gray-100', uploading: 'bg-[#2C5F45]', done: 'bg-green-500', error: 'bg-red-400',
  }

  const deletingFilename = images.find(i => i.id === deletingId)?.filename

  return (
    <div className="max-w-6xl">
      <div className="mb-6 flex items-start justify-between">
        <div>
          <p className="text-xs font-medium tracking-widest uppercase text-[#5A9E7C] mb-1">Catalog</p>
          <h1 className="text-2xl font-semibold text-[#1C1C1C]">Images</h1>
          <p className="text-gray-400 mt-1 text-sm">Upload and manage your raster files</p>
        </div>
        <button onClick={() => fileRef.current?.click()}
          className="bg-[#2C5F45] text-white px-5 py-2.5 rounded-lg text-sm font-medium hover:bg-[#3D7A5A] transition-colors">
          + Upload images
        </button>
        <input ref={fileRef} type="file" accept=".tif,.tiff" multiple className="hidden" onChange={handleFiles} />
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

      {/* Transform modal */}
      {showTransform && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-6 w-full max-w-md shadow-xl">
            <h2 className="text-lg font-semibold text-[#1C1C1C] mb-1">Transform image</h2>
            <p className="text-sm text-gray-400 mb-5">Leave fields blank to keep existing values</p>
            <div className="space-y-4">
              <div>
                <label className="text-xs font-medium tracking-widest uppercase text-gray-400 block mb-1.5">Reproject to EPSG</label>
                <input type="text" placeholder="e.g. 4326 or 32718"
                  value={transform.new_epsg} onChange={e => setTransform(t => ({...t, new_epsg: e.target.value}))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#2C5F45]" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium tracking-widest uppercase text-gray-400 block mb-1.5">Resolution X (m)</label>
                  <input type="number" placeholder="e.g. 0.5" value={transform.new_resolution_x}
                    onChange={e => setTransform(t => ({...t, new_resolution_x: e.target.value}))}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#2C5F45]" />
                </div>
                <div>
                  <label className="text-xs font-medium tracking-widest uppercase text-gray-400 block mb-1.5">Resolution Y (m)</label>
                  <input type="number" placeholder="e.g. 0.5" value={transform.new_resolution_y}
                    onChange={e => setTransform(t => ({...t, new_resolution_y: e.target.value}))}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#2C5F45]" />
                </div>
              </div>
            </div>
            <div className="flex gap-3 mt-6">
              <button onClick={handleTransform} disabled={transforming}
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

      {/* Delete confirm modal */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-6 w-full max-w-sm shadow-xl">
            <h2 className="text-lg font-semibold text-[#1C1C1C] mb-1">Delete image</h2>
            <p className="text-sm text-gray-400 mb-1">This will permanently delete:</p>
            <p className="text-sm font-medium text-gray-700 mb-4">{deletingFilename}</p>
            <p className="text-xs text-gray-400 mb-6">The file will be removed from storage and the database. This cannot be undone.</p>
            <div className="flex gap-3">
              <button onClick={handleDelete} disabled={isDeleting}
                className="flex-1 bg-red-500 text-white py-2.5 rounded-lg text-sm font-medium hover:bg-red-600 transition-colors disabled:opacity-50">
                {isDeleting ? 'Deleting...' : 'Delete permanently'}
              </button>
              <button onClick={() => { setShowDeleteConfirm(false); setDeletingId(null) }}
                className="flex-1 border border-gray-200 text-gray-600 py-2.5 rounded-lg text-sm hover:bg-gray-50 transition-colors">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {loading ? (
        <Spinner text="Loading images..." />
      ) : images.length === 0 && uploads.length === 0 ? (
        <div className="bg-white rounded-xl border-2 border-dashed border-gray-200 p-16 text-center cursor-pointer hover:border-[#5A9E7C] transition-colors"
          onClick={() => fileRef.current?.click()}>
          <div className="w-10 h-10 rounded-full bg-[#EDF4F0] flex items-center justify-center mx-auto mb-3">
            <span className="text-[#2C5F45] text-lg">+</span>
          </div>
          <p className="text-gray-500 text-sm font-medium">Click to upload images</p>
          <p className="text-gray-300 text-xs mt-1">GeoTIFF files up to 5GB · multiple files supported</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50/50">
                <th className="text-left px-5 py-3 text-xs font-medium tracking-widest uppercase text-gray-400">Filename</th>
                <th className="text-left px-5 py-3 text-xs font-medium tracking-widest uppercase text-gray-400">EPSG</th>
                <th className="text-left px-5 py-3 text-xs font-medium tracking-widest uppercase text-gray-400">Bands</th>
                <th className="text-left px-5 py-3 text-xs font-medium tracking-widest uppercase text-gray-400">GSD</th>
                <th className="text-left px-5 py-3 text-xs font-medium tracking-widest uppercase text-gray-400">Area (ha)</th>
                <th className="text-left px-5 py-3 text-xs font-medium tracking-widest uppercase text-gray-400">Size</th>
                <th className="text-left px-5 py-3 text-xs font-medium tracking-widest uppercase text-gray-400">Uploaded</th>
                <th className="text-left px-5 py-3 text-xs font-medium tracking-widest uppercase text-gray-400">Status</th>
                <th className="text-left px-5 py-3 text-xs font-medium tracking-widest uppercase text-gray-400">Actions</th>
              </tr>
            </thead>
            <tbody>
              {images.map(img => {
                const isActive = activeImageIds.has(img.id)
                return (
                  <tr key={img.id} className="border-b border-gray-50 hover:bg-gray-50/50 transition-colors">
                    <td className="px-5 py-3.5 text-gray-900 font-medium">{img.filename}</td>
                    <td className="px-5 py-3.5 text-gray-500">{img.epsg || '—'}</td>
                    <td className="px-5 py-3.5 text-gray-500">{img.num_bands || '—'}</td>
                    <td className="px-5 py-3.5 text-gray-500">{formatGSD(img.pixel_size_x)}</td>
                    <td className="px-5 py-3.5 text-gray-500">{img.area_ha ? img.area_ha.toLocaleString() : '—'}</td>
                    <td className="px-5 py-3.5 text-gray-500">{formatSize(img.filesize)}</td>
                    <td className="px-5 py-3.5 text-gray-500">{formatDate(img.created_at)}</td>
                    <td className="px-5 py-3.5">
                      {isActive ? (
                        <span className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full font-medium bg-yellow-50 text-yellow-700">
                          <svg className="animate-spin" xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
                          Processing
                        </span>
                      ) : (
                        <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${statusColor[img.status] || 'bg-gray-50 text-gray-500'}`}>
                          {img.status}
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-3.5">
                      {isActive || (isDeleting && deletingId === img.id) ? (
                        <span className="inline-flex items-center gap-1.5 text-xs text-gray-400">
                          {isDeleting && deletingId === img.id ? (
                            <><svg className="animate-spin" xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg> Deleting...</>
                          ) : 'Busy...'}
                        </span>
                      ) : (
                        <div className="flex items-center gap-3">
                          <button onClick={() => { setSelectedId(img.id); setShowTransform(true) }}
                            className="text-xs text-[#2C5F45] hover:underline font-medium cursor-pointer">
                            Transform
                          </button>
                          <button onClick={() => handleDownload(img.id)} title="Download"
                            className="text-gray-400 hover:text-[#2C5F45] cursor-pointer transition-colors">
                            <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                          </button>
                          <button onClick={() => { setDeletingId(img.id); setShowDeleteConfirm(true) }} title="Delete"
                            className="text-gray-400 hover:text-red-500 cursor-pointer transition-colors">
                            <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
