'use client';

export default function TopBar() {
  return (
    <header
      className="flex items-center justify-center px-4"
      style={{ backgroundColor: '#e91e63', height: 50 }}
    >
      <h1 className="text-white text-lg font-semibold tracking-wide">
        Pulse &mdash; events
      </h1>
    </header>
  );
}
