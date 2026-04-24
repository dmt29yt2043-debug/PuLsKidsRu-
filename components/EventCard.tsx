'use client';

import { useState } from 'react';
import type { Event } from '@/lib/types';

interface EventCardProps {
  event: Event;
  onClick: (event: Event) => void;
  isHovered?: boolean;
  isSelected?: boolean;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
}

function formatDate(dateStr: string): string {
  if (!dateStr) return '';
  try {
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return dateStr;
  }
}

function formatPrice(event: Event): { text: string; color: string } {
  if (event.is_free) return { text: 'Free', color: '#22c55e' };
  if (event.price_summary) return { text: event.price_summary, color: '#374151' };
  if (event.price_min > 0 && event.price_max > 0) {
    if (event.price_min === event.price_max) {
      return { text: `$${event.price_min}`, color: '#374151' };
    }
    return { text: `$${event.price_min}-$${event.price_max}`, color: '#374151' };
  }
  return { text: '', color: '#374151' };
}

export default function EventCard({
  event,
  onClick,
  isHovered = false,
  isSelected = false,
  onMouseEnter,
  onMouseLeave,
}: EventCardProps) {
  const [liked, setLiked] = useState(false);
  const [imgError, setImgError] = useState(false);
  const price = formatPrice(event);

  const borderColor = isSelected
    ? '#e91e63'
    : isHovered
      ? '#f48fb1'
      : 'transparent';
  const bgColor = isSelected || isHovered ? '#fdf2f8' : 'white';
  const shadow = isSelected
    ? '0 4px 12px rgba(233, 30, 99, 0.2)'
    : '0 1px 4px rgba(0,0,0,0.08)';

  return (
    <div
      data-event-id={event.id}
      className="bg-white rounded-lg overflow-hidden cursor-pointer transition-all"
      style={{
        borderRadius: 8,
        boxShadow: shadow,
        border: `2px solid ${borderColor}`,
        backgroundColor: bgColor,
        transition: 'all 0.15s ease',
      }}
      onClick={() => onClick(event)}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      {/* Image */}
      <div className="relative aspect-[4/3] bg-gray-100 overflow-hidden">
        {event.image_url && !imgError ? (
          <img
            src={event.image_url}
            alt={event.title}
            className="w-full h-full object-cover"
            onError={() => setImgError(true)}
            loading="lazy"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-pink-100 to-pink-50">
            <span className="text-4xl">&#127915;</span>
          </div>
        )}

        {/* Category badge */}
        {event.category_l1 && (
          <span className="absolute top-2 left-2 px-2 py-0.5 bg-black/60 text-white text-[11px] font-medium rounded">
            {event.category_l1}
          </span>
        )}

        {/* Heart button */}
        <button
          className="absolute top-2 right-2 w-7 h-7 flex items-center justify-center rounded-full bg-white/80 hover:bg-white transition-colors"
          onClick={(e) => {
            e.stopPropagation();
            setLiked(!liked);
          }}
        >
          <span style={{ color: liked ? '#e91e63' : '#9ca3af', fontSize: 16 }}>
            {liked ? '\u2764' : '\u2661'}
          </span>
        </button>
      </div>

      {/* Content */}
      <div className="p-3">
        <h3 className="text-sm font-semibold text-gray-900 line-clamp-2 leading-snug mb-1">
          {event.title}
        </h3>
        <p className="text-xs text-gray-500 mb-0.5">{formatDate(event.next_start_at)}</p>
        {event.venue_name && (
          <p className="text-xs text-gray-500 truncate mb-1">{event.venue_name}</p>
        )}
        {price.text && (
          <span className="text-xs font-semibold" style={{ color: price.color }}>
            {price.text}
          </span>
        )}
      </div>
    </div>
  );
}
