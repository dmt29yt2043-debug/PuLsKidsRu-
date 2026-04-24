'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import dynamic from 'next/dynamic';
import type { Event, FilterState } from '@/lib/types';
import {
  initAnalytics,
  trackFilterApplied,
  trackCardExpanded,
  trackEventImpression,
  trackMapOpened,
  trackFeedScroll,
  trackEvent as track,
} from '@/lib/analytics';
import EventDetail from '@/components/EventDetail';
import ChatSidebar from '@/components/ChatSidebar';
import WhatFilter from '@/components/FilterDialogs/WhatFilter';
import WhenFilter from '@/components/FilterDialogs/WhenFilter';
import BudgetFilter from '@/components/FilterDialogs/BudgetFilter';
import WhoFilter from '@/components/FilterDialogs/WhoFilter';
import WhereFilter from '@/components/FilterDialogs/WhereFilter';
import EventCardV2 from '@/components/EventCardV2';
import DateBar from '@/components/DateBar';
import DigestShelf from '@/components/DigestShelf';
import EmptyStateSuggestions from '@/components/EmptyStateSuggestions';
import FavoritesPanel from '@/components/FavoritesPanel';
import { FavoritesProvider, useFavorites } from '@/lib/FavoritesContext';
import type { MapBounds } from '@/components/discovery/discovery-state';

const MapView = dynamic(() => import('@/components/MapView'), { ssr: false });

interface Category {
  slug: string;
  label: string;
}

const PAGE_SIZE = 30;

function formatDateRange(filters: FilterState): string {
  // Append T00:00:00 to parse as local time instead of UTC midnight (avoids -1 day offset)
  if (filters.dateFrom && filters.dateTo) {
    const from = new Date(filters.dateFrom + 'T00:00:00').toLocaleDateString('ru-RU', { month: 'short', day: 'numeric' });
    const to = new Date(filters.dateTo + 'T00:00:00').toLocaleDateString('ru-RU', { month: 'short', day: 'numeric' });
    return `${from} – ${to}`;
  }
  if (filters.dateFrom) {
    return `С ${new Date(filters.dateFrom + 'T00:00:00').toLocaleDateString('ru-RU', { month: 'short', day: 'numeric' })}`;
  }
  return 'Любая дата';
}

function formatWho(filters: FilterState): string {
  if (filters.filterChildren && filters.filterChildren.length > 0) {
    const parts = filters.filterChildren.map((c) => {
      const g = c.gender === 'boy' ? '👦' : c.gender === 'girl' ? '👧' : '🧒';
      return `${g}${c.age}`;
    });
    return parts.join(' ');
  }
  if (filters.ageMax !== undefined && filters.ageMax !== null) {
    return `До ${filters.ageMax} лет`;
  }
  return 'Любой';
}

function formatWhere(filters: FilterState): string {
  const nbs = filters.neighborhoods;
  if (!nbs || nbs.length === 0 || nbs.includes('Вся Москва')) return 'Вся Москва';
  if (nbs.length === 1) return nbs[0];
  return `${nbs.length} округа`;
}

function formatBudget(filters: FilterState): string {
  if (filters.isFree) return 'Бесплатно';
  if (filters.priceMin !== undefined && filters.priceMax !== undefined) return `${filters.priceMin} – ${filters.priceMax} ₽`;
  if (filters.priceMin !== undefined) return `От ${filters.priceMin} ₽`;
  if (filters.priceMax !== undefined) return `До ${filters.priceMax} ₽`;
  return 'Любой бюджет';
}

/**
 * Check whether a single event matches the FilterState. Used to intersect
 * a pre-programmed digest list with the user's active filters client-side.
 * Only covers the filters that actually constrain the visible event set —
 * chat/search and map bounds are intentionally excluded.
 */
function eventMatchesFilters(event: Event, filters: FilterState): boolean {
  // isFree
  if (filters.isFree && !event.is_free) return false;
  // Price range — only apply when the event actually has pricing info (>0)
  if (filters.priceMin !== undefined && filters.priceMin > 0) {
    if (event.is_free) return false;
    if ((event.price_max ?? 0) < filters.priceMin) return false;
  }
  if (filters.priceMax !== undefined && !event.is_free) {
    if ((event.price_min ?? 0) > filters.priceMax) return false;
  }
  // Age (ageMax = upper bound kid can attend)
  if (filters.ageMax !== undefined && filters.ageMax !== null) {
    const bestFrom = event.age_best_from ?? event.age_min;
    if (bestFrom !== null && bestFrom !== undefined && bestFrom > filters.ageMax) return false;
    if (event.age_best_to !== null && event.age_best_to !== undefined && event.age_best_to < filters.ageMax) return false;
  }
  // Date range
  const startStr = event.next_start_at;
  if (filters.dateFrom && startStr) {
    if (startStr.slice(0, 10) < filters.dateFrom) return false;
  }
  if (filters.dateTo && startStr) {
    if (startStr.slice(0, 10) > filters.dateTo) return false;
  }
  // Categories — match against category_l1, categories JSON, tags JSON
  if (filters.categories && filters.categories.length > 0) {
    const cats = (event.categories || []).map((c) => String(c).toLowerCase());
    const tags = (event.tags || []).map((t) => String(t).toLowerCase());
    const l1 = (event.category_l1 || '').toLowerCase();
    const wanted = filters.categories.map((c) => c.toLowerCase());
    const hit = wanted.some((w) => l1 === w || cats.some((c) => c.includes(w)) || tags.some((t) => t.includes(w)));
    if (!hit) return false;
  }
  // Exclude categories
  if (filters.excludeCategories && filters.excludeCategories.length > 0) {
    const l1 = (event.category_l1 || '').toLowerCase();
    if (filters.excludeCategories.some((c) => c.toLowerCase() === l1)) return false;
  }
  // Neighborhoods (simple substring match against city/address)
  if (filters.neighborhoods && filters.neighborhoods.length > 0 && !filters.neighborhoods.includes('Вся Москва')) {
    const loc = `${event.city || ''} ${event.address || ''}`.toLowerCase();
    const hit = filters.neighborhoods.some((n) => loc.includes(n.toLowerCase()));
    if (!hit) return false;
  }
  return true;
}

