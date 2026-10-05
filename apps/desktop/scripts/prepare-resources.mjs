import { cp, mkdir, readFile, writeFile, rm, chmod } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
const repo=fileURLToPath(new URL('../../../',import.meta.url));
const resources=join(repo,'apps/desktop/src-tauri/resources');
const stage=join(resources,'staging-core');
const [major,minor]=process.versions.node.split('.').map(Number);
if(major<22||(major===22&&minor<19))throw new Error('Packaging requires Node >=22.19');
const target=process.env.TAURI_ENV_TARGET_TRIPLE;
const targetOS=process.platform==='darwin'?'apple-darwin':process.platform==='win32'?'windows':process.platform;
if(target&&(!target.startsWith(process.arch==='arm64'?'aarch64':'x86_64')||!target.includes(targetOS)))throw new Error('Prepare resources on the target architecture; cross-platform Node binaries are not substituted automatically');
await rm(resources,{recursive:true,force:true});await mkdir(join(resources,'runtime'),{recursive:true});
const rustTarget=target??execFileSync('rustc',['-vV'],{encoding:'utf8'}).match(/^host: (.+)$/m)?.[1];
if(!rustTarget)throw new Error('Unable to determine the Rust target.');
execFileSync('pnpm',['--filter','@seris/core','deploy','--prod','--ignore-scripts',stage],{cwd:repo,stdio:'inherit'});
// Never distribute user-installed skills, even when packaging a development checkout.
await rm(join(stage,'skills/installed'),{recursive:true,force:true});
// A portable dependency tree includes symlinks. Archive it intact for all bundle formats.
execFileSync('tar',['-czf',join(resources,'core.tar.gz'),'-C',stage,'.'],{stdio:'inherit'});
await cp(process.execPath,join(resources,'runtime',process.platform==='win32'?'node.exe':'node'));
await chmod(join(resources,'runtime',process.platform==='win32'?'node.exe':'node'),0o755);
const id=createHash('sha256').update(await readFile(join(resources,'core.tar.gz'))).digest('hex').slice(0,16);
await writeFile(join(resources,'manifest.json'),JSON.stringify({id,node:process.versions.node,platform:process.platform,arch:process.arch}));
await rm(stage,{recursive:true,force:true});
console.log(`Prepared portable core and Node ${process.versions.node} (${process.platform}/${process.arch})`);
