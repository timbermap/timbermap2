'use client'
import { useUser } from '@clerk/nextjs'
import { useState, useEffect, useMemo } from 'react'

const API = process.env.NEXT_PUBLIC_API_URL || 'https://timbermap-api-tjrp7tcqaa-uc.a.run.app'

type Period = 'day' | 'week' | 'month' | 'year'

type ImageRecord = {
  id: string; filename: string; status: string
  area_ha: number | null; filesize: number | null
  epsg: string | null; num_bands: number | null
  created_at: string
}
type VectorRecord = {
  id: string; filename: string; status: string
  area_ha: number | null; filesize: number | null
  geometry_type: string | null; created_at: string
}
type JobRecord = {
  id: string; type: string; status: string
  pipeline_type: string | null; model_name: string | null
  image_filename: string | null; vector_filename: string | null
  image_ha: number | null; vector_ha: number | null
  ha_processed: number | null; aoi_used: boolean
  created_at: string; finished_at: string | null
}

// ── Palette ───────────────────────────────────────────────────────────────────
const teal    = '#3D7A72'
const tealLt  = '#6AA8A0'
const tealXlt = '#A0CECC'
const tealBg  = '#EEF7F6'

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmtHa(ha: number | null | undefined) {
  if (ha == null || ha === 0) return '—'
  if (ha >= 10000) return `${(ha / 1000).toFixed(0)}k ha`
  if (ha >= 1000)  return `${(ha / 1000).toFixed(1)}k ha`
  return `${Math.round(ha).toLocaleString()} ha`
}
function fmtBytes(b: number | null) {
  if (!b) return '—'
  if (b >= 1e9) return `${(b / 1e9).toFixed(1)} GB`
  if (b >= 1e6) return `${(b / 1e6).toFixed(1)} MB`
  return `${(b / 1e3).toFixed(0)} KB`
}
function fmtDate(iso: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}
function fmtNum(n: number) {
  return n.toLocaleString()
}

const PIPELINE_LABELS: Record<string, string> = {
  blob_detection: 'Crown detection',
  hough_lines:    'Hough lines',
  zonal_grid:     'Zonal grid',
}

// ── Period helpers ────────────────────────────────────────────────────────────
function periodKey(iso: string, period: Period): string {
  const d = new Date(iso)
  if (period === 'day') return d.toISOString().slice(0, 10)
  if (period === 'week') {
    const tmp = new Date(d)
    tmp.setHours(0, 0, 0, 0)
    tmp.setDate(tmp.getDate() - ((tmp.getDay() + 6) % 7))
    return tmp.toISOString().slice(0, 10)
  }
  if (period === 'month') return d.toISOString().slice(0, 7)
  return String(d.getFullYear())
}

function generatePeriodKeys(period: Period): string[] {
  const keys: string[] = []
  const now = new Date()
  const counts = { day: 14, week: 12, month: 12, year: 5 }
  const count = counts[period]
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(now)
    if (period === 'day')   { d.setDate(d.getDate() - i); keys.push(d.toISOString().slice(0, 10)) }
    if (period === 'week')  { d.setDate(d.getDate() - ((d.getDay() + 6) % 7) - i * 7); keys.push(d.toISOString().slice(0, 10)) }
    if (period === 'month') { d.setMonth(d.getMonth() - i); keys.push(d.toISOString().slice(0, 7)) }
    if (period === 'year')  { d.setFullYear(d.getFullYear() - i); keys.push(String(d.getFullYear())) }
  }
  return keys
}

function formatKey(key: string, period: Period): string {
  if (period === 'day')   return key.slice(5)   // MM-DD
  if (period === 'week')  return new Date(key).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })
  if (period === 'month') { const [y, m] = key.split('-'); return new Date(Number(y), Number(m) - 1).toLocaleDateString('en-GB', { month: 'short', year: '2-digit' }) }
  return key
}

