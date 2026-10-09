// Toegangscontrole: één wachtwoord voor het huishouden (APP_PASSWORD) + een getekende sessiecookie, en
// voor machines (Node-RED, Vercel-cron) het CRON_SECRET via ?secret= of een Bearer-header.
// Alles via Web Crypto zodat het zowel in proxy.js als in route handlers en server actions draait.
// Faalt DICHT: ontbreekt APP_PASSWORD, AUTH_SECRET of CRON_SECRET, dan komt niemand via die weg binnen.

export const SESSIE_COOKIE = 'sessie';
export const SESSIE_DAGEN = 30;

const enc = new TextEncoder();

function hex(buf) {
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

async function hmac(bericht) {
  const sleutel = process.env.AUTH_SECRET;
  if (!sleutel) return null;
  const key = await crypto.subtle.importKey('raw', enc.encode(sleutel), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', key, enc.encode(bericht)));
}

// Vergelijking in constante tijd (geen informatie via de rekentijd).
async function gelijk(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const [ha, hb] = await Promise.all([crypto.subtle.digest('SHA-256', enc.encode(a)), crypto.subtle.digest('SHA-256', enc.encode(b))]);
  const x = new Uint8Array(ha), y = new Uint8Array(hb);
  let v = 0;
  for (let i = 0; i < x.length; i++) v |= x[i] ^ y[i];
  return v === 0;
}

export async function wachtwoordOk(invoer) {
  const echt = process.env.APP_PASSWORD;
  if (!echt || !process.env.AUTH_SECRET) return false;
  return gelijk(String(invoer ?? ''), echt);
}

// Token = "<verloopt-ms>.<handtekening>". Geldig zolang de handtekening klopt en de tijd niet voorbij is.
export async function maakSessieToken() {
  const verloopt = String(Date.now() + SESSIE_DAGEN * 86400000);
  const sig = await hmac(verloopt);
  return sig ? `${verloopt}.${sig}` : null;
}

export async function sessieTokenOk(token) {
  if (!token || typeof token !== 'string') return false;
  const [verloopt, sig] = token.split('.');
  if (!verloopt || !sig || !(Number(verloopt) > Date.now())) return false;
  const verwacht = await hmac(verloopt);
  return !!verwacht && gelijk(sig, verwacht);
}

// Machine-toegang: CRON_SECRET via ?secret= of "Authorization: Bearer <secret>" (zo roept Vercel-cron aan).
export async function geheimOk(request) {
  const echt = process.env.CRON_SECRET;
  if (!echt) return false;
  const url = new URL(request.url);
  const bearer = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  return (await gelijk(url.searchParams.get('secret') ?? '', echt)) || (await gelijk(bearer, echt));
}

function cookieUitHeader(request, naam) {
  const m = (request.headers.get('cookie') || '').match(new RegExp('(?:^|;\\s*)' + naam + '=([^;]+)'));
  return m ? decodeURIComponent(m[1]) : null;
}

// Voor route handlers: ingelogd in de browser, óf een geldig geheim.
export async function magApi(request) {
  return (await sessieTokenOk(cookieUitHeader(request, SESSIE_COOKIE))) || (await geheimOk(request));
}
