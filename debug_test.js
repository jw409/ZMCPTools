import { DatabaseManager } from './dist/database/index.js';
import { ResourceManager } from './dist/managers/ResourceManager.js';
import { promises as fs } from 'fs';
import { join } from 'path';

const testDir = join(process.cwd(), 'test-debug-temp');
await fs.mkdir(testDir, { recursive: true });

// Create test file
await fs.writeFile(join(testDir, 'test.ts'), 'export const x = 1;');
await fs.writeFile(join(testDir, 'test.json'), '{"valid": true}');

const db = new DatabaseManager(join(testDir, 'test.db'));
await db.initialize();

const rm = new ResourceManager(db, testDir);

// Test structure
const structure = await rm.readResource('file://test.ts/structure');
console.log('=== STRUCTURE ===');
console.log('mimeType:', structure.mimeType);
console.log('text:', structure.text);
console.log('');

// Test JSON diagnostics
const jsonDiag = await rm.readResource('file://test.json/diagnostics');
console.log('=== JSON DIAGNOSTICS ===');
console.log('text:', jsonDiag.text);

await fs.rm(testDir, { recursive: true, force: true });
await db.close();
