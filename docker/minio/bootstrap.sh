#!/bin/sh
# §23 — ensures a fresh clone plus `docker compose up` is a working
# environment: creates the bucket, applies the CORS rule, and creates a
# bucket-scoped service account (root credentials are console-only, §23).
# Belt-and-braces alongside BucketBootstrapService, which does the same at
# app boot — this script should not be the only thing standing between a
# fresh clone and a working bucket.
set -e

mc alias set local http://minio:9000 reelcraft-root reelcraft-root-secret
mc mb --ignore-existing local/video-engine

cat > /tmp/cors.json <<-EOF
{
  "CORSRules": [
    {
      "AllowedOrigin": ["*"],
      "AllowedMethod": ["GET", "HEAD"],
      "AllowedHeader": ["Range", "Content-Type"],
      "ExposeHeader": ["Content-Length", "Content-Range", "ETag"]
    }
  ]
}
EOF
mc anonymous set-json /tmp/cors.json local/video-engine || true

# Scoped service account limited to this bucket. Fixed dev credentials so
# .env.example can reference them directly; rotate for anything beyond
# local development.
mc admin user add local reelcraft-app reelcraft-app-secret || true
cat > /tmp/policy.json <<-EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["s3:*"],
      "Resource": ["arn:aws:s3:::video-engine", "arn:aws:s3:::video-engine/*"]
    }
  ]
}
EOF
mc admin policy create local video-engine-rw /tmp/policy.json || true
mc admin policy attach local video-engine-rw --user reelcraft-app || true

echo "MinIO bootstrap complete."
