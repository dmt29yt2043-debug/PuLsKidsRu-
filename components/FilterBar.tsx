'use client';

import { FilterState } from '@/lib/types';

interface FilterBarProps {
  filters: FilterState;
  onOpenFilter: (filterName: string) => void;
  onReset: () => void;
}

const FILTER_PILLS = [
  { key: 'what', label: 'What' },
  { key: 'when', label: 'When' },
  { key: 'who', label: 'Who' },
  { key: 'budget', label: 'Budget' },
];

function isFilterActive(key: string, filters: FilterState): boolean {
  switch (key) {
    case 'what':
      return !!(
        (filters.categories && filters.categories.length > 0) ||
        (filters.excludeCategories && filters.excludeCategories.length > 0) ||
        filters.search
      );
    case 'when':
      return !!(filters.dateFrom || filters.dateTo);
    case 'who':
      return filters.ageMax !== undefined && filters.ageMax !== null;
    case 'budget':
      return !!(
        filters.priceMin !== undefined ||
        filters.priceMax !== undefined ||
        filters.isFree
      );
    default:
      return false;
  }
}

function hasAnyFilter(filters: FilterState): boolean {
  return FILTER_PILLS.some((p) => isFilterActive(p.key, filters));
}

export default function FilterBar({ filters, onOpenFilter, onReset }: FilterBarProps) {
  return (
    <div className="flex items-center gap-2 px-4 py-2 bg-white border-b border-gray-200 overflow-x-auto">
      {FILTER_PILLS.map((pill) => {
        const active = isFilterActive(pill.key, filters);
        return (
          <button
            key={pill.key}
            onClick={() => onOpenFilter(pill.key)}
            className="flex-shrink-0 px-4 py-1.5 rounded-full text-sm font-medium transition-colors"
            style={
              active
                ? { backgroundColor: '#e91e63', color: 'white' }
                : { backgroundColor: '#f3f4f6', color: '#374151' }
            }
          >
            {pill.label}
          </button>
        );
      })}
      {hasAnyFilter(filters) && (
        <button
          onClick={onReset}
          className="flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-gray-500 hover:bg-gray-200 transition-colors text-sm"
        >
          &#10005;
        </button>
      )}
    </div>
  );
}
