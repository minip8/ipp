import { runMigrations } from '../client';
import { databaseUrl } from '../env';

const url = databaseUrl();
await runMigrations(url);
console.log(`migrated ${new URL(url).pathname.slice(1)}`);
