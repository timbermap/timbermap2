import { auth, currentUser } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'

const actions = [
  { label: 'Upload a raster image', href: '/dashboard/images' },
  { label: 'Upload a shapefile', href: '/dashboard/vectors' },
  { label: 'Run a model', href: '/dashboard/models' },
]

const stats = [
  { label: 'Images', value: 0, sub: 'rasters uploaded' },
  { label: 'Vectors', value: 0, sub: 'shapefiles uploaded' },
  { label: 'Jobs', value: 0, sub: 'processes run' },
  { label: 'Models', value: 0, sub: 'available to you' },
]

export default async function Dashboard() {
  const { userId } = await auth()
  if (!userId) redirect('/sign-in')

  const user = await currentUser()
  const name = user?.firstName || user?.emailAddresses[0]?.emailAddress

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
          <p className="text-sm text-gray-300">No jobs run yet.</p>
        </div>
        <div className="bg-white rounded-xl p-6 border border-gray-100 shadow-sm">
          <p className="text-xs font-medium tracking-widest uppercase text-gray-400 mb-4">Quick actions</p>
          <div className="space-y-3">
            {actions.map(action => {
              return (
                <a key={action.href} href={action.href} className="flex items-center justify-between group py-1">
                  <span className="text-sm text-gray-600 group-hover:text-[#2C5F45] transition-colors">{action.label}</span>
                  <span className="text-sm transition-transform group-hover:translate-x-1" style={{color:'#5A9E7C'}}>→</span>
                </a>
              )
            })}
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
