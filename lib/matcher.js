const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');

// Load zip code database
const zipDB = JSON.parse(
  fs.readFileSync(path.join(process.cwd(), 'contractor-data', 'nj-zipcodes.json'), 'utf8')
);

// Load contractor database
const csvData = fs.readFileSync(
  path.join(process.cwd(), 'contractor-data', 'all-contractors-nj.csv'), 'utf8'
);
const contractors = parse(csvData, { columns: true, relax_column_count: true })
  .map(r => {
    // Extract zip from address
    const zipMatch = r.address && r.address.match(/\b(\d{5})\b/);
    const zip = zipMatch ? zipMatch[1] : null;
    const coords = zip && zipDB[zip] ? zipDB[zip] : null;
    return {
      name: r.name,
      phone: r.phone,
      website: r.website,
      address: r.address,
      rating: parseFloat(r.rating) || 0,
      reviews: parseInt(r.reviews) || 0,
      category: (r.category || '').toLowerCase().trim(),
      zip,
      lat: coords ? coords.lat : null,
      lng: coords ? coords.lng : null,
    };
  })
  .filter(c => c.lat !== null); // Only keep contractors we can geolocate

console.log(`[matcher] Loaded ${contractors.length} geolocated contractors`);

// Haversine distance in miles
function haversine(lat1, lon1, lat2, lon2) {
  const R = 3958.8; // Earth radius in miles
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Service category mapping: user-facing terms → CSV category values
const SERVICE_MAP = {
  fencing: ['fencing'],
  roofing: ['roofing'],
  windows: ['windows'],
  siding: ['siding'],
  paint: ['paint', 'painting'],
  painting: ['paint', 'painting'],
};

/**
 * Match contractors within `radiusMiles` of homeowner's zip offering requested services.
 * @param {string} homeownerZip - 5-digit zip code
 * @param {string[]} services - e.g. ['fencing', 'roofing']
 * @param {number} maxResults - max contractors to return (default 3)
 * @param {number} radiusMiles - search radius (default 25)
 * @returns {Array} matched contractors sorted by distance
 */
function matchContractors(homeownerZip, services = [], maxResults = 3, radiusMiles = 30) {
  const origin = zipDB[homeownerZip];
  if (!origin) {
    return { error: `Unknown zip code: ${homeownerZip}`, results: [] };
  }

  // Normalize requested services
  const requestedCategories = new Set();
  for (const svc of services) {
    const key = svc.toLowerCase().trim();
    const mapped = SERVICE_MAP[key];
    if (mapped) mapped.forEach(c => requestedCategories.add(c));
    else requestedCategories.add(key); // fallback: use as-is
  }

  const matches = [];
  for (const c of contractors) {
    // Check service match
    if (requestedCategories.size > 0 && !requestedCategories.has(c.category)) continue;

    // Check distance
    const dist = haversine(origin.lat, origin.lng, c.lat, c.lng);
    if (dist <= radiusMiles) {
      matches.push({ ...c, distance: Math.round(dist * 10) / 10 });
    }
  }

  // Sort by distance (closest first)
  matches.sort((a, b) => a.distance - b.distance);

  return {
    origin: { zip: homeownerZip, ...origin },
    totalMatches: matches.length,
    results: matches.slice(0, maxResults),
  };
}

module.exports = { matchContractors, contractors, zipDB };
