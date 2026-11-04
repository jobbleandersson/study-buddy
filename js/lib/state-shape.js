// The saved study state is whatever the last writer stored: this device, another device's (maybe older or
// newer) app version, or the account's copy on the server, which accepts any JSON. One wrongly typed field
// ("assignments" as a string, "srs" as a list, a setting of the wrong type) used to break every screen,
// header included, with no way out. store.js migrate() runs this before anything reads the state, so each
// field has the type the app expects. It only repairs types: well-formed data passes through untouched, and
// fields it doesn't know are kept (a newer app version may have added them).

const isObj = (v) => v != null && typeof v === "object" && !Array.isArray(v);
const list = (v) => (Array.isArray(v) ? v : []);
const record = (v) => (isObj(v) ? v : {});
const recordOf = (v) => Object.fromEntries(Object.entries(record(v)).filter(([, x]) => isObj(x)));
const strings = (v) => list(v).filter((x) => typeof x === "string");
const DAY = /^\d{4}-\d{2}-\d{2}$/;

// Settings whose value must be one of a few: anything else falls back to the default.
const CHOICES = {
  textSize: ["s", "m", "l"],
  font: ["system", "hyperlegible"],
  pomodoro: ["off", "25", "50"],
  tutorVerbosity: ["concise", "normal", "detailed"],
};
// Whole numbers within a range: out-of-range values are clamped, non-numbers fall back to the default.
const RANGES = { dailyGoal: [0, 100], testHints: [0, 3] };

/** The settings with every known key of the right type and in range (`defaults` is the seed's settings). */
export function cleanSettings(raw, defaults) {
  const s = { ...record(raw) };
  for (const [k, def] of Object.entries(defaults)) {
    const v = s[k];
    if (v === undefined) s[k] = def;
    else if (CHOICES[k]) s[k] = CHOICES[k].includes(String(v)) ? String(v) : def;
    else if (RANGES[k]) {
      const n = typeof v === "number" || (typeof v === "string" && v.trim() !== "") ? Number(v) : NaN;   // not [] or true
      s[k] = Number.isFinite(n) ? Math.max(RANGES[k][0], Math.min(RANGES[k][1], Math.round(n))) : def;
    } else if (k === "hpDate") s[k] = typeof v === "string" && DAY.test(v) ? v : null;
    else if (def !== null && typeof v !== typeof def) s[k] = def;
  }
  return s;
}

/** Repair the types of the state's top-level fields in place, and return it. */
export function coerceStateShape(s) {
  // Sets need an id and a list of questions (objects); attempts are objects whose items, if any, are a list.
  // Objects are only replaced where something is wrong, so a healthy state keeps every object it had.
  s.assignments = list(s.assignments)
    .filter((a) => isObj(a) && a.id != null)
    .map((a) => (Array.isArray(a.questions) && a.questions.every(isObj) ? a : { ...a, questions: list(a.questions).filter(isObj) }));
  s.attempts = list(s.attempts)
    .filter(isObj)
    .map((a) => ("items" in a && !Array.isArray(a.items) ? { ...a, items: [] } : a));
  s.subjects = list(s.subjects).filter((x) => isObj(x) && x.id != null);   // missing counts too: Studera and Framsteg read it
  // exams and rules are validated item by item further on (finishMigrate); a non-list exams is re-derived there.
  if ("rules" in s && !Array.isArray(s.rules)) s.rules = [];

  s.srs = recordOf(s.srs);
  s.sessions = recordOf(s.sessions);
  s.achievements = record(s.achievements);
  s.readNotifications = record(s.readNotifications);
  if ("deleted" in s) s.deleted = record(s.deleted);
  if ("sessionsCleared" in s) s.sessionsCleared = record(s.sessionsCleared);
  if ("tonight" in s && !isObj(s.tonight)) s.tonight = {};
  if ("profile" in s && !isObj(s.profile)) s.profile = null;
  if ("avatar" in s && typeof s.avatar !== "string") s.avatar = null;

  const a = record(s.activity);
  s.activity = {
    ...a,
    daysStudied: strings(a.daysStudied),
    ...("frozenDays" in a ? { frozenDays: strings(a.frozenDays) } : {}),
    ...("goalDays" in a ? { goalDays: strings(a.goalDays) } : {}),
    ...Object.fromEntries(["freezes", "freezeMark", "bestStreak"].filter((k) => k in a)
      .map((k) => [k, Number.isFinite(Number(a[k])) ? Number(a[k]) : 0])),
  };
  return s;
}
