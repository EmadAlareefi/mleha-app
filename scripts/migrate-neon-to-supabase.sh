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

get_first_env_value() {
  local value
  for key in "$@"; do
    value="$(get_env_value "$key")"
    if [[ -n "$value" ]]; then
      printf '%s\n' "$value"
      return
    fi
  done
}

SOURCE_URL="$(get_first_env_value "NEON_DATABASE_URL_UNPOOLED" "NEON_DATABASE_URL" "DATABASE_URL")"
TARGET_URL="$(get_first_env_value "SUPABASE_DIRECT_URL" "SUPABASE_DATABASE_URL" "SUPABASE_DATABASE_POOL_URL")"

if [[ -z "$SOURCE_URL" ]]; then
  echo "❌ Missing NEON_DATABASE_URL_UNPOOLED / NEON_DATABASE_URL / DATABASE_URL in ${ENV_FILE}" >&2
  exit 1
fi

if [[ -z "$TARGET_URL" ]]; then
  echo "❌ Missing SUPABASE_DIRECT_URL / SUPABASE_DATABASE_URL / SUPABASE_DATABASE_POOL_URL in ${ENV_FILE}" >&2
  exit 1
fi

PG_DUMP_BIN="${PG_DUMP_BIN:-pg_dump}"
PSQL_BIN="${PSQL_BIN:-psql}"

normalize_win_path() {
  local path="$1"
  if [[ -z "$path" ]]; then
    return
  fi

  # Strip wrapping quotes from Windows-style paths
  if [[ "${path:0:1}" == "\"" && "${path: -1}" == "\"" ]]; then
    path="${path:1:-1}"
  fi

  # Convert C:\foo\bar paths to /mnt/c/foo/bar for bash
  if [[ "$path" =~ ^([A-Za-z]):\\ ]]; then
    local drive_letter="${BASH_REMATCH[1]}"
    local drive_lower="$(tr '[:upper:]' '[:lower:]' <<<"$drive_letter")"
    local rest="${path:2}"
    rest="${rest//\\//}"
    rest="${rest#/}"

    if [[ -d "/mnt/${drive_lower}" ]]; then
      # WSL path format (/mnt/c/...)
      path="/mnt/${drive_lower}/${rest}"
    else
      # Git Bash/MSYS path format (/c/...)
      path="/${drive_lower}/${rest}"
    fi
  fi

  printf '%s\n' "$path"
}

PG_DUMP_BIN="$(normalize_win_path "$PG_DUMP_BIN")"
PSQL_BIN="$(normalize_win_path "$PSQL_BIN")"

if ! command -v "$PG_DUMP_BIN" >/dev/null 2>&1; then
  echo "❌ ${PG_DUMP_BIN} not found. Install PostgreSQL client tools and retry (set PG_DUMP_BIN to the full path if needed)." >&2
  exit 1
fi

PG_DUMP_VERSION="$("$PG_DUMP_BIN" --version | awk '{print $3}')"
if [[ "$PG_DUMP_VERSION" =~ ^([0-9]+)\. ]]; then
  PG_DUMP_MAJOR="${BASH_REMATCH[1]}"
else
  PG_DUMP_MAJOR="$PG_DUMP_VERSION"
fi

if [[ "$PG_DUMP_MAJOR" -lt 17 ]]; then
  echo "❌ ${PG_DUMP_BIN} is version ${PG_DUMP_VERSION}. Neon currently runs Postgres 17, so install pg_dump 17+ (e.g., 'sudo apt install postgresql-client-17') or point PG_DUMP_BIN at a newer binary." >&2
  exit 1
fi

if ! command -v "$PSQL_BIN" >/dev/null 2>&1; then
  echo "❌ ${PSQL_BIN} not found. Install PostgreSQL client tools and retry (set PSQL_BIN to the full path if needed)." >&2
  exit 1
fi

mkdir -p "$TMP_DIR"

echo "${BOLD}Creating Neon dump:${RESET} $DUMP_FILE"
"$PG_DUMP_BIN" \
  --no-owner \
  --no-privileges \
  --format=plain \
  "$SOURCE_URL" > "$DUMP_FILE"

echo "${BOLD}Restoring dump into Supabase...${RESET}"
if ! "$PSQL_BIN" "$TARGET_URL" < "$DUMP_FILE"; then
  echo "❌ Restore failed. Leaving dump at $DUMP_FILE for manual inspection." >&2
  exit 1
fi

echo "${BOLD}Done.${RESET} Supabase now contains the Neon snapshot from $TIMESTAMP."
echo "Dump retained at: $DUMP_FILE"
