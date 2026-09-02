'use client'
import { useUser } from '@clerk/nextjs'
import React, { Suspense } from 'react'
import { useEffect, useRef, useState, useCallback } from 'react'
import { useSearchParams } from 'next/navigation'
import maplibregl, { StyleSpecification } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'

// @ts-expect-error - no types
import MapboxDraw from '@mapbox/mapbox-gl-draw'
import '@mapbox/mapbox-gl-draw/dist/mapbox-gl-draw.css'

import { cogProtocol } from '@geomatico/maplibre-cog-protocol'

type Layer = {
  id: string
  name: string
  type: 'raster' | 'vector'
  cog_url?: string
  tiles_url?: string
  epsg: string | null
  visible: boolean
  opacity: number
  bbox?: [number, number, number, number] | null
}

type MLOutput = {
  id: string
  name: string
  type: 'raster' | 'vector' | null
  cog_url?: string
  geojson_url?: string
  epsg: number | null
  bbox: [number, number, number, number] | null
  opacity: number
  visible: boolean
  image_id?: string | null
}

type AOIFeature = {
  id: string
  geometry: GeoJSON.Geometry
  area_km2: number
}

function makeBasemap(tileUrl: string, attribution: string, maxzoom = 19): StyleSpecification {
  return {
    version: 8,
    sources: { basemap: { type: 'raster', tiles: [tileUrl], tileSize: 256, attribution, maxzoom } },
    layers: [{ id: 'basemap', type: 'raster', source: 'basemap' }]
  }
}

// ── Basemap definitions ───────────────────────────────────────────────────────
type BasemapDef = { id: string; label: string; icon: React.ReactNode; style: StyleSpecification }

const BasemapIcons = {
  Satellite: (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5">
      <path d="M.99 5.24A2.25 2.25 0 0 1 3.25 3h13.5A2.25 2.25 0 0 1 19 5.25v9.5A2.25 2.25 0 0 1 16.75 17H3.25A2.25 2.25 0 0 1 1 14.75v-9.5c0-.06 0-.12-.01-.18V5.24Zm7.61 9.26a.75.75 0 0 0 1.06 0l3.25-3.25a.75.75 0 0 0 0-1.06L9.66 7.14a.75.75 0 1 0-1.06 1.06l2.72 2.72-2.72 2.72a.75.75 0 0 0 0 1.06Z"/>
    </svg>
  ),
  Streets: (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5">
      <path fillRule="evenodd" d="m9.69 18.933.003.001C9.89 19.02 10 19 10 19s.11.02.308-.066l.002-.001.006-.003.018-.008a5.741 5.741 0 0 0 .281-.14c.186-.096.446-.24.757-.433.62-.384 1.445-.966 2.274-1.765C15.302 14.988 17 12.493 17 9A7 7 0 1 0 3 9c0 3.492 1.698 5.988 3.355 7.584a13.731 13.731 0 0 0 2.273 1.765 11.842 11.842 0 0 0 .788.472l.018.008.006.003ZM10 11.25a2.25 2.25 0 1 0 0-4.5 2.25 2.25 0 0 0 0 4.5Z" clipRule="evenodd"/>
    </svg>
  ),
  Terrain: (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5">
      <path fillRule="evenodd" d="M9.664 1.319a.75.75 0 0 1 .672 0 41.059 41.059 0 0 1 8.198 5.424.75.75 0 0 1-.254 1.285 31.372 31.372 0 0 0-7.86 3.83.75.75 0 0 1-.84 0 31.508 31.508 0 0 0-2.08-1.287V9.394c0-.244.116-.463.302-.592a35.504 35.504 0 0 1 3.305-2.033.75.75 0 0 0-.714-1.319 37 37 0 0 0-3.446 2.12A2.216 2.216 0 0 0 6 9.393v.38a31.293 31.293 0 0 0-4.28-1.746.75.75 0 0 1-.254-1.285 41.059 41.059 0 0 1 8.198-5.424ZM6 11.459a29.848 29.848 0 0 0-2.455-1.158 41.029 41.029 0 0 0-.39 3.114.75.75 0 0 0 .419.74c.528.256 1.046.53 1.554.82-.21.324-.455.63-.739.914a.75.75 0 1 0 1.06 1.06c.37-.369.69-.77.96-1.193a26.61 26.61 0 0 1 3.095 2.348.75.75 0 0 0 .992 0 26.547 26.547 0 0 1 5.93-3.95.75.75 0 0 0 .42-.739 41.053 41.053 0 0 0-.39-3.114 29.925 29.925 0 0 0-5.199 2.801 2.25 2.25 0 0 1-2.514 0c-.41-.275-.826-.541-1.25-.797ZM11.909 8.548a35.014 35.014 0 0 1 5.316-2.684A29.834 29.834 0 0 1 17.5 9.716a35.02 35.02 0 0 0-4.192 2.084 32.52 32.52 0 0 0-3.594-2.975 30.958 30.958 0 0 0 2.195-.277Z" clipRule="evenodd"/>
    </svg>
  ),
  Dark: (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5">
      <path fillRule="evenodd" d="M7.455 2.004a.75.75 0 0 1 .26.77 7 7 0 0 0 9.958 7.967.75.75 0 0 1 1.067.853A8.5 8.5 0 1 1 6.647 1.921a.75.75 0 0 1 .808.083Z" clipRule="evenodd"/>
    </svg>
  ),
  Light: (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5">
      <path d="M10 2a.75.75 0 0 1 .75.75v1.5a.75.75 0 0 1-1.5 0v-1.5A.75.75 0 0 1 10 2ZM10 15a.75.75 0 0 1 .75.75v1.5a.75.75 0 0 1-1.5 0v-1.5A.75.75 0 0 1 10 15ZM10 7a3 3 0 1 0 0 6 3 3 0 0 0 0-6ZM15.657 5.404a.75.75 0 1 0-1.06-1.06l-1.061 1.06a.75.75 0 0 0 1.06 1.06l1.06-1.06ZM6.464 14.596a.75.75 0 1 0-1.06-1.06l-1.06 1.06a.75.75 0 0 0 1.06 1.06l1.06-1.06ZM18 10a.75.75 0 0 1-.75.75h-1.5a.75.75 0 0 1 0-1.5h1.5A.75.75 0 0 1 18 10ZM5 10a.75.75 0 0 1-.75.75h-1.5a.75.75 0 0 1 0-1.5h1.5A.75.75 0 0 1 5 10ZM14.596 15.657a.75.75 0 0 0 1.06-1.06l-1.06-1.061a.75.75 0 1 0-1.06 1.06l1.06 1.061ZM5.404 6.464a.75.75 0 0 0 1.06-1.06L5.403 4.343a.75.75 0 0 0-1.06 1.06l1.06 1.061Z"/>
    </svg>
  ),
}

const BASEMAPS: BasemapDef[] = [
  { id: 'dark', label: 'Dark', icon: BasemapIcons.Dark,
    style: makeBasemap('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}', '© Esri', 16) },
  { id: 'satellite', label: 'Satellite', icon: BasemapIcons.Satellite,
    style: makeBasemap('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', '© Esri', 18) },
  { id: 'osm', label: 'Streets', icon: BasemapIcons.Streets,
    style: makeBasemap('https://tile.openstreetmap.org/{z}/{x}/{y}.png', '© OpenStreetMap contributors', 19) },
  { id: 'terrain', label: 'Terrain', icon: BasemapIcons.Terrain,
    style: makeBasemap('https://tile.opentopomap.org/{z}/{x}/{y}.png', '© OpenTopoMap', 17) },
  { id: 'light', label: 'Light', icon: BasemapIcons.Light,
    style: makeBasemap('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}', '© Esri', 16) },
]

