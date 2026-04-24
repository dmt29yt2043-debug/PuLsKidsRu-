'use client';

import { useState } from 'react';

const NEIGHBORHOODS = [
  'Upper Manhattan',
  'Midtown',
  'Lower Manhattan',
  'Brooklyn',
  'Queens',
  'Bronx',
  'Staten Island',
  'Anywhere in NYC',
];

interface WhereFilterProps {
  selected: string[];
  onApply: (neighborhoods: string[]) => void;
  onClose: () => void;
}

export default function WhereFilter({ selected, onApply, onClose }: WhereFilterProps) {
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set(selected));

  const toggle = (nb: string) => {
    setSelectedItems((prev) => {
      const next = new Set(prev);
      if (nb === 'Anywhere in NYC') {
        // Selecting "Anywhere in NYC" clears all other selections
        return next.has(nb) ? new Set() : new Set([nb]);
      }
      // Selecting a specific neighborhood removes "Anywhere in NYC"
      next.delete('Anywhere in NYC');
      if (next.has(nb)) {
        next.delete(nb);
      } else {
        next.add(nb);
      }
      return next;
    });
  };

  const handleApply = () => {
    onApply([...selectedItems]);
  };

  const handleClear = () => {
    setSelectedItems(new Set());
  };

  return (
    <div className="filter-dialog-backdrop" onClick={onClose}>
      <div className="filter-dialog" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-lg font-semibold mb-4 text-white">Where in NYC?</h3>

        <div className="flex flex-wrap gap-2 mb-6">
          {NEIGHBORHOODS.map((nb) => {
            const isSelected = selectedItems.has(nb);
            return (
              <button
                key={nb}
                onClick={() => toggle(nb)}
                className={`category-chip ${isSelected ? 'include' : 'neutral'}`}
              >
                {isSelected && '✓ '}
                {nb}
              </button>
            );
          })}
        </div>

        <div className="flex gap-3">
          <button
            onClick={handleClear}
            className="flex-1 py-2 px-4 rounded-lg border border-[rgba(255,255,255,0.15)] text-sm font-medium text-gray-400 hover:bg-[rgba(255,255,255,0.05)]"
          >
            Clear
          </button>
          <button
            onClick={handleApply}
            className="flex-1 py-2 px-4 rounded-lg text-sm font-medium text-white"
            style={{ backgroundColor: '#e91e63' }}
          >
            Apply
          </button>
        </div>
      </div>
    </div>
  );
}
