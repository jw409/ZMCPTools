# GitHub Issues & Labels Guide

**Purpose**: Authoritative reference for GitHub operations - labels, issues, automation rules, and best practices.

---

## Available Labels

**Source of truth**: `gh label list` (run before EVERY label operation)

### Standard Labels

| Label | Color | Use Case | Example |
|-------|-------|----------|---------|
| `bug` | #d73a4a | Something broken/incorrect | "SymbolGraphIndexer crashes on Python files" |
| `enhancement` | #a2eeef | New feature or improvement | "Add LanceDB semantic search to SymbolGraphIndexer" |
| `documentation` | #0075ca | Docs only (no code) | "Update EMBEDDING_STRATEGY.md with Qwen3 benchmarks" |
| `question` | #d876e3 | Request for information | "How does bubble-up pattern work in LanceDB?" |
| `help wanted` | #008672 | Community contribution welcome | "Port TreeSitter to support Rust files" |
| `good first issue` | #7057ff | Newcomer-friendly task | "Add tests for BM25Service.search()" |
| `duplicate` | #cfd3d7 | Already exists elsewhere | Close with comment linking to original |
| `invalid` | #e4e669 | Not actionable or wrong | "Requesting feature X (out of scope)" |
| `wontfix` | #ffffff | Intentionally not doing | "Support IE11 (project is CLI-only)" |

### Project-Specific Labels

| Label | Color | Use Case | Authority |
|-------|-------|----------|-----------|
| `vision-critical` | #ff4444 | Core architecture/vision alignment | Reserved for foundational decisions |
| `talent-architecture` | #2980b9 | Talent vs agent distinction | spawn_talent implementation, domU/dom0 |

---

## Label Selection Rules

### Decision Tree

```
Is it broken/wrong? → bug
  └─ Example: "IndexStats.indexedFiles missing" (#45 validation)

Is it a new feature/improvement? → enhancement
  └─ Example: "SymbolGraphIndexer semantic search" (#47)

Is it docs-only (no code)? → documentation
  └─ Example: "Document export detection pattern"

Does it affect core TalentOS vision? → vision-critical
  └─ Example: "Redefine spawn_talent vs spawn_agent semantics"

Is it about talent architecture? → talent-architecture
  └─ Example: "Implement domU worker isolation"

Need community help? → help wanted
  └─ Example: "Port AST tool to support Go language"

Is it beginner-friendly? → good first issue
  └─ Example: "Add JSDoc comments to BM25Service methods"

Asking for clarification? → question
  └─ Example: "Where should LanceDB files be stored?"
```

### Multi-Label Guidance

✅ **Valid Combinations**:
- `bug` + `help wanted` - Known bug, contributors welcome
- `enhancement` + `vision-critical` - New feature that affects core architecture
- `enhancement` + `good first issue` - Easy feature to implement
- `documentation` + `help wanted` - Docs need community input

❌ **Invalid Combinations**:
- `bug` + `enhancement` - Pick one: is it broken or new?
- `wontfix` + `help wanted` - Contradictory signals
- `duplicate` + any other label - Duplicates should just close

---

## Issue Creation Protocol

### ALWAYS Run First

```bash
# Check available labels (NEVER guess!)
gh label list

# Check if similar issue exists
gh issue list --search "keyword"
```

### Standard Issue Creation

```bash
# Single label (most common)
gh issue create \
  --title "Clear, specific title" \
  --body "$(cat <<'EOF'
## Problem
[What's wrong or what's needed]

## Expected Behavior
[What should happen]

## Current Behavior
[What actually happens]

## References
- Related: #42
- Commit: abc123
- File: src/services/Example.ts:123
EOF
)" \
  --label "enhancement"

# Multiple labels
gh issue create \
  --title "Port TreeSitter to Rust" \
  --label "enhancement" \
  --label "help wanted"
```

### Issue Body Best Practices

**Minimum viable issue**:
```markdown
## Context
Brief explanation (1-2 sentences)

## Task
Specific deliverable

## Success Criteria
- [ ] Checkbox 1
- [ ] Checkbox 2

## References
- Related: #X
- File: path/to/file.ts:line
```

