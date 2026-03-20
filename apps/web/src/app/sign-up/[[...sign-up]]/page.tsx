import { SignUp } from '@clerk/nextjs'
import Link from 'next/link'

export default function SignUpPage() {
  return (
    <div className="min-h-screen bg-[#F7F8F6] flex">
      <div className="hidden lg:flex w-1/2 bg-[#2C5F45] flex-col justify-between p-12">
        <Link href="/" className="text-white font-semibold text-xl tracking-wide">
          Timbermap
        </Link>
        <div>
          <p className="text-white/40 text-xs tracking-widest uppercase mb-4">Get started</p>
          <h2 className="text-white text-3xl font-light leading-tight mb-6" style={{letterSpacing: '-0.02em'}}>
            Create your account<br />and start analyzing
          </h2>
          <p className="text-white/50 text-sm font-light leading-relaxed max-w-sm">
            Upload your first raster or shapefile and see the power of 
            geospatial AI on your own data.
          </p>
        </div>
        <p className="text-white/20 text-xs">© 2026 Timbermap</p>
      </div>
      <div className="flex-1 flex flex-col items-center justify-center p-8">
        <div className="w-full max-w-sm">
          <div className="mb-8 lg:hidden">
            <Link href="/" className="font-semibold text-[#2C5F45] text-lg tracking-wide">
              Timbermap
            </Link>
          </div>
          <SignUp
            appearance={{
              elements: {
                rootBox: 'w-full',
                card: 'shadow-none bg-transparent p-0',
                headerTitle: 'text-2xl font-light text-[#1C1C1C]',
                headerSubtitle: 'text-gray-400 font-light',
                formButtonPrimary: 'bg-[#2C5F45] hover:bg-[#3D7A5A] text-white',
                footerActionLink: 'text-[#2C5F45] hover:text-[#3D7A5A]',
              }
            }}
          />
        </div>
      </div>
    </div>
  )
}
