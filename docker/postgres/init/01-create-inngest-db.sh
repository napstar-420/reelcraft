#!/bin/sh
# §1.2 — Inngest's durable state lives in a SEPARATE Postgres database from
# the engine's own, on the same server (one server, two databases — separate
# servers buy nothing locally and double memory).
set -e

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
    CREATE DATABASE inngest;
EOSQL
