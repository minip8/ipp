import { createDb } from '../client';
import { databaseUrl } from '../env';
import { seed } from '../seed';

const handle = createDb(databaseUrl(), { max: 2 });
try {
  const report = await seed(handle.db, { log: (m) => console.log(m) });
  console.log(JSON.stringify(report));
} finally {
  await handle.close();
}
