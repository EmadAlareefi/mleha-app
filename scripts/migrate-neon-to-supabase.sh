#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$ROOT_DIR/.env"
TMP_DIR="$ROOT_DIR/tmp"
TIMESTAMP="$(date +%Y%m%d_%H%M%S)"
DUMP_FILE="${TMP_DIR}/neon_dump_${TIMESTAMP}.sql"

if command -v tput >/dev/null 2>&1; then
  BOLD="$(tput bold)"
  RESET="$(tput sgr0)"
else
  BOLD=""
  RESET=""
fi

get_env_value() {
  local key="$1"
  local env_value="${!key:-}"

  if [[ -n "$env_value" ]]; then
    printf '%s\n' "$env_value"
    return
  fi

  [[ -f "$ENV_FILE" ]] || return

  while IFS= read -r line || [[ -n "$line" ]]; do
    line="${line%$'\r'}"
    line="${line#"${line%%[![:space:]]*}"}"

    [[ -z "$line" || "${line:0:1}" == "#" ]] && continue
    [[ "$line" != *=* ]] && continue

    local current_key="${line%%=*}"
    if [[ "$current_key" == "$key" ]]; then
      local value="${line#*=}"

      if [[ "${value:0:1}" == "\"" && "${value: -1}" == "\"" && "${#value}" -ge 2 ]]; then
        value="${value:1:-1}"
      elif [[ "${value:0:1}" == "'" && "${value: -1}" == "'" && "${#value}" -ge 2 ]]; then
        value="${value:1:-1}"
      fi

      printf '%s\n' "$value"
      return
    fi
  done < <(sed $'s/\r$//' "$ENV_FILE")
}

SOURCE_URL="$(get_env_value "NEON_DATABASE_URL")"
[[ -z "$SOURCE_URL" ]] && SOURCE_URL="$(get_env_value "DATABASE_URL")"
TARGET_URL="$(get_env_value "SUPABASE_DATABASE_URL")"

if [[ -z "$SOURCE_URL" ]]; then
  echo "❌ Missing NEON_DATABASE_URL or DATABASE_URL in ${ENV_FILE}" >&2
  exit 1
fi

if [[ -z "$TARGET_URL" ]]; then
  echo "❌ Missing SUPABASE_DATABASE_URL in ${ENV_FILE}" >&2
  exit 1
fi

if ! command -v pg_dump >/dev/null 2>&1; then
  echo "❌ pg_dump not found. Install PostgreSQL client tools and retry." >&2
  exit 1
fi

PG_DUMP_VERSION="$(pg_dump --version | awk '{print $3}')"
if [[ "$PG_DUMP_VERSION" =~ ^([0-9]+)\. ]]; then
  PG_DUMP_MAJOR="${BASH_REMATCH[1]}"
else
  PG_DUMP_MAJOR="$PG_DUMP_VERSION"
fi

if [[ "$PG_DUMP_MAJOR" -lt 17 ]]; then
  echo "❌ pg_dump is version ${PG_DUMP_VERSION}. Neon currently runs Postgres 17, so install pg_dump 17+ (e.g., 'sudo apt install postgresql-client-17')." >&2
  exit 1
fi

if ! command -v psql >/dev/null 2>&1; then
  echo "❌ psql not found. Install PostgreSQL client tools and retry." >&2
  exit 1
fi

mkdir -p "$TMP_DIR"

echo "${BOLD}Creating Neon dump:${RESET} $DUMP_FILE"
pg_dump \
  --no-owner \
  --no-privileges \
  --format=plain \
  "$SOURCE_URL" > "$DUMP_FILE"

echo "${BOLD}Restoring dump into Supabase...${RESET}"
if ! psql "$TARGET_URL" < "$DUMP_FILE"; then
  echo "❌ Restore failed. Leaving dump at $DUMP_FILE for manual inspection." >&2
  exit 1
fi

echo "${BOLD}Done.${RESET} Supabase now contains the Neon snapshot from $TIMESTAMP."
echo "Dump retained at: $DUMP_FILE"
