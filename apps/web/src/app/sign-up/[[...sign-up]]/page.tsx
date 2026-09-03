'use client'
import { SignUp, ClerkLoading, ClerkLoaded } from '@clerk/nextjs'
import Link from 'next/link'

export default function SignUpPage() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-[#14231C] px-6 py-16">
      <Link href="/" className="mb-10">
        <svg width="150" height="36" viewBox="0 0 300 72" fill="none" xmlns="http://www.w3.org/2000/svg">
          <circle cx="20" cy="20" r="20" fill="#6AA8A0"/>
          <circle cx="44" cy="20" r="16" fill="#3D7A72"/>
          <circle cx="30" cy="40" r="13" fill="#A0CECC"/>
          <text x="68" y="28" fontFamily="'Plus Jakarta Sans',system-ui,sans-serif" fontSize="26" fontWeight="700" letterSpacing="2" fill="#F0F7F6">TIMBERMAP</text>
          <text x="68" y="46" fontFamily="'Plus Jakarta Sans',system-ui,sans-serif" fontSize="12" fontWeight="400" fill="#6AA8A0">Powered by Forestech Uy</text>
        </svg>
      </Link>

      <ClerkLoading>
        <div className="flex flex-col items-center gap-4 py-10">
          <span className="w-8 h-8 border-2 border-[#3D7A72] border-t-transparent rounded-full animate-spin"/>
          <p className="text-[#A0CECC] text-sm font-medium">Creating account…</p>
        </div>
      </ClerkLoading>

      <ClerkLoaded>
        <SignUp
          path="/sign-up"
          routing="path"
          forceRedirectUrl="/dashboard"
          appearance={{
            elements: {
              rootBox: 'w-full max-w-sm',
              card: 'shadow-2xl border-0 rounded-2xl w-full',
              formButtonPrimary: 'bg-[#2C5F45] hover:bg-[#3D7A5A] text-white text-sm',
              footerActionLink: 'text-[#3D7A72] hover:text-[#2A5750]',
              formFieldInput: 'focus:border-[#6AA8A0] focus:ring-[#6AA8A0]',
            }
          }}
        />
      </ClerkLoaded>

      <Link href="/" className="mt-6 text-sm text-[#6AA8A0] hover:text-[#A0CECC] transition-colors">
        ← Back to timbermap.com
      </Link>

      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@300;400;500;600;700&display=swap');
      `}</style>
    </div>
  )
}