// ── Bar chart ─────────────────────────────────────────────────────────────────
function BarChart({ keys, values, color, height = 140, labelFn }:
  { keys: string[]; values: number[]; color: string; height?: number; labelFn: (v: number) => string }) {
  const max = Math.max(...values, 1)
  return (
    <div className="flex items-end gap-1" style={{ height }}>
      {keys.map((k, i) => {
        const v = values[i]
        const barH = Math.max((v / max) * (height - 30), v > 0 ? 4 : 0)
        return (
          <div key={k} className="flex-1 flex flex-col items-center justify-end gap-1 group min-w-0">
            {v > 0 && (
              <span className="text-[9px] font-medium opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap"
                style={{ color: teal }}>{labelFn(v)}</span>
            )}
            <div className="w-full rounded-t transition-all"
              style={{ height: v > 0 ? barH : 3, background: v > 0 ? color : '#F3F4F6' }} />
            <span className="text-[9px] text-gray-300 truncate w-full text-center">{k}</span>
          </div>
        )
      })}
    </div>
  )
}

// ── Stat card ─────────────────────────────────────────────────────────────────
function StatCard({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: boolean }) {
  return (
    <div className="bg-white rounded-2xl p-5 border shadow-sm" style={{ borderColor: accent ? tealXlt : '#F3F4F6' }}>
      <p className="text-xs text-gray-400 mb-2">{label}</p>
      <p className="text-2xl font-light tabular-nums" style={{ color: accent ? teal : '#1C1C1C' }}>{value}</p>
      {sub && <p className="text-xs text-gray-400 mt-1">{sub}</p>}
    </div>
  )
}

// ── Section heading ───────────────────────────────────────────────────────────
function SectionHeading({ icon, title, sub }: { icon: React.ReactNode; title: string; sub?: string }) {
  return (
    <div className="flex items-center gap-3 mb-4">
      <div className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0"
        style={{ background: tealBg }}>
        <span style={{ color: teal }}>{icon}</span>
      </div>
      <div>
        <p className="text-sm font-semibold text-gray-800">{title}</p>
        {sub && <p className="text-xs text-gray-400">{sub}</p>}
      </div>
    </div>
  )
}

// ── Period tabs ───────────────────────────────────────────────────────────────
const PERIODS: { label: string; value: Period }[] = [
  { label: 'Day',   value: 'day' },
  { label: 'Week',  value: 'week' },
  { label: 'Month', value: 'month' },
  { label: 'Year',  value: 'year' },
]

