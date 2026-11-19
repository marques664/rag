import type { ZodTypeProvider } from '@fastify/type-provider-zod';
import type { FastifyInstance, preHandlerHookHandler } from 'fastify';
import type { ConversationsController } from './conversations.controller.js';
import {
  conversationOrganizationHeaderSchema,
  conversationParamsSchema,
  createConversationBodySchema,
  createConversationResponseSchema,
  deleteConversationResponseSchema,
  getConversationResponseSchema,
  listConversationsQuerySchema,
  listConversationsResponseSchema,
  listMessagesQuerySchema,
  listMessagesResponseSchema,
  sendMessageBodySchema,
  sendMessageResponseSchema,
} from './conversations.schema.js';

export interface ConversationRouteDependencies {
  controller: ConversationsController;
  authenticate: preHandlerHookHandler;
  requireMember: preHandlerHookHandler;
}

/**
 * Registers tenant- and owner-scoped conversation routes under /conversations (mounted at /api/v1).
 */
export async function registerConversationRoutes(
  app: FastifyInstance,
  deps: ConversationRouteDependencies,
): Promise<void> {
  const typedApp = app.withTypeProvider<ZodTypeProvider>();

  typedApp.post('/conversations', {
    preHandler: [deps.authenticate, deps.requireMember],
    schema: {
      headers: conversationOrganizationHeaderSchema,
      body: createConversationBodySchema,
      response: {
        201: createConversationResponseSchema,
      },
    },
    handler: deps.controller.create,
  });

  typedApp.get('/conversations', {
    preHandler: [deps.authenticate, deps.requireMember],
    schema: {
      headers: conversationOrganizationHeaderSchema,
      querystring: listConversationsQuerySchema,
      response: {
        200: listConversationsResponseSchema,
      },
    },
    handler: deps.controller.list,
  });

  typedApp.get('/conversations/:id', {
    preHandler: [deps.authenticate, deps.requireMember],
    schema: {
      headers: conversationOrganizationHeaderSchema,
      params: conversationParamsSchema,
      response: {
        200: getConversationResponseSchema,
      },
    },
    handler: deps.controller.getById,
  });

  typedApp.delete('/conversations/:id', {
    preHandler: [deps.authenticate, deps.requireMember],
    schema: {
      headers: conversationOrganizationHeaderSchema,
      params: conversationParamsSchema,
      response: {
        200: deleteConversationResponseSchema,
      },
    },
    handler: deps.controller.delete,
  });

  typedApp.post('/conversations/:id/messages', {
    preHandler: [deps.authenticate, deps.requireMember],
    schema: {
      headers: conversationOrganizationHeaderSchema,
      params: conversationParamsSchema,
      body: sendMessageBodySchema,
      response: {
        201: sendMessageResponseSchema,
      },
    },
    handler: deps.controller.sendMessage,
  });

  typedApp.get('/conversations/:id/messages', {
    preHandler: [deps.authenticate, deps.requireMember],
    schema: {
      headers: conversationOrganizationHeaderSchema,
      params: conversationParamsSchema,
      querystring: listMessagesQuerySchema,
      response: {
        200: listMessagesResponseSchema,
      },
    },
    handler: deps.controller.listMessages,
  });
}
