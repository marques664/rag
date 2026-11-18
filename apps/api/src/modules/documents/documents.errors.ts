import {
  BadRequestError,
  ConflictError,
  NotFoundError,
  PayloadTooLargeError,
  ServiceUnavailableError,
  UnsupportedMediaTypeError,
} from '../../shared/errors/app-error.js';

export class DocumentNotFoundError extends NotFoundError {
  constructor() {
    super('Document not found', 'DOCUMENT_NOT_FOUND');
  }
}

export class InvalidDocumentUploadError extends BadRequestError {
  constructor(message = 'Invalid document upload', code = 'INVALID_DOCUMENT_UPLOAD') {
    super(message, code);
  }
}

export class InvalidPdfContentError extends BadRequestError {
  constructor(message = 'Uploaded file is not a valid PDF document') {
    super(message, 'INVALID_PDF_CONTENT');
  }
}

export class UnsupportedDocumentTypeError extends UnsupportedMediaTypeError {
  constructor(message = 'Only PDF documents (application/pdf) are supported') {
    super(message, 'UNSUPPORTED_DOCUMENT_TYPE');
  }
}

export class DocumentTooLargeError extends PayloadTooLargeError {
  constructor(maxBytes: number) {
    super(
      `Document exceeds maximum allowed file size of ${maxBytes} bytes`,
      'DOCUMENT_TOO_LARGE',
    );
  }
}

export class DocumentAlreadyProcessingError extends ConflictError {
  constructor() {
    super(
      'Document is already queued or actively processing',
      'DOCUMENT_ALREADY_PROCESSING',
    );
  }
}

export class DocumentQueueUnavailableError extends ServiceUnavailableError {
  constructor() {
    super(
      'Document was stored but processing queue is temporarily unavailable; retry reprocessing later',
      'DOCUMENT_QUEUE_UNAVAILABLE',
    );
  }
}
