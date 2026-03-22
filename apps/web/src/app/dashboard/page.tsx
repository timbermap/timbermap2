import { auth, currentUser } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'

const actions = [
  { label: 'Upload a raster image', href: '/dashboard/images' },
  { label: 'Upload a shapefile', href: '/dashboard/vectors' },
  { label: 'Run a model', href: '/dashboard/models' },
]

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

function formatDate(iso: string) {
  return new Date(iso).toLocaleString()
}

const API = process.env.NEXT_PUBLIC_API_URL || 'https://timbermap-api-788407107542.us-central1.run.app'

export default async function Dashboard() {
  const { userId } = await auth()
  if (!userId) redirect('/sign-in')

  const user = await currentUser()
  const name = user?.firstName || user?.emailAddresses[0]?.emailAddress

  // Fetch stats and recent jobs in parallel
  const [statsRes, jobsRes] = await Promise.all([
    fetch(`${API}/stats/${userId}`, { cache: 'no-store' }).catch(() => null),
    fetch(`${API}/jobs/${userId}`, { cache: 'no-store' }).catch(() => null),
  ])

  const statsData = statsRes?.ok ? await statsRes.json() : null
  const jobsData  = jobsRes?.ok  ? await jobsRes.json()  : null

  const stats = [
    { label: 'Images',  value: statsData?.images  ?? 0, sub: 'rasters uploaded' },
    { label: 'Vectors', value: statsData?.vectors  ?? 0, sub: 'shapefiles uploaded' },
    { label: 'Jobs',    value: statsData?.jobs     ?? 0, sub: 'processes run' },
    { label: 'Models',  value: statsData?.models   ?? 0, sub: 'available to you' },
  ]

  const recentJobs = (jobsData?.jobs ?? []).slice(0, 5)

  return (
    <div className="max-w-6xl">
      <div className="mb-8 pt-2">
        <p className="text-xs font-medium tracking-widest uppercase mb-2" style={{color:'#5A9E7C'}}>
          Overview
        </p>
        <h1 className="text-3xl font-semibold" style={{color:'#1C1C1C'}}>
          Welcome back, {name}
        </h1>
        <p className="text-gray-400 mt-1.5 text-sm font-light">
          Here is what is happening with your data today.
        </p>
      </div>

      <div className="grid grid-cols-4 gap-3 mb-6">
        {stats.map(s => (
          <div key={s.label} className="bg-white rounded-xl p-5 border border-gray-100 shadow-sm hover:shadow-md transition-shadow">
            <p className="text-xs font-medium tracking-widest uppercase text-gray-400 mb-3">{s.label}</p>
            <p className="text-4xl font-light" style={{color:'#2C5F45'}}>{s.value}</p>
            <p className="text-xs text-gray-300 mt-1.5">{s.sub}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-4 mb-4">
        <div className="bg-white rounded-xl p-6 border border-gray-100 shadow-sm">
          <p className="text-xs font-medium tracking-widest uppercase text-gray-400 mb-4">Recent jobs</p>
          {recentJobs.length === 0 ? (
            <p className="text-sm text-gray-300">No jobs run yet.</p>
          ) : (
            <div className="space-y-3">
              {recentJobs.map((job: {
                id: string
                type: string
                status: string
                created_at: string
                input_ref: Record<string, unknown> | null
              }) => (
                <div key={job.id} className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-gray-700">{typeLabel[job.type] || job.type}</p>
                    <p className="text-xs text-gray-400">{formatDate(job.created_at)}</p>
                  </div>
                  <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${statusColor[job.status] || 'bg-gray-50 text-gray-500'}`}>
                    {job.status}
                  </span>
                </div>
              ))}
              <a href="/dashboard/jobs" className="text-xs text-[#2C5F45] hover:underline block pt-1">
                View all jobs →
              </a>
            </div>
          )}
        </div>

        <div className="bg-white rounded-xl p-6 border border-gray-100 shadow-sm">
          <p className="text-xs font-medium tracking-widest uppercase text-gray-400 mb-4">Quick actions</p>
          <div className="space-y-3">
            {actions.map(action => (
              <a key={action.href} href={action.href} className="flex items-center justify-between group py-1">
                <span className="text-sm text-gray-600 group-hover:text-[#2C5F45] transition-colors">{action.label}</span>
                <span className="text-sm transition-transform group-hover:translate-x-1" style={{color:'#5A9E7C'}}>→</span>
              </a>
            ))}
          </div>
        </div>
      </div>

      <div className="rounded-xl p-7 text-white" style={{background:'linear-gradient(135deg, #2C5F45 0%, #3D7A5A 100%)'}}>
        <p className="text-xs font-medium tracking-widest uppercase text-white/50 mb-2">Getting started</p>
        <p className="text-lg font-light mb-5">
          Start by uploading your first raster image or shapefile.
        </p>
        <div className="flex gap-3">
          <a href="/dashboard/images" className="bg-white text-[#2C5F45] px-5 py-2.5 text-sm font-medium rounded-lg hover:bg-white/95 transition-colors">
            Upload image
          </a>
          <a href="/dashboard/vectors" className="border border-white/30 text-white px-5 py-2.5 text-sm font-light rounded-lg hover:bg-white/10 transition-colors">
            Upload shapefile
          </a>
        </div>
      </div>
    </div>
  )
}
