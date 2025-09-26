#!/usr/bin/env node
import process from 'node:process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { scanForMergeConflicts, mergeConflictMarkers } from '../../utils/merge-conflict-scanner.js';

async function main() {
  const argv = new Set(process.argv.slice(2));
  const format = argv.has('--json') ? 'json' : 'text';
  const ignore = [];

  for (const arg of argv) {
    if (arg.startsWith('--ignore=')) {
      const [, value] = arg.split('=');
      if (value) {
        ignore.push(value);
      }
    }
  }

  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const rootDir = path.resolve(__dirname, '..', '..');

  try {
    const conflicts = await scanForMergeConflicts(rootDir, { ignore });

    if (conflicts.length === 0) {
      if (format === 'json') {
        process.stdout.write(JSON.stringify({ ok: true, conflicts: [] }, null, 2));
      } else {
        process.stdout.write('✅ No merge conflict markers detected.\n');
      }
      return;
    }

    if (format === 'json') {
      process.stdout.write(
        JSON.stringify(
          {
            ok: false,
            markers: mergeConflictMarkers,
            conflicts,
          },
          null,
          2,
        ),
      );
    } else {
      process.stdout.write(`❌ Detected merge conflict markers (${mergeConflictMarkers.join(', ')}).\n\n`);
      for (const conflict of conflicts) {
        process.stdout.write(`• ${conflict.path}\n`);
        for (const marker of conflict.markers) {
          process.stdout.write(`   - line ${marker.line}: ${marker.markers.join(', ')} → ${marker.preview}\n`);
        }
        process.stdout.write('\n');
      }
      process.stdout.write('Resolve the conflicts and re-run this command before continuing.\n');
    }

    process.exitCode = 1;
  } catch (error) {
    process.stderr.write(`Failed to scan for merge conflicts: ${error.message}\n`);
    process.exitCode = 2;
  }
}

main();
