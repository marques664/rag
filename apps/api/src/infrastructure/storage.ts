import {
  DeleteObjectCommand,
  PutObjectCommand,
  S3Client,
  type S3ClientConfig,
} from '@aws-sdk/client-s3';

export interface UploadPdfParams {
  key: string;
  body: Buffer;
  contentType: string;
  metadata?: Record<string, string>;
}

export interface DocumentStorageService {
  uploadPdf(params: UploadPdfParams): Promise<void>;
  deleteObject(key: string): Promise<void>;
}

export interface MinioStorageConfig {
  endpoint: string;
  port: number;
  useSsl: boolean;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  region?: string;
}

function isMissingObjectError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) {
    return false;
  }

  const record = error as {
    name?: unknown;
    Code?: unknown;
    $metadata?: { httpStatusCode?: unknown };
  };

  return (
    record.name === 'NoSuchKey' ||
    record.Code === 'NoSuchKey' ||
    record.$metadata?.httpStatusCode === 404
  );
}

/**
 * S3-compatible object storage adapter backed by MinIO.
 */
export class MinioDocumentStorage implements DocumentStorageService {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(config: MinioStorageConfig) {
    const protocol = config.useSsl ? 'https' : 'http';
    const clientConfig: S3ClientConfig = {
      endpoint: `${protocol}://${config.endpoint}:${config.port}`,
      region: config.region ?? 'us-east-1',
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
      forcePathStyle: true,
    };

    this.client = new S3Client(clientConfig);
    this.bucket = config.bucket;
  }

  async uploadPdf(params: UploadPdfParams): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: params.key,
        Body: params.body,
        ContentType: params.contentType,
        ContentLength: params.body.length,
        Metadata: params.metadata,
      }),
    );
  }

  async deleteObject(key: string): Promise<void> {
    try {
      await this.client.send(
        new DeleteObjectCommand({
          Bucket: this.bucket,
          Key: key,
        }),
      );
    } catch (error) {
      if (isMissingObjectError(error)) {
        return;
      }
      throw error;
    }
  }

  destroy(): void {
    this.client.destroy();
  }
}
