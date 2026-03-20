'use client'
import { useUser } from '@clerk/nextjs'
import { useEffect, useRef, useState, useCallback } from 'react'
import maplibregl, { StyleSpecification } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'

type Layer = {
  id: string
  name: string
  type: 'raster' | 'vector'
  layer: string
  wms_url: string
  epsg: string | null
  visible: boolean
}

function makeBasemap(tileUrl: string, attribution: string): StyleSpecification {
  return {
    version: 8,
    sources: {
      basemap: {
        type: 'raster',
        tiles: [tileUrl],
        tileSize: 256,
        attribution,
      }
    },
    layers: [{ id: 'basemap', type: 'raster', source: 'basemap' }]
  }
}

const BASEMAPS = [
  {
    id: 'satellite',
    label: 'Satellite',
    style: makeBasemap(
      'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      '© Esri'
    ),
  },
  {
    id: 'osm',
    label: 'OpenStreetMap',
    style: makeBasemap(
      'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
      '© OpenStreetMap contributors'
    ),
  },
  {
    id: 'terrain',
    label: 'Terrain',
    style: makeBasemap(
      'https://tile.opentopomap.org/{z}/{x}/{y}.png',
      '© OpenTopoMap'
    ),
  },
]

export default function MapPage() {
  const { user } = useUser()
  const mapContainer = useRef<HTMLDivElement>(null)
  const map = useRef<maplibregl.Map | null>(null)
  const [layers, setLayers] = useState<Layer[]>([])
  const [basemap, setBasemap] = useState('satellite')
  const [mapReady, setMapReady] = useState(false)
  const API = process.env.NEXT_PUBLIC_API_URL

  const fetchLayers = useCallback(async () => {
    if (!user) return
    try {
      const res = await fetch(`${API}/layers/${user.id}`)
      const data = await res.json()
      setLayers((data.layers || []).map((l: Omit<Layer, 'visible'>) => ({ ...l, visible: true })))
    } catch {
      setLayers([])
    }
  }, [user, API])

  useEffect(() => {
    if (!mapContainer.current || map.current) return

    map.current = new maplibregl.Map({
      container: mapContainer.current,
      style: BASEMAPS[0].style,
      center: [-60, -35],
      zoom: 4,
    })

    map.current.addControl(new maplibregl.NavigationControl(), 'top-right')
    map.current.addControl(new maplibregl.ScaleControl(), 'bottom-right')
    map.current.on('load', () => setMapReady(true))

    return () => {
      map.current?.remove()
      map.current = null
    }
  }, [])

  useEffect(() => {
    if (user) fetchLayers()
  }, [user, fetchLayers])

  useEffect(() => {
    if (!map.current || !mapReady) return
    layers.forEach(layer => {
      const sourceId = `wms-${layer.id}`
      const layerId = `layer-${layer.id}`
      if (!map.current!.getSource(sourceId)) {
        map.current!.addSource(sourceId, {
          type: 'raster',
          tiles: [
            `${layer.wms_url}?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetMap` +
            `&LAYERS=${layer.layer}&BBOX={bbox-epsg-3857}` +
            `&WIDTH=256&HEIGHT=256&SRS=EPSG:3857&FORMAT=image/png&TRANSPARENT=true`
          ],
          tileSize: 256,
        })
        map.current!.addLayer({
          id: layerId,
          type: 'raster',
          source: sourceId,
          paint: { 'raster-opacity': 0.85 },
          layout: { visibility: layer.visible ? 'visible' : 'none' },
        })
      } else {
        map.current!.setLayoutProperty(
          layerId, 'visibility', layer.visible ? 'visible' : 'none'
        )
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

  return (
    <div className="flex h-[calc(100vh-2rem)] -m-10 overflow-hidden rounded-xl">
      <div className="w-64 bg-white border-r border-gray-100 flex flex-col shadow-sm">
        <div className="px-5 py-4 border-b border-gray-100">
          <p className="text-xs font-medium tracking-widest uppercase text-[#5A9E7C]">Map viewer</p>
          <h2 className="text-base font-semibold text-[#1C1C1C] mt-0.5">Layers</h2>
        </div>

        <div className="px-5 py-3 border-b border-gray-100">
          <p className="text-xs font-medium tracking-widest uppercase text-gray-400 mb-2">Basemap</p>
          <div className="space-y-1">
            {BASEMAPS.map(bm => (
              <button key={bm.id} onClick={() => changeBasemap(bm.id)}
                className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${
                  basemap === bm.id
                    ? 'bg-[#EDF4F0] text-[#2C5F45] font-medium'
                    : 'text-gray-500 hover:bg-gray-50'
                }`}>
                {bm.label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-3">
          <p className="text-xs font-medium tracking-widest uppercase text-gray-400 mb-2">Data layers</p>
          {layers.length === 0 ? (
            <p className="text-xs text-gray-300 mt-2">
              No layers available yet. Upload and process images or vectors first.
            </p>
          ) : (
            <div className="space-y-1">
              {layers.map(layer => (
                <div key={layer.id}
                  className="flex items-center gap-2.5 px-3 py-2.5 rounded-lg hover:bg-gray-50 cursor-pointer"
                  onClick={() => toggleLayer(layer.id)}>
                  <div className={`w-3.5 h-3.5 rounded border-2 flex-shrink-0 transition-colors ${
                    layer.visible ? 'bg-[#2C5F45] border-[#2C5F45]' : 'border-gray-300 bg-white'
                  }`} />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-gray-700 truncate">{layer.name}</p>
                    <p className="text-xs text-gray-400">{layer.type} · {layer.epsg || '—'}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="px-5 py-3 border-t border-gray-100">
          <button onClick={fetchLayers}
            className="w-full text-xs text-gray-400 hover:text-[#2C5F45] transition-colors py-1">
            Refresh layers
          </button>
        </div>
      </div>

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
      </div>
    </div>
  )
}
