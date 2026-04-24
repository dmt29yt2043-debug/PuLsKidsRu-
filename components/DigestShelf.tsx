'use client';

import { useEffect, useState } from 'react';
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

interface DigestShelfProps {
  onDigestSelect: (slug: string) => void;
  activeDigestSlug: string | null;
}

export default function DigestShelf({ onDigestSelect, activeDigestSlug }: DigestShelfProps) {
  const [categories, setCategories] = useState<Category[]>([]);

  useEffect(() => {
    fetch('/api/digests')
      .then(r => r.json())
      .then(d => setCategories(d.categories || []))
      .catch(console.error);
  }, []);

  const allDigests = categories.flatMap(cat => cat.digests);

  if (categories.length === 0) return null;

  return (
    <div className="digest-shelf">
      <div className="digest-shelf-header">
        <div className="digest-shelf-title-row">
          <div>
            <h2 className="digest-shelf-title">Подборки редакции</h2>
            <p className="digest-shelf-sub">Готовые подборки под ваш ритм жизни.</p>
          </div>
        </div>
      </div>

      <div className="digest-shelf-row">
        {allDigests.map(d => (
          <DigestCard
            key={d.slug}
            digest={d}
            onClick={onDigestSelect}
            isActive={activeDigestSlug === d.slug}
          />
        ))}
      </div>
    </div>
  );
}
