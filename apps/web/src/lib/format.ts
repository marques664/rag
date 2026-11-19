export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const unit = units[unitIndex] ?? 'TB';
  return `${value.toFixed(value >= 100 ? 0 : 1)} ${unit}`;
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

export function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return '—';
  }
  return new Intl.NumberFormat('en-US').format(value);
}

export function formatDurationMs(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) {
    return '—';
  }
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}

export function formatUsd(amount: number | null | undefined): string {
  if (amount === null || amount === undefined || !Number.isFinite(amount)) {
    return '—';
  }
  if (amount === 0) return '$0.00';
  if (amount < 0.01) return `$${amount.toFixed(5)}`;
  return `$${amount.toFixed(4)}`;
}

export function formatPercent(ratio: number | null | undefined): string {
  if (ratio === null || ratio === undefined || !Number.isFinite(ratio)) {
    return '—';
  }
  return `${(ratio * 100).toFixed(1)}%`;
}

export function getErrorMessage(error: unknown, fallback = 'Something went wrong'): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return fallback;
}
