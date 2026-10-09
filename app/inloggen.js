'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { wachtwoordOk, maakSessieToken, SESSIE_COOKIE, SESSIE_DAGEN } from '@/lib/auth';

// Alleen een pad binnen deze site toestaan als terugkeer-adres (geen open redirect naar een andere host).
function veiligPad(p) {
  return typeof p === 'string' && p.startsWith('/') && !p.startsWith('//') && !p.startsWith('/\\') ? p : '/';
}

export async function inloggen(formData) {
  const terug = veiligPad(String(formData.get('terug') || '/'));
  if (!(await wachtwoordOk(formData.get('wachtwoord')))) {
    // Vaste vertraging bij een fout: dat remt het raden van wachtwoorden.
    await new Promise(r => setTimeout(r, 1500));
    redirect('/login?fout=1' + (terug !== '/' ? '&terug=' + encodeURIComponent(terug) : ''));
  }
  const token = await maakSessieToken();
  (await cookies()).set(SESSIE_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: SESSIE_DAGEN * 86400,
  });
  redirect(terug);
}

export async function uitloggen() {
  (await cookies()).delete(SESSIE_COOKIE);
  redirect('/login');
}
