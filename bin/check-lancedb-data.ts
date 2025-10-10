#!/usr/bin/env tsx
import * as lancedb from '@lancedb/lancedb';

async function main() {
  try {
    const db = await lancedb.connect('var/storage/lancedb');
    const tables = await db.tableNames();
    console.log(`\nLanceDB tables: ${JSON.stringify(tables)}`);

    if (tables.length === 0) {
      console.log('❌ No tables found!');
      return;
    }

    for (const tableName of tables) {
      const table = await db.openTable(tableName);
      const count = await table.countRows();
      console.log(`\nTable: ${tableName}`);
      console.log(`  Row count: ${count}`);

      // Search for expected source files
      const allRows = await table.query().limit(count).toArray();

      // Check for specific target files
      const targetFiles = ['LanceDBService', 'BM25Service', 'PartitionClassifier'];
      console.log(`\n  Searching for target files:`);
      for (const target of targetFiles) {
        const found = allRows.find((r: any) => r.id.includes(target));
        if (found) {
          console.log(`    ✅ ${target}: ${found.id}`);
        } else {
          console.log(`    ❌ ${target}: NOT FOUND`);
        }
      }

      const sourceFiles = allRows.filter((r: any) =>
        r.id.includes('LanceDB') ||
        r.id.includes('Partition') ||
        r.id.includes('BM25') ||
        r.id.includes('Service.ts')
      );

      console.log(`  Found ${sourceFiles.length} source files out of ${count} total`);
      console.log(`  Source files:`);
      sourceFiles.slice(0, 10).forEach((row: any) => {
        console.log(`    - ${row.id}`);
      });

      if (sourceFiles.length === 0) {
        console.log(`\n  ⚠️  No source files found! Showing sample of what IS indexed:`);
        const sample = allRows.slice(0, 10);
        sample.forEach((row: any) => {
          console.log(`    - ${row.id}`);
        });
      }
    }
  } catch (error) {
    console.error('Error:', error);
  }
}

main();
