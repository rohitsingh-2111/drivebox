import { Router } from 'express';
import { Item, User } from './models.js';
import { accessItem, assertUnique, breadcrumbDtos, destination, itemDto, lineage, ownerForItem, sameId, withOwnerTransaction } from './access.js';
import { checkRevision, escapeRegex, fields, normalizeEmail, normalizeName, objectId, pagination, searchTerm } from './validation.js';
import { fail } from './errors.js';

async function listing(req) {
  const { page, limit, skip } = pagination(req.query);
  const view = req.query.view || 'drive';
  if (!['drive', 'shared', 'trash'].includes(view)) fail(400, 'VALIDATION_ERROR', 'Unknown view.');
  const parentId = objectId(req.query.parentId, { nullable: true });
  const query = searchTerm(req.query.q);
  const filter = query ? { name: { $regex: escapeRegex(query), $options: 'i' } } : {};
  let parentAccess;
  if (parentId) {
    parentAccess = await accessItem(parentId, req.user._id, { allowTrashed: view === 'trash' });
    if (parentAccess.item.kind !== 'folder') fail(400, 'VALIDATION_ERROR', 'The parent must be a folder.');
    if (view === 'trash' && parentAccess.permission !== 'owner') fail(403, 'FORBIDDEN', 'Only an owner may browse trash.');
    filter.parentId = parentAccess.item._id;
    filter.ownerId = parentAccess.item.ownerId;
    if (view !== 'trash') filter.isTrashed = false;
  } else if (view === 'shared') {
    filter['shares.userId'] = req.user._id;
    filter.ownerId = { $ne: req.user._id };
    filter.isTrashed = false;
  } else if (view === 'trash') {
    filter.ownerId = req.user._id;
    filter.isTrashed = true;
  } else {
    filter.ownerId = req.user._id;
    filter.parentId = null;
    filter.isTrashed = false;
  }
  const cache = new Map();
  let items;
  let total;
  if (!parentId && (view === 'shared' || view === 'trash')) {
    // A direct grant or deletion marker may sit below a trashed ancestor.
    // Filter before pagination so totals never reveal hidden shared items.
    const visible = [];
    const candidates = Item.find(filter).sort({ kind: -1, nameKey: 1, _id: 1 }).lean().cursor();
    for await (const candidate of candidates) {
      const chain = await lineage(candidate);
      if (chain.slice(1).some(node => node.isTrashed)) continue;
      let permission = 'owner';
      if (view === 'shared') {
        permission = chain.some(node => node.shares.some(share => sameId(share.userId, req.user._id) && share.role === 'editor')) ? 'editor' : 'viewer';
      }
      visible.push({ item: candidate, permission });
    }
    total = visible.length;
    items = [];
    for (const entry of visible.slice(skip, skip + limit)) items.push(await itemDto(entry.item, entry.permission, null, cache));
  } else {
    total = await Item.countDocuments(filter);
    const found = await Item.find(filter).sort({ kind: -1, nameKey: 1, _id: 1 }).skip(skip).limit(limit).lean();
    items = [];
    for (const item of found) {
      let permission = parentAccess?.permission || 'owner';
      if (permission === 'viewer' && item.shares.some(share => sameId(share.userId, req.user._id) && share.role === 'editor')) permission = 'editor';
      items.push(await itemDto(item, permission, null, cache));
    }
  }
  return { items, total, page, limit, ...(parentAccess ? { folder: await itemDto(parentAccess.item, parentAccess.permission, null, cache) } : {}), breadcrumbs: parentAccess ? await breadcrumbDtos(parentAccess.chain, req.user._id) : [] };
}

async function checkMoveDepth(item, target, session) {
  if (target.chain.some(node => sameId(node._id, item._id))) fail(409, 'INVALID_MOVE', 'A folder cannot be moved into itself or its descendants.');
  let frontier = [item._id];
  let depth = 1;
  while (frontier.length) {
    if (depth + target.chain.length > 100) fail(409, 'INVALID_MOVE', 'This move exceeds the maximum folder depth of 100.');
    const children = await Item.find({ parentId: { $in: frontier } }).select('_id').session(session).lean();
    frontier = children.map(child => child._id);
    depth += 1;
  }
}

async function sharesDto(item, session = null) {
  const users = await User.find({ _id: { $in: item.shares.map(share => share.userId) } }).select('name email').session(session).lean();
  return item.shares.map(share => {
    const user = users.find(candidate => sameId(candidate._id, share.userId));
    return user ? { userId: String(user._id), name: user.name, email: user.email, role: share.role } : null;
  }).filter(Boolean);
}

