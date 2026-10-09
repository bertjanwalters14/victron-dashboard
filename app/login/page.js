import { inloggen } from '../inloggen';

export const metadata = { title: 'Inloggen · Victron ESS' };
export const dynamic = 'force-dynamic';

export default async function LoginPage({ searchParams }) {
  const sp = await searchParams;
  const fout = sp?.fout === '1';
  const terug = typeof sp?.terug === 'string' ? sp.terug : '';
  const ingesteld = !!process.env.APP_PASSWORD && !!process.env.AUTH_SECRET;

  return (
    <main className="min-h-screen bg-gray-950 text-gray-50 flex items-center justify-center px-4">
      <form action={inloggen} className="w-full max-w-sm rounded-2xl border border-gray-800 bg-gray-900/60 p-6">
        <h1 className="text-xl font-semibold mb-1">Victron ESS</h1>
        <p className="text-sm text-gray-400 mb-5">Log in om de accu-sturing te bekijken en te bedienen.</p>
        <input type="hidden" name="terug" value={terug} />
        <label htmlFor="wachtwoord" className="block text-xs text-gray-400 mb-1">Wachtwoord</label>
        <input
          id="wachtwoord" name="wachtwoord" type="password" autoComplete="current-password" autoFocus required
          className="w-full rounded-xl bg-gray-800 px-3.5 py-2.5 text-gray-50 outline-none focus:ring-2 focus:ring-blue-500"
        />
        {fout && <p className="mt-3 text-sm text-red-400">Onjuist wachtwoord.</p>}
        {!ingesteld && <p className="mt-3 text-sm text-amber-300">Inloggen is nog niet ingesteld op de server (APP_PASSWORD / AUTH_SECRET).</p>}
        <button type="submit" className="mt-5 w-full rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-500">
          Inloggen
        </button>
      </form>
    </main>
  );
}
