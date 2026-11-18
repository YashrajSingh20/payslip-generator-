#!/usr/bin/env bash
# Creates or updates the payroll API stack (production, deployed from main).
#
# First run is two-phase, like the Team Portal: the stack is created without
# App Runner, CodeBuild pushes the first image (running migrations on the way),
# then the stack is updated to create App Runner from that image. Later runs only
# change infrastructure; code deploys happen on every push to DEPLOY_BRANCH.
#
#   bash backend/infra/deploy.sh
set -euo pipefail

AWS_REGION="${AWS_REGION:-ap-south-1}"
ENVIRONMENT=prod
DEPLOY_BRANCH="${DEPLOY_BRANCH:-main}"
STACK_NAME="${STACK_NAME:-keystone-payroll-${ENVIRONMENT}-api}"
TEMPLATE_FILE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/template.yml"

for name in GITHUB_REPOSITORY_URL GITHUB_CONNECTION_ARN FRONTEND_ORIGIN VPC_ID SUBNET_IDS GMAIL_OAUTH_CLIENT_ID GMAIL_SENDER_EMAIL; do
  [[ -n "${!name:-}" ]] || { echo "$name is required" >&2; exit 1; }
done

# The API and migration job read these at runtime; the stack never sees the values.
for parameter in database-url database-admin-url jwt-secret gmail-oauth-client-secret gmail-oauth-refresh-token team-portal-sync-token; do
  if ! aws ssm get-parameter --region "$AWS_REGION" --name "/keystone-payroll/${ENVIRONMENT}/${parameter}" >/dev/null 2>&1; then
    echo "Missing SSM SecureString /keystone-payroll/${ENVIRONMENT}/${parameter} (see docs/DEPLOYMENT.md)" >&2
    exit 1
  fi
done

stack_output() {
  aws cloudformation describe-stacks --region "$AWS_REGION" --stack-name "$STACK_NAME" \
    --query "Stacks[0].Outputs[?OutputKey=='$1'].OutputValue | [0]" --output text 2>/dev/null || true
}

deploy_stack() {
  aws cloudformation deploy \
    --region "$AWS_REGION" \
    --stack-name "$STACK_NAME" \
    --template-file "$TEMPLATE_FILE" \
    --capabilities CAPABILITY_NAMED_IAM \
    --no-fail-on-empty-changeset \
    --parameter-overrides \
      Environment="$ENVIRONMENT" \
      GitHubRepositoryUrl="$GITHUB_REPOSITORY_URL" \
      GitHubConnectionArn="$GITHUB_CONNECTION_ARN" \
      DeployBranch="$DEPLOY_BRANCH" \
      EnableService="$1" \
      InitialImageTag="$2" \
      FrontendOrigin="$FRONTEND_ORIGIN" \
      VpcId="$VPC_ID" \
      SubnetIds="$SUBNET_IDS" \
      DatabaseSecurityGroupId="${DATABASE_SECURITY_GROUP_ID:-}" \
      GmailOAuthClientId="$GMAIL_OAUTH_CLIENT_ID" \
      GmailSenderEmail="$GMAIL_SENDER_EMAIL" \
      GmailSenderName="${GMAIL_SENDER_NAME:-Keystone Commerce Payroll}" \
      TeamPortalOrigin="${TEAM_PORTAL_ORIGIN:-}"
}

service_arn="$(stack_output AppRunnerServiceArn)"
if [[ -n "$service_arn" && "$service_arn" != "None" ]]; then
  # Keep whatever image is live; CodeBuild owns the image between stack changes.
  current_tag="$(aws apprunner describe-service --region "$AWS_REGION" --service-arn "$service_arn" \
    --query 'Service.SourceConfiguration.ImageRepository.ImageIdentifier' --output text)"
  deploy_stack true "${current_tag##*:}"
  echo "Stack updated. Service: $(stack_output AppRunnerServiceUrl)"
  exit 0
fi

echo "Phase 1: ECR, CodeBuild and the migration job"
deploy_stack false bootstrap
project="$(stack_output CodeBuildProjectName)"

echo "Building ${DEPLOY_BRANCH} (tests, image, migrations)"
build_id="$(aws codebuild start-build --region "$AWS_REGION" --project-name "$project" \
  --source-version "refs/heads/${DEPLOY_BRANCH}" --query build.id --output text)"
deadline=$((SECONDS + 1800))
while (( SECONDS < deadline )); do
  status="$(aws codebuild batch-get-builds --region "$AWS_REGION" --ids "$build_id" --query 'builds[0].buildStatus' --output text)"
  case "$status" in
    SUCCEEDED) break ;;
    IN_PROGRESS) sleep 15 ;;
    *) echo "Build failed: $status ($build_id)" >&2; exit 1 ;;
  esac
done
[[ "${status:-}" == "SUCCEEDED" ]] || { echo "Timed out waiting for $build_id" >&2; exit 1; }

image_tag="$(aws codebuild batch-get-builds --region "$AWS_REGION" --ids "$build_id" --query 'builds[0].resolvedSourceVersion' --output text)"
echo "Phase 2: App Runner from ${image_tag}"
deploy_stack true "$image_tag"

url="$(stack_output AppRunnerServiceUrl)"
curl --fail --silent --show-error --retry 8 --retry-all-errors --retry-delay 5 "${url}/healthz" >/dev/null
echo "Healthy: ${url}"
echo "Set BACKEND_ORIGIN=${url} on the payroll Vercel project."
