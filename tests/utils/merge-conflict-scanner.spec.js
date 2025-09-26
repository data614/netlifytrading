import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  scanForMergeConflicts,
  hasMergeConflicts,
  mergeConflictMarkers,
} from '../../utils/merge-conflict-scanner.js';

async function makeTempDir() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'merge-conflict-scanner-'));
  return dir;
}

async function cleanupTempDir(directory) {
  await fs.rm(directory, { recursive: true, force: true });
}

describe('merge conflict scanner', () => {
  let tempDir;

  beforeEach(async () => {
    tempDir = await makeTempDir();
  });

  afterEach(async () => {
    if (tempDir) {
      await cleanupTempDir(tempDir);
      tempDir = undefined;
    }
  });

  it('returns an empty array when no conflict markers are present', async () => {
    const target = path.join(tempDir, 'clean.txt');
    await fs.writeFile(target, 'The quick brown fox jumps over the lazy dog.');

    const conflicts = await scanForMergeConflicts(tempDir);
    expect(conflicts).toEqual([]);
  });

  it('detects merge conflict markers with line numbers', async () => {
    const target = path.join(tempDir, 'conflict.txt');
    const content = [
      'function example() {',
      '<<<<<<< HEAD',
      "  return 'alpha';",
      '=======',
      "  return 'beta';",
      '>>>>>>> feature-branch',
      '}',
      '',
    ].join('\n');
    await fs.writeFile(target, content);

    const conflicts = await scanForMergeConflicts(tempDir);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].path).toBe('conflict.txt');
    const lineNumbers = conflicts[0].markers.map((marker) => marker.line);
    expect(lineNumbers).toEqual([2, 4, 6]);
    expect(conflicts[0].markers[0].markers).toEqual(['<<<<<<<']);
  });

  it('skips binary files and compressed assets', async () => {
    const binaryTarget = path.join(tempDir, 'image.png');
    const binaryContent = Buffer.from([0, 120, 3, 255, 17, 42, 0, 5]);
    await fs.writeFile(binaryTarget, binaryContent);

    const conflicts = await scanForMergeConflicts(tempDir);
    expect(conflicts).toEqual([]);
  });

  it('respects the ignore option', async () => {
    const ignoredDirectory = path.join(tempDir, 'ignored');
    await fs.mkdir(ignoredDirectory);
    await fs.writeFile(
      path.join(ignoredDirectory, 'conflict.txt'),
      ['<<<<<<< ours', '=======', '>>>>>>> theirs'].join('\n'),
    );

    const conflicts = await scanForMergeConflicts(tempDir, { ignore: ['ignored'] });
    expect(conflicts).toEqual([]);
  });

  it('reports presence of conflicts through hasMergeConflicts', async () => {
    const target = path.join(tempDir, 'conflict.txt');
    await fs.writeFile(target, ['<<<<<<< ours', '=======', '>>>>>>> theirs'].join('\n'));

    const hasConflicts = await hasMergeConflicts(tempDir);
    expect(hasConflicts).toBe(true);
  });

  it('exposes mergeConflictMarkers constant for reporting', () => {
    expect(mergeConflictMarkers).toEqual(['<<<<<<<', '=======', '>>>>>>>', '|||||||']);
  });
});
