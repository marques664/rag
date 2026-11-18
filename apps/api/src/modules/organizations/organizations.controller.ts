import type { FastifyReply, FastifyRequest } from 'fastify';
import { UnauthorizedError } from '../../shared/errors/app-error.js';
import type { OrganizationsService } from './organizations.service.js';
import type {
  CreateInvitationInput,
  CreateOrganizationInput,
  UpdateMemberRoleInput,
  UpdateOrganizationInput,
} from './organizations.types.js';

function requireAuth(request: FastifyRequest) {
  if (!request.auth) {
    throw new UnauthorizedError();
  }
  return request.auth;
}

export class OrganizationsController {
  constructor(private readonly service: OrganizationsService) {}

  create = async (
    request: FastifyRequest<{ Body: CreateOrganizationInput }>,
    reply: FastifyReply,
  ) => {
    const auth = requireAuth(request);
    const organization = await this.service.createOrganization(
      auth.userId,
      request.body,
    );
    return reply.code(201).send({ organization });
  };

  list = async (request: FastifyRequest, reply: FastifyReply) => {
    const auth = requireAuth(request);
    const organizations = await this.service.listOrganizations(auth.userId);
    return reply.code(200).send({ organizations });
  };

  getById = async (
    request: FastifyRequest<{ Params: { id: string } }>,
    reply: FastifyReply,
  ) => {
    const auth = requireAuth(request);
    const organization = await this.service.getOrganization(
      request.params.id,
      auth.userId,
    );
    return reply.code(200).send({ organization });
  };

  update = async (
    request: FastifyRequest<{
      Params: { id: string };
      Body: UpdateOrganizationInput;
    }>,
    reply: FastifyReply,
  ) => {
    const auth = requireAuth(request);
    const organization = await this.service.updateOrganization(
      request.params.id,
      auth.userId,
      request.body,
    );
    return reply.code(200).send({ organization });
  };

  listMembers = async (
    request: FastifyRequest<{ Params: { id: string } }>,
    reply: FastifyReply,
  ) => {
    const auth = requireAuth(request);
    const members = await this.service.listMembers(
      request.params.id,
      auth.userId,
    );
    return reply.code(200).send({ members });
  };

  createInvitation = async (
    request: FastifyRequest<{
      Params: { id: string };
      Body: CreateInvitationInput;
    }>,
    reply: FastifyReply,
  ) => {
    const auth = requireAuth(request);
    const invitation = await this.service.createInvitation(
      request.params.id,
      auth.userId,
      request.body,
    );
    return reply.code(201).send({ invitation });
  };

  listPendingInvitations = async (
    request: FastifyRequest,
    reply: FastifyReply,
  ) => {
    const auth = requireAuth(request);
    const invitations = await this.service.listPendingInvitations(auth.email);
    return reply.code(200).send({ invitations });
  };

  acceptInvitation = async (
    request: FastifyRequest<{ Params: { invitationId: string } }>,
    reply: FastifyReply,
  ) => {
    const auth = requireAuth(request);
    const organization = await this.service.acceptInvitation(
      request.params.invitationId,
      auth.userId,
      auth.email,
    );
    return reply.code(200).send({ organization });
  };

  updateMemberRole = async (
    request: FastifyRequest<{
      Params: { id: string; userId: string };
      Body: UpdateMemberRoleInput;
    }>,
    reply: FastifyReply,
  ) => {
    const auth = requireAuth(request);
    const member = await this.service.updateMemberRole(
      request.params.id,
      auth.userId,
      request.params.userId,
      request.body,
    );
    return reply.code(200).send({ member });
  };
}
