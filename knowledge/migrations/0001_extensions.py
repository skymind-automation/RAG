"""Extensions and the SQL functions the schema depends on.

Split out ahead of the tables because a GENERATED column's expression must
already exist when the column is created, and the `vector` type must exist
before any column can be declared with it.
"""
from django.contrib.postgres.operations import BtreeGinExtension, TrigramExtension
from django.db import migrations
from pgvector.django import VectorExtension

# `array_to_string` is only STABLE -- it routes through type output functions --
# and a GENERATED column requires IMMUTABLE. Pinning the element type to text
# makes the immutable claim true rather than merely asserted.
IMMUTABLE_ARRAY_TO_STRING = """
CREATE OR REPLACE FUNCTION rag_immutable_array_to_string(text[], text)
RETURNS text AS $$ SELECT array_to_string($1, $2) $$
LANGUAGE sql IMMUTABLE PARALLEL SAFE;
"""

# The lexical index definition, in one place.
#
# Weighting is the whole point of this function. A query term that matches a
# procedure heading, a TSB number, a DTC code or a symptom keyword is a much
# stronger signal than the same term appearing somewhere in a torque table, so
# those go in at weight A and the body at weight B. `ts_rank_cd` then reflects
# that without any application-side scoring.
CHUNK_SEARCH_VECTOR = """
CREATE OR REPLACE FUNCTION rag_chunk_search_vector(
    heading_path text[],
    content text,
    dtc_codes text[],
    symptom_keywords text[],
    tsb_number text
) RETURNS tsvector AS $$
    SELECT
        setweight(to_tsvector('english',
            coalesce(rag_immutable_array_to_string($1, ' '), '')), 'A')
     || setweight(to_tsvector('english',
            coalesce(rag_immutable_array_to_string($3, ' '), '')), 'A')
     || setweight(to_tsvector('english',
            coalesce(rag_immutable_array_to_string($4, ' '), '')), 'A')
     || setweight(to_tsvector('english', coalesce($5, '')), 'A')
     || setweight(to_tsvector('english', coalesce($2, '')), 'B')
$$ LANGUAGE sql IMMUTABLE PARALLEL SAFE;
"""

DROP_FUNCTIONS = """
DROP FUNCTION IF EXISTS rag_chunk_search_vector(text[], text, text[], text[], text);
DROP FUNCTION IF EXISTS rag_immutable_array_to_string(text[], text);
"""


class Migration(migrations.Migration):

    initial = True
    dependencies = []

    operations = [
        VectorExtension(),
        BtreeGinExtension(),
        TrigramExtension(),
        migrations.RunSQL(IMMUTABLE_ARRAY_TO_STRING, migrations.RunSQL.noop),
        migrations.RunSQL(CHUNK_SEARCH_VECTOR, DROP_FUNCTIONS),
    ]
