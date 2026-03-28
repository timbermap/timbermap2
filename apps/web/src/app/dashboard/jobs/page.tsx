'use client'
import { useUser } from '@clerk/nextjs'
import { useState, useEffect, useCallback } from 'react'
import Spinner from '@/components/Spinner'

type Job = {
  id: string; type: string; status: string; message: string | null
  input_ref: Record<string, unknown> | null
  summary: Record<string, unknown> | null
  model_name?: string | null; image_filename?: string | null
  vector_filename?: string | null
  created_at: string; started_at: string | null; finished_at: string | null
}
type JobOutput = {
  id: string; job_id: string; output_type: string; label: string; gcs_path: string
  file_size_bytes: number | null; is_visualizable: boolean; layer_type: string | null
  epsg: number | null; bbox: [number,number,number,number] | null
  download_url: string | null; view_url: string | null
}

const PAGE_SIZE = 15

// ── Icons ────────────────────────────────────────────────────────────────────
const ChevronRightIcon = () => <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4"><path fillRule="evenodd" d="M8.22 5.22a.75.75 0 0 1 1.06 0l4.25 4.25a.75.75 0 0 1 0 1.06l-4.25 4.25a.75.75 0 0 1-1.06-1.06L11.94 10 8.22 6.28a.75.75 0 0 1 0-1.06Z" clipRule="evenodd"/></svg>
const RefreshIcon = () => <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4"><path fillRule="evenodd" d="M15.312 11.424a5.5 5.5 0 0 1-9.201 2.466l-.312-.311h2.433a.75.75 0 0 0 0-1.5H3.989a.75.75 0 0 0-.75.75v4.242a.75.75 0 0 0 1.5 0v-2.43l.31.31a7 7 0 0 0 11.712-3.138.75.75 0 0 0-1.449-.39Zm1.23-3.723a.75.75 0 0 0 .219-.53V2.929a.75.75 0 0 0-1.5 0V5.36l-.31-.31A7 7 0 0 0 3.239 8.188a.75.75 0 1 0 1.448.389A5.5 5.5 0 0 1 13.89 6.11l.311.31h-2.432a.75.75 0 0 0 0 1.5h4.243a.75.75 0 0 0 .53-.219Z" clipRule="evenodd"/></svg>
const EyeIcon = () => <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5"><path d="M10 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z"/><path fillRule="evenodd" d="M.664 10.59a1.651 1.651 0 0 1 0-1.186A10.004 10.004 0 0 1 10 3c4.257 0 7.893 2.66 9.336 6.41.147.381.146.804 0 1.186A10.004 10.004 0 0 1 10 17c-4.257 0-7.893-2.66-9.336-6.41Z" clipRule="evenodd"/></svg>
const DownIcon = () => <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5"><path fillRule="evenodd" d="M10 3a.75.75 0 0 1 .75.75v10.638l3.96-4.158a.75.75 0 1 1 1.08 1.04l-5.25 5.5a.75.75 0 0 1-1.08 0l-5.25-5.5a.75.75 0 1 1 1.08-1.04l3.96 4.158V3.75A.75.75 0 0 1 10 3Z" clipRule="evenodd"/></svg>
const TrashIcon = () => <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5"><path fillRule="evenodd" d="M8.75 1A2.75 2.75 0 0 0 6 3.75v.443c-.795.077-1.584.176-2.365.298a.75.75 0 1 0 .23 1.482l.149-.022.841 10.518A2.75 2.75 0 0 0 7.596 19h4.807a2.75 2.75 0 0 0 2.742-2.53l.841-10.52.149.023a.75.75 0 0 0 .23-1.482A41.03 41.03 0 0 0 14 3.193V3.75A2.75 2.75 0 0 0 11.25 1h-2.5ZM10 4c.84 0 1.673.025 2.5.075V3.75c0-.69-.56-1.25-1.25-1.25h-2.5c-.69 0-1.25.56-1.25 1.25v.325C8.327 4.025 9.16 4 10 4ZM8.58 7.72a.75.75 0 0 0-1.5.06l.3 7.5a.75.75 0 1 0 1.5-.06l-.3-7.5Zm4.34.06a.75.75 0 1 0-1.5-.06l-.3 7.5a.75.75 0 1 0 1.5.06l.3-7.5Z" clipRule="evenodd"/></svg>
const StopIcon = () => <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5"><path d="M5.25 3A2.25 2.25 0 0 0 3 5.25v9.5A2.25 2.25 0 0 0 5.25 17h9.5A2.25 2.25 0 0 0 17 14.75v-9.5A2.25 2.25 0 0 0 14.75 3h-9.5Z"/></svg>
const SpinIcon = () => <svg className="animate-spin w-3 h-3" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>
const PhotoIcon = () => <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-3 h-3"><path fillRule="evenodd" d="M1 5.25A2.25 2.25 0 0 1 3.25 3h13.5A2.25 2.25 0 0 1 19 5.25v9.5A2.25 2.25 0 0 1 16.75 17H3.25A2.25 2.25 0 0 1 1 14.75v-9.5Zm1.5 5.81v3.69c0 .414.336.75.75.75h13.5a.75.75 0 0 0 .75-.75v-2.69l-2.22-2.219a.75.75 0 0 0-1.06 0l-1.91 1.909.47.47a.75.75 0 1 1-1.06 1.06L6.53 8.091a.75.75 0 0 0-1.06 0l-2.97 2.97ZM12 7a1 1 0 1 1-2 0 1 1 0 0 1 2 0Z" clipRule="evenodd"/></svg>

