'use client';

interface ViewModeTabsProps {
  activeTab: string;
  totalCount: number;
  filteredCount: number;
  onTabChange: (tab: string) => void;
}

export default function ViewModeTabs({
  activeTab,
  totalCount,
  filteredCount,
  onTabChange,
}: ViewModeTabsProps) {
  const tabs = [
    { key: 'feed', label: `Feed (${totalCount})` },
    { key: 'filter', label: `Filter (${filteredCount})` },
    { key: 'recommended', label: 'Recommended' },
  ];

  return (
    <div className="flex border-b border-gray-200 bg-white px-4">
      {tabs.map((tab) => (
        <button
          key={tab.key}
          onClick={() => onTabChange(tab.key)}
          className="px-4 py-2.5 text-sm font-medium transition-colors relative"
          style={{
            color: activeTab === tab.key ? '#e91e63' : '#6b7280',
          }}
        >
          {tab.label}
          {activeTab === tab.key && (
            <div
              className="absolute bottom-0 left-0 right-0 h-0.5"
              style={{ backgroundColor: '#e91e63' }}
            />
          )}
        </button>
      ))}
    </div>
  );
}
