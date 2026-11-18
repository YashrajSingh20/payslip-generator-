import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { createLocalStore, createS3Store, sha256Base64 } from '../src/storage/object-store.js';
import { imageType } from '../src/storage/payslip-documents.js';

describe('S3 store', () => {
  it('writes with a SHA-256 checksum and never overwrites', async () => {
    const sent = [];
    const store = createS3Store({ bucket: 'kp-test', region: 'ap-south-1', s3: { send: async (cmd) => { sent.push(cmd); return {}; } } });
    const bytes = Buffer.from('%PDF-1.7 hello');
    const { checksum } = await store.put({ key: 'test/payslip_pdf/r/p.pdf', bytes, contentType: 'application/pdf' });
    const input = sent[0].input;
    assert.equal(sent[0].constructor.name, 'PutObjectCommand');
    assert.equal(input.Bucket, 'kp-test');
    assert.equal(input.Key, 'test/payslip_pdf/r/p.pdf');
    assert.equal(input.ChecksumSHA256, sha256Base64(bytes));
    assert.equal(input.IfNoneMatch, '*');
    assert.equal(checksum, input.ChecksumSHA256);
  });

  it('signs short-lived private downloads with the file name', async () => {
    let signed;
    const store = createS3Store({
      bucket: 'kp-test', region: 'ap-south-1', s3: {},
      signUrl: async (_s3, cmd, opts) => { signed = { input: cmd.input, opts }; return 'https://signed'; },
    });
    const url = await store.signedUrl('k', { name: 'Payslip July (2026).pdf', contentType: 'application/pdf', attachment: true });
    assert.equal(url, 'https://signed');
    assert.equal(signed.opts.expiresIn, 60);
    assert.equal(signed.input.ResponseCacheControl, 'private, no-store');
    assert.equal(signed.input.ResponseContentDisposition, "attachment; filename*=UTF-8''Payslip%20July%20%282026%29.pdf");
  });
});

describe('local store', () => {
  it('round-trips files, refuses overwrite and path escapes', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'kp-store-'));
    try {
      const store = createLocalStore({ root });
      await store.put({ key: 'local/a/b.pdf', bytes: Buffer.from('x') });
      assert.equal((await store.get('local/a/b.pdf')).toString(), 'x');
      await assert.rejects(store.put({ key: 'local/a/b.pdf', bytes: Buffer.from('y') }));
      await assert.rejects(store.get('../outside.txt'), /Invalid object key/);
      assert.equal(await store.signedUrl('local/a/b.pdf', {}), null);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe('logo type check', () => {
  it('accepts PNG and JPEG by content, not by name', () => {
    assert.equal(imageType(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0])), 'image/png');
    assert.equal(imageType(Buffer.from([0xff, 0xd8, 0xff, 0xe0])), 'image/jpeg');
    assert.equal(imageType(Buffer.from('GIF89a....')), null);
    assert.equal(imageType(Buffer.from('<svg></svg>')), null);
  });
});
