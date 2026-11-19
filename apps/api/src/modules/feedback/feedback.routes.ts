import type { ZodTypeProvider } from '@fastify/type-provider-zod';
import type { FastifyInstance, preHandlerHookHandler } from 'fastify';
import type { FeedbackController } from './feedback.controller.js';
import {
  feedbackOrganizationHeaderSchema,
  feedbackParamsSchema,
  submitFeedbackBodySchema,
  submitFeedbackResponseSchema,
} from './feedback.schema.js';

export interface FeedbackRouteDependencies {
  controller: FeedbackController;
  authenticate: preHandlerHookHandler;
  requireMember: preHandlerHookHandler;
}

/**
 * Registers message feedback routes under /messages (mounted at /api/v1).
 */
export async function registerFeedbackRoutes(
  app: FastifyInstance,
  deps: FeedbackRouteDependencies,
): Promise<void> {
  const typedApp = app.withTypeProvider<ZodTypeProvider>();

  typedApp.post('/messages/:id/feedback', {
    preHandler: [deps.authenticate, deps.requireMember],
    schema: {
      headers: feedbackOrganizationHeaderSchema,
      params: feedbackParamsSchema,
      body: submitFeedbackBodySchema,
      response: {
        200: submitFeedbackResponseSchema,
      },
    },
    handler: deps.controller.submit,
  });
}
