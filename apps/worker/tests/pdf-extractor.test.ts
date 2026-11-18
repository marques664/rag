import { describe, expect, it } from 'vitest';
import {
  hasPdfMagicBytes,
  normalizeExtractedText,
  PdfExtractionError,
  UnpdfTextExtractor,
} from '../src/services/pdf-extractor.service.js';

function escapePdfLiteral(text: string): string {
  return text
    .replaceAll('\\', '\\\\')
    .replaceAll('(', '\\(')
    .replaceAll(')', '\\)');
}

/**
 * Generates a valid minimal PDF 1.4 binary containing the provided text per page.
 */
function buildTestPdf(pageTexts: string[]): Uint8Array {
  const objects: string[] = [];

  // 1: Catalog, 2: Pages, 3: Font
  const pageCount = pageTexts.length;
  const firstPageObjNum = 4;
  const pageObjNums: number[] = [];

  for (let i = 0; i < pageCount; i += 1) {
    pageObjNums.push(firstPageObjNum + i * 2);
  }

  objects.push('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');
  objects.push(
    `2 0 obj\n<< /Type /Pages /Kids [${pageObjNums.map((n) => `${n} 0 R`).join(' ')}] /Count ${pageCount} >>\nendobj\n`,
  );
  objects.push(
    '3 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n',
  );

  for (let i = 0; i < pageCount; i += 1) {
    const pageObjNum = firstPageObjNum + i * 2;
    const contentObjNum = pageObjNum + 1;
    const rawText = pageTexts[i] ?? '';
    const streamBody = rawText
      ? `BT\n/F1 12 Tf\n72 720 Td\n(${escapePdfLiteral(rawText)}) Tj\nET`
      : '';

    objects.push(
      `${pageObjNum} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentObjNum} 0 R >>\nendobj\n`,
    );
    objects.push(
      `${contentObjNum} 0 obj\n<< /Length ${Buffer.byteLength(streamBody, 'utf8')} >>\nstream\n${streamBody}\nendstream\nendobj\n`,
    );
  }

  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [0];

  for (const obj of objects) {
    offsets.push(Buffer.byteLength(pdf, 'utf8'));
    pdf += obj;
  }

  const xrefOffset = Buffer.byteLength(pdf, 'utf8');
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += '0000000000 65535 f \n';
  for (let i = 1; i < offsets.length; i += 1) {
    const offset = String(offsets[i] ?? 0).padStart(10, '0');
    pdf += `${offset} 00000 n \n`;
  }

  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;

  return new Uint8Array(Buffer.from(pdf, 'utf8'));
}

describe('pdf-extractor.service', () => {
  it('validates %PDF- magic bytes', () => {
    expect(hasPdfMagicBytes(Buffer.from('%PDF-1.7\n'))).toBe(true);
    expect(hasPdfMagicBytes(Buffer.from('<html>not pdf</html>'))).toBe(false);
    expect(hasPdfMagicBytes(Buffer.from('%PDF'))).toBe(false);
  });

  it('normalizes whitespace and strips null bytes', () => {
    const normalized = normalizeExtractedText(
      'Hello\u0000   world\r\n\r\n\r\nPage   two\tline ',
    );
    expect(normalized).toBe('Hello world\n\nPage two line');
  });

  it('extracts multi-page text while preserving 1-based page numbers', async () => {
    const pdfBytes = buildTestPdf([
      'First page safety manual content.',
      'Second page maintenance checklist.',
      'Third page escalation procedures.',
    ]);

    const extractor = new UnpdfTextExtractor();
    const result = await extractor.extract(pdfBytes);

    expect(result.totalPages).toBe(3);
    expect(result.pages).toHaveLength(3);
    expect(result.pages[0]).toEqual({
      pageNumber: 1,
      text: expect.stringContaining('First page safety manual content.'),
    });
    expect(result.pages[1]).toEqual({
      pageNumber: 2,
      text: expect.stringContaining('Second page maintenance checklist.'),
    });
    expect(result.pages[2]).toEqual({
      pageNumber: 3,
      text: expect.stringContaining('Third page escalation procedures.'),
    });
  });

  it('throws non-retryable PdfExtractionError for non-PDF payload', async () => {
    const extractor = new UnpdfTextExtractor();
    try {
      await extractor.extract(new Uint8Array(Buffer.from('not a pdf')));
      expect.unreachable('Expected PdfExtractionError');
    } catch (error) {
      expect(error).toBeInstanceOf(PdfExtractionError);
      expect((error as PdfExtractionError).retryable).toBe(false);
    }
  });

  it('throws non-retryable PdfExtractionError for corrupt PDF bytes', async () => {
    const extractor = new UnpdfTextExtractor();
    try {
      await extractor.extract(
        new Uint8Array(Buffer.from('%PDF-1.4\ncorrupted-garbage')),
      );
      expect.unreachable('Expected PdfExtractionError');
    } catch (error) {
      expect(error).toBeInstanceOf(PdfExtractionError);
      expect((error as PdfExtractionError).retryable).toBe(false);
    }
  });

  it('throws non-retryable PdfExtractionError when PDF has no extractable text', async () => {
    const blankPdf = buildTestPdf(['']);
    const extractor = new UnpdfTextExtractor();
    try {
      await extractor.extract(blankPdf);
      expect.unreachable('Expected PdfExtractionError');
    } catch (error) {
      expect(error).toBeInstanceOf(PdfExtractionError);
      expect((error as PdfExtractionError).retryable).toBe(false);
      expect((error as PdfExtractionError).message).toContain(
        'no extractable text',
      );
    }
  });
});
