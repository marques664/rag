import type { FastifyReply, FastifyRequest } from 'fastify';
import {
  ForbiddenError,
  UnauthorizedError,
} from '../../shared/errors/app-error.js';
import type { AnalyticsService } from './analytics.service.js';
import type { AnalyticsPeriodQuery } from './analytics.types.js';

function requireOrganizationId(request: FastifyRequest): string {
  if (!request.auth) {
    throw new UnauthorizedError();
  }
  if (!request.organizationContext) {
    throw new ForbiddenError('Organization context is required');
  }
  return request.organizationContext.organizationId;
}

export class AnalyticsController {
  constructor(private readonly service: AnalyticsService) {}

  overview = async (request: FastifyRequest, reply: FastifyReply) => {
    const organizationId = requireOrganizationId(request);
    const overview = await this.service.getOverview(organizationId);
    return reply.code(200).send({ overview });
  };

  usage = async (
    request: FastifyRequest<{ Querystring: AnalyticsPeriodQuery }>,
    reply: FastifyReply,
  ) => {
    const organizationId = requireOrganizationId(request);
    const usage = await this.service.getUsage(
      organizationId,
      request.query.days,
    );
    return reply.code(200).send({ usage });
  };

  performance = async (
    request: FastifyRequest<{ Querystring: AnalyticsPeriodQuery }>,
    reply: FastifyReply,
  ) => {
    const organizationId = requireOrganizationId(request);
    const performance = await this.service.getPerformance(
      organizationId,
      request.query.days,
    );
    return reply.code(200).send({ performance });
  };

  quality = async (
    request: FastifyRequest<{ Querystring: AnalyticsPeriodQuery }>,
    reply: FastifyReply,
  ) => {
    const organizationId = requireOrganizationId(request);
    const quality = await this.service.getQuality(
      organizationId,
      request.query.days,
    );
    return reply.code(200).send({ quality });
  };
}
