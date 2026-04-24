'use client';

import { useState } from 'react';
import type { Event } from '@/lib/types';

interface ResultCardProps {
  event: Event;
  isHovered: boolean;
  isSelected: boolean;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
  onClick: () => void;
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

export default function ResultCard({
  event,
  isHovered,
  isSelected,
  onMouseEnter,
  onMouseLeave,
  onClick,
}: ResultCardProps) {
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
    : isHovered
      ? '0 2px 8px rgba(0, 0, 0, 0.1)'
      : '0 1px 4px rgba(0, 0, 0, 0.06)';

  return (
    <div
      data-event-id={event.id}
      className="result-card"
      style={{
        display: 'flex',
        gap: 12,
        padding: 10,
        borderRadius: 10,
        cursor: 'pointer',
        border: `2px solid ${borderColor}`,
        backgroundColor: bgColor,
        boxShadow: shadow,
        transition: 'all 0.15s ease',
      }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      onClick={onClick}
    >
      {/* Image */}
      <div
        style={{
          width: 120,
          minWidth: 120,
          height: 90,
          borderRadius: 8,
          overflow: 'hidden',
          backgroundColor: '#f3f4f6',
          flexShrink: 0,
        }}
      >
        {event.image_url && !imgError ? (
          <img
            src={event.image_url}
            alt={event.title}
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            onError={() => setImgError(true)}
            loading="lazy"
          />
        ) : (
          <div
            style={{
              width: '100%',
              height: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'linear-gradient(135deg, #fce4ec, #fdf2f8)',
              fontSize: 28,
            }}
          >
            &#127915;
          </div>
        )}
      </div>

      {/* Info */}
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
        <h3
          style={{
            fontSize: 14,
            fontWeight: 600,
            color: '#111827',
            lineHeight: 1.3,
            margin: 0,
            overflow: 'hidden',
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
          }}
        >
          {event.title}
        </h3>

        {event.venue_name && (
          <p style={{ fontSize: 12, color: '#6b7280', margin: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {event.venue_name}
          </p>
        )}

        <p style={{ fontSize: 12, color: '#9ca3af', margin: 0 }}>
          {formatDate(event.next_start_at)}
        </p>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 'auto' }}>
          {price.text && (
            <span style={{ fontSize: 12, fontWeight: 600, color: price.color }}>
              {price.text}
            </span>
          )}
          {event.age_label && (
            <span style={{ fontSize: 11, color: '#9ca3af' }}>
              {event.age_label}
            </span>
          )}
          {event.category_l1 && (
            <span
              style={{
                fontSize: 10,
                padding: '2px 6px',
                borderRadius: 4,
                backgroundColor: '#f3f4f6',
                color: '#6b7280',
              }}
            >
              {event.category_l1}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
