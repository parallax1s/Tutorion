from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable, List

from pypdf import PdfReader


@dataclass
class DocumentChunk:
    source: Path
    page_number: int
    text: str


def normalize_text(text: str) -> str:
    """Remove excessive whitespace while preserving sentence boundaries."""
    text = re.sub(r"\s+", " ", text)
    return text.strip()


def load_pdf_chunks(path: Path, max_chars: int = 1200) -> List[DocumentChunk]:
    """
    Load a PDF and chunk its text for downstream processing.

    Args:
        path: Path to the PDF file.
        max_chars: Maximum characters per chunk; chunks respect page boundaries.
    """
    reader = PdfReader(path)
    chunks: List[DocumentChunk] = []
    for page_index, page in enumerate(reader.pages, start=1):
        raw_text = page.extract_text() or ""
        clean_text = normalize_text(raw_text)
        for offset in range(0, len(clean_text), max_chars):
            segment = clean_text[offset : offset + max_chars]
            if segment:
                chunks.append(
                    DocumentChunk(
                        source=path,
                        page_number=page_index,
                        text=segment,
                    )
                )
    return chunks


def load_documents(paths: Iterable[Path], max_chars: int = 1200) -> List[DocumentChunk]:
    """Load multiple PDFs and return normalized chunks ready for analysis."""
    all_chunks: List[DocumentChunk] = []
    for path in paths:
        if path.suffix.lower() == ".pdf":
            all_chunks.extend(load_pdf_chunks(path, max_chars=max_chars))
        else:
            raise ValueError(f"Unsupported file type: {path}")
    return all_chunks
