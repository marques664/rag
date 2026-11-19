export interface ModelPricingPerMillionUsd {
  inputUsdPerMillion: number;
  outputUsdPerMillion: number;
}

export interface EstimateModelCostInput {
  model: string;
  inputTokens: number;
  outputTokens?: number;
}

/**
 * Reference USD per 1M token pricing for initial supported OpenAI models.
 * Unknown models return null rather than fabricating cost estimates.
 */
const MODEL_PRICING_TABLE: Readonly<Record<string, ModelPricingPerMillionUsd>> = {
  'text-embedding-3-small': {
    inputUsdPerMillion: 0.02,
    outputUsdPerMillion: 0,
  },
  'text-embedding-3-large': {
    inputUsdPerMillion: 0.13,
    outputUsdPerMillion: 0,
  },
  'gpt-4o-mini': {
    inputUsdPerMillion: 0.15,
    outputUsdPerMillion: 0.6,
  },
  'gpt-4o': {
    inputUsdPerMillion: 2.5,
    outputUsdPerMillion: 10.0,
  },
  'gpt-4.1-mini': {
    inputUsdPerMillion: 0.4,
    outputUsdPerMillion: 1.6,
  },
  'gpt-4.1-nano': {
    inputUsdPerMillion: 0.1,
    outputUsdPerMillion: 0.4,
  },
};

function resolveModelPricing(model: string): ModelPricingPerMillionUsd | undefined {
  const normalized = model.trim().toLowerCase();
  if (!normalized) {
    return undefined;
  }

  if (MODEL_PRICING_TABLE[normalized]) {
    return MODEL_PRICING_TABLE[normalized];
  }

  // Match snapshot model IDs such as "gpt-4o-mini-2024-07-18".
  const snapshotBase = normalized.replace(/-\d{4}-\d{2}-\d{2}$/, '');
  return MODEL_PRICING_TABLE[snapshotBase];
}

/**
 * Estimates USD cost for a model call given token counts.
 * Returns null if the model is unknown or token counts are invalid.
 */
export function estimateModelCostUsd(
  input: EstimateModelCostInput,
): number | null {
  const outputTokens = input.outputTokens ?? 0;
  if (
    !Number.isFinite(input.inputTokens) ||
    !Number.isFinite(outputTokens) ||
    input.inputTokens < 0 ||
    outputTokens < 0
  ) {
    return null;
  }

  const pricing = resolveModelPricing(input.model);
  if (!pricing) {
    return null;
  }

  const rawCost =
    (input.inputTokens / 1_000_000) * pricing.inputUsdPerMillion +
    (outputTokens / 1_000_000) * pricing.outputUsdPerMillion;

  return Number(rawCost.toFixed(8));
}
