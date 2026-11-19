import type { ZodTypeProvider } from '@fastify/type-provider-zod';
import type { FastifyInstance, preHandlerHookHandler } from 'fastify';
import type { AnalyticsController } from './analytics.controller.js';
import {
  analyticsOrganizationHeaderSchema,
  analyticsOverviewResponseSchema,
  analyticsPeriodQuerySchema,
  performanceAnalyticsResponseSchema,
  qualityAnalyticsResponseSchema,
  usageAnalyticsResponseSchema,
} from './analytics.schema.js';

export interface AnalyticsRouteDependencies {
  controller: AnalyticsController;
  authenticate: preHandlerHookHandler;
  requireMember: preHandlerHookHandler;
}

/**
 * Registers tenant-scoped dashboard and analytics routes (mounted at /api/v1).
 */
export async function registerAnalyticsRoutes(
  app: FastifyInstance,
  deps: AnalyticsRouteDependencies,
): Promise<void> {
  const typedApp = app.withTypeProvider<ZodTypeProvider>();

  typedApp.get('/dashboard/overview', {
    preHandler: [deps.authenticate, deps.requireMember],
    schema: {
      headers: analyticsOrganizationHeaderSchema,
      response: {
        200: analyticsOverviewResponseSchema,
      },
    },
    handler: deps.controller.overview,
  });

  typedApp.get('/analytics/usage', {
    preHandler: [deps.authenticate, deps.requireMember],
    schema: {
      headers: analyticsOrganizationHeaderSchema,
      querystring: analyticsPeriodQuerySchema,
      response: {
        200: usageAnalyticsResponseSchema,
      },
    },
    handler: deps.controller.usage,
  });

  typedApp.get('/analytics/performance', {
    preHandler: [deps.authenticate, deps.requireMember],
    schema: {
      headers: analyticsOrganizationHeaderSchema,
      querystring: analyticsPeriodQuerySchema,
      response: {
        200: performanceAnalyticsResponseSchema,
      },
    },
    handler: deps.controller.performance,
  });

  typedApp.get('/analytics/quality', {
    preHandler: [deps.authenticate, deps.requireMember],
    schema: {
      headers: analyticsOrganizationHeaderSchema,
      querystring: analyticsPeriodQuerySchema,
      response: {
        200: qualityAnalyticsResponseSchema,
      },
    },
    handler: deps.controller.quality,
  });
}
