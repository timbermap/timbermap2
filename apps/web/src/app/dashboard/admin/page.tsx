'use client'
import { useUser } from '@clerk/nextjs'
import { useState, useEffect, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'

// ── Types ─────────────────────────────────────────────────────────────────────
type SystemStats = {
  users: number; models: number; images: number; vectors: number
  jobs: number; running_jobs: number; queued_jobs: number
  total_storage_bytes: number; total_ha_ingested: number
}
type ModelStat = {
  id: string; name: string; slug: string; pipeline_type: string
  total_jobs: number; done_jobs: number; failed_jobs: number; running_jobs: number
  total_ha_processed: number
}
type Model = {
  id: string; name: string; slug: string; description: string
  pipeline_type: string; version: string; is_active: boolean
  output_types: string[]; inference_config: Record<string,unknown>
  phase2_config: Record<string,unknown>
  user_count: number; job_count: number; artifact_count: number
  artifacts?: Artifact[]
}
type Artifact = {
  id: string; artifact_key: string; gcs_path: string
  file_size_bytes: number; uploaded_at: string
}
type User = {
  id: string; clerk_id: string; email: string; username: string
  is_superadmin: boolean; created_at: string
  image_count: number; vector_count: number; job_count: number
  storage_bytes: number
}
type UserDetail = User & {
  stats: Record<string,number>
  models: { id: string; name: string; pipeline_type: string; granted_at: string }[]
  recent_jobs: { id: string; type: string; status: string; model_name?: string; created_at: string }[]
}
type AdminJob = {
  id: string; type: string; status: string; message: string | null
  created_at: string; started_at: string | null; finished_at: string | null
  email: string; username: string; model_name?: string
  image_filename?: string; area_ha_processed?: number
}

// ── Icons ─────────────────────────────────────────────────────────────────────
const ChartIcon   = () => <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4"><path d="M15.5 2A1.5 1.5 0 0 0 14 3.5v13a1.5 1.5 0 0 0 3 0v-13A1.5 1.5 0 0 0 15.5 2ZM9.5 6A1.5 1.5 0 0 0 8 7.5v9a1.5 1.5 0 0 0 3 0v-9A1.5 1.5 0 0 0 9.5 6ZM3.5 10A1.5 1.5 0 0 0 2 11.5v5a1.5 1.5 0 0 0 3 0v-5A1.5 1.5 0 0 0 3.5 10Z"/></svg>
const CpuIcon     = () => <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4"><path d="M14 6H6v8h8V6Z"/><path fillRule="evenodd" d="M9.25 3V1.75a.75.75 0 0 1 1.5 0V3h1.5V1.75a.75.75 0 0 1 1.5 0V3h.5A2.75 2.75 0 0 1 17 5.75v.5h1.25a.75.75 0 0 1 0 1.5H17v1.5h1.25a.75.75 0 0 1 0 1.5H17v1.5h1.25a.75.75 0 0 1 0 1.5H17v.5A2.75 2.75 0 0 1 14.25 17h-.5v1.25a.75.75 0 0 1-1.5 0V17h-1.5v1.25a.75.75 0 0 1-1.5 0V17h-1.5v1.25a.75.75 0 0 1-1.5 0V17h-.5A2.75 2.75 0 0 1 3 14.25v-.5H1.75a.75.75 0 0 1 0-1.5H3v-1.5H1.75a.75.75 0 0 1 0-1.5H3v-1.5H1.75a.75.75 0 0 1 0-1.5H3v-.5A2.75 2.75 0 0 1 5.75 3h.5V1.75a.75.75 0 0 1 1.5 0V3h1.5ZM4.5 5.75c0-.69.56-1.25 1.25-1.25h8.5c.69 0 1.25.56 1.25 1.25v8.5c0 .69-.56 1.25-1.25 1.25h-8.5c-.69 0-1.25-.56-1.25-1.25v-8.5Z" clipRule="evenodd"/></svg>
const UsersIcon   = () => <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4"><path d="M7 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM14.5 9a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5ZM1.615 16.428a1.224 1.224 0 0 1-.569-1.175 6.002 6.002 0 0 1 11.908 0c.058.467-.172.92-.57 1.174A9.953 9.953 0 0 1 7 18a9.953 9.953 0 0 1-5.385-1.572ZM14.5 16h-.106c.07-.297.088-.611.048-.933a7.47 7.47 0 0 0-1.588-3.755 4.502 4.502 0 0 1 5.874 2.636.818.818 0 0 1-.36.98A7.465 7.465 0 0 1 14.5 16Z"/></svg>
const JobsIcon    = () => <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4"><path fillRule="evenodd" d="M2 7a1 1 0 0 1 1-1h8a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V7Zm2 3.25a.75.75 0 0 1 .75-.75h4.5a.75.75 0 0 1 0 1.5h-4.5a.75.75 0 0 1-.75-.75Zm0 3.5a.75.75 0 0 1 .75-.75h4.5a.75.75 0 0 1 0 1.5h-4.5a.75.75 0 0 1-.75-.75Z" clipRule="evenodd"/></svg>
const TrashIcon   = () => <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5"><path fillRule="evenodd" d="M8.75 1A2.75 2.75 0 0 0 6 3.75v.443c-.795.077-1.584.176-2.365.298a.75.75 0 1 0 .23 1.482l.149-.022.841 10.518A2.75 2.75 0 0 0 7.596 19h4.807a2.75 2.75 0 0 0 2.742-2.53l.841-10.52.149.023a.75.75 0 0 0 .23-1.482A41.03 41.03 0 0 0 14 3.193V3.75A2.75 2.75 0 0 0 11.25 1h-2.5ZM10 4c.84 0 1.673.025 2.5.075V3.75c0-.69-.56-1.25-1.25-1.25h-2.5c-.69 0-1.25.56-1.25 1.25v.325C8.327 4.025 9.16 4 10 4ZM8.58 7.72a.75.75 0 0 0-1.5.06l.3 7.5a.75.75 0 1 0 1.5-.06l-.3-7.5Zm4.34.06a.75.75 0 1 0-1.5-.06l-.3 7.5a.75.75 0 1 0 1.5.06l.3-7.5Z" clipRule="evenodd"/></svg>
const StopIcon    = () => <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5"><path d="M5.25 3A2.25 2.25 0 0 0 3 5.25v9.5A2.25 2.25 0 0 0 5.25 17h9.5A2.25 2.25 0 0 0 17 14.75v-9.5A2.25 2.25 0 0 0 14.75 3h-9.5Z"/></svg>
const PlusIcon    = () => <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4"><path d="M10.75 4.75a.75.75 0 0 0-1.5 0v4.5h-4.5a.75.75 0 0 0 0 1.5h4.5v4.5a.75.75 0 0 0 1.5 0v-4.5h4.5a.75.75 0 0 0 0-1.5h-4.5v-4.5Z"/></svg>
const EditIcon    = () => <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5"><path d="m5.433 13.917 1.262-3.155A4 4 0 0 1 7.58 9.42l6.92-6.918a2.121 2.121 0 0 1 3 3l-6.92 6.918c-.383.383-.84.685-1.343.886l-3.154 1.262a.5.5 0 0 1-.65-.65Z"/><path d="M3.5 5.75c0-.69.56-1.25 1.25-1.25H10A.75.75 0 0 0 10 3H4.75A2.75 2.75 0 0 0 2 5.75v9.5A2.75 2.75 0 0 0 4.75 18h9.5A2.75 2.75 0 0 0 17 15.25V10a.75.75 0 0 0-1.5 0v5.25c0 .69-.56 1.25-1.25 1.25h-9.5c-.69 0-1.25-.56-1.25-1.25v-9.5Z"/></svg>
const UploadIcon  = () => <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5"><path d="M9.25 13.25a.75.75 0 0 0 1.5 0V4.636l2.955 3.129a.75.75 0 0 0 1.09-1.03l-4.25-4.5a.75.75 0 0 0-1.09 0l-4.25 4.5a.75.75 0 1 0 1.09 1.03L9.25 4.636v8.614Z"/><path d="M3.5 12.75a.75.75 0 0 0-1.5 0v2.5A2.75 2.75 0 0 0 4.75 18h10.5A2.75 2.75 0 0 0 18 15.25v-2.5a.75.75 0 0 0-1.5 0v2.5c0 .69-.56 1.25-1.25 1.25H4.75c-.69 0-1.25-.56-1.25-1.25v-2.5Z"/></svg>
const CheckIcon   = () => <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5"><path fillRule="evenodd" d="M16.704 4.153a.75.75 0 0 1 .143 1.052l-8 10.5a.75.75 0 0 1-1.127.075l-4.5-4.5a.75.75 0 0 1 1.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 0 1 1.05-.143Z" clipRule="evenodd"/></svg>
const SpinIcon    = () => <svg className="animate-spin w-3.5 h-3.5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>
const XIcon       = () => <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5"><path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z"/></svg>

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmtBytes(b: number) {
  if (b > 1e9) return (b / 1e9).toFixed(1) + ' GB'
  if (b > 1e6) return (b / 1e6).toFixed(1) + ' MB'
  return (b / 1e3).toFixed(0) + ' KB'
}
function fmtDate(iso: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
}
const statusCfg: Record<string,string> = {
  queued:  'bg-gray-100 text-gray-600',
  running: 'bg-blue-50 text-blue-700',
  done:    'bg-[#EEF7F6] text-[#3D7A72]',
  failed:  'bg-red-50 text-red-600',
}
const pipelineLabel: Record<string,string> = {
  blob_detection: 'Object Detection', hough_lines: 'Line Detection', zonal_grid: 'Zonal Analysis',
}

// ── Stat card ─────────────────────────────────────────────────────────────────
function StatCard({ label, value, sub, color = 'text-[#3D7A72]' }: {
  label: string; value: string | number; sub?: string; color?: string
}) {
  return (
    <div className="bg-white rounded-2xl p-5 border border-gray-100 shadow-sm">
      <p className="text-xs font-medium tracking-widest uppercase text-gray-400 mb-3">{label}</p>
      <p className={`text-3xl font-light tabular-nums ${color}`}>{value}</p>
      {sub && <p className="text-xs text-gray-400 mt-1">{sub}</p>}
    </div>
  )
}

// ── Tab: Overview ─────────────────────────────────────────────────────────────
function OverviewTab({ clerkId, api }: { clerkId: string; api: string }) {
  const [sys, setSys]         = useState<SystemStats | null>(null)
  const [modelStats, setModelStats] = useState<ModelStat[]>([])
  const [queue, setQueue]     = useState<AdminJob[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const h = { 'x-clerk-id': clerkId }
    Promise.all([
      fetch(`${api}/superadmin/system`,       { headers: h }).then(r => r.json()),
      fetch(`${api}/superadmin/stats/models`, { headers: h }).then(r => r.json()),
      fetch(`${api}/superadmin/jobs/queue`,   { headers: h }).then(r => r.json()),
    ]).then(([s, m, q]) => {
      setSys(s); setModelStats(m.models || []); setQueue(q.jobs || [])
    }).finally(() => setLoading(false))
  }, [clerkId, api])

  if (loading) return <div className="flex items-center gap-2 text-gray-400 py-8"><SpinIcon />Loading...</div>
  if (!sys) return null

  return (
    <div className="space-y-6">
      {/* System stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard label="Users"   value={sys.users}   sub="registered" />
        <StatCard label="Images"  value={sys.images}  sub={fmtBytes(sys.total_storage_bytes)} />
        <StatCard label="Jobs"    value={sys.jobs}     sub={`${sys.running_jobs} running`} />
        <StatCard label="Ha ingested" value={sys.total_ha_ingested.toFixed(1)} sub="total" />
      </div>

      {/* Ha by model */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
        <p className="text-xs font-medium tracking-widest uppercase text-gray-400 mb-4">Hectares processed by model</p>
        {modelStats.length === 0 ? (
          <p className="text-sm text-gray-300">No ML jobs run yet</p>
        ) : (
          <div className="space-y-3">
            {modelStats.map(m => {
              const maxHa = Math.max(...modelStats.map(x => x.total_ha_processed), 1)
              const pct   = Math.round((m.total_ha_processed / maxHa) * 100)
              return (
                <div key={m.id}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm font-medium text-gray-700">{m.name}</span>
                    <div className="flex items-center gap-3">
                      <span className="text-xs text-gray-400">{m.done_jobs} jobs · {m.failed_jobs} failed</span>
                      <span className="text-sm font-semibold text-[#3D7A72] tabular-nums w-20 text-right">
                        {m.total_ha_processed.toFixed(1)} ha
                      </span>
                    </div>
                  </div>
                  <div className="w-full bg-gray-100 rounded-full h-2">
                    <div className="h-2 bg-[#6AA8A0] rounded-full transition-all" style={{ width: `${pct}%` }} />
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Active queue */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
        <p className="text-xs font-medium tracking-widest uppercase text-gray-400 mb-4">
          Active queue <span className="text-gray-300 font-normal normal-case">({queue.length})</span>
        </p>
        {queue.length === 0 ? (
          <p className="text-sm text-gray-300">Queue is empty</p>
        ) : (
          <table className="w-full text-sm">
            <thead><tr className="border-b border-gray-100">
              {['User','Model','Status','Created'].map(h => (
                <th key={h} className="text-left pb-2 text-xs font-medium tracking-widest uppercase text-gray-400">{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {queue.map(j => (
                <tr key={j.id} className="border-b border-gray-50">
                  <td className="py-2.5 text-gray-700">{j.email}</td>
                  <td className="py-2.5 text-gray-500">{j.model_name || j.type}</td>
                  <td className="py-2.5"><span className={`text-xs px-2 py-0.5 rounded-full font-medium ${statusCfg[j.status]}`}>{j.status}</span></td>
                  <td className="py-2.5 text-gray-400 text-xs">{fmtDate(j.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

// ── Tab: Models ───────────────────────────────────────────────────────────────
function ModelsTab({ clerkId, api }: { clerkId: string; api: string }) {
  const [models, setModels]       = useState<Model[]>([])
  const [loading, setLoading]     = useState(true)
  const [selected, setSelected]   = useState<Model | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [saving, setSaving]       = useState(false)
  const [uploadKey, setUploadKey] = useState<string>('')
  const [uploading, setUploading] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const h = { 'x-clerk-id': clerkId }

  const fetchModels = useCallback(() => {
    fetch(`${api}/superadmin/models`, { headers: h })
      .then(r => r.json()).then(d => setModels(d.models || []))
      .finally(() => setLoading(false))
  }, [clerkId, api])

  useEffect(() => { fetchModels() }, [fetchModels])

  // Form state
  const [form, setForm] = useState({
    name: '', slug: '', description: '', pipeline_type: 'blob_detection',
    version: '1.0', output_types: '["raster_cog","geojson","shapefile"]',
    inference_config: '{}', phase2_config: '{}',
  })

  function openEdit(m: Model) {
    setSelected(m)
    setForm({
      name: m.name, slug: m.slug, description: m.description,
      pipeline_type: m.pipeline_type, version: m.version,
      output_types: JSON.stringify(m.output_types || []),
      inference_config: JSON.stringify(m.inference_config || {}, null, 2),
      phase2_config: JSON.stringify(m.phase2_config || {}, null, 2),
    })
    setShowCreate(false)
  }

  async function handleSave() {
    setSaving(true)
    try {
      const body = {
        ...form,
        output_types: JSON.parse(form.output_types),
        inference_config: JSON.parse(form.inference_config),
        phase2_config: JSON.parse(form.phase2_config),
      }
      const url    = selected ? `${api}/superadmin/models/${selected.id}` : `${api}/superadmin/models`
      const method = selected ? 'PUT' : 'POST'
      await fetch(url, { method, headers: { ...h, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      setSelected(null); setShowCreate(false); fetchModels()
    } catch (e) { alert('Save failed: ' + e) }
    finally { setSaving(false) }
  }

  async function handleToggleActive(m: Model) {
    await fetch(`${api}/superadmin/models/${m.id}`, {
      method: 'PUT', headers: { ...h, 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_active: !m.is_active }),
    })
    fetchModels()
  }

  async function handleArtifactUpload(modelId: string, file: File, key: string) {
    setUploading(true)
    try {
      const r = await fetch(`${api}/superadmin/models/${modelId}/artifacts/upload-url?artifact_key=${key}&filename=${file.name}`, { headers: h })
      const { url, gcs_path } = await r.json()
      await fetch(url, { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream' }, body: file })
      await fetch(`${api}/superadmin/models/${modelId}/artifacts/confirm`, {
        method: 'POST', headers: { ...h, 'Content-Type': 'application/json' },
        body: JSON.stringify({ artifact_key: key, gcs_path, file_size: file.size }),
      })
      fetchModels()
      // Refresh selected model artifacts
      if (selected?.id === modelId) {
        const d = await fetch(`${api}/superadmin/models/${modelId}`, { headers: h }).then(r => r.json())
        setSelected(d)
      }
    } catch (e) { alert('Upload failed: ' + e) }
    finally { setUploading(false) }
  }

  async function handleDeleteArtifact(modelId: string, key: string) {
    if (!confirm(`Delete artifact "${key}"?`)) return
    await fetch(`${api}/superadmin/models/${modelId}/artifacts/${key}`, { method: 'DELETE', headers: h })
    fetchModels()
  }

  if (loading) return <div className="flex items-center gap-2 text-gray-400 py-8"><SpinIcon />Loading...</div>

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button onClick={() => { setShowCreate(true); setSelected(null); setForm({ name:'', slug:'', description:'', pipeline_type:'blob_detection', version:'1.0', output_types:'["raster_cog","geojson","shapefile"]', inference_config:'{}', phase2_config:'{}' }) }}
          className="inline-flex items-center gap-2 bg-[#3D7A72] text-white px-4 py-2 rounded-xl text-sm font-medium hover:bg-[#2A5750] transition-colors">
          <PlusIcon />New model
        </button>
      </div>

      {/* Model list */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead><tr className="border-b border-gray-100 bg-gray-50/60">
            {['Name','Pipeline','Version','Users','Jobs','Artifacts','Status','Actions'].map(h => (
              <th key={h} className="text-left px-4 py-3 text-xs font-medium tracking-widest uppercase text-gray-400">{h}</th>
            ))}
          </tr></thead>
          <tbody>
            {models.map(m => (
              <tr key={m.id} className="border-b border-gray-50 hover:bg-gray-50/50 transition-colors">
                <td className="px-4 py-3">
                  <p className="font-medium text-gray-900 text-sm">{m.name}</p>
                  <p className="text-xs text-gray-400 font-mono">{m.slug}</p>
                </td>
                <td className="px-4 py-3 text-xs text-gray-500">{pipelineLabel[m.pipeline_type] || m.pipeline_type}</td>
                <td className="px-4 py-3 text-xs text-gray-500 font-mono">{m.version}</td>
                <td className="px-4 py-3 text-xs text-gray-500">{m.user_count}</td>
                <td className="px-4 py-3 text-xs text-gray-500">{m.job_count}</td>
                <td className="px-4 py-3">
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${m.artifact_count >= 3 ? 'bg-[#EEF7F6] text-[#3D7A72]' : 'bg-amber-50 text-amber-600'}`}>
                    {m.artifact_count}/3
                  </span>
                </td>
                <td className="px-4 py-3">
                  <button onClick={() => handleToggleActive(m)}
                    className={`text-xs px-2.5 py-1 rounded-full font-medium transition-colors ${m.is_active ? 'bg-[#EEF7F6] text-[#3D7A72] hover:bg-red-50 hover:text-red-600' : 'bg-gray-100 text-gray-500 hover:bg-[#EEF7F6] hover:text-[#3D7A72]'}`}>
                    {m.is_active ? 'Active' : 'Inactive'}
                  </button>
                </td>
                <td className="px-4 py-3">
                  <button onClick={() => openEdit(m)}
                    className="inline-flex items-center gap-1 px-2 py-1.5 text-xs text-[#3D7A72] hover:bg-[#EEF7F6] rounded-lg transition-colors">
                    <EditIcon />Edit
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Edit / Create form modal */}
      {(selected || showCreate) && (
        <div className="fixed inset-0 bg-black/30 flex items-start justify-center z-50 backdrop-blur-sm pt-10 pb-10 overflow-y-auto">
          <div className="bg-white rounded-2xl w-full max-w-2xl shadow-2xl border border-gray-100 mx-4">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <h2 className="text-base font-semibold text-[#1C1C1C]">
                {selected ? `Edit — ${selected.name}` : 'New model'}
              </h2>
              <button onClick={() => { setSelected(null); setShowCreate(false) }}
                className="text-gray-400 hover:text-gray-600 transition-colors"><XIcon /></button>
            </div>

            <div className="px-6 py-5 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                {[
                  { key: 'name', label: 'Name' },
                  { key: 'slug', label: 'Slug' },
                  { key: 'version', label: 'Version' },
                ].map(f => (
                  <div key={f.key} className={f.key === 'name' ? 'col-span-2' : ''}>
                    <label className="text-xs font-medium text-gray-500 block mb-1">{f.label}</label>
                    <input value={form[f.key as keyof typeof form]}
                      onChange={e => setForm(p => ({ ...p, [f.key]: e.target.value }))}
                      className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-[#6AA8A0] transition-all" />
                  </div>
                ))}
                <div>
                  <label className="text-xs font-medium text-gray-500 block mb-1">Pipeline type</label>
                  <select value={form.pipeline_type} onChange={e => setForm(p => ({ ...p, pipeline_type: e.target.value }))}
                    className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-[#6AA8A0] transition-all">
                    <option value="blob_detection">blob_detection</option>
                    <option value="hough_lines">hough_lines</option>
                    <option value="zonal_grid">zonal_grid</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="text-xs font-medium text-gray-500 block mb-1">Description</label>
                <textarea value={form.description} rows={2}
                  onChange={e => setForm(p => ({ ...p, description: e.target.value }))}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-[#6AA8A0] transition-all resize-none" />
              </div>

              <div>
                <label className="text-xs font-medium text-gray-500 block mb-1">Output types (JSON array)</label>
                <input value={form.output_types} onChange={e => setForm(p => ({ ...p, output_types: e.target.value }))}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm font-mono focus:outline-none focus:border-[#6AA8A0] transition-all" />
              </div>

              {[
                { key: 'inference_config', label: 'inference_config (JSON)' },
                { key: 'phase2_config',    label: 'phase2_config (JSON)' },
              ].map(f => (
                <div key={f.key}>
                  <label className="text-xs font-medium text-gray-500 block mb-1">{f.label}</label>
                  <textarea value={form[f.key as keyof typeof form]} rows={4}
                    onChange={e => setForm(p => ({ ...p, [f.key]: e.target.value }))}
                    className="w-full border border-gray-200 rounded-xl px-3 py-2 text-xs font-mono focus:outline-none focus:border-[#6AA8A0] transition-all resize-none" />
                </div>
              ))}

              {/* Artifacts section — only for existing models */}
              {selected && (
                <div>
                  <p className="text-xs font-medium text-gray-500 mb-2">Artifacts</p>
                  <div className="space-y-2 mb-3">
                    {(selected.artifacts || []).map(a => (
                      <div key={a.artifact_key} className="flex items-center justify-between px-3 py-2 bg-gray-50 rounded-xl border border-gray-100">
                        <div>
                          <span className="text-xs font-mono font-medium text-gray-700">{a.artifact_key}</span>
                          <span className="text-xs text-gray-400 ml-2">{fmtBytes(a.file_size_bytes)}</span>
                          <span className="text-xs text-gray-300 ml-2">{fmtDate(a.uploaded_at)}</span>
                        </div>
                        <button onClick={() => handleDeleteArtifact(selected.id, a.artifact_key)}
                          className="text-gray-400 hover:text-red-500 transition-colors"><TrashIcon /></button>
                      </div>
                    ))}
                    {(selected.artifacts || []).length === 0 && (
                      <p className="text-xs text-gray-300">No artifacts uploaded yet</p>
                    )}
                  </div>
                  {/* Upload new artifact */}
                  <div className="flex gap-2">
                    <select value={uploadKey} onChange={e => setUploadKey(e.target.value)}
                      className="border border-gray-200 rounded-xl px-3 py-2 text-xs focus:outline-none focus:border-[#6AA8A0] transition-all">
                      <option value="">Select artifact...</option>
                      <option value="weights">weights (.h5)</option>
                      <option value="means">means (.npy)</option>
                      <option value="stds">stds (.npy)</option>
                    </select>
                    <button onClick={() => uploadKey && fileRef.current?.click()}
                      disabled={!uploadKey || uploading}
                      className="inline-flex items-center gap-1.5 px-3 py-2 text-xs bg-[#3D7A72] text-white rounded-xl hover:bg-[#2A5750] transition-colors disabled:opacity-50">
                      {uploading ? <><SpinIcon />Uploading...</> : <><UploadIcon />Upload</>}
                    </button>
                    <input ref={fileRef} type="file" className="hidden"
                      onChange={e => {
                        const f = e.target.files?.[0]
                        if (f && selected && uploadKey) handleArtifactUpload(selected.id, f, uploadKey)
                        if (fileRef.current) fileRef.current.value = ''
                      }} />
                  </div>
                </div>
              )}
            </div>

            <div className="flex gap-2 px-6 pb-5">
              <button onClick={handleSave} disabled={saving}
                className="flex-1 bg-[#3D7A72] text-white py-2.5 rounded-xl text-sm font-medium hover:bg-[#2A5750] transition-colors disabled:opacity-50 shadow-sm">
                {saving ? 'Saving...' : selected ? 'Save changes' : 'Create model'}
              </button>
              <button onClick={() => { setSelected(null); setShowCreate(false) }}
                className="flex-1 border border-gray-200 text-gray-600 py-2.5 rounded-xl text-sm hover:bg-gray-50 transition-colors">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Tab: Users ────────────────────────────────────────────────────────────────
function UsersTab({ clerkId, api }: { clerkId: string; api: string }) {
  const [users, setUsers]           = useState<User[]>([])
  const [models, setModels]         = useState<Model[]>([])
  const [selected, setSelected]     = useState<UserDetail | null>(null)
  const [loading, setLoading]       = useState(true)
  const [loadingDetail, setLoadingDetail] = useState(false)
  const h = { 'x-clerk-id': clerkId }

  useEffect(() => {
    Promise.all([
      fetch(`${api}/superadmin/users`,  { headers: h }).then(r => r.json()),
      fetch(`${api}/superadmin/models`, { headers: h }).then(r => r.json()),
    ]).then(([u, m]) => { setUsers(u.users || []); setModels(m.models || []) })
    .finally(() => setLoading(false))
  }, [clerkId, api])

  async function openUser(u: User) {
    setLoadingDetail(true)
    const d = await fetch(`${api}/superadmin/users/${u.clerk_id}`, { headers: h }).then(r => r.json())
    setSelected(d)
    setLoadingDetail(false)
  }

  async function toggleModel(user: UserDetail, modelId: string, hasAccess: boolean) {
    if (hasAccess) {
      await fetch(`${api}/superadmin/users/${user.clerk_id}/models/${modelId}?user_id=${user.id}`, { method: 'DELETE', headers: h })
    } else {
      await fetch(`${api}/superadmin/users/${user.clerk_id}/models/${modelId}`, {
        method: 'POST', headers: { ...h, 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: user.id }),
      })
    }
    const d = await fetch(`${api}/superadmin/users/${user.clerk_id}`, { headers: h }).then(r => r.json())
    setSelected(d)
    // Refresh list
    const ul = await fetch(`${api}/superadmin/users`, { headers: h }).then(r => r.json())
    setUsers(ul.users || [])
  }

  async function toggleSuperadmin(user: UserDetail) {
    if (!confirm(`${user.is_superadmin ? 'Remove' : 'Grant'} superadmin for ${user.email}?`)) return
    await fetch(`${api}/superadmin/users/${user.clerk_id}/superadmin`, {
      method: 'PUT', headers: { ...h, 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_superadmin: !user.is_superadmin }),
    })
    const d = await fetch(`${api}/superadmin/users/${user.clerk_id}`, { headers: h }).then(r => r.json())
    setSelected(d)
  }

  if (loading) return <div className="flex items-center gap-2 text-gray-400 py-8"><SpinIcon />Loading...</div>

  return (
    <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
      {/* User list */}
      <div className="lg:col-span-3 bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead><tr className="border-b border-gray-100 bg-gray-50/60">
            {['User','Images','Jobs','Storage',''].map(h => (
              <th key={h} className="text-left px-4 py-3 text-xs font-medium tracking-widest uppercase text-gray-400">{h}</th>
            ))}
          </tr></thead>
          <tbody>
            {users.map(u => (
              <tr key={u.id} className={`border-b border-gray-50 hover:bg-[#F4F9F9] transition-colors cursor-pointer ${selected?.id === u.id ? 'bg-[#EEF7F6]' : ''}`}
                onClick={() => openUser(u)}>
                <td className="px-4 py-3">
                  <p className="font-medium text-gray-900 text-sm truncate max-w-[150px]">{u.email}</p>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    {u.is_superadmin && <span className="text-xs px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-600 font-medium">admin</span>}
                    <span className="text-xs text-gray-400">{u.username}</span>
                  </div>
                </td>
                <td className="px-4 py-3 text-xs text-gray-500">{u.image_count}</td>
                <td className="px-4 py-3 text-xs text-gray-500">{u.job_count}</td>
                <td className="px-4 py-3 text-xs text-gray-500">{fmtBytes(u.storage_bytes)}</td>
                <td className="px-4 py-3 text-xs text-[#6AA8A0]">View →</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* User detail */}
      <div className="lg:col-span-2">
        {loadingDetail && <div className="flex items-center gap-2 text-gray-400 py-8 px-4"><SpinIcon />Loading...</div>}
        {!loadingDetail && selected && (
          <div className="space-y-3">
            {/* Info */}
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
              <div className="flex items-start justify-between mb-3">
                <div>
                  <p className="font-semibold text-gray-900">{selected.email}</p>
                  <p className="text-xs text-gray-400 mt-0.5">Joined {fmtDate(selected.created_at)}</p>
                </div>
                <button onClick={() => toggleSuperadmin(selected)}
                  className={`text-xs px-2.5 py-1 rounded-full font-medium border transition-colors ${
                    selected.is_superadmin
                      ? 'bg-amber-50 text-amber-600 border-amber-200 hover:bg-red-50 hover:text-red-600 hover:border-red-200'
                      : 'bg-gray-100 text-gray-500 border-gray-200 hover:bg-amber-50 hover:text-amber-600 hover:border-amber-200'
                  }`}>
                  {selected.is_superadmin ? '⚡ Superadmin' : 'Make admin'}
                </button>
              </div>
              <div className="grid grid-cols-3 gap-2">
                {[
                  { label: 'Images', value: selected.stats.image_count },
                  { label: 'Jobs done', value: selected.stats.jobs_done },
                  { label: 'Failed', value: selected.stats.jobs_failed },
                ].map(s => (
                  <div key={s.label} className="bg-gray-50 rounded-xl p-3 text-center">
                    <p className="text-lg font-light text-[#3D7A72] tabular-nums">{s.value}</p>
                    <p className="text-xs text-gray-400">{s.label}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Model permissions */}
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
              <p className="text-xs font-medium tracking-widest uppercase text-gray-400 mb-3">Model access</p>
              <div className="space-y-2">
                {models.filter(m => m.is_active).map(m => {
                  const hasAccess = selected.models.some(p => p.id === m.id)
                  return (
                    <div key={m.id} className="flex items-center justify-between py-2 border-b border-gray-50 last:border-0">
                      <div>
                        <p className="text-sm text-gray-700 font-medium">{m.name}</p>
                        <p className="text-xs text-gray-400">{pipelineLabel[m.pipeline_type] || m.pipeline_type}</p>
                      </div>
                      <button onClick={() => toggleModel(selected, m.id, hasAccess)}
                        className={`inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-xl font-medium border transition-all ${
                          hasAccess
                            ? 'bg-[#EEF7F6] text-[#3D7A72] border-[#A0CECC] hover:bg-red-50 hover:text-red-600 hover:border-red-200'
                            : 'bg-gray-50 text-gray-500 border-gray-200 hover:bg-[#EEF7F6] hover:text-[#3D7A72] hover:border-[#A0CECC]'
                        }`}>
                        {hasAccess ? <><CheckIcon />Enabled</> : 'Enable'}
                      </button>
                    </div>
                  )
                })}
              </div>
            </div>

            {/* Recent jobs */}
            {selected.recent_jobs.length > 0 && (
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
                <p className="text-xs font-medium tracking-widest uppercase text-gray-400 mb-3">Recent jobs</p>
                <div className="space-y-2">
                  {selected.recent_jobs.slice(0, 5).map(j => (
                    <div key={j.id} className="flex items-center justify-between">
                      <p className="text-xs text-gray-600">{j.model_name || j.type}</p>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-gray-300">{fmtDate(j.created_at)}</span>
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${statusCfg[j.status] || 'bg-gray-100 text-gray-500'}`}>{j.status}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
        {!loadingDetail && !selected && (
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-8 text-center">
            <p className="text-sm text-gray-300">Select a user to view details</p>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Tab: Jobs ─────────────────────────────────────────────────────────────────
function AdminJobsTab({ clerkId, api }: { clerkId: string; api: string }) {
  const [jobs, setJobs]           = useState<AdminJob[]>([])
  const [loading, setLoading]     = useState(true)
  const [statusFilter, setStatusFilter] = useState('')
  const [acting, setActing]       = useState<string | null>(null)
  const h = { 'x-clerk-id': clerkId }

  const fetchJobs = useCallback(() => {
    const qs = statusFilter ? `?status=${statusFilter}&limit=100` : '?limit=100'
    fetch(`${api}/superadmin/jobs${qs}`, { headers: h })
      .then(r => r.json()).then(d => setJobs(d.jobs || []))
      .finally(() => setLoading(false))
  }, [clerkId, api, statusFilter])

  useEffect(() => { fetchJobs() }, [fetchJobs])

  async function handleCancel(jobId: string) {
    setActing(jobId)
    await fetch(`${api}/superadmin/jobs/${jobId}/cancel`, { method: 'DELETE', headers: h })
    fetchJobs(); setActing(null)
  }

  async function handleDelete(jobId: string) {
    if (!confirm('Hard delete this job and all its outputs from GCS?')) return
    setActing(jobId)
    await fetch(`${api}/superadmin/jobs/${jobId}`, { method: 'DELETE', headers: h })
    fetchJobs(); setActing(null)
  }

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex items-center gap-3">
        {['', 'running', 'queued', 'done', 'failed'].map(s => (
          <button key={s} onClick={() => { setStatusFilter(s); setLoading(true) }}
            className={`text-xs px-3 py-1.5 rounded-xl font-medium border transition-colors ${
              statusFilter === s ? 'bg-[#3D7A72] text-white border-[#3D7A72]' : 'bg-white text-gray-500 border-gray-200 hover:border-gray-300'
            }`}>
            {s || 'All'}
          </button>
        ))}
        <button onClick={() => { setLoading(true); fetchJobs() }}
          className="ml-auto text-xs text-[#6AA8A0] hover:text-[#3D7A72] transition-colors">
          Refresh
        </button>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-gray-400 py-8"><SpinIcon />Loading...</div>
      ) : (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-gray-100 bg-gray-50/60">
                {['User','Model','Image','Ha','Status','Created','Actions'].map(h => (
                  <th key={h} className="text-left px-4 py-3 text-xs font-medium tracking-widest uppercase text-gray-400 whitespace-nowrap">{h}</th>
                ))}
              </tr></thead>
              <tbody>
                {jobs.length === 0 ? (
                  <tr><td colSpan={7} className="px-4 py-8 text-center text-sm text-gray-300">No jobs found</td></tr>
                ) : jobs.map(j => (
                  <tr key={j.id} className="border-b border-gray-50 hover:bg-gray-50/50 transition-colors">
                    <td className="px-4 py-3 text-xs text-gray-600 max-w-[120px] truncate">{j.email}</td>
                    <td className="px-4 py-3 text-xs text-gray-700 font-medium">{j.model_name || j.type}</td>
                    <td className="px-4 py-3 text-xs text-gray-400 max-w-[120px] truncate">{j.image_filename || '—'}</td>
                    <td className="px-4 py-3 text-xs text-gray-500 tabular-nums">
                      {j.area_ha_processed ? j.area_ha_processed.toFixed(1) : '—'}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${statusCfg[j.status] || 'bg-gray-100 text-gray-500'}`}>
                        {j.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-400 whitespace-nowrap">{fmtDate(j.created_at)}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1">
                        {(j.status === 'running' || j.status === 'queued') && (
                          <button onClick={() => handleCancel(j.id)} disabled={acting === j.id}
                            className="inline-flex items-center gap-1 px-2 py-1.5 text-xs text-orange-500 hover:bg-orange-50 rounded-lg transition-colors border border-orange-200 disabled:opacity-50">
                            {acting === j.id ? <SpinIcon /> : <StopIcon />}Cancel
                          </button>
                        )}
                        <button onClick={() => handleDelete(j.id)} disabled={acting === j.id}
                          className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-50">
                          <TrashIcon />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────
const TABS = [
  { key: 'overview', label: 'Overview',  icon: <ChartIcon /> },
  { key: 'models',   label: 'Models',    icon: <CpuIcon /> },
  { key: 'users',    label: 'Users',     icon: <UsersIcon /> },
  { key: 'jobs',     label: 'All jobs',  icon: <JobsIcon /> },
]

export default function AdminPage() {
  const { user, isLoaded } = useUser()
  const router = useRouter()
  const [tab, setTab]             = useState('overview')
  const [authorized, setAuthorized] = useState<boolean | null>(null)
  const API = process.env.NEXT_PUBLIC_API_URL || 'https://timbermap-api-788407107542.us-central1.run.app'

  useEffect(() => {
    if (!isLoaded || !user) return
    fetch(`${API}/superadmin/health`, { headers: { 'x-clerk-id': user.id } })
      .then(r => setAuthorized(r.ok))
      .catch(() => setAuthorized(false))
  }, [isLoaded, user, API])

  if (!isLoaded || authorized === null) {
    return (
      <div className="flex items-center gap-2 text-gray-400 py-16 justify-center">
        <SpinIcon />Checking access...
      </div>
    )
  }

  if (!authorized) {
    return (
      <div className="max-w-md mx-auto py-16 text-center">
        <p className="text-gray-500 font-medium">Access denied</p>
        <p className="text-gray-300 text-sm mt-1">Superadmin privileges required</p>
        <button onClick={() => router.push('/dashboard')} className="mt-4 text-sm text-[#6AA8A0] hover:underline">
          Back to dashboard
        </button>
      </div>
    )
  }

  return (
    <div className="w-full">
      {/* Header */}
      <div className="mb-6">
        <p className="text-xs font-medium tracking-widest uppercase text-[#6AA8A0] mb-1">Superadmin</p>
        <h1 className="text-2xl font-semibold text-[#1C1C1C]">Admin Panel</h1>
        <p className="text-gray-400 mt-1 text-sm">Full system control — manage models, users, and jobs</p>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 mb-6 bg-white rounded-2xl p-1.5 border border-gray-100 shadow-sm w-fit">
        {TABS.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all ${
              tab === t.key
                ? 'bg-[#3D7A72] text-white shadow-sm'
                : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'
            }`}>
            {t.icon}{t.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {tab === 'overview' && <OverviewTab clerkId={user!.id} api={API} />}
      {tab === 'models'   && <ModelsTab  clerkId={user!.id} api={API} />}
      {tab === 'users'    && <UsersTab   clerkId={user!.id} api={API} />}
      {tab === 'jobs'     && <AdminJobsTab clerkId={user!.id} api={API} />}
    </div>
  )
}
