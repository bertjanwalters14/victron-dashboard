import { NextResponse } from 'next/server';
import { SESSIE_COOKIE, sessieTokenOk, geheimOk } from './lib/auth';

// Poortwachter voor de hele app (draait vóór elke pagina, API-route en server action):
//   - /login is open (anders kom je er nooit in).
//   - GET /api/laadvannet is open: Node-RED leest daar elke 20 min de aan/uit-stand van de knoppen; het zijn
//     alleen booleans en een percentage, en een dichte poll zou de sturing laten terugvallen op "uit".
//   - /api/*: alleen met een geldige sessiecookie (dashboard) of het CRON_SECRET (Node-RED push, Vercel-cron).
//   - pagina's: zonder sessie een redirect naar /login; een POST zonder sessie (server action) krijgt een 401.
// De server actions en de gevoelige routes controleren de sessie bovendien zelf (verdediging in de diepte).
export async function proxy(request) {
  const { pathname, search } = request.nextUrl;

  if (pathname === '/login') return NextResponse.next();
  if (pathname === '/api/laadvannet' && request.method === 'GET') return NextResponse.next();

  const ingelogd = await sessieTokenOk(request.cookies.get(SESSIE_COOKIE)?.value);

  if (pathname.startsWith('/api/')) {
    if (ingelogd || (await geheimOk(request))) return NextResponse.next();
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (ingelogd) return NextResponse.next();
  if (request.method !== 'GET') return new NextResponse('Niet ingelogd', { status: 401 });

  const naarLogin = new URL('/login', request.url);
  if (pathname !== '/') naarLogin.searchParams.set('terug', pathname + search);
  return NextResponse.redirect(naarLogin);
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|svg|ico|webp)$).*)'],
};
