'use client'
import Link from 'next/link'
import { SignUpButton } from '@clerk/nextjs'

const TIERS = [
  {
    id: 'basic',
    name: 'Basic',
    price: 'Free',
    period: '',
    tagline: 'Explore the platform on your own imagery.',
    cta: 'signup' as const,
    ctaLabel: 'Start free',
    highlight: false,
    features: [
      'Your own workspace — upload and process independently',
      'Free AI models (Gap & Clearing Detection)',
      '5 GB storage',
      'Interactive map with satellite, terrain and street basemaps',
      'GeoJSON, Shapefile and COG exports',
    ],
  },
  {
    id: 'active',
    name: 'Active',
    price: 'Talk to us',
    period: '',
    tagline: 'For teams running AI models on real operations.',
    cta: 'contact' as const,
    ctaLabel: 'Talk to sales',
    highlight: true,
    features: [
      'Everything in Basic',
      'Full model catalog — Tree Crown Detection, Tillage Line Detection, Plantation Fault Detection',
      '50 GB storage, pooled across your whole team',
      'Invite teammates under one account — each keeps their own workspace',
      'You control which models each teammate can access',
      'Priority processing queue',
    ],
  },
  {
    id: 'custom',
    name: 'Custom',
    price: 'Talk to us',
    period: '',
    tagline: 'For large operations with dedicated needs.',
    cta: 'contact' as const,
    ctaLabel: 'Contact us',
    highlight: false,
    features: [
      'Everything in Active',
      'Unlimited storage',
      'Custom model configuration & thresholds',
      'Volume-based pricing',
      'Dedicated support',
    ],
  },
]

