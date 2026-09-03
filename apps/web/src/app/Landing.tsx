'use client'
import Link from 'next/link'
import { useState, useEffect } from 'react'
import { SignInButton, SignUp } from '@clerk/nextjs'
import ContactForm from './ContactForm'

interface PublicModel {
  id: string
  name: string
  slug: string
  description: string
  output_types: string[]
  is_free: boolean
  required_gsd_cm: number | null
  image_type_note: string | null
  sample_image_small_url: string | null
  sample_image_large_url: string | null
}

const OUTPUT_LABELS: Record<string, string> = {
  raster_cog: 'Raster COG', geojson: 'GeoJSON', shapefile: 'Shapefile', csv: 'CSV',
}

function ModelCard({ model, n }: { model: PublicModel; n: string }) {
  const images = [model.sample_image_large_url, model.sample_image_small_url].filter(Boolean) as string[]
  const [idx, setIdx] = useState(0)
  useEffect(() => {
    if (images.length < 2) return
    const t = setInterval(() => setIdx(i => (i + 1) % images.length), 3500)
    return () => clearInterval(t)
  }, [images.length])
  return (
    <Link href={`/models/${model.slug}`} className="tm-model-card">
      <div className="tm-model-img-wrap">
        {images.length > 0 ? images.map((src, i) => (
          <img key={src} src={src} alt={model.name}
            className="tm-model-img"
            style={{ opacity: i === idx ? 1 : 0, transition: 'opacity .8s ease' }} />
        )) : <div className="tm-model-img" style={{ background: '#EEF1EF' }} />}
        <div className="tm-model-num">{n}</div>
        <div className={`tm-model-badge${model.is_free ? ' tm-model-badge-free' : ''}`}>
          {model.is_free ? 'Free' : 'Pro'}
        </div>
        {images.length > 1 && (
          <div className="tm-model-dots">
            {images.map((_, i) => (
              <button key={i} onClick={e => { e.preventDefault(); e.stopPropagation(); setIdx(i) }}
                className={`tm-model-dot${i === idx ? ' active' : ''}`} />
            ))}
          </div>
        )}
      </div>
      <div className="tm-model-body">
        <h3>{model.name}</h3>
        <p>{model.description}</p>
        {(model.required_gsd_cm || model.image_type_note) && (
          <p className="tm-model-spec">
            {model.required_gsd_cm && <span>{model.required_gsd_cm}cm/px GSD</span>}
            {model.required_gsd_cm && model.image_type_note && ' · '}
            {model.image_type_note}
          </p>
        )}
        <div className="tm-model-tags">
          {(model.output_types || []).map(t => <span key={t}>{OUTPUT_LABELS[t] || t}</span>)}
        </div>
      </div>
    </Link>
  )
}

