# RAG Retrieval Benchmark Report

- Generated at: `2026-11-26T01:45:34.032Z`
- Dataset version: `1.0.0` (7 cases, `topK = 3`)

| Strategy | Precision@3 | Recall@3 | MRR | HitRate@3 | Avg Latency (ms) |
| --- | ---: | ---: | ---: | ---: | ---: |
| `lexical` | 0.7857 | 1.0000 | 0.7857 | 1.0000 | 3.88 |
| `semantic` | 0.8571 | 1.0000 | 0.8571 | 1.0000 | 2.04 |
| `hybrid` | 0.7857 | 1.0000 | 0.8571 | 1.0000 | 4.40 |

## Per-Case Breakdown (`hybrid` vs `lexical`)

| Case ID | Lexical Recall@3 | Lexical MRR | Hybrid Recall@3 | Hybrid MRR |
| --- | ---: | ---: | ---: | ---: |
| `pt-shirt-natural-question` | 1.00 | 1.00 | 1.00 | 1.00 |
| `pt-shirt-plural-inflection` | 1.00 | 1.00 | 1.00 | 1.00 |
| `pt-belt-material` | 1.00 | 0.50 | 1.00 | 1.00 |
| `pt-weigh-in-duration` | 1.00 | 1.00 | 1.00 | 1.00 |
| `en-exact-code-lookup` | 1.00 | 1.00 | 1.00 | 1.00 |
| `en-rls-policy-lookup` | 1.00 | 1.00 | 1.00 | 1.00 |
| `negative-unanswerable` | 1.00 | 0.00 | 1.00 | 0.00 |
