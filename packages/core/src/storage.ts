import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

// Private buckets only; files are reached through short-lived signed URLs.
export type Bucket = string;

export interface Storage {
  upload(bucket: Bucket, path: string, data: Buffer, contentType: string): Promise<void>;
  download(bucket: Bucket, path: string): Promise<Buffer>;
  remove(bucket: Bucket, paths: string[]): Promise<void>;
  signedUrl(bucket: Bucket, path: string, ttlSeconds: number, downloadName?: string): Promise<string>;
}

/** Removes a bucket with all its files (Supabase refuses direct SQL deletes on storage tables). */
export async function deleteBucket(sb: SupabaseClient, bucket: string): Promise<'deleted' | 'missing'> {
  const { data } = await sb.storage.getBucket(bucket);
  if (!data) return 'missing';
  const emptied = await sb.storage.emptyBucket(bucket);
  if (emptied.error) throw new Error(`empty bucket ${bucket}: ${emptied.error.message}`);
  const removed = await sb.storage.deleteBucket(bucket);
  if (removed.error) throw new Error(`delete bucket ${bucket}: ${removed.error.message}`);
  return 'deleted';
}

/** Service-role Supabase client (worker and admin routes only). */
export function serviceClient(
  url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL,
  key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY,
): SupabaseClient {
  if (!url || !key) throw new Error('Supabase URL / secret key not set (SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY or SUPABASE_SECRET_KEY)');
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

/** Supabase Storage with the service role (worker only). Buckets are private. */
export class SupabaseStorage implements Storage {
  private sb: SupabaseClient;
  constructor(sb: SupabaseClient = serviceClient()) {
    this.sb = sb;
  }
  async upload(bucket: Bucket, path: string, data: Buffer, contentType: string) {
    const { error } = await this.sb.storage.from(bucket).upload(path, data, { contentType, upsert: true });
    if (error) throw new Error(`storage upload ${bucket}/${path}: ${error.message}`);
  }
  async download(bucket: Bucket, path: string) {
    const { data, error } = await this.sb.storage.from(bucket).download(path);
    if (error || !data) throw new Error(`storage download ${bucket}/${path}: ${error?.message}`);
    return Buffer.from(await data.arrayBuffer());
  }
  async remove(bucket: Bucket, paths: string[]) {
    if (paths.length === 0) return;
    for (let i = 0; i < paths.length; i += 100) {
      const { error } = await this.sb.storage.from(bucket).remove(paths.slice(i, i + 100));
      if (error) throw new Error(`storage remove ${bucket}: ${error.message}`);
    }
  }
  async signedUrl(bucket: Bucket, path: string, ttlSeconds: number, downloadName?: string) {
    const { data, error } = await this.sb.storage.from(bucket)
      .createSignedUrl(path, ttlSeconds, downloadName ? { download: downloadName } : undefined);
    if (error || !data) throw new Error(`signed url ${bucket}/${path}: ${error?.message}`);
    return data.signedUrl;
  }
}

/** Filesystem storage for tests and offline dev (`STORAGE_DRIVER=local`). */
export class LocalStorage implements Storage {
  constructor(private root = process.env.LOCAL_STORAGE_DIR ?? '.storage') {}
  private p(bucket: Bucket, path: string) {
    const full = resolve(this.root, bucket, path);
    if (!full.startsWith(resolve(this.root, bucket))) throw new Error('path traversal');
    return full;
  }
  async upload(bucket: Bucket, path: string, data: Buffer, _contentType?: string) {
    const f = this.p(bucket, path);
    await mkdir(dirname(f), { recursive: true });
    await writeFile(f, data);
  }
  async download(bucket: Bucket, path: string) {
    return readFile(this.p(bucket, path));
  }
  async remove(bucket: Bucket, paths: string[]) {
    await Promise.all(paths.map((x) => rm(this.p(bucket, x), { force: true })));
  }
  async signedUrl(bucket: Bucket, path: string) {
    return `file://${join(resolve(this.root), bucket, path)}`;
  }
}

export function storageFromEnv(): Storage {
  return process.env.STORAGE_DRIVER === 'local' ? new LocalStorage() : new SupabaseStorage();
}
