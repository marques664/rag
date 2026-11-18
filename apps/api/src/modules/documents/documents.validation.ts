import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { ALLOWED_DOCUMENT_MIME_TYPES } from '@enterprise-ai/shared';
import {
  DocumentTooLargeError,
  InvalidDocumentUploadError,
  InvalidPdfContentError,
  UnsupportedDocumentTypeError,
} from './documents.errors.js';

const MAX_FILENAME_LENGTH = 255;
const PDF_EXTENSION = '.pdf';
const PDF_MAGIC_HEADER = '%PDF-';

export interface ValidatedPdfUpload {
  filename: string;
  mimeType: string;
  fileSize: number;
  checksum: string;
}

function stripControlCharacters(value: string): string {
  let sanitized = '';
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code >= 0x20 && code !== 0x7f) {
      sanitized += value[i] ?? '';
    }
  }
  return sanitized;
}

/**
 * Sanitizes an uploaded filename for safe database storage and UI display.
 * Strips directory components, null bytes, and control characters without
 * altering the UUID-based object storage key.
 */
export function sanitizePdfFilename(rawFilename: string): string {
  const withoutNullAndControl = stripControlCharacters(rawFilename);
  const posixBase = path.posix.basename(withoutNullAndControl);
  const crossPlatformBase = path.win32.basename(posixBase).trim();

  if (
    !crossPlatformBase ||
    crossPlatformBase === '.' ||
    crossPlatformBase === '..'
  ) {
    throw new InvalidDocumentUploadError(
      'Uploaded file must have a valid filename',
      'INVALID_FILENAME',
    );
  }

  if (!crossPlatformBase.toLowerCase().endsWith(PDF_EXTENSION)) {
    throw new UnsupportedDocumentTypeError(
      'Uploaded file must have a .pdf extension',
    );
  }

  if (crossPlatformBase.length <= MAX_FILENAME_LENGTH) {
    return crossPlatformBase;
  }

  const stemMax = MAX_FILENAME_LENGTH - PDF_EXTENSION.length;
  const stem = crossPlatformBase.slice(0, stemMax).trimEnd();
  if (!stem) {
    throw new InvalidDocumentUploadError(
      'Uploaded file must have a valid filename',
      'INVALID_FILENAME',
    );
  }

  return `${stem}${PDF_EXTENSION}`;
}

/**
 * Normalizes a MIME type string (stripping optional parameters like charset).
 */
export function normalizeMimeType(mimeType: string): string {
  const base = mimeType.split(';', 1)[0] ?? '';
  return base.trim().toLowerCase();
}

/**
 * Returns true if the buffer begins with the PDF magic header `%PDF-`.
 */
export function hasPdfMagicBytes(buffer: Buffer): boolean {
  if (buffer.length < PDF_MAGIC_HEADER.length) {
    return false;
  }
  return buffer.subarray(0, PDF_MAGIC_HEADER.length).toString('ascii') === PDF_MAGIC_HEADER;
}

/**
 * Computes a lowercase hex SHA-256 checksum for uploaded file bytes.
 */
export function computeSha256Checksum(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}

/**
 * Generates an opaque, tenant-isolated MinIO storage key independent of user filenames.
 */
export function buildDocumentStorageKey(
  organizationId: string,
  documentId: string,
): string {
  return `organizations/${organizationId}/documents/${documentId}/${randomUUID()}.pdf`;
}

/**
 * Validates uploaded PDF metadata, size bounds, and actual file header bytes.
 */
export function validatePdfUpload(params: {
  rawFilename: string;
  rawMimeType: string;
  buffer: Buffer;
  maxFileSizeBytes: number;
}): ValidatedPdfUpload {
  const filename = sanitizePdfFilename(params.rawFilename);
  const mimeType = normalizeMimeType(params.rawMimeType);

  const allowedMimes: readonly string[] = ALLOWED_DOCUMENT_MIME_TYPES;
  if (!allowedMimes.includes(mimeType)) {
    throw new UnsupportedDocumentTypeError(
      'Only PDF documents (application/pdf) are supported',
    );
  }

  if (params.buffer.length === 0) {
    throw new InvalidDocumentUploadError(
      'Uploaded PDF file cannot be empty',
      'EMPTY_DOCUMENT_FILE',
    );
  }

  if (params.buffer.length > params.maxFileSizeBytes) {
    throw new DocumentTooLargeError(params.maxFileSizeBytes);
  }

  if (!hasPdfMagicBytes(params.buffer)) {
    throw new InvalidPdfContentError(
      'File content does not match a valid PDF header (%PDF-)',
    );
  }

  return {
    filename,
    mimeType,
    fileSize: params.buffer.length,
    checksum: computeSha256Checksum(params.buffer),
  };
}
