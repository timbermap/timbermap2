'use client'
import { useUser } from '@clerk/nextjs'
import { useState, useRef, useEffect, useCallback } from 'react'
import Spinner from '@/components/Spinner'

type ImageFile = {
  id: string; filename: string; epsg: string | null; num_bands: number | null
  area_ha: number | null; filesize: number | null; pixel_size_x: number | null
  status: string; created_at: string
  bbox_minx: number | null; bbox_miny: number | null
  bbox_maxx: number | null; bbox_maxy: number | null
}
type Job = { id: string; type: string; status: string; input_ref: Record<string, unknown> | null }
type UploadItem = { file: File; progress: number; status: 'waiting'|'uploading'|'done'|'error'; message: string }
type TransformForm = { new_epsg: string; new_resolution_x: string; new_resolution_y: string }
type SortKey = 'filename' | 'created_at' | 'area_ha' | 'filesize' | 'status'
type SortDir = 'asc' | 'desc'

const PAGE_SIZE = 15

const UploadIcon   = () => <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4"><path d="M9.25 13.25a.75.75 0 0 0 1.5 0V4.636l2.955 3.129a.75.75 0 0 0 1.09-1.03l-4.25-4.5a.75.75 0 0 0-1.09 0l-4.25 4.5a.75.75 0 1 0 1.09 1.03L9.25 4.636v8.614Z"/><path d="M3.5 12.75a.75.75 0 0 0-1.5 0v2.5A2.75 2.75 0 0 0 4.75 18h10.5A2.75 2.75 0 0 0 18 15.25v-2.5a.75.75 0 0 0-1.5 0v2.5c0 .69-.56 1.25-1.25 1.25H4.75c-.69 0-1.25-.56-1.25-1.25v-2.5Z"/></svg>
const DownloadIcon = () => <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5"><path d="M10.75 2.75a.75.75 0 0 0-1.5 0v8.614L6.295 8.235a.75.75 0 1 0-1.09 1.03l4.25 4.5a.75.75 0 0 0 1.09 0l4.25-4.5a.75.75 0 0 0-1.09-1.03l-2.955 3.129V2.75Z"/><path d="M3.5 12.75a.75.75 0 0 0-1.5 0v2.5A2.75 2.75 0 0 0 4.75 18h10.5A2.75 2.75 0 0 0 18 15.25v-2.5a.75.75 0 0 0-1.5 0v2.5c0 .69-.56 1.25-1.25 1.25H4.75c-.69 0-1.25-.56-1.25-1.25v-2.5Z"/></svg>
const TrashIcon    = () => <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5"><path fillRule="evenodd" d="M8.75 1A2.75 2.75 0 0 0 6 3.75v.443c-.795.077-1.584.176-2.365.298a.75.75 0 1 0 .23 1.482l.149-.022.841 10.518A2.75 2.75 0 0 0 7.596 19h4.807a2.75 2.75 0 0 0 2.742-2.53l.841-10.52.149.023a.75.75 0 0 0 .23-1.482A41.03 41.03 0 0 0 14 3.193V3.75A2.75 2.75 0 0 0 11.25 1h-2.5ZM10 4c.84 0 1.673.025 2.5.075V3.75c0-.69-.56-1.25-1.25-1.25h-2.5c-.69 0-1.25.56-1.25 1.25v.325C8.327 4.025 9.16 4 10 4ZM8.58 7.72a.75.75 0 0 0-1.5.06l.3 7.5a.75.75 0 1 0 1.5-.06l-.3-7.5Zm4.34.06a.75.75 0 1 0-1.5-.06l-.3 7.5a.75.75 0 1 0 1.5.06l.3-7.5Z" clipRule="evenodd"/></svg>
const ReprojIcon   = () => <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5"><path fillRule="evenodd" d="M13.2 2.24a.75.75 0 0 0 .04 1.06l2.1 1.95H6.75a.75.75 0 0 0 0 1.5h8.59l-2.1 1.95a.75.75 0 1 0 1.02 1.1l3.5-3.25a.75.75 0 0 0 0-1.1l-3.5-3.25a.75.75 0 0 0-1.06.04Zm-6.4 8a.75.75 0 0 0-1.06-.04l-3.5 3.25a.75.75 0 0 0 0 1.1l3.5 3.25a.75.75 0 1 0 1.02-1.1l-2.1-1.95h8.59a.75.75 0 0 0 0-1.5H4.66l2.1-1.95a.75.75 0 0 0 .04-1.06Z" clipRule="evenodd"/></svg>
const MapIcon      = () => <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5"><path fillRule="evenodd" d="m9.69 18.933.003.001C9.89 19.02 10 19 10 19s.11.02.308-.066l.002-.001.006-.003.018-.008a5.741 5.741 0 0 0 .281-.14c.186-.096.446-.24.757-.433.62-.384 1.445-.966 2.274-1.765C15.302 14.988 17 12.493 17 9A7 7 0 1 0 3 9c0 3.492 1.698 5.988 3.355 7.584a13.731 13.731 0 0 0 2.273 1.765 11.842 11.842 0 0 0 .788.472l.018.008.006.003ZM10 11.25a2.25 2.25 0 1 0 0-4.5 2.25 2.25 0 0 0 0 4.5Z" clipRule="evenodd"/></svg>
const SpinIcon     = () => <svg className="animate-spin w-3 h-3" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>
const SortIcon = ({ dir }: { dir?: SortDir }) => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-3 h-3 inline ml-1">
    {dir === 'asc'  ? <path fillRule="evenodd" d="M10 17a.75.75 0 0 1-.75-.75V5.612L5.29 9.77a.75.75 0 0 1-1.08-1.04l5.25-5.5a.75.75 0 0 1 1.08 0l5.25 5.5a.75.75 0 1 1-1.08 1.04l-3.96-4.158V16.25A.75.75 0 0 1 10 17Z" clipRule="evenodd"/> :
     dir === 'desc' ? <path fillRule="evenodd" d="M10 3a.75.75 0 0 1 .75.75v10.638l3.96-4.158a.75.75 0 1 1 1.08 1.04l-5.25 5.5a.75.75 0 0 1-1.08 0l-5.25-5.5a.75.75 0 1 1 1.08-1.04l3.96 4.158V3.75A.75.75 0 0 1 10 3Z" clipRule="evenodd"/> :
     <path fillRule="evenodd" d="M2.24 6.8a.75.75 0 0 0 1.06-.04l1.95-2.1v8.59a.75.75 0 0 0 1.5 0V4.66l1.95 2.1a.75.75 0 1 0 1.1-1.02L6.53 2.24a.75.75 0 0 0-1.1 0L2.2 5.74a.75.75 0 0 0 .04 1.06Zm8 6.4a.75.75 0 0 0-.04 1.06l3.25 3.5a.75.75 0 0 0 1.1 0l3.25-3.5a.75.75 0 1 0-1.1-1.02l-1.95 2.1V7.75a.75.75 0 0 0-1.5 0v8.59l-1.95-2.1a.75.75 0 0 0-1.06-.04Z" clipRule="evenodd"/>}
  </svg>
)

