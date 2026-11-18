import { extractText, getDocumentProxy } from 'unpdf';

export interface ExtractedPage {
  pageNumber: number;
  text: string;
}

export interface ExtractedPdfResult {
  totalPages: number;
  pages: ExtractedPage[];
}

export interface PdfTextExtractor {
  extract(bytes: Uint8Array): Promise<ExtractedPdfResult>;
}

export class PdfExtractionError extends Error {
  public readonly retryable: boolean;

  constructor(message: string, retryable = false) {
    super(message);
    this.name = 'PdfExtractionError';
    this.retryable = retryable;
  }
}

const PDF_MAGIC_BYTES = [0x25, 0x50, 0x44, 0x46, 0x2d] as const; // %PDF-

/**
 * Verifies the binary payload starts with the PDF magic header (`%PDF-`).
 */
export function hasPdfMagicBytes(bytes: Uint8Array): boolean {
  if (bytes.byteLength < PDF_MAGIC_BYTES.length) {
    return false;
  }

  for (let i = 0; i < PDF_MAGIC_BYTES.length; i += 1) {
    if (bytes[i] !== PDF_MAGIC_BYTES[i]) {
      return false;
    }
  }

  return true;
}

/**
 * Strips null bytes (rejected by PostgreSQL UTF-8 text columns) and normalizes
 * whitespace while preserving paragraph breaks.
 */
export function normalizeExtractedText(raw: string): string {
  return raw
    .replaceAll('\u0000', '')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function isNonRetryablePdfError(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }

  const candidate = error as { name?: string; message?: string };
  const name = candidate.name ?? '';
  const message = (candidate.message ?? '').toLowerCase();

  return (
    name === 'InvalidPDFException' ||
    name === 'PasswordException' ||
    name === 'FormatError' ||
    name === 'MissingPDFException' ||
    message.includes('invalid pdf') ||
    message.includes('password') ||
    message.includes('encrypted') ||
    message.includes('no pdf header')
  );
}

/**
 * Extracts text per page using `unpdf` (Node 24 ESM compatible, zero native addons),
 * preserving 1-based page numbers.
 */
export class UnpdfTextExtractor implements PdfTextExtractor {
  public async extract(bytes: Uint8Array): Promise<ExtractedPdfResult> {
    if (!hasPdfMagicBytes(bytes)) {
      throw new PdfExtractionError(
        'Invalid PDF binary payload: missing %PDF- header',
        false,
      );
    }

    let pdf: Awaited<ReturnType<typeof getDocumentProxy>> | undefined;

    try {
      // Copy buffer view so PDF.js cannot detach the caller's Uint8Array.
      pdf = await getDocumentProxy(bytes.slice());
      const { totalPages, text } = await extractText(pdf, {
        mergePages: false,
      });

      const pageStrings = Array.isArray(text) ? text : [text];
      const pages: ExtractedPage[] = pageStrings.map((pageText, index) => ({
        pageNumber: index + 1,
        text: normalizeExtractedText(pageText),
      }));

      const hasAnyText = pages.some((page) => page.text.length > 0);
      if (totalPages <= 0 || !hasAnyText) {
        throw new PdfExtractionError(
          'PDF contains no extractable text; scanned or image-only PDFs are not supported without OCR',
          false,
        );
      }

      return {
        totalPages,
        pages,
      };
    } catch (error) {
      if (error instanceof PdfExtractionError) {
        throw error;
      }

      const message =
        error instanceof Error ? error.message : 'Failed to extract PDF text';
      const retryable = !isNonRetryablePdfError(error);
      throw new PdfExtractionError(message, retryable);
    } finally {
      if (pdf) {
        try {
          if (typeof pdf.cleanup === 'function') {
            await pdf.cleanup(false);
          }
          if (typeof pdf.loadingTask?.destroy === 'function') {
            await pdf.loadingTask.destroy();
          }
        } catch {
          // Best-effort cleanup; do not mask extraction outcome.
        }
      }
    }
  }
}
