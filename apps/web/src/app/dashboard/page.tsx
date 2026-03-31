import { auth, currentUser } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'

const actions = [
  {
    label: 'Upload a raster image',
    href: '/dashboard/images',
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
        <path d="M9.25 13.25a.75.75 0 0 0 1.5 0V4.636l2.955 3.129a.75.75 0 0 0 1.09-1.03l-4.25-4.5a.75.75 0 0 0-1.09 0l-4.25 4.5a.75.75 0 1 0 1.09 1.03L9.25 4.636v8.614Z"/>
        <path d="M3.5 12.75a.75.75 0 0 0-1.5 0v2.5A2.75 2.75 0 0 0 4.75 18h10.5A2.75 2.75 0 0 0 18 15.25v-2.5a.75.75 0 0 0-1.5 0v2.5c0 .69-.56 1.25-1.25 1.25H4.75c-.69 0-1.25-.56-1.25-1.25v-2.5Z"/>
      </svg>
    ),
    color: 'bg-blue-50 text-blue-600',
  },
  {
    label: 'Upload a shapefile',
    href: '/dashboard/vectors',
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
        <path fillRule="evenodd" d="M8.157 2.176a1.5 1.5 0 0 0-1.147 0l-4.084 1.69A1.5 1.5 0 0 0 2 5.25v10.877a1.5 1.5 0 0 0 2.074 1.386l3.51-1.452 4.26 1.762a1.5 1.5 0 0 0 1.146 0l4.083-1.69A1.5 1.5 0 0 0 18 14.75V3.872a1.5 1.5 0 0 0-2.073-1.386l-3.51 1.452-4.26-1.762ZM7.5 5v11.25L5 17.5V5.75l2.5-1.034V5Zm2.5 11.25V5L12.5 3.75v11.25L10 16.25Zm2.5.5v-11.5l2.5-1.034V14.25l-2.5 1.034v-.5.466Z" clipRule="evenodd"/>
      </svg>
    ),
    color: 'bg-amber-50 text-amber-600',
  },
  {
    label: 'Run an AI model',
    href: '/dashboard/models',
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
        <path d="M6.3 2.84A1.5 1.5 0 0 0 4 4.11v11.78a1.5 1.5 0 0 0 2.3 1.27l9.344-5.891a1.5 1.5 0 0 0 0-2.538L6.3 2.841Z"/>
      </svg>
    ),
    color: 'bg-[#EEF7F6] text-[#3D7A72]',
  },
  {
    label: 'View results on map',
    href: '/dashboard/map',
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
        <path fillRule="evenodd" d="m9.69 18.933.003.001C9.89 19.02 10 19 10 19s.11.02.308-.066l.002-.001.006-.003.018-.008a5.741 5.741 0 0 0 .281-.14c.186-.096.446-.24.757-.433.62-.384 1.445-.966 2.274-1.765C15.302 14.988 17 12.493 17 9A7 7 0 1 0 3 9c0 3.492 1.698 5.988 3.355 7.584a13.731 13.731 0 0 0 2.273 1.765 11.842 11.842 0 0 0 .788.472l.018.008.006.003ZM10 11.25a2.25 2.25 0 1 0 0-4.5 2.25 2.25 0 0 0 0 4.5Z" clipRule="evenodd"/>
      </svg>
    ),
    color: 'bg-purple-50 text-purple-600',
  },
]

const statusColor: Record<string, string> = {
  queued:  'bg-gray-100 text-gray-500',
  running: 'bg-blue-50 text-blue-600',
  done:    'bg-[#EEF7F6] text-[#3D7A72]',
  failed:  'bg-red-50 text-red-500',
}

const typeLabel: Record<string, string> = {
  raster_ingest:    'Raster ingest',
  vector_ingest:    'Vector ingest',
  raster_transform: 'Image transform',
  vector_transform: 'Vector transform',
  ml_inference:     'Running AI',
  model_run:        'Running AI',
  delete:           'Delete',
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleString('en-GB', {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit'
  })
}

const API = process.env.NEXT_PUBLIC_API_URL || 'https://timbermap-api-788407107542.us-central1.run.app'