export default function PricingPage() {
  return (
    <div className="pr">
      {/* ── Nav ─────────────────────────────────────────────────────────── */}
      <nav className="pr-nav">
        <div className="pr-nav-inner">
          <Link href="/" className="pr-logo">
            <svg width="150" height="36" viewBox="0 0 300 72" fill="none" xmlns="http://www.w3.org/2000/svg">
              <circle cx="20" cy="20" r="20" fill="#6AA8A0"/>
              <circle cx="44" cy="20" r="16" fill="#3D7A72"/>
              <circle cx="30" cy="40" r="13" fill="#A0CECC"/>
              <text x="68" y="28" fontFamily="'Plus Jakarta Sans',system-ui,sans-serif" fontSize="26" fontWeight="700" letterSpacing="2" fill="#1A2624">TIMBERMAP</text>
              <text x="68" y="46" fontFamily="'Plus Jakarta Sans',system-ui,sans-serif" fontSize="12" fontWeight="400" fill="#6AA8A0">Powered by Forestech Uy</text>
            </svg>
          </Link>
          <Link href="/" className="pr-back">← Back to home</Link>
        </div>
      </nav>

      {/* ── Header ──────────────────────────────────────────────────────── */}
      <header className="pr-header">
        <p className="pr-eyebrow">Pricing</p>
        <h1>Plans that grow<br />with your operation</h1>
        <p className="pr-sub">
          Start free, upgrade when you need the full model catalog and a shared account for your team.
        </p>
      </header>

      {/* ── Tiers ───────────────────────────────────────────────────────── */}
      <section className="pr-tiers">
        {TIERS.map(t => (
          <div key={t.id} className={`pr-card${t.highlight ? ' pr-card-highlight' : ''}`}>
            {t.highlight && <div className="pr-badge">Most popular</div>}
            <h2>{t.name}</h2>
            <p className="pr-tagline">{t.tagline}</p>
            <div className="pr-price">
              <span className="pr-price-amount">{t.price}</span>
              {t.period && <span className="pr-price-period">{t.period}</span>}
            </div>
            {t.cta === 'signup' ? (
              <SignUpButton mode="modal" forceRedirectUrl="/dashboard">
                <button className={t.highlight ? 'pr-btn-primary' : 'pr-btn-outline'}>{t.ctaLabel}</button>
              </SignUpButton>
            ) : (
              <a href="#contact-note" className={t.highlight ? 'pr-btn-primary' : 'pr-btn-outline'}>{t.ctaLabel}</a>
            )}
            <ul className="pr-features">
              {t.features.map(f => (
                <li key={f}>
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" width="16" height="16">
                    <path fillRule="evenodd" d="M16.704 4.153a.75.75 0 0 1 .143 1.052l-8 10.5a.75.75 0 0 1-1.127.075l-4.5-4.5a.75.75 0 0 1 1.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 0 1 1.05-.143Z" clipRule="evenodd"/>
                  </svg>
                  <span>{f}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </section>

      {/* ── Contact note ────────────────────────────────────────────────── */}
      <section className="pr-contact" id="contact-note">
        <h3>Not sure which plan fits?</h3>
        <p>Tell us about your operation — plantation size, imagery source, team size — and we&apos;ll recommend a plan.</p>
        <Link href="/#contact" className="pr-btn-primary">Contact us →</Link>
      </section>

      <footer className="pr-footer">
        <p>© 2026 Forestech Uy</p>
      </footer>

      <style>{`
        .pr { font-family:'Plus Jakarta Sans',system-ui,sans-serif; background:#F4F7F7; color:#1A2624; min-height:100vh; }

        .pr-nav { position:sticky;top:0;z-index:20;height:60px;background:rgba(244,247,247,0.93);backdrop-filter:blur(14px);border-bottom:1px solid #C8E2E0; }
        .pr-nav-inner { max-width:1100px;margin:0 auto;padding:0 1.5rem;height:100%;display:flex;align-items:center;justify-content:space-between; }
        .pr-logo { display:flex;align-items:center; }
        .pr-back { color:#4A6B68;text-decoration:none;font-size:0.85rem;font-weight:500;transition:color .2s; }
        .pr-back:hover { color:#1A2624; }

        .pr-header { max-width:700px;margin:0 auto;padding:5rem 1.5rem 2rem;text-align:center; }
        .pr-eyebrow { font-size:.72rem;text-transform:uppercase;letter-spacing:.14em;color:#6AA8A0;font-weight:600;margin-bottom:1rem; }
        .pr-header h1 { font-size:clamp(2.25rem,5vw,3.25rem);font-weight:300;line-height:1.08;letter-spacing:-.02em;color:#12201d;margin-bottom:1.25rem; }
        .pr-sub { font-size:1rem;color:#5b6b67;line-height:1.7;font-weight:300; }

        .pr-tiers { max-width:1100px;margin:0 auto;padding:2rem 1.5rem 5rem;display:grid;grid-template-columns:repeat(3,1fr);gap:1.5rem;align-items:start; }
        .pr-card { background:#fff;border:1px solid #DCE8E6;border-radius:20px;padding:2rem 1.75rem;position:relative;display:flex;flex-direction:column; }
        .pr-card-highlight { border-color:#3D7A72;box-shadow:0 12px 32px -12px rgba(44,95,69,.28);transform:translateY(-8px); }
        .pr-badge { position:absolute;top:-13px;left:50%;transform:translateX(-50%);background:#2C5F45;color:#fff;font-size:.7rem;font-weight:600;padding:.3rem .9rem;border-radius:999px;letter-spacing:.02em; }
        .pr-card h2 { font-size:1.35rem;font-weight:600;color:#12201d;margin-bottom:.35rem; }
        .pr-tagline { font-size:.85rem;color:#6b7b78;line-height:1.5;min-height:2.6em;margin-bottom:1.25rem;font-weight:400; }
        .pr-price { display:flex;align-items:baseline;gap:.4rem;margin-bottom:1.5rem; }
        .pr-price-amount { font-size:1.85rem;font-weight:700;color:#1A2624;letter-spacing:-.01em; }
        .pr-price-period { font-size:.85rem;color:#8a9895; }

        .pr-btn-primary { display:inline-flex;align-items:center;justify-content:center;width:100%;background:#3D7A72;color:#fff;padding:.75rem 1.5rem;border-radius:9px;font-size:.88rem;font-weight:600;text-decoration:none;border:none;cursor:pointer;font-family:inherit;transition:background .2s; }
        .pr-btn-primary:hover { background:#2A5750; }
        .pr-btn-outline { display:inline-flex;align-items:center;justify-content:center;width:100%;background:#F4F7F7;color:#1A2624;padding:.75rem 1.5rem;border-radius:9px;font-size:.88rem;font-weight:600;text-decoration:none;border:1.5px solid #C8E2E0;cursor:pointer;font-family:inherit;transition:all .2s; }
        .pr-btn-outline:hover { border-color:#3D7A72;color:#2A5750; }

        .pr-features { list-style:none;margin:1.75rem 0 0;padding:0;display:flex;flex-direction:column;gap:.7rem; }
        .pr-features li { display:flex;align-items:flex-start;gap:.6rem;font-size:.85rem;color:#3d4a47;line-height:1.5; }
        .pr-features li svg { color:#6AA8A0;flex-shrink:0;margin-top:.15rem; }

        .pr-contact { max-width:600px;margin:0 auto;padding:0 1.5rem 5rem;text-align:center; }
        .pr-contact h3 { font-size:1.4rem;font-weight:500;color:#12201d;margin-bottom:.6rem; }
        .pr-contact p { font-size:.9rem;color:#5b6b67;line-height:1.6;margin-bottom:1.5rem; }
        .pr-contact .pr-btn-primary { display:inline-flex;width:auto;padding:.75rem 1.75rem; }

        .pr-footer { text-align:center;padding:2rem 1.5rem;border-top:1px solid #DCE8E6; }
        .pr-footer p { font-size:.75rem;color:#8a9895; }

        @media (max-width: 860px) {
          .pr-tiers { grid-template-columns:1fr;max-width:420px; }
          .pr-card-highlight { transform:none; }
        }
      `}</style>
    </div>
  )
}