export function itemsRouter() {
  const router = Router();
  router.get('/items', async (req, res) => res.json(await listing(req)));

  router.post('/folders', async (req, res) => {
    fields(req.body, ['name', 'parentId']);
    const names = normalizeName(req.body.name);
    const parentId = objectId(req.body.parentId, { nullable: true });
    const ownerId = parentId ? await ownerForItem(parentId) : req.user._id;
    const item = await withOwnerTransaction(ownerId, async session => {
      const target = await destination(parentId, req.user._id, session, ownerId);
      const values = { ...names, kind: 'folder', ownerId, parentId: target.parentId };
      await assertUnique(values, session);
      const [created] = await Item.create([values], { session });
      return itemDto(created.toObject(), sameId(ownerId, req.user._id) ? 'owner' : 'editor', session);
    });
    res.status(201).json({ item });
  });

  router.get('/items/:id', async (req, res) => {
    const access = await accessItem(req.params.id, req.user._id, { allowTrashed: true });
    res.json({ item: await itemDto(access.item, access.permission), breadcrumbs: await breadcrumbDtos(access.chain, req.user._id) });
  });

  router.patch('/items/:id', async (req, res) => {
    fields(req.body, ['name', 'parentId', 'revision']);
    const moving = Object.hasOwn(req.body, 'parentId');
    if (req.body.name === undefined && !moving) fail(400, 'VALIDATION_ERROR', 'Provide a name or destination folder.');
    const names = req.body.name === undefined ? null : normalizeName(req.body.name);
    const parentId = moving ? objectId(req.body.parentId, { nullable: true }) : undefined;
    const ownerId = await ownerForItem(req.params.id);
    const item = await withOwnerTransaction(ownerId, async session => {
      const access = await accessItem(req.params.id, req.user._id, { session, required: moving ? 'owner' : 'editor' });
      checkRevision(access.item, req.body.revision);
      const changed = { ...access.item, ...(names || {}) };
      if (moving) {
        const target = await destination(parentId, req.user._id, session, ownerId);
        await checkMoveDepth(access.item, target, session);
        changed.parentId = target.parentId;
      }
      await assertUnique(changed, session);
      const updated = await Item.findByIdAndUpdate(req.params.id, { $set: { name: changed.name, nameKey: changed.nameKey, parentId: changed.parentId }, $inc: { revision: 1 } }, { session, new: true }).lean();
      return itemDto(updated, access.permission, session);
    });
    res.json({ item });
  });

  router.delete('/items/:id', async (req, res) => {
    const ownerId = await ownerForItem(req.params.id);
    await withOwnerTransaction(ownerId, async session => {
      await accessItem(req.params.id, req.user._id, { session, required: 'owner' });
      await Item.updateOne({ _id: req.params.id }, { $set: { isTrashed: true, trashedAt: new Date() }, $inc: { revision: 1 } }, { session });
    });
    res.status(204).end();
  });

  router.post('/items/:id/restore', async (req, res) => {
    fields(req.body || {}, ['parentId']);
    const relocating = Object.hasOwn(req.body || {}, 'parentId');
    const ownerId = await ownerForItem(req.params.id);
    const item = await withOwnerTransaction(ownerId, async session => {
      const access = await accessItem(req.params.id, req.user._id, { session, required: 'owner', allowTrashed: true });
      if (!access.item.isTrashed) fail(409, 'NOT_TRASHED', 'This item is not individually in trash. Restore its parent folder if necessary.');
      const parentId = relocating ? objectId(req.body.parentId, { nullable: true }) : access.item.parentId;
      const target = await destination(parentId, req.user._id, session, ownerId);
      await checkMoveDepth(access.item, target, session);
      await assertUnique({ ...access.item, parentId: target.parentId }, session);
      const updated = await Item.findByIdAndUpdate(req.params.id, { $set: { isTrashed: false, trashedAt: null, parentId: target.parentId }, $inc: { revision: 1 } }, { session, new: true }).lean();
      return itemDto(updated, 'owner', session);
    });
    res.json({ item });
  });

  router.get('/items/:id/shares', async (req, res) => {
    const access = await accessItem(req.params.id, req.user._id, { required: 'owner' });
    res.json({ shares: await sharesDto(access.item) });
  });

  router.put('/items/:id/shares', async (req, res) => {
    fields(req.body, ['email', 'role']);
    const email = normalizeEmail(req.body.email);
    if (!['viewer', 'editor'].includes(req.body.role)) fail(400, 'VALIDATION_ERROR', 'Role must be viewer or editor.');
    const ownerId = await ownerForItem(req.params.id);
    const shares = await withOwnerTransaction(ownerId, async session => {
      const access = await accessItem(req.params.id, req.user._id, { session, required: 'owner' });
      const target = await User.findOne({ email }).session(session).lean();
      if (!target) fail(404, 'USER_NOT_FOUND', 'No registered user has that email address.');
      if (sameId(target._id, ownerId)) fail(400, 'VALIDATION_ERROR', 'The owner already has full access.');
      const updatedShares = access.item.shares.filter(share => !sameId(share.userId, target._id));
      if (updatedShares.length >= 100) fail(400, 'VALIDATION_ERROR', 'An item may have at most 100 direct shares.');
      updatedShares.push({ userId: target._id, role: req.body.role });
      const item = await Item.findByIdAndUpdate(req.params.id, { $set: { shares: updatedShares }, $inc: { revision: 1 } }, { session, new: true }).lean();
      return sharesDto(item, session);
    });
    res.json({ shares });
  });

  router.delete('/items/:id/shares/:userId', async (req, res) => {
    objectId(req.params.userId);
    const ownerId = await ownerForItem(req.params.id);
    await withOwnerTransaction(ownerId, async session => {
      await accessItem(req.params.id, req.user._id, { session, required: 'owner' });
      await Item.updateOne({ _id: req.params.id }, { $pull: { shares: { userId: req.params.userId } }, $inc: { revision: 1 } }, { session });
    });
    res.status(204).end();
  });
  return router;
}
