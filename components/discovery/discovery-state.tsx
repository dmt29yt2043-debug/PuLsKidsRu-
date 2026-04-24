'use client';

import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';

export interface MapBounds {
  north: number;
  south: number;
  east: number;
  west: number;
}

interface DiscoveryState {
  hoveredItemId: number | null;
  selectedItemId: number | null;
  setHoveredItemId: (id: number | null) => void;
  setSelectedItemId: (id: number | null) => void;
  mapBounds: MapBounds | null;
  setMapBounds: (bounds: MapBounds | null) => void;
  searchAreaActive: boolean;
  setSearchAreaActive: (v: boolean) => void;
}

const DiscoveryContext = createContext<DiscoveryState | null>(null);

export function DiscoveryProvider({ children }: { children: ReactNode }) {
  const [hoveredItemId, setHoveredItemIdRaw] = useState<number | null>(null);
  const [selectedItemId, setSelectedItemIdRaw] = useState<number | null>(null);
  const [mapBounds, setMapBoundsRaw] = useState<MapBounds | null>(null);
  const [searchAreaActive, setSearchAreaActiveRaw] = useState(false);

  const setHoveredItemId = useCallback((id: number | null) => {
    setHoveredItemIdRaw(id);
  }, []);

  const setSelectedItemId = useCallback((id: number | null) => {
    setSelectedItemIdRaw(id);
  }, []);

  const setMapBounds = useCallback((bounds: MapBounds | null) => {
    setMapBoundsRaw(bounds);
  }, []);

  const setSearchAreaActive = useCallback((v: boolean) => {
    setSearchAreaActiveRaw(v);
  }, []);

  return (
    <DiscoveryContext.Provider
      value={{
        hoveredItemId,
        selectedItemId,
        setHoveredItemId,
        setSelectedItemId,
        mapBounds,
        setMapBounds,
        searchAreaActive,
        setSearchAreaActive,
      }}
    >
      {children}
    </DiscoveryContext.Provider>
  );
}

export function useDiscovery(): DiscoveryState {
  const ctx = useContext(DiscoveryContext);
  if (!ctx) {
    throw new Error('useDiscovery must be used within a DiscoveryProvider');
  }
  return ctx;
}
