import mongoose from 'mongoose';
import { Item, User } from './models.js';
import { fail, notFound } from './errors.js';
import { objectId } from './validation.js';

export const sameId = (a, b) => String(a) === String(b);
export const publicUser = user => ({ id: String(user._id), name: user.name, email: user.email, usedBytes: user.usedBytes, quotaBytes: user.quotaBytes });
const ranks = { viewer: 1, editor: 2, owner: 3 };

export async function lineage(item, session = null) {
  const chain = [item];
  const visited = new Set([String(item._id)]);
  let current = item;
  while (current.parentId) {
    if (chain.length > 100 || visited.has(String(current.parentId))) fail(409, 'INVALID_TREE', 'The folder hierarchy is invalid or too deep.');
    visited.add(String(current.parentId));
    current = await Item.findById(current.parentId).session(session).lean();
    if (!current || current.kind !== 'folder' || !sameId(current.ownerId, item.ownerId)) notFound();
    chain.push(current);
  }
  return chain;
}

export async function accessItem(id, actorId, { session = null, required = 'viewer', allowTrashed = false } = {}) {
  objectId(String(id));
  const item = await Item.findById(id).session(session).lean();
  if (!item) notFound();
  const chain = await lineage(item, session);
  const owner = sameId(item.ownerId, actorId);
  const trashed = chain.some(node => node.isTrashed);
  if (trashed && !(allowTrashed && owner)) notFound();
  let permission = owner ? 'owner' : null;
  if (!owner) {
    for (const node of chain) {
      const grant = node.shares.find(share => sameId(share.userId, actorId));
      if (grant && (!permission || ranks[grant.role] > ranks[permission])) permission = grant.role;
    }
  }
  if (!permission) notFound();
  if (ranks[permission] < ranks[required]) fail(403, 'FORBIDDEN', 'You do not have permission to perform this action.');
  return { item, chain, permission, trashed };
}

export async function itemDto(item, permission, session = null, ownerCache = new Map()) {
  const ownerKey = String(item.ownerId);
  let owner = ownerCache.get(ownerKey);
  if (!owner) {
    owner = await User.findById(item.ownerId).select('name').session(session).lean();
    ownerCache.set(ownerKey, owner);
  }
  return {
    id: String(item._id), name: item.name, kind: item.kind,
    parentId: item.parentId ? String(item.parentId) : null,
    ownerId: ownerKey, ownerName: owner?.name || 'Unknown owner',
    size: item.size, mimeType: item.mimeType,
    createdAt: item.createdAt, updatedAt: item.updatedAt, trashedAt: item.trashedAt,
    permission, revision: item.revision,
  };
}

export async function breadcrumbDtos(chain, actorId) {
  const crumbs = [];
  // Sharing a descendant does not reveal otherwise inaccessible ancestor names.
  let inherited = false;
  for (const node of [...chain].reverse()) {
    inherited ||= sameId(node.ownerId, actorId) || node.shares.some(share => sameId(share.userId, actorId));
    if (inherited) crumbs.push({ id: String(node._id), name: node.name });
  }
  return crumbs;
}

export async function withOwnerTransaction(ownerId, callback) {
  const session = await mongoose.startSession();
  try {
    // The write is deliberately first. Every tree/quota/share mutation takes this
    // owner's document lock, so retried transactions see a coherent permission tree.
    return await session.withTransaction(async () => {
      const owner = await User.findByIdAndUpdate(ownerId, { $inc: { mutationSerial: 1 } }, { session, new: true }).lean();
      if (!owner) notFound();
      return callback(session, owner);
    }, { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' }, readPreference: 'primary' });
  } finally {
    await session.endSession();
  }
}

export async function ownerForItem(id) {
  objectId(id);
  const item = await Item.findById(id).select('ownerId').lean();
  if (!item) notFound();
  return item.ownerId;
}

export async function destination(parentId, actorId, session, expectedOwnerId = null) {
  if (!parentId) {
    if (expectedOwnerId && !sameId(expectedOwnerId, actorId)) fail(403, 'FORBIDDEN', 'Only an owner may create items at their drive root.');
    return { ownerId: actorId, parentId: null, chain: [] };
  }
  const access = await accessItem(parentId, actorId, { session, required: 'editor', allowTrashed: true });
  if (access.trashed) fail(409, 'DESTINATION_TRASHED', 'Restore the destination folder first.');
  if (access.item.kind !== 'folder') fail(400, 'VALIDATION_ERROR', 'The destination must be a folder.');
  if (expectedOwnerId && !sameId(access.item.ownerId, expectedOwnerId)) fail(409, 'INVALID_MOVE', 'Moving items between owners is not allowed.');
  if (access.chain.length >= 100) fail(409, 'INVALID_MOVE', 'The maximum folder depth is 100.');
  return { ownerId: access.item.ownerId, parentId: access.item._id, chain: access.chain };
}

export async function assertUnique(item, session) {
  const existing = await Item.exists({ ownerId: item.ownerId, parentId: item.parentId, nameKey: item.nameKey, isTrashed: false, ...(item._id ? { _id: { $ne: item._id } } : {}) }).session(session);
  if (existing) fail(409, 'NAME_CONFLICT', 'An item with this name already exists in the destination.');
}
