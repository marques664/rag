export type DependencyStatus = 'up' | 'down';

export interface DependencyCheckResult {
  status: DependencyStatus;
  latencyMs: number;
  error?: string;
}

export interface DatabaseCheckResult extends DependencyCheckResult {
  pgvectorEnabled: boolean;
}

export interface HealthResponse {
  status: 'ok';
  service: string;
  timestamp: string;
  uptimeSeconds: number;
}

export interface ReadinessResponse {
  status: 'ready' | 'degraded';
  service: string;
  timestamp: string;
  checks: {
    database: DatabaseCheckResult;
    redis: DependencyCheckResult;
  };
}
