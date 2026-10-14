import { Router } from 'express';
import multer from 'multer';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { unlink, stat } from 'node:fs/promises';
import { Item, User, Blob, FileVersion } from './models.js';
import { accessItem, assertUnique, destination, itemDto, ownerForItem, sameId, withOwnerTransaction } from './access.js';
import { checkRevision, fields, normalizeName, objectId, pagination, safeMime } from './validation.js';
import { fail, notFound } from './errors.js';

export async function removeUncommittedUpload(file, error) {
  if (!file) return;
  // An ambiguous commit may have succeeded. Never erase bytes that might be live.
  if (error?.hasErrorLabel?.('UnknownTransactionCommitResult')) return;
  try {
    if (await Blob.exists({ key: file.filename })) return;
    await unlink(file.path).catch(() => {});
  } catch {
    // Database unavailable: preserve bytes for the explicit orphan maintenance job.
  }
}

async function chargeQuota(owner, bytes, session) {
  if (owner.usedBytes + bytes > owner.quotaBytes) fail(507, 'QUOTA_EXCEEDED', 'The owner’s storage quota is full. All versions and trash count toward storage.', { usedBytes: owner.usedBytes, quotaBytes: owner.quotaBytes, requestedBytes: bytes });
  await User.updateOne({ _id: owner._id }, { $inc: { usedBytes: bytes } }, { session });
}

function uploadedFile(req) {
  if (!req.file) fail(400, 'VALIDATION_ERROR', 'Choose one file to upload.');
  return req.file;
}

async function availableBlobPath(blobId, config, session = null) {
  const blob = await Blob.findById(blobId).session(session).lean();
  if (!blob || !/^[a-f0-9-]{36}$/.test(blob.key)) fail(503, 'FILE_UNAVAILABLE', 'This file’s stored content is unavailable.');
  const filename = path.join(config.storageDir, 'blobs', blob.key);
  const details = await stat(filename).catch(() => null);
  if (!details?.isFile() || details.size !== blob.size) fail(503, 'FILE_UNAVAILABLE', 'This file’s stored content is unavailable.');
  return filename;
}

