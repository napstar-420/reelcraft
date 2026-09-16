import { S3Client } from '@aws-sdk/client-s3';
import { EngineConfig } from '../config/engine-config';

/**
 * Newer @aws-sdk/client-s3 versions default to sending flexible-checksum
 * headers/trailers that MinIO's S3 API responds to with `501
 * NotImplemented` (`requestChecksumCalculation`/`responseChecksumValidation`
 * default to `WHEN_SUPPORTED`). `WHEN_REQUIRED` restores compatibility with
 * MinIO while remaining correct against real S3. Centralized here so both
 * S3StorageAdapter and BucketBootstrapService stay in sync.
 */
export function createS3Client(config: EngineConfig): S3Client {
  const s3 = config.s3;
  return new S3Client({
    endpoint: s3.endpoint,
    region: s3.region,
    forcePathStyle: s3.forcePathStyle,
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
    credentials: { accessKeyId: s3.accessKeyId, secretAccessKey: s3.secretAccessKey },
  });
}
