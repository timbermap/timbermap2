'use client'
import { useUser } from '@clerk/nextjs'
import { useState, useRef, useEffect, useCallback } from 'react'
import Spinner from '@/components/Spinner'

type SortKey = 'filename' | 'created_at' | 'area_ha' | 'filesize' | 'status'
type SortDir = 'asc' | 'desc'

const PAGE_SIZE = 15

const SortIcon = ({ dir }: { dir?: SortDir }) => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-3 h-3 inline ml-1">
    {dir === 'asc' ? <path fillRule="evenodd" d="M10 17a.75.75 0 0 1-.75-.75V5.612L5.29 9.77a.75.75 0 0 1-1.08-1.04l5.25-5.5a.75.75 0 0 1 1.08 0l5.25 5.5a.75.75 0 1 1-1.08 1.04l-3.96-4.158V16.25A.75.75 0 0 1 10 17Z" clipRule="evenodd"/> :
     dir === 'desc' ? <path fillRule="evenodd" d="M10 3a.75.75 0 0 1 .75.75v10.638l3.96-4.158a.75.75 0 1 1 1.08 1.04l-5.25 5.5a.75.75 0 0 1-1.08 0l-5.25-5.5a.75.75 0 1 1 1.08-1.04l3.96 4.158V3.75A.75.75 0 0 1 10 3Z" clipRule="evenodd"/> :
     <path fillRule="evenodd" d="M2.24 6.8a.75.75 0 0 0 1.06-.04l1.95-2.1v8.59a.75.75 0 0 0 1.5 0V4.66l1.95 2.1a.75.75 0 1 0 1.1-1.02L6.53 2.24a.75.75 0 0 0-1.1 0L2.2 5.74a.75.75 0 0 0 .04 1.06Zm8 6.4a.75.75 0 0 0-.04 1.06l3.25 3.5a.75.75 0 0 0 1.1 0l3.25-3.5a.75.75 0 1 0-1.1-1.02l-1.95 2.1V7.75a.75.75 0 0 0-1.5 0v8.59l-1.95-2.1a.75.75 0 0 0-1.06-.04Z" clipRule="evenodd"/>}
  </svg>
)

type Vector = {
  id: string; filename: string; epsg: string | null
  geometry_type: string | null; area_ha: number | null
  filesize: number | null; status: string; created_at: string
}
type Job = { id: string; type: string; status: string; input_ref: Record<string, unknown> | null }
type UploadItem = { file: File; progress: number; status: 'waiting'|'uploading'|'done'|'error'; message: string }

const ArrowUpTrayIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
    <path d="M9.25 13.25a.75.75 0 0 0 1.5 0V4.636l2.955 3.129a.75.75 0 0 0 1.09-1.03l-4.25-4.5a.75.75 0 0 0-1.09 0l-4.25 4.5a.75.75 0 1 0 1.09 1.03L9.25 4.636v8.614Z"/>
    <path d="M3.5 12.75a.75.75 0 0 0-1.5 0v2.5A2.75 2.75 0 0 0 4.75 18h10.5A2.75 2.75 0 0 0 18 15.25v-2.5a.75.75 0 0 0-1.5 0v2.5c0 .69-.56 1.25-1.25 1.25H4.75c-.69 0-1.25-.56-1.25-1.25v-2.5Z"/>
  </svg>
)
const ArrowDownTrayIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5">
    <path d="M10.75 2.75a.75.75 0 0 0-1.5 0v8.614L6.295 8.235a.75.75 0 1 0-1.09 1.03l4.25 4.5a.75.75 0 0 0 1.09 0l4.25-4.5a.75.75 0 0 0-1.09-1.03l-2.955 3.129V2.75Z"/>
    <path d="M3.5 12.75a.75.75 0 0 0-1.5 0v2.5A2.75 2.75 0 0 0 4.75 18h10.5A2.75 2.75 0 0 0 18 15.25v-2.5a.75.75 0 0 0-1.5 0v2.5c0 .69-.56 1.25-1.25 1.25H4.75c-.69 0-1.25-.56-1.25-1.25v-2.5Z"/>
  </svg>
)
const TrashIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5">
    <path fillRule="evenodd" d="M8.75 1A2.75 2.75 0 0 0 6 3.75v.443c-.795.077-1.584.176-2.365.298a.75.75 0 1 0 .23 1.482l.149-.022.841 10.518A2.75 2.75 0 0 0 7.596 19h4.807a2.75 2.75 0 0 0 2.742-2.53l.841-10.52.149.023a.75.75 0 0 0 .23-1.482A41.03 41.03 0 0 0 14 3.193V3.75A2.75 2.75 0 0 0 11.25 1h-2.5ZM10 4c.84 0 1.673.025 2.5.075V3.75c0-.69-.56-1.25-1.25-1.25h-2.5c-.69 0-1.25.56-1.25 1.25v.325C8.327 4.025 9.16 4 10 4ZM8.58 7.72a.75.75 0 0 0-1.5.06l.3 7.5a.75.75 0 1 0 1.5-.06l-.3-7.5Zm4.34.06a.75.75 0 1 0-1.5-.06l-.3 7.5a.75.75 0 1 0 1.5.06l.3-7.5Z" clipRule="evenodd"/>
  </svg>
)
const ArrowsRightLeftIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5">
    <path fillRule="evenodd" d="M13.2 2.24a.75.75 0 0 0 .04 1.06l2.1 1.95H6.75a.75.75 0 0 0 0 1.5h8.59l-2.1 1.95a.75.75 0 1 0 1.02 1.1l3.5-3.25a.75.75 0 0 0 0-1.1l-3.5-3.25a.75.75 0 0 0-1.06.04Zm-6.4 8a.75.75 0 0 0-1.06-.04l-3.5 3.25a.75.75 0 0 0 0 1.1l3.5 3.25a.75.75 0 1 0 1.02-1.1l-2.1-1.95h8.59a.75.75 0 0 0 0-1.5H4.66l2.1-1.95a.75.75 0 0 0 .04-1.06Z" clipRule="evenodd"/>
  </svg>
)
const SpinnerIcon = () => (
  <svg className="animate-spin w-3 h-3" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
  </svg>
)
const MapPinIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5">
    <path fillRule="evenodd" d="m9.69 18.933.003.001C9.89 19.02 10 19 10 19s.11.02.308-.066l.002-.001.006-.003.018-.008a5.741 5.741 0 0 0 .281-.14c.186-.096.446-.24.757-.433.62-.384 1.445-.966 2.274-1.765C15.302 14.988 17 12.493 17 9A7 7 0 1 0 3 9c0 3.492 1.698 5.988 3.355 7.584a13.731 13.731 0 0 0 2.273 1.765 11.842 11.842 0 0 0 .788.472l.018.008.006.003ZM10 11.25a2.25 2.25 0 1 0 0-4.5 2.25 2.25 0 0 0 0 4.5Z" clipRule="evenodd"/>
  </svg>
)
// Empty map icon (for the empty state placeholder)
const MapBigIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-6 h-6">
    <path fillRule="evenodd" d="M8.157 2.176a1.5 1.5 0 0 0-1.147 0l-4.084 1.69A1.5 1.5 0 0 0 2 5.25v10.877a1.5 1.5 0 0 0 2.074 1.386l3.51-1.452 4.26 1.762a1.5 1.5 0 0 0 1.146 0l4.083-1.69A1.5 1.5 0 0 0 18 14.75V3.872a1.5 1.5 0 0 0-2.073-1.386l-3.51 1.452-4.26-1.762ZM7.5 5v11.25L5 17.5V5.75l2.5-1.034V5Zm2.5 11.25V5L12.5 3.75v11.25L10 16.25Zm2.5.5v-11.5l2.5-1.034V14.25l-2.5 1.034v-.5.466Z" clipRule="evenodd"/>
  </svg>
)

