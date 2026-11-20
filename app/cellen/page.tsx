import CellenClient from '../CellenClient';

// De gegevens komen client-side uit /api/cellen (VRM, per bezoek vers); de pagina zelf is alleen de schil.
export default function CellenPage() {
  return <CellenClient />;
}
