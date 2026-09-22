"""Chunker behaviour. These are the invariants that decide retrieval quality,
so they are asserted rather than eyeballed."""
from knowledge.ingestion.chunking import chunk_markdown, split_sections

MANUAL = """
# Section 06: Brakes

Intro text under the top heading.

## Front Brake Pad Replacement

### Removal

1. Raise and support the vehicle, then remove the front wheels.
2. Remove the caliper guide pin bolts and support the caliper on a wire hook.
3. Lift the caliper away from the anchor bracket and remove the pads.
4. Inspect the rotor for scoring, heat checking and lateral runout.

### Torque Specifications

| Fastener | Torque (N·m) | Torque (lb-ft) | Notes |
| --- | --- | --- | --- |
| Guide pin bolt | 36 | 27 | Replace if stretched |
| Anchor bracket bolt | 175 | 129 | Single use |
| Lug nut | 200 | 148 | Star pattern |
| Banjo bolt | 40 | 30 | New copper washers |

## Brake Fluid

Brake fluid is hygroscopic. Replace every 36 months regardless of mileage, or
whenever measured moisture content exceeds 3%. Use DOT 4 LV only; DOT 5
silicone fluid is not compatible and will destroy the seals.
"""


def test_heading_breadcrumb_is_preserved():
    chunks = chunk_markdown(MANUAL)
    paths = [" > ".join(c.heading_path) for c in chunks]
    assert any("Front Brake Pad Replacement > Removal" in p for p in paths)
    assert any("Front Brake Pad Replacement > Torque Specifications" in p for p in paths)


def test_table_is_never_split():
    chunks = chunk_markdown(MANUAL, max_chars=80, min_chars=1)
    table_chunks = [c for c in chunks if "Guide pin" in c.content]
    assert len(table_chunks) == 1, "the table was split across chunks"
    body = table_chunks[0].content
    # All three rows must survive together, even though max_chars is far
    # below the table's length.
    assert "Guide pin bolt" in body
    assert "Anchor bracket bolt" in body
    assert "Lug nut" in body
    assert "Banjo bolt" in body
    assert table_chunks[0].contains_table


def test_tsb_is_a_single_chunk():
    chunks = chunk_markdown(MANUAL, single_chunk=True)
    assert len(chunks) == 1
    assert "Front Brake Pad Replacement" in chunks[0].content


def test_fenced_block_headings_are_not_treated_as_headings():
    markdown = "# Real\n\ntext\n\n```\n# not a heading\n```\n\nmore\n"
    sections = split_sections(markdown)
    assert [s.heading_path for s in sections] == [["Real"]]


def test_empty_document_produces_no_chunks():
    assert chunk_markdown("") == []
    assert chunk_markdown("   \n\n  ") == []


RUNTS = """
# Manual

## Procedure A

### Step one

Short.

### Step two

Also short.

## Procedure B

A completely different procedure that must not be folded into Procedure A,
because merging the two would produce a chunk that answers neither question
well and cites the wrong section for whichever half is retrieved.
"""


def test_runts_merge_only_with_siblings():
    chunks = chunk_markdown(RUNTS, min_chars=120, max_chars=2400)
    bodies = [c.content for c in chunks]

    # The two short sibling steps fold together under their shared parent...
    merged = [b for b in bodies if "Short." in b and "Also short." in b]
    assert len(merged) == 1, "sibling runts were not merged"
    # ...and keep their own headings inside the body, so nothing is lost.
    assert "Step one" in merged[0] and "Step two" in merged[0]

    # ...but Procedure B, which is not a sibling of those steps, stays separate.
    assert not any("completely different procedure" in b for b in merged)


def test_merged_siblings_are_relabelled_to_the_shared_parent():
    chunks = chunk_markdown(RUNTS, min_chars=120, max_chars=2400)
    merged = next(c for c in chunks if "Also short." in c.content)
    assert merged.heading_path == ["Manual", "Procedure A"]


def test_unrelated_sections_are_never_merged():
    chunks = chunk_markdown(MANUAL, min_chars=10_000, max_chars=2400)
    # Even with an absurd min_chars, non-siblings must stay apart.
    for chunk in chunks:
        assert not ("Intro text" in chunk.content and "Raise and support" in chunk.content)
