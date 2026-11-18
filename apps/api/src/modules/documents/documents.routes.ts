import type { ZodTypeProvider } from '@fastify/type-provider-zod';
import type { FastifyInstance, preHandlerHookHandler } from 'fastify';
import type { DocumentsController } from './documents.controller.js';
import {
  deleteDocumentResponseSchema,
  documentDetailResponseSchema,
  documentOrganizationHeaderSchema,
  documentParamsSchema,
  documentStatusResponseSchema,
  listDocumentsQuerySchema,
  listDocumentsResponseSchema,
  reprocessDocumentResponseSchema,
  uploadDocumentResponseSchema,
} from './documents.schema.js';

export interface DocumentRouteDependencies {
  controller: DocumentsController;
  authenticate: preHandlerHookHandler;
  requireMember: preHandlerHookHandler;
  requireAdmin: preHandlerHookHandler;
}

/**
 * Registers tenant-scoped document management routes under /documents (mounted at /api/v1).
 */
export async function registerDocumentRoutes(
  app: FastifyInstance,
  deps: DocumentRouteDependencies,
): Promise<void> {
  const typedApp = app.withTypeProvider<ZodTypeProvider>();

  typedApp.post('/documents', {
    preHandler: [deps.authenticate, deps.requireMember],
    schema: {
      headers: documentOrganizationHeaderSchema,
      response: {
        201: uploadDocumentResponseSchema,
      },
    },
    handler: deps.controller.upload,
  });

  typedApp.get('/documents', {
    preHandler: [deps.authenticate, deps.requireMember],
    schema: {
      headers: documentOrganizationHeaderSchema,
      querystring: listDocumentsQuerySchema,
      response: {
        200: listDocumentsResponseSchema,
      },
    },
    handler: deps.controller.list,
  });

  typedApp.get('/documents/:id', {
    preHandler: [deps.authenticate, deps.requireMember],
    schema: {
      headers: documentOrganizationHeaderSchema,
      params: documentParamsSchema,
      response: {
        200: documentDetailResponseSchema,
      },
    },
    handler: deps.controller.getById,
  });

  typedApp.get('/documents/:id/status', {
    preHandler: [deps.authenticate, deps.requireMember],
    schema: {
      headers: documentOrganizationHeaderSchema,
      params: documentParamsSchema,
      response: {
        200: documentStatusResponseSchema,
      },
    },
    handler: deps.controller.getStatus,
  });

  typedApp.post('/documents/:id/reprocess', {
    preHandler: [deps.authenticate, deps.requireAdmin],
    schema: {
      headers: documentOrganizationHeaderSchema,
      params: documentParamsSchema,
      response: {
        202: reprocessDocumentResponseSchema,
      },
    },
    handler: deps.controller.reprocess,
  });

  typedApp.delete('/documents/:id', {
    preHandler: [deps.authenticate, deps.requireAdmin],
    schema: {
      headers: documentOrganizationHeaderSchema,
      params: documentParamsSchema,
      response: {
        200: deleteDocumentResponseSchema,
      },
    },
    handler: deps.controller.delete,
  });
}