**DO**:
- ✅ Link to specific files with line numbers
- ✅ Reference related issues with `#number`
- ✅ Include code snippets for bugs
- ✅ List concrete success criteria
- ✅ Specify affected commit/branch

**DON'T**:
- ❌ Vague titles like "Fix stuff" or "Improvements needed"
- ❌ Mix multiple unrelated requests in one issue
- ❌ Forget to link to relevant code/docs
- ❌ Use labels that don't exist (check first!)

---

## Common Anti-Patterns

### ❌ Anti-Pattern: Non-Existent Labels

**Bad**:
```bash
gh issue create \
  --label "semantic-search"  # Label doesn't exist!
```

**Error**: `could not add label: 'semantic-search' not found`

**Fix**:
```bash
# Always check first!
gh label list

# Use standard label
gh issue create \
  --label "enhancement"
```

### ❌ Anti-Pattern: Label Guessing

**Bad**: Assume labels like "performance", "refactor", "testing" exist

**Good**: Run `gh label list`, use what's actually available

### ❌ Anti-Pattern: Over-Labeling

**Bad**:
```bash
--label "bug" \
--label "enhancement" \
--label "documentation" \
--label "question"
```

**Good**: Pick 1-2 labels that clearly categorize the issue

### ❌ Anti-Pattern: Vague Issue Titles

**Bad**:
- "Fix code"
- "Update things"
- "Implement feature"

**Good**:
- "Fix IndexStats.indexedFiles missing property in SymbolGraphIndexer"
- "Add LanceDB semantic search to SymbolGraphIndexer"
- "Implement export detection via ast_extract_exports"

---

## Issue Management

### Closing Issues

```bash
# Close with comment
gh issue close 45 --comment "Implementation complete in commit abc123"

# Close as duplicate
gh issue close 47 --comment "Duplicate of #45"

# Close as wontfix
gh issue close 48 --comment "Out of scope for this project"
```

### Commenting on Issues

```bash
# Add progress update
gh issue comment 45 --body "$(cat <<'EOF'
## Progress Update

✅ Completed:
- IndexStats interface fixed
- searchSemantic() implemented

🚧 In Progress:
- CodeAcquisitionService migration

📋 Remaining:
- Export detection
- Test validation
EOF
)"

# Link commits to issues
gh issue comment 45 --body "Fixed in commit abc123"
```

### Transferring Issues

```bash
# Transfer to different repo (if needed)
gh issue transfer 45 --repo target-owner/target-repo
```

---

## Integration with Workflow

### Commit Messages Linking to Issues

```bash
# Reference issue
git commit -m "feat: Add semantic search (refs #47)"

# Close issue from commit
git commit -m "fix: Add IndexStats.indexedFiles property

Closes #45"

# Multiple issues
git commit -m "feat: Complete SymbolGraphIndexer implementation

Fixes #45
Related to #47"
```

### Pull Request Linking

```bash
# PR that closes issue
gh pr create \
  --title "Implement SymbolGraphIndexer" \
  --body "Closes #45" \
  --base main

# PR that relates to issue
gh pr create \
  --title "Refactor BM25Service" \
  --body "Related to #45 (performance optimization)" \
  --base main
```

---

## Automation & CI Integration

### GitHub Actions Label Triggers

```yaml
# Example: Auto-label based on files changed
name: Auto-Label
on: [pull_request]
jobs:
  label:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/labeler@v4
        with:
          configuration-path: .github/labeler.yml
```

### Issue Templates (Future)

```markdown
<!-- .github/ISSUE_TEMPLATE/bug_report.md -->
---
name: Bug Report
about: Report a bug or incorrect behavior
labels: bug
---

## Bug Description
[Clear description of what's wrong]

## Steps to Reproduce
1. Step 1
2. Step 2

## Expected Behavior
[What should happen]

## Actual Behavior
[What actually happens]

## Environment
- OS: [e.g., Ubuntu 22.04]
- Node: [e.g., 18.16.0]
- Commit: [e.g., abc123]
```

---

## Discovery Protocol

**BEFORE creating ANY issue**:

1. **Check available labels**:
   ```bash
   gh label list
   ```

2. **Search for duplicates**:
   ```bash
   gh issue list --search "keyword"
   ```

3. **Review recent issues**:
   ```bash
   gh issue list --limit 20
   ```