// ── Main page ─────────────────────────────────────────────────────────────────
export default function StatsPage() {
  const { user, isLoaded } = useUser()
  const [images,  setImages]  = useState<ImageRecord[]>([])
  const [vectors, setVectors] = useState<VectorRecord[]>([])
  const [jobs,    setJobs]    = useState<JobRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [period,  setPeriod]  = useState<Period>('month')

  useEffect(() => {
    if (!isLoaded || !user) return
    fetch(`${API}/stats/${user.id}/detailed`, { headers: { 'x-clerk-id': user.id } })
      .then(r => r.ok ? r.json() : { images: [], vectors: [], jobs: [] })
      .then((d: { images?: ImageRecord[]; vectors?: VectorRecord[]; jobs?: JobRecord[] }) => {
        setImages(d.images  || [])
        setVectors(d.vectors || [])
        setJobs(d.jobs      || [])
      })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [isLoaded, user])

  // ── Derived stats ──────────────────────────────────────────────────────────
  const readyImages  = images.filter(i => i.status === 'ready')
  const readyVectors = vectors.filter(v => v.status === 'ready')
  const doneJobs     = jobs.filter(j => j.status === 'done')
  const mlJobs       = doneJobs.filter(j => j.type === 'ml_inference')

  const totalImageHa   = readyImages.reduce((s, i) => s + (i.area_ha || 0), 0)
  const totalVectorHa  = readyVectors.reduce((s, v) => s + (v.area_ha || 0), 0)
  const totalImageStorage  = images.reduce((s, i) => s + (i.filesize || 0), 0)
  const totalVectorStorage = vectors.reduce((s, v) => s + (v.filesize || 0), 0)
  const totalHaProcessed = mlJobs.reduce((s, j) => s + (j.ha_processed || 0), 0)
  const jobsWithAOI = mlJobs.filter(j => j.aoi_used).length
  const jobsFullImg = mlJobs.filter(j => !j.aoi_used).length

  // By algorithm
  const byAlgorithm = useMemo(() => {
    const map: Record<string, { count: number; ha: number; aoi: number }> = {}
    for (const j of mlJobs) {
      const key = j.pipeline_type || 'unknown'
      if (!map[key]) map[key] = { count: 0, ha: 0, aoi: 0 }
      map[key].count++
      map[key].ha += j.ha_processed || 0
      if (j.aoi_used) map[key].aoi++
    }
    return map
  }, [mlJobs])

  // Period keys
  const periodKeys = generatePeriodKeys(period)
  const shortKeys  = periodKeys.map(k => formatKey(k, period))

  // Ha processed per period
  const haByPeriod = useMemo(() => {
    const map: Record<string, number> = {}
    for (const j of mlJobs) {
      if (!j.finished_at) continue
      const k = periodKey(j.finished_at, period)
      map[k] = (map[k] || 0) + (j.ha_processed || 0)
    }
    return map
  }, [mlJobs, period])

  // Images uploaded per period
  const imagesUploadedByPeriod = useMemo(() => {
    const map: Record<string, number> = {}
    for (const i of images) {
      const k = periodKey(i.created_at, period)
      map[k] = (map[k] || 0) + 1
    }
    return map
  }, [images, period])

  // Jobs done per period
  const jobsByPeriod = useMemo(() => {
    const map: Record<string, number> = {}
    for (const j of doneJobs) {
      const k = periodKey(j.finished_at || j.created_at, period)
      map[k] = (map[k] || 0) + 1
    }
    return map
  }, [doneJobs, period])

  const haValues      = periodKeys.map(k => haByPeriod[k] || 0)
  const uploadValues  = periodKeys.map(k => imagesUploadedByPeriod[k] || 0)
  const jobValues     = periodKeys.map(k => jobsByPeriod[k] || 0)

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-6 h-6 border-2 animate-spin rounded-full" style={{ borderColor: tealXlt, borderTopColor: teal }} />
      </div>
    )
  }

  if (images.length === 0 && vectors.length === 0 && jobs.length === 0) {
    return (
      <div className="w-full">
        <div className="pt-1 mb-6">
          <p className="text-xs font-medium tracking-widest uppercase mb-1" style={{ color: tealLt }}>Analytics</p>
          <h1 className="text-2xl font-semibold text-gray-900">Usage &amp; Statistics</h1>
        </div>
        <div className="bg-white rounded-2xl border-2 border-dashed px-6 py-16 text-center" style={{ borderColor: tealXlt }}>
          <div className="w-12 h-12 rounded-2xl flex items-center justify-center mx-auto mb-4" style={{ background: tealBg }}>
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill={teal} className="w-6 h-6">
              <path d="M15.5 2A1.5 1.5 0 0 0 14 3.5v13a1.5 1.5 0 0 0 3 0v-13A1.5 1.5 0 0 0 15.5 2ZM9.5 6A1.5 1.5 0 0 0 8 7.5v9a1.5 1.5 0 0 0 3 0v-9A1.5 1.5 0 0 0 9.5 6ZM3.5 10A1.5 1.5 0 0 0 2 11.5v5a1.5 1.5 0 0 0 3 0v-5A1.5 1.5 0 0 0 3.5 10Z"/>
            </svg>
          </div>
          <p className="text-sm font-medium text-gray-700 mb-1">No activity yet</p>
          <p className="text-xs text-gray-400">Upload an image or shapefile and run a model to see usage stats here.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="w-full space-y-6 pb-8">

      {/* ── Header + period filter ─────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-4 pt-1">
        <div>
          <p className="text-xs font-medium tracking-widest uppercase mb-1" style={{ color: tealLt }}>Analytics</p>
          <h1 className="text-2xl font-semibold text-gray-900">Usage & Statistics</h1>
          <p className="text-sm text-gray-400 mt-0.5">Storage, processing and activity overview</p>
        </div>
        <div className="flex gap-1 bg-gray-100 rounded-xl p-1 flex-shrink-0">
          {PERIODS.map(p => (
            <button key={p.value} onClick={() => setPeriod(p.value)}
              className="text-xs font-medium px-3 py-1.5 rounded-lg transition-colors cursor-pointer"
              style={{
                background: period === p.value ? 'white' : 'transparent',
                color: period === p.value ? teal : '#9CA3AF',
                boxShadow: period === p.value ? '0 1px 3px rgba(0,0,0,0.08)' : undefined,
              }}>
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Summary cards ─────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <StatCard label="Ha processed (AI)" value={fmtHa(totalHaProcessed)} sub="all time" accent />
        <StatCard label="Image storage" value={fmtHa(totalImageHa)} sub={`${fmtBytes(totalImageStorage)} · ${readyImages.length} files`} />
        <StatCard label="Vector storage" value={fmtHa(totalVectorHa)} sub={`${fmtBytes(totalVectorStorage)} · ${readyVectors.length} files`} />
        <StatCard label="AI jobs done" value={fmtNum(mlJobs.length)} sub={`${jobsWithAOI} with AOI · ${jobsFullImg} full img`} />
        <StatCard label="Total jobs" value={fmtNum(doneJobs.length)} sub={`${jobs.filter(j => j.status === 'failed').length} failed`} />
      </div>

      {/* ── Processing ha chart ────────────────────────────────────────── */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
        <SectionHeading
          icon={<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4"><path d="M15.5 2A1.5 1.5 0 0 0 14 3.5v13a1.5 1.5 0 0 0 3 0v-13A1.5 1.5 0 0 0 15.5 2ZM9.5 6A1.5 1.5 0 0 0 8 7.5v9a1.5 1.5 0 0 0 3 0v-9A1.5 1.5 0 0 0 9.5 6ZM3.5 10A1.5 1.5 0 0 0 2 11.5v5a1.5 1.5 0 0 0 3 0v-5A1.5 1.5 0 0 0 3.5 10Z"/></svg>}
          title="Hectares processed by AI"
          sub="Area computed from AOI if used, otherwise full image extent"
        />
        <BarChart keys={shortKeys} values={haValues} color={teal} height={160}
          labelFn={v => `${Math.round(v).toLocaleString()} ha`} />
      </div>

      {/* ── Algorithm breakdown ────────────────────────────────────────── */}
      {Object.keys(byAlgorithm).length > 0 && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
          <SectionHeading
            icon={<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4"><path d="M14 6H6v8h8V6Z"/><path fillRule="evenodd" d="M9.25 3V1.75a.75.75 0 0 1 1.5 0V3h1.5V1.75a.75.75 0 0 1 1.5 0V3h.5A2.75 2.75 0 0 1 17 5.75v.5h1.25a.75.75 0 0 1 0 1.5H17v1.5h1.25a.75.75 0 0 1 0 1.5H17v1.5h1.25a.75.75 0 0 1 0 1.5H17v.5A2.75 2.75 0 0 1 14.25 17h-.5v1.25a.75.75 0 0 1-1.5 0V17h-1.5v1.25a.75.75 0 0 1-1.5 0V17h-1.5v1.25a.75.75 0 0 1-1.5 0V17h-.5A2.75 2.75 0 0 1 3 14.25v-.5H1.75a.75.75 0 0 1 0-1.5H3v-1.5H1.75a.75.75 0 0 1 0-1.5H3v-1.5H1.75a.75.75 0 0 1 0-1.5H3v-.5A2.75 2.75 0 0 1 5.75 3h.5V1.75a.75.75 0 0 1 1.5 0V3h1.5ZM4.5 5.75c0-.69.56-1.25 1.25-1.25h8.5c.69 0 1.25.56 1.25 1.25v8.5c0 .69-.56 1.25-1.25 1.25h-8.5c-.69 0-1.25-.56-1.25-1.25v-8.5Z" clipRule="evenodd"/></svg>}
            title="Processing by algorithm"
            sub="Jobs completed · hectares processed · AOI usage"
          />
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr style={{ borderBottom: '1px solid #F3F4F6' }}>
                  <th className="text-left py-2 pr-4 text-xs font-semibold text-gray-400 uppercase tracking-wider">Algorithm</th>
                  <th className="text-right py-2 px-4 text-xs font-semibold text-gray-400 uppercase tracking-wider">Jobs</th>
                  <th className="text-right py-2 px-4 text-xs font-semibold text-gray-400 uppercase tracking-wider">Ha processed</th>
                  <th className="text-right py-2 px-4 text-xs font-semibold text-gray-400 uppercase tracking-wider">With AOI</th>
                  <th className="text-right py-2 pl-4 text-xs font-semibold text-gray-400 uppercase tracking-wider">Full image</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(byAlgorithm).map(([key, stats]) => (
                  <tr key={key} style={{ borderBottom: '1px solid #F9FAFB' }}>
                    <td className="py-3 pr-4">
                      <span className="font-medium text-gray-800">
                        {PIPELINE_LABELS[key] || key}
                      </span>
                    </td>
                    <td className="text-right py-3 px-4 tabular-nums text-gray-600">{stats.count}</td>
                    <td className="text-right py-3 px-4 tabular-nums font-medium" style={{ color: teal }}>{fmtHa(stats.ha)}</td>
                    <td className="text-right py-3 px-4 tabular-nums text-gray-500">{stats.aoi}</td>
                    <td className="text-right py-3 pl-4 tabular-nums text-gray-500">{stats.count - stats.aoi}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Images + Vectors side by side ─────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

        {/* Images */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
          <SectionHeading
            icon={<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4"><path fillRule="evenodd" d="M1 5.25A2.25 2.25 0 0 1 3.25 3h13.5A2.25 2.25 0 0 1 19 5.25v9.5A2.25 2.25 0 0 1 16.75 17H3.25A2.25 2.25 0 0 1 1 14.75v-9.5Zm1.5 5.81v3.69c0 .414.336.75.75.75h13.5a.75.75 0 0 0 .75-.75v-2.69l-2.22-2.219a.75.75 0 0 0-1.06 0l-1.91 1.909.47.47a.75.75 0 1 1-1.06 1.06L6.53 8.091a.75.75 0 0 0-1.06 0l-2.97 2.97ZM12 7a1 1 0 1 1-2 0 1 1 0 0 1 2 0Z" clipRule="evenodd"/></svg>}
            title="Images"
            sub={`${readyImages.length} ready · ${fmtHa(totalImageHa)} · ${fmtBytes(totalImageStorage)}`}
          />
          {/* Uploads per period mini chart */}
          <div className="mb-4">
            <p className="text-xs text-gray-400 mb-2">Uploads per {period}</p>
            <BarChart keys={shortKeys} values={uploadValues} color={tealXlt} height={80} labelFn={v => `${v}`} />
          </div>
          {/* List */}
          <div className="space-y-0 max-h-64 overflow-y-auto">
            {readyImages.length === 0 ? (
              <p className="text-xs text-gray-400 text-center py-4">No images yet</p>
            ) : readyImages.map(img => (
              <div key={img.id} className="flex items-center justify-between py-2.5"
                style={{ borderBottom: '1px solid #F9FAFB' }}>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium text-gray-800 truncate">{img.filename}</p>
                  <p className="text-[10px] text-gray-400">{fmtDate(img.created_at)} · EPSG:{img.epsg || '?'} · {img.num_bands ?? '?'} bands</p>
                </div>
                <div className="text-right flex-shrink-0 ml-3">
                  <p className="text-xs font-semibold tabular-nums" style={{ color: teal }}>{fmtHa(img.area_ha)}</p>
                  <p className="text-[10px] text-gray-400">{fmtBytes(img.filesize)}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Vectors */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
          <SectionHeading
            icon={<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4"><path fillRule="evenodd" d="M8.157 2.176a1.5 1.5 0 0 0-1.147 0l-4.084 1.69A1.5 1.5 0 0 0 2 5.25v10.877a1.5 1.5 0 0 0 2.074 1.386l3.51-1.452 4.26 1.762a1.5 1.5 0 0 0 1.146 0l4.083-1.69A1.5 1.5 0 0 0 18 14.75V3.872a1.5 1.5 0 0 0-2.073-1.386l-3.51 1.452-4.26-1.762ZM7.5 5v11.25L5 17.5V5.75l2.5-1.034V5Zm2.5 11.25V5L12.5 3.75v11.25L10 16.25Zm2.5.5v-11.5l2.5-1.034V14.25l-2.5 1.034v-.5.466Z" clipRule="evenodd"/></svg>}
            title="Vectors"
            sub={`${readyVectors.length} ready · ${fmtHa(totalVectorHa)} · ${fmtBytes(totalVectorStorage)}`}
          />
          {/* Jobs per period mini chart */}
          <div className="mb-4">
            <p className="text-xs text-gray-400 mb-2">AI jobs per {period}</p>
            <BarChart keys={shortKeys} values={jobValues} color={teal} height={80} labelFn={v => `${v}`} />
          </div>
          {/* List */}
          <div className="space-y-0 max-h-64 overflow-y-auto">
            {readyVectors.length === 0 ? (
              <p className="text-xs text-gray-400 text-center py-4">No vectors yet</p>
            ) : readyVectors.map(vec => (
              <div key={vec.id} className="flex items-center justify-between py-2.5"
                style={{ borderBottom: '1px solid #F9FAFB' }}>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium text-gray-800 truncate">{vec.filename}</p>
                  <p className="text-[10px] text-gray-400">{fmtDate(vec.created_at)} · {vec.geometry_type || 'vector'}</p>
                </div>
                <div className="text-right flex-shrink-0 ml-3">
                  <p className="text-xs font-semibold tabular-nums" style={{ color: teal }}>{fmtHa(vec.area_ha)}</p>
                  <p className="text-[10px] text-gray-400">{fmtBytes(vec.filesize)}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Recent AI jobs ─────────────────────────────────────────────── */}
      {mlJobs.length > 0 && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
          <SectionHeading
            icon={<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4"><path fillRule="evenodd" d="M15.988 3.012A2.25 2.25 0 0 1 18 5.25v6.5A2.25 2.25 0 0 1 15.75 14H13.5V7A2.5 2.5 0 0 0 11 4.5H8.128a2.252 2.252 0 0 1 1.884-1.488A2.25 2.25 0 0 1 12.25 1h1.5a2.25 2.25 0 0 1 2.238 2.012ZM11.5 3.25a.75.75 0 0 1 .75-.75h1.5a.75.75 0 0 1 .75.75v.25h-3v-.25Z" clipRule="evenodd"/><path fillRule="evenodd" d="M2 7a1 1 0 0 1 1-1h8a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V7Zm2 3.25a.75.75 0 0 1 .75-.75h4.5a.75.75 0 0 1 0 1.5h-4.5a.75.75 0 0 1-.75-.75Zm0 3.5a.75.75 0 0 1 .75-.75h4.5a.75.75 0 0 1 0 1.5h-4.5a.75.75 0 0 1-.75-.75Z" clipRule="evenodd"/></svg>}
            title="Recent AI jobs"
            sub="Completed inference runs with area computed"
          />
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr style={{ borderBottom: '1px solid #F3F4F6' }}>
                  <th className="text-left py-2 pr-4 text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Algorithm</th>
                  <th className="text-left py-2 pr-4 text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Image</th>
                  <th className="text-left py-2 pr-4 text-[10px] font-semibold text-gray-400 uppercase tracking-wider">AOI</th>
                  <th className="text-right py-2 pr-4 text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Ha processed</th>
                  <th className="text-right py-2 text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Date</th>
                </tr>
              </thead>
              <tbody>
                {mlJobs.slice(0, 20).map(j => (
                  <tr key={j.id} style={{ borderBottom: '1px solid #F9FAFB' }}>
                    <td className="py-2.5 pr-4 font-medium text-gray-700">
                      {PIPELINE_LABELS[j.pipeline_type || ''] || j.pipeline_type || '—'}
                    </td>
                    <td className="py-2.5 pr-4 text-gray-500 max-w-[160px] truncate">
                      {j.image_filename || '—'}
                    </td>
                    <td className="py-2.5 pr-4">
                      {j.aoi_used ? (
                        <span className="px-1.5 py-0.5 rounded text-[9px] font-semibold" style={{ background: tealBg, color: teal }}>
                          {j.vector_filename ? j.vector_filename.split('.')[0] : 'AOI'}
                        </span>
                      ) : (
                        <span className="text-gray-400">Full image</span>
                      )}
                    </td>
                    <td className="py-2.5 pr-4 text-right tabular-nums font-semibold" style={{ color: teal }}>
                      {fmtHa(j.ha_processed)}
                    </td>
                    <td className="py-2.5 text-right text-gray-400">
                      {fmtDate(j.finished_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Usage note ──────────────────────────────────────────────────── */}
      <div className="rounded-2xl border border-dashed px-6 py-4" style={{ background: tealBg, borderColor: tealXlt }}>
        <p className="text-xs font-semibold mb-1" style={{ color: teal }}>About usage tracking</p>
        <p className="text-xs text-gray-500">
          Hectares processed are computed from the AOI polygon area when a shape is used, or the full image extent otherwise.
          Storage totals reflect uploaded file sizes. Plan limits and tier quotas will be displayed here once configured.
        </p>
      </div>

    </div>
  )
}
