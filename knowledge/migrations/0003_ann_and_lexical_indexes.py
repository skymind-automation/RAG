"""Indexes the ORM cannot express: GIN over the generated tsvector, a trigram
index on raw content, and HNSW approximate-nearest-neighbour indexes.

HNSW rather than IVFFlat: HNSW needs no training pass over existing data, so a
freshly-ingested corpus is searchable immediately, and it holds recall better
as the corpus grows. m=16 / ef_construction=64 are the pgvector defaults and
are appropriate well past the size this corpus will reach.

`vector_cosine_ops` must match the CosineDistance used at query time. An L2
index here would be silently ignored by a cosine query -- the results would
still be correct, just computed by a sequential scan, which is the kind of
regression that only shows up as latency under load.
"""
from django.db import migrations

INDEX_SQL = """
CREATE INDEX IF NOT EXISTS ix_chunk_search_vector
    ON rag_chunks USING GIN (search_vector);

-- Trigram index on the raw body. Catches part numbers, TSB numbers and
-- misspelled model names that the english stemmer reduces to nothing useful.
CREATE INDEX IF NOT EXISTS ix_chunk_content_trgm
    ON rag_chunks USING GIN (content gin_trgm_ops);

CREATE INDEX IF NOT EXISTS ix_chunk_embedding_hnsw
    ON rag_chunks USING hnsw (embedding vector_cosine_ops)
    WITH (m = 16, ef_construction = 64);

CREATE INDEX IF NOT EXISTS ix_dtc_description_hnsw
    ON rag_dtc_codes USING hnsw (description_embedding vector_cosine_ops)
    WITH (m = 16, ef_construction = 64);

-- Prefix scans for the DTC family fallback (P0301 -> the P030x family).
CREATE INDEX IF NOT EXISTS ix_dtc_code_prefix
    ON rag_dtc_codes (code text_pattern_ops);
"""

REVERSE_SQL = """
DROP INDEX IF EXISTS ix_chunk_search_vector;
DROP INDEX IF EXISTS ix_chunk_content_trgm;
DROP INDEX IF EXISTS ix_chunk_embedding_hnsw;
DROP INDEX IF EXISTS ix_dtc_description_hnsw;
DROP INDEX IF EXISTS ix_dtc_code_prefix;
"""


class Migration(migrations.Migration):

    dependencies = [("knowledge", "0002_initial")]

    operations = [migrations.RunSQL(INDEX_SQL, REVERSE_SQL)]
