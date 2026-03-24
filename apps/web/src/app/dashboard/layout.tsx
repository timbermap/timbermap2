import Sidebar from '@/components/Sidebar'

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="min-h-screen bg-[#F8F8F6]">
      <Sidebar />
      <main className="ml-60 p-10">
        {children}
      </main>
    </div>
  )
}
