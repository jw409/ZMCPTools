#!/usr/bin/env tsx
/**
 * Populate the 'github_issues' collection with GitHub issues + comments
 * Uses gh CLI to fetch issues/comments from the repository
 */

import { execSync } from 'child_process';
import { DatabaseConnectionManager } from '../src/database/index.js';
import { VectorSearchService } from '../src/services/VectorSearchService.js';

interface GitHubIssue {
  number: number;
  title: string;
  body: string;
  state: string;
  labels: string[];
  created_at: string;
  updated_at: string;
  url: string;
}

interface GitHubComment {
  body: string;
  created_at: string;
  author: string;
}

function fetchIssues(): GitHubIssue[] {
  try {
    const output = execSync('gh issue list --limit 100 --state all --json number,title,body,state,labels,createdAt,updatedAt,url', {
      encoding: 'utf-8',
      cwd: process.cwd()
    });

    return JSON.parse(output).map((issue: any) => ({
      number: issue.number,
      title: issue.title,
      body: issue.body || '',
      state: issue.state,
      labels: issue.labels.map((l: any) => l.name),
      created_at: issue.createdAt,
      updated_at: issue.updatedAt,
      url: issue.url
    }));
  } catch (error: any) {
    console.error('❌ Error fetching issues:', error.message);
    return [];
  }
}

function fetchIssueComments(issueNumber: number): GitHubComment[] {
  try {
    const output = execSync(`gh issue view ${issueNumber} --json comments`, {
      encoding: 'utf-8',
      cwd: process.cwd()
    });

    const data = JSON.parse(output);
    return data.comments.map((comment: any) => ({
      body: comment.body,
      created_at: comment.createdAt,
      author: comment.author?.login || 'unknown'
    }));
  } catch (error: any) {
    // Silent fail for issues without comments
    return [];
  }
}

async function main() {
  console.log('🐙 Populating github_issues collection...\n');

  // Fetch all issues
  console.log('📥 Fetching GitHub issues...');
  const issues = fetchIssues();
  console.log(`Found ${issues.length} issues\n`);

  if (issues.length === 0) {
    console.log('⚠️  No issues found. Is this a git repository with GitHub remote?');
    return;
  }

  // Initialize database and vector service
  const db = await DatabaseConnectionManager.getInstance();
  console.log('✅ Database initialized\n');

  const vectorService = new VectorSearchService(db, {
    embeddingModel: 'gemma_embed'
  });
  await vectorService.initialize();
  console.log('✅ VectorSearchService initialized\n');

  console.log('📝 Indexing issues and comments...\n');

  let indexed = 0;
  let errors = 0;

  for (const issue of issues) {
    try {
      // Fetch comments for this issue
      const comments = fetchIssueComments(issue.number);

      // Combine issue body and comments into single document
      const issueContent = `# ${issue.title}\n\n${issue.body}`;
      const commentsContent = comments.length > 0
        ? '\n\n## Comments\n\n' + comments.map(c => `**${c.author}**: ${c.body}`).join('\n\n')
        : '';

      const fullContent = issueContent + commentsContent;

      // Skip empty issues
      if (fullContent.trim().length < 50) {
        console.log(`⏭️  Skipping #${issue.number} (too small)`);
        continue;
      }

      await vectorService.addDocuments('github_issues', [{
        id: `issue-${issue.number}`,
        content: fullContent,
        metadata: {
          issue_number: issue.number,
          title: issue.title,
          state: issue.state,
          labels: issue.labels.join(','),
          created_at: issue.created_at,
          updated_at: issue.updated_at,
          url: issue.url,
          comment_count: comments.length,
          type: 'github_issue',
          indexed_at: new Date().toISOString()
        }
      }]);

      indexed++;
      console.log(`✅ [${indexed}/${issues.length}] #${issue.number}: ${issue.title} (${comments.length} comments)`);

    } catch (error: any) {
      errors++;
      console.error(`❌ Error indexing #${issue.number}:`, error.message);
    }
  }

  console.log(`\n📊 Summary:`);
  console.log(`   Indexed: ${indexed}`);
  console.log(`   Errors: ${errors}`);
  console.log(`   Total: ${issues.length}`);

  // Test search
  console.log(`\n🔍 Testing semantic search on "search benchmark" query...`);

  try {
    const results = await vectorService.search(
      'search benchmark embedding performance',
      'github_issues',
      5,
      0.5
    );

    console.log(`\n📋 Top 5 issues for "search benchmark embedding performance":`);
    results.forEach((r: any, i: number) => {
      console.log(`\n${i + 1}. #${r.metadata?.issue_number}: ${r.metadata?.title} (similarity: ${r.similarity?.toFixed(3)})`);
      console.log(`   State: ${r.metadata?.state} | Labels: ${r.metadata?.labels}`);
      console.log(`   ${r.content.slice(0, 150)}...`);
    });
  } catch (error: any) {
    console.error(`❌ Search test failed:`, error.message);
  }

  console.log('\n✅ GitHub issues collection populated!');
}

main().catch(console.error);
