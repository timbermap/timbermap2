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

export default function JobsPage() {
  const { user } = useUser()
  const [jobs, setJobs] = useState<Job[]>([])
  const [loading, setLoading] = useState(true)
  const API = process.env.NEXT_PUBLIC_API_URL || "https://timbermap-api-788407107542.us-central1.run.app"

  const fetchJobs = useCallback(async () => {
    if (!user) return
    const res = await fetch(`${API}/jobs/${user.id}`)
    const data = await res.json()
    setJobs(data.jobs || [])
    setLoading(false)
  }, [user, API])

  useEffect(() => {
    fetchJobs()
    const interval = setInterval(fetchJobs, 5000)
    return () => clearInterval(interval)
  }, [fetchJobs])

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
    <div className="max-w-6xl">
      <div className="mb-6 flex items-start justify-between">
        <div>
          <p className="text-xs font-medium tracking-widest uppercase text-[#5A9E7C] mb-1">Processing</p>
          <h1 className="text-2xl font-semibold text-[#1C1C1C]">Jobs</h1>
          <p className="text-gray-400 mt-1 text-sm">All background processing tasks — refreshes every 5 seconds</p>
        </div>
        <button onClick={fetchJobs}
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
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
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
              {jobs.map(job => (
                <tr key={job.id} className="border-b border-gray-50 hover:bg-gray-50/50 transition-colors">
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
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
