'use client'
import { useUser } from '@clerk/nextjs'
import React from 'react'
import { useEffect, useRef, useState, useCallback } from 'react'
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

type AOIFeature = {
  id: string
  geometry: GeoJSON.Geometry
  area_km2: number
}

function makeBasemap(tileUrl: string, attribution: string): StyleSpecification {
  return {
    version: 8,
    sources: { basemap: { type: 'raster', tiles: [tileUrl], tileSize: 256, attribution } },
    layers: [{ id: 'basemap', type: 'raster', source: 'basemap' }]
  }
}

const BASEMAPS = [
  {
    id: 'satellite', label: 'Satellite', icon: '🛰',
    style: makeBasemap(
      'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      '© Esri'
    ),
  },
  {
    id: 'osm', label: 'Streets', icon: '🗺',
    style: makeBasemap('https://tile.openstreetmap.org/{z}/{x}/{y}.png', '© OpenStreetMap contributors'),
  },
  {
    id: 'terrain', label: 'Terrain', icon: '⛰',
    style: makeBasemap('https://tile.opentopomap.org/{z}/{x}/{y}.png', '© OpenTopoMap'),
  },
]

const VECTOR_COLORS = ['#F59E0B', '#3B82F6', '#EF4444', '#8B5CF6', '#EC4899', '#14B8A6']

function calcAreaKm2(coords: number[][]): number {
  const R = 6371
  let area = 0
  for (let i = 0; i < coords.length - 1; i++) {
    const [x1, y1] = coords[i], [x2, y2] = coords[i + 1]
    area += (x2 - x1) * (y2 + y1)
  }
  const latMid = coords.reduce((s, c) => s + c[1], 0) / coords.length
  return Math.round(Math.abs(area / 2) *
    (Math.PI / 180) * R * (Math.PI / 180) * R *
    Math.cos((latMid * Math.PI) / 180) * 100) / 100
}