export default async function Dashboard() {
  const { userId } = await auth()
  if (!userId) redirect('/sign-in')

  const user = await currentUser()
  const name = user?.firstName || user?.emailAddresses[0]?.emailAddress?.split('@')[0]

  const [statsRes, jobsRes] = await Promise.all([
    fetch(`${API}/stats/${userId}`, { cache: 'no-store' }).catch(() => null),
    fetch(`${API}/jobs/${userId}`, { cache: 'no-store' }).catch(() => null),
  ])

  const statsData = statsRes?.ok ? await statsRes.json() : null
  const jobsData  = jobsRes?.ok  ? await jobsRes.json()  : null

  const stats = [
    { label: 'Images',  value: statsData?.images  ?? 0, href: '/dashboard/images',  icon: <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4"><path fillRule="evenodd" d="M1 5.25A2.25 2.25 0 0 1 3.25 3h13.5A2.25 2.25 0 0 1 19 5.25v9.5A2.25 2.25 0 0 1 16.75 17H3.25A2.25 2.25 0 0 1 1 14.75v-9.5Zm1.5 5.81v3.69c0 .414.336.75.75.75h13.5a.75.75 0 0 0 .75-.75v-2.69l-2.22-2.219a.75.75 0 0 0-1.06 0l-1.91 1.909.47.47a.75.75 0 1 1-1.06 1.06L6.53 8.091a.75.75 0 0 0-1.06 0l-2.97 2.97ZM12 7a1 1 0 1 1-2 0 1 1 0 0 1 2 0Z" clipRule="evenodd"/></svg> },
    { label: 'Vectors', value: statsData?.vectors ?? 0, href: '/dashboard/vectors', icon: <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4"><path fillRule="evenodd" d="M8.157 2.176a1.5 1.5 0 0 0-1.147 0l-4.084 1.69A1.5 1.5 0 0 0 2 5.25v10.877a1.5 1.5 0 0 0 2.074 1.386l3.51-1.452 4.26 1.762a1.5 1.5 0 0 0 1.146 0l4.083-1.69A1.5 1.5 0 0 0 18 14.75V3.872a1.5 1.5 0 0 0-2.073-1.386l-3.51 1.452-4.26-1.762ZM7.5 5v11.25L5 17.5V5.75l2.5-1.034V5Zm2.5 11.25V5L12.5 3.75v11.25L10 16.25Zm2.5.5v-11.5l2.5-1.034V14.25l-2.5 1.034v-.5.466Z" clipRule="evenodd"/></svg> },
    { label: 'Jobs',    value: statsData?.jobs    ?? 0, href: '/dashboard/jobs',    icon: <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4"><path fillRule="evenodd" d="M2 7a1 1 0 0 1 1-1h8a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V7Zm2 3.25a.75.75 0 0 1 .75-.75h4.5a.75.75 0 0 1 0 1.5h-4.5a.75.75 0 0 1-.75-.75Zm0 3.5a.75.75 0 0 1 .75-.75h4.5a.75.75 0 0 1 0 1.5h-4.5a.75.75 0 0 1-.75-.75Z" clipRule="evenodd"/></svg> },
    { label: 'Models',  value: statsData?.models  ?? 0, href: '/dashboard/models',  icon: <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4"><path d="M6.3 2.84A1.5 1.5 0 0 0 4 4.11v11.78a1.5 1.5 0 0 0 2.3 1.27l9.344-5.891a1.5 1.5 0 0 0 0-2.538L6.3 2.841Z"/></svg> },
  ]

  const recentJobs = (jobsData?.jobs ?? []).slice(0, 5)

  return (
    <div className="w-full">
      <div className="mb-8 pt-1">
        <p className="text-xs font-medium tracking-widest uppercase text-[#6AA8A0] mb-1">Overview</p>
        <h1 className="text-2xl font-semibold text-[#1C1C1C]">Welcome back, {name}</h1>
        <p className="text-gray-400 mt-1 text-sm">Here&apos;s what&apos;s happening with your data.</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        {stats.map(s => (
          <a key={s.label} href={s.href}
            className="bg-white rounded-2xl p-5 border border-gray-100 shadow-sm hover:shadow-md hover:border-[#A0CECC] transition-all group">
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs font-medium tracking-widest uppercase text-gray-400">{s.label}</p>
              <span className="text-[#6AA8A0] opacity-50 group-hover:opacity-100 transition-opacity">{s.icon}</span>
            </div>
            <p className="text-3xl font-light text-[#3D7A72] tabular-nums">{s.value}</p>
          </a>
        ))}
      </div>

      {/* Content grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 xl:grid-cols-5 gap-4 mb-4">
        {/* Recent jobs */}
        <div className="lg:col-span-2 xl:col-span-3 bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
          <div className="flex items-center justify-between mb-5">
            <p className="text-xs font-medium tracking-widest uppercase text-gray-400">Recent jobs</p>
            <a href="/dashboard/jobs" className="text-xs text-[#6AA8A0] hover:text-[#3D7A72] transition-colors">View all →</a>
          </div>
          {recentJobs.length === 0 ? (
            <div className="py-8 text-center">
              <p className="text-sm text-gray-300">No jobs yet</p>
              <p className="text-xs text-gray-200 mt-1">Jobs appear after uploading or running a model</p>
            </div>
          ) : (
            <div className="space-y-3">
              {recentJobs.map((job: {
                id: string; type: string; status: string
                created_at: string; model_name?: string; image_filename?: string
              }) => (
                <div key={job.id} className="flex items-center justify-between py-2 border-b border-gray-50 last:border-0">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-gray-700 font-medium truncate">
                      {job.model_name || typeLabel[job.type] || job.type}
                    </p>
                    {job.image_filename && <p className="text-xs text-gray-400 truncate">{job.image_filename}</p>}
                    <p className="text-xs text-gray-300">{formatDate(job.created_at)}</p>
                  </div>
                  <span className={`flex-shrink-0 ml-3 text-xs px-2.5 py-1 rounded-full font-medium ${statusColor[job.status] || 'bg-gray-50 text-gray-400'}`}>
                    {job.status}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Quick actions */}
        <div className="lg:col-span-1 xl:col-span-2 bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
          <p className="text-xs font-medium tracking-widest uppercase text-gray-400 mb-4">Quick actions</p>
          <div className="space-y-2">
            {actions.map(action => (
              <a key={action.href} href={action.href}
                className="flex items-center gap-3 px-3 py-3 rounded-xl hover:bg-[#EEF7F6] group transition-colors">
                <span className={`w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 ${action.color} group-hover:scale-105 transition-transform`}>
                  {action.icon}
                </span>
                <span className="text-sm text-gray-600 group-hover:text-[#3D7A72] transition-colors flex-1 leading-tight">
                  {action.label}
                </span>
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor"
                  className="w-3.5 h-3.5 text-gray-300 group-hover:text-[#6AA8A0] group-hover:translate-x-0.5 transition-all flex-shrink-0">
                  <path fillRule="evenodd" d="M3 10a.75.75 0 0 1 .75-.75h10.638L10.23 5.29a.75.75 0 1 1 1.04-1.08l5.5 5.25a.75.75 0 0 1 0 1.08l-5.5 5.25a.75.75 0 1 1-1.04-1.08l4.158-3.96H3.75A.75.75 0 0 1 3 10Z" clipRule="evenodd"/>
                </svg>
              </a>
            ))}
          </div>
        </div>
      </div>

      {/* Getting started */}
      <div className="rounded-2xl p-6 bg-[#EEF7F6] border border-[#A0CECC]">
        <p className="text-xs font-medium tracking-widest uppercase text-[#6AA8A0] mb-2">Getting started</p>
        <p className="text-sm text-[#3D7A72] font-medium mb-4">
          Upload imagery and run AI models to detect trees, tillage lines, and plantation faults.
        </p>
        <div className="flex flex-wrap gap-2">
          <a href="/dashboard/images" className="bg-[#3D7A72] text-white px-4 py-2 text-xs font-medium rounded-xl hover:bg-[#2A5750] transition-colors shadow-sm">Upload image</a>
          <a href="/dashboard/models" className="border border-[#A0CECC] text-[#3D7A72] px-4 py-2 text-xs font-medium rounded-xl hover:bg-[#A0CECC]/30 transition-colors">Browse models</a>
          <a href="/dashboard/map" className="border border-[#A0CECC] text-[#3D7A72] px-4 py-2 text-xs font-medium rounded-xl hover:bg-[#A0CECC]/30 transition-colors">Open map</a>
        </div>
      </div>
    </div>
  )
}
