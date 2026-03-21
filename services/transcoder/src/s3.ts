import { createWriteStream, createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { S3Client, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import { config } from "./config.js";

const MULTIPART_THRESHOLD = 50 * 1024 * 1024; // 50 MB

export const s3Client = new S3Client({
  region: config.aws.region,
  credentials: {
    accessKeyId: config.aws.accessKeyId,
    secretAccessKey: config.aws.secretAccessKey,
  },
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

export async function uploadBuffer(
  buffer: Buffer,
  s3Key: string,
  contentType: string,
): Promise<void> {
  await s3Client.send(
    new PutObjectCommand({
      Bucket: config.aws.bucket,
      Key: s3Key,
      Body: buffer,
      ContentType: contentType,
      ContentLength: buffer.length,
    }),
  );
}