export default function Landing() {
  const [models, setModels] = useState<PublicModel[]>([])
  useEffect(() => {
    const API = process.env.NEXT_PUBLIC_API_URL || 'https://timbermap-api-tjrp7tcqaa-uc.a.run.app'
    fetch(`${API}/public/models`).then(r => r.ok ? r.json() : []).then(setModels).catch(() => {})
  }, [])

  return (
    <div className="tm">

      {/* ── Nav ─────────────────────────────────────────────────────────── */}
      <nav className="tm-nav">
        <div className="tm-nav-inner">
          <Link href="/" className="tm-logo">
            <svg width="150" height="36" viewBox="0 0 300 72" fill="none" xmlns="http://www.w3.org/2000/svg">
            <circle cx="20" cy="20" r="20" fill="#6AA8A0"/>
            <circle cx="44" cy="20" r="16" fill="#3D7A72"/>
            <circle cx="30" cy="40" r="13" fill="#A0CECC"/>
            <text x="68" y="28" fontFamily="'Plus Jakarta Sans',system-ui,sans-serif" fontSize="26" fontWeight="700" letterSpacing="2" fill="#1A2624">TIMBERMAP</text>
            <text x="68" y="46" fontFamily="'Plus Jakarta Sans',system-ui,sans-serif" fontSize="12" fontWeight="400" fill="#6AA8A0">Powered by Forestech Uy</text>
          </svg>
          </Link>
          <div className="tm-nav-links">
            <a href="#features">Features</a>
            <a href="#models">Models</a>
            <Link href="/pricing">Pricing</Link>
            <a href="#contact">Contact</a>
            <SignInButton mode="modal" forceRedirectUrl="/dashboard">
              <button className="tm-nav-btn">Sign in</button>
            </SignInButton>
          </div>
          <SignInButton mode="modal" forceRedirectUrl="/dashboard">
            <button className="tm-nav-btn tm-nav-btn-mobile">Sign in</button>
          </SignInButton>
        </div>
      </nav>

      {/* ── Hero ────────────────────────────────────────────────────────── */}
      <section className="tm-hero">
        <div className="tm-hero-bg">
          <div className="tm-hero-slideshow">
            <div className="tm-slide tm-slide-1" style={{backgroundImage:"url('/header/header1.jpg')"}}/>
            <div className="tm-slide tm-slide-2" style={{backgroundImage:"url('/header/header2.jpg')"}}/>
            <div className="tm-slide tm-slide-3" style={{backgroundImage:"url('/header/header3.jpg')"}}/>
          </div>
          <div className="tm-hero-overlay" />
        </div>
        <div className="tm-hero-inner">
          <div className="tm-hero-content">
            <p className="tm-eyebrow">Precision Forestry AI</p>
            <h1 className="tm-hero-title">
              AI-powered<br/>
              precision<br/>
              <em>forestry</em>
            </h1>
            <p className="tm-hero-sub">
              Upload drone or aircraft imagery of your forest plantation. Get AI-powered results — tree crown counts, inter-row spacing, fault density maps — in under an hour.
            </p>
            <div className="tm-hero-ctas">
              <a href="#contact" className="tm-btn-outline">Talk to us</a>
            </div>
            <div className="tm-hero-stats">
              <div><strong>3</strong><span>AI models</span></div>
              <div><strong>&lt;1h</strong><span>Processing</span></div>
              <div><strong>cm</strong><span>Resolution</span></div>
            </div>
          </div>

          <div className="tm-hero-auth">
            <p className="tm-hero-auth-eyebrow">Get started</p>
            <h2 className="tm-hero-auth-title">Create your account</h2>
            <SignUp
              forceRedirectUrl="/dashboard"
              signInUrl="/sign-in"
              appearance={{
                elements: {
                  rootBox: 'w-full',
                  card: 'shadow-none border-0 w-full p-0 bg-transparent',
                  headerTitle: 'hidden',
                  headerSubtitle: 'hidden',
                  footer: 'bg-transparent',
                  formButtonPrimary: 'bg-[#2C5F45] hover:bg-[#3D7A5A] text-white',
                  footerActionLink: 'text-[#2C5F45] hover:text-[#3D7A5A]',
                },
              }}
            />
          </div>
        </div>
      </section>

      {/* ── Features ────────────────────────────────────────────────────── */}
      <section className="tm-features" id="features">
        <div className="tm-wrap">
          <p className="tm-label">Platform</p>
          <h2 className="tm-h2">Built for plantation<br/>operations at scale</h2>
          <div className="tm-features-grid">
            {[
              {
                color: '#EEF7F6', icon: (
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#3D7A72" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" width="24" height="24">
                    <path d="M12 2C6.477 2 2 6.477 2 12s4.477 10 10 10 10-4.477 10-10S17.523 2 12 2z"/><path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
                  </svg>
                ),
                title: 'Drone & aircraft imagery',
                body: 'Upload GeoTIFFs from drones, manned aircraft or satellites. Automatic COG conversion and reprojection.',
              },
              {
                color: '#E8F4F3', icon: (
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#3D7A72" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" width="24" height="24">
                    <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
                  </svg>
                ),
                title: 'Fast inference',
                body: 'GPU-accelerated tile-based processing. Analyze thousands of forest hectares in under an hour.',
              },
              {
                color: '#E4F0EF', icon: (
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#3D7A72" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" width="24" height="24">
                    <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>
                  </svg>
                ),
                title: 'Plot-level precision',
                body: 'Clip analysis to a stand or plot shapefile, paste GeoJSON, or draw a polygon on the map.',
              },
              {
                color: '#EEF7F6', icon: (
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#3D7A72" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" width="24" height="24">
                    <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>
                  </svg>
                ),
                title: 'Forest map viewer',
                body: 'Visualize outputs over satellite basemaps. Export as COG, GeoJSON or Shapefile for QGIS or ArcGIS.',
              },
              {
                color: '#E8F4F3', icon: (
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#3D7A72" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" width="24" height="24">
                    <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>
                  </svg>
                ),
                title: 'Per-user permissions',
                body: 'Fine-grained model access control. Each user only sees what you grant them.',
              },
              {
                color: '#E4F0EF', icon: (
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#3D7A72" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" width="24" height="24">
                    <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
                  </svg>
                ),
                title: 'API-first',
                body: 'Fully automatable via REST API. Integrate with your forestry GIS or data pipeline.',
              },
            ].map(f => (
              <div key={f.title} className="tm-feature-card">
                <div className="tm-feature-icon-wrap" style={{background: f.color}}>
                  {f.icon}
                </div>
                <div>
                  <h3>{f.title}</h3>
                  <p>{f.body}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Models ──────────────────────────────────────────────────────── */}
      <section className="tm-models" id="models">
        <div className="tm-wrap">
          <p className="tm-label tm-label-light">Sample Models</p>
          <h2 className="tm-h2 tm-h2-light">Purpose-built for<br/>plantation operations</h2>
          <p className="tm-models-sub">
            A sample of our current models — click any one for full details. Every plantation is
            different — if you need something specific, we can build it for you.{' '}
            <Link href="/models" className="tm-models-link">View full catalog →</Link>
          </p>

          <div className="tm-models-grid">
            {models.map((m, i) => <ModelCard key={m.id} model={m} n={String(i + 1).padStart(2, '0')} />)}
          </div>

          <div className="tm-models-cta">
            <p>Need a custom model for your operation?</p>
            <a href="#contact" className="tm-btn-primary">Get in touch →</a>
          </div>
        </div>
      </section>

      {/* ── Steps ───────────────────────────────────────────────────────── */}
      <section className="tm-steps">
        <div className="tm-wrap">
          <p className="tm-label">Workflow</p>
          <h2 className="tm-h2">From upload to insight<br/>in four steps</h2>
          <div className="tm-steps-grid">
            {[
              { n: '01', title: 'Upload imagery', body: 'Drop your drone or aircraft GeoTIFF. We generate a Cloud-Optimized GeoTIFF and extract spatial metadata.' },
              { n: '02', title: 'Define your AOI', body: 'Upload a shapefile, paste GeoJSON, or draw a polygon on the map to clip the analysis to your stands.' },
              { n: '03', title: 'Run a model', body: 'Select a model and hit Run. GPU inference runs in the cloud — no local compute needed.' },
              { n: '04', title: 'Download results', body: 'View on the interactive map, then export as COG, GeoJSON or Shapefile for your GIS tool.' },
            ].map(s => (
              <div key={s.n} className="tm-step">
                <div className="tm-step-n">{s.n}</div>
                <h3>{s.title}</h3>
                <p>{s.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Contact ─────────────────────────────────────────────────────── */}
      <section className="tm-contact" id="contact">
        <div className="tm-wrap">
          <div className="tm-contact-inner">
            <div className="tm-contact-text">
              <p className="tm-label tm-label-light">Get in touch</p>
              <h2 className="tm-h2 tm-h2-light">Ready to map<br/>your plantation?</h2>
              <p className="tm-contact-sub">Tell us about your forest operation — plantation type, imagery source, and what you need to measure. We'll be in touch within 24 hours.</p>
            </div>
            <ContactForm />
          </div>
        </div>
      </section>

      {/* ── Footer ──────────────────────────────────────────────────────── */}
      <footer className="tm-footer">
        <div className="tm-footer-inner">
          <div className="tm-logo">
            <svg width="130" height="30" viewBox="0 0 300 72" fill="none" xmlns="http://www.w3.org/2000/svg">
            <circle cx="20" cy="20" r="20" fill="#6AA8A0"/>
            <circle cx="44" cy="20" r="16" fill="#3D7A72"/>
            <circle cx="30" cy="40" r="13" fill="#A0CECC"/>
            <text x="68" y="28" fontFamily="'Plus Jakarta Sans',system-ui,sans-serif" fontSize="26" fontWeight="700" letterSpacing="2" fill="#FFFFFF">TIMBERMAP</text>
            <text x="68" y="46" fontFamily="'Plus Jakarta Sans',system-ui,sans-serif" fontSize="12" fontWeight="400" fill="rgba(255,255,255,0.35)">Powered by Forestech Uy</text>
          </svg>
          </div>
          <p>© 2026 Forestech Uy</p>
          <div className="tm-footer-links">
            <SignInButton mode="modal" forceRedirectUrl="/dashboard">
              <button style={{background:'none',border:'none',cursor:'pointer',color:'inherit'}}>Sign in</button>
            </SignInButton>
            <a href="#contact">Contact</a>
          </div>
        </div>
      </footer>

      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@300;400;500;600;700;800&display=swap');

        .tm { font-family:'Plus Jakarta Sans',system-ui,sans-serif; background:#F4F7F7; color:#1A2624; overflow-x:hidden; }

        /* MODAL */
        .tm-modal-bg { position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.6);backdrop-filter:blur(8px);display:flex;align-items:center;justify-content:center;padding:1rem; }
        .tm-modal { position:relative;background:white;border-radius:16px;padding:2rem 1.5rem 1.5rem;width:100%;max-width:420px;max-height:90vh;overflow-y:auto; }
        .tm-modal-close { position:absolute;top:12px;right:14px;background:none;border:none;cursor:pointer;font-size:1rem;color:#999;line-height:1;padding:4px 8px;border-radius:6px;transition:background .15s; }
        .tm-modal-close:hover { background:#f0f0f0; }

        /* NAV */
        .tm-nav { position:fixed;top:0;left:0;right:0;z-index:50;height:60px;background:rgba(244,247,247,0.93);backdrop-filter:blur(14px);border-bottom:1px solid #C8E2E0; }
        .tm-nav-inner { max-width:1200px;margin:0 auto;padding:0 1.5rem;height:100%;display:flex;align-items:center;justify-content:space-between; }
        .tm-logo { display:flex;align-items:center;text-decoration:none; }
        .tm-nav-links { display:flex;align-items:center;gap:2rem; }
        .tm-nav-links a { color:#4A6B68;text-decoration:none;font-size:0.85rem;font-weight:500;transition:color .2s; }
        .tm-nav-links a:hover { color:#1A2624; }
        .tm-nav-btn { background:#3D7A72;color:#fff;padding:.42rem 1.1rem;border-radius:7px;font-size:0.85rem;font-weight:600;border:none;cursor:pointer;font-family:inherit;letter-spacing:.01em;transition:background .2s; }
        .tm-nav-btn:hover { background:#2A5750; }
        .tm-nav-btn-mobile { display:none; }

        /* HERO */
        .tm-hero { position:relative;min-height:100vh;display:flex;align-items:center;padding:6rem 1.5rem 4rem;overflow:hidden;isolation:auto; }
        .tm-hero-bg { position:absolute;inset:0;z-index:0; }
        .tm-hero-slideshow { position:absolute;inset:0; }
        .tm-slide { position:absolute;inset:0;background-size:cover;background-position:center;filter:saturate(0.9) brightness(0.75);opacity:0;animation:slide-fade 18s infinite; }
        .tm-slide-1 { animation-delay:0s; }
        .tm-slide-2 { animation-delay:6s; }
        .tm-slide-3 { animation-delay:12s; }
        @keyframes slide-fade { 0%{opacity:0} 5%{opacity:1} 28%{opacity:1} 33%{opacity:0} 100%{opacity:0} }
        .tm-hero-overlay { position:absolute;inset:0;background:linear-gradient(135deg,rgba(20,35,32,.75) 0%,rgba(20,35,32,.50) 60%,rgba(40,90,84,.15) 100%); }
        .tm-hero-inner { position:relative;z-index:1;width:100%;max-width:1280px;margin:0 auto;display:flex;align-items:center;justify-content:space-between;gap:3.5rem; }
        .tm-hero-content { max-width:600px;flex:1 1 480px; }
        .tm-hero-auth { background:#fff;border-radius:20px;padding:2.5rem 2.25rem 2rem;width:380px;flex-shrink:0;box-shadow:0 30px 70px -20px rgba(0,0,0,.45); }
        .tm-hero-auth-eyebrow { font-size:.65rem;font-weight:600;text-transform:uppercase;letter-spacing:.1em;color:#6AA8A0;margin-bottom:.4rem; }
        .tm-hero-auth-title { font-size:1.4rem;font-weight:600;color:#1A2624;margin-bottom:1.5rem;letter-spacing:-.01em; }
        .tm-eyebrow { font-size:.72rem;font-weight:500;text-transform:uppercase;letter-spacing:.12em;color:#6AA8A0;margin-bottom:1.25rem; }
        .tm-hero-title { font-size:clamp(2.75rem,6vw,5rem);font-weight:300;line-height:1.0;letter-spacing:-.02em;color:#F0F7F6;margin-bottom:1.5rem; }
        .tm-hero-title em { font-style:normal;color:#6AA8A0;font-weight:700; }
        .tm-hero-sub { font-size:1rem;color:rgba(240,247,246,.6);line-height:1.75;max-width:460px;margin-bottom:2.5rem;font-weight:300; }
        .tm-hero-ctas { display:flex;gap:1rem;flex-wrap:wrap;margin-bottom:3rem; }
        .tm-btn-primary { display:inline-flex;align-items:center;gap:6px;background:#3D7A72;color:#fff;padding:.75rem 1.75rem;border-radius:8px;font-size:.88rem;font-weight:600;text-decoration:none;letter-spacing:.01em;transition:background .2s,transform .15s;border:none;cursor:pointer;font-family:inherit; }
        .tm-btn-primary:hover { background:#2A5750;transform:translateY(-1px); }
        .tm-btn-outline { display:inline-flex;align-items:center;border:1.5px solid rgba(240,247,246,.3);color:rgba(240,247,246,.8);padding:.75rem 1.5rem;border-radius:8px;font-size:.88rem;font-weight:500;text-decoration:none;transition:all .2s; }
        .tm-btn-outline:hover { border-color:rgba(240,247,246,.7);color:#F0F7F6; }
        .tm-hero-stats { display:flex;gap:2.5rem; }
        .tm-hero-stats div { display:flex;flex-direction:column; }
        .tm-hero-stats strong { font-size:1.75rem;font-weight:700;color:#A0CECC;line-height:1; }
        .tm-hero-stats span { font-size:.65rem;text-transform:uppercase;letter-spacing:.1em;color:rgba(240,247,246,.35);margin-top:3px; }

        /* SECTION COMMONS */
        .tm-wrap { max-width:1200px;margin:0 auto;padding:0 1.5rem; }
        .tm-label { font-size:.7rem;font-weight:600;text-transform:uppercase;letter-spacing:.12em;color:#3D7A72;margin-bottom:.6rem; }
        .tm-label-light { color:#A0CECC; }
        .tm-h2 { font-size:clamp(1.8rem,4vw,2.6rem);font-weight:700;line-height:1.1;letter-spacing:-.02em;color:#1A2624;margin-bottom:1rem; }
        .tm-h2-light { color:#F0F7F6; }

        /* FEATURES */
        .tm-features { background:white;padding:6rem 1.5rem; }
        .tm-features .tm-h2 { margin-bottom:3rem; }
        .tm-features-grid { display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:1.5rem; }
        .tm-feature-card { display:flex;align-items:flex-start;gap:1rem;padding:1.5rem;border-radius:14px;border:1px solid #E4EDEC;background:#FAFCFC;transition:border-color .2s,box-shadow .2s; }
        .tm-feature-card:hover { border-color:#A0CECC;box-shadow:0 4px 20px rgba(61,122,114,.08); }
        .tm-feature-icon-wrap { flex-shrink:0;width:44px;height:44px;border-radius:10px;display:flex;align-items:center;justify-content:center; }
        .tm-feature-card h3 { font-size:.88rem;font-weight:600;color:#1A2624;margin-bottom:.35rem; }
        .tm-feature-card p { font-size:.82rem;color:#4A6B68;line-height:1.65;font-weight:400; }

        /* MODELS */
        .tm-models { background:#1A2624;padding:6rem 1.5rem; }
        .tm-models-sub { font-size:.9rem;color:rgba(240,247,246,.45);max-width:520px;margin-bottom:3rem;font-weight:400;line-height:1.65; }
        .tm-models-link { color:#6AA8A0;font-weight:600;white-space:nowrap; }
        .tm-models-link:hover { color:#A0CECC; }
        .tm-models-grid { display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:1.25rem;margin-bottom:3rem; }
        .tm-model-card { display:block;text-decoration:none;color:inherit;background:rgba(255,255,255,.04);border:1px solid rgba(160,206,204,.12);border-radius:14px;overflow:hidden;transition:border-color .2s;cursor:pointer; }
        .tm-model-card:hover { border-color:rgba(160,206,204,.3); }
        .tm-model-img-wrap { position:relative;height:200px;overflow:hidden; }
        .tm-model-img { position:absolute;inset:0;width:100%;height:100%;object-fit:cover;filter:saturate(0.85) brightness(0.8); }
        .tm-model-num { position:absolute;top:12px;right:14px;font-size:.65rem;font-weight:700;letter-spacing:.08em;color:rgba(255,255,255,.6);background:rgba(0,0,0,.35);padding:.2rem .5rem;border-radius:4px;z-index:2; }
        .tm-model-badge { position:absolute;top:12px;left:14px;font-size:.62rem;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:rgba(240,247,246,.8);background:rgba(0,0,0,.35);padding:.2rem .55rem;border-radius:999px;z-index:2; }
        .tm-model-badge-free { color:#1A2624;background:#6AA8A0; }
        .tm-model-dots { position:absolute;bottom:10px;left:0;right:0;display:flex;justify-content:center;gap:5px;z-index:2; }
        .tm-model-dot { width:6px;height:6px;border-radius:50%;background:rgba(255,255,255,.35);border:none;cursor:pointer;padding:0;transition:background .2s; }
        .tm-model-dot.active { background:rgba(255,255,255,.9); }
        .tm-model-body { padding:1.5rem; }
        .tm-model-body h3 { font-size:.95rem;font-weight:600;color:#F0F7F6;margin-bottom:.5rem; }
        .tm-model-body p { font-size:.82rem;color:rgba(240,247,246,.45);line-height:1.65;margin-bottom:1.1rem;font-weight:400; }
        .tm-model-spec { font-size:.72rem;color:#6AA8A0;font-weight:600;margin-top:-.5rem;margin-bottom:1.1rem; }
        .tm-model-tags { display:flex;gap:.5rem;flex-wrap:wrap; }
        .tm-model-tags span { font-size:.62rem;padding:.2rem .55rem;border-radius:999px;background:rgba(106,168,160,.12);border:1px solid rgba(106,168,160,.2);color:#6AA8A0;font-weight:500; }
        .tm-models-cta { text-align:center;padding:2.5rem;border:1px dashed rgba(160,206,204,.25);border-radius:14px;background:rgba(255,255,255,.02); }
        .tm-models-cta p { color:rgba(240,247,246,.5);font-size:.9rem;margin-bottom:1.25rem;font-weight:400; }

        /* STEPS */
        .tm-steps { background:#F4F7F7;padding:6rem 1.5rem; }
        .tm-steps .tm-h2 { margin-bottom:3rem; }
        .tm-steps-grid { display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:2.5rem; }
        .tm-step-n { font-size:2.5rem;font-weight:300;color:#A0CECC;line-height:1;margin-bottom:.75rem; }
        .tm-step h3 { font-size:.9rem;font-weight:600;color:#1A2624;margin-bottom:.4rem; }
        .tm-step p { font-size:.82rem;color:#4A6B68;line-height:1.65;font-weight:400; }

        /* CONTACT */
        .tm-contact { background:#1A2624;padding:6rem 1.5rem; }
        .tm-contact-inner { display:grid;grid-template-columns:1fr 1fr;gap:5rem;align-items:start; }
        .tm-contact-sub { font-size:.88rem;color:rgba(240,247,246,.4);line-height:1.7;max-width:380px;margin-top:.75rem;font-weight:400; }

        /* FOOTER */
        .tm-footer { background:#111C1A;border-top:1px solid rgba(255,255,255,.05);padding:1.75rem 1.5rem; }
        .tm-footer-inner { max-width:1200px;margin:0 auto;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:1rem; }
        .tm-footer p { font-size:.75rem;color:rgba(255,255,255,.2);font-weight:400; }
        .tm-footer-links { display:flex;gap:1.5rem; }
        .tm-footer-links a,.tm-footer-links button { font-size:.75rem;color:rgba(255,255,255,.3);text-decoration:none;font-weight:500;transition:color .2s; }
        .tm-footer-links a:hover,.tm-footer-links button:hover { color:rgba(255,255,255,.7); }

        /* RESPONSIVE */
        @media(max-width:900px) {
          .tm-nav-links a:not(.tm-nav-btn) { display:none; }
          .tm-nav-btn { display:none; }
          .tm-nav-btn-mobile { display:block; }
          .tm-hero { text-align:center; }
          .tm-hero-inner { flex-direction:column; }
          .tm-hero-sub,.tm-hero-content { margin-left:auto;margin-right:auto; }
          .tm-hero-ctas,.tm-hero-stats { justify-content:center; }
          .tm-hero-auth { width:100%;max-width:380px;text-align:left; }
          .tm-contact-inner { grid-template-columns:1fr;gap:3rem; }
        }
        @media(max-width:600px) {
          .tm-hero-title { font-size:2.5rem; }
          .tm-steps-grid { grid-template-columns:1fr 1fr; }
          .tm-footer-inner { flex-direction:column;text-align:center; }
        }
      `}</style>
    </div>
  )
}