const statusCfg: Record<string, { bg: string; text: string; dot: string }> = {
  queued:  { bg: 'bg-gray-100',  text: 'text-gray-600',  dot: 'bg-gray-400' },
  running: { bg: 'bg-blue-50',   text: 'text-blue-700',  dot: 'bg-blue-500' },
  done:    { bg: 'bg-[#EEF7F6]', text: 'text-[#3D7A72]', dot: 'bg-[#6AA8A0]' },
  failed:  { bg: 'bg-red-50',    text: 'text-red-700',   dot: 'bg-red-500' },
}

const typeLabel: Record<string, string> = {
  raster_ingest: 'Raster ingest', vector_ingest: 'Vector ingest',
  raster_transform: 'Image transform', vector_transform: 'Vector transform',
  ml_inference: 'Running AI', model_run: 'Running AI', delete: 'Delete',
}
const typeGroup: Record<string, string> = {
  raster_ingest: 'rasters', raster_transform: 'rasters',
  vector_ingest: 'vectors', vector_transform: 'vectors',
  model_run: 'models', ml_inference: 'models', delete: 'rasters',
}
const groups = [
  { key: 'models',  label: 'AI Jobs',  defaultOpen: false },
  { key: 'rasters', label: 'Images',   defaultOpen: false },
  { key: 'vectors', label: 'Vectors',  defaultOpen: false },
]
const outputIcon: Record<string, string> = { raster_cog: '🗺', geojson: '📍', shapefile: '📦' }

function fmtBytes(b: number | null) {
  if (!b) return '—'
  if (b > 1e6) return (b / 1e6).toFixed(1) + ' MB'
  return (b / 1e3).toFixed(0) + ' KB'
}
function fmtDate(iso: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString()
}
function fmtDuration(start: string | null, end: string | null) {
  if (!start || !end) return '—'
  const ms = new Date(end).getTime() - new Date(start).getTime()
  return ms < 60000 ? `${(ms / 1000).toFixed(0)}s` : `${(ms / 60000).toFixed(1)}m`
}
function extractProgress(msg: string | null) {
  if (!msg) return null
  const m = msg.match(/(\d+)%/)
  return m ? `${m[1]}%` : null
}

