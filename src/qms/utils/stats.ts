/**
 * Statistical calculation utilities
 */

/**
 * Calculate percentile value from an array of numbers
 * @param values - Array of numeric values
 * @param percentile - Percentile to calculate (e.g., 50 for p50, 90 for p90)
 * @returns The percentile value
 */
export function calculatePercentile(values: number[], percentile: number): number {
  if (values.length === 0) return 0;

  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.ceil((percentile / 100) * sorted.length) - 1;
  return sorted[Math.max(0, index)] ?? 0;
}

/**
 * Calculate all common percentiles from an array
 * @param values - Array of numeric values
 * @returns Object containing p50, p90, p95, p99
 */
export function calculatePercentiles(values: number[]): {
  p50: number;
  p90: number;
  p95: number;
  p99: number;
} {
  return {
    p50: calculatePercentile(values, 50),
    p90: calculatePercentile(values, 90),
    p95: calculatePercentile(values, 95),
    p99: calculatePercentile(values, 99),
  };
}

/**
 * Calculate statistics summary for an array of values
 */
export function calculateStats(values: number[]): {
  min: number;
  max: number;
  avg: number;
  count: number;
  p50: number;
  p90: number;
  p95: number;
  p99: number;
} {
  if (values.length === 0) {
    return {
      min: 0,
      max: 0,
      avg: 0,
      count: 0,
      p50: 0,
      p90: 0,
      p95: 0,
      p99: 0,
    };
  }

  const sum = values.reduce((a, b) => a + b, 0);
  const percentiles = calculatePercentiles(values);

  return {
    min: Math.min(...values),
    max: Math.max(...values),
    avg: Math.round(sum / values.length),
    count: values.length,
    ...percentiles,
  };
}

/**
 * Calculate percentage change between two values
 * @returns Percentage change (positive means increase, negative means decrease)
 */
export function calculateTrend(current: number, previous: number): number {
  if (previous === 0) {
    return current > 0 ? 100 : 0;
  }
  return Math.round(((current - previous) / previous) * 100);
}

/**
 * Calculate success rate as percentage
 */
export function calculateSuccessRate(successCount: number, totalCount: number): number {
  if (totalCount === 0) return 100;
  return Math.round((successCount / totalCount) * 100);
}

export function calculateConversationSuccessRate(successCount: number, errorCount: number): number {
  const completedCount = successCount + errorCount;
  if (completedCount === 0) return 100;
  return Math.round((successCount / completedCount) * 100);
}

/**
 * Calculate error rate as percentage
 */
export function calculateErrorRate(errorCount: number, totalCount: number): number {
  if (totalCount === 0) return 0;
  return Math.round((errorCount / totalCount) * 100);
}
