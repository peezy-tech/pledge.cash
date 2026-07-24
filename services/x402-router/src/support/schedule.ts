export type MonthlyPeriod = {
  index: number;
  start: Date;
  end: Date;
};

export function monthlyPeriodAt(
  anchor: Date,
  at: Date,
): MonthlyPeriod {
  assertDate(anchor, "Subscription anchor");
  assertDate(at, "Current time");
  if (at.getTime() < anchor.getTime()) {
    return {
      index: 0,
      start: new Date(anchor),
      end: addUtcMonths(anchor, 1),
    };
  }

  let index =
    (at.getUTCFullYear() - anchor.getUTCFullYear()) * 12
    + at.getUTCMonth()
    - anchor.getUTCMonth();
  let start = addUtcMonths(anchor, index);
  if (start.getTime() > at.getTime()) {
    index -= 1;
    start = addUtcMonths(anchor, index);
  }
  const end = addUtcMonths(anchor, index + 1);
  if (!Number.isSafeInteger(index) || index < 0) {
    throw new Error("Monthly support period index is outside the safe range");
  }
  return { index, start, end };
}

export function addUtcMonths(value: Date, months: number): Date {
  assertDate(value, "Date");
  if (!Number.isSafeInteger(months)) {
    throw new Error("Month offset must be a safe integer");
  }
  const year = value.getUTCFullYear();
  const month = value.getUTCMonth() + months;
  const targetYear = year + Math.floor(month / 12);
  const targetMonth = ((month % 12) + 12) % 12;
  const day = Math.min(
    value.getUTCDate(),
    new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate(),
  );
  return new Date(Date.UTC(
    targetYear,
    targetMonth,
    day,
    value.getUTCHours(),
    value.getUTCMinutes(),
    value.getUTCSeconds(),
    value.getUTCMilliseconds(),
  ));
}

function assertDate(value: Date, label: string): void {
  if (!Number.isFinite(value.getTime())) {
    throw new Error(`${label} is invalid`);
  }
}
