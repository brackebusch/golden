const compact = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 })
const full = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 })

export const fmtCompact = (v: unknown) => (typeof v === 'number' ? compact.format(v) : String(v ?? ''))
export const fmtFull = (v: unknown) => (typeof v === 'number' ? full.format(v) : String(v ?? '—'))
