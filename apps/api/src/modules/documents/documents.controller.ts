import { formatTraceparent } from '@enterprise-ai/shared';
import type { FastifyReply, FastifyRequest } from 'fastify';
import {
  ForbiddenError,
  UnauthorizedError,
} from '../../shared/errors/app-error.js';
import {
  DocumentTooLargeError,
  InvalidDocumentUploadError,
} from './documents.errors.js';
import type { DocumentsService } from './documents.service.js';
import type { ListDocumentsQuery } from './documents.types.js';

function requireDocumentContext(request: FastifyRequest) {
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

function getErrorCodeAndStatus(error: unknown): {
  code?: string;
  statusCode?: number;
} {
  if (typeof error !== 'object' || error === null) {
    return {};
  }
  const record = error as { code?: unknown; statusCode?: unknown };
  return {
    code: typeof record.code === 'string' ? record.code : undefined,
    statusCode:
      typeof record.statusCode === 'number' ? record.statusCode : undefined,
  };
}

export class DocumentsController {
  constructor(
    private readonly service: DocumentsService,
    private readonly maxFileSizeBytes: number,
  ) {}

  upload = async (request: FastifyRequest, reply: FastifyReply) => {
    const context = requireDocumentContext(request);

    if (!request.isMultipart()) {
      throw new InvalidDocumentUploadError(
        'Request Content-Type must be multipart/form-data',
        'INVALID_CONTENT_TYPE',
      );
    }

    let filePart;
    try {
      filePart = await request.file();
    } catch (error) {
      const { code, statusCode } = getErrorCodeAndStatus(error);
      if (
        code === 'FST_REQ_FILE_TOO_LARGE' ||
        code === 'FST_FILES_LIMIT' ||
        statusCode === 413
      ) {
        throw new DocumentTooLargeError(this.maxFileSizeBytes);
      }
      throw new InvalidDocumentUploadError(
        error instanceof Error ? error.message : 'Invalid multipart upload',
      );
    }

    if (!filePart) {
      throw new InvalidDocumentUploadError(
        'Multipart request must include a PDF file',
        'MISSING_FILE',
      );
    }

    let buffer: Buffer;
    try {
      buffer = await filePart.toBuffer();
    } catch (error) {
      const { code, statusCode } = getErrorCodeAndStatus(error);
      if (code === 'FST_REQ_FILE_TOO_LARGE' || statusCode === 413) {
        throw new DocumentTooLargeError(this.maxFileSizeBytes);
      }
      throw error;
    }

    if (filePart.file.truncated) {
      throw new DocumentTooLargeError(this.maxFileSizeBytes);
    }

    const document = await this.service.uploadDocument({
      organizationId: context.organizationId,
      uploadedByUserId: context.userId,
      filename: filePart.filename,
      mimeType: filePart.mimetype,
      buffer,
      ...(request.traceContext
        ? { traceparent: formatTraceparent(request.traceContext) }
        : {}),
    });

    return reply.code(201).send({ document });
  };

  list = async (
    request: FastifyRequest<{ Querystring: ListDocumentsQuery }>,
    reply: FastifyReply,
  ) => {
    const context = requireDocumentContext(request);
    const result = await this.service.listDocuments(
      context.organizationId,
      request.query,
    );
    return reply.code(200).send(result);
  };

  getById = async (
    request: FastifyRequest<{ Params: { id: string } }>,
    reply: FastifyReply,
  ) => {
    const context = requireDocumentContext(request);
    const document = await this.service.getDocument(
      request.params.id,
      context.organizationId,
    );
    return reply.code(200).send({ document });
  };

  getStatus = async (
    request: FastifyRequest<{ Params: { id: string } }>,
    reply: FastifyReply,
  ) => {
    const context = requireDocumentContext(request);
    const status = await this.service.getDocumentStatus(
      request.params.id,
      context.organizationId,
    );
    return reply.code(200).send({ status });
  };

  reprocess = async (
    request: FastifyRequest<{ Params: { id: string } }>,
    reply: FastifyReply,
  ) => {
    const context = requireDocumentContext(request);
    const result = await this.service.reprocessDocument(
      request.params.id,
      context.organizationId,
      request.traceContext ? formatTraceparent(request.traceContext) : undefined,
    );
    return reply.code(202).send(result);
  };

  delete = async (
    request: FastifyRequest<{ Params: { id: string } }>,
    reply: FastifyReply,
  ) => {
    const context = requireDocumentContext(request);
    await this.service.deleteDocument(request.params.id, context.organizationId);
    return reply.code(200).send({
      deleted: true as const,
      documentId: request.params.id,
    });
  };
}