4. **Check closed issues**:
   ```bash
   gh issue list --state closed --search "keyword"
   ```

---

## Label Management (Admin Only)

### Creating New Labels

```bash
# Only create labels for recurring patterns
gh label create "performance" \
  --description "Performance optimization tasks" \
  --color "fbca04"
```

### Modifying Labels

```bash
# Update label description
gh label edit "enhancement" \
  --description "New feature or improvement request"

# Change label color
gh label edit "bug" --color "d73a4a"
```

### Deleting Labels

```bash
# Remove unused labels
gh label delete "old-label"
```

**Rule**: Before creating custom labels, discuss in issue/PR. Standard labels cover 95% of use cases.

---

## Examples from ZMCPTools History

### ✅ Good: Issue #45 (SymbolGraphIndexer)

**What worked**:
- Clear title: "Implement SymbolGraphIndexer for intelligent code search"
- Detailed problem statement with crash logs
- Specific architecture requirements (SQLite schema, BM25 separation)
- Success criteria with measurable goals (<5s search, >95% cache hit)
- Prototype linked for validation
- Used standard `enhancement` label

### ✅ Good: Issue #47 (Semantic Search Follow-up)

**What worked**:
- Scoped to single feature (LanceDB integration)
- Clear implementation steps (3 sections with code examples)
- Referenced parent issue (#45)
- Testing requirements specified
- Estimated effort (2-3 hours)
- Used standard `enhancement` label

### ❌ Bad: Attempted Label "semantic-search"

**What went wrong**:
- Label didn't exist in repo
- Assumed label without checking `gh label list`
- Created error: `could not add label: 'semantic-search' not found`

**Fix**:
- Always run `gh label list` first
- Use standard `enhancement` label
- Custom labels require admin discussion

---

## Best Practices Summary

### DO

✅ **Always check labels before using**:
```bash
gh label list
```

✅ **Search for duplicates before creating**:
```bash
gh issue list --search "keyword"
```

✅ **Use clear, specific titles**:
- Good: "Fix IndexStats.indexedFiles missing in SymbolGraphIndexer"
- Bad: "Fix code"

✅ **Include file references with line numbers**:
```markdown
Location: src/services/SymbolGraphIndexer.ts:81
```

✅ **Link related issues**:
```markdown
Closes #45
Related to #47
Refs #42
```

✅ **Specify success criteria**:
```markdown
## Success Criteria
- [ ] Tests pass
- [ ] Build succeeds
- [ ] Feature works manually
```

### DON'T

❌ **Don't guess label names** - check `gh label list` first

❌ **Don't create vague issues** - be specific about file/function/line

❌ **Don't mix multiple unrelated requests** - one issue per concern

❌ **Don't forget to close related issues** - use "Closes #X" in commits

❌ **Don't over-label** - 1-2 labels is usually enough

---

## Troubleshooting

### Error: Label Not Found

```bash
# Symptom
could not add label: 'semantic-search' not found

# Diagnosis
gh label list | grep semantic
# Returns nothing

# Fix
gh label list  # See what's actually available
gh issue create --label "enhancement"  # Use standard label
```

### Error: Issue Already Exists

```bash
# Check for duplicates
gh issue list --search "SymbolGraphIndexer"

# If duplicate found
gh issue comment 47 --body "Duplicate of #45"
gh issue close 47
```

### Can't Edit Label (Permission Denied)

```bash
# Only repo admins can manage labels
# Request admin to create/modify labels
# Or use existing standard labels
```

---

## Quick Reference

### Essential Commands

```bash
# List available labels
gh label list

# Search issues
gh issue list --search "keyword"

# Create issue with label
gh issue create --title "Title" --label "enhancement"

# Comment on issue
gh issue comment 45 --body "Update message"

# Close issue
gh issue close 45 --comment "Done in abc123"

# View issue
gh issue view 45
```

### Label Quick Lookup

```
bug            → Something broken
enhancement    → New feature
documentation  → Docs only
help wanted    → Need contributors
good first issue → Beginner-friendly
vision-critical → Core architecture
```

---

**Last Updated**: 2025-10-08 (Post-SymbolGraphIndexer implementation)

**Status**: Production reference - use for ALL GitHub operations

**Authority**: Run `gh label list` for current labels (this doc may lag)
