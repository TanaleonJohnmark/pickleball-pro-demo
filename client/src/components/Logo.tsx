import brand from '../lib/brand';

/** Club logo + name. Colours and text come from client/brand.json. */
export function Logo({ light }: { light?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2.5">
      <img src={brand.logo} alt="" className="h-9 w-9 shrink-0 rounded-full" />
      <span className="leading-none">
        <span className={`block font-display text-[21px] font-bold tracking-tight ${light ? 'text-white' : 'text-navy-900'}`}>{brand.shortName}</span>
        <span className={`block text-[11px] font-semibold uppercase tracking-[0.18em] ${light ? 'text-cyan-400' : 'text-court-600'}`}>{brand.subName}</span>
      </span>
    </span>
  );
}

export function PoweredBy({ light }: { light?: boolean }) {
  return <p className={`text-xs ${light ? 'text-navy-300' : 'text-navy-600'}`}>Powered by <span className="font-semibold">{brand.poweredBy}</span></p>;
}
