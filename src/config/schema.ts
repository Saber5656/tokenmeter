export interface BudgetConfig {
  daily?: number;
  weekly?: number;
  monthly?: number;
}

export interface TokenmeterConfig {
  budgets: BudgetConfig;
  warnAt: number;
  currency: "USD";
}

export type ReadonlyTokenmeterConfig = {
  readonly budgets: Readonly<BudgetConfig>;
  readonly warnAt: number;
  readonly currency: "USD";
};

const DEFAULT_BUDGETS: Readonly<BudgetConfig> = Object.freeze({});

export const DEFAULT_CONFIG: ReadonlyTokenmeterConfig = Object.freeze({
  budgets: DEFAULT_BUDGETS,
  warnAt: 0.8,
  currency: "USD",
});

const ROOT_KEYS = new Set(["budgets", "warnAt", "currency"]);
const BUDGET_KEYS = new Set(["daily", "weekly", "monthly"]);

export class ConfigValidationError extends Error {
  readonly jsonPath: string;
  readonly reason: string;

  constructor(jsonPath: string, reason: string) {
    super(`Invalid tokenmeter config at ${jsonPath}: ${reason}`);
    this.name = "ConfigValidationError";
    this.jsonPath = jsonPath;
    this.reason = reason;
  }
}

export function createDefaultConfig(): TokenmeterConfig {
  return {
    budgets: { ...DEFAULT_BUDGETS },
    warnAt: DEFAULT_CONFIG.warnAt,
    currency: DEFAULT_CONFIG.currency,
  };
}

export function normalizeConfig(input: unknown): TokenmeterConfig {
  const root = requirePlainObject(input, "$");
  rejectUnknownKeys(root, ROOT_KEYS, "$");

  const defaults = createDefaultConfig();
  const budgets = hasOwn(root, "budgets")
    ? normalizeBudgets(root.budgets, defaults.budgets)
    : defaults.budgets;
  const warnAt = hasOwn(root, "warnAt")
    ? requireWarnAt(root.warnAt, "$.warnAt")
    : defaults.warnAt;
  const currency = hasOwn(root, "currency")
    ? requireCurrency(root.currency, "$.currency")
    : defaults.currency;

  return { budgets, warnAt, currency };
}

function normalizeBudgets(input: unknown, defaults: BudgetConfig): BudgetConfig {
  const budgets = requirePlainObject(input, "$.budgets");
  rejectUnknownKeys(budgets, BUDGET_KEYS, "$.budgets");

  const normalized: BudgetConfig = { ...defaults };
  if (hasOwn(budgets, "daily")) {
    normalized.daily = requirePositiveFiniteNumber(budgets.daily, "$.budgets.daily");
  }
  if (hasOwn(budgets, "weekly")) {
    normalized.weekly = requirePositiveFiniteNumber(budgets.weekly, "$.budgets.weekly");
  }
  if (hasOwn(budgets, "monthly")) {
    normalized.monthly = requirePositiveFiniteNumber(budgets.monthly, "$.budgets.monthly");
  }

  return normalized;
}

function requireWarnAt(value: unknown, jsonPath: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0 || value > 1) {
    throw new ConfigValidationError(jsonPath, "must be a finite number greater than 0 and at most 1");
  }

  return value;
}

function requirePositiveFiniteNumber(value: unknown, jsonPath: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new ConfigValidationError(jsonPath, "must be a finite number greater than 0");
  }

  return value;
}

function requireCurrency(value: unknown, jsonPath: string): "USD" {
  if (value !== "USD") {
    throw new ConfigValidationError(jsonPath, 'must be exactly "USD"');
  }

  return value;
}

function requirePlainObject(value: unknown, jsonPath: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ConfigValidationError(jsonPath, "must be a plain object");
  }

  const prototype = Object.getPrototypeOf(value) as unknown;
  if (prototype !== Object.prototype && prototype !== null) {
    throw new ConfigValidationError(jsonPath, "must be a plain object");
  }

  return value as Record<string, unknown>;
}

function rejectUnknownKeys(
  value: Record<string, unknown>,
  allowedKeys: ReadonlySet<string>,
  jsonPath: string,
): void {
  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) {
      throw new ConfigValidationError(`${jsonPath}.${key}`, "is not a supported field");
    }
  }
}

function hasOwn(value: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}
