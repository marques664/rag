# RAG Evaluation & Benchmark Suite

This directory contains reproducible evaluation datasets and scripts for Sprint 5 (Retrieval Strategy Comparison) and Sprint 7 (RAGAS Quality Evaluation).

## 1. Retrieval Benchmark (Node.js + PostgreSQL `pgvector` & GIN FTS)

Runs `HybridRetrievalService` (`lexical`, `semantic`, `hybrid`) + `HybridLexicalReranker` against `enterprise_knowledge_ai_test` and computes `Precision@K`, `Recall@K`, `MRR`, `HitRate@K`, and latency:

```bash
pnpm build
node evaluation/run_benchmark.mjs
```

Outputs:
- `evaluation/BENCHMARK_REPORT.md`
- `evaluation/benchmark-results.json`

## 2. RAGAS Quality Evaluation (Python)

Evaluates `faithfulness`, `answer_relevancy`, `context_precision`, and `context_recall` using the configured Groq LLM (`qwen/qwen3.8-27b` by default):

```bash
pip install ragas datasets langchain-openai
python evaluation/evaluate_ragas.py
```
