import { createConnection } from 'node:net';
import { COLLAB_PORT, startCollabServer } from './collab-server';

const portInUse = (port: number) =>
  new Promise<boolean>((resolve) => {
    const s = createConnection({ port, host: '127.0.0.1' });
    s.once('connect', () => {
      s.destroy();
      resolve(true);
    });
    s.once('error', () => resolve(false));
  });

export default async function globalSetup() {
  // Several Playwright runs may share one collab server (e.g. screenshots beside the suite).
  if (await portInUse(COLLAB_PORT)) return;
  const server = await startCollabServer();
  return async () => {
    await server.destroy();
  };
}
