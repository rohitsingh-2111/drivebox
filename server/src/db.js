import mongoose from 'mongoose';
import { allModels } from './models.js';

export async function connectDatabase(uri) {
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });
  const hello = await mongoose.connection.db.admin().command({ hello: 1 });
  if (!hello.setName && hello.msg !== 'isdbgrid') {
    await mongoose.disconnect();
    throw new Error('MongoDB must run as a replica set (or mongos) because Drivebox uses transactions. See README.');
  }
  for (const model of allModels) await model.init();
  return mongoose.connection;
}

export async function disconnectDatabase() {
  await mongoose.disconnect();
}
