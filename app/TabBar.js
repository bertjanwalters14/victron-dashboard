'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

// Gedeelde hoofdnavigatie: één app, drie tabs. Het zijn bewust drie routes (Link = client-side navigatie,
// voelt als één pagina) zodat Resultaten/Jaaroverzicht hun eigen 6-uurs-cache houden en alleen Live
// sturing altijd vers is -- alles in één pagina zou elke keer alle queries op Neon draaien.
const Icoon = ({ children }) => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children}</svg>
);

const TABS = [
  { href: '/', label: 'Live sturing', icoon: <Icoon><path d="M13 2L3 14h7l-1 8 10-12h-7l1-8z" /></Icoon> },
  { href: '/resultaten', label: 'Resultaten', icoon: <Icoon><polyline points="22 12 18 12 15 21 9 3 6 12 2 12" /></Icoon> },
  { href: '/jaaroverzicht', label: 'Jaaroverzicht', icoon: <Icoon><rect x="3" y="4" width="18" height="18" rx="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" /></Icoon> },
];

export default function TabBar() {
  const pad = usePathname();
  return (
    <nav aria-label="Hoofdnavigatie" className="mb-5 overflow-x-auto">
      <div className="inline-flex gap-1 rounded-2xl border border-gray-800 bg-gray-900 p-1">
        {TABS.map(t => {
          const actief = t.href === '/' ? pad === '/' : pad === t.href || pad.startsWith(t.href + '/');
          return (
            <Link key={t.href} href={t.href} aria-current={actief ? 'page' : undefined}
              className={`flex items-center gap-2 whitespace-nowrap rounded-xl px-3.5 py-2 text-sm font-medium transition-colors ${actief ? 'bg-gray-800 text-white' : 'text-gray-400 hover:text-gray-200'}`}>
              {t.icoon}{t.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
