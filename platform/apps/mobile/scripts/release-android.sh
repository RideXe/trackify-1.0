#!/usr/bin/env bash
# Builds the Android driver app and publishes it for the dashboard's "Driver app" button.
#
#   npm run release:android -w @trackify/mobile
#
# Run it yourself, with AWS access for the account (profile "bgt" unless AWS_PROFILE is set).
# Before each release, raise versionCode in android/app/build.gradle: phones only update over the
# installed app when it is higher, so the script refuses a versionCode that is not.
set -euo pipefail

ENVIRONMENT="${TRACKIFY_ENV:-dev}"
PROFILE="${AWS_PROFILE:-bgt}"
STACK="Trackify-${ENVIRONMENT}-Api"
KEY="android/trackify-driver.apk"
# Real phones only: 64-bit, plus 32-bit for older and budget (Android Go) phones.
ARCHITECTURES="armeabi-v7a,arm64-v8a"

cd "$(dirname "$0")/../android"
GRADLE_FILE="app/build.gradle"
VERSION_CODE="$(sed -n 's/^[[:space:]]*versionCode[[:space:]]\{1,\}\([0-9]\{1,\}\).*/\1/p' "${GRADLE_FILE}" | head -n1)"
VERSION_NAME="$(sed -n 's/^[[:space:]]*versionName[[:space:]]\{1,\}"\([^"]*\)".*/\1/p' "${GRADLE_FILE}" | head -n1)"
[ -n "${VERSION_CODE}" ] && [ -n "${VERSION_NAME}" ] || { echo "Could not read versionCode/versionName from ${GRADLE_FILE}"; exit 1; }

echo "→ Finding the upload bucket (${STACK})..."
BUCKET="$(aws cloudformation describe-stacks --stack-name "${STACK}" --profile "${PROFILE}" \
  --query "Stacks[0].Outputs[?OutputKey=='DriverAppBucket'].OutputValue" --output text)"
[ -n "${BUCKET}" ] && [ "${BUCKET}" != "None" ] || { echo "No DriverAppBucket output on ${STACK}. Deploy the Api stack first."; exit 1; }

echo "→ Checking the version against the one drivers have..."
CURRENT_CODE="$(aws s3api head-object --bucket "${BUCKET}" --key "${KEY}" --profile "${PROFILE}" \
  --query 'Metadata."version-code"' --output text 2>/dev/null || echo "")"
if [ -n "${CURRENT_CODE}" ] && [ "${CURRENT_CODE}" != "None" ] && [ "${VERSION_CODE}" -le "${CURRENT_CODE}" ]; then
  echo "versionCode ${VERSION_CODE} is not higher than the published ${CURRENT_CODE}."
  echo "Raise versionCode in ${GRADLE_FILE}, then run this again."
  exit 1
fi

echo "→ Building version ${VERSION_NAME} (${VERSION_CODE}) for ${ARCHITECTURES}..."
./gradlew assembleRelease -PreactNativeArchitectures="${ARCHITECTURES}"
APK="app/build/outputs/apk/release/app-release.apk"

echo "→ Checking the signature..."
SDK="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-${HOME}/Library/Android/sdk}}"
APKSIGNER="$(ls -d "${SDK}"/build-tools/*/apksigner 2>/dev/null | sort -V | tail -n1)"
[ -n "${APKSIGNER}" ] || { echo "apksigner not found under ${SDK}/build-tools"; exit 1; }
CERTS="$("${APKSIGNER}" verify --print-certs "${APK}")"
if grep -q "CN=Android Debug" <<<"${CERTS}"; then
  echo "This build is signed with the DEBUG key: the upload keystore settings are missing from"
  echo "android/local.properties. Drivers could not update it later, so it was not published."
  exit 1
fi
echo "${CERTS}" | grep -m1 "SHA-256" || true

echo "→ Publishing to s3://${BUCKET}/${KEY}..."
aws s3 cp "${APK}" "s3://${BUCKET}/${KEY}" --profile "${PROFILE}" \
  --content-type application/vnd.android.package-archive \
  --metadata "version=${VERSION_NAME},version-code=${VERSION_CODE}"

SIZE_MB="$(( $(wc -c <"${APK}") / 1000000 ))"
echo "✓ Published Trackify driver app ${VERSION_NAME} (${VERSION_CODE}), ${SIZE_MB} MB."
echo "  The dashboard's Driver app button now hands out this version."
