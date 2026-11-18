import type { ZodTypeProvider } from '@fastify/type-provider-zod';
import type { FastifyInstance, preHandlerHookHandler } from 'fastify';
import type { OrganizationsController } from './organizations.controller.js';
import {
  acceptInvitationResponseSchema,
  createInvitationBodySchema,
  createOrganizationBodySchema,
  invitationListResponseSchema,
  invitationParamsSchema,
  invitationResponseSchema,
  memberParamsSchema,
  memberResponseSchema,
  organizationListResponseSchema,
  organizationMembersResponseSchema,
  organizationParamsSchema,
  organizationResponseSchema,
  updateMemberRoleBodySchema,
  updateOrganizationBodySchema,
} from './organizations.schema.js';

export interface OrganizationRouteDependencies {
  controller: OrganizationsController;
  authenticate: preHandlerHookHandler;
}

/**
 * Registers organization, membership, and invitation routes under /organizations (mounted at /api/v1).
 */
export async function registerOrganizationRoutes(
  app: FastifyInstance,
  deps: OrganizationRouteDependencies,
): Promise<void> {
  const typedApp = app.withTypeProvider<ZodTypeProvider>();

  typedApp.post('/organizations', {
    preHandler: [deps.authenticate],
    schema: {
      body: createOrganizationBodySchema,
      response: {
        201: organizationResponseSchema,
      },
    },
    handler: deps.controller.create,
  });

  typedApp.get('/organizations', {
    preHandler: [deps.authenticate],
    schema: {
      response: {
        200: organizationListResponseSchema,
      },
    },
    handler: deps.controller.list,
  });

  // Static invitation routes must be registered before /organizations/:id.
  typedApp.get('/organizations/invitations', {
    preHandler: [deps.authenticate],
    schema: {
      response: {
        200: invitationListResponseSchema,
      },
    },
    handler: deps.controller.listPendingInvitations,
  });

  typedApp.post('/organizations/invitations/:invitationId/accept', {
    preHandler: [deps.authenticate],
    schema: {
      params: invitationParamsSchema,
      response: {
        200: acceptInvitationResponseSchema,
      },
    },
    handler: deps.controller.acceptInvitation,
  });

  typedApp.get('/organizations/:id', {
    preHandler: [deps.authenticate],
    schema: {
      params: organizationParamsSchema,
      response: {
        200: organizationResponseSchema,
      },
    },
    handler: deps.controller.getById,
  });

  typedApp.patch('/organizations/:id', {
    preHandler: [deps.authenticate],
    schema: {
      params: organizationParamsSchema,
      body: updateOrganizationBodySchema,
      response: {
        200: organizationResponseSchema,
      },
    },
    handler: deps.controller.update,
  });

  typedApp.get('/organizations/:id/members', {
    preHandler: [deps.authenticate],
    schema: {
      params: organizationParamsSchema,
      response: {
        200: organizationMembersResponseSchema,
      },
    },
    handler: deps.controller.listMembers,
  });

  typedApp.post('/organizations/:id/invitations', {
    preHandler: [deps.authenticate],
    schema: {
      params: organizationParamsSchema,
      body: createInvitationBodySchema,
      response: {
        201: invitationResponseSchema,
      },
    },
    handler: deps.controller.createInvitation,
  });

  typedApp.patch('/organizations/:id/members/:userId', {
    preHandler: [deps.authenticate],
    schema: {
      params: memberParamsSchema,
      body: updateMemberRoleBodySchema,
      response: {
        200: memberResponseSchema,
      },
    },
    handler: deps.controller.updateMemberRole,
  });
}