// ── Outputs panel ─────────────────────────────────────────────────────────────
function OutputsPanel({ jobId, clerkId, api, onDeleted }: {
  jobId: string; clerkId: string; api: string; onDeleted: () => void
}) {
  const [outputs, setOutputs] = useState<JobOutput[]>([])
  const [loading, setLoading] = useState(true)
  const [deleting, setDeleting] = useState(false)
  const [confirm, setConfirm] = useState(false)

  useEffect(() => {
    fetch(`${api}/jobs/${jobId}/outputs?clerk_id=${clerkId}`)
      .then(r => r.json()).then(d => setOutputs(d.outputs || [])).catch(() => {}).finally(() => setLoading(false))
  }, [jobId, clerkId, api])

  function viewOnMap(o: JobOutput) {
    const existing = JSON.parse(localStorage.getItem('ml_outputs') || '[]')
    const entry = { id: o.id, name: o.label, type: o.layer_type,
      cog_url: o.layer_type === 'raster' ? o.view_url : undefined,
      geojson_url: o.layer_type === 'vector' ? o.view_url : undefined,
      epsg: o.epsg, bbox: o.bbox }
    localStorage.setItem('ml_outputs', JSON.stringify([...existing.filter((e: {id:string}) => e.id !== o.id), entry]))
    window.location.href = '/dashboard/map'
  }

  async function handleDelete() {
    setDeleting(true)
    try { await fetch(`${api}/jobs/${jobId}?clerk_id=${clerkId}`, { method: 'DELETE' }); onDeleted() }
    catch (e) { console.error(e) } finally { setDeleting(false); setConfirm(false) }
  }

  if (loading) return <div className="px-6 py-3 text-xs text-gray-400">Loading outputs...</div>

  return (
    <div className="px-6 pb-5">
      {outputs.length > 0 && (
        <>
          <p className="text-xs font-medium tracking-widest uppercase text-gray-400 mb-2.5 mt-1">Outputs</p>
          <div className="space-y-2 mb-4">
            {outputs.map(o => (
              <div key={o.id} className="flex items-center gap-3 px-3.5 py-2.5 bg-gray-50 rounded-xl border border-gray-100">
                <span className="text-base flex-shrink-0">{outputIcon[o.output_type] || '📄'}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-gray-700 truncate">{o.label}</p>
                  <p className="text-xs text-gray-400">{fmtBytes(o.file_size_bytes)}</p>
                </div>
                <div className="flex gap-2 flex-shrink-0">
                  {o.is_visualizable && o.view_url && (
                    <button onClick={() => viewOnMap(o)}
                      className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 bg-[#3D7A72] text-white rounded-lg hover:bg-[#2A5750] transition-colors font-medium">
                      <EyeIcon />View on map
                    </button>
                  )}
                  {o.download_url && (
                    <a href={o.download_url} download
                      className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 border border-gray-200 text-gray-600 rounded-lg hover:bg-gray-100 transition-colors">
                      <DownIcon />Download
                    </a>
                  )}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
      <div className="border-t border-gray-100 pt-4">
        {!confirm ? (
          <button onClick={() => setConfirm(true)}
            className="inline-flex items-center gap-1.5 text-xs text-red-500 hover:text-red-600 transition-colors">
            <TrashIcon />Delete job and outputs
          </button>
        ) : (
          <div className="flex items-center gap-3">
            <p className="text-xs text-gray-500">Delete this job and all its files?</p>
            <button onClick={handleDelete} disabled={deleting}
              className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 bg-red-500 text-white rounded-lg hover:bg-red-600 transition-colors disabled:opacity-50">
              {deleting ? <><SpinIcon />Deleting...</> : <><TrashIcon />Confirm</>}
            </button>
            <button onClick={() => setConfirm(false)} className="text-xs text-gray-400 hover:text-gray-600">Cancel</button>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Job row ───────────────────────────────────────────────────────────────────
function JobRow({ job, clerkId, api, onRefresh }: { job: Job; clerkId: string; api: string; onRefresh: () => void }) {
  const [expanded, setExpanded] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const isML  = job.type === 'ml_inference' || job.type === 'model_run'
  const cfg   = statusCfg[job.status] || statusCfg.queued
  const progress = extractProgress(job.message)

  async function handleCancel() {
    setCancelling(true)
    try { await fetch(`${api}/jobs/${job.id}?clerk_id=${clerkId}`, { method: 'DELETE' }); onRefresh() }
    catch (e) { console.error(e) } finally { setCancelling(false) }
  }

  const inputName = job.image_filename || (job.input_ref?.filename as string) || (job.input_ref?.gcs_path as string) || null
  const vectorName = job.vector_filename || null

  return (
    <>
      <tr className={`border-b border-gray-50 transition-colors ${isML && job.status === 'done' ? 'cursor-pointer hover:bg-[#EEF7F6]/40' : 'hover:bg-gray-50/50'}`}
        onClick={() => isML && job.status === 'done' && setExpanded(e => !e)}>

        {/* Type */}
        <td className="px-4 py-3.5">
          <div className="flex items-center gap-2">
            {isML && job.status === 'done' && (
              <span className={`text-gray-400 transition-transform duration-150 flex-shrink-0 ${expanded ? 'rotate-90' : ''}`}>
                <ChevronRightIcon />
              </span>
            )}
            <div>
              <p className="text-sm font-medium text-gray-900">
                {isML && job.model_name ? job.model_name : typeLabel[job.type] || job.type}
              </p>
            </div>
          </div>
        </td>

        {/* Input */}
        <td className="px-4 py-3.5">
          {inputName ? (
            <div className="flex flex-col gap-0.5">
              <div className="flex items-center gap-1 text-xs text-gray-600">
                <span className="text-gray-400"><PhotoIcon /></span>
                <span className="truncate max-w-[150px]">{inputName}</span>
              </div>
              {vectorName && (
                <div className="flex items-center gap-1 text-xs text-gray-400">
                  <span>📐</span>
                  <span className="truncate max-w-[150px]">{vectorName}</span>
                </div>
              )}
              {!vectorName && !!((job.input_ref as Record<string,unknown> | null)?.params as Record<string,unknown> | undefined)?.aoi_geojson && (
                <div className="flex items-center gap-1 text-xs text-[#6AA8A0]">
                  <span>⬡</span>
                  <span>GeoJSON AOI</span>
                </div>
              )}
            </div>
          ) : <span className="text-xs text-gray-300">—</span>}
        </td>

        {/* Status */}
        <td className="px-4 py-3.5">
          <span className={`inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full font-medium ${cfg.bg} ${cfg.text}`}>
            {job.status === 'running' ? <SpinIcon /> : <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />}
            {job.status}
          </span>
        </td>

        {/* Progress */}
        <td className="px-4 py-3.5 text-xs text-gray-500">
          {progress ? (
            <div className="flex items-center gap-2">
              <div className="w-16 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                <div className="h-full bg-[#6AA8A0] rounded-full transition-all" style={{ width: progress }} />
              </div>
              <span className="text-gray-500 font-mono">{progress}</span>
            </div>
          ) : '—'}
        </td>

        {/* Created */}
        <td className="px-4 py-3.5 text-xs text-gray-400 whitespace-nowrap">{fmtDate(job.created_at)}</td>

        {/* Duration */}
        <td className="px-4 py-3.5 text-xs text-gray-400">{fmtDuration(job.started_at, job.finished_at)}</td>

        {/* Actions */}
        <td className="px-4 py-3.5" onClick={e => e.stopPropagation()}>
          {(job.status === 'running' || job.status === 'queued') && (
            <button onClick={handleCancel} disabled={cancelling}
              title="Cancel job"
              className="inline-flex items-center gap-1 px-2 py-1.5 text-xs text-orange-500 hover:bg-orange-50 rounded-lg transition-colors border border-orange-200 disabled:opacity-50">
              {cancelling ? <SpinIcon /> : <StopIcon />}
              {cancelling ? '...' : 'Cancel'}
            </button>
          )}
          {job.status === 'failed' && (
            <button onClick={handleCancel} disabled={cancelling}
              title="Remove failed job"
              className="inline-flex items-center gap-1 px-2 py-1.5 text-xs text-red-500 hover:bg-red-50 rounded-lg transition-colors border border-red-200 disabled:opacity-50">
              {cancelling ? <SpinIcon /> : <TrashIcon />}
              {cancelling ? '...' : 'Remove'}
            </button>
          )}
        </td>
      </tr>

      {isML && job.status === 'done' && expanded && (
        <tr className="bg-[#EEF7F6]/20 border-b border-gray-100">
          <td colSpan={7} className="px-0 py-0">
            <OutputsPanel jobId={job.id} clerkId={clerkId} api={api} onDeleted={onRefresh} />
          </td>
        </tr>
      )}
    </>
  )
}

// ── Accordion ─────────────────────────────────────────────────────────────────
function JobAccordion({ label, jobs, clerkId, api, onRefresh }: {
  label: string; jobs: Job[]; clerkId: string; api: string; onRefresh: () => void
}) {
  const [open, setOpen]   = useState(false) // closed by default
  const [page, setPage]   = useState(1)
  if (jobs.length === 0) return null

  const runningCount = jobs.filter(j => j.status === 'running').length
  const failedCount  = jobs.filter(j => j.status === 'failed').length
  const totalPages   = Math.ceil(jobs.length / PAGE_SIZE)
  const paged        = jobs.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden mb-3">
      <button onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-3 px-5 py-3.5 hover:bg-gray-50/50 transition-colors">
        <span className={`text-gray-400 transition-transform duration-150 ${open ? 'rotate-90' : ''}`}>
          <ChevronRightIcon />
        </span>
        <span className="text-sm font-semibold text-gray-700 flex-1 text-left">{label}</span>
        <div className="flex items-center gap-2">
          {runningCount > 0 && <span className="text-xs px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 font-medium">{runningCount} running</span>}
          {failedCount > 0  && <span className="text-xs px-2 py-0.5 rounded-full bg-red-50 text-red-600 font-medium">{failedCount} failed</span>}
          <span className="text-xs bg-gray-100 text-gray-500 rounded-full px-2 py-0.5 font-medium">{jobs.length}</span>
        </div>
      </button>

      {open && (
        <div className="border-t border-gray-100">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50/50">
                  {['Type', 'Input', 'Status', 'Progress', 'Created', 'Duration', ''].map(h => (
                    <th key={h} className="text-left px-4 py-3 text-xs font-medium tracking-widest uppercase text-gray-400 whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {paged.map(job => <JobRow key={job.id} job={job} clerkId={clerkId} api={api} onRefresh={onRefresh} />)}
              </tbody>
            </table>
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-between px-5 py-3 border-t border-gray-50">
              <p className="text-xs text-gray-400">{jobs.length} jobs · page {page} of {totalPages}</p>
              <div className="flex gap-1">
                <button onClick={() => setPage(p => Math.max(1, p-1))} disabled={page===1}
                  className="px-3 py-1 text-xs border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-40">← Prev</button>
                <button onClick={() => setPage(p => Math.min(totalPages, p+1))} disabled={page===totalPages}
                  className="px-3 py-1 text-xs border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-40">Next →</button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Main ──────────────────────────────────────────────────────────────────────
export default function JobsPage() {
  const { user, isLoaded } = useUser()
  const [jobs, setJobs]     = useState<Job[]>([])
  const [loading, setLoading] = useState(true)
  const API = process.env.NEXT_PUBLIC_API_URL || 'https://timbermap-api-788407107542.us-central1.run.app'

  const fetchJobs = useCallback(async (signal?: AbortSignal) => {
    if (!isLoaded || !user) { setLoading(false); return }
    try {
      const res = await fetch(`${API}/jobs/${user.id}`, { signal })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      setJobs(data.jobs || [])
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return
    } finally { setLoading(false) }
  }, [user, isLoaded, API])

  useEffect(() => {
    if (!isLoaded || !user) return
    const ctrl = new AbortController()
    fetchJobs(ctrl.signal)
    const t = setInterval(() => fetchJobs(ctrl.signal), 5000)
    return () => { ctrl.abort(); clearInterval(t) }
  }, [user, isLoaded, fetchJobs])

  const grouped = groups.map(g => ({
    ...g,
    jobs: jobs.filter(j => (typeGroup[j.type] || 'rasters') === g.key),
  }))

  return (
    <div className="w-full">
      <div className="mb-6 flex items-start justify-between">
        <div>
          <p className="text-xs font-medium tracking-widest uppercase text-[#6AA8A0] mb-1">Processing</p>
          <h1 className="text-2xl font-semibold text-[#1C1C1C]">Jobs</h1>
          <p className="text-gray-400 mt-1 text-sm">All background processing tasks — refreshes every 5 seconds</p>
        </div>
        <button onClick={() => fetchJobs()}
          className="inline-flex items-center gap-2 border border-gray-200 text-gray-600 px-4 py-2 rounded-xl text-sm hover:bg-gray-50 transition-colors">
          <RefreshIcon />Refresh
        </button>
      </div>

      {loading ? (
        <Spinner text="Loading jobs..." />
      ) : jobs.length === 0 ? (
        <div className="bg-white rounded-2xl border-2 border-dashed border-gray-200 p-16 text-center">
          <p className="text-gray-400 text-sm">No jobs yet</p>
          <p className="text-gray-300 text-xs mt-1">Jobs appear automatically when you upload or run a model</p>
        </div>
      ) : (
        <div>
          {grouped.map(g => (
            <JobAccordion key={g.key} label={g.label} jobs={g.jobs}
              clerkId={user?.id || ''} api={API} onRefresh={() => fetchJobs()} />
          ))}
        </div>
      )}
    </div>
  )
}
