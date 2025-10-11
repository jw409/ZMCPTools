#!/usr/bin/env tsx
/**
 * Populate the 'documentation' collection with project docs
 * Tests semantic search on conceptual content (should work better than 2% code recall)
 */

import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative, extname } from 'path';
import { DatabaseConnectionManager } from '../src/database/index.js';
import { VectorSearchService } from '../src/services/VectorSearchService.js';

async function findMarkdownFiles(dir: string, basePath: string): Promise<Array<{ path: string; relativePath: string }>> {
  const files: Array<{ path: string; relativePath: string }> = [];

  try {
    const entries = readdirSync(dir);

    for (const entry of entries) {
      const fullPath = join(dir, entry);
      const stat = statSync(fullPath);

      if (stat.isDirectory()) {
        // Recurse into subdirectories (skip node_modules, dist, .git)
        if (!['node_modules', 'dist', '.git', 'var'].includes(entry)) {
          files.push(...await findMarkdownFiles(fullPath, basePath));
        }
      } else if (stat.isFile() && extname(entry) === '.md') {
        files.push({
          path: fullPath,
          relativePath: relative(basePath, fullPath)
        });
      }
    }
  } catch (error: any) {
    console.error(`⚠️  Error reading ${dir}:`, error.message);
  }

  return files;
}

async function main() {
  console.log('📚 Populating documentation collection...\n');

  const projectRoot = process.cwd();
  console.log(`Project root: ${projectRoot}`);

  // Find all markdown files
  const docs = [
    ...await findMarkdownFiles(join(projectRoot, 'etc'), projectRoot),
    ...await findMarkdownFiles(join(projectRoot, 'docs'), projectRoot),
  ];

  // Add root-level markdown files
  for (const file of readdirSync(projectRoot)) {
    if (extname(file) === '.md') {
      docs.push({
        path: join(projectRoot, file),
        relativePath: file
      });
    }
  }

  console.log(`Found ${docs.length} markdown files\n`);

  // Initialize database and vector search service
  const db = await DatabaseConnectionManager.getInstance();
  console.log('✅ Database initialized\n');

  // Initialize VectorSearchService
  const vectorService = new VectorSearchService(db, {
    embeddingModel: 'gemma_embed'
  });
  await vectorService.initialize();
  console.log('✅ VectorSearchService initialized\n');

  console.log('📝 Indexing documents...\n');

  let indexed = 0;
  let errors = 0;

  for (const doc of docs) {
    try {
      const content = readFileSync(doc.path, 'utf-8');

      // Skip empty files and very small files
      if (content.trim().length < 50) {
        console.log(`⏭️  Skipping ${doc.relativePath} (too small)`);
        continue;
      }

      // Extract title from first heading or filename
      const titleMatch = content.match(/^#\s+(.+)$/m);
      const title = titleMatch ? titleMatch[1] : doc.relativePath.replace('.md', '');

      await vectorService.addDocuments('documentation', [{
        id: `doc-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
        content: content,
        metadata: {
          file_path: doc.path,
          relative_path: doc.relativePath,
          title: title,
          type: 'documentation',
          indexed_at: new Date().toISOString()
        }
      }]);

      indexed++;
      console.log(`✅ [${indexed}/${docs.length}] ${doc.relativePath}`);

    } catch (error: any) {
      errors++;
      console.error(`❌ Error indexing ${doc.relativePath}:`, error.message);
    }
  }

  // Database connection manager is singleton, no need to close

  console.log(`\n📊 Summary:`);
  console.log(`   Indexed: ${indexed}`);
  console.log(`   Errors: ${errors}`);
  console.log(`   Total: ${docs.length}`);

  // Test search
  console.log(`\n🔍 Testing semantic search on "authentication" query...`);

  try {
    const results = await vectorService.search(
      'authentication and authorization',
      'documentation',
      5,
      0.5
    );

    console.log(`\n📋 Top 5 results for "authentication and authorization":`);
    results.forEach((r: any, i: number) => {
      console.log(`\n${i + 1}. ${r.metadata?.title || r.metadata?.relative_path} (similarity: ${r.similarity?.toFixed(3)})`);
      console.log(`   ${r.content.slice(0, 150)}...`);
    });
  } catch (error: any) {
    console.error(`❌ Search test failed:`, error.message);
  }
  console.log('\n✅ Documentation collection populated!');
}

main().catch(console.error);
