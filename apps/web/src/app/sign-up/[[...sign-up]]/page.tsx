import { SignUp } from '@clerk/nextjs'

// Not a page anyone navigates to directly — the real sign-up entry point is
// the "Get started" modal on the Landing page. This route exists purely as
// the OAuth callback anchor: <SignUp path="/sign-up" routing="path"> needs a
// real path-routed page to bounce a Google/GitHub sign-up through before
// continuing to forceRedirectUrl. Without it, the OAuth flow fell back to
// detouring through /sign-in instead, wrongly showing "Sign in to Timbermap"
// mid-signup. Since real users only ever pass through here for a split
// second, it shows a branded "creating your account" loader instead of the
// form itself — the actual <SignUp> is still mounted (visually hidden) so it
// can process the callback and fire the redirect to /dashboard.
export default function SignUpPage() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-[#14231C] px-6 text-center">
      <svg width="150" height="36" viewBox="0 0 300 72" fill="none" xmlns="http://www.w3.org/2000/svg" className="mb-14">
        <circle cx="20" cy="20" r="20" fill="#6AA8A0"/>
        <circle cx="44" cy="20" r="16" fill="#3D7A72"/>
        <circle cx="30" cy="40" r="13" fill="#A0CECC"/>
        <text x="68" y="28" fontFamily="'Plus Jakarta Sans',system-ui,sans-serif" fontSize="26" fontWeight="700" letterSpacing="2" fill="#F0F7F6">TIMBERMAP</text>
        <text x="68" y="46" fontFamily="'Plus Jakarta Sans',system-ui,sans-serif" fontSize="12" fontWeight="400" fill="#6AA8A0">Powered by Forestech Uy</text>
      </svg>

      <span className="tm-spinner" aria-hidden="true" />
      <p className="mt-7 text-[#F0F7F6] text-lg font-light tracking-wide">Creating your account…</p>
      <p className="mt-2 text-[#6AA8A0] text-sm">Just a moment while we set up your workspace.</p>

      {/* Visually hidden — still mounted so Clerk can process the OAuth
          callback and fire forceRedirectUrl. */}
      <div className="absolute w-px h-px overflow-hidden opacity-0 pointer-events-none" aria-hidden="true">
        <SignUp path="/sign-up" routing="path" forceRedirectUrl="/dashboard" />
      </div>

      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@300;400;500;600;700&display=swap');
        .tm-spinner {
          width: 34px; height: 34px; border-radius: 50%;
          border: 2.5px solid rgba(160,206,204,0.18);
          border-top-color: #6AA8A0;
          animation: tm-spin 0.8s linear infinite;
        }
        @keyframes tm-spin { to { transform: rotate(360deg); } }
        @media (prefers-reduced-motion: reduce) {
          .tm-spinner { animation-duration: 2.4s; }
        }
      `}</style>
    </div>
  )
}
