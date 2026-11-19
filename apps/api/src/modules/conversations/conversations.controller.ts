import type { FastifyReply, FastifyRequest } from 'fastify';
import {
  ForbiddenError,
  UnauthorizedError,
} from '../../shared/errors/app-error.js';
import type { ConversationsService } from './conversations.service.js';
import type {
  ListConversationsQuery,
  ListMessagesQuery,
} from './conversations.types.js';

function requireConversationContext(request: FastifyRequest) {
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

export class ConversationsController {
  constructor(private readonly service: ConversationsService) {}

  create = async (
    request: FastifyRequest<{ Body: { title?: string } }>,
    reply: FastifyReply,
  ) => {
    const context = requireConversationContext(request);
    const conversation = await this.service.createConversation({
      organizationId: context.organizationId,
      userId: context.userId,
      title: request.body.title,
    });
    return reply.code(201).send({ conversation });
  };

  list = async (
    request: FastifyRequest<{ Querystring: ListConversationsQuery }>,
    reply: FastifyReply,
  ) => {
    const context = requireConversationContext(request);
    const result = await this.service.listConversations(
      context.organizationId,
      context.userId,
      request.query,
    );
    return reply.code(200).send(result);
  };

  getById = async (
    request: FastifyRequest<{ Params: { id: string } }>,
    reply: FastifyReply,
  ) => {
    const context = requireConversationContext(request);
    const conversation = await this.service.getConversation(
      request.params.id,
      context.organizationId,
      context.userId,
    );
    return reply.code(200).send({ conversation });
  };

  delete = async (
    request: FastifyRequest<{ Params: { id: string } }>,
    reply: FastifyReply,
  ) => {
    const context = requireConversationContext(request);
    await this.service.deleteConversation(
      request.params.id,
      context.organizationId,
      context.userId,
    );
    return reply.code(200).send({
      deleted: true as const,
      conversationId: request.params.id,
    });
  };

  listMessages = async (
    request: FastifyRequest<{
      Params: { id: string };
      Querystring: ListMessagesQuery;
    }>,
    reply: FastifyReply,
  ) => {
    const context = requireConversationContext(request);
    const result = await this.service.listMessages(
      request.params.id,
      context.organizationId,
      context.userId,
      request.query,
    );
    return reply.code(200).send(result);
  };

  sendMessage = async (
    request: FastifyRequest<{
      Params: { id: string };
      Body: { content: string; topK?: number };
    }>,
    reply: FastifyReply,
  ) => {
    const context = requireConversationContext(request);
    const result = await this.service.sendMessage({
      conversationId: request.params.id,
      organizationId: context.organizationId,
      userId: context.userId,
      content: request.body.content,
      topK: request.body.topK,
    });
    return reply.code(201).send(result);
  };
}