export default function Home() {
  return <FavoritesProvider><HomeInner /></FavoritesProvider>;
}

function HomeInner() {
  // Data state
  const [events, setEvents] = useState<Event[]>([]);
  const [allEvents, setAllEvents] = useState<Event[]>([]);   // unfiltered feed
  const [filteredEvents, setFilteredEvents] = useState<Event[]>([]);
  const [total, setTotal] = useState(0);
  const [allTotal, setAllTotal] = useState(0);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);

  // UI state
  const [filters, setFilters] = useState<FilterState>({});
  const [selectedEvent, setSelectedEvent] = useState<Event | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [openFilter, setOpenFilter] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'feed' | 'foryou'>('feed');

  // Debug session: tracks events flagged as having a wrong age range.
  // Persists server-side in data/debug_sessions.json. We hold a local copy
  // of flagged ids for instant UI feedback.
  const [flaggedIds, setFlaggedIds] = useState<Set<number>>(new Set());
  const [activeSession, setActiveSession] = useState<{ id: number; flagsCount: number } | null>(null);

  // Active digest — when set, the feed is replaced by a pre-programmed list
  // of events that belong to this digest. Acts like a preset filter.
  // Clicking the already-active digest card toggles it off.
  const [activeDigest, setActiveDigest] = useState<{
    slug: string;
    title: string;
    subtitle?: string;
    curator_name?: string;
    category_tag?: string;
  } | null>(null);
  const [digestEvents, setDigestEvents] = useState<Event[]>([]);
  const [digestLoading, setDigestLoading] = useState(false);
  // Drill-down: click on a category_tag in the banner → show peers in a popover.
  const [tagPeerPopover, setTagPeerPopover] = useState<null | { tag: string; digests: Array<{ slug: string; title: string; subtitle?: string; curator_name?: string; event_count: number }> }>(null);

  // Track whether the user EXPLICITLY clicked the "For you" tab. We use this
  // to avoid the "stuck on empty For you" UX where a narrow filter combo
  // (e.g. Staten Island + age 5 + niche category) leaves the user staring at
  // a 0-event grid with no easy escape. If the user picked it themselves, we
  // respect that. If we auto-jumped them there (quiz, post-filter), we fall
  // back to "All" once we discover the result set is empty.
  const userClickedForYouRef = useRef(false);

  // Auto-switch to "For you" tab when arriving from quiz + track page view
  useEffect(() => {
    if (typeof window !== 'undefined') {
      initAnalytics();
      const params = new URLSearchParams(window.location.search);
      if (params.get('source') === 'quiz') setActiveTab('foryou');
    }
  }, []);

  // Auto-fallback "For you (0)" → "All". Triggers ONLY when:
  //   · current tab is 'foryou'
  //   · the For-you total is 0 (filters yielded nothing)
  //   · we have events overall (so falling back actually helps)
  //   · the user did NOT click For you themselves (programmatic switches only)
  // Without this, users coming through quiz / post-filter actions get stuck
  // on an empty grid even when there are 200+ events in NYC right now.
  useEffect(() => {
    if (
      activeTab === 'foryou' &&
      !loading &&
      total === 0 &&
      allTotal > 0 &&
      !userClickedForYouRef.current
    ) {
      setActiveTab('feed');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [total, loading, allTotal]);
  const [favoritesOpen, setFavoritesOpen] = useState(false);

  // Price range slider (dual handles)
  const [priceSliderMin, setPriceSliderMin] = useState(0);
  const [priceSliderMax, setPriceSliderMax] = useState(3000);
  const [chatResetKey, setChatResetKey] = useState(0);

  // Discovery state
  const [hoveredItemId, setHoveredItemId] = useState<number | null>(null);
  const [selectedItemId, setSelectedItemId] = useState<number | null>(null);
  const [mapBounds, setMapBounds] = useState<MapBounds | null>(null);
  const [searchAreaActive, setSearchAreaActive] = useState(false);
  const [boundsFiltered, setBoundsFiltered] = useState(false);
  const [mapExpanded, setMapExpanded] = useState(false);

  const { favoriteIds, favoriteEvents } = useFavorites();
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const resultsRef = useRef<HTMLDivElement>(null);

  // QA-only: floating debug-session widget is gated to devices with
  // localStorage.pulseup_debug === '1'. Same flag as EventDetail's flag row.
  const [debugMode, setDebugMode] = useState(false);
  useEffect(() => {
    try { setDebugMode(localStorage.getItem('pulseup_debug') === '1'); } catch {}
  }, []);

  // Fetch categories on mount — API returns {value,label}, component expects {slug,label}
  useEffect(() => {
    fetch('/api/categories')
      .then((res) => res.json())
      .then((data: { value: string; label: string }[]) => {
        if (Array.isArray(data))
          setCategories(data.map((c) => ({ slug: c.value, label: c.label })));
      })
      .catch(console.error);
  }, []);

  // Fetch all events (no filters) for Feed tab
  useEffect(() => {
    fetch('/api/events?page=1&page_size=500')
      .then((res) => res.json())
      .then((data) => {
        setAllEvents(data.events || []);
        setAllTotal(data.total || 0);
      })
      .catch(console.error);
  }, []);

  // Fetch events whenever filters or page change.
  //
  // CRITICAL: We cancel in-flight requests when filters change — otherwise a
  // slow "unfiltered" request fired during initial render can arrive AFTER
  // the filtered request and overwrite the UI with 195 unrelated events.
  // This was the "age filter silently dropped on quiz landing" bug — the
  // filter state was correct, the API call was correct, but a stale initial
  // fetch clobbered the filtered result.
  useEffect(() => {
    const controller = new AbortController();
    let canceled = false;

    (async () => {
      setLoading(true);
      try {
        const params = new URLSearchParams();
        params.set('page', '1');
        params.set('page_size', '500');

        if (filters.categories && filters.categories.length > 0) {
          params.set('categories', filters.categories.join(','));
        }
        if (filters.excludeCategories && filters.excludeCategories.length > 0) {
          params.set('exclude_categories', filters.excludeCategories.join(','));
        }
        if (filters.priceMin !== undefined) {
          params.set('price_min', String(filters.priceMin));
        }
        if (filters.priceMax !== undefined) {
          params.set('price_max', String(filters.priceMax));
        }
        if (filters.isFree) {
          params.set('is_free', 'true');
        }
        // Multi-child mode: send all kids' ages so the API can match
        // events suitable for at least one of them and tag partial fits.
        const kidsForFilter = filters.filterChildren && filters.filterChildren.length > 0
          ? filters.filterChildren
          : undefined;
        if (kidsForFilter && kidsForFilter.length >= 2) {
          params.set('child_ages', kidsForFilter.map((c) => c.age).join(','));
          const genders = kidsForFilter.map((c) => c.gender).join(',');
          params.set('child_genders', genders);
        } else if (filters.ageMax !== undefined) {
          params.set('age', String(filters.ageMax));
          if (kidsForFilter && kidsForFilter.length === 1) {
            params.set('child_genders', kidsForFilter[0].gender);
          }
        }
        if (filters.dateFrom) params.set('date_from', filters.dateFrom);
        if (filters.dateTo)   params.set('date_to',   filters.dateTo);
        if (filters.search)   params.set('search',    filters.search);
        if (filters.lat && filters.lon && filters.distance) {
          params.set('lat', String(filters.lat));
          params.set('lon', String(filters.lon));
          params.set('distance', String(filters.distance));
        }
        if (filters.neighborhoods && filters.neighborhoods.length > 0) {
          params.set('neighborhoods', filters.neighborhoods.join(','));
        }
        if (filters.ratingMin !== undefined) {
          params.set('rating_min', String(filters.ratingMin));
        }

        const res = await fetch(`/api/events?${params.toString()}`, { signal: controller.signal });
        if (canceled) return;
        const data = await res.json();
        if (canceled) return;

        const evts = data.events || [];
        setEvents(evts);
        setFilteredEvents(evts);
        setTotal(data.total || 0);
        setBoundsFiltered(false);
        setSearchAreaActive(false);
      } catch (err) {
        // AbortError is expected when filters change while a fetch is in flight.
        if ((err as Error)?.name === 'AbortError') return;
        if (!canceled) console.error('Failed to fetch events:', err);
      } finally {
        if (!canceled) setLoading(false);
      }
    })();

    return () => {
      canceled = true;
      controller.abort();
    };
  }, [filters, page]);

  // Load active debug session on mount so flagged checkboxes stay checked across reloads.
  useEffect(() => {
    fetch('/api/flags/age')
      .then((r) => r.json())
      .then((data) => {
        if (data.session) {
          setActiveSession({ id: data.session.id, flagsCount: data.session.flags?.length ?? 0 });
        }
        setFlaggedIds(new Set<number>(data.flagged_ids || []));
      })
      .catch(() => {});
  }, []);

  const toggleFlag = useCallback(async (event: Event, flagged: boolean) => {
    // Optimistic UI
    setFlaggedIds((prev) => {
      const next = new Set(prev);
      if (flagged) next.add(event.id);
      else next.delete(event.id);
      return next;
    });
    try {
      if (flagged) {
        const res = await fetch('/api/flags/age', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            event_id: event.id,
            title: event.title,
            age_label: event.age_label || null,
            age_min: event.age_min,
            age_best_from: event.age_best_from,
            age_best_to: event.age_best_to,
            filters,
          }),
        });
        const data = await res.json();
        if (data?.session) {
          setActiveSession({ id: data.session.id, flagsCount: data.session.flags.length });
        }
      } else {
        const res = await fetch(`/api/flags/age?event_id=${event.id}`, { method: 'DELETE' });
        const data = await res.json();
        if (data?.session) {
          setActiveSession({ id: data.session.id, flagsCount: data.session.flags.length });
        }
      }
    } catch {
      // Rollback on failure
      setFlaggedIds((prev) => {
        const next = new Set(prev);
        if (flagged) next.delete(event.id);
        else next.add(event.id);
        return next;
      });
    }
  }, [filters]);

  const closeDebugSession = useCallback(async () => {
    try {
      const res = await fetch('/api/debug/session', { method: 'POST' });
      const data = await res.json();
      if (data?.ok) {
        setActiveSession(null);
        setFlaggedIds(new Set());
        // eslint-disable-next-line no-alert
        alert(`Session #${data.closed?.id ?? ''} closed. ${data.closed?.flags?.length ?? 0} flagged events saved to data/debug_sessions.json`);
      }
    } catch {}
  }, []);

  // Scroll card into view when map pin is hovered
  const mapHoverTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (hoveredItemId === null) return;
    // Small debounce so rapid mouse movements don't thrash the scroll
    if (mapHoverTimeoutRef.current) clearTimeout(mapHoverTimeoutRef.current);
    mapHoverTimeoutRef.current = setTimeout(() => {
      if (resultsRef.current) {
        const cardEl = resultsRef.current.querySelector(`[data-event-id="${hoveredItemId}"]`);
        if (cardEl) cardEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    }, 80);
    return () => {
      if (mapHoverTimeoutRef.current) clearTimeout(mapHoverTimeoutRef.current);
    };
  }, [hoveredItemId]);

  // Refs hold the current filter/tab/digest context without forcing a new
  // handler closure on every state change. Cheap alternative to wiring 6 deps
  // into useCallback.
  const cardContextRef = useRef<{
    tab: 'feed' | 'foryou';
    digestSlug: string | null;
    filterSummary: {
      has_filters: boolean;
      active_categories: string[];
      active_neighborhoods: string[];
    };
  }>({ tab: 'feed', digestSlug: null, filterSummary: { has_filters: false, active_categories: [], active_neighborhoods: [] } });

  // Handlers
  const handleEventClick = useCallback((event: Event, position?: number, listTotal?: number) => {
    // Card expansion event — source defaults to 'feed' since this handler
    // fires from the main event grid. Chat/digest variants use handleCardClick below.
    const ctx = cardContextRef.current;
    trackCardExpanded({
      event_id: event.id,
      event_title: event.title,
      source: ctx.digestSlug ? 'digest' : 'feed',
      position,
      list_total: listTotal,
      came_from_tab: ctx.tab,
      came_from_digest: ctx.digestSlug,
      has_filters: ctx.filterSummary.has_filters,
      active_categories: ctx.filterSummary.active_categories,
      active_neighborhoods: ctx.filterSummary.active_neighborhoods,
    });
    setSelectedEvent(event);
    setDetailOpen(true);
    setSelectedItemId(event.id);
  }, []);

  const handleCloseDetail = useCallback(() => {
    setDetailOpen(false);
    setTimeout(() => setSelectedEvent(null), 300);
  }, []);

  const handleFilterReset = useCallback(() => {
    trackFilterApplied({ action: 'reset' }, 'reset');
    // Clear everything including Who (age/children) — full reset.
    setFilters({});
    setPage(1);
    setPriceSliderMin(0);
    setPriceSliderMax(200);
    setActiveTab('feed');
    setChatResetKey((k) => k + 1);
  }, []);

  /**
   * Called by ChatSidebar when filters change from any path inside it:
   *   'chat'  — AI chat response
   *   'ui'    — onboarding chip clicks, quiz URL
   *   'reset' — profile reset clears filters
   * The source flows through to trackFilterApplied so we can answer
   * "is the AI chat working?" vs "do parents manage with UI alone?".
   */
  const handleFiltersFromChat = useCallback(
    (newFilters: FilterState, source: 'chat' | 'ui' | 'reset') => {
      trackFilterApplied(newFilters as Record<string, unknown>, source);
      setFilters(newFilters);
      setPage(1);
      setActiveTab('foryou');
    },
    [],
  );

  // Discovery handlers — alternative card-click path used by the discovery section.
  const handleCardClick = useCallback((event: unknown, position?: number, listTotal?: number) => {
    const ev = event as { id: number; title: string };
    const ctx = cardContextRef.current;
    trackCardExpanded({
      event_id: ev.id,
      event_title: ev.title,
      source: ctx.digestSlug ? 'digest' : 'feed',
      position,
      list_total: listTotal,
      came_from_tab: ctx.tab,
      came_from_digest: ctx.digestSlug,
      has_filters: ctx.filterSummary.has_filters,
      active_categories: ctx.filterSummary.active_categories,
      active_neighborhoods: ctx.filterSummary.active_neighborhoods,
    });
    setSelectedItemId(ev.id);
    setSelectedEvent(event as Parameters<typeof setSelectedEvent>[0]);
    setDetailOpen(true);
  }, []);

  const handleMapSelectItem = useCallback((id: number | null) => {
    setSelectedItemId(id);
    if (id != null && resultsRef.current) {
      const cardEl = resultsRef.current.querySelector(`[data-event-id="${id}"]`);
      if (cardEl) {
        cardEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    }
  }, []);

  const handleViewDetailsFromMap = useCallback((event: Event) => {
    setSelectedEvent(event);
    setDetailOpen(true);
    setSelectedItemId(event.id);
  }, []);

  const handleSearchThisArea = useCallback(() => {
    if (!mapBounds) return;
    const inBounds = events.filter((e) => {
      if (e.lat == null || e.lon == null) return false;
      return (
        e.lat >= mapBounds.south &&
        e.lat <= mapBounds.north &&
        e.lon >= mapBounds.west &&
        e.lon <= mapBounds.east
      );
    });
    setFilteredEvents(inBounds);
    setBoundsFiltered(true);
    setSearchAreaActive(false);
  }, [mapBounds, events]);

  const handleBoundsChange = useCallback((bounds: MapBounds) => {
    setMapBounds(bounds);
  }, []);

  // Filter dialog handlers
  const handleWhatApply = useCallback(
    (included: string[], excluded: string[], search: string, highRating: boolean) => {
      trackFilterApplied(
        { filter: 'what', categories: included, excludeCategories: excluded, search, highRating },
        'ui',
      );
      setFilters((prev) => ({
        ...prev,
        categories: included.length > 0 ? included : undefined,
        excludeCategories: excluded.length > 0 ? excluded : undefined,
        search: search || undefined,
        ratingMin: highRating ? 4.5 : undefined,
      }));
      setPage(1);
      setActiveTab('foryou');
      setOpenFilter(null);
    },
    []
  );

  const handleWhenApply = useCallback((dateFrom: string, dateTo: string) => {
    trackFilterApplied({ filter: 'when', dateFrom, dateTo }, 'ui');
    setFilters((prev) => ({
      ...prev,
      dateFrom: dateFrom || undefined,
      dateTo: dateTo || undefined,
    }));
    setPage(1);
    setActiveTab('foryou');
    setOpenFilter(null);
  }, []);

  const handleDateBarSelect = useCallback((date: string | undefined) => {
    trackFilterApplied({ filter: 'datebar', date }, 'ui');
    setFilters((prev) => ({
      ...prev,
      dateFrom: date || undefined,
      dateTo: date || undefined,
    }));
    setPage(1);
    if (date) setActiveTab('foryou');
  }, []);

  const handleBudgetApply = useCallback(
    (priceMin?: number, priceMax?: number, isFree?: boolean) => {
      trackFilterApplied({ filter: 'budget', priceMin, priceMax, isFree }, 'ui');
      setFilters((prev) => ({
        ...prev,
        priceMin,
        priceMax,
        isFree,
      }));
      setPage(1);
      setActiveTab('foryou');
      setOpenFilter(null);
    },
    []
  );

  const handleWhoApply = useCallback((ageMax?: number, filterChildren?: import('@/lib/types').FilterChild[]) => {
    trackFilterApplied({ filter: 'who', ageMax, filter_children_count: filterChildren?.length ?? 0 }, 'ui');
    setFilters((prev) => ({
      ...prev,
      ageMax,
      filterChildren,
    }));
    setPage(1);
    setActiveTab('foryou');
    setOpenFilter(null);
  }, []);

  const handleWhereApply = useCallback((neighborhoods: string[]) => {
    trackFilterApplied({ filter: 'where', neighborhoods }, 'ui');
    const hasNeighborhoods = neighborhoods.length > 0 && !neighborhoods.includes('Вся Москва');
    setFilters((prev) => ({
      ...prev,
      neighborhoods: hasNeighborhoods ? neighborhoods : undefined,
    }));
    setPage(1);
    setOpenFilter(null);
    setActiveTab('foryou');
  }, []);

  // Price slider handlers (dual range)
  const handlePriceMinChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const val = Math.min(Number(e.target.value), priceSliderMax);
    setPriceSliderMin(val);
  }, [priceSliderMax]);

  const handlePriceMaxChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const val = Math.max(Number(e.target.value), priceSliderMin);
    setPriceSliderMax(val);
  }, [priceSliderMin]);

  const handlePriceSliderCommit = useCallback(() => {
    const hasMin = priceSliderMin > 0;
    const hasMax = priceSliderMax < 3000;
    trackFilterApplied(
      {
        filter: 'price_slider',
        priceMin: hasMin ? priceSliderMin : undefined,
        priceMax: hasMax ? priceSliderMax : undefined,
      },
      'ui',
    );
    setFilters((prev) => ({
      ...prev,
      priceMin: hasMin ? priceSliderMin : undefined,
      priceMax: hasMax ? priceSliderMax : undefined,
    }));
    setPage(1);
    setActiveTab('foryou');
  }, [priceSliderMin, priceSliderMax]);

  // Digest selection handlers (digest = pre-programmed event set acting as filter).
  // Helper: sync ?digest=<slug> in the URL without reloading the page. This
  // makes digest selections shareable ("here's my weekend plan") and
  // restorable across refreshes.
  const syncDigestInUrl = useCallback((slug: string | null) => {
    if (typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    if (slug) url.searchParams.set('digest', slug);
    else url.searchParams.delete('digest');
    window.history.replaceState({}, '', url.toString());
  }, []);

  const loadDigest = useCallback(async (slug: string): Promise<boolean> => {
    setDigestLoading(true);
    try {
      const res = await fetch(`/api/digests/${slug}`);
      if (!res.ok) return false;
      const data = await res.json();
      if (data?.digest && Array.isArray(data?.events)) {
        setActiveDigest({
          slug: data.digest.slug,
          title: data.digest.title,
          subtitle: data.digest.subtitle,
          curator_name: data.digest.curator_name,
          category_tag: data.digest.category_tag,
        });
        setDigestEvents(data.events);
        if (favoritesOnly) setFavoritesOnly(false);
        return true;
      }
      return false;
    } catch (err) {
      console.error('Failed to load digest', err);
      return false;
    } finally {
      setDigestLoading(false);
    }
  }, [favoritesOnly]);

  const handleDigestSelect = useCallback(async (slug: string) => {
    // Toggle off if clicking the same digest
    if (activeDigest?.slug === slug) {
      trackFilterApplied({ action: 'digest_cleared', digest_slug: slug }, 'digest');
      setActiveDigest(null);
      setDigestEvents([]);
      syncDigestInUrl(null);
      return;
    }
    const ok = await loadDigest(slug);
    if (ok) {
      syncDigestInUrl(slug);
      // Digest acts as a filter: intersect with current filter state.
      // Tag the filter-change as 'digest' so we can measure digest-path conversion.
      trackFilterApplied({ action: 'digest_selected', digest_slug: slug }, 'digest');
      track('digest_selected', { slug });
    }
  }, [activeDigest, loadDigest, syncDigestInUrl]);

  const handleDigestClear = useCallback(() => {
    trackFilterApplied({ action: 'digest_cleared' }, 'digest');
    setActiveDigest(null);
    setDigestEvents([]);
    syncDigestInUrl(null);
  }, [syncDigestInUrl]);

  // Click on category_tag (e.g. SEASONAL) in the active-digest banner
  // → fetch all digests sharing that tag and show them in a popover.
  const handleTagClick = useCallback(async (tag: string) => {
    if (!tag) return;
    try {
      const res = await fetch('/api/digests');
      if (!res.ok) return;
      const data = await res.json();
      const all: Array<{ slug: string; title: string; subtitle?: string; curator_name?: string; event_count: number; category_tag?: string }> =
        (data.categories || []).flatMap((cat: { digests: unknown[] }) => cat.digests);
      const peers = all
        .filter((d) => (d.category_tag || '').toUpperCase() === tag.toUpperCase())
        .filter((d) => d.slug !== activeDigest?.slug);
      setTagPeerPopover({ tag, digests: peers });
      track('digest_tag_click', { tag, peer_count: peers.length });
    } catch (err) {
      console.error('Failed to fetch tag peers', err);
    }
  }, [activeDigest]);

  // On mount — restore digest from ?digest=<slug> URL parameter (shareable links)
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const slug = params.get('digest');
    if (slug) {
      loadDigest(slug).then((ok) => {
        if (!ok) syncDigestInUrl(null); // clean invalid slug from URL
        else trackFilterApplied({ action: 'digest_from_url', digest_slug: slug }, 'digest');
      });
    }
    // Intentionally empty deps: run once on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const forYouEvents = boundsFiltered ? filteredEvents : events;
  // Tabs are now purely a content switch:
  //   "All"     → unfiltered pool (what's happening in NYC, period)
  //   "For you" → filtered pool (matches your profile + sidebar filters)
  // This keeps the visible grid in sync with the tab counts ("All 195" really
  // means 195 events, not "34 because filters are hidden-applied").
  // "For you" additionally respects map-bounds filtering when zoomed in.
  const baseEvents = activeTab === 'feed'
    ? allEvents
    : forYouEvents;
  // When a digest is active, show its curated list as-is. We used to
  // intersect it with sidebar filters ("digest = hard constraint, filters
  // narrow within it"), but that was confusing: a parent with "3yo +
  // Brooklyn" who tapped a digest card would see 0 events because the
  // digest was curated against the full pool. A digest is itself a
  // preset — clicking it should just show the curated picks.
  const displayEvents = activeDigest
    ? digestEvents
    : (favoritesOnly ? favoriteEvents : baseEvents);
  const displayTotal = activeDigest
    ? digestEvents.length
    : (favoritesOnly
        ? favoriteIds.size
        : activeTab === 'feed'
          ? allTotal
          : total);

  // Keep the click-tracking context ref in sync with current state so
  // card_expanded / buy_tickets_clicked events carry accurate attribution
  // without forcing those handlers to re-create on every keystroke.
  cardContextRef.current = {
    tab: activeTab,
    digestSlug: activeDigest?.slug ?? null,
    filterSummary: {
      has_filters: !!(
        filters.categories?.length ||
        filters.neighborhoods?.length ||
        filters.search ||
        filters.priceMin ||
        filters.priceMax ||
        filters.isFree ||
        filters.ageMax
      ),
      active_categories: filters.categories ?? [],
      active_neighborhoods: filters.neighborhoods ?? [],
    },
  };

  // Scroll-depth tracking (25 / 50 / 75 / 100%). Fires once per depth per
  // session. Engagement signal — tells us whether users look past page 1.
  useEffect(() => {
    const onScroll = () => {
      const doc = document.documentElement;
      const scrolled = (doc.scrollTop + window.innerHeight) / doc.scrollHeight;
      const pct = Math.round(scrolled * 100);
      const milestones: (25 | 50 | 75 | 100)[] = [25, 50, 75, 100];
      for (const m of milestones) {
        if (pct >= m) {
          trackFeedScroll({ depth_pct: m, events_visible: displayEvents.length, tab: activeTab });
        }
      }
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [displayEvents.length, activeTab]);

  const sliderMinPct = Math.round((priceSliderMin / 3000) * 100);
  const sliderMaxPct = Math.round((priceSliderMax / 3000) * 100);

  return (
    <div className="flex flex-col h-screen overflow-hidden">
      {/* ===== Header ===== */}
      <header className="v2-header">
        {/* Logo */}
        <button onClick={() => { localStorage.removeItem('pulseup_profile'); window.location.replace(window.location.pathname); }} className="v2-header-logo" style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
          <img src="/logo.png" alt="Pulse" style={{ height: 36, width: 'auto' }} />
        </button>

        {/* Center: title + tabs */}
        <div className="flex items-center gap-4">
          <div className="v2-header-center">
            <span className="v2-header-title">Лучшие события для детей в Москве</span>
          </div>
          <div className="v2-header-tabs">
            <button
              className={`v2-header-tab ${activeTab === 'feed' ? 'active' : ''}`}
              onClick={() => {
                userClickedForYouRef.current = false;
                track('tab_switched', { tab: 'feed' });
                setActiveTab('feed');
              }}
            >
              Все ({allTotal})
            </button>
            <button
              className={`v2-header-tab ${activeTab === 'foryou' ? 'active' : ''}`}
              onClick={() => {
                // Mark as user-explicit so the auto-fallback effect respects
                // the choice even if the result set is empty.
                userClickedForYouRef.current = true;
                track('tab_switched', { tab: 'foryou' });
                setActiveTab('foryou');
              }}
            >
              Для вас ({total})
            </button>
          </div>
        </div>

        {/* Right icons */}
        <div className="v2-header-right">
          <button
            className="v2-header-icon"
            onClick={() => setFavoritesOnly((v) => !v)}
            style={{ position: 'relative' }}
            title={favoritesOnly ? 'Показать все события' : 'Показать сохранённые'}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill={favoritesOnly ? '#e91e63' : favoriteIds.size > 0 ? '#e91e63' : 'none'} stroke="#e91e63" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
            </svg>
            {favoriteIds.size > 0 && (
              <span style={{
                position: 'absolute', top: -4, right: -4,
                background: '#e91e63', color: 'white',
                fontSize: 9, fontWeight: 700,
                width: 16, height: 16, borderRadius: '50%',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                {favoriteIds.size}
              </span>
            )}
          </button>
          <div className="v2-header-avatar">M</div>
        </div>
      </header>

      {/* ===== Main 3-column layout ===== */}
      <div className="discovery-layout">
        {/* LEFT SIDEBAR: filters + chat */}
        <aside className="v2-sidebar">
          {/* Filter section */}
          <div className="v2-sidebar-filters">
            <div className="v2-sidebar-filters-label">Фильтры</div>

            {/* Price Range Slider (dual handle) */}
            <div className="v2-price-range">
              <div className="v2-price-range-header">
                <span className="v2-price-range-label">Диапазон цен</span>
                <span className="v2-price-range-value">
                  {priceSliderMin} – {priceSliderMax >= 3000 ? '3000+' : priceSliderMax} ₽
                </span>
              </div>
              <div
                className="v2-dual-range"
                style={{
                  '--range-min': `${sliderMinPct}%`,
                  '--range-max': `${sliderMaxPct}%`,
                } as React.CSSProperties}
              >
                <div className="v2-dual-range-track" />
                <div className="v2-dual-range-fill" />
                <input
                  type="range"
                  min="0"
                  max="3000"
                  step="100"
                  value={priceSliderMin}
                  onChange={handlePriceMinChange}
                  onMouseUp={handlePriceSliderCommit}
                  onTouchEnd={handlePriceSliderCommit}
                  className="v2-price-slider v2-price-slider--min"
                />
                <input
                  type="range"
                  min="0"
                  max="3000"
                  step="100"
                  value={priceSliderMax}
                  onChange={handlePriceMaxChange}
                  onMouseUp={handlePriceSliderCommit}
                  onTouchEnd={handlePriceSliderCommit}
                  className="v2-price-slider v2-price-slider--max"
                />
              </div>
            </div>

            {/* What filter */}
            <div className="v2-filter-item" onClick={() => setOpenFilter('what')}>
              <div className="v2-filter-item-icon">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="3" width="7" height="7" />
                  <rect x="14" y="3" width="7" height="7" />
                  <rect x="14" y="14" width="7" height="7" />
                  <rect x="3" y="14" width="7" height="7" />
                </svg>
              </div>
              <span className="v2-filter-item-label">Что</span>
              <span className="v2-filter-item-value">
                {filters.categories && filters.categories.length > 0
                  ? `${filters.categories.length} выбрано`
                  : 'Активности'}
              </span>
              <span className="v2-filter-item-chevron">&rsaquo;</span>
            </div>

            {/* Date filter */}
            <div className="v2-filter-item" onClick={() => setOpenFilter('when')}>
              <div className="v2-filter-item-icon">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                  <line x1="16" y1="2" x2="16" y2="6" />
                  <line x1="8" y1="2" x2="8" y2="6" />
                  <line x1="3" y1="10" x2="21" y2="10" />
                </svg>
              </div>
              <span className="v2-filter-item-label">Дата</span>
              <span className="v2-filter-item-value">{formatDateRange(filters)}</span>
              <span className="v2-filter-item-chevron">&rsaquo;</span>
            </div>

            {/* Who filter */}
            <div className="v2-filter-item" onClick={() => setOpenFilter('who')}>
              <div className="v2-filter-item-icon">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                  <circle cx="12" cy="7" r="4" />
                </svg>
              </div>
              <span className="v2-filter-item-label">Кто</span>
              <span className="v2-filter-item-value">{formatWho(filters)}</span>
              <span className="v2-filter-item-chevron">&rsaquo;</span>
            </div>

            {/* Where filter */}
            <div className="v2-filter-item" onClick={() => setOpenFilter('where')}>
              <div className="v2-filter-item-icon">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
                  <circle cx="12" cy="10" r="3" />
                </svg>
              </div>
              <span className="v2-filter-item-label">Где</span>
              <span className="v2-filter-item-value">{formatWhere(filters)}</span>
              <span className="v2-filter-item-chevron">&rsaquo;</span>
            </div>

            {/* Reset button */}
            {(filters.categories || filters.priceMin !== undefined || filters.priceMax !== undefined || filters.dateFrom || filters.ageMax !== undefined || filters.isFree || filters.neighborhoods) && (
              <button
                onClick={handleFilterReset}
                className="mt-2 w-full text-center text-xs py-1.5 rounded-lg transition-colors"
                style={{ color: 'var(--primary)', background: 'rgba(233,30,99,0.1)' }}
              >
                Сбросить фильтры
              </button>
            )}
          </div>

          <div className="v2-sidebar-divider" />

          {/* Chat section */}
          <div className="v2-chat-section">
            <div className="v2-chat-header">
              <div className="v2-chat-header-icon">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                </svg>
              </div>
              <div className="v2-chat-header-text">
                <span className="v2-chat-header-title">Pulse AI</span>
                <span className="v2-chat-header-subtitle">Ищем события в Москве</span>
              </div>
            </div>

            {/* ChatSidebar (reused, but rendered inline in the sidebar) */}
            <ChatSidebar
              key={chatResetKey}
              filters={filters}
              onFiltersChange={handleFiltersFromChat}
              onEventClick={handleEventClick}
            />
          </div>
        </aside>

        {/* CENTER: results grid */}
        <div className="results-column" ref={resultsRef}>
          {/* Digest shelf — always visible above event grid.
              Clicking a digest replaces the feed with its pre-programmed events. */}
          <DigestShelf
            onDigestSelect={handleDigestSelect}
            activeDigestSlug={activeDigest?.slug ?? null}
          />

          {/* Active-digest banner: shows which preset is applied + clear button */}
          {activeDigest && (
            <div className="active-digest-banner">
              <div className="active-digest-banner__info">
                <span className="active-digest-banner__icon">📚</span>
                <div>
                  <div className="active-digest-banner__title">
                    {activeDigest.category_tag && (
                      <button
                        type="button"
                        className="active-digest-banner__tag"
                        onClick={() => handleTagClick(activeDigest.category_tag!)}
                        title={`See more ${activeDigest.category_tag} digests`}
                      >
                        {activeDigest.category_tag}
                      </button>
                    )}
                    {activeDigest.title}
                    <span className="active-digest-banner__count">
                      · {digestEvents.length} событий
                    </span>
                  </div>
                  {(activeDigest.subtitle || activeDigest.curator_name) && (
                    <div className="active-digest-banner__sub">
                      {activeDigest.subtitle}
                      {activeDigest.curator_name && (
                        <span className="active-digest-banner__curator"> от {activeDigest.curator_name}</span>
                      )}
                    </div>
                  )}
                </div>
              </div>
              <button
                className="active-digest-banner__clear"
                onClick={handleDigestClear}
                aria-label="Clear digest"
              >
                ✕ Закрыть
              </button>
            </div>
          )}

          {/* Tag-peers popover: shows all digests sharing the clicked category_tag */}
          {tagPeerPopover && (
            <div
              className="digest-tag-peers-backdrop"
              onClick={() => setTagPeerPopover(null)}
            >
              <div
                className="digest-tag-peers"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="digest-tag-peers__header">
                  <h3>
                    Ещё <span className="digest-tag-peers__tag">{tagPeerPopover.tag}</span> подборок
                  </h3>
                  <button
                    className="digest-tag-peers__close"
                    onClick={() => setTagPeerPopover(null)}
                    aria-label="Close"
                  >✕</button>
                </div>
                {tagPeerPopover.digests.length === 0 ? (
                  <div className="digest-tag-peers__empty">
                    Других {tagPeerPopover.tag} подборок пока нет.
                  </div>
                ) : (
                  <ul className="digest-tag-peers__list">
                    {tagPeerPopover.digests.map((d) => (
                      <li
                        key={d.slug}
                        className="digest-tag-peers__item"
                        onClick={() => {
                          setTagPeerPopover(null);
                          handleDigestSelect(d.slug);
                        }}
                      >
                        <div className="digest-tag-peers__title">{d.title}</div>
                        {d.subtitle && (
                          <div className="digest-tag-peers__sub">{d.subtitle}</div>
                        )}
                        <div className="digest-tag-peers__meta">
                          {d.event_count} событий
                          {d.curator_name && <> · от {d.curator_name}</>}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          )}

          <>
            {/* DateBar is always visible (even when no events found) so the user
                can tap a different date instead of being stuck with a dead screen. */}
            {!loading && !digestLoading && (
              <div className="results-sticky-top">
                <div className="all-events-heading">
                  <span>Все события</span>
                  <span className="all-events-count">{displayTotal}</span>
                </div>
                <DateBar
                  selectedDate={filters.dateFrom === filters.dateTo ? filters.dateFrom : undefined}
                  onSelect={handleDateBarSelect}
                />
              </div>
            )}
            {loading || digestLoading ? (
              <div className="results-loading">
                {Array.from({ length: 9 }).map((_, i) => (
                  <div key={i} className="result-skeleton">
                    <div className="result-skeleton-img" />
                    <div className="result-skeleton-text">
                      <div className="result-skeleton-line w-3/4" />
                      <div className="result-skeleton-line w-1/2" />
                      <div className="result-skeleton-line w-1/3" />
                    </div>
                  </div>
                ))}
              </div>
            ) : displayEvents.length === 0 ? (
              <div className="results-empty">
                <p className="text-base">Ничего не найдено</p>
                <p className="text-sm mt-1">Попробуйте изменить фильтры</p>
                <EmptyStateSuggestions
                  filters={filters}
                  onApply={(next) => {
                    trackFilterApplied({ action: 'empty_state_suggestion' }, 'ui');
                    setFilters(next);
                    setPage(1);
                  }}
                />
              </div>
            ) : (
              <div className={mapExpanded ? 'results-list results-list--2col' : 'results-list'}>
                {displayEvents.map((event, idx) => (
                  <EventCardV2
                    key={event.id}
                    event={event}
                    isHovered={hoveredItemId === event.id}
                    isSelected={selectedItemId === event.id}
                    onMouseEnter={() => setHoveredItemId(event.id)}
                    onMouseLeave={() => setHoveredItemId(null)}
                    onClick={() => handleCardClick(event, idx + 1, displayEvents.length)}
                    isFlagged={flaggedIds.has(event.id)}
                    onToggleFlag={toggleFlag}
                  />
                ))}
              </div>
            )}
          </>
        </div>

        {/* RIGHT: map */}
        <div className={mapExpanded ? 'map-column map-column--expanded' : 'map-column'}>
          <button
            className="map-expand-btn"
            onClick={() => {
              setMapExpanded(v => {
                const next = !v;
                // Track map engagement when user EXPANDS — not on collapse.
                // events_visible tells us what the user saw when they leaned in.
                if (next) {
                  trackMapOpened({
                    events_visible: displayEvents.length,
                    active_digest: activeDigest?.slug || null,
                    has_filters: Object.keys(filters).length > 0,
                  });
                }
                return next;
              });
            }}
            title={mapExpanded ? 'Свернуть карту' : 'Развернуть карту'}
          >
            {mapExpanded ? '›' : '‹'}
          </button>
          <MapView
            events={displayEvents}
            hoveredItemId={hoveredItemId}
            selectedItemId={selectedItemId}
            onHoverItem={setHoveredItemId}
            onSelectItem={handleMapSelectItem}
            onBoundsChange={handleBoundsChange}
            onSearchAreaActive={setSearchAreaActive}
            searchAreaActive={searchAreaActive}
            onSearchThisArea={handleSearchThisArea}
            onViewDetails={handleViewDetailsFromMap}
          />
        </div>
      </div>

      {/* Event Detail Overlay */}
      <EventDetail
        event={selectedEvent}
        open={detailOpen}
        onClose={handleCloseDetail}
        isFlagged={selectedEvent ? flaggedIds.has(selectedEvent.id) : false}
        onToggleFlag={toggleFlag}
      />

      {/* Floating debug session widget — QA-only (pulseup_debug flag). */}
      {debugMode && (activeSession && (activeSession.flagsCount > 0 || flaggedIds.size > 0)) && (
        <div className="debug-session-widget">
          <div className="debug-session-info">
            <span className="debug-session-title">Debug Session #{activeSession.id}</span>
            <span className="debug-session-count">{flaggedIds.size} flagged</span>
          </div>
          <button
            type="button"
            className="debug-session-close"
            onClick={closeDebugSession}
            title="Закрыть сессию и сохранить снимок"
          >
            Закрыть сессию
          </button>
        </div>
      )}

      {/* Filter Dialogs */}
      {openFilter === 'what' && (
        <WhatFilter
          categories={categories}
          includedCategories={filters.categories || []}
          excludedCategories={filters.excludeCategories || []}
          search={filters.search || ''}
          highRating={filters.ratingMin !== undefined && filters.ratingMin >= 4.5}
          onApply={handleWhatApply}
          onClose={() => setOpenFilter(null)}
        />
      )}
      {openFilter === 'when' && (
        <WhenFilter
          dateFrom={filters.dateFrom || ''}
          dateTo={filters.dateTo || ''}
          onApply={handleWhenApply}
          onClose={() => setOpenFilter(null)}
        />
      )}
      {openFilter === 'budget' && (
        <BudgetFilter
          priceMin={filters.priceMin}
          priceMax={filters.priceMax}
          isFree={filters.isFree}
          onApply={handleBudgetApply}
          onClose={() => setOpenFilter(null)}
        />
      )}
      {openFilter === 'who' && (
        <WhoFilter
          ageMax={filters.ageMax}
          children={filters.filterChildren}
          onApply={handleWhoApply}
          onRemember={(kids) => {
            try {
              const stored = localStorage.getItem('pulseup_profile');
              const profile = stored ? JSON.parse(stored) : {};
              profile.children = kids.map((c) => ({ age: c.age, gender: c.gender, interests: [] }));
              localStorage.setItem('pulseup_profile', JSON.stringify(profile));
            } catch { /* ignore */ }
          }}
          onClose={() => setOpenFilter(null)}
        />
      )}
      {openFilter === 'where' && (
        <WhereFilter
          selected={filters.neighborhoods || []}
          onApply={handleWhereApply}
          onClose={() => setOpenFilter(null)}
        />
      )}

      <FavoritesPanel
        open={favoritesOpen}
        onClose={() => setFavoritesOpen(false)}
        onEventClick={(event) => {
          setSelectedEvent(event);
          setDetailOpen(true);
        }}
      />

    </div>
  );
}
