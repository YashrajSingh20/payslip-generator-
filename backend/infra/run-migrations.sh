#!/usr/bin/env bash
set -euo pipefail

: "${MIGRATION_PROJECT_NAME:?Migration project is required}"
: "${CODEBUILD_RESOLVED_SOURCE_VERSION:?Source commit is required}"
if [[ ! "$CODEBUILD_RESOLVED_SOURCE_VERSION" =~ ^[0-9a-f]{40}$ ]]; then
  echo "Migration source must be a full commit SHA" >&2
  exit 1
fi

build_id="$(aws codebuild start-build \
  --project-name "$MIGRATION_PROJECT_NAME" \
  --source-version "$CODEBUILD_RESOLVED_SOURCE_VERSION" \
  "$@" \
  --query build.id --output text)"
echo "Waiting for migrations: $build_id"
deadline=$((SECONDS + 1800))
while (( SECONDS < deadline )); do
  status="$(aws codebuild batch-get-builds --ids "$build_id" \
    --query 'builds[0].buildStatus' --output text)"
  case "$status" in
    SUCCEEDED) exit 0 ;;
    IN_PROGRESS) sleep 10 ;;
    *) echo "Migrations did not succeed: $status ($build_id)" >&2; exit 1 ;;
  esac
done
echo "Timed out waiting for migrations: $build_id" >&2
exit 1
