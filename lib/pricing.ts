export const SINGLE_PRICES: Record<string, number> = {
  locksmith: 24, handyman: 40, fencing: 45, housekeeper: 45,
  pestcontrol: 48, painting: 49, concrete: 54, landscaping: 54,
  irrigation: 54, carpet: 55, woodflooring: 55, security: 55,
  roofing: 65, siding: 65, windows: 65, hvac: 66,
  kitchen: 80, bathroom: 80,
};

export const BUNDLE_DISCOUNTS: Record<number, number> = {
  10: 0.10, 25: 0.15, 50: 0.20,
};

// Paired bundles: key → { categories that share credits, base price }
export const PAIRED_BUNDLES: Record<string, { categories: string[]; basePrice: number }> = {
  exterior: { categories: ['windows', 'siding', 'roofing'], basePrice: 65 },
  lawn: { categories: ['landscaping', 'irrigation'], basePrice: 54 },
  remodel: { categories: ['kitchen', 'bathroom'], basePrice: 80 },
};

// Map frontend bundle keys to our keys
export const BUNDLE_KEY_MAP: Record<string, string> = {
  exterior: 'exterior', lawncrafter: 'lawn', remodelcrafter: 'remodel',
};

// Map from frontend pill keys to category or bundle
export const PILL_TO_CATEGORY: Record<string, string> = {
  carpetcrafter: 'carpet', cleancrafter: 'housekeeper', concretecrafter: 'concrete',
  fencecrafter: 'fencing', floorcrafter: 'woodflooring', handycrafter: 'handyman',
  hvaccrafter: 'hvac', lockcrafter: 'locksmith', paintcrafter: 'painting',
  pestcrafter: 'pestcontrol', securecrafter: 'security',
  // These are paired bundles
  exterior: 'exterior', lawncrafter: 'lawn', remodelcrafter: 'remodel',
};

export function isPairedBundle(key: string): boolean {
  return key in PAIRED_BUNDLES;
}

export function getBasePrice(categoryOrBundle: string): number | null {
  if (PAIRED_BUNDLES[categoryOrBundle]) return PAIRED_BUNDLES[categoryOrBundle].basePrice;
  return SINGLE_PRICES[categoryOrBundle] ?? null;
}

export function categoryMatchesBundle(category: string, bundleKey: string): boolean {
  const bundle = PAIRED_BUNDLES[bundleKey];
  return bundle ? bundle.categories.includes(category) : false;
}

// All valid categories
export const VALID_CATEGORIES = Object.keys(SINGLE_PRICES);
export const VALID_BUNDLES = Object.keys(PAIRED_BUNDLES);
export const VALID_PACK_SIZES = [10, 25, 50];
