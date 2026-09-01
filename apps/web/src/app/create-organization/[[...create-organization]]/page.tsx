import { CreateOrganization } from '@clerk/nextjs'
import Link from 'next/link'

export default function CreateOrganizationPage() {
  return (
    <div className="min-h-screen bg-[#F7F8F6] flex">

      {/* Left panel */}
      <div className="hidden lg:flex w-1/2 bg-[#2C5F45] flex-col justify-between p-12">
        <Link href="/" className="text-white font-semibold text-xl tracking-wide">
          Timbermap
        </Link>
        <div>
          <p className="text-white/40 text-xs tracking-widest uppercase mb-4">Working with a team</p>
          <h2 className="text-white text-3xl font-light leading-tight mb-6" style={{letterSpacing: '-0.02em'}}>
            Bring your team<br />into one account
          </h2>
          <p className="text-white/50 text-sm font-light leading-relaxed max-w-sm">
            Invite the people who process imagery with you. Everyone keeps their
            own uploads and results — storage and model access are just shared
            across the team.
          </p>
        </div>
        <p className="text-white/20 text-xs">© 2026 Timbermap</p>
      </div>

      {/* Right panel */}
      <div className="flex-1 flex flex-col items-center justify-center p-8">
        <div className="w-full max-w-sm">
          <div className="mb-8 lg:hidden">
            <Link href="/" className="font-semibold text-[#2C5F45] text-lg tracking-wide">
              Timbermap
            </Link>
          </div>

          <h1 className="text-xl font-medium text-[#1C1C1C] mb-2">Set up your organization</h1>
          <p className="text-sm text-gray-400 font-light leading-relaxed mb-6">
            An organization is only for teams — it lets you invite teammates and
            put everyone on one shared plan. You don&apos;t need one to use
            Timbermap on your own.
          </p>

          <CreateOrganization
            path="/create-organization"
            routing="path"
            afterCreateOrganizationUrl="/dashboard"
            appearance={{
              elements: {
                rootBox: 'w-full',
                card: 'shadow-none bg-transparent p-0',
                headerTitle: 'hidden',
                headerSubtitle: 'hidden',
                formButtonPrimary: 'bg-[#2C5F45] hover:bg-[#3D7A5A] text-white',
                footerActionLink: 'text-[#2C5F45] hover:text-[#3D7A5A]',
              }
            }}
          />

          <Link href="/dashboard" className="block text-center text-sm text-gray-400 hover:text-[#2C5F45] mt-6 transition-colors">
            Skip — I&apos;ll work on my own →
          </Link>
        </div>
      </div>

    </div>
  )
}
