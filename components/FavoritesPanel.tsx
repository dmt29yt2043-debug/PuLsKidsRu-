'use client';

import { useFavorites } from '@/lib/FavoritesContext';
import type { Event } from '@/lib/types';

function formatDate(dateStr: string): string {
  if (!dateStr) return '';
  try {
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  } catch {
    return dateStr;
  }
}

interface FavoritesPanelProps {
  open: boolean;
  onClose: () => void;
  onEventClick: (event: Event) => void;
}

export default function FavoritesPanel({ open, onClose, onEventClick }: FavoritesPanelProps) {
  const { favoriteEvents, toggle } = useFavorites();

  return (
    <>
      {/* Backdrop */}
      {open && (
        <div
          onClick={onClose}
          style={{
            position: 'fixed', inset: 0, zIndex: 400,
            background: 'rgba(0,0,0,0.5)',
          }}
        />
      )}

      {/* Panel */}
      <div style={{
        position: 'fixed', top: 0, right: 0, bottom: 0, width: 360,
        zIndex: 401,
        background: '#0f0d2e',
        borderLeft: '1px solid rgba(255,255,255,0.08)',
        transform: open ? 'translateX(0)' : 'translateX(100%)',
        transition: 'transform 0.3s ease',
        display: 'flex', flexDirection: 'column',
      }}>
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '16px 20px',
          borderBottom: '1px solid rgba(255,255,255,0.08)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="#e91e63" stroke="#e91e63" strokeWidth="2">
              <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
            </svg>
            <span style={{ color: 'white', fontWeight: 600, fontSize: 16 }}>
              Saved ({favoriteEvents.length})
            </span>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              color: '#9ca3af', fontSize: 18, lineHeight: 1,
            }}
          >
            ✕
          </button>
        </div>

        {/* List */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '12px 16px' }}>
          {favoriteEvents.length === 0 ? (
            <div style={{ textAlign: 'center', color: '#6b7280', marginTop: 60 }}>
              <div style={{ fontSize: 40, marginBottom: 12 }}>♡</div>
              <p style={{ fontSize: 14 }}>No saved events yet</p>
              <p style={{ fontSize: 12, marginTop: 4 }}>Tap the heart on any event to save it</p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {favoriteEvents.map((event) => (
                <div
                  key={event.id}
                  style={{
                    display: 'flex', gap: 12, alignItems: 'flex-start',
                    background: '#1e1b4b',
                    borderRadius: 10,
                    padding: 10,
                    cursor: 'pointer',
                    border: '1px solid rgba(255,255,255,0.06)',
                  }}
                  onClick={() => { onEventClick(event); onClose(); }}
                >
                  {/* Thumbnail */}
                  <div style={{ width: 64, height: 64, borderRadius: 7, overflow: 'hidden', flexShrink: 0, background: '#2a2563' }}>
                    {event.image_url ? (
                      <img src={event.image_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    ) : (
                      <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#6b7280' }}>🎪</div>
                    )}
                  </div>

                  {/* Info */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ color: 'white', fontSize: 13, fontWeight: 600, margin: 0, lineHeight: 1.3 }}
                      className="line-clamp-2">
                      {event.title}
                    </p>
                    {event.venue_name && (
                      <p style={{ color: '#9ca3af', fontSize: 11, margin: '3px 0 0' }}>{event.venue_name}</p>
                    )}
                    <p style={{ color: '#6b7280', fontSize: 11, margin: '2px 0 0' }}>{formatDate(event.next_start_at)}</p>
                    <span style={{
                      display: 'inline-block', marginTop: 4,
                      fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 99,
                      background: event.is_free ? '#10b981' : '#e91e63',
                      color: 'white',
                    }}>
                      {event.is_free ? 'FREE' : event.price_min > 0 ? `$${event.price_min}` : event.price_summary || ''}
                    </span>
                  </div>

                  {/* Remove heart */}
                  <button
                    onClick={(e) => { e.stopPropagation(); toggle(event); }}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, flexShrink: 0 }}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="#e91e63" stroke="#e91e63" strokeWidth="2">
                      <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
                    </svg>
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
