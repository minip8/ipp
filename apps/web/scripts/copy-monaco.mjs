// Monaco is served as static AMD files from /monaco instead of being bundled: it keeps the
// Next build light and lets the editor (and its Vim/Emacs keymaps) load on demand.
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'public', 'monaco');
const pkg = (name) => join(root, 'node_modules', name);
const monacoDir = pkg('monaco-editor');
const version = JSON.parse(readFileSync(join(monacoDir, 'package.json'), 'utf8')).version;
const stamp = join(out, '.version');

if (existsSync(stamp) && readFileSync(stamp, 'utf8') === version) process.exit(0);

mkdirSync(out, { recursive: true });
cpSync(join(monacoDir, 'min', 'vs'), join(out, 'vs'), { recursive: true });
const vimDir = pkg('monaco-vim');
cpSync(join(vimDir, 'dist', 'monaco-vim.umd.js'), join(out, 'monaco-vim.js'));
const emacsDir = pkg('monaco-emacs');
cpSync(join(emacsDir, 'dist', 'monaco-emacs.js'), join(out, 'monaco-emacs.js'));
// The AMD build has no classic-script editor worker, so bundle the ESM one into a single file.
const { build } = await import('esbuild');
await build({
  entryPoints: [join(monacoDir, 'esm', 'vs', 'editor', 'editor.worker.js')],
  bundle: true,
  format: 'iife',
  minify: true,
  outfile: join(out, 'editor.worker.js'),
  logLevel: 'warning',
});
writeFileSync(stamp, version);
console.log(`copied monaco-editor ${version} to public/monaco`);
