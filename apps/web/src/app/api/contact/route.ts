import { NextRequest, NextResponse } from 'next/server'

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData()
    const name    = (formData.get('name')    as string || '').trim()
    const email   = (formData.get('email')   as string || '').trim()
    const company = (formData.get('company') as string || '').trim()
    const message = (formData.get('message') as string || '').trim()

    if (!name || !email || !message) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    const RESEND_API_KEY = process.env.RESEND_API_KEY
    if (!RESEND_API_KEY) {
      console.error('RESEND_API_KEY not set')
      return NextResponse.json({ error: 'Email service not configured' }, { status: 500 })
    }

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from:    'Timbermap Contact <contact@timbermap.com>',
        to:      ['sebastian@timbermap.com'],
        replyTo: email,
        subject: `New contact — ${name}${company ? ` (${company})` : ''}`,
        html: `
          <div style="font-family:-apple-system,sans-serif;max-width:560px;margin:0 auto;padding:2rem;background:#f8faf8;border-radius:12px;">
            <div style="background:#2C5F45;padding:1.25rem 1.5rem;border-radius:8px;margin-bottom:1.5rem;">
              <h2 style="color:white;margin:0;font-size:1.1rem;font-weight:500;">New contact from Timbermap</h2>
            </div>
            <table style="width:100%;border-collapse:collapse;margin-bottom:1.5rem;">
              <tr><td style="padding:8px 0;color:#666;font-size:0.85rem;width:90px;vertical-align:top;">Name</td><td style="padding:8px 0;font-weight:500;color:#1a2e1e;">${name}</td></tr>
              <tr><td style="padding:8px 0;color:#666;font-size:0.85rem;vertical-align:top;">Email</td><td style="padding:8px 0;"><a href="mailto:${email}" style="color:#2C5F45;">${email}</a></td></tr>
              ${company ? `<tr><td style="padding:8px 0;color:#666;font-size:0.85rem;vertical-align:top;">Company</td><td style="padding:8px 0;color:#1a2e1e;">${company}</td></tr>` : ''}
            </table>
            <div style="background:white;border-radius:8px;padding:1.25rem;border-left:3px solid #2C5F45;">
              <p style="margin:0;color:#374151;line-height:1.65;font-size:0.9rem;">${message.replace(/\n/g, '<br/>')}</p>
            </div>
          </div>
        `,
      }),
    })

    if (!res.ok) {
      const err = await res.text()
      console.error('Resend error:', err)
      return NextResponse.json({ error: 'Failed to send email' }, { status: 500 })
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('Contact form error:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
