# Agent Verification Checklist

**Purpose**: Prevent slippage where agents produce documentation instead of code.

## Root Cause Analysis

**Incident**: Issue #35 multi-partition knowledge graph feature
- Agent was asked to "design and implement"
- Agent returned comprehensive design doc with code snippets
- I marked task as complete without verifying files were modified
- Feature appeared complete but wasn't actually coded

**Why it happened**:
1. No explicit "write code" vs "plan code" distinction in agent prompts
2. Agent output looked complete (had code snippets formatted as if written)
3. No automated post-agent verification
4. Human acceptance without file change verification

## Verification Checklist (Use After EVERY Agent Task)

### 1. File Modification Check ✓
```bash
# Did the agent actually modify files?
git status
git diff

# If no changes: AGENT FAILED - only produced documentation
```

### 2. Expected Functions/Methods Present ✓
```bash
# Does the code contain the expected new functions?
grep -n "function_name" path/to/file.ts

# If not found: AGENT FAILED - didn't write the code
```

### 3. Build Success ✓
```bash
# Does the code compile?
npm run build

# If build fails: AGENT FAILED - wrote broken code
```

### 4. Test Coverage ✓
```bash
# Did the agent write tests (if applicable)?
ls test/**/*test.ts | grep feature_name

# Run tests
npm test

# If tests missing or fail: AGENT INCOMPLETE
```

### 5. Feature Works in Practice ✓
```bash
# Can you actually use the feature?
# Test the actual MCP resource/tool/endpoint

# Example for knowledge://status?repository_path=X:
# 1. Start server
# 2. Query resource with parameter
# 3. Verify response uses the parameter

# If doesn't work: AGENT FAILED - code is broken
```

### 6. Documentation Updated ✓
```bash
# Did the agent update relevant docs?
git diff README.md TOOL_LIST.md etc/

# If docs missing: AGENT INCOMPLETE - works but not documented
```

## Agent Prompt Improvements

### Bad Prompt (Ambiguous)
```
Design and implement multi-partition knowledge graph support with repository_path parameter.
```

**Problem**: Agent interprets as "design WITH implementation examples" not "actually implement"

### Good Prompt (Explicit)
```
WRITE CODE to implement multi-partition knowledge graph support.

Required deliverables:
1. Modify ResourceManager.ts getKnowledgeStatus() method to accept repository_path parameter
2. Update readResource() switch case to pass searchParams
3. Add 2 tests in test/resources/knowledgeGraph.test.ts
4. Build must succeed
5. Tests must pass

VERIFICATION: I will check git diff to confirm files were modified.
If you only produce documentation, the task FAILS.
```

**Better**: Explicit code modification requirement, specific files, automated verification mentioned

## Post-Agent Verification Protocol

**MANDATORY steps after agent completes**:

1. ✅ Run `git status` - verify files changed
2. ✅ Run `git diff` - verify changes match expected functions/methods
3. ✅ Run `npm run build` - verify code compiles
4. ✅ Run `npm test` (or specific test) - verify tests pass
5. ✅ Manually test feature - verify it actually works
6. ✅ Check docs - verify documentation updated

**If ANY step fails**: Mark agent task as INCOMPLETE, provide feedback, re-run

## Example: Catching the Repository Path Bug

**What should have been done**:

```bash
# Step 1: Check modifications
git status
# Expected: src/managers/ResourceManager.ts modified
# Actual: No files modified ❌ FAIL

# Step 2 would have been: grep for new parameter
grep "repository_path" src/managers/ResourceManager.ts
# Expected: searchParams?.get("repository_path")
# Actual: Not found ❌ FAIL

# Step 5 would have been: Test the feature
curl -X POST localhost:3000/resources/read \
  -d '{"uri": "knowledge://status?repository_path=/test"}'
# Expected: Response with /test partition
# Actual: Ignores parameter ❌ FAIL
```

**All 3 checks would have caught the issue immediately**

## Integration with CI/CD

```yaml
# .github/workflows/verify-agent-work.yml
name: Verify Agent Work

on: [pull_request]

jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3

      - name: Check files modified
        run: |
          if [ -z "$(git diff --name-only origin/main)" ]; then
            echo "❌ No files modified - agent likely only produced docs"
            exit 1
          fi

      - name: Build check
        run: npm run build

      - name: Test check
        run: npm test

      - name: Feature smoke test
        run: |
          # Start server, test new feature, verify it works
          npm run start &
          sleep 5
          curl localhost:3000/health || exit 1
```

## Lessons Learned

1. **Never trust agent output without verification** - even if it looks complete
2. **git diff is your friend** - always check what actually changed
3. **Test the feature manually** - don't assume code that looks right works
4. **Explicit prompts matter** - "write code" ≠ "design and implement"
5. **Automated checks catch human error** - verification should be scripted

## Template for Future Agent Tasks

```
TASK: [Clear description]

DELIVERABLES (CODE - NOT DOCUMENTATION):
1. Modify file X: Add function Y
2. Modify file Z: Add test for Y
3. Build succeeds
4. Tests pass
5. Feature works when manually tested

VERIFICATION CHECKLIST:
- [ ] git status shows files modified
- [ ] git diff shows expected code changes
- [ ] npm run build succeeds
- [ ] npm test passes
- [ ] Manual feature test passes
- [ ] Documentation updated

IMPORTANT: If you only produce documentation/design, the task FAILS.
I will verify with git diff that code was actually written.
```

---

**Enforcement**: This checklist is MANDATORY for all future agent-assisted work on this project.