export default function ImagesPage() {
  const { user, isLoaded } = useUser()
  const [uploads, setUploads]     = useState<UploadItem[]>([])
  const [images, setImages]       = useState<ImageFile[]>([])
  const [activeImageIds, setActiveImageIds] = useState<Set<string>>(new Set())
  const [loading, setLoading]     = useState(true)
  const [selectedId, setSelectedId]             = useState<string | null>(null)
  const [showTransform, setShowTransform]       = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [deletingId, setDeletingId]             = useState<string | null>(null)
  const [isDeleting, setIsDeleting]             = useState(false)
  const [transforming, setTransforming]         = useState(false)
  const [transform, setTransform] = useState<TransformForm>({ new_epsg: '', new_resolution_x: '', new_resolution_y: '' })
  const [sortKey, setSortKey]     = useState<SortKey>('created_at')
  const [sortDir, setSortDir]     = useState<SortDir>('desc')
  const [page, setPage]           = useState(1)
  // Delete all
  const [confirmAll, setConfirmAll]   = useState(false)
  const [deletingAll, setDeletingAll] = useState(false)
  const [thumbnailUrls, setThumbnailUrls] = useState<Record<string, string>>({})
  const [previewId, setPreviewId] = useState<string | null>(null)
  const fetchedThumbIds = useRef<Set<string>>(new Set())
  const fileRef = useRef<HTMLInputElement>(null)
  const API = process.env.NEXT_PUBLIC_API_URL || 'https://timbermap-api-788407107542.us-central1.run.app'

  const fetchData = useCallback(async () => {
    if (!isLoaded || !user) { setLoading(false); return }
    try {
      const [imgRes, jobsRes] = await Promise.all([
        fetch(`${API}/images/${user.id}`),
        fetch(`${API}/jobs/${user.id}`),
      ])
      const imgData  = await imgRes.json()
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
    } catch (e) { console.error(e) }
    finally { setLoading(false) }
  }, [user, isLoaded, API])

  useEffect(() => { if (isLoaded && user) fetchData() }, [isLoaded, user, fetchData])
  useEffect(() => { const t = setInterval(fetchData, 5000); return () => clearInterval(t) }, [fetchData])

  useEffect(() => {
    if (!user || !images.length) return
    const toFetch = images.filter(img => img.status === 'ready' && !fetchedThumbIds.current.has(img.id))
    if (!toFetch.length) return
    toFetch.forEach(img => fetchedThumbIds.current.add(img.id))
    Promise.all(
      toFetch.map(img =>
        fetch(`${API}/images/${img.id}/thumbnail?clerk_id=${user.id}`)
          .then(r => r.json())
          .then(d => ({ id: img.id, url: d.url as string }))
          .catch(() => ({ id: img.id, url: null }))
      )
    ).then(results => {
      const newUrls: Record<string, string> = {}
      for (const { id, url } of results) { if (url) newUrls[id] = url }
      setThumbnailUrls(prev => ({ ...prev, ...newUrls }))
    })
  }, [images, user, API])

  async function uploadSingle(item: UploadItem, index: number) {
    if (!user) return
    const upd = (p: Partial<UploadItem>) => setUploads(prev => prev.map((u, i) => i === index ? { ...u, ...p } : u))
    upd({ status: 'uploading', message: 'Getting URL...' })
    try {
      const r = await fetch(`${API}/upload/signed-url`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: item.file.name, content_type: item.file.type || 'image/tiff', clerk_id: user.id,
          email: user.emailAddresses[0]?.emailAddress, username: user.username || user.firstName || user.id,
          file_type: 'raster', filesize: item.file.size }) })
      const { url, gcs_path } = await r.json()
      upd({ message: 'Uploading...' })
      await new Promise<void>((res, rej) => {
        const xhr = new XMLHttpRequest()
        xhr.upload.onprogress = e => { if (e.lengthComputable) upd({ progress: Math.round(e.loaded / e.total * 100) }) }
        xhr.onload = () => xhr.status === 200 ? res() : rej(xhr.statusText)
        xhr.onerror = () => rej('Upload failed')
        xhr.open('PUT', url); xhr.setRequestHeader('Content-Type', item.file.type || 'image/tiff'); xhr.send(item.file)
      })
      upd({ message: 'Processing...' })
      await fetch(`${API}/upload/confirm`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clerk_id: user.id, filename: item.file.name, gcs_path, filesize: item.file.size, file_type: 'raster' }) })
      upd({ status: 'done', progress: 100, message: 'Done' })
    } catch (err) { upd({ status: 'error', message: 'Failed: ' + String(err) }) }
  }

  async function handleFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files || [])
    if (!files.length) return
    const items = files.map(f => ({ file: f, progress: 0, status: 'waiting' as const, message: 'Waiting...' }))
    setUploads(items)
    await Promise.all(items.map((item, i) => uploadSingle(item, i)))
    await fetchData(); setTimeout(() => setUploads([]), 3000)
    if (fileRef.current) fileRef.current.value = ''
  }

  async function handleTransform() {
    if (!user || !selectedId) return
    setTransforming(true)
    try {
      await fetch(`${API}/images/transform`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clerk_id: user.id, image_id: selectedId,
          new_epsg: transform.new_epsg || null,
          new_resolution_x: transform.new_resolution_x ? parseFloat(transform.new_resolution_x) : null,
          new_resolution_y: transform.new_resolution_y ? parseFloat(transform.new_resolution_y) : null }) })
      setShowTransform(false); setSelectedId(null)
      setTransform({ new_epsg: '', new_resolution_x: '', new_resolution_y: '' }); await fetchData()
    } finally { setTransforming(false) }
  }

  async function handleDelete() {
    if (!user || !deletingId) return
    setIsDeleting(true)
    try {
      await fetch(`${API}/images/${deletingId}?clerk_id=${user.id}`, { method: 'DELETE' })
      setShowDeleteConfirm(false); setDeletingId(null); await fetchData()
    } catch (err) { console.error(err) } finally { setIsDeleting(false) }
  }

  async function handleDeleteAll() {
    if (!user) return
    setDeletingAll(true)
    try {
      const deletable = images.filter(img => !activeImageIds.has(img.id))
      await Promise.all(deletable.map(img =>
        fetch(`${API}/images/${img.id}?clerk_id=${user.id}`, { method: 'DELETE' }).catch(() => {})
      ))
      await fetchData()
    } finally { setDeletingAll(false); setConfirmAll(false) }
  }

  async function handleDownload(imageId: string) {
    if (!user) return
    const res = await fetch(`${API}/images/${imageId}/download?clerk_id=${user.id}`)
    const data = await res.json()
    if (data.url) { const a = document.createElement('a'); a.href = data.url; a.download = ''; a.click() }
  }

  function viewOnMap(img: ImageFile) {
    const { bbox_minx, bbox_miny, bbox_maxx, bbox_maxy } = img
    if (bbox_minx != null && bbox_miny != null && bbox_maxx != null && bbox_maxy != null) {
      window.location.href = `/dashboard/map?bbox=${bbox_minx},${bbox_miny},${bbox_maxx},${bbox_maxy}`
    } else {
      window.location.href = '/dashboard/map'
    }
  }

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(key); setSortDir('asc') }
    setPage(1)
  }

  function fmt(bytes: number | null) {
    if (!bytes) return '—'
    if (bytes > 1e9) return (bytes / 1e9).toFixed(1) + ' GB'
    if (bytes > 1e6) return (bytes / 1e6).toFixed(1) + ' MB'
    return (bytes / 1e3).toFixed(0) + ' KB'
  }
  function fmtGSD(px: number | null, epsg: string | null) {
    if (!px) return '—'
    let m = px
    if (epsg === '4326' || epsg === 'EPSG:4326') m = px * 111320
    return m < 1 ? (m * 100).toFixed(1) + ' cm' : m.toFixed(2) + ' m'
  }
  function fmtDate(iso: string | null) {
    if (!iso) return '—'
    return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
  }
  function displayBands(n: number | null) {
    if (!n) return '—'
    return Math.min(n, 3)
  }

  const statusBadge: Record<string, string> = {
    uploaded: 'bg-blue-50 text-blue-600', processing: 'bg-amber-50 text-amber-600',
    ready: 'bg-[#EEF7F6] text-[#3D7A72]', failed: 'bg-red-50 text-red-500',
  }
  const progressColor: Record<string, string> = {
    waiting: 'bg-gray-200', uploading: 'bg-[#3D7A72]', done: 'bg-[#6AA8A0]', error: 'bg-red-400',
  }

  const sorted = [...images].sort((a, b) => {
    let av: string | number = a[sortKey] || ''
    let bv: string | number = b[sortKey] || ''
    if (typeof av === 'string') av = av.toLowerCase()
    if (typeof bv === 'string') bv = bv.toLowerCase()
    if (av < bv) return sortDir === 'asc' ? -1 : 1
    if (av > bv) return sortDir === 'asc' ? 1 : -1
    return 0
  })

  const totalPages = Math.ceil(sorted.length / PAGE_SIZE)
  const paged = sorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
  const deletingFilename = images.find(i => i.id === deletingId)?.filename

  return (
    <div className="w-full">

      {/* Thumbnail preview modal */}
      {previewId && thumbnailUrls[previewId] && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
          onClick={() => setPreviewId(null)}>
          <div className="relative max-w-2xl w-full" onClick={e => e.stopPropagation()}>
            <button onClick={() => setPreviewId(null)}
              className="absolute -top-3 -right-3 w-8 h-8 bg-white rounded-full shadow-lg flex items-center justify-center text-gray-500 hover:text-gray-800 cursor-pointer transition-colors z-10">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
                <path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z"/>
              </svg>
            </button>
            <p className="text-white/50 text-xs uppercase tracking-widest text-center mb-3">Preview image</p>
            <img src={thumbnailUrls[previewId]} alt={images.find(i => i.id === previewId)?.filename}
              className="w-full rounded-2xl shadow-2xl object-contain max-h-[80vh]" />
            <p className="text-white/70 text-xs text-center mt-3 truncate">
              {images.find(i => i.id === previewId)?.filename}
            </p>
          </div>
        </div>
      )}

      {/* Delete all modal */}
      {confirmAll && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl w-full max-w-sm p-6 shadow-xl">
            <div className="w-10 h-10 rounded-full bg-rose-50 flex items-center justify-center mx-auto mb-4 text-rose-400">
              <TrashIcon />
            </div>
            <h3 className="font-semibold text-gray-900 text-center mb-1">Delete all images?</h3>
            {(() => {
              const skipped = images.filter(img => activeImageIds.has(img.id)).length
              const deletable = images.length - skipped
              return (
                <div className="text-center mb-6">
                  <p className="text-sm text-gray-500">
                    This will permanently delete <span className="font-medium text-gray-700">{deletable} image{deletable !== 1 ? 's' : ''}</span> and all their files (COGs, thumbnails, storage).
                  </p>
                  {skipped > 0 && (
                    <p className="text-xs text-amber-600 bg-amber-50 rounded-lg px-3 py-2 mt-3">
                      {skipped} image{skipped !== 1 ? 's' : ''} with active jobs will be skipped.
                    </p>
                  )}
                </div>
              )
            })()}
            <div className="flex gap-3">
              <button onClick={() => setConfirmAll(false)} disabled={deletingAll}
                className="flex-1 px-4 py-2.5 border border-gray-200 text-gray-600 rounded-xl text-sm hover:bg-gray-50 transition-colors disabled:opacity-50">
                Cancel
              </button>
              <button onClick={handleDeleteAll} disabled={deletingAll || images.filter(img => !activeImageIds.has(img.id)).length === 0}
                className="flex-1 px-4 py-2.5 bg-rose-400 text-white rounded-xl text-sm hover:bg-rose-500 transition-colors font-medium disabled:opacity-50 flex items-center justify-center gap-2 cursor-pointer disabled:cursor-default">
                {deletingAll ? <><SpinIcon />Deleting...</> : 'Delete all'}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="mb-6 flex items-start justify-between">
        <div>
          <p className="text-xs font-medium tracking-widest uppercase text-[#6AA8A0] mb-1">Catalog</p>
          <h1 className="text-2xl font-semibold text-[#1C1C1C]">Images</h1>
          <p className="text-gray-400 mt-1 text-sm">Upload and manage your raster files</p>
        </div>
        <button onClick={() => fileRef.current?.click()}
          className="inline-flex items-center gap-2 bg-[#3D7A72] text-white px-4 py-2.5 rounded-xl text-sm font-medium hover:bg-[#2A5750] transition-colors shadow-sm">
          <UploadIcon />Upload images
        </button>
        <input ref={fileRef} type="file" accept=".tif,.tiff,.geotiff" multiple className="hidden" onChange={handleFiles} />
      </div>

      {/* Upload progress */}
      {uploads.length > 0 && (
        <div className="mb-5 bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="px-5 py-3 border-b border-gray-50 bg-[#EEF7F6]">
            <p className="text-xs font-medium tracking-widest uppercase text-[#6AA8A0]">Uploading {uploads.length} file{uploads.length > 1 ? 's' : ''}</p>
          </div>
          {uploads.map((u, i) => (
            <div key={i} className="px-5 py-3 border-b border-gray-50 last:border-0">
              <div className="flex justify-between mb-2">
                <span className="text-sm text-gray-700 font-medium truncate">{u.file.name}</span>
                <span className="text-xs text-gray-400 ml-3">{u.message}</span>
              </div>
              <div className="w-full bg-gray-100 rounded-full h-1">
                <div className={`h-1 rounded-full transition-all ${progressColor[u.status]}`} style={{ width: `${u.progress}%` }} />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Transform modal */}
      {showTransform && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 backdrop-blur-sm">
          <div className="bg-white rounded-2xl p-6 w-full max-w-sm shadow-2xl border border-gray-100">
            <h2 className="text-base font-semibold text-[#1C1C1C] mb-0.5">Reproject image</h2>
            <p className="text-sm text-gray-400 mb-5">Set the target coordinate system and resolution</p>
            <div className="space-y-3">
              <div>
                <label className="text-xs font-medium text-gray-500 block mb-1.5">Target EPSG</label>
                <input type="text" placeholder="e.g. 4326 or 32718" value={transform.new_epsg}
                  onChange={e => setTransform({ ...transform, new_epsg: e.target.value })}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-[#6AA8A0] focus:ring-2 focus:ring-[#6AA8A0]/10 transition-all" />
              </div>
              <div className="grid grid-cols-2 gap-2">
                {(['new_resolution_x', 'new_resolution_y'] as const).map(k => (
                  <div key={k}>
                    <label className="text-xs font-medium text-gray-500 block mb-1.5">Resolution {k.includes('x') ? 'X' : 'Y'} (m)</label>
                    <input type="text" placeholder="optional" value={transform[k]}
                      onChange={e => setTransform({ ...transform, [k]: e.target.value })}
                      className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-[#6AA8A0] transition-all" />
                  </div>
                ))}
              </div>
            </div>
            <div className="flex gap-2 mt-6">
              <button onClick={handleTransform} disabled={transforming}
                className="flex-1 bg-[#3D7A72] text-white py-2.5 rounded-xl text-sm font-medium hover:bg-[#2A5750] transition-colors disabled:opacity-50 shadow-sm">
                {transforming ? 'Queuing...' : 'Run transform'}
              </button>
              <button onClick={() => { setShowTransform(false); setSelectedId(null) }}
                className="flex-1 border border-gray-200 text-gray-600 py-2.5 rounded-xl text-sm hover:bg-gray-50 transition-colors">Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* Delete single modal */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 backdrop-blur-sm">
          <div className="bg-white rounded-2xl p-6 w-full max-w-sm shadow-2xl border border-gray-100">
            <h2 className="text-base font-semibold text-[#1C1C1C] mb-1">Delete image</h2>
            <p className="text-sm text-gray-400 mb-3">This will permanently delete:</p>
            <p className="text-sm font-medium text-gray-700 mb-5 bg-gray-50 px-3 py-2 rounded-lg truncate">{deletingFilename}</p>
            <div className="flex gap-2">
              <button onClick={handleDelete} disabled={isDeleting}
                className="flex-1 bg-rose-400 text-white py-2.5 rounded-xl text-sm font-medium hover:bg-rose-500 transition-colors disabled:opacity-50">
                {isDeleting ? 'Deleting...' : 'Delete permanently'}
              </button>
              <button onClick={() => { setShowDeleteConfirm(false); setDeletingId(null) }}
                className="flex-1 border border-gray-200 text-gray-600 py-2.5 rounded-xl text-sm hover:bg-gray-50 transition-colors">Cancel</button>
            </div>
          </div>
        </div>
      )}

      {!isLoaded || loading ? (
        <Spinner text="Loading images..." />
      ) : images.length === 0 && uploads.length === 0 ? (
        <div className="bg-white rounded-2xl border-2 border-dashed border-gray-200 p-20 text-center cursor-pointer hover:border-[#A0CECC] hover:bg-[#F4F9F9] transition-all group"
          onClick={() => fileRef.current?.click()}>
          <div className="w-12 h-12 rounded-2xl bg-[#EEF7F6] flex items-center justify-center mx-auto mb-4 text-[#6AA8A0]">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-6 h-6"><path fillRule="evenodd" d="M1 5.25A2.25 2.25 0 0 1 3.25 3h13.5A2.25 2.25 0 0 1 19 5.25v9.5A2.25 2.25 0 0 1 16.75 17H3.25A2.25 2.25 0 0 1 1 14.75v-9.5Zm1.5 5.81v3.69c0 .414.336.75.75.75h13.5a.75.75 0 0 0 .75-.75v-2.69l-2.22-2.219a.75.75 0 0 0-1.06 0l-1.91 1.909.47.47a.75.75 0 1 1-1.06 1.06L6.53 8.091a.75.75 0 0 0-1.06 0l-2.97 2.97ZM12 7a1 1 0 1 1-2 0 1 1 0 0 1 2 0Z" clipRule="evenodd"/></svg>
          </div>
          <p className="text-gray-500 text-sm font-medium">Click to upload raster images</p>
          <p className="text-gray-300 text-xs mt-1">Supports .tif, .tiff, .geotiff</p>
        </div>
      ) : (
        <>
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 bg-gray-50/60">
                    <th className="text-left px-4 py-3 text-xs font-medium tracking-widest uppercase text-gray-400 w-14">Preview</th>
                    {([
                      { key: 'filename',   label: 'Filename' },
                      { key: null,         label: 'EPSG' },
                      { key: null,         label: 'Bands' },
                      { key: null,         label: 'GSD' },
                      { key: 'area_ha',    label: 'Area (ha)' },
                      { key: 'filesize',   label: 'Size' },
                      { key: 'created_at', label: 'Uploaded' },
                      { key: 'status',     label: 'Status' },
                      { key: null,         label: 'Actions' },
                    ] as { key: SortKey | null, label: string }[]).map(col => (
                      <th key={col.label}
                        className={`text-left px-4 py-3 text-xs font-medium tracking-widest uppercase text-gray-400 whitespace-nowrap ${col.key ? 'cursor-pointer hover:text-gray-600 select-none' : 'cursor-default'}`}
                        onClick={() => col.key && toggleSort(col.key)}>
                        {col.label}
                        {col.key && <SortIcon dir={sortKey === col.key ? sortDir : undefined} />}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {paged.map(img => {
                    const isActive = activeImageIds.has(img.id)
                    return (
                      <tr key={img.id} className="border-b border-gray-50 hover:bg-[#F4F9F9] transition-colors">
                        {/* Thumbnail column */}
                        <td className="px-4 py-3">
                          {thumbnailUrls[img.id] ? (
                            <img src={thumbnailUrls[img.id]} alt={img.filename}
                              onClick={() => setPreviewId(img.id)}
                              className="w-10 h-10 object-cover rounded-lg border border-gray-100 shadow-sm cursor-pointer hover:opacity-80 hover:scale-105 transition-all" />
                          ) : (
                            <div className="w-10 h-10 rounded-lg bg-gray-100 flex items-center justify-center">
                              {img.status === 'ready' ? (
                                <SpinIcon />
                              ) : (
                                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4 text-gray-300">
                                  <path fillRule="evenodd" d="M1 5.25A2.25 2.25 0 0 1 3.25 3h13.5A2.25 2.25 0 0 1 19 5.25v9.5A2.25 2.25 0 0 1 16.75 17H3.25A2.25 2.25 0 0 1 1 14.75v-9.5Zm1.5 5.81v3.69c0 .414.336.75.75.75h13.5a.75.75 0 0 0 .75-.75v-2.69l-2.22-2.219a.75.75 0 0 0-1.06 0l-1.91 1.909.47.47a.75.75 0 1 1-1.06 1.06L6.53 8.091a.75.75 0 0 0-1.06 0l-2.97 2.97ZM12 7a1 1 0 1 1-2 0 1 1 0 0 1 2 0Z" clipRule="evenodd"/>
                                </svg>
                              )}
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-3 text-gray-900 font-medium max-w-[160px]">
                          <span className="truncate block text-xs md:text-sm" title={img.filename}>{img.filename}</span>
                        </td>
                        <td className="px-4 py-3 text-gray-500 font-mono text-xs">{img.epsg || '—'}</td>
                        <td className="px-4 py-3 text-gray-500 text-xs">{displayBands(img.num_bands)}</td>
                        <td className="px-4 py-3 text-gray-500 text-xs">{fmtGSD(img.pixel_size_x, img.epsg)}</td>
                        <td className="px-4 py-3 text-gray-500 text-xs">{img.area_ha ? img.area_ha.toLocaleString() : '—'}</td>
                        <td className="px-4 py-3 text-gray-500 text-xs">{fmt(img.filesize)}</td>
                        <td className="px-4 py-3 text-gray-400 text-xs whitespace-nowrap">{fmtDate(img.created_at)}</td>
                        {/* Status */}
                        <td className="px-4 py-3">
                          {isActive ? (
                            <span className="inline-flex items-center gap-1.5 text-xs px-2 py-1 rounded-full bg-amber-50 text-amber-600 font-medium">
                              <SpinIcon />Processing
                            </span>
                          ) : (
                            <span className={`text-xs px-2 py-1 rounded-full font-medium ${statusBadge[img.status] || 'bg-gray-50 text-gray-500'}`}>
                              {img.status}
                            </span>
                          )}
                        </td>
                        {/* Actions: Map → Reproject → Download → Delete */}
                        <td className="px-4 py-3">
                          {isDeleting && deletingId === img.id ? (
                            <span className="inline-flex items-center gap-1 text-xs text-gray-400"><SpinIcon />Deleting...</span>
                          ) : (
                            <div className="flex items-center gap-0.5">
                              <button onClick={() => viewOnMap(img)} title="View on map" disabled={img.status !== 'ready' || isActive}
                                className="p-1.5 text-gray-400 hover:text-[#3D7A72] hover:bg-[#EEF7F6] rounded-lg transition-colors cursor-pointer disabled:opacity-25 disabled:cursor-default">
                                <MapIcon />
                              </button>
                              <button onClick={() => { setSelectedId(img.id); setShowTransform(true) }} title="Reproject" disabled={isActive}
                                className="p-1.5 text-gray-400 hover:text-[#3D7A72] hover:bg-[#EEF7F6] rounded-lg transition-colors cursor-pointer disabled:opacity-25 disabled:cursor-default">
                                <ReprojIcon />
                              </button>
                              <button onClick={() => handleDownload(img.id)} title="Download" disabled={img.status !== 'ready' || isActive}
                                className="p-1.5 text-gray-400 hover:text-[#3D7A72] hover:bg-[#EEF7F6] rounded-lg transition-colors cursor-pointer disabled:opacity-25 disabled:cursor-default">
                                <DownloadIcon />
                              </button>
                              <button onClick={() => { setDeletingId(img.id); setShowDeleteConfirm(true) }} title="Delete" disabled={isActive}
                                className="p-1.5 text-gray-400 hover:text-rose-400 hover:bg-rose-50 rounded-lg transition-colors cursor-pointer disabled:opacity-25 disabled:cursor-default">
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
              <p className="text-xs text-gray-400">{images.length} images · page {page} of {totalPages}</p>
              <div className="flex items-center gap-1">
                <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
                  className="px-3 py-1.5 text-xs border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-40 transition-colors cursor-pointer disabled:cursor-default">← Prev</button>
                {Array.from({ length: totalPages }, (_, i) => i + 1).map(p => (
                  <button key={p} onClick={() => setPage(p)}
                    className={`w-8 h-8 text-xs rounded-lg transition-colors cursor-pointer ${p === page ? 'bg-[#3D7A72] text-white' : 'border border-gray-200 hover:bg-gray-50 text-gray-600'}`}>
                    {p}
                  </button>
                ))}
                <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}
                  className="px-3 py-1.5 text-xs border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-40 transition-colors cursor-pointer disabled:cursor-default">Next →</button>
              </div>
            </div>
          )}

          {/* Delete all */}
          {images.length > 0 && (
            <div className="flex justify-end mt-2">
              <button onClick={() => setConfirmAll(true)}
                className="inline-flex items-center gap-1.5 text-xs text-gray-400 hover:text-rose-400 transition-colors px-3 py-1.5 rounded-lg hover:bg-rose-50 cursor-pointer">
                <TrashIcon />Delete all images
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
