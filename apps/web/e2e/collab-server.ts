/**
 * A real Hocuspocus server for browser tests, standing in for the API's /collab endpoint.
 * Accepts any token, seeds `code:<language>` from the problem's scaffolds like the API does,
 * and serves ended pads read-only.
 */
import { Server } from '@hocuspocus/server';
import { generateScaffolds, LANGUAGES, YDOC } from '@ipp/contracts';
import { ENDED_PAD_ID, LRU, TWO_SUM } from './fixtures';

export const COLLAB_PORT = 4100;

export async function startCollabServer(port = COLLAB_PORT) {
  const server = new Server({
    port,
    quiet: true,
    async onAuthenticate({ token, documentName, connectionConfig }) {
      if (!token) throw new Error('missing token');
      if (documentName === YDOC.name(ENDED_PAD_ID)) connectionConfig.readOnly = true;
    },
    async onLoadDocument({ document, documentName }) {
      const problem = documentName === YDOC.name(ENDED_PAD_ID) ? LRU : TWO_SUM;
      const scaffolds = generateScaffolds(problem.signature);
      for (const lang of LANGUAGES) {
        const t = document.getText(YDOC.code(lang));
        if (t.length === 0) t.insert(0, scaffolds[lang]);
      }
      return document;
    },
  });
  await server.listen();
  return server;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await startCollabServer();
  console.log(`collab test server on ws://localhost:${COLLAB_PORT}`);
}
