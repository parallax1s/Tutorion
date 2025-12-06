from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable, List, Sequence

from openai import OpenAI

from .ingestion import DocumentChunk


@dataclass
class TopicSummary:
    topic: str
    rationale: str
    representative_chunks: List[DocumentChunk]


@dataclass
class QuizQuestion:
    prompt: str
    options: List[str]
    answer: str
    explanation: str


class TutorModel:
    def __init__(self, *, api_key: str | None = None, model: str = "gpt-5-mini"):
        self.client = OpenAI(api_key=api_key)
        self.model = model

    def _chat(self, messages: List[dict]) -> str:
        response = self.client.responses.create(
            model=self.model,
            input=messages,
        )
        message = response.output[0].content[0].text
        return message

    def extract_topics(self, chunks: Sequence[DocumentChunk], top_k: int = 6) -> List[TopicSummary]:
        serialized = [f"Page {c.page_number}: {c.text}" for c in chunks]
        prompt = (
            "You are a tutoring curriculum designer focused on math and science. "
            "Review the provided excerpts and propose a concise list of topics. "
            "Return JSON with fields topic and rationale, ordered from foundational to advanced."
        )
        result_text = self._chat(
            [
                {"role": "user", "content": prompt},
                {"role": "user", "content": "\n\n".join(serialized)},
            ]
        )
        try:
            parsed = json.loads(result_text)
        except json.JSONDecodeError:
            raise ValueError("Model response was not valid JSON: " + result_text)

        topics: List[TopicSummary] = []
        for entry in parsed[:top_k]:
            topics.append(
                TopicSummary(
                    topic=entry.get("topic", "Unknown topic"),
                    rationale=entry.get("rationale", ""),
                    representative_chunks=list(chunks),
                )
            )
        return topics

    def generate_quiz(self, topic: TopicSummary, difficulty: str = "intro") -> List[QuizQuestion]:
        prompt = (
            f"Create 3 multiple-choice questions for the topic '{topic.topic}'. "
            "Each question should have 4 options labeled A-D and an answer key with explanation. "
            "Difficulty should be {difficulty} level and grounded in the provided content."
        )
        doc_context = "\n\n".join(c.text for c in topic.representative_chunks[:3])
        result_text = self._chat(
            [
                {"role": "user", "content": prompt},
                {"role": "user", "content": doc_context},
            ]
        )
        try:
            parsed = json.loads(result_text)
        except json.JSONDecodeError:
            raise ValueError("Model response was not valid JSON: " + result_text)

        questions: List[QuizQuestion] = []
        for q in parsed:
            questions.append(
                QuizQuestion(
                    prompt=q.get("prompt", ""),
                    options=q.get("options", []),
                    answer=q.get("answer", ""),
                    explanation=q.get("explanation", ""),
                )
            )
        return questions


def save_topics(topics: Iterable[TopicSummary], path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    serializable = [
        {
            "topic": t.topic,
            "rationale": t.rationale,
            "source_files": list({c.source.name for c in t.representative_chunks}),
            "context_excerpt": [c.text for c in t.representative_chunks[:3]],
        }
        for t in topics
    ]
    path.write_text(json.dumps(serializable, indent=2), encoding="utf-8")


def save_quiz(questions: Iterable[QuizQuestion], path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    serializable = [
        {
            "prompt": q.prompt,
            "options": q.options,
            "answer": q.answer,
            "explanation": q.explanation,
        }
        for q in questions
    ]
    path.write_text(json.dumps(serializable, indent=2), encoding="utf-8")
