import { promises as fs } from 'node:fs';
import path from 'node:path';

const DEFAULT_IGNORED_DIRECTORIES = new Set([
  '.git',
  'node_modules',
  'build',
  '.netlify',
  'coverage',
  'dist',
  '.cache',
]);

const MARKER_PATTERNS = [
  { marker: '<<<<<<<', regex: /^<{7}( |$)/ },
  { marker: '=======', regex: /^={7}( |$)/ },
  { marker: '>>>>>>>', regex: /^>{7}( |$)/ },
  { marker: '|||||||', regex: /^\|{7}( |$)/ },
];

const SKIPPED_FILE_EXTENSIONS = new Set([
  '.zip',
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.ico',
  '.pdf',
  '.woff',
  '.woff2',
  '.ttf',
  '.otf',
]);

const DEFAULT_MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB

function isProbablyBinary(buffer) {
  const length = Math.min(buffer.length, 8192);
  let suspicious = 0;

  for (let i = 0; i < length; i += 1) {
    const byte = buffer[i];
    if (byte === 0) {
      return true;
    }

    if (byte < 7 || (byte > 13 && byte < 32)) {
      suspicious += 1;
      if (suspicious / length > 0.3) {
        return true;
      }
    }
  }

  return false;
}

function detectConflictMarkers(line) {
  return MARKER_PATTERNS.filter(({ regex }) => regex.test(line)).map(({ marker }) => marker);
}

export async function scanForMergeConflicts(rootDir, options = {}) {
  if (!rootDir) {
    throw new Error('rootDir is required');
  }

  const {
    ignore = [],
    includeDotfiles = true,
    maxFileSize = DEFAULT_MAX_FILE_SIZE,
  } = options;

  const ignoredDirectories = new Set([...DEFAULT_IGNORED_DIRECTORIES, ...ignore]);
  const conflicts = [];

  async function walk(currentDir) {
    const entries = await fs.readdir(currentDir, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (ignoredDirectories.has(entry.name)) {
          continue;
        }
        if (!includeDotfiles && entry.name.startsWith('.')) {
          continue;
        }

        await walk(path.join(currentDir, entry.name));
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      if (!includeDotfiles && entry.name.startsWith('.')) {
        continue;
      }

      const filePath = path.join(currentDir, entry.name);
      const stats = await fs.stat(filePath);
      if (stats.size === 0) {
        continue;
      }

      if (typeof maxFileSize === 'number' && maxFileSize > 0 && stats.size > maxFileSize) {
        continue;
      }

      const extension = path.extname(entry.name).toLowerCase();
      if (SKIPPED_FILE_EXTENSIONS.has(extension)) {
        continue;
      }

      const buffer = await fs.readFile(filePath);
      if (isProbablyBinary(buffer)) {
        continue;
      }

      const content = buffer.toString('utf8');
      const lines = content.split(/\r?\n/);
      const fileConflicts = [];

      for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index];
        const markers = detectConflictMarkers(line);
        if (markers.length > 0) {
          fileConflicts.push({
            line: index + 1,
            markers,
            preview: line.trim(),
          });
        }
      }

      if (fileConflicts.length > 0) {
        conflicts.push({
          path: path.relative(rootDir, filePath) || entry.name,
          markers: fileConflicts,
        });
      }
    }
  }

  await walk(rootDir);

  conflicts.sort((a, b) => a.path.localeCompare(b.path));

  return conflicts;
}

export async function hasMergeConflicts(rootDir, options = {}) {
  const conflicts = await scanForMergeConflicts(rootDir, options);
  return conflicts.length > 0;
}

export const mergeConflictMarkers = MARKER_PATTERNS.map((pattern) => pattern.marker);
