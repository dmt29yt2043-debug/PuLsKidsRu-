'use client';

import { useState } from 'react';

interface BudgetFilterProps {
  priceMin?: number;
  priceMax?: number;
  isFree?: boolean;
  onApply: (priceMin?: number, priceMax?: number, isFree?: boolean) => void;
  onClose: () => void;
}

export default function BudgetFilter({
  priceMin: initialMin,
  priceMax: initialMax,
  isFree: initialFree,
  onApply,
  onClose,
}: BudgetFilterProps) {
  const [priceMin, setPriceMin] = useState<string>(initialMin !== undefined ? String(initialMin) : '');
  const [priceMax, setPriceMax] = useState<string>(initialMax !== undefined ? String(initialMax) : '');
  const [isFree, setIsFree] = useState(initialFree || false);

  const handleApply = () => {
    onApply(
      priceMin ? parseFloat(priceMin) : undefined,
      priceMax ? parseFloat(priceMax) : undefined,
      isFree || undefined
    );
  };

  const handleClear = () => {
    setPriceMin('');
    setPriceMax('');
    setIsFree(false);
  };

  return (
    <div className="filter-dialog-backdrop" onClick={onClose}>
      <div className="filter-dialog" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-lg font-semibold mb-4 text-white">Бюджет</h3>

        <div className="space-y-3 mb-4">
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-sm text-gray-400 mb-1">Мин (₽)</label>
              <input
                type="number"
                value={priceMin}
                onChange={(e) => setPriceMin(e.target.value)}
                placeholder="0"
                min="0"
                className="w-full px-3 py-2 border border-[rgba(255,255,255,0.1)] rounded-lg text-sm focus:outline-none focus:border-[#e91e63] bg-[#16143a] text-white placeholder-gray-500"
              />
            </div>
            <div className="flex-1">
              <label className="block text-sm text-gray-400 mb-1">Макс (₽)</label>
              <input
                type="number"
                value={priceMax}
                onChange={(e) => setPriceMax(e.target.value)}
                placeholder="Любой"
                min="0"
                className="w-full px-3 py-2 border border-[rgba(255,255,255,0.1)] rounded-lg text-sm focus:outline-none focus:border-[#e91e63] bg-[#16143a] text-white placeholder-gray-500"
              />
            </div>
          </div>

          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={isFree}
              onChange={(e) => setIsFree(e.target.checked)}
              className="w-4 h-4 accent-[#e91e63]"
            />
            <span className="text-sm text-gray-300">Только бесплатные</span>
          </label>
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
