import { fetchWeather } from '@/lib/weather';

export const runtime = 'edge';

/** GET ?lat=&lng=&place= -> current weather for the map widget. */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const lat = Number(params.get('lat'));
  const lng = Number(params.get('lng'));
  const place = (params.get('place') ?? 'Here').slice(0, 60);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    return Response.json({ message: 'lat and lng are required.' }, { status: 400 });
  }
  const weather = await fetchWeather(lat, lng, place);
  return Response.json(weather, {
    headers: { 'cache-control': 'public, s-maxage=600, stale-while-revalidate=600' },
  });
}
