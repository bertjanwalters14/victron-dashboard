import { redirect } from 'next/navigation';

// Live sturing is sinds de tabbalk de startpagina; oude bladwijzers naar /ess blijven werken.
export default function EssRedirect() {
  redirect('/');
}
