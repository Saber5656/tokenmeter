import { describe, expect, it } from "vitest";

import {
  ConfigValidationError,
  createDefaultConfig,
  normalizeConfig,
} from "../../src/config/schema.js";

describe("normalizeConfig", () => {
  it("returns independent defaults for an empty config", () => {
    const first = normalizeConfig({});
    const second = createDefaultConfig();

    first.budgets.daily = 1;

    expect(second).toEqual({
      budgets: {},
      warnAt: 0.8,
      currency: "USD",
    });
  });

  it("preserves only explicitly configured budget values", () => {
    expect(normalizeConfig({ budgets: { daily: 5 } })).toEqual({
      budgets: { daily: 5 },
      warnAt: 0.8,
      currency: "USD",
    });
  });

  it.each([
    [{ extra: true }, "$.extra"],
    [{ budgets: { constructor: 1 } }, "$.budgets.constructor"],
    [JSON.parse('{"__proto__":true}'), "$.__proto__"],
  ])("rejects unknown fields in %j", (input, jsonPath) => {
    expect(() => normalizeConfig(input)).toThrowError(
      expect.objectContaining<Partial<ConfigValidationError>>({ jsonPath }),
    );
  });

  it.each([null, [], "config", 1])("rejects a non-object root (%j)", (input) => {
    expect(() => normalizeConfig(input)).toThrow(ConfigValidationError);
  });

  it.each([null, [], "budgets", 1])("rejects a non-object budgets value (%j)", (budgets) => {
    expect(() => normalizeConfig({ budgets })).toThrow(ConfigValidationError);
  });

  it.each([0, -1, "1", null, [], Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects invalid budget value %j",
    (daily) => {
      expect(() => normalizeConfig({ budgets: { daily } })).toThrow(ConfigValidationError);
    },
  );

  it.each([0, -0.1, 1.1, "0.8", null, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects invalid warning threshold %j",
    (warnAt) => {
      expect(() => normalizeConfig({ warnAt })).toThrow(ConfigValidationError);
    },
  );

  it("accepts the documented numeric boundaries", () => {
    expect(normalizeConfig({ budgets: { daily: 0.01 }, warnAt: 1 })).toMatchObject({
      budgets: { daily: 0.01 },
      warnAt: 1,
    });
  });

  it.each(["usd", "EUR", null, 1])("rejects unsupported currency %j", (currency) => {
    expect(() => normalizeConfig({ currency })).toThrow(ConfigValidationError);
  });
});
