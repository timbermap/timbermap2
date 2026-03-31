import { auth } from '@clerk/nextjs/server'
import { NextRequest, NextResponse } from 'next/server'

const API = process.env.NEXT_PUBLIC_API_URL || 'https://timbermap-api-788407107542.us-central1.run.app'

async function handler(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { path } = await params
  const url = `${API}/catalog/${path.join('/')}`

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'x-clerk-id': userId,
  }

  let body: string | undefined
  if (req.method !== 'GET') {
    body = await req.text()
  }

  const res = await fetch(url, { method: req.method, headers, body })
  const data = await res.json()
  return NextResponse.json(data, { status: res.status })
}

export const GET    = handler
export const POST   = handler
export const DELETE = handler
