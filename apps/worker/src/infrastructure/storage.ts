import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';

export interface DocumentStorageClient {
  getObjectBytes(storageKey: string): Promise<Uint8Array>;
}

export class StorageObjectNotFoundError extends Error {
  constructor(storageKey: string) {
    super(`Document object not found in storage: ${storageKey}`);
    this.name = 'StorageObjectNotFoundError';
  }
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

/**
 * S3-compatible MinIO storage client for fetching uploaded PDFs in the worker.
 */
export class MinioDocumentStorage implements DocumentStorageClient {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(config: MinioStorageConfig) {
    const protocol = config.useSsl ? 'https' : 'http';
    this.bucket = config.bucket;
    this.client = new S3Client({
      region: config.region ?? 'us-east-1',
      endpoint: `${protocol}://${config.endpoint}:${config.port}`,
      forcePathStyle: true,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
    });
  }

  public async getObjectBytes(storageKey: string): Promise<Uint8Array> {
    try {
      const response = await this.client.send(
        new GetObjectCommand({
          Bucket: this.bucket,
          Key: storageKey,
        }),
      );

      if (!response.Body) {
        throw new StorageObjectNotFoundError(storageKey);
      }

      const bytes = await response.Body.transformToByteArray();
      if (bytes.byteLength === 0) {
        throw new Error(`Downloaded storage object is empty: ${storageKey}`);
      }

      return bytes;
    } catch (error) {
      if (isS3NotFoundError(error)) {
        throw new StorageObjectNotFoundError(storageKey);
      }
      throw error;
    }
  }

  public close(): void {
    this.client.destroy();
  }
}

function isS3NotFoundError(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }
  const maybeS3Error = error as {
    name?: string;
    Code?: string;
    $metadata?: { httpStatusCode?: number };
  };
  return (
    maybeS3Error.name === 'NoSuchKey' ||
    maybeS3Error.Code === 'NoSuchKey' ||
    maybeS3Error.$metadata?.httpStatusCode === 404
  );
}
