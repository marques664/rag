import console from 'node:console';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import process from 'node:process';
import {
  HybridLexicalReranker,
  summarizeStrategyBenchmark,
} from '../packages/ai/dist/index.js';
import {
  createDatabaseClient,
  DocumentStatus,
  HybridRetrievalService,
  insertDocumentChunksWithEmbeddings,
} from '../packages/database/dist/index.js';
import { EMBEDDING_DIMENSIONS } from '../packages/shared/dist/index.js';

const rootEnvPath = path.resolve(import.meta.dirname, '../.env');
if (existsSync(rootEnvPath)) {
  const envRaw = await readFile(rootEnvPath, 'utf8');
  for (const line of envRaw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIndex = trimmed.indexOf('=');
    if (eqIndex <= 0) continue;
    const key = trimmed.slice(0, eqIndex).trim();
    const val = trimmed.slice(eqIndex + 1).trim().replace(/^["']|["']$/g, '');
    if (!(key in process.env)) {
      process.env[key] = val;
    }
  }
}

const TEST_DATABASE_URL =
  process.env['TEST_DATABASE_URL'] ??
  'postgresql://postgres:postgres@localhost:5432/enterprise_knowledge_ai_test?schema=public';

const TOP_K = 3;

function makeTopicVector(hotIndex) {
  const vec = new Array(EMBEDDING_DIMENSIONS).fill(0);
  if (hotIndex >= 0 && hotIndex < EMBEDDING_DIMENSIONS) {
    vec[hotIndex] = 1;
  } else {
    vec[EMBEDDING_DIMENSIONS - 1] = 1;
  }
  return vec;
}

async function main() {
  const datasetPath = path.resolve(import.meta.dirname, 'dataset.json');
  const dataset = JSON.parse(await readFile(datasetPath, 'utf8'));

  const db = createDatabaseClient(TEST_DATABASE_URL);
  await db.$connect();

  const orgSlug = `eval-bench-${randomUUID().slice(0, 8)}`;
  const org = await db.organization.create({
    data: { name: 'RAG Benchmark Organization', slug: orgSlug },
  });

  try {
    const docByFilename = new Map();
    const keyToChunkId = new Map();
    const chunkRows = [];

    for (const [index, item] of dataset.corpus.entries()) {
      let doc = docByFilename.get(item.filename);
      if (!doc) {
        doc = await db.document.create({
          data: {
            organizationId: org.id,
            filename: item.filename,
            storageKey: `eval/${org.id}/${randomUUID()}.pdf`,
            mimeType: 'application/pdf',
            fileSize: 2048,
            checksum: randomUUID().replaceAll('-', ''),
            status: DocumentStatus.COMPLETED,
            pageCount: 20,
            processedAt: new Date(),
          },
        });
        docByFilename.set(item.filename, doc);
      }

      const chunkId = randomUUID();
      keyToChunkId.set(item.key, chunkId);
      chunkRows.push({
        id: chunkId,
        documentId: doc.id,
        organizationId: org.id,
        content: item.content,
        embedding: makeTopicVector(item.topicBasisIndex),
        pageNumber: item.pageNumber,
        chunkIndex: index,
        tokenCount: item.content.split(/\s+/).length,
        metadata: {
          filename: item.filename,
          pageNumber: item.pageNumber,
          chunkIndex: index,
        },
      });
    }

    await insertDocumentChunksWithEmbeddings(db, chunkRows);

    const retrievalService = new HybridRetrievalService(db);
    const reranker = new HybridLexicalReranker();
    const evalDataset = dataset.cases.map((c) => ({
      id: c.id,
      query: c.query,
      relevantChunkIds: c.relevantKeys.map((k) => keyToChunkId.get(k)),
    }));

    const strategies = ['lexical', 'semantic', 'hybrid'];
    const summaries = [];

    for (const strategy of strategies) {
      const runs = [];
      for (const item of dataset.cases) {
        const started = performance.now();
        const retrieved = await retrievalService.retrieve({
          organizationId: org.id,
          strategy,
          queryText: item.query,
          queryEmbedding:
            strategy === 'lexical'
              ? undefined
              : makeTopicVector(item.queryBasisIndex),
          topK: TOP_K,
          minSimilarity: 0.5,
        });
        const ranked =
          retrieved.length > 0
            ? await reranker.rerank(item.query, retrieved, TOP_K)
            : [];
        const latencyMs = Number((performance.now() - started).toFixed(2));
        runs.push({
          caseId: item.id,
          retrievedChunkIds: ranked.map((c) => c.chunkId),
          latencyMs,
        });
      }

      summaries.push(
        summarizeStrategyBenchmark({
          strategy,
          topK: TOP_K,
          dataset: evalDataset,
          runs,
        }),
      );
    }

    const reportPayload = {
      generatedAt: new Date().toISOString(),
      topK: TOP_K,
      datasetVersion: dataset.version,
      caseCount: dataset.cases.length,
      summaries,
    };

    const jsonOut = path.resolve(import.meta.dirname, 'benchmark-results.json');
    await writeFile(jsonOut, JSON.stringify(reportPayload, null, 2));

    const mdLines = [
      '# RAG Retrieval Benchmark Report',
      '',
      `- Generated at: \`${reportPayload.generatedAt}\``,
      `- Dataset version: \`${reportPayload.datasetVersion}\` (${reportPayload.caseCount} cases, \`topK = ${TOP_K}\`)`,
      '',
      '| Strategy | Precision@3 | Recall@3 | MRR | HitRate@3 | Avg Latency (ms) |',
      '| --- | ---: | ---: | ---: | ---: | ---: |',
      ...summaries.map(
        (s) =>
          `| \`${s.strategy}\` | ${s.meanPrecisionAtK.toFixed(4)} | ${s.meanRecallAtK.toFixed(4)} | ${s.meanReciprocalRank.toFixed(4)} | ${s.hitRateAtK.toFixed(4)} | ${s.avgLatencyMs.toFixed(2)} |`,
      ),
      '',
      '## Per-Case Breakdown (`hybrid` vs `lexical`)',
      '',
      '| Case ID | Lexical Recall@3 | Lexical MRR | Hybrid Recall@3 | Hybrid MRR |',
      '| --- | ---: | ---: | ---: | ---: |',
      ...evalDataset.map((c, idx) => {
        const lex = summaries[0].cases[idx];
        const hyb = summaries[2].cases[idx];
        return `| \`${c.id}\` | ${lex.recallAtK.toFixed(2)} | ${lex.reciprocalRank.toFixed(2)} | ${hyb.recallAtK.toFixed(2)} | ${hyb.reciprocalRank.toFixed(2)} |`;
      }),
      '',
    ];

    const mdOut = path.resolve(import.meta.dirname, 'BENCHMARK_REPORT.md');
    await writeFile(mdOut, mdLines.join('\n'));
    console.log(mdLines.join('\n'));
  } finally {
    await db.organization.delete({ where: { id: org.id } }).catch(() => {});
    await db.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
