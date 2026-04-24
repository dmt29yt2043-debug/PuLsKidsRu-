'use client';

import { useRef, useEffect, useMemo } from 'react';

interface DateBarProps {
  /** Currently selected date in YYYY-MM-DD format, or undefined */
  selectedDate?: string;
  /** Called when user clicks a date */
  onSelect: (date: string | undefined) => void;
}

/** Number of days to show ahead */
const DAYS_AHEAD = 28;

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function fmt(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export default function DateBar({ selectedDate, onSelect }: DateBarProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  const days = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const arr: { date: Date; key: string; isToday: boolean; isWeekend: boolean }[] = [];
    for (let i = 0; i < DAYS_AHEAD; i++) {
      const d = new Date(today);
      d.setDate(today.getDate() + i);
      arr.push({
        date: d,
        key: fmt(d),
        isToday: i === 0,
        isWeekend: d.getDay() === 0 || d.getDay() === 6,
      });
    }
    return arr;
  }, []);

  // Scroll selected date into view on mount
  useEffect(() => {
    if (!selectedDate || !scrollRef.current) return;
    const el = scrollRef.current.querySelector(`[data-date="${selectedDate}"]`) as HTMLElement;
    if (el) el.scrollIntoView({ inline: 'center', behavior: 'smooth' });
  }, [selectedDate]);

  // Track which months appear for month labels
  let lastMonth = -1;

  return (
    <div className="datebar-wrapper">
      <div className="datebar-scroll" ref={scrollRef}>
        {days.map((d) => {
          const showMonth = d.date.getMonth() !== lastMonth;
          if (showMonth) lastMonth = d.date.getMonth();
          const isActive = selectedDate === d.key;

          return (
            <div key={d.key} className="datebar-cell-wrap">
              {showMonth ? (
                <span className="datebar-month">{MONTH_NAMES[d.date.getMonth()]}</span>
              ) : (
                <span className="datebar-month-spacer" />
              )}
              <button
                data-date={d.key}
                className={[
                  'datebar-cell',
                  isActive ? 'active' : '',
                  d.isToday && !isActive ? 'today' : '',
                  d.isWeekend && !isActive ? 'weekend' : '',
                ].filter(Boolean).join(' ')}
                onClick={() => onSelect(isActive ? undefined : d.key)}
                title={d.date.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
              >
                <span className="datebar-day">{d.date.getDate()}</span>
                <span className="datebar-dow">{DAY_NAMES[d.date.getDay()]}</span>
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
