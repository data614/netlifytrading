import { promises as fs } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
const OUTPUT_DIR = join(ROOT, 'docs', 'peer-review');
const OUTPUT_FILE = join(OUTPUT_DIR, 'file-inventory.json');

const SKIP_DIRS = new Set([
  '.git',
  '.github',
  'node_modules',
  'build',
  '.netlify',
  '.vercel',
  '.idea',
  '.vscode',
]);

const IGNORED_PREFIXES = ['tmp', 'dist'];

const TRACKED_EXTENSIONS = new Set([
  '.js',
  '.mjs',
  '.cjs',
  '.ts',
  '.tsx',
  '.jsx',
  '.css',
  '.scss',
  '.sass',
  '.less',
  '.html',
  '.htm',
  '.json',
]);

const CATEGORY_ORDER = [
  'frontend',
  'backend',
  'shared',
  'tooling',
  'tests',
  'docs',
  'data',
  'other',
];

function normalizePath(p) {
  return p.split('\\').join('/');
}

function shouldSkipDir(name) {
  if (SKIP_DIRS.has(name)) return true;
  return IGNORED_PREFIXES.some((prefix) => name === prefix || name.startsWith(`${prefix}-`));
}

async function walk(dir, visitor) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const entryPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (shouldSkipDir(entry.name)) continue;
      await walk(entryPath, visitor);
    } else if (entry.isFile()) {
      await visitor(entryPath);
    }
  }
}

function classifyFile(relPath) {
  const path = normalizePath(relPath);
  if (path.startsWith('netlify/functions/')) return 'backend';
  if (path.startsWith('utils/')) return 'shared';
  if (path.startsWith('scripts/')) return 'tooling';
  if (path.startsWith('tests/')) return 'tests';
  if (path.startsWith('docs/')) return 'docs';
  if (path.startsWith('data/')) return 'data';
  if (path.startsWith('professional/') || path.startsWith('quant-screener') || path.startsWith('ai-analyst')) {
    return 'frontend';
  }
  if (path.endsWith('.html') || path.endsWith('.css')) return 'frontend';
  if (!path.includes('/')) return 'frontend';
  return 'other';
}

function formatSize(bytes) {
  if (!Number.isFinite(bytes)) return null;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

async function buildInventory() {
  const files = [];
  await walk(ROOT, async (absPath) => {
    const relPath = normalizePath(relative(ROOT, absPath));
    const ext = relPath.includes('.') ? `.${relPath.split('.').pop()}` : '';
    if (!TRACKED_EXTENSIONS.has(ext.toLowerCase())) return;
    if (relPath.startsWith('docs/peer-review/file-inventory.json')) return;
    const stat = await fs.stat(absPath);
    files.push({
      path: relPath,
      bytes: stat.size,
      size: formatSize(stat.size),
      category: classifyFile(relPath),
    });
  });
  files.sort((a, b) => a.path.localeCompare(b.path));

  const summary = { totalFiles: files.length, byCategory: {} };
  for (const category of CATEGORY_ORDER) {
    summary.byCategory[category] = files.filter((file) => file.category === category).length;
  }
  const otherCount = files.filter((file) => !CATEGORY_ORDER.includes(file.category)).length;
  if (otherCount > 0) summary.byCategory.other = (summary.byCategory.other || 0) + otherCount;

  const grouped = {};
  for (const file of files) {
    const key = CATEGORY_ORDER.includes(file.category) ? file.category : 'other';
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push({ path: file.path, size: file.size, bytes: file.bytes });
  }

  return {
    generatedAt: new Date().toISOString(),
    summary,
    files: grouped,
  };
}

async function main() {
  const inventory = await buildInventory();
  await fs.mkdir(OUTPUT_DIR, { recursive: true });
  await fs.writeFile(OUTPUT_FILE, `${JSON.stringify(inventory, null, 2)}\n`, 'utf8');
  console.log(`Wrote inventory for ${inventory.summary.totalFiles} files to ${relative(ROOT, OUTPUT_FILE)}`);
}

main().catch((error) => {
  console.error('Failed to generate peer review inventory:', error);
  process.exitCode = 1;
});
