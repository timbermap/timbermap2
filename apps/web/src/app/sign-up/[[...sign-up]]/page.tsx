import { SignUp } from '@clerk/nextjs'
import Link from 'next/link'

// Not a page anyone navigates to directly — the real sign-up form lives
// embedded in the Landing hero. This route exists purely as the OAuth
// callback anchor: <SignUp path="/sign-up" routing="path"> (here and in
// the embedded copy) needs a real path-routed page to bounce a Google/
// GitHub sign-up through before continuing to forceRedirectUrl. Without
// it, the OAuth flow fell back to detouring through /sign-in instead,
// which then wrongly showed "Sign in to Timbermap" mid-signup.
export default function SignUpPage() {
  return (
    <div className="min-h-screen bg-[#F7F8F6] flex">
      <div className="hidden lg:flex w-1/2 bg-[#2C5F45] flex-col justify-between p-12">
        <Link href="/" className="text-white font-semibold text-xl tracking-wide">
          Timbermap
        </Link>
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
            path="/sign-up"
            routing="path"
            forceRedirectUrl="/dashboard"
            appearance={{
              elements: {
                rootBox: 'w-full',
                card: 'shadow-none bg-transparent p-0',
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
