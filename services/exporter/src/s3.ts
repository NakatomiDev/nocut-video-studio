import { createWriteStream, createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { S3Client, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import { getSignedUrl } from "@aws-sdk/cloudfront-signer";
import { config } from "./config.js";

const MULTIPART_THRESHOLD = 50 * 1024 * 1024; // 50 MB

export const s3Client = new S3Client({
  region: config.aws.region,
  // On ECS, credentials come from the task role via the default credential chain.
  // Only set explicit credentials when provided (local development).
  ...(config.aws.accessKeyId && config.aws.secretAccessKey
    ? {
        credentials: {
          accessKeyId: config.aws.accessKeyId,
          secretAccessKey: config.aws.secretAccessKey,
        },
      }
    : {}),
});

export async function downloadFile(s3Key: string, localPath: string): Promise<void> {
  const response = await s3Client.send(
    new GetObjectCommand({
      Bucket: config.aws.bucket,
      Key: s3Key,
    }),
  );

  if (!response.Body) {
    throw new Error(`Empty response body for S3 key: ${s3Key}`);
  }

  const body = response.Body as Readable;
  const writeStream = createWriteStream(localPath);
  await pipeline(body, writeStream);
}

export async function uploadFile(
  localPath: string,
  s3Key: string,
  contentType: string,
): Promise<void> {
  const fileSize = (await stat(localPath)).size;

  if (fileSize > MULTIPART_THRESHOLD) {
    const upload = new Upload({
      client: s3Client,
      params: {
        Bucket: config.aws.bucket,
        Key: s3Key,
        Body: createReadStream(localPath),
        ContentType: contentType,
      },
      partSize: 10 * 1024 * 1024, // 10 MB parts
    });
    await upload.done();
  } else {
    const body = createReadStream(localPath);
    await s3Client.send(
      new PutObjectCommand({
        Bucket: config.aws.bucket,
        Key: s3Key,
        Body: body,
        ContentType: contentType,
        ContentLength: fileSize,
      }),
    );
  }
}

export function generateSignedDownloadUrl(s3Key: string, expiresInSeconds = 3600): string {
  const { cloudfrontDomain, cloudfrontKeypairId, cloudfrontPrivateKey } = config.aws;

  if (!cloudfrontDomain || !cloudfrontKeypairId || !cloudfrontPrivateKey) {
    // Fallback: return a plain S3 URL if CloudFront is not configured
    return `https://${config.aws.bucket}.s3.${config.aws.region}.amazonaws.com/${s3Key}`;
  }

  const url = `https://${cloudfrontDomain}/${s3Key}`;
  const dateLessThan = new Date(Date.now() + expiresInSeconds * 1000).toISOString();

  return getSignedUrl({
    url,
    keyPairId: cloudfrontKeypairId,
    privateKey: cloudfrontPrivateKey,
    dateLessThan,
  });
}
