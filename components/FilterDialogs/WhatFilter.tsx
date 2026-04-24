'use client';

import { useState, useEffect } from 'react';

interface Category {
  slug: string;
  label: string;
}

type ChipState = 'neutral' | 'include' | 'exclude';

interface WhatFilterProps {
  categories: Category[];
  includedCategories: string[];
  excludedCategories: string[];
  search: string;
  highRating?: boolean;
  onApply: (included: string[], excluded: string[], search: string, highRating: boolean) => void;
  onClose: () => void;
}

export default function WhatFilter({
  categories,
  includedCategories,
  excludedCategories,
  search: initialSearch,
  highRating: initialHighRating = false,
  onApply,
  onClose,
}: WhatFilterProps) {
  const [chipStates, setChipStates] = useState<Record<string, ChipState>>(() => {
    const states: Record<string, ChipState> = {};
    categories.forEach((cat) => {
      if (includedCategories.includes(cat.slug)) {
        states[cat.slug] = 'include';
      } else if (excludedCategories.includes(cat.slug)) {
        states[cat.slug] = 'exclude';
      } else {
        states[cat.slug] = 'neutral';
      }
    });
    return states;
  });
  const [search, setSearch] = useState(initialSearch);
  const [highRating, setHighRating] = useState(initialHighRating);

  // Sync internal state when parent props change (e.g. global Reset)
  useEffect(() => {
    const states: Record<string, ChipState> = {};
    categories.forEach((cat) => {
      if (includedCategories.includes(cat.slug)) states[cat.slug] = 'include';
      else if (excludedCategories.includes(cat.slug)) states[cat.slug] = 'exclude';
      else states[cat.slug] = 'neutral';
    });
    setChipStates(states);
  }, [includedCategories, excludedCategories, categories]);

  useEffect(() => {
    setSearch(initialSearch);
  }, [initialSearch]);

  useEffect(() => {
    setHighRating(initialHighRating);
  }, [initialHighRating]);

  const cycleState = (slug: string) => {
    setChipStates((prev) => {
      const current = prev[slug] || 'neutral';
      const next: ChipState =
        current === 'neutral' ? 'include' : current === 'include' ? 'exclude' : 'neutral';
      return { ...prev, [slug]: next };
    });
  };

  const handleApply = () => {
    const included = Object.entries(chipStates)
      .filter(([, state]) => state === 'include')
      .map(([slug]) => slug);
    const excluded = Object.entries(chipStates)
      .filter(([, state]) => state === 'exclude')
      .map(([slug]) => slug);
    onApply(included, excluded, search, highRating);
  };

  const handleClear = () => {
    const cleared: Record<string, ChipState> = {};
    categories.forEach((cat) => {
      cleared[cat.slug] = 'neutral';
    });
    setChipStates(cleared);
    setSearch('');
    setHighRating(false);
  };

  return (
    <div className="filter-dialog-backdrop" onClick={onClose}>
      <div className="filter-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-white">Что ищем?</h3>
          <label className="flex items-center gap-2 cursor-pointer text-sm text-gray-300 hover:text-white">
            <input
              type="checkbox"
              checked={highRating}
              onChange={(e) => setHighRating(e.target.checked)}
              style={{ accentColor: '#ffc107', width: 16, height: 16 }}
            />
            <span>★ Рейтинг 4.5+</span>
          </label>
        </div>

        <div className="mb-4">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Поиск по ключевым словам..."
            className="w-full px-3 py-2 border border-[rgba(255,255,255,0.1)] rounded-lg text-sm focus:outline-none focus:border-[#e91e63] bg-[#16143a] text-white placeholder-gray-500"
          />
        </div>

        <p className="text-xs text-gray-500 mb-3">
          Нажмите — выбрать (зелёный), ещё раз — исключить (красный), снова — сбросить
        </p>

        <div className="flex flex-wrap gap-2 mb-6">
          {categories.map((cat) => (
            <button
              key={cat.slug}
              onClick={() => cycleState(cat.slug)}
              className={`category-chip ${chipStates[cat.slug] || 'neutral'}`}
            >
              {chipStates[cat.slug] === 'include' && '+ '}
              {chipStates[cat.slug] === 'exclude' && '- '}
              {cat.label}
            </button>
          ))}
        </div>

        <div className="flex gap-3">
          <button
            onClick={handleClear}
            className="flex-1 py-2 px-4 rounded-lg border border-[rgba(255,255,255,0.15)] text-sm font-medium text-gray-400 hover:bg-[rgba(255,255,255,0.05)]"
          >
            Сбросить
          </button>
          <button
            onClick={handleApply}
            className="flex-1 py-2 px-4 rounded-lg text-sm font-medium text-white"
            style={{ backgroundColor: '#e91e63' }}
          >
            Применить
          </button>
        </div>
      </div>
    </div>
  );
}
