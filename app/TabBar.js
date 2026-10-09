'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useSyncExternalStore } from 'react';
import { uitloggen } from './inloggen';

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

// Licht/donker-knop. Het thema zelf wordt door het script in layout.tsx vóór de eerste paint gezet (opgeslagen
// voorkeur, anders het systeem); deze knop wisselt en onthoudt de keuze. Pas na mounten renderen we het icoon,
// zodat server- en clientmarkup gelijk blijven.
const volgThema = (cb) => {
  const o = new MutationObserver(cb);
  o.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  return () => o.disconnect();
};

function ThemaKnop() {
  const thema = useSyncExternalStore(volgThema, () => (document.documentElement.dataset.theme === 'light' ? 'light' : 'dark'), () => null);
  function wissel() {
    const next = thema === 'light' ? 'dark' : 'light';
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem('thema', next); } catch {}
  }
  return (
    <button type="button" onClick={wissel} aria-label={thema === 'light' ? 'Donkere weergave' : 'Lichte weergave'}
      title={thema === 'light' ? 'Donker' : 'Licht'}
      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-gray-800 bg-gray-900 text-gray-400 transition-colors hover:text-gray-200">
      {thema === 'light'
        ? <Icoon><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" /></Icoon>
        : thema === 'dark'
          ? <Icoon><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" /></Icoon>
          : null}
    </button>
  );
}

export default function TabBar() {
  const pad = usePathname();
  return (
    <div className="mb-5 flex items-center justify-between gap-3">
    <nav aria-label="Hoofdnavigatie" className="overflow-x-auto">
      <div className="inline-flex gap-1 rounded-2xl border border-gray-800 bg-gray-900 p-1">
        {TABS.map(t => {
          const actief = t.href === '/' ? pad === '/' : pad === t.href || pad.startsWith(t.href + '/');
          return (
            <Link key={t.href} href={t.href} aria-current={actief ? 'page' : undefined}
              className={`flex items-center gap-2 whitespace-nowrap rounded-xl px-3.5 py-2 text-sm font-medium transition-colors ${actief ? 'bg-gray-800 text-gray-50' : 'text-gray-400 hover:text-gray-200'}`}>
              {t.icoon}{t.label}
            </Link>
          );
        })}
      </div>
    </nav>
    <div className="flex items-center gap-2">
      <ThemaKnop />
      <form action={uitloggen}>
        <button type="submit" aria-label="Uitloggen" title="Uitloggen"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-gray-800 bg-gray-900 text-gray-400 transition-colors hover:text-gray-200">
          <Icoon><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" /></Icoon>
        </button>
      </form>
    </div>
    </div>
  );
}