export default function VectorsPage() {
  const { user, isLoaded } = useUser()
  const [uploads, setUploads]   = useState<UploadItem[]>([])
  const [vectors, setVectors]   = useState<Vector[]>([])
  const [activeVectorIds, setActiveVectorIds] = useState<Set<string>>(new Set())
  const [loading, setLoading]   = useState(true)
  const [selectedId, setSelectedId]             = useState<string | null>(null)
  const [showTransform, setShowTransform]       = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [deletingId, setDeletingId]             = useState<string | null>(null)
  const [isDeleting, setIsDeleting]             = useState(false)
  const [transforming, setTransforming]         = useState(false)
  const [newEpsg, setNewEpsg]                   = useState('')
  const [sortKey, setSortKey] = useState<SortKey>('created_at')
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  const [page, setPage]       = useState(1)
  // Delete all
  const [confirmAll, setConfirmAll]   = useState(false)
  const [deletingAll, setDeletingAll] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const API = process.env.NEXT_PUBLIC_API_URL || 'https://timbermap-api-788407107542.us-central1.run.app'

  const fetchData = useCallback(async () => {
    if (!isLoaded || !user) { setLoading(false); return }
    try {
      const [vecRes, jobsRes] = await Promise.all([
        fetch(`${API}/vectors/${user.id}`),
        fetch(`${API}/jobs/${user.id}`),
      ])
      if (!vecRes.ok || !jobsRes.ok) throw new Error('Fetch failed')
      const vecData  = await vecRes.json()
      const jobsData = await jobsRes.json()
      setVectors(vecData.vectors || [])
      const active = new Set<string>()
      for (const job of (jobsData.jobs || []) as Job[]) {
        if (job.status === 'queued' || job.status === 'running') {
          const vid = job.input_ref?.vector_id as string | undefined
          if (vid) active.add(vid)
        }
      }
      setActiveVectorIds(active)
    } catch (e) { console.error('fetchData failed:', e) }
    finally { setLoading(false) }
  }, [user, isLoaded, API])

  useEffect(() => { if (isLoaded && user) fetchData() }, [isLoaded, user, fetchData])
  useEffect(() => { const t = setInterval(fetchData, 5000); return () => clearInterval(t) }, [fetchData])

  async function uploadSingle(item: UploadItem, index: number) {
    if (!isLoaded || !user) return
    const update = (patch: Partial<UploadItem>) =>
      setUploads(prev => prev.map((u, i) => i === index ? { ...u, ...patch } : u))
    update({ status: 'uploading', message: 'Getting upload URL...' })
    try {
      const res = await fetch(`${API}/upload/signed-url`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filename: item.file.name, content_type: 'application/zip',
          clerk_id: user.id, email: user.emailAddresses[0]?.emailAddress,
          username: user.username || user.firstName || user.id,
          file_type: 'vector', filesize: item.file.size,
        }),
      })
      if (!res.ok) throw new Error('Failed to get signed URL')
      const { url, gcs_path } = await res.json()
      update({ message: 'Uploading...' })
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest()
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) update({ progress: Math.round((e.loaded / e.total) * 100) })
        }
        xhr.onload  = () => xhr.status === 200 ? resolve() : reject(xhr.statusText)
        xhr.onerror = () => reject('Upload failed')
        xhr.open('PUT', url)
        xhr.setRequestHeader('Content-Type', 'application/zip')
        xhr.send(item.file)
      })
      update({ message: 'Processing...' })
      await fetch(`${API}/upload/confirm`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clerk_id: user.id, filename: item.file.name, gcs_path, filesize: item.file.size, file_type: 'vector' }),
      })
      update({ status: 'done', progress: 100, message: 'Done' })
    } catch (err) { update({ status: 'error', message: 'Failed: ' + String(err) }) }
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
    if (!user || !selectedId || !newEpsg) return
    setTransforming(true)
    try {
      await fetch(`${API}/vectors/transform`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clerk_id: user.id, vector_id: selectedId, new_epsg: newEpsg }),
      })
      setShowTransform(false); setSelectedId(null); setNewEpsg('')
      await fetchData()
    } finally { setTransforming(false) }
  }

  async function handleDelete() {
    if (!user || !deletingId) return
    setIsDeleting(true)
    try {
      await fetch(`${API}/vectors/${deletingId}?clerk_id=${user.id}`, { method: 'DELETE' })
      setShowDeleteConfirm(false); setDeletingId(null)
      await fetchData()
    } catch (err) { console.error('Delete failed:', err) }
    finally { setIsDeleting(false) }
  }

  async function handleDeleteAll() {
    if (!user) return
    setDeletingAll(true)
    try {
      await Promise.all(vectors.map(v =>
        fetch(`${API}/vectors/${v.id}?clerk_id=${user.id}`, { method: 'DELETE' }).catch(() => {})
      ))
      await fetchData()
    } finally { setDeletingAll(false); setConfirmAll(false) }
  }

  async function handleDownload(vectorId: string) {
    if (!user) return
    const res  = await fetch(`${API}/vectors/${vectorId}/download?clerk_id=${user.id}`)
    const data = await res.json()
    if (data.url) { const a = document.createElement('a'); a.href = data.url; a.download = ''; a.click() }
  }

  function viewOnMap(_v: Vector) {
    window.location.href = '/dashboard/map'
  }

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(key); setSortDir('asc') }
    setPage(1)
  }

  function formatSize(bytes: number | null) {
    if (!bytes) return '—'
    if (bytes > 1e6) return (bytes / 1e6).toFixed(1) + ' MB'
    return (bytes / 1e3).toFixed(0) + ' KB'
  }
  function formatDate(iso: string | null) {
    if (!iso) return '—'
    return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
  }

  const statusBadge: Record<string, string> = {
    uploaded:   'bg-blue-50 text-blue-600',
    processing: 'bg-amber-50 text-amber-600',
    ready:      'bg-[#EEF7F6] text-[#3D7A72]',
    failed:     'bg-red-50 text-red-500',
  }
  const progressColor: Record<string, string> = {
    waiting: 'bg-gray-200', uploading: 'bg-[#3D7A72]', done: 'bg-[#6AA8A0]', error: 'bg-red-400',
  }
  const deletingFilename = vectors.find(v => v.id === deletingId)?.filename

  const sorted = [...vectors].sort((a, b) => {
    const av = String(a[sortKey as keyof typeof a] || '').toLowerCase()
    const bv = String(b[sortKey as keyof typeof b] || '').toLowerCase()
    if (av < bv) return sortDir === 'asc' ? -1 : 1
    if (av > bv) return sortDir === 'asc' ? 1 : -1
    return 0
  })
  const totalPages = Math.ceil(sorted.length / PAGE_SIZE)
  const paged = sorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  return (
    <div className="w-full">

      {/* Delete all modal */}
      {confirmAll && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl w-full max-w-sm p-6 shadow-xl">
            <div className="w-10 h-10 rounded-full bg-red-50 flex items-center justify-center mx-auto mb-4">
              <TrashIcon />
            </div>
            <h3 className="font-semibold text-gray-900 text-center mb-1">Delete all vectors?</h3>
            <p className="text-sm text-gray-500 text-center mb-6">
              This will permanently delete all {vectors.length} shapefiles from storage and the database. This cannot be undone.
            </p>
            <div className="flex gap-3">
              <button onClick={() => setConfirmAll(false)} disabled={deletingAll}
                className="flex-1 px-4 py-2.5 border border-gray-200 text-gray-600 rounded-xl text-sm hover:bg-gray-50 transition-colors disabled:opacity-50">
                Cancel
              </button>
              <button onClick={handleDeleteAll} disabled={deletingAll}
                className="flex-1 px-4 py-2.5 bg-red-500 text-white rounded-xl text-sm hover:bg-red-600 transition-colors font-medium disabled:opacity-50 flex items-center justify-center gap-2">
                {deletingAll ? <><SpinnerIcon />Deleting...</> : 'Delete all'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="mb-6 flex items-start justify-between">
        <div>
          <p className="text-xs font-medium tracking-widest uppercase text-[#6AA8A0] mb-1">Catalog</p>
          <h1 className="text-2xl font-semibold text-[#1C1C1C]">Vectors</h1>
          <p className="text-gray-400 mt-1 text-sm">Upload and manage your shapefiles</p>
        </div>
        <button onClick={() => fileRef.current?.click()}
          className="inline-flex items-center gap-2 bg-[#3D7A72] text-white px-4 py-2.5 rounded-xl text-sm font-medium hover:bg-[#2A5750] transition-colors shadow-sm">
          <ArrowUpTrayIcon />
          Upload shapefile
        </button>
        <input ref={fileRef} type="file" accept=".zip" multiple className="hidden" onChange={handleFiles} />
      </div>

      {/* Instructions */}
      <div className="mb-5 bg-[#EEF7F6] border border-[#A0CECC] rounded-2xl p-4">
        <p className="text-sm font-medium text-[#3D7A72] mb-2">How to prepare your shapefile</p>
        <ol className="text-sm text-[#2A5750] space-y-1 list-decimal list-inside">
          <li>Locate your folder containing .shp, .shx, .dbf, .prj files</li>
          <li>Select all files → right-click → Compress (Mac) or Send to Zip (Windows)</li>
          <li>Upload the .zip file here</li>
        </ol>
      </div>

      {/* Upload progress */}
      {uploads.length > 0 && (
        <div className="mb-5 bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="px-5 py-3 border-b border-gray-50 bg-[#EEF7F6]">
            <p className="text-xs font-medium tracking-widest uppercase text-[#6AA8A0]">
              Uploading {uploads.length} file{uploads.length > 1 ? 's' : ''}
            </p>
          </div>
          <div className="divide-y divide-gray-50">
            {uploads.map((u, i) => (
              <div key={i} className="px-5 py-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm text-gray-700 font-medium">{u.file.name}</span>
                  <span className="text-xs text-gray-400">{u.message}</span>
                </div>
                <div className="w-full bg-gray-100 rounded-full h-1">
                  <div className={`h-1 rounded-full transition-all duration-300 ${progressColor[u.status]}`}
                    style={{ width: `${u.progress}%` }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Transform modal */}
      {showTransform && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 backdrop-blur-sm">
          <div className="bg-white rounded-2xl p-6 w-full max-w-sm shadow-2xl border border-gray-100">
            <h2 className="text-base font-semibold text-[#1C1C1C] mb-0.5">Reproject vector</h2>
            <p className="text-sm text-gray-400 mb-5">Enter the target coordinate system</p>
            <div>
              <label className="text-xs font-medium text-gray-500 block mb-1.5">Target EPSG code</label>
              <input type="text" placeholder="e.g. 4326 or 32718"
                value={newEpsg} onChange={e => setNewEpsg(e.target.value)}
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-[#6AA8A0] focus:ring-2 focus:ring-[#6AA8A0]/10 transition-all" />
              <p className="text-xs text-gray-300 mt-1.5">Find EPSG codes at epsg.io</p>
            </div>
            <div className="flex gap-2 mt-6">
              <button onClick={handleTransform} disabled={transforming || !newEpsg}
                className="flex-1 bg-[#3D7A72] text-white py-2.5 rounded-xl text-sm font-medium hover:bg-[#2A5750] transition-colors disabled:opacity-50 shadow-sm">
                {transforming ? 'Queuing...' : 'Run transform'}
              </button>
              <button onClick={() => { setShowTransform(false); setSelectedId(null) }}
                className="flex-1 border border-gray-200 text-gray-600 py-2.5 rounded-xl text-sm hover:bg-gray-50 transition-colors">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete single modal */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 backdrop-blur-sm">
          <div className="bg-white rounded-2xl p-6 w-full max-w-sm shadow-2xl border border-gray-100">
            <h2 className="text-base font-semibold text-[#1C1C1C] mb-1">Delete shapefile</h2>
            <p className="text-sm text-gray-400 mb-1">This will permanently delete:</p>
            <p className="text-sm font-medium text-gray-700 mb-4 bg-gray-50 px-3 py-2 rounded-lg">{deletingFilename}</p>
            <p className="text-xs text-gray-400 mb-6">The file will be removed from storage, PostGIS, and the database. This cannot be undone.</p>
            <div className="flex gap-2">
              <button onClick={handleDelete} disabled={isDeleting}
                className="flex-1 bg-red-500 text-white py-2.5 rounded-xl text-sm font-medium hover:bg-red-600 transition-colors disabled:opacity-50">
                {isDeleting ? 'Deleting...' : 'Delete permanently'}
              </button>
              <button onClick={() => { setShowDeleteConfirm(false); setDeletingId(null) }}
                className="flex-1 border border-gray-200 text-gray-600 py-2.5 rounded-xl text-sm hover:bg-gray-50 transition-colors">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Content */}
      {loading ? (
        <Spinner text="Loading shapefiles..." />
      ) : vectors.length === 0 && uploads.length === 0 ? (
        <div className="bg-white rounded-2xl border-2 border-dashed border-gray-200 p-20 text-center cursor-pointer hover:border-[#A0CECC] hover:bg-[#F4F9F9] transition-all group"
          onClick={() => fileRef.current?.click()}>
          <div className="w-12 h-12 rounded-2xl bg-[#EEF7F6] flex items-center justify-center mx-auto mb-4 text-[#6AA8A0] group-hover:bg-[#A0CECC] transition-colors">
            <MapBigIcon />
          </div>
          <p className="text-gray-500 text-sm font-medium">Click to upload shapefiles</p>
          <p className="text-gray-300 text-xs mt-1">Upload a .zip containing your shapefile components</p>
        </div>
      ) : (
        <>
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 bg-gray-50/60">
                    {/* Map column */}
                    <th className="text-left px-4 py-3 text-xs font-medium tracking-widest uppercase text-gray-400 w-16">Map</th>
                    {([
                      { key: 'filename',   label: 'Filename' },
                      { key: null,         label: 'EPSG' },
                      { key: null,         label: 'Geometry' },
                      { key: 'area_ha',    label: 'Area (ha)' },
                      { key: 'filesize',   label: 'Size' },
                      { key: 'created_at', label: 'Uploaded' },
                      { key: 'status',     label: 'Status' },
                      { key: null,         label: 'Actions' },
                    ] as { key: SortKey | null, label: string }[]).map(col => (
                      <th key={col.label}
                        className={`text-left px-4 py-3 text-xs font-medium tracking-widest uppercase text-gray-400 whitespace-nowrap ${col.key ? 'cursor-pointer hover:text-gray-600 select-none' : ''}`}
                        onClick={() => col.key && toggleSort(col.key as SortKey)}>
                        {col.label}
                        {col.key && <SortIcon dir={sortKey === col.key ? sortDir : undefined} />}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {paged.map(v => {
                    const isActive = activeVectorIds.has(v.id)
                    return (
                      <tr key={v.id} className="border-b border-gray-50 hover:bg-[#F4F9F9] transition-colors">
                        {/* Map column */}
                        <td className="px-4 py-3.5">
                          {v.status === 'ready' && !isActive ? (
                            <button onClick={() => viewOnMap(v)} title="View on map"
                              className="inline-flex items-center justify-center w-8 h-8 text-[#3D7A72] hover:bg-[#EEF7F6] rounded-lg transition-colors">
                              <MapPinIcon />
                            </button>
                          ) : (
                            <span className="inline-flex items-center justify-center w-8 h-8 text-gray-200">
                              <MapPinIcon />
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3.5 text-gray-900 font-medium max-w-[180px]">
                          <span className="truncate block">{v.filename}</span>
                        </td>
                        <td className="px-4 py-3.5 text-gray-500 font-mono text-xs">{v.epsg || '—'}</td>
                        <td className="px-4 py-3.5 text-gray-500 text-xs">{v.geometry_type || '—'}</td>
                        <td className="px-4 py-3.5 text-gray-500 text-xs">{v.area_ha ? v.area_ha.toLocaleString() : '—'}</td>
                        <td className="px-4 py-3.5 text-gray-500 text-xs">{formatSize(v.filesize)}</td>
                        <td className="px-4 py-3.5 text-gray-400 text-xs whitespace-nowrap">{formatDate(v.created_at)}</td>
                        <td className="px-4 py-3.5">
                          {isActive ? (
                            <span className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full font-medium bg-amber-50 text-amber-600">
                              <SpinnerIcon />Processing
                            </span>
                          ) : (
                            <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${statusBadge[v.status] || 'bg-gray-50 text-gray-500'}`}>
                              {v.status}
                            </span>
                          )}
                        </td>
                        {/* Actions: Reproject → Download → Delete */}
                        <td className="px-4 py-3.5">
                          {isActive || (isDeleting && deletingId === v.id) ? (
                            <span className="inline-flex items-center gap-1.5 text-xs text-gray-400">
                              {isDeleting && deletingId === v.id
                                ? <><SpinnerIcon />Deleting...</>
                                : 'Busy...'}
                            </span>
                          ) : (
                            <div className="flex items-center gap-1">
                              <button
                                onClick={() => { setSelectedId(v.id); setShowTransform(true) }}
                                title="Reproject"
                                className="p-1.5 text-gray-400 hover:text-[#3D7A72] hover:bg-[#EEF7F6] rounded-lg transition-colors">
                                <ArrowsRightLeftIcon />
                              </button>
                              <button onClick={() => handleDownload(v.id)} title="Download"
                                className="p-1.5 text-gray-400 hover:text-[#3D7A72] hover:bg-[#EEF7F6] rounded-lg transition-colors">
                                <ArrowDownTrayIcon />
                              </button>
                              <button onClick={() => { setDeletingId(v.id); setShowDeleteConfirm(true) }} title="Delete"
                                className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors">
                                <TrashIcon />
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
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between mt-4 px-1">
              <p className="text-xs text-gray-400">{vectors.length} vectors · page {page} of {totalPages}</p>
              <div className="flex items-center gap-1">
                <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
                  className="px-3 py-1.5 text-xs border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-40 transition-colors">← Prev</button>
                <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}
                  className="px-3 py-1.5 text-xs border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-40 transition-colors">Next →</button>
              </div>
            </div>
          )}

          {/* Delete all */}
          {vectors.length > 0 && (
            <div className="flex justify-end mt-2">
              <button onClick={() => setConfirmAll(true)}
                className="inline-flex items-center gap-1.5 text-xs text-gray-400 hover:text-red-500 transition-colors px-3 py-1.5 rounded-lg hover:bg-red-50">
                <TrashIcon />Delete all vectors
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
