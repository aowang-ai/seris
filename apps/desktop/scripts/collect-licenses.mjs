import { readdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const repo = fileURLToPath(new URL('../../../', import.meta.url));
const supplementRoot = join(repo, 'licenses/upstream');
const supplements = JSON.parse(await readFile(join(supplementRoot, 'index.json'), 'utf8'));
const noticeName = /^(?:licen[cs]e|copying|copyright|notice|third.?party.?notices)/i;

async function texts(root) {
  const out = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (!noticeName.test(entry.name)) continue;
    const path = join(root, entry.name);
    if (entry.isFile()) out.push(await readFile(path, 'utf8'));
    if (entry.isDirectory()) {
      for (const child of await readdir(path, { withFileTypes: true })) {
        if (child.isFile()) out.push(await readFile(join(path, child.name), 'utf8'));
      }
    }
  }
  if (!out.length) {
    for (const file of await readdir(root)) {
      if (!/^readme/i.test(file)) continue;
      const text = await readFile(join(root, file), 'utf8');
      // A license link alone does not carry the required copyright/permission text.
      if (/Permission is hereby granted/i.test(text) && /Copyright/i.test(text)) out.push(text);
    }
  }
  return out;
}

async function packageNotice(ecosystem, name, version, root, license, source) {
  const content = await texts(root);
  if (!content.length) {
    const supplement = supplements.find(item => item.ecosystem === ecosystem && item.version === version &&
      (item.name === name || (item.prefix && name.startsWith(item.prefix))));
    if (supplement) {
      for (const file of supplement.files) content.push(await readFile(join(supplementRoot, file), 'utf8'));
    }
  }
  if (!content.length) throw new Error(`Missing distribution notice: ${ecosystem} ${name}@${version}. Add a reviewed upstream supplement.`);
  return [`${ecosystem}: ${name}@${version}`, `License: ${license ?? 'See license text'}`, `Source: ${source ?? 'See package registry'}`, ...content].join('\n\n');
}

export async function collectLicenses(destination, target) {
  const notices = [];
  const packages = new Map();
  const projects = JSON.parse(execFileSync('pnpm', ['list', '-r', '--prod', '--depth', 'Infinity', '--json'], { cwd: repo, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }));
  function visit(dependencies) {
    for (const [name, item] of Object.entries(dependencies ?? {})) {
      if (item.path && !item.version?.startsWith('link:') && existsSync(join(item.path, 'package.json'))) packages.set(`${name}@${item.version}`, item.path);
      visit(item.dependencies);
    }
  }
  for (const project of projects) visit(project.dependencies);
  for (const [, root] of [...packages].sort(([a], [b]) => a.localeCompare(b))) {
    const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
    const repository = typeof pkg.repository === 'string' ? pkg.repository : pkg.repository?.url;
    notices.push(await packageNotice('npm', pkg.name, pkg.version, root, pkg.license, repository));
  }
  const metadata = JSON.parse(execFileSync('cargo', ['metadata', '--locked', '--format-version', '1', '--filter-platform', target, '--manifest-path', join(repo, 'apps/desktop/src-tauri/Cargo.toml')], { cwd: repo, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }));
  const resolved = new Set(metadata.resolve.nodes.map(item => item.id));
  for (const pkg of metadata.packages.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!pkg.source || !resolved.has(pkg.id)) continue;
    const source = `https://crates.io/crates/${pkg.name}/${pkg.version} ; ${pkg.repository ?? ''}`;
    notices.push(await packageNotice('Rust', pkg.name, pkg.version, dirname(pkg.manifest_path), pkg.license, source));
  }
  await writeFile(destination, 'Third-party distribution notices for this Seris build\n\n' + notices.join('\n\n' + '='.repeat(72) + '\n\n') + '\n');
  console.log(`Collected ${notices.length} dependency notices.`);
}
