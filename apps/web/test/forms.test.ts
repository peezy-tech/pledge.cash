import { describe, expect, test } from "bun:test";
import { dateString } from "../src/lib/forms";

describe("form presentation helpers", () => {
  test("shows contract timestamps with relative timing and exact values", () => {
    const now = 1_700_000_000_000;

    expect(dateString(1_700_007_200n, now)).toContain("in 2 hours (1700007200,");
    expect(dateString(1_699_913_600n, now)).toContain("yesterday (1699913600,");
  });
});
