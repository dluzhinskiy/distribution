const NON_WORKING_DAYS = Object.freeze({
  2026: Object.freeze({
    1: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 17, 18, 24, 25, 31],
    2: [1, 7, 8, 14, 15, 21, 22, 23, 28],
    3: [1, 7, 8, 9, 14, 15, 21, 22, 28, 29],
    4: [4, 5, 11, 12, 18, 19, 25, 26],
    5: [1, 2, 3, 9, 10, 16, 17, 23, 24, 30, 31],
    6: [6, 7, 12, 13, 14, 20, 21, 27, 28],
    7: [4, 5, 11, 12, 18, 19, 25, 26],
    8: [1, 2, 8, 9, 15, 16, 22, 23, 29, 30],
    9: [5, 6, 12, 13, 19, 20, 26, 27],
    10: [3, 4, 10, 11, 17, 18, 24, 25, 31],
    11: [1, 4, 7, 8, 14, 15, 21, 22, 28, 29],
    12: [5, 6, 12, 13, 19, 20, 26, 27, 31],
  }),
});

const calendarSets = new Map();

function isoParts(value) {
  const match = String(value ?? "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) } : null;
}

export function hasProductionCalendar(year) {
  return Boolean(NON_WORKING_DAYS[Number(year)]);
}

export function productionNonWorkingDates(year) {
  const normalizedYear = Number(year);
  if (!hasProductionCalendar(normalizedYear)) return new Set();
  if (!calendarSets.has(normalizedYear)) {
    const dates = [];
    for (const [month, days] of Object.entries(NON_WORKING_DAYS[normalizedYear])) {
      for (const day of days) dates.push(`${normalizedYear}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`);
    }
    calendarSets.set(normalizedYear, new Set(dates));
  }
  return new Set(calendarSets.get(normalizedYear));
}

export function isProductionNonWorkingDay(value) {
  const parts = isoParts(value);
  if (!parts) return false;
  if (hasProductionCalendar(parts.year)) return productionNonWorkingDates(parts.year).has(String(value));
  const weekday = new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).getUTCDay();
  return weekday === 0 || weekday === 6;
}

