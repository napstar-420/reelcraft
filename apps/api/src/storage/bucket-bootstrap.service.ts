import { Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { CreateBucketCommand, HeadBucketCommand, PutBucketCorsCommand } from '@aws-sdk/client-s3';
import { EngineConfig } from '../config/engine-config';
import { createS3Client } from './s3-client.factory';

/**
 * §23 — "bootstrap ensures the bucket exists, applies the CORS rule, and
 * seeds builtin templates, so a fresh clone plus `docker compose up` is a
 * working environment." Belt-and-braces alongside the `mc` one-shot in
 * docker-compose: the app should not assume a sidecar ran (§21.3 CORS is
 * required for the browser to play media directly from a second origin).
 *
 * Failure here must not crash the app — the `mc` bootstrap sidecar in
 * docker-compose already covers the primary path, and an unhandled
 * rejection from OnApplicationBootstrap otherwise takes the whole process
 * down (observed: MinIO's CORS endpoint under some client/server version
 * combinations 501s on a checksum header the AWS SDK adds by default).
 */
@Injectable()
export class BucketBootstrapService implements OnApplicationBootstrap {
  private readonly logger = new Logger(BucketBootstrapService.name);

  constructor(private readonly config: EngineConfig) {}

  async onApplicationBootstrap(): Promise<void> {
    const s3 = this.config.s3;
    const client = createS3Client(this.config);

    try {
      try {
        await client.send(new HeadBucketCommand({ Bucket: s3.bucket }));
      } catch {
        this.logger.log(`Creating bucket ${s3.bucket}`);
        await client.send(new CreateBucketCommand({ Bucket: s3.bucket }));
      }

      await client.send(
        new PutBucketCorsCommand({
          Bucket: s3.bucket,
          CORSConfiguration: {
            CORSRules: [
              {
                AllowedMethods: ['GET', 'HEAD'],
                AllowedOrigins: ['*'],
                AllowedHeaders: ['Range', 'Content-Type'],
                ExposeHeaders: ['Content-Length', 'Content-Range', 'ETag'],
              },
            ],
          },
        }),
      );

      this.logger.log(`Bucket ${s3.bucket} ready (CORS applied)`);
    } catch (err) {
      this.logger.warn(
        `Bucket bootstrap did not fully complete (relying on the docker-compose mc sidecar instead): ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }
}
