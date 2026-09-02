export function stripPartialAssumptions(value, stats = { strippedFields: 0, touchedRecords: 0 }) {
  if (Array.isArray(value)) return value.map(v => stripPartialAssumptions(v, stats));
  if (!value || typeof value !== 'object') return value;

  const keys = Array.isArray(value.assumedFields)
    ? value.assumedFields.map(String)
    : (value.assumedFields && typeof value.assumedFields === 'object'
      ? Object.keys(value.assumedFields)
      : []);
  const assumed = new Set(keys);
  if (assumed.size) stats.touchedRecords++;

  const out = {};
  for (const [k, v] of Object.entries(value)) {
    if (k === 'assumedFields') continue;
    if (assumed.has(k)) {
      stats.strippedFields++;
      continue;
    }
    out[k] = stripPartialAssumptions(v, stats);
  }
  return out;
}

export function hasPartialAssumptionMarker(value) {
  if (Array.isArray(value)) return value.some(hasPartialAssumptionMarker);
  if (!value || typeof value !== 'object') return false;
  if (value.assumedFields && (Array.isArray(value.assumedFields)
    ? value.assumedFields.length > 0
    : typeof value.assumedFields === 'object' && Object.keys(value.assumedFields).length > 0)) return true;
  return Object.values(value).some(hasPartialAssumptionMarker);
}
