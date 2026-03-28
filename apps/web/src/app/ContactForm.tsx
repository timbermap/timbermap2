'use client'
import { useState } from 'react'

export default function ContactForm() {
  const [status, setStatus] = useState<'idle'|'sending'|'success'|'error'>('idle')
  const [form, setForm] = useState({ name:'', email:'', company:'', message:'' })

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setStatus('sending')
    try {
      const fd = new FormData()
      Object.entries(form).forEach(([k,v]) => fd.append(k,v))
      const res = await fetch('/api/contact', { method:'POST', body:fd })
      setStatus(res.ok ? 'success' : 'error')
    } catch { setStatus('error') }
  }

  if (status === 'success') return (
    <div className="cf-wrap cf-success">
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" width="32" height="32" style={{color:'#6AA8A0'}}>
        <path fillRule="evenodd" d="M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16Zm3.857-9.809a.75.75 0 0 0-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 1 0-1.06 1.061l2.5 2.5a.75.75 0 0 0 1.137-.089l4-5.5Z" clipRule="evenodd"/>
      </svg>
      <h3>Message sent!</h3>
      <p>We&apos;ll get back to you at <strong style={{color:'#A0CECC'}}>{form.email}</strong> within 24 hours.</p>
      <style>{styles}</style>
    </div>
  )

  return (
    <div className="cf-wrap">
      <form onSubmit={handleSubmit} className="cf-form">
        <div className="cf-row">
          <div className="cf-group">
            <label>Name</label>
            <input type="text" placeholder="Your name" required value={form.name} onChange={e=>setForm(p=>({...p,name:e.target.value}))}/>
          </div>
          <div className="cf-group">
            <label>Email</label>
            <input type="email" placeholder="you@company.com" required value={form.email} onChange={e=>setForm(p=>({...p,email:e.target.value}))}/>
          </div>
        </div>
        <div className="cf-group">
          <label>Company / Operation</label>
          <input type="text" placeholder="Forestry company or operation" value={form.company} onChange={e=>setForm(p=>({...p,company:e.target.value}))}/>
        </div>
        <div className="cf-group">
          <label>Message</label>
          <textarea rows={4} placeholder="Tell us about your plantation, imagery type, and what you need to measure..." required value={form.message} onChange={e=>setForm(p=>({...p,message:e.target.value}))}/>
        </div>
        {status==='error' && <p className="cf-error">Something went wrong. Try again or email us directly.</p>}
        <button type="submit" disabled={status==='sending'} className="cf-submit">
          {status==='sending' ? 'Sending...' : 'Send message →'}
        </button>
      </form>
      <style>{styles}</style>
    </div>
  )
}

const styles = `
  @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=Inter:wght@300;400;500&display=swap');
  .cf-wrap { background:rgba(255,255,255,.04);border:1px solid rgba(160,206,204,.15);border-radius:14px;padding:2rem; }
  .cf-success { display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;min-height:300px;gap:.9rem; }
  .cf-success h3 { font-size:1.1rem;font-weight:700;color:#F0F7F6;font-family:'Space Grotesk',system-ui,sans-serif; }
  .cf-success p { font-size:.88rem;color:rgba(240,247,246,.4);font-family:'Space Grotesk',system-ui,sans-serif;font-weight:400; }
  .cf-form { display:flex;flex-direction:column;gap:1rem; }
  .cf-row { display:grid;grid-template-columns:1fr 1fr;gap:1rem; }
  .cf-group { display:flex;flex-direction:column;gap:.35rem; }
  .cf-group label { font-size:.65rem;font-weight:700;color:rgba(240,247,246,.65);text-transform:uppercase;letter-spacing:.1em;font-family:'Space Grotesk',system-ui,sans-serif; }
  .cf-group input,.cf-group textarea { background:rgba(255,255,255,.05);border:1px solid rgba(160,206,204,.15);border-radius:9px;padding:.65rem .9rem;font-size:.85rem;color:rgba(240,247,246,.95);outline:none;transition:border-color .2s;font-family:'Inter',system-ui,sans-serif;resize:none;width:100%;box-sizing:border-box;font-weight:300; }
  .cf-group input::placeholder,.cf-group textarea::placeholder { color:rgba(240,247,246,.35); }
  .cf-group input:focus,.cf-group textarea:focus { border-color:rgba(106,168,160,.5);background:rgba(255,255,255,.07); }
  .cf-error { font-size:.8rem;color:#f87171;background:rgba(248,113,113,.1);border:1px solid rgba(248,113,113,.2);border-radius:8px;padding:.6rem .9rem;font-family:'Space Grotesk',system-ui,sans-serif; }
  .cf-submit { background:#3D7A72;color:white;padding:.8rem;border-radius:9px;font-size:.85rem;font-weight:700;border:none;cursor:pointer;font-family:'Space Grotesk',system-ui,sans-serif;letter-spacing:.03em;transition:background .2s;width:100%; }
  .cf-submit:hover:not(:disabled) { background:#2A5750; }
  .cf-submit:disabled { opacity:.5;cursor:not-allowed; }
  @media(max-width:500px) { .cf-row { grid-template-columns:1fr; } }
`
