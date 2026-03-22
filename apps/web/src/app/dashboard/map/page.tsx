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
    id: 'satellite', label: 'Satellite',
    style: makeBasemap(
      'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      '© Esri'
    ),
  },
  {
    id: 'osm', label: 'OpenStreetMap',
    style: makeBasemap('https://tile.openstreetmap.org/{z}/{x}/{y}.png', '© OpenStreetMap contributors'),
  },
  {
    id: 'terrain', label: 'Terrain',
    style: makeBasemap('https://tile.opentopomap.org/{z}/{x}/{y}.png', '© OpenTopoMap'),
  },
]

const VECTOR_COLORS = ['#2C5F45', '#3B82F6', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899']

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

// ── Layer popover ────────────────────────────────────────────────────────────
function LayerPopover({
  layer, onClose, onZoomTo, onOpacityChange, anchorRef
}: {
  layer: Layer
  onClose: () => void
  onZoomTo: (l: Layer) => void
  onOpacityChange: (id: string, opacity: number) => void
  anchorRef: React.RefObject<HTMLButtonElement>
}) {
  const rect = anchorRef.current?.getBoundingClientRect()
  const top  = rect ? rect.top : 0
  const left = rect ? rect.right + 8 : 0

  return (
    <>
      {/* Backdrop to close */}
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div
        className="fixed z-50 bg-white rounded-xl shadow-lg border border-gray-100 p-3 w-52"
        style={{ top, left }}
        onClick={e => e.stopPropagation()}
      >
        <p className="text-xs font-semibold text-gray-700 truncate mb-3">{layer.name}</p>

        {/* Opacity slider */}
        <div className="mb-3">
          <div className="flex justify-between mb-1.5">
            <span className="text-xs text-gray-400">Opacity</span>
            <span className="text-xs font-medium text-gray-600">{Math.round(layer.opacity * 100)}%</span>
          </div>
          <input
            type="range" min={0} max={1} step={0.05}
            value={layer.opacity}
            onChange={e => onOpacityChange(layer.id, parseFloat(e.target.value))}
            className="w-full h-1.5 rounded-full appearance-none cursor-pointer"
            style={{ accentColor: '#2C5F45' }}
          />
        </div>

        {/* Actions */}
        <div className="flex flex-col gap-0.5 border-t border-gray-50 pt-2">
          {layer.bbox && (
            <button
              onClick={() => { onZoomTo(layer); onClose() }}
              className="flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs text-gray-600 hover:bg-gray-50 transition-colors w-full text-left"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
                <line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/>
              </svg>
              Zoom to layer
            </button>
          )}
          <div className="px-2 py-1 text-xs text-gray-300">EPSG: {layer.epsg || '—'}</div>
        </div>
      </div>
    </>
  )
}

// ── Accordion section ────────────────────────────────────────────────────────
function LayerAccordion({
  title, icon, layers, onToggleLayer, onZoomTo, onOpacityChange
}: {
  title: string
  icon: string
  layers: Layer[]
  onToggleLayer: (id: string) => void
  onZoomTo: (layer: Layer) => void
  onOpacityChange: (id: string, opacity: number) => void
}) {
  const [open, setOpen] = useState(true)
  const [activePopover, setActivePopover] = useState<string | null>(null)
  const btnRefs = useRef<Record<string, HTMLButtonElement | null>>({})

  if (layers.length === 0) return null

  return (
    <div className="mb-1">
      {/* Header */}
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-2 px-2 py-2 rounded-lg hover:bg-gray-50 transition-colors"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24"
          fill="none" stroke="currentColor" strokeWidth="2.5"
          style={{ transform: open ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 0.15s' }}
          className="text-gray-400 flex-shrink-0"
        >
          <polyline points="9 18 15 12 9 6"/>
        </svg>
        <span className="text-xs">{icon}</span>
        <p className="text-xs font-medium tracking-widest uppercase text-gray-400 flex-1 text-left">{title}</p>
        <span className="text-xs bg-gray-100 text-gray-500 rounded-full px-1.5 py-0.5 font-medium">
          {layers.length}
        </span>
      </button>

      {/* Body */}
      {open && (
        <div className="space-y-0.5 mt-0.5">
          {layers.map(layer => (
            <div key={layer.id} className="relative">
              <div
                className="group flex items-center gap-2.5 px-3 py-2 rounded-lg hover:bg-gray-50 cursor-pointer"
                onClick={() => onToggleLayer(layer.id)}
              >
                {/* Checkbox */}
                <div className={`w-3.5 h-3.5 rounded border-2 flex-shrink-0 transition-colors ${
                  layer.visible ? 'bg-[#2C5F45] border-[#2C5F45]' : 'border-gray-300 bg-white'
                }`} />

                {/* Name + opacity bar */}
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-gray-700 truncate">{layer.name}</p>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <div className="w-10 h-1 rounded-full bg-gray-100 overflow-hidden">
                      <div
                        className="h-full rounded-full bg-[#2C5F45] transition-all"
                        style={{ width: `${layer.opacity * 100}%` }}
                      />
                    </div>
                    <p className="text-xs text-gray-400">{layer.epsg || '—'}</p>
                  </div>
                </div>

                {/* Options button */}
                <button
                  ref={el => { btnRefs.current[layer.id] = el }}
                  onClick={e => {
                    e.stopPropagation()
                    setActivePopover(activePopover === layer.id ? null : layer.id)
                  }}
                  className="opacity-0 group-hover:opacity-100 transition-opacity text-gray-400 hover:text-[#2C5F45] p-0.5 rounded"
                  title="Layer options"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
                    <circle cx="12" cy="5" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="12" cy="19" r="1.5"/>
                  </svg>
                </button>
              </div>

              {/* Popover */}
              {activePopover === layer.id && (
                <LayerPopover
                  layer={layer}
                  onClose={() => setActivePopover(null)}
                  onZoomTo={onZoomTo}
                  onOpacityChange={onOpacityChange}
                  anchorRef={{ current: btnRefs.current[layer.id] ?? null }}
                />
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Main page ────────────────────────────────────────────────────────────────
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

  // ── Fetch layers with auto-retry on auth failure ───────────────────────────
  const fetchLayers = useCallback(async (retrying = false) => {
    if (!isLoaded || !user) return
    try {
      const res = await fetch(`${API}/layers/${user.id}`)
      if (!res.ok) {
        if ((res.status === 401 || res.status === 403) && !retrying) {
          window.location.reload()
          return
        }
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

  useEffect(() => {
    if (isLoaded && user) fetchLayers()
  }, [user, isLoaded, fetchLayers])

  // ── Init map ───────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!mapContainer.current || map.current) return

    maplibregl.addProtocol('cog', cogProtocol)

    map.current = new maplibregl.Map({
      container: mapContainer.current,
      style:     BASEMAPS[0].style,
      center:    [-60, -35],
      zoom:      4,
    })

    map.current.addControl(new maplibregl.NavigationControl(), 'top-right')
    map.current.addControl(new maplibregl.ScaleControl(), 'bottom-right')

    draw.current = new MapboxDraw({
      displayControlsDefault: false,
      controls: { polygon: true, trash: true },
      defaultMode: 'simple_select',
      styles: [
        {
          id: 'gl-draw-polygon-fill', type: 'fill',
          filter: ['all', ['==', '$type', 'Polygon'], ['!=', 'mode', 'static']],
          paint: { 'fill-color': '#2C5F45', 'fill-opacity': 0.15 },
        },
        {
          id: 'gl-draw-polygon-stroke', type: 'line',
          filter: ['all', ['==', '$type', 'Polygon'], ['!=', 'mode', 'static']],
          paint: { 'line-color': '#2C5F45', 'line-width': 2 },
        },
        {
          id: 'gl-draw-vertex', type: 'circle',
          filter: ['all', ['==', 'meta', 'vertex'], ['==', '$type', 'Point']],
          paint: { 'circle-radius': 5, 'circle-color': '#2C5F45' },
        },
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

    return () => {
      maplibregl.removeProtocol('cog')
      map.current?.remove()
      map.current = null
    }
  }, [])

  // ── Sync layers → map ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!map.current || !mapReady) return

    layers.forEach((layer, idx) => {
      const sourceId   = `source-${layer.id}`
      const layerId    = `layer-${layer.id}`
      const visibility = layer.visible ? 'visible' : 'none'

      if (layer.type === 'raster' && layer.cog_url) {
        if (!map.current!.getSource(sourceId)) {
          map.current!.addSource(sourceId, {
            type: 'raster',
            url: `cog://${layer.cog_url}`,
            tileSize: 256,
          })
          map.current!.addLayer({
            id: layerId, type: 'raster', source: sourceId,
            paint: { 'raster-opacity': layer.opacity },
            layout: { visibility },
          })
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
          map.current!.addSource(sourceId, {
            type: 'vector',
            tiles: [layer.tiles_url],
            minzoom: 0,
            maxzoom: 14,
          })
          map.current!.addLayer({
            id: fillId, type: 'fill', source: sourceId, 'source-layer': 'layer',
            paint: { 'fill-color': color, 'fill-opacity': layer.opacity * 0.4 },
            layout: { visibility },
          })
          map.current!.addLayer({
            id: strokeId, type: 'line', source: sourceId, 'source-layer': 'layer',
            paint: { 'line-color': color, 'line-width': 1.5, 'line-opacity': layer.opacity },
            layout: { visibility },
          })
        } else {
          map.current!.setLayoutProperty(fillId,   'visibility', visibility)
          map.current!.setLayoutProperty(strokeId, 'visibility', visibility)
          map.current!.setPaintProperty(fillId,   'fill-opacity',  layer.opacity * 0.4)
          map.current!.setPaintProperty(strokeId, 'line-opacity',  layer.opacity)
        }
      }
    })
  }, [layers, mapReady])

  function zoomToLayer(layer: Layer) {
    if (!map.current || !layer.bbox) return
    const [minx, miny, maxx, maxy] = layer.bbox
    map.current.fitBounds([[minx, miny], [maxx, maxy]], { padding: 40, duration: 800 })
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
    if (drawMode) {
      setTimeout(() => draw.current.changeMode('simple_select'), 0)
      setDrawMode(false)
    } else {
      draw.current.deleteAll(); setAoi(null)
      draw.current.changeMode('draw_polygon'); setDrawMode(true)
    }
  }

  function clearAoi() { draw.current?.deleteAll(); setAoi(null); setDrawMode(false) }
  function copyAoi()  { if (aoi) navigator.clipboard.writeText(JSON.stringify(aoi.geometry, null, 2)) }

  const imageLayers  = layers.filter(l => l.type === 'raster')
  const vectorLayers = layers.filter(l => l.type === 'vector')

  return (
    <div className="flex h-[calc(100vh-2rem)] -m-10 overflow-hidden rounded-xl">

      {/* ── Sidebar ──────────────────────────────────────────────────────── */}
      <div className="w-64 bg-white border-r border-gray-100 flex flex-col shadow-sm">
        <div className="px-5 py-4 border-b border-gray-100">
          <p className="text-xs font-medium tracking-widest uppercase text-[#5A9E7C]">Map viewer</p>
          <h2 className="text-base font-semibold text-[#1C1C1C] mt-0.5">Layers</h2>
        </div>

        {/* Basemap */}
        <div className="px-5 py-3 border-b border-gray-100">
          <p className="text-xs font-medium tracking-widest uppercase text-gray-400 mb-2">Basemap</p>
          <div className="space-y-1">
            {BASEMAPS.map(bm => (
              <button key={bm.id} onClick={() => changeBasemap(bm.id)}
                className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${
                  basemap === bm.id ? 'bg-[#EDF4F0] text-[#2C5F45] font-medium' : 'text-gray-500 hover:bg-gray-50'
                }`}>
                {bm.label}
              </button>
            ))}
          </div>
        </div>

        {/* Data layers */}
        <div className="flex-1 overflow-y-auto px-3 py-3">
          <p className="text-xs font-medium tracking-widest uppercase text-gray-400 mb-1 px-2">Data layers</p>

          {fetchErr && (
            <div className="mx-2 mb-2 mt-1 px-3 py-2 bg-red-50 rounded-lg flex items-center gap-2">
              <span className="text-xs text-red-500 flex-1">Error loading layers</span>
              <button onClick={() => fetchLayers()} className="text-xs text-red-500 font-medium underline">
                Retry
              </button>
            </div>
          )}

          {layers.length === 0 && !fetchErr ? (
            <p className="text-xs text-gray-300 px-3 mt-2">
              No layers yet. Upload images or vectors first.
            </p>
          ) : (
            <>
              <LayerAccordion
                title="Images" icon="🛰️"
                layers={imageLayers}
                onToggleLayer={toggleLayer}
                onZoomTo={zoomToLayer}
                onOpacityChange={setOpacity}
              />
              <LayerAccordion
                title="Vectors" icon="📐"
                layers={vectorLayers}
                onToggleLayer={toggleLayer}
                onZoomTo={zoomToLayer}
                onOpacityChange={setOpacity}
              />
            </>
          )}
        </div>

        {/* AOI */}
        <div className="px-5 py-3 border-t border-gray-100">
          <p className="text-xs font-medium tracking-widest uppercase text-gray-400 mb-2">AOI</p>
          {aoi ? (
            <div className="bg-[#EDF4F0] rounded-lg px-3 py-2.5 mb-2">
              <p className="text-xs font-medium text-[#2C5F45]">Polygon drawn</p>
              <p className="text-xs text-gray-500 mt-0.5">{aoi.area_km2} km²</p>
              <div className="flex gap-2 mt-2">
                <button onClick={copyAoi}
                  className="flex-1 text-xs bg-white border border-gray-200 text-gray-600 px-2 py-1 rounded hover:bg-gray-50 transition-colors">
                  Copy GeoJSON
                </button>
                <button onClick={clearAoi}
                  className="flex-1 text-xs bg-white border border-red-200 text-red-500 px-2 py-1 rounded hover:bg-red-50 transition-colors">
                  Clear
                </button>
              </div>
            </div>
          ) : (
            <button onClick={toggleDrawMode}
              className={`w-full text-xs px-3 py-2 rounded-lg border transition-colors ${
                drawMode
                  ? 'bg-[#2C5F45] text-white border-[#2C5F45]'
                  : 'border-gray-200 text-gray-600 hover:bg-gray-50'
              }`}>
              {drawMode ? '✕ Cancel drawing' : '+ Draw AOI polygon'}
            </button>
          )}
          {drawMode && (
            <p className="text-xs text-gray-400 mt-2 text-center">
              Click to place vertices. Double-click to finish.
            </p>
          )}
        </div>

        <div className="px-5 py-3 border-t border-gray-100">
          <button onClick={() => fetchLayers()}
            className="w-full text-xs text-gray-400 hover:text-[#2C5F45] transition-colors py-1">
            Refresh layers
          </button>
        </div>
      </div>

      {/* ── Map ──────────────────────────────────────────────────────────── */}
      <div className="flex-1 relative">
        <div ref={mapContainer} className="w-full h-full" />
        {!mapReady && (
          <div className="absolute inset-0 bg-white/80 flex items-center justify-center">
            <div className="flex items-center gap-3">
              <div className="w-5 h-5 rounded-full border-2 border-[#2C5F45] border-t-transparent animate-spin" />
              <p className="text-sm text-gray-400">Loading map...</p>
            </div>
          </div>
        )}
        {drawMode && (
          <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-[#2C5F45] text-white shadow-md rounded-full px-4 py-2">
            <p className="text-xs font-medium">Drawing mode — click to place points, double-click to finish</p>
          </div>
        )}
      </div>
    </div>
  )
}
