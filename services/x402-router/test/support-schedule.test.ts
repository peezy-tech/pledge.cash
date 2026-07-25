import { describe, expect, test } from "bun:test";
import { addUtcMonths, monthlyPeriodAt } from "../src/support/schedule";

describe("monthly recurring-support schedule", () => {
  test("anchors calendar periods without accumulating missed invoices", () => {
    const anchor = new Date("2026-01-31T15:45:00.000Z");

    expect(addUtcMonths(anchor, 1).toISOString()).toBe(
      "2026-02-28T15:45:00.000Z",
    );
    expect(addUtcMonths(anchor, 2).toISOString()).toBe(
      "2026-03-31T15:45:00.000Z",
    );
    expect(
      monthlyPeriodAt(
        anchor,
        new Date("2026-03-01T00:00:00.000Z"),
      ),
    ).toEqual({
      index: 1,
      start: new Date("2026-02-28T15:45:00.000Z"),
      end: new Date("2026-03-31T15:45:00.000Z"),
    });
  });

  test("keeps the initial period at index zero", () => {
    const anchor = new Date("2026-07-24T12:00:00.000Z");
    expect(monthlyPeriodAt(anchor, anchor)).toEqual({
      index: 0,
      start: anchor,
      end: new Date("2026-08-24T12:00:00.000Z"),
    });
  });
});
