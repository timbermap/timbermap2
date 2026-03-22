'use client'
import { useUser } from '@clerk/nextjs'
import { useEffect, useRef, useState, useCallback } from 'react'
import maplibregl, { StyleSpecification } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'

// @ts-expect-error - no types
import MapboxDraw from '@mapbox/mapbox-gl-draw'
import '@mapbox/mapbox-gl-draw/dist/mapbox-gl-draw.css'

// COG protocol for reading Cloud-Optimized GeoTIFFs directly
import { cogProtocol } from '@geomatico/maplibre-cog-protocol'

type Layer = {
  id: string
  name: string
  type: 'raster' | 'vector'
  cog_url?: string       // for rasters
  tiles_url?: string     // for vectors (MVT)
  epsg: string | null
  visible: boolean
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

function LayerSection({
  title, icon, layers, onToggleLayer
}: {
  title: string
  icon: string
  layers: Layer[]
  onToggleLayer: (id: string) => void
}) {
  if (layers.length === 0) return null
  return (
    <div className="mb-4">
      <div className="flex items-center gap-2 px-2 mb-1.5">
        <span className="text-sm">{icon}</span>
        <p className="text-xs font-medium tracking-widest uppercase text-gray-400">{title}</p>
        <span className="text-xs bg-gray-100 text-gray-500 rounded-full px-1.5 py-0.5 font-medium ml-auto">
          {layers.length}
        </span>
      </div>
      <div className="space-y-0.5">
        {layers.map(layer => (
          <div key={layer.id}
            className="flex items-center gap-2.5 px-3 py-2 rounded-lg hover:bg-gray-50 cursor-pointer"
            onClick={() => onToggleLayer(layer.id)}>
            <div className={`w-3.5 h-3.5 rounded border-2 flex-shrink-0 transition-colors ${
              layer.visible ? 'bg-[#2C5F45] border-[#2C5F45]' : 'border-gray-300 bg-white'
            }`} />
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-gray-700 truncate">{layer.name}</p>
              <p className="text-xs text-gray-400">{layer.epsg || '—'}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// Vector layer colors — cycle through these
const VECTOR_COLORS = ['#2C5F45', '#3B82F6', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899']

export default function MapPage() {
  const { user, isLoaded } = useUser()
  const mapContainer = useRef<HTMLDivElement>(null)
  const map          = useRef<maplibregl.Map | null>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const draw         = useRef<any>(null)

  const [layers,    setLayers]    = useState<Layer[]>([])
  const [basemap,   setBasemap]   = useState('satellite')
  const [mapReady,  setMapReady]  = useState(false)
  const [drawMode,  setDrawMode]  = useState(false)
  const [aoi,       setAoi]       = useState<AOIFeature | null>(null)

  const API = process.env.NEXT_PUBLIC_API_URL || 'https://timbermap-api-788407107542.us-central1.run.app'

  const fetchLayers = useCallback(async () => {
    if (!isLoaded || !user) return
    try {
      const res  = await fetch(`${API}/layers/${user.id}`)
      const data = await res.json()
      setLayers(prev => {
        const visMap = new Map(prev.map(l => [l.id, l.visible]))
        return (data.layers || []).map((l: Omit<Layer, 'visible'>) => ({
          ...l, visible: visMap.has(l.id) ? visMap.get(l.id)! : true
        }))
      })
    } catch { /* non-fatal */ }
  }, [user, isLoaded, API])

  useEffect(() => {
    if (isLoaded && user) fetchLayers()
  }, [user, isLoaded, fetchLayers])

  // ── Init map ────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!mapContainer.current || map.current) return

    // Register COG protocol for reading GeoTIFFs directly
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

  // ── Sync layers to map ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!map.current || !mapReady) return

    layers.forEach((layer, idx) => {
      const sourceId = `source-${layer.id}`
      const layerId  = `layer-${layer.id}`
      const visibility = layer.visible ? 'visible' : 'none'

      if (layer.type === 'raster' && layer.cog_url) {
        if (!map.current!.getSource(sourceId)) {
          // Use COG protocol — reads GeoTIFF directly with range requests
          map.current!.addSource(sourceId, {
            type: 'raster',
            url: `cog://${layer.cog_url.replace('https://', '')}`,
            tileSize: 256,
          })
          map.current!.addLayer({
            id: layerId, type: 'raster', source: sourceId,
            paint: { 'raster-opacity': 0.85 },
            layout: { visibility },
          })
        } else {
          map.current!.setLayoutProperty(layerId, 'visibility', visibility)
        }
      }

      if (layer.type === 'vector' && layer.tiles_url) {
        const color = VECTOR_COLORS[idx % VECTOR_COLORS.length]
        const fillId   = `${layerId}-fill`
        const strokeId = `${layerId}-stroke`

        if (!map.current!.getSource(sourceId)) {
          map.current!.addSource(sourceId, {
            type: 'vector',
            tiles: [layer.tiles_url],
            minzoom: 0,
            maxzoom: 14,
          })
          // Fill layer
          map.current!.addLayer({
            id: fillId, type: 'fill', source: sourceId, 'source-layer': 'layer',
            paint: { 'fill-color': color, 'fill-opacity': 0.3 },
            layout: { visibility },
          })
          // Stroke layer
          map.current!.addLayer({
            id: strokeId, type: 'line', source: sourceId, 'source-layer': 'layer',
            paint: { 'line-color': color, 'line-width': 1.5 },
            layout: { visibility },
          })
        } else {
          map.current!.setLayoutProperty(fillId, 'visibility', visibility)
          map.current!.setLayoutProperty(strokeId, 'visibility', visibility)
        }
      }
    })
  }, [layers, mapReady])

  function toggleLayer(id: string) {
    setLayers(prev => prev.map(l => l.id === id ? { ...l, visible: !l.visible } : l))
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
  function copyAoi() { if (aoi) navigator.clipboard.writeText(JSON.stringify(aoi.geometry, null, 2)) }

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
          <p className="text-xs font-medium tracking-widest uppercase text-gray-400 mb-2 px-2">Data layers</p>
          {layers.length === 0 ? (
            <p className="text-xs text-gray-300 px-3 mt-2">
              No layers yet. Upload and process images or vectors first.
            </p>
          ) : (
            <>
              <LayerSection title="Images" icon="🛰️" layers={imageLayers} onToggleLayer={toggleLayer} />
              <LayerSection title="Vectors" icon="📐" layers={vectorLayers} onToggleLayer={toggleLayer} />
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
                drawMode ? 'bg-[#2C5F45] text-white border-[#2C5F45]' : 'border-gray-200 text-gray-600 hover:bg-gray-50'
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
          <button onClick={fetchLayers}
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
