// Bundles server.js for Cloudflare Workers. data/ is embedded; public/ is served by the assets binding.
import {build} from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
const root = path.resolve(import.meta.dirname, '..');
const files = {};
for (const f of fs.readdirSync(path.join(root, 'data'))) files['data/' + f] = fs.readFileSync(path.join(root, 'data', f), 'utf8');
fs.mkdirSync(path.join(root, 'cf/dist'), {recursive: true});
fs.writeFileSync(path.join(root, 'cf/dist/files.json'), JSON.stringify(files));
const stubs = {
  'node:fs': `import files from '${root}/cf/dist/files.json';
const rel = p => String(p).replace(/\\\\/g,'/').replace(/^.*?\\/(data\\/[^/]+)$/, '$1');
const get = p => files[rel(p)];
export function readFileSync(p, enc){ const v = get(p); if (v === undefined) { const e = new Error('ENOENT: ' + p); e.code='ENOENT'; throw e; } return enc ? v : Buffer.from(v); }
export function existsSync(p){ return get(p) !== undefined; }
export function statSync(p){ return {isFile: () => get(p) !== undefined}; }
export default {readFileSync, existsSync, statSync};`,
  'node:http': `export function createServer(){ return {listen(){}}; }
export default {createServer};`,
  'node:path': `import p from 'node:path'; export default p; export const join=p.join, resolve=p.resolve, extname=p.extname, sep=p.sep, basename=p.basename, dirname=p.dirname;`,
  'node:crypto': `import c from 'node:crypto'; export default c; export const timingSafeEqual=c.timingSafeEqual, createHash=c.createHash;`,
  'node:zlib': `export function gzipSync(b){ return b; }
export default {gzipSync};`,
};
const plugin = {name: 'stubs', setup(b) {
  b.onResolve({filter: /^node:(fs|http|zlib|path|crypto)$/}, a => a.namespace === 'stub' ? {path: a.path, external: true} : {path: a.path, namespace: 'stub'});
  b.onLoad({filter: /.*/, namespace: 'stub'}, a => ({contents: stubs[a.path], loader: 'js', resolveDir: root}));
}};
await build({entryPoints: [path.join(root, 'cf/worker.js')], bundle: true, format: 'esm', platform: 'neutral', mainFields: ['module','main'], conditions: ['workerd','worker'], external: ['node:crypto','node:path','node:module'], outfile: path.join(root, 'cf/dist/worker.js'), plugins: [plugin], define: {__dirname: '"/app"'}, loader: {'.json': 'json'}, logLevel: 'info'});
