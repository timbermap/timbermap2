import type { Metadata } from 'next'
import { ClerkProvider } from '@clerk/nextjs'
import { Plus_Jakarta_Sans } from 'next/font/google'
import './globals.css'

const jakarta = Plus_Jakarta_Sans({
  subsets: ['latin'],
  variable: '--font-jakarta',
  weight: ['300', '400', '500', '600', '700', '800'],
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'Timbermap — Precision Forestry AI',
  description: 'AI-powered geospatial analysis for precision forestry. Detect tree crowns, assess plantation health, and map forest operations at scale.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <ClerkProvider
      publishableKey={process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY}
      appearance={{ layout: { unsafe_disableDevelopmentModeWarnings: true } }}
    >
      <html lang="en" className={jakarta.variable}>
        <body>{children}</body>
      </html>
    </ClerkProvider>
  )
}
