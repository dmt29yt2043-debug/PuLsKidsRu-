'use client';

import DigestCard from './DigestCard';

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

interface DigestViewAllProps {
  categories: Category[];
  onClose: () => void;
  onDigestClick: (slug: string) => void;
}

export default function DigestViewAll({ categories, onClose, onDigestClick }: DigestViewAllProps) {
  return (
    <div className="digest-viewall-backdrop" onClick={onClose}>
      <div className="digest-viewall-panel" onClick={e => e.stopPropagation()}>
        <div className="digest-viewall-header">
          <div>
            <h2 className="digest-viewall-title">All Digests</h2>
            <p className="digest-viewall-sub">All curated collections</p>
          </div>
          <button className="digest-panel-close" style={{ position: 'static' }} onClick={onClose}>✕</button>
        </div>

        <div className="digest-viewall-body">
          {categories.map(cat => (
            <div key={cat.name} className="digest-viewall-section">
              <h3 className="digest-viewall-cat">{cat.name}</h3>
              <div className="digest-viewall-grid">
                {cat.digests.map(d => (
                  <DigestCard
                    key={d.slug}
                    digest={d}
                    onClick={onDigestClick}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
