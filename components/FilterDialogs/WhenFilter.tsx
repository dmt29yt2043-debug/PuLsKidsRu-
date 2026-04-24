'use client';

import { useState, useMemo } from 'react';

interface WhenFilterProps {
  dateFrom: string;
  dateTo: string;
  onApply: (dateFrom: string, dateTo: string) => void;
  onClose: () => void;
}

function toISO(d: Date): string {
  return d.toISOString().split('T')[0];
}

function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function isInRange(day: Date, from: Date | null, to: Date | null): boolean {
  if (!from || !to) return false;
  return day >= from && day <= to;
}

export default function WhenFilter({ dateFrom: initialFrom, dateTo: initialTo, onApply, onClose }: WhenFilterProps) {
  const today = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }, []);

  const [selectedFrom, setSelectedFrom] = useState<Date | null>(initialFrom ? new Date(initialFrom) : null);
  const [selectedTo, setSelectedTo] = useState<Date | null>(initialTo ? new Date(initialTo) : null);
  const [viewMonth, setViewMonth] = useState(today.getMonth());
  const [viewYear, setViewYear] = useState(today.getFullYear());
  const [activeQuick, setActiveQuick] = useState<string | null>(null);

  // Quick select presets
  const quickOptions = useMemo(() => {
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const dayAfter = new Date(today);
    dayAfter.setDate(dayAfter.getDate() + 2);

    // Find next Saturday
    const satOffset = (6 - today.getDay() + 7) % 7 || 7;
    const nextSat = new Date(today);
    nextSat.setDate(nextSat.getDate() + satOffset);
    const nextSun = new Date(nextSat);
    nextSun.setDate(nextSun.getDate() + 1);

    return [
      { label: 'Tomorrow', from: tomorrow, to: tomorrow },
      { label: 'Day after', from: dayAfter, to: dayAfter },
      { label: 'Weekend', from: nextSat, to: nextSun },
    ];
  }, [today]);

  const handleQuickSelect = (opt: { label: string; from: Date; to: Date }) => {
    setSelectedFrom(opt.from);
    setSelectedTo(opt.to);
    setActiveQuick(opt.label);
    // Jump calendar to that month
    setViewMonth(opt.from.getMonth());
    setViewYear(opt.from.getFullYear());
  };

  const handleDayClick = (day: Date) => {
    if (day < today) return;
    setActiveQuick(null);

    if (!selectedFrom || (selectedFrom && selectedTo)) {
      // Start new selection
      setSelectedFrom(day);
      setSelectedTo(null);
    } else {
      // Complete selection
      if (day < selectedFrom) {
        setSelectedTo(selectedFrom);
        setSelectedFrom(day);
      } else {
        setSelectedTo(day);
      }
    }
  };

  const handleApply = () => {
    onApply(
      selectedFrom ? toISO(selectedFrom) : '',
      selectedTo ? toISO(selectedTo) : (selectedFrom ? toISO(selectedFrom) : ''),
    );
  };

  const handleClear = () => {
    setSelectedFrom(null);
    setSelectedTo(null);
    setActiveQuick(null);
  };

  // Calendar grid
  const calendarDays = useMemo(() => {
    const firstDay = new Date(viewYear, viewMonth, 1);
    const lastDay = new Date(viewYear, viewMonth + 1, 0);
    const startPad = firstDay.getDay(); // 0=Sun
    const days: (Date | null)[] = [];

    for (let i = 0; i < startPad; i++) days.push(null);
    for (let d = 1; d <= lastDay.getDate(); d++) {
      days.push(new Date(viewYear, viewMonth, d));
    }
    return days;
  }, [viewMonth, viewYear]);

  const monthLabel = new Date(viewYear, viewMonth).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

  const prevMonth = () => {
    if (viewMonth === 0) { setViewMonth(11); setViewYear(viewYear - 1); }
    else setViewMonth(viewMonth - 1);
  };
  const nextMonth = () => {
    if (viewMonth === 11) { setViewMonth(0); setViewYear(viewYear + 1); }
    else setViewMonth(viewMonth + 1);
  };

  // Summary text
  const summaryText = useMemo(() => {
    if (!selectedFrom) return 'Select dates';
    const fmt = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    if (!selectedTo || isSameDay(selectedFrom, selectedTo)) return fmt(selectedFrom);
    return `${fmt(selectedFrom)} – ${fmt(selectedTo)}`;
  }, [selectedFrom, selectedTo]);

  return (
    <div className="filter-dialog-backdrop" onClick={onClose}>
      <div className="filter-dialog" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 380 }}>
        <h3 className="text-lg font-semibold mb-3 text-white">When?</h3>

        {/* Quick buttons */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
          {quickOptions.map((opt) => (
            <button
              key={opt.label}
              onClick={() => handleQuickSelect(opt)}
              style={{
                flex: 1,
                padding: '8px 4px',
                borderRadius: 8,
                fontSize: 13,
                fontWeight: 600,
                border: activeQuick === opt.label ? '2px solid #e91e63' : '2px solid rgba(255,255,255,0.1)',
                background: activeQuick === opt.label ? 'rgba(233,30,99,0.15)' : 'rgba(255,255,255,0.03)',
                color: activeQuick === opt.label ? '#e91e63' : '#9ca3af',
                cursor: 'pointer',
                transition: 'all 0.15s',
              }}
            >
              {opt.label}
            </button>
          ))}
        </div>

        {/* Calendar */}
        <div style={{ background: 'rgba(255,255,255,0.03)', borderRadius: 12, padding: '12px 10px', marginBottom: 16 }}>
          {/* Month nav */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, padding: '0 4px' }}>
            <button onClick={prevMonth} style={{ background: 'none', border: 'none', color: '#9ca3af', cursor: 'pointer', fontSize: 18, padding: '2px 8px' }}>‹</button>
            <span style={{ color: 'white', fontSize: 14, fontWeight: 600 }}>{monthLabel}</span>
            <button onClick={nextMonth} style={{ background: 'none', border: 'none', color: '#9ca3af', cursor: 'pointer', fontSize: 18, padding: '2px 8px' }}>›</button>
          </div>

          {/* Day headers */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 2, marginBottom: 4 }}>
            {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map((d) => (
              <div key={d} style={{ textAlign: 'center', fontSize: 11, color: '#6b7280', padding: '4px 0', fontWeight: 500 }}>{d}</div>
            ))}
          </div>

          {/* Days grid */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 2 }}>
            {calendarDays.map((day, i) => {
              if (!day) return <div key={`empty-${i}`} />;

              const isPast = day < today;
              const isFrom = selectedFrom && isSameDay(day, selectedFrom);
              const isTo = selectedTo && isSameDay(day, selectedTo);
              const inRange = isInRange(day, selectedFrom, selectedTo);
              const isToday = isSameDay(day, today);

              let bg = 'transparent';
              let color = isPast ? '#4b5563' : 'white';
              let border = 'none';
              let fontWeight = 400;

              if (isFrom || isTo) {
                bg = '#e91e63';
                color = 'white';
                fontWeight = 700;
              } else if (inRange) {
                bg = 'rgba(233,30,99,0.2)';
                color = '#f9a8d4';
              }
              if (isToday && !isFrom && !isTo) {
                border = '1px solid rgba(233,30,99,0.5)';
              }

              return (
                <button
                  key={i}
                  onClick={() => !isPast && handleDayClick(day)}
                  disabled={isPast}
                  style={{
                    width: '100%',
                    aspectRatio: '1',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    borderRadius: 8,
                    fontSize: 13,
                    fontWeight,
                    background: bg,
                    color,
                    border,
                    cursor: isPast ? 'default' : 'pointer',
                    transition: 'all 0.1s',
                  }}
                >
                  {day.getDate()}
                </button>
              );
            })}
          </div>
        </div>

        {/* Selected summary */}
        <div style={{ textAlign: 'center', fontSize: 13, color: '#9ca3af', marginBottom: 12 }}>
          {summaryText}
        </div>

        {/* Buttons */}
        <div style={{ display: 'flex', gap: 12 }}>
          <button
            onClick={handleClear}
            style={{
              flex: 1, padding: '10px 0', borderRadius: 8,
              border: '1px solid rgba(255,255,255,0.15)', background: 'transparent',
              color: '#9ca3af', fontSize: 14, fontWeight: 500, cursor: 'pointer',
            }}
          >
            Clear
          </button>
          <button
            onClick={handleApply}
            style={{
              flex: 1, padding: '10px 0', borderRadius: 8,
              border: 'none', background: '#e91e63',
              color: 'white', fontSize: 14, fontWeight: 600, cursor: 'pointer',
            }}
          >
            Apply
          </button>
        </div>
      </div>
    </div>
  );
}
