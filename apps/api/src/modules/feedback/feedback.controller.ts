import type { FeedbackRatingValue } from '@enterprise-ai/shared';
import type { FastifyReply, FastifyRequest } from 'fastify';
import {
  ForbiddenError,
  UnauthorizedError,
} from '../../shared/errors/app-error.js';
import type { FeedbackService } from './feedback.service.js';

function requireFeedbackContext(request: FastifyRequest) {
  if (!request.auth) {
    throw new UnauthorizedError();
  }
  if (!request.organizationContext) {
    throw new ForbiddenError('Organization context is required');
  }
  return {
    userId: request.auth.userId,
    organizationId: request.organizationContext.organizationId,
  };
}

export class FeedbackController {
  constructor(private readonly service: FeedbackService) {}

  submit = async (
    request: FastifyRequest<{
      Params: { id: string };
      Body: { rating: FeedbackRatingValue; comment?: string | null };
    }>,
    reply: FastifyReply,
  ) => {
    const context = requireFeedbackContext(request);
    const result = await this.service.submitFeedback({
      messageId: request.params.id,
      organizationId: context.organizationId,
      userId: context.userId,
      rating: request.body.rating,
      comment: request.body.comment,
    });
    return reply.code(200).send(result);
  };
}
