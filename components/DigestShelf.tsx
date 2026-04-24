'use client';

import { useEffect, useMemo, useState } from 'react';
import DigestCard from './DigestCard';
import type { FilterState } from '@/lib/types';

interface Digest {
  id: number;
  slug: string;
  title: string;
  subtitle: string;
  cover_image: string;
  category_tag: string;
  curator_name: string;
  curator_role: string;
  event_count: number;
  context_tags: string;
  category: string;
}

interface Category {
  name: string;
  digests: Digest[];
}

interface DigestShelfProps {
  onDigestSelect: (slug: string) => void;
  activeDigestSlug: string | null;
  /** Active sidebar filters — when they change the shelf is re-fetched so it
   *  matches the current feed context. Empty / default filters → full shelf. */
  filters?: FilterState;
}

/** Build the `/api/digests?…` query string from the active filter state. */
function buildQuery(filters: FilterState | undefined): string {
  if (!filters) return '';
  const params = new URLSearchParams();
  if (filters.categories && filters.categories.length > 0) {
    params.set('categories', filters.categories.join(','));
  }
  if (filters.ageMax !== undefined) {
    params.set('age_max', String(filters.ageMax));
  }
  if (filters.neighborhoods && filters.neighborhoods.length > 0) {
    params.set('neighborhoods', filters.neighborhoods.join(','));
  }
  if (filters.isFree === true) {
    params.set('is_free', 'true');
  }
  if (filters.priceMax !== undefined) {
    params.set('price_max', String(filters.priceMax));
  }
  if (filters.dateFrom) params.set('date_from', filters.dateFrom);
  if (filters.dateTo)   params.set('date_to',   filters.dateTo);
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

export default function DigestShelf({ onDigestSelect, activeDigestSlug, filters }: DigestShelfProps) {
  const [categories, setCategories] = useState<Category[]>([]);

  // Stable key for filters — triggers re-fetch only when meaningful fields change.
  const filterKey = useMemo(() => buildQuery(filters), [filters]);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/digests${filterKey}`)
      .then(r => r.json())
      .then(d => {
        if (!cancelled) setCategories(d.categories || []);
      })
      .catch(console.error);
    return () => { cancelled = true; };
  }, [filterKey]);

  const allDigests = categories.flatMap(cat => cat.digests);
  const hasActiveFilters = filterKey.length > 0;

  if (categories.length === 0 && !hasActiveFilters) return null;

  return (
    <div className="digest-shelf">
      <div className="digest-shelf-header">
        <div className="digest-shelf-title-row">
          <div>
            <h2 className="digest-shelf-title">Подборки редакции</h2>
            <p className="digest-shelf-sub">
              {hasActiveFilters
                ? `Подобрано под ваши фильтры — ${allDigests.length}`
                : 'Готовые подборки под ваш ритм жизни.'}
            </p>
          </div>
        </div>
      </div>

      {allDigests.length === 0 ? (
        <div className="digest-shelf-empty">
          Под выбранные фильтры подборок не нашлось. Попробуйте смягчить критерии.
        </div>
      ) : (
        <div className="digest-shelf-row">
          {allDigests.map(d => (
            <DigestCard
              key={d.slug}
              digest={d}
              onClick={onDigestSelect}
              isActive={activeDigestSlug === d.slug}
            />
          ))}
        </div>
      )}
    </div>
  );
}
