"""Heading-aware chunking.

Rules, in priority order:

1. Split on procedure/section headings, never on a fixed token count.
2. Never split inside a markdown table or a fenced code block. A half-table is
   worse than no table -- it retrieves as plausible-looking wrong torque specs.
3. Oversized sections split at paragraph boundaries and repeat the heading
   breadcrumb, so each piece still says what procedure it belongs to.
4. Tiny sections (a bare heading, a one-line stub) merge forward into the next
   sibling rather than becoming their own near-empty chunk.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field

HEADING_RE = re.compile(r"^(#{1,6})\s+(.*\S)\s*$")
FENCE_RE = re.compile(r"^\s*(```|~~~)")
TABLE_ROW_RE = re.compile(r"^\s*\|.*\|\s*$")
TABLE_SEP_RE = re.compile(r"^\s*\|[\s:|-]+\|\s*$")


@dataclass
class Section:
    """A heading and the body directly under it."""

    heading_path: list[str]
    lines: list[str] = field(default_factory=list)

    @property
    def body(self) -> str:
        return "\n".join(self.lines).strip()


@dataclass
class TextChunk:
    heading_path: list[str]
    content: str
    contains_table: bool
    # True once this chunk has absorbed a sibling and been re-labelled with
    # the shared parent heading. See `_merge_runts` for why that must stop
    # further merges.
    relabelled: bool = False

    @property
    def chars(self) -> int:
        return len(self.content)


def split_sections(markdown: str) -> list[Section]:
    """Walk the document, maintaining a heading breadcrumb."""
    sections: list[Section] = []
    stack: list[tuple[int, str]] = []  # (level, title)
    current = Section(heading_path=[])
    in_fence = False

    for line in markdown.splitlines():
        if FENCE_RE.match(line):
            in_fence = not in_fence
            current.lines.append(line)
            continue

        match = None if in_fence else HEADING_RE.match(line)
        if match:
            if current.lines or current.heading_path:
                sections.append(current)
            level = len(match.group(1))
            title = match.group(2).strip()
            while stack and stack[-1][0] >= level:
                stack.pop()
            stack.append((level, title))
            current = Section(heading_path=[t for _, t in stack])
        else:
            current.lines.append(line)

    if current.lines or current.heading_path:
        sections.append(current)
    return [s for s in sections if s.body or s.heading_path]


def _atomic_blocks(body: str) -> list[tuple[str, bool]]:
    """Break a body into blocks that must never be split internally.

    Returns (text, is_table) pairs. A markdown table or fenced block is one
    atomic block however long it is; prose splits at blank lines.
    """
    blocks: list[tuple[str, bool]] = []
    buf: list[str] = []
    mode = "prose"  # prose | table | fence

    def flush(is_table: bool = False):
        nonlocal buf
        text = "\n".join(buf).strip("\n")
        if text.strip():
            blocks.append((text, is_table))
        buf = []

    for line in body.splitlines():
        if mode == "fence":
            buf.append(line)
            if FENCE_RE.match(line):
                flush(is_table=True)
                mode = "prose"
            continue

        if FENCE_RE.match(line):
            flush(mode == "table")
            mode = "fence"
            buf.append(line)
            continue

        is_row = bool(TABLE_ROW_RE.match(line) or TABLE_SEP_RE.match(line))
        if mode == "table":
            if is_row:
                buf.append(line)
            else:
                flush(is_table=True)
                mode = "prose"
                if line.strip():
                    buf.append(line)
            continue

        if is_row:
            flush()
            mode = "table"
            buf.append(line)
            continue

        if not line.strip():
            flush()
        else:
            buf.append(line)

    flush(mode == "table")
    return blocks


def chunk_markdown(
    markdown: str,
    max_chars: int = 2400,
    min_chars: int = 120,
    single_chunk: bool = False,
) -> list[TextChunk]:
    """Chunk a markdown document.

    `single_chunk=True` is the TSB path: one bulletin is one chunk regardless
    of length, because the whole symptom -> cause -> fix narrative is the unit
    an advisor needs.
    """
    if single_chunk:
        text = markdown.strip()
        if not text:
            return []
        return [
            TextChunk(
                heading_path=[],
                content=text,
                contains_table=any(TABLE_ROW_RE.match(l) for l in text.splitlines()),
            )
        ]

    chunks: list[TextChunk] = []
    for section in split_sections(markdown):
        body = section.body
        if not body:
            continue
        blocks = _atomic_blocks(body)
        if not blocks:
            continue

        buf: list[str] = []
        buf_has_table = False
        buf_len = 0

        def emit():
            nonlocal buf, buf_has_table, buf_len
            if buf:
                chunks.append(
                    TextChunk(
                        heading_path=list(section.heading_path),
                        content="\n\n".join(buf).strip(),
                        contains_table=buf_has_table,
                    )
                )
            buf, buf_has_table, buf_len = [], False, 0

        for text, is_table in blocks:
            # An atomic block bigger than the budget gets its own chunk rather
            # than being cut in half.
            if buf_len and buf_len + len(text) > max_chars:
                emit()
            buf.append(text)
            buf_has_table = buf_has_table or is_table
            buf_len += len(text) + 2
        emit()

    return _merge_runts(chunks, min_chars, max_chars)


def _merge_runts(chunks: list[TextChunk], min_chars: int, max_chars: int) -> list[TextChunk]:
    """Fold a chunk below `min_chars` into the previous one -- but only when
    the two are siblings under the same parent heading.

    Sharing merely a top-level ancestor is not enough. Every section of a
    manual shares the document title, so an ancestor test merges "Brake System
    Overview" into "Front Brake Pad Replacement > Removal" and produces one
    chunk that answers neither question.

    When siblings are merged, the chunk is re-labelled with the shared parent
    and each part's own heading is re-inserted into the body, so nothing that
    was in the document is lost from the index or from the citation.
    """
    merged: list[TextChunk] = []
    for chunk in chunks:
        prev = merged[-1] if merged else None
        if (
            prev is not None
            and chunk.chars < min_chars
            and prev.chars + chunk.chars <= max_chars
            and _are_siblings(prev.heading_path, chunk.heading_path)
            # A relabelled chunk sits one level shallower than it started,
            # which makes it a sibling of the *next* level up. Allowing it to
            # merge again cascades: each merge shortens the path, so the
            # chunks walk their way back up to the document title and every
            # section ends up in one chunk labelled with the manual's name.
            and not (prev.relabelled and prev.heading_path != chunk.heading_path)
        ):
            merged[-1] = _merge_pair(prev, chunk)
        else:
            merged.append(chunk)
    return merged


def _merge_pair(prev: TextChunk, chunk: TextChunk) -> TextChunk:
    if prev.heading_path == chunk.heading_path:
        return TextChunk(
            heading_path=prev.heading_path,
            content=f"{prev.content}\n\n{chunk.content}",
            contains_table=prev.contains_table or chunk.contains_table,
            relabelled=prev.relabelled,
        )

    parent = prev.heading_path[:-1]
    level = "#" * min(6, len(parent) + 1)
    body = (
        f"{level} {prev.heading_path[-1]}\n\n{prev.content}\n\n"
        f"{level} {chunk.heading_path[-1]}\n\n{chunk.content}"
    )
    return TextChunk(
        heading_path=parent,
        content=body,
        contains_table=prev.contains_table or chunk.contains_table,
        relabelled=True,
    )


def _are_siblings(a: list[str], b: list[str]) -> bool:
    """Same parent, and both actually have a heading to be a sibling of."""
    return bool(a) and bool(b) and a[:-1] == b[:-1]


def render_for_embedding(heading_path: list[str], content: str) -> str:
    """Text actually sent to the embedding model.

    The heading breadcrumb is prepended because a chunk body often never
    repeats its own subject -- a "Torque Specifications" table under
    "Front Brake Rotor Replacement" contains neither word.
    """
    if not heading_path:
        return content
    return f"{' > '.join(heading_path)}\n\n{content}"
