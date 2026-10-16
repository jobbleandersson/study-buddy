// Whether a device's state holds anything a person did, as opposed to a fresh start. Used when someone
// signs in to an account that already has data: work done on the device before signing in is only added
// to the account if the person says so (on a shared computer it may be somebody else's).

/** How much study work the state holds: { sets, tests, rules, attempts, days }. All 0 for a fresh state. */
export function localWorkCounts(state) {
  const s = state && typeof state === "object" ? state : {};
  const n = (x) => (Array.isArray(x) ? x.length : 0);
  return {
    sets: n(s.assignments),
    tests: n(s.exams),
    rules: n(s.rules),
    attempts: n(s.attempts),
    days: n(s.activity?.daysStudied),
  };
}

export function hasLocalWork(state) {
  const c = localWorkCounts(state);
  return c.sets + c.tests + c.rules + c.attempts + c.days > 0;
}
