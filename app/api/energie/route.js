import { getEnergieData } from '@/lib/db';

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  if (searchParams.get('secret') !== process.env.CRON_SECRET) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const data = await getEnergieData();
    return Response.json({ success: true, data });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}