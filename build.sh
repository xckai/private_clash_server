#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

IMAGE_REPO="swr.cn-east-3.myhuaweicloud.com/xukai/private-server"
VERSION_FILE="VERSION"

if [[ ! -f "$VERSION_FILE" ]]; then
  printf '%s\n' "1.0.4" > "$VERSION_FILE"
fi

version="$(tr -d '[:space:]' < "$VERSION_FILE")"

if [[ ! "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "VERSION 格式无效: ${version}（期望 x.y.z）" >&2
  exit 1
fi

image="${IMAGE_REPO}:${version}"

echo "开始构建 ${image}"
docker build -t "$image" .

echo "开始推送 ${image}"
docker push "$image"

IFS='.' read -r major minor patch <<< "$version"
next="${major}.${minor}.$((patch + 1))"
printf '%s\n' "$next" > "$VERSION_FILE"

echo "构建完成: ${image}"
echo "下一版本已写入 ${VERSION_FILE}: ${next}"