// ── Layer options popover ─────────────────────────────────────────────────────
function LayerPopover({
  layer, onClose, onZoomTo, onOpacityChange, anchorRef
}: {
  layer: Layer
  onClose: () => void
  onZoomTo: (l: Layer) => void
  onOpacityChange: (id: string, opacity: number) => void
  anchorRef: React.RefObject<HTMLButtonElement | null>
}) {
  const rect = anchorRef.current?.getBoundingClientRect()
  const top  = rect ? rect.top : 0
  const left = rect ? rect.right + 8 : 0

  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div
        className="fixed z-50 bg-[#1a2e22] rounded-xl shadow-2xl border border-white/10 overflow-hidden"
        style={{ top, left, width: 220 }}
        onClick={e => e.stopPropagation()}
      >
        <div className="px-4 pt-3 pb-2 border-b border-white/10">
          <p className="text-xs font-semibold text-white/90 truncate">{layer.name}</p>
          <p className="text-xs text-white/40 mt-0.5 font-mono">EPSG:{layer.epsg || '—'}</p>
        </div>

        <div className="px-4 py-3">
          <div className="flex justify-between items-center mb-2">
            <span className="text-xs font-medium text-white/50">Opacity</span>
            <span className="text-xs font-semibold text-[#5A9E7C] tabular-nums">{Math.round(layer.opacity * 100)}%</span>
          </div>
          <div className="relative h-5 flex items-center">
            <div className="absolute w-full h-1 rounded-full bg-white/10" />
            <div className="absolute h-1 rounded-full bg-[#2C5F45]" style={{ width: `${layer.opacity * 100}%` }} />
            <input
              type="range" min={0} max={1} step={0.05}
              value={layer.opacity}
              onChange={e => onOpacityChange(layer.id, parseFloat(e.target.value))}
              className="absolute w-full opacity-0 cursor-pointer h-5"
              style={{ margin: 0 }}
            />
            <div
              className="absolute w-3 h-3 rounded-full bg-[#5A9E7C] shadow-lg pointer-events-none border border-white/20"
              style={{ left: `calc(${layer.opacity * 100}% - 6px)` }}
            />
          </div>
        </div>

        {layer.bbox && (
          <div className="border-t border-white/10 px-2 pb-2">
            <button
              onClick={() => { onZoomTo(layer); onClose() }}
              className="flex items-center gap-2 w-full px-3 py-2 rounded-lg text-xs text-white/60 hover:bg-white/10 hover:text-white transition-colors"
            >
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

// ── Accordion ─────────────────────────────────────────────────────────────────
function Accordion({
  title, icon, badge, children, defaultOpen = false
}: {
  title: string
  icon?: React.ReactNode
  badge?: number
  children: React.ReactNode
  defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)

  return (
    <div className="border-b border-white/5 last:border-0">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-2.5 px-4 py-3 hover:bg-white/5 transition-colors"
      >
        {icon && <span className="text-xs text-white/40 flex-shrink-0">{icon}</span>}
        <span className="text-xs font-semibold tracking-widest uppercase text-white/40 flex-1 text-left">{title}</span>
        {badge !== undefined && badge > 0 && (
          <span className="text-xs bg-[#2C5F45]/60 text-[#5A9E7C] rounded-full px-1.5 py-0.5 font-medium tabular-nums">
            {badge}
          </span>
        )}
        <svg
          xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24"
          fill="none" stroke="currentColor" strokeWidth="2.5"
          className="text-white/20 flex-shrink-0 transition-transform duration-200"
          style={{ transform: open ? 'rotate(180deg)' : 'rotate(0deg)' }}
        >
          <polyline points="6 9 12 15 18 9"/>
        </svg>
      </button>

      <div
        className="overflow-hidden transition-all duration-200"
        style={{ maxHeight: open ? '600px' : '0px', opacity: open ? 1 : 0 }}
      >
        {children}
      </div>
    </div>
  )
}

// ── Layer row ─────────────────────────────────────────────────────────────────
function LayerRow({
  layer, colorDot, onToggle, onZoomTo, onOpacityChange
}: {
  layer: Layer
  colorDot?: string
  onToggle: () => void
  onZoomTo: (l: Layer) => void
  onOpacityChange: (id: string, opacity: number) => void
}) {
  const [showPopover, setShowPopover] = useState(false)
  const btnRef = useRef<HTMLButtonElement | null>(null)

  return (
    <div className="relative group px-4 py-2.5 hover:bg-white/5 transition-colors flex items-center gap-3">
      {/* Visibility toggle */}
      <button
        onClick={onToggle}
        className={`w-4 h-4 rounded border flex-shrink-0 transition-all ${
          layer.visible
            ? 'border-[#2C5F45] bg-[#2C5F45]'
            : 'border-white/20 bg-transparent'
        }`}
      >
        {layer.visible && (
          <svg viewBox="0 0 10 8" fill="none" className="w-full h-full p-0.5">
            <polyline points="1,4 3.5,6.5 9,1" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        )}
      </button>

      {/* Color dot for vectors */}
      {colorDot && (
        <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: colorDot }} />
      )}

      {/* Name + meta */}
      <div
        className="flex-1 min-w-0 cursor-pointer"
        onClick={() => layer.bbox && onZoomTo(layer)}
      >
        <p className={`text-xs font-medium truncate transition-colors ${
          layer.visible ? 'text-white/80' : 'text-white/30'
        } ${layer.bbox ? 'hover:text-[#5A9E7C]' : ''}`}>
          {layer.name}
        </p>
        <div className="flex items-center gap-1.5 mt-0.5">
          {/* Mini opacity bar */}
          <div className="w-8 h-0.5 rounded-full bg-white/10 overflow-hidden">
            <div className="h-full bg-[#5A9E7C]/60 transition-all" style={{ width: `${layer.opacity * 100}%` }} />
          </div>
          <span className="text-xs text-white/25 font-mono">{layer.epsg || '—'}</span>
        </div>
      </div>

      {/* Options */}
      <button
        ref={btnRef}
        onClick={e => { e.stopPropagation(); setShowPopover(s => !s) }}
        className="opacity-0 group-hover:opacity-100 transition-opacity text-white/30 hover:text-white/70 p-0.5 rounded flex-shrink-0"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
          <circle cx="12" cy="5" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="12" cy="19" r="1.5"/>
        </svg>
      </button>

      {showPopover && (
        <LayerPopover
          layer={layer}
          onClose={() => setShowPopover(false)}
          onZoomTo={onZoomTo}
          onOpacityChange={onOpacityChange}
          anchorRef={{ current: btnRef.current }}
        />
      )}
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function MapPage() {
  const { user, isLoaded } = useUser()
  const mapContainer = useRef<HTMLDivElement>(null)
  const map          = useRef<maplibregl.Map | null>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const draw         = useRef<any>(null)

  const [layers,   setLayers]   = useState<Layer[]>([])
  const [basemap,  setBasemap]  = useState('satellite')
  const [mapReady, setMapReady] = useState(false)
  const [drawMode, setDrawMode] = useState(false)
  const [aoi,      setAoi]      = useState<AOIFeature | null>(null)
  const [fetchErr, setFetchErr] = useState(false)

  const API = process.env.NEXT_PUBLIC_API_URL || 'https://timbermap-api-788407107542.us-central1.run.app'

  const fetchLayers = useCallback(async (retrying = false) => {
    if (!isLoaded || !user) return
    try {
      const res = await fetch(`${API}/layers/${user.id}`)
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
    } catch {
      setFetchErr(true)
    }
  }, [user, isLoaded, API])

  useEffect(() => { if (isLoaded && user) fetchLayers() }, [user, isLoaded, fetchLayers])

  useEffect(() => {
    if (!mapContainer.current || map.current) return
    maplibregl.addProtocol('cog', cogProtocol)
    map.current = new maplibregl.Map({
      container: mapContainer.current,
      style: BASEMAPS[0].style,
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
          paint: { 'fill-color': '#5A9E7C', 'fill-opacity': 0.15 } },
        { id: 'gl-draw-polygon-stroke', type: 'line',
          filter: ['all', ['==', '$type', 'Polygon'], ['!=', 'mode', 'static']],
          paint: { 'line-color': '#5A9E7C', 'line-width': 2, 'line-dasharray': [2, 1] } },
        { id: 'gl-draw-vertex', type: 'circle',
          filter: ['all', ['==', 'meta', 'vertex'], ['==', '$type', 'Point']],
          paint: { 'circle-radius': 5, 'circle-color': '#5A9E7C', 'circle-stroke-width': 2, 'circle-stroke-color': '#fff' } },
      ],
    })
    map.current.addControl(draw.current, 'top-right')
    map.current.on('draw.create', (e: { features: GeoJSON.Feature[] }) => {
      const feature = e.features[0]
      if (!feature || feature.geometry.type !== 'Polygon') return
      const coords = (feature.geometry as GeoJSON.Polygon).coordinates[0] as number[][]
      setAoi({ id: String(feature.id), geometry: feature.geometry, area_km2: calcAreaKm2(coords) })
      setTimeout(() => draw.current.changeMode('simple_select'), 0)
      setDrawMode(false)
    })
    map.current.on('draw.delete', () => { setAoi(null); setDrawMode(false) })
    map.current.on('load', () => setMapReady(true))
    return () => { maplibregl.removeProtocol('cog'); map.current?.remove(); map.current = null }
  }, [])

  useEffect(() => {
    if (!map.current || !mapReady) return
    layers.forEach((layer, idx) => {
      const sourceId   = `source-${layer.id}`
      const layerId    = `layer-${layer.id}`
      const visibility = layer.visible ? 'visible' : 'none'
      if (layer.type === 'raster' && layer.cog_url) {
        if (!map.current!.getSource(sourceId)) {
          map.current!.addSource(sourceId, { type: 'raster', url: `cog://${layer.cog_url}`, tileSize: 256 })
          map.current!.addLayer({ id: layerId, type: 'raster', source: sourceId,
            paint: { 'raster-opacity': layer.opacity }, layout: { visibility } })
        } else {
          map.current!.setLayoutProperty(layerId, 'visibility', visibility)
          map.current!.setPaintProperty(layerId, 'raster-opacity', layer.opacity)
        }
      }
      if (layer.type === 'vector' && layer.tiles_url) {
        const color    = VECTOR_COLORS[idx % VECTOR_COLORS.length]
        const fillId   = `${layerId}-fill`
        const strokeId = `${layerId}-stroke`
        if (!map.current!.getSource(sourceId)) {
          map.current!.addSource(sourceId, { type: 'vector', tiles: [layer.tiles_url], minzoom: 0, maxzoom: 14 })
          map.current!.addLayer({ id: fillId, type: 'fill', source: sourceId, 'source-layer': 'layer',
            paint: { 'fill-color': color, 'fill-opacity': layer.opacity * 0.35 }, layout: { visibility } })
          map.current!.addLayer({ id: strokeId, type: 'line', source: sourceId, 'source-layer': 'layer',
            paint: { 'line-color': color, 'line-width': 1.5, 'line-opacity': layer.opacity }, layout: { visibility } })
        } else {
          map.current!.setLayoutProperty(fillId,   'visibility', visibility)
          map.current!.setLayoutProperty(strokeId, 'visibility', visibility)
          map.current!.setPaintProperty(fillId,   'fill-opacity',  layer.opacity * 0.35)
          map.current!.setPaintProperty(strokeId, 'line-opacity',  layer.opacity)
        }
      }
    })
  }, [layers, mapReady])

  function zoomToLayer(layer: Layer) {
    if (!map.current || !layer.bbox) return
    const [minx, miny, maxx, maxy] = layer.bbox
    map.current.fitBounds([[minx, miny], [maxx, maxy]], { padding: 60, duration: 900, maxZoom: 18 })
  }

  function toggleLayer(id: string) {
    setLayers(prev => prev.map(l => l.id === id ? { ...l, visible: !l.visible } : l))
  }

  function setOpacity(id: string, opacity: number) {
    setLayers(prev => prev.map(l => l.id === id ? { ...l, opacity } : l))
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
    else { draw.current.deleteAll(); setAoi(null); draw.current.changeMode('draw_polygon'); setDrawMode(true) }
  }

  function clearAoi() { draw.current?.deleteAll(); setAoi(null); setDrawMode(false) }
  function copyAoi()  { if (aoi) navigator.clipboard.writeText(JSON.stringify(aoi.geometry, null, 2)) }

  const imageLayers  = layers.filter(l => l.type === 'raster')
  const vectorLayers = layers.filter(l => l.type === 'vector')
  const activeBasemap = BASEMAPS.find(b => b.id === basemap)

  return (
    <div className="flex h-[calc(100vh-2rem)] -m-10 overflow-hidden rounded-xl shadow-2xl">

      {/* ── Sidebar ──────────────────────────────────────────────────────── */}
      <div className="w-64 bg-[#0f1f16] flex flex-col border-r border-white/5">

        {/* Header */}
        <div className="px-5 py-4 border-b border-white/5">
          <div className="flex items-center gap-2.5">
            <div className="w-6 h-6 rounded-lg bg-[#2C5F45] flex items-center justify-center flex-shrink-0">
              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="3 6 9 3 15 6 21 3 21 18 15 21 9 18 3 21"/>
                <line x1="9" y1="3" x2="9" y2="18"/>
                <line x1="15" y1="6" x2="15" y2="21"/>
              </svg>
            </div>
            <div>
              <p className="text-xs font-bold text-white/90 tracking-tight">Map Viewer</p>
              <p className="text-xs text-white/30">
                {layers.length > 0 ? `${layers.length} layer${layers.length > 1 ? 's' : ''} loaded` : 'No layers'}
              </p>
            </div>
          </div>
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto">

          {/* Basemap accordion */}
          <Accordion
            title="Basemap"
            icon={<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>}
            defaultOpen={false}
          >
            <div className="px-3 pb-3 space-y-1">
              {BASEMAPS.map(bm => (
                <button
                  key={bm.id}
                  onClick={() => changeBasemap(bm.id)}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-all ${
                    basemap === bm.id
                      ? 'bg-[#2C5F45]/40 border border-[#2C5F45]/50'
                      : 'hover:bg-white/5 border border-transparent'
                  }`}
                >
                  <span className="text-base">{bm.icon}</span>
                  <div className="flex-1">
                    <p className={`text-xs font-medium ${basemap === bm.id ? 'text-[#5A9E7C]' : 'text-white/60'}`}>
                      {bm.label}
                    </p>
                  </div>
                  {basemap === bm.id && (
                    <div className="w-1.5 h-1.5 rounded-full bg-[#5A9E7C] flex-shrink-0" />
                  )}
                </button>
              ))}
            </div>
          </Accordion>

          {/* Images accordion */}
          <Accordion
            title="Images"
            icon={<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>}
            badge={imageLayers.length}
            defaultOpen={imageLayers.length > 0}
          >
            {imageLayers.length === 0 ? (
              <p className="px-4 pb-3 text-xs text-white/20">No images uploaded yet.</p>
            ) : (
              <div className="pb-1">
                {imageLayers.map(layer => (
                  <LayerRow
                    key={layer.id}
                    layer={layer}
                    onToggle={() => toggleLayer(layer.id)}
                    onZoomTo={zoomToLayer}
                    onOpacityChange={setOpacity}
                  />
                ))}
              </div>
            )}
          </Accordion>

          {/* Vectors accordion */}
          <Accordion
            title="Vectors"
            icon={<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6"/><line x1="8" y1="2" x2="8" y2="18"/><line x1="16" y1="6" x2="16" y2="22"/></svg>}
            badge={vectorLayers.length}
            defaultOpen={vectorLayers.length > 0}
          >
            {vectorLayers.length === 0 ? (
              <p className="px-4 pb-3 text-xs text-white/20">No vectors uploaded yet.</p>
            ) : (
              <div className="pb-1">
                {vectorLayers.map((layer, idx) => (
                  <LayerRow
                    key={layer.id}
                    layer={layer}
                    colorDot={VECTOR_COLORS[idx % VECTOR_COLORS.length]}
                    onToggle={() => toggleLayer(layer.id)}
                    onZoomTo={zoomToLayer}
                    onOpacityChange={setOpacity}
                  />
                ))}
              </div>
            )}
          </Accordion>

          {/* AOI accordion */}
          <Accordion
            title="Area of Interest"
            icon={<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>}
            defaultOpen={!!aoi}
          >
            <div className="px-4 pb-3">
              {aoi ? (
                <div>
                  <div className="bg-[#2C5F45]/20 border border-[#2C5F45]/30 rounded-lg px-3 py-2.5 mb-2">
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-semibold text-[#5A9E7C]">Polygon</p>
                      <p className="text-xs font-mono text-white/40">{aoi.area_km2} km²</p>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={copyAoi}
                      className="flex-1 text-xs bg-white/5 border border-white/10 text-white/50 hover:text-white/80 px-2 py-1.5 rounded-lg hover:bg-white/10 transition-colors">
                      Copy GeoJSON
                    </button>
                    <button onClick={clearAoi}
                      className="flex-1 text-xs bg-red-500/10 border border-red-500/20 text-red-400 px-2 py-1.5 rounded-lg hover:bg-red-500/20 transition-colors">
                      Clear
                    </button>
                  </div>
                </div>
              ) : (
                <button onClick={toggleDrawMode}
                  className={`w-full text-xs px-3 py-2.5 rounded-lg border transition-all flex items-center justify-center gap-2 ${
                    drawMode
                      ? 'bg-[#2C5F45]/40 text-[#5A9E7C] border-[#2C5F45]/50'
                      : 'border-white/10 text-white/40 hover:bg-white/5 hover:text-white/60'
                  }`}>
                  {drawMode ? (
                    <>
                      <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                      Cancel drawing
                    </>
                  ) : (
                    <>
                      <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polygon points="3 11 22 2 13 21 11 13 3 11"/></svg>
                      Draw polygon
                    </>
                  )}
                </button>
              )}
            </div>
          </Accordion>
        </div>

        {/* Footer */}
        <div className="border-t border-white/5 px-4 py-3 flex items-center justify-between">
          {fetchErr ? (
            <button onClick={() => fetchLayers()} className="text-xs text-red-400 hover:text-red-300 transition-colors flex items-center gap-1.5">
              <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
              Error · Retry
            </button>
          ) : (
            <button onClick={() => fetchLayers()} className="text-xs text-white/20 hover:text-white/50 transition-colors flex items-center gap-1.5">
              <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
              Refresh layers
            </button>
          )}
          <span className="text-xs text-white/15 font-mono">{activeBasemap?.label}</span>
        </div>
      </div>

      {/* ── Map ──────────────────────────────────────────────────────────── */}
      <div className="flex-1 relative">
        <div ref={mapContainer} className="w-full h-full" />

        {!mapReady && (
          <div className="absolute inset-0 bg-[#0f1f16] flex items-center justify-center">
            <div className="flex flex-col items-center gap-4">
              <div className="w-8 h-8 rounded-full border-2 border-[#2C5F45] border-t-[#5A9E7C] animate-spin" />
              <p className="text-xs text-white/30 tracking-widest uppercase">Loading map</p>
            </div>
          </div>
        )}

        {drawMode && (
          <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-[#0f1f16]/90 backdrop-blur text-white/80 shadow-xl rounded-full px-5 py-2.5 border border-[#2C5F45]/40 flex items-center gap-2">
            <div className="w-1.5 h-1.5 rounded-full bg-[#5A9E7C] animate-pulse" />
            <p className="text-xs font-medium">Click to place points · Double-click to finish</p>
          </div>
        )}
      </div>
    </div>
  )
}
