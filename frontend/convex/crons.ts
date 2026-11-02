import { cronJobs } from "convex/server";

import { internal } from "./_generated/api";

const crons = cronJobs();

// Every Sunday 06:00 UTC: notify owners + accountants about customers with overdue debts.
crons.weekly("weekly debt digest", { dayOfWeek: "sunday", hourUTC: 6, minuteUTC: 0 }, internal.extra.weeklyDebtDigestAll);

// Every day 18:00 UTC (21:00 Syria): SMS each owner today's sales, collections and new debts.
crons.daily("daily sms summary", { hourUTC: 18, minuteUTC: 0 }, internal.dailySms.sendAll);

// Every day 07:00 UTC (10:00 Syria): automatic SMS debt reminders (Pro orgs that enabled it).
crons.daily("debt sms reminders", { hourUTC: 7, minuteUTC: 0 }, internal.proFeatures.sendDebtReminders);

// Every day 08:00 UTC: Pro trial reminders (3 days left, 1 day left, expired).
crons.daily("pro trial reminders", { hourUTC: 8, minuteUTC: 0 }, internal.proFeatures.sendTrialReminders);

// Every day 08:30 UTC: paid subscription expiry reminders.
crons.daily("subscription expiry reminders", { hourUTC: 8, minuteUTC: 30 }, internal.billing.sendExpiryReminders);

export default crons;
