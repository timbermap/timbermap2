'use client'
import { useUser } from '@clerk/nextjs'
import { useState, useEffect, useCallback } from 'react'
import Spinner from '@/components/Spinner'

type Job = {
  id: string
  type: string
  status: string
  message: string | null
  input_ref: Record<string, unknown> | null
  created_at: string
  started_at: string | null
  finished_at: string | null
}

const statusColor: Record<string, string> = {
  queued:  'bg-gray-100 text-gray-600',
  running: 'bg-blue-50 text-blue-700',
  done:    'bg-green-50 text-green-700',
  failed:  'bg-red-50 text-red-700',
}

const typeLabel: Record<string, string> = {
  raster_ingest:    'Raster ingest',
  vector_ingest:    'Vector ingest',
  raster_transform: 'Image transform',
  vector_transform: 'Vector transform',
  model_run:        'Model run',
  delete:           'Delete',
}

// Which accordion group each job type belongs to
const typeGroup: Record<string, string> = {
  raster_ingest:    'rasters',
  raster_transform: 'rasters',
  vector_ingest:    'vectors',
  vector_transform: 'vectors',
  model_run:        'models',
  delete:           'rasters',
}

const groups = [
  { key: 'models',  label: 'Models',  defaultOpen: true },
  { key: 'rasters', label: 'Images',  defaultOpen: false },
  { key: 'vectors', label: 'Vectors', defaultOpen: false },
]

function JobRow({ job }: { job: Job }) {
  function formatDate(iso: string | null) {
    if (!iso) return '—'
    return new Date(iso).toLocaleString()
  }
  function duration(start: string | null, end: string | null) {
    if (!start || !end) return '—'
    const ms = new Date(end).getTime() - new Date(start).getTime()
    if (ms < 60000) return `${(ms / 1000).toFixed(0)}s`
    return `${(ms / 60000).toFixed(1)}m`
  }
  return (
    <tr className="border-b border-gray-50 hover:bg-gray-50/50 transition-colors">
      <td className="px-5 py-3.5 text-gray-900 font-medium">{typeLabel[job.type] || job.type}</td>
      <td className="px-5 py-3.5 text-gray-500 text-xs">
        {job.input_ref?.filename as string || job.input_ref?.gcs_path as string || '—'}
      </td>
      <td className="px-5 py-3.5">
        <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${statusColor[job.status] || 'bg-gray-50 text-gray-500'}`}>
          {job.status}
        </span>
      </td>
      <td className="px-5 py-3.5 text-gray-400 text-xs">{job.message || '—'}</td>
      <td className="px-5 py-3.5 text-gray-400 text-xs">{formatDate(job.created_at)}</td>
      <td className="px-5 py-3.5 text-gray-400 text-xs">{duration(job.started_at, job.finished_at)}</td>
    </tr>
  )
}

function JobAccordion({ groupKey, label, jobs, defaultOpen }: {
  groupKey: string
  label: string
  jobs: Job[]
  defaultOpen: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)

  if (jobs.length === 0) return null

  // Count running jobs for indicator
  const runningCount = jobs.filter(j => j.status === 'running').length
  const failedCount  = jobs.filter(j => j.status === 'failed').length

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden mb-3">
      {/* Header */}
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-3 px-5 py-3.5 hover:bg-gray-50/50 transition-colors"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24"
          fill="none" stroke="currentColor" strokeWidth="2.5"
          style={{ transform: open ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 0.15s' }}
          className="text-gray-400 flex-shrink-0"
        >
          <polyline points="9 18 15 12 9 6"/>
        </svg>
        <span className="text-sm font-semibold text-gray-700 flex-1 text-left">{label}</span>
        <div className="flex items-center gap-2">
          {runningCount > 0 && (
            <span className="text-xs px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 font-medium">
              {runningCount} running
            </span>
          )}
          {failedCount > 0 && (
            <span className="text-xs px-2 py-0.5 rounded-full bg-red-50 text-red-600 font-medium">
              {failedCount} failed
            </span>
          )}
          <span className="text-xs bg-gray-100 text-gray-500 rounded-full px-2 py-0.5 font-medium">
            {jobs.length}
          </span>
        </div>
      </button>

      {/* Table */}
      {open && (
        <div className="border-t border-gray-100">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50/50">
                <th className="text-left px-5 py-3 text-xs font-medium tracking-widest uppercase text-gray-400">Type</th>
                <th className="text-left px-5 py-3 text-xs font-medium tracking-widest uppercase text-gray-400">File</th>
                <th className="text-left px-5 py-3 text-xs font-medium tracking-widest uppercase text-gray-400">Status</th>
                <th className="text-left px-5 py-3 text-xs font-medium tracking-widest uppercase text-gray-400">Message</th>
                <th className="text-left px-5 py-3 text-xs font-medium tracking-widest uppercase text-gray-400">Created</th>
                <th className="text-left px-5 py-3 text-xs font-medium tracking-widest uppercase text-gray-400">Duration</th>
              </tr>
            </thead>
            <tbody>
              {jobs.map(job => <JobRow key={job.id} job={job} />)}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

export default function JobsPage() {
  const { user, isLoaded } = useUser()
  const [jobs, setJobs] = useState<Job[]>([])
  const [loading, setLoading] = useState(true)
  const API = process.env.NEXT_PUBLIC_API_URL || "https://timbermap-api-788407107542.us-central1.run.app"

  const fetchJobs = useCallback(async (signal?: AbortSignal) => {
    if (!isLoaded) return
    if (!user) { setLoading(false); return }
    try {
      const res = await fetch(`${API}/jobs/${user.id}`, { signal })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      setJobs(data.jobs || [])
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return
      if (e instanceof TypeError) return
    } finally {
      setLoading(false)
    }
  }, [user, isLoaded, API])

  useEffect(() => {
    if (!isLoaded || !user) return
    const controller = new AbortController()
    fetchJobs(controller.signal)
    const interval = setInterval(() => fetchJobs(controller.signal), 5000)
    return () => { controller.abort(); clearInterval(interval) }
  }, [user, isLoaded, fetchJobs])

  const grouped = groups.map(g => ({
    ...g,
    jobs: jobs.filter(j => (typeGroup[j.type] || 'rasters') === g.key),
  }))

  return (
    <div className="max-w-6xl">
      <div className="mb-6 flex items-start justify-between">
        <div>
          <p className="text-xs font-medium tracking-widest uppercase text-[#5A9E7C] mb-1">Processing</p>
          <h1 className="text-2xl font-semibold text-[#1C1C1C]">Jobs</h1>
          <p className="text-gray-400 mt-1 text-sm">All background processing tasks — refreshes every 5 seconds</p>
        </div>
        <button onClick={() => fetchJobs()}
          className="border border-gray-200 text-gray-600 px-4 py-2 rounded-lg text-sm hover:bg-gray-50 transition-colors">
          Refresh
        </button>
      </div>

      {loading ? (
        <Spinner text="Loading jobs..." />
      ) : jobs.length === 0 ? (
        <div className="bg-white rounded-xl border-2 border-dashed border-gray-200 p-16 text-center">
          <p className="text-gray-400 text-sm">No jobs yet</p>
          <p className="text-gray-300 text-xs mt-1">Jobs are created automatically when you upload or transform data</p>
        </div>
      ) : (
        <div>
          {grouped.map(g => (
            <JobAccordion
              key={g.key}
              groupKey={g.key}
              label={g.label}
              jobs={g.jobs}
              defaultOpen={g.defaultOpen}
            />
          ))}
        </div>
      )}
    </div>
  )
}
