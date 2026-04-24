'use client';

import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import type { Event } from './types';
import { track } from './analytics';

interface FavoritesContextValue {
  favoriteIds: Set<number>;
  favoriteEvents: Event[];
  toggle: (event: Event) => void;
  isFavorite: (id: number) => boolean;
}

const FavoritesContext = createContext<FavoritesContextValue>({
  favoriteIds: new Set(),
  favoriteEvents: [],
  toggle: () => {},
  isFavorite: () => false,
});

const STORAGE_KEY = 'pulseup_favorites';

export function FavoritesProvider({ children }: { children: React.ReactNode }) {
  const [favoriteList, setFavoriteList] = useState<Event[]>([]);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) setFavoriteList(JSON.parse(stored));
    } catch {}
  }, []);

  const toggle = useCallback((event: Event) => {
    setFavoriteList((prev) => {
      const exists = prev.some((e) => e.id === event.id);
      track('favorite_toggled', { event_id: event.id, event_title: event.title, action: exists ? 'remove' : 'add' });
      const next = exists
        ? prev.filter((e) => e.id !== event.id)
        : [...prev, event];
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch {}
      return next;
    });
  }, []);

  const favoriteIds = new Set(favoriteList.map((e) => e.id));
  const isFavorite = useCallback(
    (id: number) => favoriteList.some((e) => e.id === id),
    [favoriteList],
  );

  return (
    <FavoritesContext.Provider value={{ favoriteIds, favoriteEvents: favoriteList, toggle, isFavorite }}>
      {children}
    </FavoritesContext.Provider>
  );
}

export function useFavorites() {
  return useContext(FavoritesContext);
}
