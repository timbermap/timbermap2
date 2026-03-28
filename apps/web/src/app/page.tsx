import { auth } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'
import Landing from './Landing'

export const metadata = {
  title: 'Timbermap — Precision Forestry AI',
  description: 'AI-powered geospatial analysis for precision forestry.',
}

export default async function Home() {
  const { userId } = await auth()
  if (userId) redirect('/dashboard')
  return <Landing />
}