const VECTOR_COLORS = ['#F59E0B', '#3B82F6', '#EF4444', '#8B5CF6', '#EC4899', '#14B8A6']

// ── Palette tokens ────────────────────────────────────────────────────────────
// Panel background: very light green. Teal accents remain brand colors.
const P = {
  bg:       '#F4F9F8',   // very light teal-white
  bgHover:  '#E8F4F2',   // slightly deeper on hover
  border:   '#D4EAE7',   // soft teal border
  borderMd: '#A0CECC',   // medium teal border
  header:   '#EEF7F6',   // header slightly deeper
  text:     '#1A2624',   // near black for primary text
  textMid:  '#3D7A72',   // teal for mid-emphasis
  textLow:  '#6AA8A0',   // lighter teal for low-emphasis
  active:   '#D6EEED',   // active state bg
  activeBdr:'#A0CECC',
}

function calcAreaKm2(coords: number[][]): number {
  const R = 6371
  let area = 0
  for (let i = 0; i < coords.length - 1; i++) {
    const [x1, y1] = coords[i], [x2, y2] = coords[i + 1]
    area += (x2 - x1) * (y2 + y1)
  }
  const latMid = coords.reduce((s, c) => s + c[1], 0) / coords.length
  return Math.round(Math.abs(area / 2) * (Math.PI / 180) * R * (Math.PI / 180) * R * Math.cos((latMid * Math.PI) / 180) * 100) / 100
}

// ── Layer popover ─────────────────────────────────────────────────────────────
function LayerPopover({ layer, onClose, onZoomTo, onOpacityChange, anchorRef, isVector, currentColor, onColorChange }: {
  layer: Layer
  onClose: () => void
  onZoomTo: (l: Layer) => void
  onOpacityChange: (id: string, opacity: number) => void
  anchorRef: React.RefObject<HTMLButtonElement | null>
  isVector?: boolean
  currentColor?: string
  onColorChange?: (color: string) => void
}) {
  const rect = anchorRef.current?.getBoundingClientRect()
  const top  = rect ? rect.top : 0
  const left = rect ? rect.right + 8 : 0

  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div className="fixed z-50 shadow-2xl overflow-hidden"
        style={{ background: P.bg, border: `1px solid ${P.borderMd}`, top, left, width: 220, borderRadius: 12 }}
        onClick={e => e.stopPropagation()}>
        <div className="px-4 pt-3 pb-2.5" style={{ borderBottom: `1px solid ${P.border}` }}>
          <p className="text-xs font-semibold truncate" style={{ color: P.text }}>{layer.name}</p>
          <p className="text-xs mt-0.5 font-mono" style={{ color: P.textLow }}>EPSG:{layer.epsg || '—'}</p>
        </div>
        <div className="px-4 py-3">
          <div className="flex justify-between items-center mb-2">
            <span className="text-xs font-medium" style={{ color: P.textMid }}>Opacity</span>
            <span className="text-xs font-semibold text-[#3D7A72] tabular-nums">{Math.round(layer.opacity * 100)}%</span>
          </div>
          <div className="relative h-5 flex items-center">
            <div className="absolute w-full h-1" style={{ background: P.border, borderRadius: 99 }} />
            <div className="absolute h-1 bg-[#3D7A72]" style={{ width: `${layer.opacity * 100}%`, borderRadius: 99 }} />
            <input type="range" min={0} max={1} step={0.05} value={layer.opacity}
              onChange={e => onOpacityChange(layer.id, parseFloat(e.target.value))}
              className="absolute w-full opacity-0 cursor-pointer h-5" style={{ margin: 0 }} />
            <div className="absolute w-3 h-3 bg-[#3D7A72] shadow-lg pointer-events-none"
              style={{ left: `calc(${layer.opacity * 100}% - 6px)`, borderRadius: 99, border: `2px solid ${P.bg}` }} />
          </div>
        </div>
        {isVector && onColorChange && (
          <div className="px-4 py-2.5" style={{ borderTop: `1px solid ${P.border}` }}>
            <span className="text-xs font-medium block mb-2" style={{ color: P.textMid }}>Color</span>
            <div className="flex gap-1.5 flex-wrap">
              {VECTOR_COLORS.concat(['#22C55E', '#06B6D4', '#A855F7', '#F43F5E']).map(c => (
                <button key={c} onClick={() => onColorChange(c)}
                  title={c}
                  style={{
                    width: 20, height: 20, borderRadius: 99, background: c, flexShrink: 0,
                    border: currentColor === c ? `2px solid ${P.text}` : '2px solid transparent',
                    boxShadow: currentColor === c ? `0 0 0 1px ${P.bg}` : undefined,
                  }} />
              ))}
            </div>
          </div>
        )}
        {layer.bbox && (
          <div style={{ borderTop: `1px solid ${P.border}` }} className="px-2 pb-2">
            <button onClick={() => { onZoomTo(layer); onClose() }}
              className="flex items-center gap-2 w-full px-3 py-2 text-xs transition-colors hover:bg-[#E8F4F2]"
              style={{ borderRadius: 8, color: P.textMid }}>
              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
                <line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/>
              </svg>
              Zoom to layer
            </button>
          </div>
        )}
      </div>
    </>
  )
}

// ── Accordion with group toggle ───────────────────────────────────────────────
function Accordion({ title, icon, badge, children, defaultOpen = false, allVisible, onToggleAll }: {
  title: string
  icon?: React.ReactNode
  badge?: number
  children: React.ReactNode
  defaultOpen?: boolean
  allVisible?: boolean      // undefined = no toggle shown
  onToggleAll?: () => void
}) {
  const [open, setOpen] = useState(defaultOpen)
  useEffect(() => { setOpen(defaultOpen) }, [defaultOpen])

  return (
    <div style={{ borderBottom: `1px solid ${P.border}` }} className="last:border-0">
      <div className="flex items-center">
        <button onClick={() => setOpen(o => !o)}
          className="flex-1 flex items-center gap-2.5 px-4 py-3 transition-colors text-left min-w-0 hover:bg-[#E8F4F2]">
          {icon && <span className="flex-shrink-0 w-3.5" style={{ color: P.textLow }}>{icon}</span>}
          <span className="text-[10px] font-bold tracking-widest uppercase flex-1 truncate" style={{ color: P.textMid }}>{title}</span>
          {badge !== undefined && badge > 0 && (
            <span className="text-[10px] px-1.5 py-0.5 font-semibold tabular-nums flex-shrink-0" style={{ background: '#D6EEED', color: P.textMid, borderRadius: 99 }}>
              {badge}
            </span>
          )}
          <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24"
            fill="none" stroke="currentColor" strokeWidth="2.5"
            className="flex-shrink-0 transition-transform duration-200"
            style={{ color: P.textLow, transform: open ? 'rotate(180deg)' : 'rotate(0deg)' }}>
            <polyline points="6 9 12 15 18 9"/>
          </svg>
        </button>

        {/* Group visibility toggle — only shown when there's something to toggle */}
        {onToggleAll !== undefined && badge !== undefined && badge > 0 && (
          <button
            onClick={e => { e.stopPropagation(); onToggleAll() }}
            title={allVisible ? 'Hide all' : 'Show all'}
            className="px-2.5 py-3 transition-colors flex-shrink-0 hover:bg-[#E8F4F2]"
            style={{ borderLeft: `1px solid ${P.border}`, color: allVisible ? P.textMid : P.textLow }}>
            {allVisible ? (
              // Eye open
              <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>
              </svg>
            ) : (
              // Eye closed
              <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/>
                <line x1="1" y1="1" x2="23" y2="23"/>
              </svg>
            )}
          </button>
        )}
      </div>

      <div className="overflow-hidden transition-all duration-200"
        style={{ maxHeight: open ? '900px' : '0px', opacity: open ? 1 : 0 }}>
        {children}
      </div>
    </div>
  )
}

