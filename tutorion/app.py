from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Optional

import typer

from .ingestion import load_documents
from .quiz_generator import TutorModel, save_quiz, save_topics

app = typer.Typer(help="Tutorion: generate study topics and quizzes from PDFs.")


def _get_model(api_key: Optional[str], model: str) -> TutorModel:
    key = api_key or os.getenv("OPENAI_API_KEY")
    if not key:
        raise typer.BadParameter("OPENAI_API_KEY is required")
    return TutorModel(api_key=key, model=model)


@app.command()
def topics(
    path: Path = typer.Argument(..., exists=True, readable=True),
    output: Path = typer.Option(Path("output/topics.json"), help="Where to save topic outlines."),
    model: str = typer.Option("gpt-5-mini", help="OpenAI model to use."),
    max_chars: int = typer.Option(1200, help="Chunk size when reading PDFs."),
    api_key: Optional[str] = typer.Option(None, help="OpenAI API key; defaults to env var."),
):
    """Extract topics from a PDF and write them to disk."""
    chunks = load_documents([path], max_chars=max_chars)
    tutor = _get_model(api_key, model)
    topics = tutor.extract_topics(chunks)
    save_topics(topics, output)
    typer.echo(f"Saved {len(topics)} topics to {output}")


@app.command()
def quiz(
    topics_file: Path = typer.Argument(..., exists=True, readable=True),
    output: Path = typer.Option(Path("output/quiz.json"), help="Where to save quiz questions."),
    difficulty: str = typer.Option("intro", help="Difficulty label sent to the model."),
    model: str = typer.Option("gpt-5-mini", help="OpenAI model to use."),
    api_key: Optional[str] = typer.Option(None, help="OpenAI API key; defaults to env var."),
):
    """Generate quiz questions for the first topic in a saved topics file."""
    loaded = json.loads(topics_file.read_text())
    if not loaded:
        raise typer.BadParameter("Topics file is empty")
    topic_entry = loaded[0]
    tutor = _get_model(api_key, model)
    from .ingestion import DocumentChunk
    from .quiz_generator import TopicSummary  # local import to avoid cycle

    context_excerpt = [
        DocumentChunk(source=topics_file, page_number=index + 1, text=text)
        for index, text in enumerate(topic_entry.get("context_excerpt", []))
    ]
    topic_summary = TopicSummary(
        topic=topic_entry.get("topic", "Unknown"),
        rationale=topic_entry.get("rationale", ""),
        representative_chunks=context_excerpt,
    )
    questions = tutor.generate_quiz(topic_summary, difficulty=difficulty)
    save_quiz(questions, output)
    typer.echo(f"Saved {len(questions)} questions to {output}")


if __name__ == "__main__":
    app()
