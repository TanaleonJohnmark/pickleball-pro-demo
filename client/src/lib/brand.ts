import brand from '../../brand.json';
export default brand;
export const C = brand.colors;
type Feature = 'matches' | 'tournaments' | 'rankings' | 'coaching' | 'memberships';
/** Feature switches from brand.json — missing means on. */
export const has = (f: Feature) => (brand as any).features?.[f] !== false;