// ── Layer row ─────────────────────────────────────────────────────────────────
function LayerRow({ layer, colorDot, onToggle, onZoomTo, onOpacityChange, isVector, onColorChange }: {
  layer: Layer
  colorDot?: string
  onToggle: () => void
  onZoomTo: (l: Layer) => void
  onOpacityChange: (id: string, opacity: number) => void
  isVector?: boolean
  onColorChange?: (id: string, color: string) => void
}) {
  const [showPopover, setShowPopover] = useState(false)
  const btnRef = useRef<HTMLButtonElement | null>(null)

  return (
    <div className="relative group flex items-center gap-2.5 pl-8 pr-3 py-2 transition-colors"
      style={{ background: 'transparent' }}
      onMouseEnter={e => (e.currentTarget.style.background = P.bgHover)}
      onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>

      <button onClick={onToggle}
        className="w-3.5 h-3.5 flex-shrink-0 border transition-all flex items-center justify-center"
        style={{
          borderRadius: 4,
          borderColor: layer.visible ? '#3D7A72' : P.borderMd,
          background: layer.visible ? '#3D7A72' : 'transparent',
        }}>
        {layer.visible && (
          <svg viewBox="0 0 10 8" fill="none" className="w-2.5 h-2.5">
            <polyline points="1,4 3.5,6.5 9,1" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        )}
      </button>

      {colorDot && (
        <div className="w-2 h-2 flex-shrink-0" style={{ borderRadius: 99, backgroundColor: colorDot }} />
      )}

      <div className={`flex-1 min-w-0 ${layer.bbox ? 'cursor-pointer' : 'cursor-default'}`}
        onClick={() => { if (layer.bbox) onZoomTo(layer) }}>
        <p className="text-xs font-medium truncate transition-colors"
          style={{ color: layer.visible ? P.text : P.textLow }}>
          {layer.name}
        </p>
        <div className="flex items-center gap-1.5 mt-0.5">
          <div className="w-8 h-0.5 overflow-hidden" style={{ borderRadius: 99, background: P.border }}>
            <div className="h-full bg-[#3D7A72]/50 transition-all" style={{ width: `${layer.opacity * 100}%`, borderRadius: 99 }} />
          </div>
          <span className="text-[10px] font-mono" style={{ color: P.textLow }}>{layer.epsg || '—'}</span>
        </div>
      </div>

      <button ref={btnRef}
        onClick={e => { e.stopPropagation(); setShowPopover(s => !s) }}
        className="flex items-center justify-center w-6 h-6 transition-all flex-shrink-0 hover:bg-[#D6EEED]"
        style={{ borderRadius: 6, color: P.textLow }}>
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
          <circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/>
        </svg>
      </button>

      {showPopover && (
        <LayerPopover layer={layer} onClose={() => setShowPopover(false)}
          onZoomTo={onZoomTo} onOpacityChange={onOpacityChange}
          anchorRef={{ current: btnRef.current }}
          isVector={isVector}
          currentColor={colorDot}
          onColorChange={onColorChange ? (c) => { onColorChange(layer.id, c); setShowPopover(false) } : undefined} />
      )}
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function MapPage() {
  return (
    <Suspense fallback={<div className="absolute inset-0 flex items-center justify-center" style={{ background: '#111827' }} />}>
      <MapPageInner />
    </Suspense>
  )
}

function MapPageInner() {
  const { user, isLoaded } = useUser()
  const searchParams = useSearchParams()
  const viewAsParam  = searchParams.get('viewAs')
  const focusParam   = searchParams.get('focus')
  const [viewingAsAdmin, setViewingAsAdmin] = useState(false)
  const focusedRef = useRef(false)
  const initialFitRef = useRef(false)
  const mapContainer = useRef<HTMLDivElement>(null)
  const map          = useRef<maplibregl.Map | null>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const draw         = useRef<any>(null)
  const layersRef    = useRef<Layer[]>([])

  const [layers,      setLayers]      = useState<Layer[]>([])
  const [mlOutputs,   setMlOutputs]   = useState<MLOutput[]>([])
  const [basemap,     setBasemap]     = useState('dark')
  const [mapReady,    setMapReady]    = useState(false)
  const [layersLoading, setLayersLoading] = useState(false)
  const [clientReady, setClientReady] = useState(false)
  const [drawMode,    setDrawMode]    = useState(false)
  const [aoi,         setAoi]         = useState<AOIFeature | null>(null)
  const [fetchErr,    setFetchErr]    = useState(false)
  const [aoiName,     setAoiName]     = useState('')
  const [savingAoi,   setSavingAoi]   = useState(false)
  const [aoiSaved,    setAoiSaved]    = useState(false)
  const [layerColors, setLayerColors] = useState<Record<string, string>>({})
  const [featurePanel, setFeaturePanel] = useState<{ layerName: string; props: Record<string, unknown> } | null>(null)
  const [loadingRasterSources, setLoadingRasterSources] = useState<Set<string>>(new Set())
  const rasterSourceIds = useRef<Set<string>>(new Set())

  const API = process.env.NEXT_PUBLIC_API_URL || 'https://timbermap-api-tjrp7tcqaa-uc.a.run.app'

  // ?viewAs=<clerk_id> lets superadmin open another user's map (used by the
  // superadmin panel's "View on map" action) — verify the caller is actually
  // superadmin before trusting it.
  useEffect(() => {
    if (!viewAsParam || !user) return
    fetch(`${API}/superadmin/am-i-admin`, { headers: { 'x-clerk-id': user.id } })
      .then(r => r.json())
      .then(d => setViewingAsAdmin(!!d.is_superadmin))
      .catch(() => setViewingAsAdmin(false))
  }, [viewAsParam, user, API])

  const effectiveClerkId = (viewAsParam && viewingAsAdmin) ? viewAsParam : user?.id

  useEffect(() => {
    setClientReady(true)
    setLayersLoading(true)
    const fromJobs = sessionStorage.getItem('ml_outputs_pending') === '1'
    if (fromJobs) {
      sessionStorage.removeItem('ml_outputs_pending')
      try {
        const stored = JSON.parse(sessionStorage.getItem('ml_outputs') || '[]')
        setMlOutputs(stored.map((o: MLOutput) => ({
          ...o, opacity: o.opacity ?? 0.85, visible: o.visible ?? true,
        })))
      } catch {}
    } else {
      sessionStorage.removeItem('ml_outputs')
      setMlOutputs([])
    }
  }, [])

  const fetchLayers = useCallback(async (retrying = false) => {
    if (!isLoaded || !user || !effectiveClerkId) return
    if (viewAsParam && !viewingAsAdmin) return
    try {
      const res = await fetch(`${API}/layers/${effectiveClerkId}`)
      if (!res.ok) {
        if ((res.status === 401 || res.status === 403) && !retrying) { window.location.reload(); return }
        throw new Error(`HTTP ${res.status}`)
      }
      const data = await res.json()
      setFetchErr(false)
      setLayers(prev => {
        const visMap = new Map(prev.map(l => [l.id, l.visible]))
        const opMap  = new Map(prev.map(l => [l.id, l.opacity]))
        return (data.layers || []).map((l: Omit<Layer, 'visible' | 'opacity'>) => ({
          ...l,
          visible: visMap.has(l.id) ? visMap.get(l.id)! : true,
          opacity: opMap.has(l.id)  ? opMap.get(l.id)!  : 0.85,
        }))
      })
    } catch { setFetchErr(true) }
    finally { setLayersLoading(false) }
  }, [user, isLoaded, API, effectiveClerkId, viewAsParam, viewingAsAdmin])

  useEffect(() => { if (isLoaded && user) fetchLayers() }, [user, isLoaded, fetchLayers])

  // Keep layersRef in sync for map click handler
  useEffect(() => { layersRef.current = layers }, [layers])

  // Crosshair cursor when drawing
  useEffect(() => {
    if (!mapReady || !map.current) return
    map.current.getCanvas().style.cursor = drawMode ? 'crosshair' : ''
  }, [drawMode, mapReady])

  // Zoom to image from ?bbox= param
  useEffect(() => {
    if (!mapReady || !map.current) return
    const params = new URLSearchParams(window.location.search)
    const bbox = params.get('bbox')
    if (!bbox) return
    const parts = bbox.split(',').map(Number)
    if (parts.length !== 4 || parts.some(isNaN)) return
    const [minx, miny, maxx, maxy] = parts
    map.current.fitBounds([[minx, miny], [maxx, maxy]], { padding: 80, duration: 900, maxZoom: 18 })
    initialFitRef.current = true
  }, [mapReady])

  // No explicit ?bbox=/?focus= target: once layers finish loading, fit the
  // view to every visible layer so nothing is left off-screen out of view.
  useEffect(() => {
    if (!mapReady || !map.current || layersLoading || initialFitRef.current) return
    const params = new URLSearchParams(window.location.search)
    if (params.get('bbox') || params.get('focus')) { initialFitRef.current = true; return }
    const boxes = layers.filter(l => l.visible !== false && l.bbox).map(l => l.bbox as [number, number, number, number])
    if (boxes.length === 0) return
    initialFitRef.current = true
    const [minx, miny, maxx, maxy] = boxes.reduce(
      ([aminx, aminy, amaxx, amaxy], [bminx, bminy, bmaxx, bmaxy]) =>
        [Math.min(aminx, bminx), Math.min(aminy, bminy), Math.max(amaxx, bmaxx), Math.max(amaxy, bmaxy)],
      boxes[0]
    )
    map.current.fitBounds([[minx, miny], [maxx, maxy]], { padding: 80, duration: 900, maxZoom: 18 })
  }, [layers, mapReady, layersLoading])

  // Init map
  useEffect(() => {
    if (!mapContainer.current || map.current) return
    maplibregl.addProtocol('cog', cogProtocol)
    map.current = new maplibregl.Map({
      container: mapContainer.current,
      style: BASEMAPS.find(b => b.id === 'dark')!.style,
      center: [-60, -35],
      zoom: 4,
    })
    map.current.addControl(new maplibregl.NavigationControl(), 'top-right')
    map.current.addControl(new maplibregl.ScaleControl(), 'bottom-right')
    draw.current = new MapboxDraw({
      displayControlsDefault: false,
      controls: { polygon: true, trash: true },
      defaultMode: 'simple_select',
      styles: [
        { id: 'gl-draw-polygon-fill', type: 'fill',
          filter: ['all', ['==', '$type', 'Polygon'], ['!=', 'mode', 'static']],
          paint: { 'fill-color': '#F97316', 'fill-opacity': 0.20 } },
        { id: 'gl-draw-polygon-stroke', type: 'line',
          filter: ['all', ['==', '$type', 'Polygon'], ['!=', 'mode', 'static']],
          paint: { 'line-color': '#F97316', 'line-width': 2.5, 'line-dasharray': [2, 1] } },
        { id: 'gl-draw-vertex', type: 'circle',
          filter: ['all', ['==', 'meta', 'vertex'], ['==', '$type', 'Point']],
          paint: { 'circle-radius': 6, 'circle-color': '#F97316', 'circle-stroke-width': 2, 'circle-stroke-color': '#fff' } },
        { id: 'gl-draw-midpoint', type: 'circle',
          filter: ['all', ['==', '$type', 'Point'], ['==', 'meta', 'midpoint']],
          paint: { 'circle-radius': 4, 'circle-color': '#FBBF24', 'circle-stroke-width': 1, 'circle-stroke-color': '#fff' } },
      ],
    })
    map.current.addControl(draw.current, 'top-right')
    map.current.on('draw.create', (e: { features: GeoJSON.Feature[] }) => {
      const feature = e.features[0]
      if (!feature || feature.geometry.type !== 'Polygon') return
      const coords = (feature.geometry as GeoJSON.Polygon).coordinates[0] as number[][]
      setAoi({ id: String(feature.id), geometry: feature.geometry, area_km2: calcAreaKm2(coords) })
      setAoiName(''); setAoiSaved(false)
      setTimeout(() => draw.current.changeMode('simple_select'), 0)
      setDrawMode(false)
    })
    map.current.on('draw.delete', () => { setAoi(null); setDrawMode(false); setAoiSaved(false) })

    map.current.on('click', (e) => {
      const currentLayers = layersRef.current
      const vectorFillIds = currentLayers
        .filter(l => l.type === 'vector' && l.visible)
        .map(l => `layer-${l.id}-fill`)
        .filter(id => map.current?.getLayer(id))
      if (vectorFillIds.length === 0) return
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const features = (map.current as any).queryRenderedFeatures(e.point, { layers: vectorFillIds })
      if (!features || features.length === 0) return
      const feat = features[0]
      const mapLayerId: string = feat.layer.id // e.g. "layer-{uuid}-fill"
      const layerId = mapLayerId.replace(/^layer-/, '').replace(/-fill$/, '')
      const layer = currentLayers.find(l => l.id === layerId)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const props: Record<string, unknown> = feat.properties || {}
      setFeaturePanel({ layerName: layer?.name || 'Layer', props })
    })

    map.current.on('load', () => setMapReady(true))

    // Track raster COG sources actively fetching/decoding tiles, so we can
    // show a spinner — large images can take a few seconds to render via
    // client-side range requests, and with no feedback it looks broken.
    map.current.on('sourcedataloading', (e: { sourceId?: string }) => {
      if (!e.sourceId || !rasterSourceIds.current.has(e.sourceId)) return
      setLoadingRasterSources(prev => prev.has(e.sourceId!) ? prev : new Set(prev).add(e.sourceId!))
    })
    map.current.on('sourcedata', (e: { sourceId?: string; isSourceLoaded?: boolean }) => {
      if (!e.sourceId || !rasterSourceIds.current.has(e.sourceId) || !e.isSourceLoaded) return
      setLoadingRasterSources(prev => {
        if (!prev.has(e.sourceId!)) return prev
        const next = new Set(prev); next.delete(e.sourceId!); return next
      })
    })

    return () => {
      maplibregl.removeProtocol('cog')
      map.current?.remove()
      map.current = null
      sessionStorage.removeItem('ml_outputs')
      sessionStorage.removeItem('ml_outputs_pending')
    }
  }, [])

  // Render regular layers
  useEffect(() => {
    if (!map.current || !mapReady) return
    const firstMLLayerId = mlOutputs.length > 0 ? `ml-layer-${mlOutputs[0].id}` : undefined
    const beforeId = firstMLLayerId && map.current.getLayer(firstMLLayerId) ? firstMLLayerId : undefined
    layers.forEach((layer, idx) => {
      const sourceId   = `source-${layer.id}`
      const layerId    = `layer-${layer.id}`
      const visibility = layer.visible ? 'visible' : 'none'
      if (layer.type === 'raster' && layer.cog_url) {
        if (!map.current!.getSource(sourceId)) {
          rasterSourceIds.current.add(sourceId)
          map.current!.addSource(sourceId, { type: 'raster', url: `cog://${layer.cog_url}`, tileSize: 256 })
          map.current!.addLayer({ id: layerId, type: 'raster', source: sourceId,
            paint: { 'raster-opacity': layer.opacity }, layout: { visibility } }, beforeId)
        } else {
          map.current!.setLayoutProperty(layerId, 'visibility', visibility)
          map.current!.setPaintProperty(layerId, 'raster-opacity', layer.opacity)
        }
      }
      if (layer.type === 'vector' && layer.tiles_url) {
        const color = layerColors[layer.id] || VECTOR_COLORS[idx % VECTOR_COLORS.length]
        const fillId = `${layerId}-fill`, strokeId = `${layerId}-stroke`
        if (!map.current!.getSource(sourceId)) {
          map.current!.addSource(sourceId, { type: 'vector', tiles: [layer.tiles_url], minzoom: 0, maxzoom: 14 })
          map.current!.addLayer({ id: fillId, type: 'fill', source: sourceId, 'source-layer': 'layer',
            paint: { 'fill-color': color, 'fill-opacity': layer.opacity * 0.35 }, layout: { visibility } }, beforeId)
          map.current!.addLayer({ id: strokeId, type: 'line', source: sourceId, 'source-layer': 'layer',
            paint: { 'line-color': color, 'line-width': 1.5, 'line-opacity': layer.opacity }, layout: { visibility } }, beforeId)
        } else {
          map.current!.setLayoutProperty(fillId, 'visibility', visibility)
          map.current!.setLayoutProperty(strokeId, 'visibility', visibility)
          map.current!.setPaintProperty(fillId, 'fill-opacity', layer.opacity * 0.35)
          map.current!.setPaintProperty(strokeId, 'line-opacity', layer.opacity)
        }
      }
    })
  }, [layers, mapReady, mlOutputs])

  // ?focus=<layer_id> — auto-zoom once to the layer the superadmin panel
  // linked to (only once, so panning afterward isn't fought).
  useEffect(() => {
    if (!focusParam || !mapReady || focusedRef.current) return
    const target = layers.find(l => l.id === focusParam)
    if (!target) return
    zoomToLayer(target)
    focusedRef.current = true
  }, [focusParam, layers, mapReady])

  // Render ML output layers
  useEffect(() => {
    if (!map.current || !mapReady) return
    mlOutputs.forEach((output, idx) => {
      const sourceId = `ml-source-${output.id}`
      const layerId  = `ml-layer-${output.id}`
      const visibility = output.visible !== false ? 'visible' : 'none'
      const opacity = output.opacity ?? 0.85

      if (output.type === 'raster' && output.cog_url) {
        if (!map.current!.getSource(sourceId)) {
          rasterSourceIds.current.add(sourceId)
          map.current!.addSource(sourceId, { type: 'raster', url: `cog://${output.cog_url}`, tileSize: 256 })
          map.current!.addLayer({ id: layerId, type: 'raster', source: sourceId,
            paint: { 'raster-opacity': opacity }, layout: { visibility } })
        } else {
          map.current!.setPaintProperty(layerId, 'raster-opacity', opacity)
          map.current!.setLayoutProperty(layerId, 'visibility', visibility)
        }
      }

      if (output.type === 'vector' && output.geojson_url) {
        const circleId = `${layerId}-circle`
        const fillId   = `${layerId}-fill`
        const lineId   = `${layerId}-line`
        if (map.current!.getSource(sourceId)) {
          if (map.current!.getLayer(circleId)) {
            map.current!.setLayoutProperty(circleId, 'visibility', visibility)
            map.current!.setPaintProperty(circleId, 'circle-opacity', opacity)
            map.current!.setPaintProperty(circleId, 'circle-stroke-opacity', opacity)
          }
          if (map.current!.getLayer(fillId)) {
            map.current!.setLayoutProperty(fillId, 'visibility', visibility)
            map.current!.setPaintProperty(fillId, 'fill-opacity', opacity * 0.35)
          }
          if (map.current!.getLayer(lineId)) {
            map.current!.setLayoutProperty(lineId, 'visibility', visibility)
            map.current!.setPaintProperty(lineId, 'line-opacity', opacity)
          }
          return
        }
        fetch(output.geojson_url, { mode: 'cors' })
          .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() })
          .then(async geojson => {
            if (!map.current || map.current.getSource(sourceId)) return
            const outputEpsg = output.epsg
            if (outputEpsg && outputEpsg !== 4326) {
              try {
                const proj4 = (await import('proj4')).default
                const fromCRS = `EPSG:${outputEpsg}`
                if (!proj4.defs(fromCRS)) {
                  const res = await fetch(`https://epsg.io/${outputEpsg}.proj4`)
                  const def = await res.text()
                  proj4.defs(fromCRS, def)
                }
                const transformer = proj4(fromCRS, 'EPSG:4326')
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                geojson = {
                  ...geojson,
                  features: geojson.features.map((feat: any) => {
                    if (!feat.geometry) return feat
                    const geom = feat.geometry
                    if (geom.type === 'Point') {
                      const [x, y] = transformer.forward(geom.coordinates as [number, number])
                      return { ...feat, geometry: { ...geom, coordinates: [x, y] } }
                    }
                    if (geom.type === 'MultiPoint' || geom.type === 'LineString') {
                      const coords = (geom.coordinates as [number, number][]).map((c: [number, number]) => transformer.forward(c))
                      return { ...feat, geometry: { ...geom, coordinates: coords } }
                    }
                    if (geom.type === 'Polygon' || geom.type === 'MultiLineString') {
                      const coords = (geom.coordinates as [number, number][][]).map((ring: [number, number][]) =>
                        ring.map((c: [number, number]) => transformer.forward(c))
                      )
                      return { ...feat, geometry: { ...geom, coordinates: coords } }
                    }
                    return feat
                  })
                }
              } catch (err) { console.warn('Reprojection failed:', err) }
            }
            map.current.addSource(sourceId, { type: 'geojson', data: geojson })
            const color = VECTOR_COLORS[(idx + 10) % VECTOR_COLORS.length]
            const geomType = geojson.features?.[0]?.geometry?.type || ''
            if (geomType === 'Point' || geomType === 'MultiPoint') {
              map.current.addLayer({
                id: circleId, type: 'circle', source: sourceId,
                paint: {
                  'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 2, 16, 5],
                  'circle-color': color, 'circle-opacity': opacity,
                  'circle-stroke-width': 0.5, 'circle-stroke-color': '#fff', 'circle-stroke-opacity': opacity,
                },
                layout: { visibility },
              })
            } else {
              map.current.addLayer({
                id: fillId, type: 'fill', source: sourceId,
                paint: { 'fill-color': color, 'fill-opacity': opacity * 0.35 },
                layout: { visibility },
              })
              map.current.addLayer({
                id: lineId, type: 'line', source: sourceId,
                paint: { 'line-color': color, 'line-width': 1.5, 'line-opacity': opacity },
                layout: { visibility },
              })
            }
            if (output.bbox) {
              map.current.fitBounds(
                [[output.bbox[0], output.bbox[1]], [output.bbox[2], output.bbox[3]]],
                { padding: 60, duration: 900, maxZoom: 18 }
              )
            }
          })
          .catch(err => console.error('GeoJSON load failed:', err))
      }
    })
  }, [mlOutputs, mapReady])

  function removeMLOutput(outputId: string) {
    const stored = JSON.parse(sessionStorage.getItem('ml_outputs') || '[]')
    const filtered = stored.filter((e: { id: string }) => e.id !== outputId)
    sessionStorage.setItem('ml_outputs', JSON.stringify(filtered))
    setMlOutputs(filtered)
    if (map.current) {
      const sourceId = `ml-source-${outputId}`
      const layerId  = `ml-layer-${outputId}`
      const toRemove = [`${layerId}-circle`, `${layerId}-fill`, `${layerId}-line`, layerId]
      toRemove.forEach(id => { if (map.current!.getLayer(id)) map.current!.removeLayer(id) })
      if (map.current.getSource(sourceId)) map.current.removeSource(sourceId)
      rasterSourceIds.current.delete(sourceId)
      setLoadingRasterSources(prev => {
        if (!prev.has(sourceId)) return prev
        const next = new Set(prev); next.delete(sourceId); return next
      })
    }
  }

  function zoomToLayer(layer: Layer) {
    if (!map.current || !layer.bbox) return
    const [minx, miny, maxx, maxy] = layer.bbox
    map.current.fitBounds([[minx, miny], [maxx, maxy]], { padding: 60, duration: 900, maxZoom: 18 })
  }

  function toggleLayer(id: string) { setLayers(prev => prev.map(l => l.id === id ? { ...l, visible: !l.visible } : l)) }
  function setOpacity(id: string, opacity: number) { setLayers(prev => prev.map(l => l.id === id ? { ...l, opacity } : l)) }
  function setLayerColor(id: string, color: string) {
    setLayerColors(prev => ({ ...prev, [id]: color }))
    if (!map.current) return
    const fillId = `layer-${id}-fill`, strokeId = `layer-${id}-stroke`
    if (map.current.getLayer(fillId)) {
      map.current.setPaintProperty(fillId, 'fill-color', color)
      map.current.setPaintProperty(strokeId, 'line-color', color)
    }
  }
  function toggleMLOutput(id: string) { setMlOutputs(prev => prev.map(o => o.id === id ? { ...o, visible: !o.visible } : o)) }
  function setMLOpacity(id: string, opacity: number) { setMlOutputs(prev => prev.map(o => o.id === id ? { ...o, opacity } : o)) }

  function zoomToMLOutput(output: MLOutput) {
    if (!map.current) return
    if (output.bbox && (output.bbox[0] !== 0 || output.bbox[1] !== 0 || output.bbox[2] !== 0)) {
      map.current.fitBounds([[output.bbox[0], output.bbox[1]], [output.bbox[2], output.bbox[3]]], { padding: 60, duration: 900, maxZoom: 18 })
      return
    }
    if (output.image_id) {
      const imgLayer = layers.find(l => l.id === output.image_id)
      if (imgLayer?.bbox) {
        map.current.fitBounds([[imgLayer.bbox[0], imgLayer.bbox[1]], [imgLayer.bbox[2], imgLayer.bbox[3]]], { padding: 60, duration: 900, maxZoom: 18 })
      }
    }
  }

  function changeBasemap(id: string) {
    setBasemap(id)
    const bm = BASEMAPS.find(b => b.id === id)
    if (!bm || !map.current) return
    map.current.setStyle(bm.style)
    map.current.once('styledata', () => setLayers(prev => [...prev]))
  }

  function toggleDrawMode() {
    if (!draw.current) return
    if (drawMode) { setTimeout(() => draw.current.changeMode('simple_select'), 0); setDrawMode(false) }
    else { draw.current.deleteAll(); setAoi(null); setAoiSaved(false); draw.current.changeMode('draw_polygon'); setDrawMode(true) }
  }

  function clearAoi() { draw.current?.deleteAll(); setAoi(null); setDrawMode(false); setAoiSaved(false) }
  function copyAoi()  { if (aoi) navigator.clipboard.writeText(JSON.stringify(aoi.geometry, null, 2)) }

  async function saveAoiAsVector() {
    if (!aoi || !user || !aoiName.trim()) return
    setSavingAoi(true)
    try {
      const res = await fetch(`${API}/vectors/from-aoi`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clerk_id: user.id, name: aoiName.trim(), geojson: aoi.geometry }),
      })
      if (!res.ok) throw new Error('Failed to save')
      setAoiSaved(true)
      await fetchLayers()
    } catch (e) { console.error('Save AOI failed', e) }
    finally { setSavingAoi(false) }
  }

  const imageLayers  = layers.filter(l => l.type === 'raster')
  const vectorLayers = layers.filter(l => l.type === 'vector')

  const allImagesVisible  = imageLayers.every(l => l.visible)
  const allVectorsVisible = vectorLayers.every(l => l.visible)
  const allResultsVisible = mlOutputs.every(o => o.visible !== false)

  function toggleAllImages()  { const v = !allImagesVisible;  setLayers(prev => prev.map(l => l.type === 'raster' ? { ...l, visible: v } : l)) }
  function toggleAllVectors() { const v = !allVectorsVisible; setLayers(prev => prev.map(l => l.type === 'vector' ? { ...l, visible: v } : l)) }
  function toggleAllResults() { const v = !allResultsVisible; setMlOutputs(prev => prev.map(o => ({ ...o, visible: v }))) }

  return (
    <div className="flex -m-4 sm:-m-6 lg:-m-8" style={{ height: 'calc(100vh)', overflow: 'hidden' }}>

      {/* ── Panel ────────────────────────────────────────────────────────── */}
      <div className="w-64 lg:w-72 flex flex-col flex-shrink-0" style={{ background: P.bg, borderRight: `1px solid ${P.border}` }}>

        {/* Header — h-16 matches main sidebar logo section */}
        <div className="flex items-center justify-between px-5 h-16 flex-shrink-0"
          style={{ background: P.header, borderBottom: `1px solid ${P.border}` }}>
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0"
              style={{ background: '#D6EEED', border: `1px solid ${P.activeBdr}` }}>
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4 text-[#3D7A72]">
                <path fillRule="evenodd" d="M8.157 2.176a1.5 1.5 0 0 0-1.147 0l-4.084 1.69A1.5 1.5 0 0 0 2 5.25v10.877a1.5 1.5 0 0 0 2.074 1.386l3.51-1.452 4.26 1.762a1.5 1.5 0 0 0 1.146 0l4.083-1.69A1.5 1.5 0 0 0 18 14.75V3.872a1.5 1.5 0 0 0-2.073-1.386l-3.51 1.452-4.26-1.762ZM7.5 5v11.25L5 17.5V5.75l2.5-1.034V5Zm2.5 11.25V5L12.5 3.75v11.25L10 16.25Zm2.5.5v-11.5l2.5-1.034V14.25l-2.5 1.034v-.5.466Z" clipRule="evenodd"/>
              </svg>
            </div>
            <span className="text-sm font-semibold tracking-wide" style={{ color: P.text }}>Map Viewer</span>
          </div>
          <span className="text-[10px] font-mono" style={{ color: P.textLow }}>
            {layers.length + mlOutputs.length > 0
              ? `${layers.length + mlOutputs.length}L`
              : '0L'}
          </span>
        </div>

        {/* Scrollable layer list */}
        <div className="flex-1 overflow-y-auto" suppressHydrationWarning>
          {clientReady && layersLoading ? (
            <div className="flex flex-col items-center justify-center gap-3 py-16">
              <div className="w-5 h-5 border-2 animate-spin" style={{ borderRadius: 99, borderColor: P.borderMd, borderTopColor: '#3D7A72' }} />
              <span className="text-[10px] tracking-widest uppercase" style={{ color: P.textLow }}>Loading layers</span>
            </div>
          ) : (
            <>
              {/* ML Results */}
              {mlOutputs.length > 0 && (
                <Accordion
                  title="Results"
                  icon={<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>}
                  badge={mlOutputs.length}
                  defaultOpen={true}
                  allVisible={allResultsVisible}
                  onToggleAll={toggleAllResults}>
                  <div className="pb-1">
                    {mlOutputs.map((output, idx) => {
                      const hasBbox = !!(output.bbox || output.image_id)
                      const asLayer: Layer = {
                        id: output.id, name: output.name,
                        type: output.type === 'vector' ? 'vector' : 'raster',
                        epsg: output.epsg ? String(output.epsg) : null,
                        visible: output.visible !== false,
                        opacity: output.opacity ?? 0.85,
                        bbox: output.bbox ?? (hasBbox ? [0,0,0,0] : null),
                      }
                      return (
                        <LayerRow key={output.id}
                          layer={asLayer}
                          colorDot={VECTOR_COLORS[(idx + 10) % VECTOR_COLORS.length]}
                          onToggle={() => toggleMLOutput(output.id)}
                          onZoomTo={() => zoomToMLOutput(output)}
                          onOpacityChange={setMLOpacity}
                        />
                      )
                    })}
                  </div>
                </Accordion>
              )}

              {/* Images */}
              <Accordion
                title="Images"
                icon={<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>}
                badge={imageLayers.length}
                defaultOpen={imageLayers.length > 0}
                allVisible={allImagesVisible}
                onToggleAll={toggleAllImages}>
                {imageLayers.length === 0 ? (
                  <p className="pl-8 pr-4 pb-3 text-xs" style={{ color: P.textLow }}>No images uploaded yet.</p>
                ) : (
                  <div className="pb-1">
                    {imageLayers.map(layer => (
                      <LayerRow key={layer.id} layer={layer}
                        onToggle={() => toggleLayer(layer.id)}
                        onZoomTo={zoomToLayer} onOpacityChange={setOpacity} />
                    ))}
                  </div>
                )}
              </Accordion>

              {/* Vectors */}
              <Accordion
                title="Vectors"
                icon={<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6"/><line x1="8" y1="2" x2="8" y2="18"/><line x1="16" y1="6" x2="16" y2="22"/></svg>}
                badge={vectorLayers.length}
                defaultOpen={vectorLayers.length > 0}
                allVisible={allVectorsVisible}
                onToggleAll={toggleAllVectors}>
                {vectorLayers.length === 0 ? (
                  <p className="pl-8 pr-4 pb-3 text-xs" style={{ color: P.textLow }}>No vectors uploaded yet.</p>
                ) : (
                  <div className="pb-1">
                    {vectorLayers.map((layer, idx) => {
                      const color = layerColors[layer.id] || VECTOR_COLORS[idx % VECTOR_COLORS.length]
                      return (
                      <LayerRow key={layer.id} layer={layer}
                        colorDot={color}
                        onToggle={() => toggleLayer(layer.id)}
                        onZoomTo={zoomToLayer} onOpacityChange={setOpacity}
                        isVector={true}
                        onColorChange={setLayerColor} />
                    )})}
                  </div>
                )}
              </Accordion>

              {/* AOI */}
              <Accordion
                title="Area of Interest"
                icon={<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>}
                defaultOpen={!!aoi}>
                <div className="pl-8 pr-4 pb-3">
                  {aoi ? (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between py-1.5 px-2.5"
                        style={{ background: 'rgba(61,122,114,0.15)', border: '1px solid rgba(61,122,114,0.25)', borderRadius: 10 }}>
                        <span className="text-xs font-medium text-[#3D7A72]">Polygon drawn</span>
                        <span className="text-xs font-mono" style={{ color: P.textMid }}>{aoi.area_km2} km²</span>
                      </div>
                      {!aoiSaved ? (
                        <div className="space-y-1.5">
                          <input
                            type="text"
                            placeholder="Name this area..."
                            value={aoiName}
                            onChange={e => setAoiName(e.target.value)}
                            onKeyDown={e => e.key === 'Enter' && aoiName.trim() && saveAoiAsVector()}
                            className="w-full text-xs px-2.5 py-1.5 focus:outline-none transition-colors"
                            style={{ background: 'white', border: `1px solid ${P.borderMd}`, borderRadius: 7, color: P.text }}
                          />
                          <button
                            onClick={saveAoiAsVector}
                            disabled={!aoiName.trim() || savingAoi}
                            className="w-full text-xs py-1.5 text-[#6AA8A0] transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-1.5"
                            style={{ background: 'rgba(61,122,114,0.30)', border: '1px solid rgba(61,122,114,0.40)', borderRadius: 10 }}>
                            {savingAoi ? (
                              <><svg className="animate-spin" xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>Saving...</>
                            ) : (
                              <><svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>Save to Vectors</>
                            )}
                          </button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1.5 px-2.5 py-1.5"
                          style={{ background: 'rgba(74,222,128,0.08)', border: '1px solid rgba(74,222,128,0.20)', borderRadius: 10 }}>
                          <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#4ade80" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                          <span className="text-xs text-green-400">Saved to Vectors</span>
                        </div>
                      )}
                      <div className="flex gap-1.5">
                        <button onClick={copyAoi}
                          className="flex-1 text-xs py-1.5 transition-colors hover:bg-[#D6EEED]"
                          style={{ color: P.textMid, background: P.bgHover, border: `1px solid ${P.borderMd}`, borderRadius: 10 }}>
                          Copy JSON
                        </button>
                        <button onClick={clearAoi}
                          className="flex-1 text-xs py-1.5 text-red-400/70 hover:text-red-400 transition-colors"
                          style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.15)', borderRadius: 10 }}>
                          Clear
                        </button>
                      </div>
                      <button
                        onClick={() => {
                          if (aoi) {
                            localStorage.setItem('map_drawn_aoi', JSON.stringify({ type: 'Feature', geometry: aoi.geometry, properties: {} }))
                            window.location.href = '/dashboard/models'
                          }
                        }}
                        className="w-full text-xs py-1.5 text-[#6AA8A0] transition-colors flex items-center justify-center gap-1.5 font-medium"
                        style={{ background: 'rgba(106,168,160,0.12)', border: '1px solid rgba(106,168,160,0.25)', borderRadius: 10 }}>
                        <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 20 20" fill="currentColor">
                          <path d="M6.3 2.84A1.5 1.5 0 0 0 4 4.11v11.78a1.5 1.5 0 0 0 2.3 1.27l9.344-5.891a1.5 1.5 0 0 0 0-2.538L6.3 2.841Z"/>
                        </svg>
                        Use as AOI in Models
                      </button>
                    </div>
                  ) : (
                    <button onClick={toggleDrawMode}
                      className="w-full text-xs px-3 py-2.5 transition-all flex items-center justify-center gap-2"
                      style={{
                        borderRadius: 10,
                        background: drawMode ? 'rgba(61,122,114,0.25)' : P.bgHover,
                        border: drawMode ? '1px solid rgba(61,122,114,0.40)' : `1px solid ${P.borderMd}`,
                        color: drawMode ? '#3D7A72' : P.textMid,
                      }}>
                      {drawMode ? (
                        <><svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>Cancel drawing</>
                      ) : (
                        <><svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polygon points="3 11 22 2 13 21 11 13 3 11"/></svg>Draw polygon</>
                      )}
                    </button>
                  )}
                </div>
              </Accordion>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-3 flex items-center" style={{ borderTop: `1px solid ${P.border}` }}>
          {fetchErr ? (
            <button onClick={() => fetchLayers()} className="text-xs text-red-400 hover:text-red-300 transition-colors flex items-center gap-1.5">
              <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
              Error — Retry
            </button>
          ) : (
            <button onClick={() => fetchLayers()} className="text-xs transition-colors flex items-center gap-1.5 px-2 py-1 rounded-lg hover:bg-[#D6EEED]" style={{ color: P.textLow }}>
              <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
              Refresh layers
            </button>
          )}
        </div>
      </div>

      {/* ── Map canvas ───────────────────────────────────────────────────── */}
      <div className="flex-1 relative min-w-0" style={{ minHeight: 0 }}>
        <div ref={mapContainer} style={{ position: 'absolute', inset: 0 }} />

        {/* Loading overlay */}
        {!mapReady && (
          <div className="absolute inset-0 flex items-center justify-center" style={{ background: '#111827' }}>
            <div className="flex flex-col items-center gap-4">
              <div className="w-8 h-8 border-2 animate-spin" style={{ borderRadius: 99, borderColor: '#374151', borderTopColor: '#6AA8A0' }} />
              <p className="text-xs text-white/30 tracking-widest uppercase">Loading map</p>
            </div>
          </div>
        )}

        {/* Superadmin viewing another user's data via ?viewAs= */}
        {viewAsParam && viewingAsAdmin && (
          <div className="absolute top-4 left-1/2 -translate-x-1/2 flex items-center gap-2 bg-[#3D7A72] text-white text-xs px-3 py-1.5 rounded-full shadow-lg z-10">
            Viewing as {viewAsParam} (superadmin)
          </div>
        )}

        {/* Raster tiles still streaming in — non-blocking, just so it doesn't look frozen */}
        {mapReady && loadingRasterSources.size > 0 && (
          <div className="absolute bottom-4 left-4 flex items-center gap-2 bg-black/70 backdrop-blur-sm text-white text-xs px-3 py-2 rounded-full shadow-lg pointer-events-none">
            <div className="w-3 h-3 border-2 animate-spin flex-shrink-0" style={{ borderRadius: 99, borderColor: 'rgba(255,255,255,0.25)', borderTopColor: '#6AA8A0' }} />
            Loading imagery...
          </div>
        )}

        {/* Draw mode hint */}
        {drawMode && (
          <div className="absolute top-4 left-1/2 -translate-x-1/2 z-10 backdrop-blur-sm text-white/80 shadow-xl px-5 py-2.5 flex items-center gap-2"
            style={{ background: 'rgba(17,24,39,0.90)', border: '1px solid rgba(61,122,114,0.40)', borderRadius: 99 }}>
            <div className="w-1.5 h-1.5 bg-[#6AA8A0] animate-pulse" style={{ borderRadius: 99 }} />
            <p className="text-xs font-medium">Click to place points · Double-click to finish</p>
          </div>
        )}

        {/* ── Feature properties panel ── */}
        {featurePanel && (
          <div className="absolute top-0 right-0 bottom-0 z-20 flex flex-col shadow-2xl"
            style={{ width: 280, background: P.bg, borderLeft: `1px solid ${P.border}` }}>
            <div className="flex items-center justify-between px-4 py-3 flex-shrink-0"
              style={{ borderBottom: `1px solid ${P.border}`, background: P.header }}>
              <div className="min-w-0">
                <p className="text-[10px] font-bold tracking-widest uppercase" style={{ color: P.textLow }}>Feature</p>
                <p className="text-xs font-semibold truncate mt-0.5" style={{ color: P.text }}>{featurePanel.layerName}</p>
              </div>
              <button onClick={() => setFeaturePanel(null)}
                className="flex-shrink-0 w-6 h-6 flex items-center justify-center transition-colors hover:bg-[#D6EEED] ml-2"
                style={{ borderRadius: 6, color: P.textLow }}>
                <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
            <div className="flex-1 overflow-y-auto">
              {Object.keys(featurePanel.props).length === 0 ? (
                <p className="px-4 py-6 text-xs text-center" style={{ color: P.textLow }}>No properties</p>
              ) : (
                <table className="w-full text-xs border-collapse">
                  <tbody>
                    {Object.entries(featurePanel.props).map(([k, v]) => (
                      <tr key={k} style={{ borderBottom: `1px solid ${P.border}` }}>
                        <td className="px-3 py-2 font-medium align-top" style={{ color: P.textMid, width: '40%', wordBreak: 'break-word' }}>{k}</td>
                        <td className="px-3 py-2 font-mono align-top" style={{ color: P.text, wordBreak: 'break-all' }}>{String(v ?? '—')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        )}

        {/* ── Basemap switcher — floating bottom bar ── */}
        <div className="absolute bottom-8 left-1/2 -translate-x-1/2 z-10 flex items-center gap-0.5 shadow-2xl p-1"
          style={{ background: 'rgba(17,24,39,0.90)', backdropFilter: 'blur(12px)', border: '1px solid rgba(55,65,81,0.80)', borderRadius: 14 }}>
          {BASEMAPS.map(bm => {
            const active = basemap === bm.id
            return (
            <button key={bm.id} onClick={() => changeBasemap(bm.id)}
              title={bm.label}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold transition-all"
              style={{
                borderRadius: 10,
                background: active ? 'rgba(255,255,255,0.18)' : 'transparent',
                color: active ? '#ffffff' : 'rgba(255,255,255,0.40)',
                boxShadow: active ? 'inset 0 0 0 1px rgba(255,255,255,0.25)' : undefined,
              }}
              onMouseEnter={e => { if (!active) (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.08)' }}
              onMouseLeave={e => { if (!active) (e.currentTarget as HTMLButtonElement).style.background = 'transparent' }}>
              <span style={{ opacity: active ? 1 : 0.5 }}>{bm.icon}</span>
              <span className="hidden sm:inline">{bm.label}</span>
            </button>
          )})}
        </div>
      </div>
    </div>
  )
}