export function filesRouter(config) {
  const router = Router();
  const upload = multer({
    storage: multer.diskStorage({ destination: path.join(config.storageDir, 'blobs'), filename: (_req, _file, cb) => cb(null, randomUUID()), flush: true }),
    defParamCharset: 'utf8',
    preservePath: true,
    limits: { fileSize: config.maxUploadBytes, files: 1, fields: 2, parts: 3, fieldSize: 1024, fieldNameSize: 100 },
  }).single('file');

  router.post('/files', upload, async (req, res) => {
    try {
      fields(req.body, ['parentId']);
      const file = uploadedFile(req);
      const names = normalizeName(file.originalname);
      const mimeType = safeMime(file.mimetype);
      const parentId = objectId(req.body.parentId, { nullable: true });
      const ownerId = parentId ? await ownerForItem(parentId) : req.user._id;
      const item = await withOwnerTransaction(ownerId, async (session, owner) => {
        const target = await destination(parentId, req.user._id, session, ownerId);
        const values = { ...names, kind: 'file', ownerId, parentId: target.parentId, size: file.size, mimeType, versionCount: 1 };
        await assertUnique(values, session);
        await chargeQuota(owner, file.size, session);
        const [blob] = await Blob.create([{ key: file.filename, size: file.size, ownerId }], { session });
        const [created] = await Item.create([values], { session });
        const [version] = await FileVersion.create([{ fileId: created._id, blobId: blob._id, number: 1, size: file.size, mimeType, createdBy: req.user._id }], { session });
        created.currentVersionId = version._id;
        await created.save({ session });
        return itemDto(created.toObject(), sameId(ownerId, req.user._id) ? 'owner' : 'editor', session);
      });
      res.status(201).json({ item });
    } catch (error) {
      await removeUncommittedUpload(req.file, error);
      throw error;
    }
  });

  router.post('/files/:id/versions', upload, async (req, res) => {
    try {
      fields(req.body, ['revision']);
      const file = uploadedFile(req);
      const ownerId = await ownerForItem(req.params.id);
      const item = await withOwnerTransaction(ownerId, async (session, owner) => {
        const access = await accessItem(req.params.id, req.user._id, { session, required: 'editor' });
        if (access.item.kind !== 'file') fail(400, 'VALIDATION_ERROR', 'Only files have versions.');
        checkRevision(access.item, req.body.revision);
        await chargeQuota(owner, file.size, session);
        const mimeType = safeMime(file.mimetype);
        const [blob] = await Blob.create([{ key: file.filename, size: file.size, ownerId }], { session });
        const [version] = await FileVersion.create([{ fileId: access.item._id, blobId: blob._id, number: access.item.versionCount + 1, size: file.size, mimeType, createdBy: req.user._id }], { session });
        const updated = await Item.findByIdAndUpdate(access.item._id, { $set: { currentVersionId: version._id, size: file.size, mimeType }, $inc: { versionCount: 1, revision: 1 } }, { session, new: true }).lean();
        return itemDto(updated, access.permission, session);
      });
      res.status(201).json({ item });
    } catch (error) {
      await removeUncommittedUpload(req.file, error);
      throw error;
    }
  });

  router.get('/files/:id/versions', async (req, res) => {
    const access = await accessItem(req.params.id, req.user._id, { allowTrashed: true });
    if (access.item.kind !== 'file') fail(400, 'VALIDATION_ERROR', 'Only files have versions.');
    const { page, limit, skip } = pagination(req.query);
    const total = await FileVersion.countDocuments({ fileId: access.item._id });
    const found = await FileVersion.find({ fileId: access.item._id }).sort({ number: -1 }).skip(skip).limit(limit).lean();
    const users = await User.find({ _id: { $in: found.map(version => version.createdBy) } }).select('name').lean();
    const versions = found.map(version => ({
      id: String(version._id), number: version.number, size: version.size, mimeType: version.mimeType, createdAt: version.createdAt,
      createdBy: users.find(user => sameId(user._id, version.createdBy))?.name || 'Unknown user',
      current: sameId(version._id, access.item.currentVersionId),
    }));
    res.json({ versions, total, page, limit });
  });

  router.post('/files/:id/versions/:versionId/restore', async (req, res) => {
    fields(req.body || {}, ['revision']);
    objectId(req.params.versionId);
    const ownerId = await ownerForItem(req.params.id);
    const item = await withOwnerTransaction(ownerId, async session => {
      const access = await accessItem(req.params.id, req.user._id, { session, required: 'editor' });
      if (access.item.kind !== 'file') fail(400, 'VALIDATION_ERROR', 'Only files have versions.');
      checkRevision(access.item, req.body?.revision);
      const original = await FileVersion.findOne({ _id: req.params.versionId, fileId: access.item._id }).session(session).lean();
      if (!original) notFound();
      await availableBlobPath(original.blobId, config, session);
      const [version] = await FileVersion.create([{ fileId: access.item._id, blobId: original.blobId, number: access.item.versionCount + 1, size: original.size, mimeType: original.mimeType, createdBy: req.user._id }], { session });
      const updated = await Item.findByIdAndUpdate(access.item._id, { $set: { currentVersionId: version._id, size: original.size, mimeType: original.mimeType }, $inc: { versionCount: 1, revision: 1 } }, { session, new: true }).lean();
      return itemDto(updated, access.permission, session);
    });
    res.json({ item });
  });

  router.get('/files/:id/download', async (req, res, next) => {
    const access = await accessItem(req.params.id, req.user._id, { allowTrashed: true });
    if (access.item.kind !== 'file') fail(400, 'VALIDATION_ERROR', 'Only files can be downloaded.');
    const versionId = req.query.versionId ? objectId(req.query.versionId) : access.item.currentVersionId;
    const version = await FileVersion.findOne({ _id: versionId, fileId: access.item._id }).lean();
    if (!version) notFound();
    const filename = await availableBlobPath(version.blobId, config);
    res.download(filename, access.item.name, { dotfiles: 'allow', headers: { 'Content-Type': version.mimeType, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' } }, error => {
      if (error) next(error.code === 'ENOENT' ? Object.assign(new Error('This file’s stored content is unavailable.'), { status: 503, code: 'FILE_UNAVAILABLE' }) : error);
    });
  });
  return router;
}
