'use client';

import { useEffect, useRef } from 'react';
import type { DocumentSummary } from '@/lib/api/types';

export function hasInFlightDocuments(documents: DocumentSummary[]): boolean {
  return documents.some(
    (doc) => doc.status === 'PENDING' || doc.status === 'PROCESSING',
  );
}

export function useDocumentPolling(
  documents: DocumentSummary[],
  onPoll: () => Promise<void>,
  intervalMs = 2500,
): boolean {
  const isPolling = hasInFlightDocuments(documents);
  const pollRef = useRef(onPoll);

  useEffect(() => {
    pollRef.current = onPoll;
  }, [onPoll]);

  useEffect(() => {
    if (!isPolling) {
      return undefined;
    }

    const timer = window.setInterval(() => {
      void pollRef.current();
    }, intervalMs);

    return () => {
      window.clearInterval(timer);
    };
  }, [isPolling, intervalMs]);

  return isPolling;
}
