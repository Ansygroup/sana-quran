// Bundles server.js for Cloudflare Workers. data/ is embedded; public/ is served by the assets binding.
import {build} from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
const root = path.resolve(import.meta.dirname, '..');
const files = {};
for (const f of fs.readdirSync(path.join(root, 'data'))) files['data/' + f] = fs.readFileSync(path.join(root, 'data', f), 'utf8');
const pub = [];
(function walk(d){ for (const e of fs.readdirSync(d, {withFileTypes: true})) { const f = path.join(d, e.name); if (e.isDirectory()) walk(f); else pub.push('public/' + path.relative(path.join(root, 'public'), f).split(path.sep).join('/')); } })(path.join(root, 'public'));
fs.mkdirSync(path.join(root, 'cf/dist'), {recursive: true});
fs.writeFileSync(path.join(root, 'cf/dist/files.json'), JSON.stringify(files));
fs.writeFileSync(path.join(root, 'cf/dist/public.json'), JSON.stringify(pub));
const stubs = {
  'node:fs': `import files from '${root}/cf/dist/files.json';
import pubList from '${root}/cf/dist/public.json';
const pub = new Set(pubList);
const rel = p => String(p).replace(/\\\\/g,'/').replace(/^.*?\\/((?:data|public)\\/.+)$/, '$1');
const get = p => files[rel(p)];
const has = p => get(p) !== undefined || pub.has(rel(p));
export function readFileSync(p, enc){ const v = get(p); if (v === undefined) { const e = new Error('ENOENT: ' + p); e.code='ENOENT'; throw e; } return enc ? v : Buffer.from(v); }
export function existsSync(p){ return has(p); }
export function statSync(p){ return {isFile: () => has(p)}; }
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
