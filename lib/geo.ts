import zipData from '../contractor-data/nj-zipcodes.json';

const zipDB = zipData as Record<string, { lat: number; lng: number }>;

export function getZipCoords(zip: string): { lat: number; lng: number } | null {
  const entry = zipDB[zip];
  return entry ? { lat: entry.lat, lng: entry.lng } : null;
}
