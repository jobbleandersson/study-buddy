// A deep copy of plain data (a set, a question). structuredClone is missing on iOS 15.0 to 15.3, where the
// editor and "duplicate set" threw; every value here is JSON-safe (sets are stored as JSON), so the fallback is a
// JSON round trip.
export function deepClone(value) {
  if (typeof structuredClone === "function") return structuredClone(value);
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}
