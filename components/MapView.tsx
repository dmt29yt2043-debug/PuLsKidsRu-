'use client';

import { useEffect, useRef, useCallback } from 'react';
import type { Event } from '@/lib/types';
import L from 'leaflet';
import { renderMarkerPreviewHTML } from '@/components/discovery/MarkerPreviewCard';
import SearchThisAreaButton from '@/components/discovery/SearchThisAreaButton';
import type { MapBounds } from '@/components/discovery/discovery-state';

const TOMTOM_KEY = process.env.NEXT_PUBLIC_TOMTOM_API_KEY || 'l9WXwQeiaM0XOFjaLMv1LMOZxKSK60Jf';
const TILE_URL = `https://api.tomtom.com/map/1/tile/basic/main/{z}/{x}/{y}.png?key=${TOMTOM_KEY}`;

interface MapViewProps {
  events: Event[];
  hoveredItemId: number | null;
  selectedItemId: number | null;
  onHoverItem: (id: number | null) => void;
  onSelectItem: (id: number | null) => void;
  onBoundsChange: (bounds: MapBounds) => void;
  onSearchAreaActive: (v: boolean) => void;
  searchAreaActive: boolean;
  onSearchThisArea: () => void;
  onViewDetails: (event: Event) => void;
}

function createMarkerIcon(state: 'default' | 'hovered' | 'selected', priceText?: string): L.DivIcon {
  const size = state === 'selected' ? 36 : state === 'hovered' ? 28 : 20;
  const bg = state === 'selected' ? '#e91e63' : state === 'hovered' ? '#f06292' : '#e91e63';
  const opacity = state === 'default' ? 0.85 : 1;
  const zIdx = state === 'selected' ? 1000 : state === 'hovered' ? 900 : 100;
  const border = state === 'selected' ? '3px solid white' : '2px solid white';
  const shadow = state === 'selected'
    ? '0 2px 8px rgba(233,30,99,0.5)'
    : state === 'hovered'
      ? '0 2px 6px rgba(233,30,99,0.4)'
      : '0 1px 4px rgba(0,0,0,0.3)';

  if (priceText && state !== 'default') {
    // Show price pill for hovered/selected
    return L.divIcon({
      className: `map-marker-${state}`,
      html: `<div style="
        background:${bg};
        color:white;
        font-size:11px;
        font-weight:600;
        padding:3px 8px;
        border-radius:12px;
        border:${border};
        box-shadow:${shadow};
        white-space:nowrap;
        opacity:${opacity};
        z-index:${zIdx};
        position:relative;
      ">${priceText}</div>`,
      iconSize: [0, 0],
      iconAnchor: [0, 0],
    });
  }

  return L.divIcon({
    className: `map-marker-${state}`,
    html: `<div style="
      width:${size}px;
      height:${size}px;
      background:${bg};
      border-radius:50%;
      border:${border};
      box-shadow:${shadow};
      opacity:${opacity};
      z-index:${zIdx};
      position:relative;
    "></div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

function getPriceText(event: Event): string {
  if (event.is_free) return 'Бесплатно';
  if (event.price_min > 0) return `${event.price_min} ₽`;
  return '';
}

function MapViewInner({
  events,
  hoveredItemId,
  selectedItemId,
  onHoverItem,
  onSelectItem,
  onBoundsChange,
  onSearchAreaActive,
  searchAreaActive,
  onSearchThisArea,
  onViewDetails,
}: MapViewProps) {
  const mapRef = useRef<L.Map | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const markersRef = useRef<Map<number, L.Marker>>(new Map());
  const layerGroupRef = useRef<L.LayerGroup | null>(null);
  const eventsMapRef = useRef<Map<number, Event>>(new Map());
  const initialBoundsSetRef = useRef(false);
  const programmaticMoveRef = useRef(false);

  // Initialize map
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = L.map(containerRef.current, {
      center: [55.7558, 37.6173], // Центр Москвы
      zoom: 11,
      zoomControl: true,
    });

    L.tileLayer(TILE_URL, {
      attribution:
        '&copy; <a href="https://www.tomtom.com">TomTom</a> &copy; <a href="https://leafletjs.com">Leaflet</a>',
      maxZoom: 18,
    }).addTo(map);

    layerGroupRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;

    // Track bounds on move
    map.on('moveend', () => {
      if (programmaticMoveRef.current) {
        programmaticMoveRef.current = false;
        return;
      }
      const b = map.getBounds();
      onBoundsChange({
        north: b.getNorth(),
        south: b.getSouth(),
        east: b.getEast(),
        west: b.getWest(),
      });
      onSearchAreaActive(true);
    });

    // Click on map background clears selection
    map.on('click', () => {
      onSelectItem(null);
    });

    return () => {
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Update markers when events change
  useEffect(() => {
    const map = mapRef.current;
    const layerGroup = layerGroupRef.current;
    if (!map || !layerGroup) return;

    layerGroup.clearLayers();
    markersRef.current.clear();
    eventsMapRef.current.clear();

    const eventsWithCoords = events.filter((e) => e.lat != null && e.lon != null);

    eventsWithCoords.forEach((event) => {
      eventsMapRef.current.set(event.id, event);

      const priceText = getPriceText(event);
      const icon = createMarkerIcon('default', priceText);

      const marker = L.marker([event.lat!, event.lon!], {
        icon,
        zIndexOffset: 100,
      }).addTo(layerGroup);

      // Hover events
      marker.on('mouseover', () => {
        onHoverItem(event.id);
        // Show popup
        const popupHTML = renderMarkerPreviewHTML(event);
        marker.bindPopup(popupHTML, {
          closeButton: false,
          offset: [0, -10],
          className: 'marker-popup-custom',
          maxWidth: 240,
        }).openPopup();

        // Attach click handler to View Details button in popup
        setTimeout(() => {
          const popupEl = marker.getPopup()?.getElement();
          if (popupEl) {
            const btn = popupEl.querySelector('.marker-preview-details-btn');
            if (btn) {
              (btn as HTMLElement).onclick = (e) => {
                e.stopPropagation();
                onViewDetails(event);
              };
            }
          }
        }, 50);
      });

      marker.on('mouseout', () => {
        // Only clear hover if this event isn't selected
        if (selectedItemId !== event.id) {
          marker.closePopup();
        }
        onHoverItem(null);
      });

      marker.on('click', (e) => {
        L.DomEvent.stopPropagation(e);
        onSelectItem(event.id);
        // Show pinned popup
        const popupHTML = renderMarkerPreviewHTML(event);
        marker.bindPopup(popupHTML, {
          closeButton: true,
          offset: [0, -10],
          className: 'marker-popup-custom',
          maxWidth: 240,
        }).openPopup();

        setTimeout(() => {
          const popupEl = marker.getPopup()?.getElement();
          if (popupEl) {
            const btn = popupEl.querySelector('.marker-preview-details-btn');
            if (btn) {
              (btn as HTMLElement).onclick = (ev) => {
                ev.stopPropagation();
                onViewDetails(event);
              };
            }
          }
        }, 50);
      });

      markersRef.current.set(event.id, marker);
    });

    // Fit bounds to Moscow-area events only, or default to Moscow center
    if (eventsWithCoords.length > 0 && !initialBoundsSetRef.current) {
      // Filter to Moscow area events only (roughly within 50km of Kremlin)
      const mskEvents = eventsWithCoords.filter(
        (e) => e.lat! > 55.4 && e.lat! < 56.1 && e.lon! > 36.9 && e.lon! < 38.0
      );
      if (mskEvents.length > 0) {
        const bounds = L.latLngBounds(
          mskEvents.map((e) => [e.lat!, e.lon!] as L.LatLngTuple)
        );
        programmaticMoveRef.current = true;
        map.fitBounds(bounds, { padding: [30, 30], maxZoom: 13 });
      } else {
        // Fallback: zoom to Moscow center
        programmaticMoveRef.current = true;
        map.setView([55.7558, 37.6173], 11);
      }
      initialBoundsSetRef.current = true;
    }
  }, [events, onHoverItem, onSelectItem, onViewDetails, selectedItemId]);

  // Update marker styles on hover/select changes
  useEffect(() => {
    markersRef.current.forEach((marker, id) => {
      const event = eventsMapRef.current.get(id);
      if (!event) return;
      const priceText = getPriceText(event);

      let state: 'default' | 'hovered' | 'selected' = 'default';
      if (id === selectedItemId) state = 'selected';
      else if (id === hoveredItemId) state = 'hovered';

      const icon = createMarkerIcon(state, priceText);
      marker.setIcon(icon);
      marker.setZIndexOffset(state === 'selected' ? 1000 : state === 'hovered' ? 900 : 100);
    });
  }, [hoveredItemId, selectedItemId]);

  // FlyTo when selectedItemId changes from card click
  const flyTo = useCallback((eventId: number) => {
    const map = mapRef.current;
    if (!map) return;
    const event = eventsMapRef.current.get(eventId);
    if (!event || event.lat == null || event.lon == null) return;
    programmaticMoveRef.current = true;
    map.flyTo([event.lat, event.lon], Math.max(map.getZoom(), 14), { duration: 0.8 });
  }, []);

  // Expose flyTo via ref-like pattern: call it when selectedItemId changes
  const prevSelectedRef = useRef<number | null>(null);
  useEffect(() => {
    if (selectedItemId != null && selectedItemId !== prevSelectedRef.current) {
      flyTo(selectedItemId);
    }
    prevSelectedRef.current = selectedItemId;
  }, [selectedItemId, flyTo]);

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
      <SearchThisAreaButton visible={searchAreaActive} onClick={onSearchThisArea} />
    </div>
  );
}

export default MapViewInner;
