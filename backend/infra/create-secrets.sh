#!/usr/bin/env bash
# Stores the payroll production secrets in SSM Parameter Store (SecureString)
# under /keystone-payroll/prod/. Values come from backend/infra/production.env.
#
#   bash backend/infra/create-secrets.sh            # create missing parameters
#   FORCE=true bash backend/infra/create-secrets.sh # also overwrite existing ones
#
# - Never prints secret values.
# - Existing parameters are skipped unless FORCE=true, so re-running is safe.
# - JWT_SECRET and TEAM_PORTAL_SYNC_TOKEN are generated when left blank.
# - The sync token is kept identical on both sides: an existing Team Portal
#   token is reused, and /keystone-team-portal/prod/payroll-sync-token is created
#   when it is missing (the Team Portal needs it before its PR is merged).
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${ENV_FILE:-$HERE/production.env}"
[[ -f "$ENV_FILE" ]] || { echo "Missing $ENV_FILE (copy production.env.example and fill it in)" >&2; exit 1; }
set -a; source "$ENV_FILE"; set +a

AWS_REGION="${AWS_REGION:-ap-south-1}"
PREFIX=/keystone-payroll/prod
TEAM_PORTAL_PARAM=/keystone-team-portal/prod/payroll-sync-token
FORCE="${FORCE:-false}"

random_secret() { openssl rand -base64 48 | tr -d '\n=+/' | cut -c1-48; }

param_exists() {
  aws ssm get-parameter --region "$AWS_REGION" --name "$1" >/dev/null 2>&1
}

read_param() {
  aws ssm get-parameter --region "$AWS_REGION" --name "$1" --with-decryption \
    --query Parameter.Value --output text 2>/dev/null || true
}

put_param() {
  local name="$1" value="$2"
  if param_exists "$name" && [[ "$FORCE" != "true" ]]; then
    echo "  kept     $name (already exists)"
    return
  fi
  aws ssm put-parameter --region "$AWS_REGION" --name "$name" --type SecureString \
    --value "$value" --overwrite >/dev/null
  echo "  stored   $name"
}

require() {
  local key="$1" value="${!1:-}"
  if [[ -z "$value" || "$value" == *"<"* ]]; then
    if param_exists "$PREFIX/$2" && [[ "$FORCE" != "true" ]]; then return 0; fi
    echo "$key is required in $ENV_FILE (or create $PREFIX/$2 yourself)" >&2
    exit 1
  fi
}

require DATABASE_URL database-url
require DATABASE_ADMIN_URL database-admin-url
require GMAIL_OAUTH_CLIENT_SECRET gmail-oauth-client-secret
require GMAIL_OAUTH_REFRESH_TOKEN gmail-oauth-refresh-token

# Sync token: explicit value, else the Team Portal's, else payroll's, else new.
existing_tp="$(read_param "$TEAM_PORTAL_PARAM")"
existing_pr="$(read_param "$PREFIX/team-portal-sync-token")"
if [[ -n "$existing_tp" && -n "$existing_pr" && "$existing_tp" != "$existing_pr" && -z "${TEAM_PORTAL_SYNC_TOKEN:-}" ]]; then
  echo "The Team Portal and payroll sync tokens differ. Set TEAM_PORTAL_SYNC_TOKEN and run with FORCE=true to align them." >&2
  exit 1
fi
SYNC_TOKEN="${TEAM_PORTAL_SYNC_TOKEN:-${existing_tp:-${existing_pr:-$(random_secret)}}}"
(( ${#SYNC_TOKEN} >= 32 )) || { echo "TEAM_PORTAL_SYNC_TOKEN must be at least 32 characters" >&2; exit 1; }
JWT_SECRET="${JWT_SECRET:-}"
(( ${#JWT_SECRET} == 0 || ${#JWT_SECRET} >= 32 )) || { echo "JWT_SECRET must be at least 32 characters" >&2; exit 1; }

echo "Payroll secrets ($AWS_REGION):"
store_if_set() { # name value: skips blanks and unfilled <placeholders>
  if [[ -n "$2" && "$2" != *"<"* ]]; then put_param "$1" "$2"; fi
}
store_if_set "$PREFIX/database-url" "${DATABASE_URL:-}"
store_if_set "$PREFIX/database-admin-url" "${DATABASE_ADMIN_URL:-}"
store_if_set "$PREFIX/gmail-oauth-client-secret" "${GMAIL_OAUTH_CLIENT_SECRET:-}"
store_if_set "$PREFIX/gmail-oauth-refresh-token" "${GMAIL_OAUTH_REFRESH_TOKEN:-}"
put_param "$PREFIX/jwt-secret" "${JWT_SECRET:-$(random_secret)}"
put_param "$PREFIX/team-portal-sync-token" "$SYNC_TOKEN"

echo "Team Portal side:"
if [[ -z "$existing_tp" || "$FORCE" == "true" ]]; then
  put_param "$TEAM_PORTAL_PARAM" "$SYNC_TOKEN"
else
  echo "  kept     $TEAM_PORTAL_PARAM (already exists, payroll uses the same value)"
fi
echo "Done. Next: bash backend/infra/deploy.sh"
