// Shared phrasing for a day-key deadline ("YYYY-MM-DD").

import { t, daysUntil } from "./i18n.js";

/** Hours from now until the end of today. Deadlines carry no time of day,
 *  so on the due date itself this counts down to midnight — enough to say
 *  "today, and not much of it left". At least 1 so it never reads "0h". */
export function hoursLeftToday() {
  const now = new Date();
  const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  return Math.max(1, Math.ceil((endOfDay - now) / 3600000));
}

/** A bare relative phrase for a deadline — "in 3 days" / "tomorrow" /
 *  "in ~5h" (due today) / "overdue". Reuses the shared date.* strings so it
 *  reads like every other relative date in the app. */
export function countdownLabel(dayKey) {
  const d = daysUntil(dayKey);
  if (d < 0) return t("date.overdue");
  if (d === 0) return t("date.inHours", { n: hoursLeftToday() });
  if (d === 1) return t("date.tomorrow");
  return t("date.inDays", { n: d });
}
