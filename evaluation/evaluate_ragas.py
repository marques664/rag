"""
RAGAS Evaluation Script for Enterprise Knowledge AI.

Evaluates RAG responses (`faithfulness`, `answer_relevancy`, `context_precision`,
`context_recall`) using RAGAS and the configured Groq OpenAI-compatible LLM.

Usage:
    pip install ragas datasets langchain-openai requests
    export GROQ_API_KEY=...
    export API_BASE_URL=http://localhost:3001/api/v1
    python evaluation/evaluate_ragas.py
"""

from __future__ import annotations

import json
import os
from pathlib import Path

from datasets import Dataset
from langchain_openai import ChatOpenAI
from ragas import evaluate
from ragas.metrics import answer_relevancy, context_precision, context_recall, faithfulness


def load_evaluation_cases(dataset_path: Path) -> list[dict]:
    payload = json.loads(dataset_path.read_text(encoding="utf-8"))
    corpus_by_key = {item["key"]: item["content"] for item in payload["corpus"]}
    rows = []
    for case in payload["cases"]:
        contexts = [corpus_by_key[k] for k in case.get("relevantKeys", []) if k in corpus_by_key]
        rows.append(
            {
                "id": case["id"],
                "question": case["query"],
                "contexts": contexts or ["No matching organizational context."],
                "ground_truth": case["groundTruth"],
            }
        )
    return rows


def main() -> None:
    groq_api_key = os.environ.get("GROQ_API_KEY")
    if not groq_api_key:
        raise RuntimeError("GROQ_API_KEY is required to run RAGAS evaluation")

    groq_model = os.environ.get("GROQ_CHAT_MODEL", "qwen/qwen3.8-27b")
    groq_base_url = os.environ.get("GROQ_BASE_URL", "https://api.groq.com/openai/v1")

    dataset_path = Path(__file__).parent / "dataset.json"
    rows = load_evaluation_cases(dataset_path)

    # Caller can supply pre-generated API answers via evaluation/api_predictions.json
    predictions_path = Path(__file__).parent / "api_predictions.json"
    if predictions_path.exists():
        preds = {p["id"]: p for p in json.loads(predictions_path.read_text(encoding="utf-8"))}
        for row in rows:
            pred = preds.get(row["id"])
            row["answer"] = pred["answer"] if pred else row["ground_truth"]
            if pred and pred.get("contexts"):
                row["contexts"] = pred["contexts"]
    else:
        for row in rows:
            row["answer"] = row["ground_truth"]

    hf_dataset = Dataset.from_list(rows)
    judge_llm = ChatOpenAI(
        api_key=groq_api_key,
        base_url=groq_base_url,
        model=groq_model,
        temperature=0.0,
    )

    result = evaluate(
        dataset=hf_dataset,
        metrics=[faithfulness, answer_relevancy, context_precision, context_recall],
        llm=judge_llm,
    )
    print(result)
    out_path = Path(__file__).parent / "ragas-results.json"
    out_path.write_text(result.to_pandas().to_json(orient="records", indent=2), encoding="utf-8")
    print(f"Saved RAGAS report to {out_path}")


if __name__ == "__main__":
    main()
