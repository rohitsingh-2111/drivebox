import mongoose from 'mongoose';

const { Schema, model, models } = mongoose;
const objectId = Schema.Types.ObjectId;
const userSchema = new Schema({
  name: { type: String, required: true, maxlength: 100 },
  email: { type: String, required: true, unique: true },
  passwordHash: { type: String, required: true, select: false },
  usedBytes: { type: Number, default: 0, min: 0 },
  quotaBytes: { type: Number, required: true, min: 1 },
  mutationSerial: { type: Number, default: 0, select: false },
}, { timestamps: true, versionKey: false });

const sessionSchema = new Schema({
  tokenHash: { type: String, required: true, unique: true },
  userId: { type: objectId, ref: 'User', required: true, index: true },
  expiresAt: { type: Date, required: true, index: { expires: 0 } },
}, { timestamps: true, versionKey: false });

const shareSchema = new Schema({
  userId: { type: objectId, ref: 'User', required: true },
  role: { type: String, enum: ['viewer', 'editor'], required: true },
}, { _id: false });

const itemSchema = new Schema({
  name: { type: String, required: true },
  nameKey: { type: String, required: true },
  kind: { type: String, enum: ['folder', 'file'], required: true },
  parentId: { type: objectId, ref: 'Item', default: null, index: true },
  ownerId: { type: objectId, ref: 'User', required: true, index: true, immutable: true },
  size: { type: Number, default: 0, min: 0 },
  mimeType: { type: String, default: null },
  currentVersionId: { type: objectId, ref: 'FileVersion', default: null },
  versionCount: { type: Number, default: 0, min: 0 },
  revision: { type: Number, default: 1, min: 1 },
  trashedAt: { type: Date, default: null },
  isTrashed: { type: Boolean, default: false },
  shares: { type: [shareSchema], default: [] },
}, { timestamps: true, versionKey: false });
itemSchema.index({ ownerId: 1, parentId: 1, nameKey: 1 }, { unique: true, partialFilterExpression: { isTrashed: false }, name: 'unique_active_sibling' });
itemSchema.index({ 'shares.userId': 1, isTrashed: 1 });
itemSchema.index({ ownerId: 1, isTrashed: 1, parentId: 1 });

const blobSchema = new Schema({
  key: { type: String, required: true, unique: true, immutable: true },
  ownerId: { type: objectId, ref: 'User', required: true, index: true, immutable: true },
  size: { type: Number, required: true, min: 0, immutable: true },
}, { timestamps: true, versionKey: false });

const versionSchema = new Schema({
  fileId: { type: objectId, ref: 'Item', required: true, immutable: true },
  blobId: { type: objectId, ref: 'Blob', required: true, immutable: true },
  number: { type: Number, required: true, immutable: true },
  size: { type: Number, required: true, immutable: true },
  mimeType: { type: String, required: true, immutable: true },
  createdBy: { type: objectId, ref: 'User', required: true, immutable: true },
}, { timestamps: { createdAt: true, updatedAt: false }, versionKey: false });
versionSchema.index({ fileId: 1, number: 1 }, { unique: true });

export const User = models.User || model('User', userSchema);
export const Session = models.Session || model('Session', sessionSchema);
export const Item = models.Item || model('Item', itemSchema);
export const Blob = models.Blob || model('Blob', blobSchema);
export const FileVersion = models.FileVersion || model('FileVersion', versionSchema);
export const allModels = [User, Session, Item, Blob, FileVersion];
