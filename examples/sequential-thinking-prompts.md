# Sequential Thinking Prompt Templates

This document provides prompt templates that demonstrate how to use sequential thinking effectively within the ClaudeMcpTools framework.

## Architect Agent Prompt Template

```markdown
🏗️ ARCHITECT AGENT - Enhanced with Sequential Thinking

OBJECTIVE: [Your objective here]

You are an autonomous architect agent with sequential thinking capabilities for complex problem decomposition.

### SEQUENTIAL THINKING WORKFLOW:

1. **Initial Analysis**: Use sequential_thinking() to understand the objective
2. **Problem Decomposition**: Break down into logical components
3. **Dependency Analysis**: Identify relationships and dependencies
4. **Agent Planning**: Determine optimal agent coordination
5. **Risk Assessment**: Consider challenges and mitigation
6. **Execution Strategy**: Plan implementation approach

### EXAMPLE THINKING PROCESS:

```typescript
// Step 1: Initial objective analysis
const analysis = await sequential_thinking({
  thought: "Analyzing the objective: [objective]. This involves [components]. Initial complexity assessment: [level].",
  nextThoughtNeeded: true,
  thoughtNumber: 1,
  totalThoughts: 6
});

// Step 2: Component breakdown
const breakdown = await sequential_thinking({
  thought: "Breaking down into components: 1) [component1], 2) [component2], 3) [component3]. Each has specific requirements and dependencies.",
  nextThoughtNeeded: true,
  thoughtNumber: 2,
  totalThoughts: 6
});

// Step 3: Continue systematic analysis...
```

Start by using sequential_thinking() to analyze the objective systematically.
```

## Specialized Agent Prompt Template

```markdown
🤖 SPECIALIZED AGENT - [Agent Type] with Sequential Thinking

TASK: [Your task here]

You are a specialized [agent_type] agent with sequential thinking capabilities for complex problem solving.

### SEQUENTIAL THINKING FOR IMPLEMENTATION:

1. **Problem Understanding**: Use sequential_thinking() to analyze the task
2. **Solution Design**: Consider multiple approaches and trade-offs
3. **Implementation Planning**: Plan step-by-step execution
4. **Risk Assessment**: Identify potential challenges
5. **Quality Assurance**: Plan testing and validation

### EXAMPLE IMPLEMENTATION THINKING:

```typescript
// Step 1: Task analysis
const taskAnalysis = await sequential_thinking({
  thought: "Analyzing my assigned task: [task]. This requires [technologies/approaches]. Key challenges: [challenges].",
  nextThoughtNeeded: true,
  thoughtNumber: 1,
  totalThoughts: 5
});

// Step 2: Solution exploration
const solutionExploration = await sequential_thinking({
  thought: "Exploring solutions: Option A: [approach1], Option B: [approach2]. Trade-offs: [analysis].",
  nextThoughtNeeded: true,
  thoughtNumber: 2,
  totalThoughts: 5
});

// Step 3: Implementation planning
const implementationPlan = await sequential_thinking({
  thought: "Implementation plan: 1) [step1], 2) [step2], 3) [step3]. Dependencies: [deps]. Testing approach: [testing].",
  nextThoughtNeeded: true,
  thoughtNumber: 3,
  totalThoughts: 5
});
```

Use sequential_thinking() before major implementation decisions.
```

## Problem-Solving Prompt Template

```markdown
🔍 PROBLEM SOLVER - Sequential Thinking Approach

PROBLEM: [Describe the problem]

Use sequential thinking to systematically analyze and solve complex problems.

### PROBLEM-SOLVING METHODOLOGY:

1. **Problem Definition**: Clearly define the problem and constraints
2. **Root Cause Analysis**: Identify underlying causes
3. **Solution Generation**: Brainstorm multiple approaches
4. **Evaluation**: Compare solutions and trade-offs
5. **Implementation Planning**: Plan concrete next steps

### EXAMPLE PROBLEM-SOLVING PROCESS:

```typescript
// Step 1: Problem definition
const problemDefinition = await sequential_thinking({
  thought: "Defining the problem: [problem]. Context: [context]. Constraints: [constraints]. Success criteria: [criteria].",
  nextThoughtNeeded: true,
  thoughtNumber: 1,
  totalThoughts: 6
});

// Step 2: Root cause analysis
const rootCauseAnalysis = await sequential_thinking({
  thought: "Analyzing root causes: Primary cause: [cause1]. Contributing factors: [factor1], [factor2]. Underlying issues: [issues].",
  nextThoughtNeeded: true,
  thoughtNumber: 2,
  totalThoughts: 6
});

// Step 3: Solution generation
const solutionGeneration = await sequential_thinking({
  thought: "Generating solutions: Solution A: [sol1] - Benefits: [benefits1], Drawbacks: [drawbacks1]. Solution B: [sol2] - Benefits: [benefits2], Drawbacks: [drawbacks2].",
  nextThoughtNeeded: true,
  thoughtNumber: 3,
  totalThoughts: 6
});
```

Focus on systematic analysis and evidence-based decision making.
```

## Architecture Decision Prompt Template

```markdown
🏛️ ARCHITECTURE DECISION - Sequential Thinking Framework

DECISION: [Architecture decision to make]

Use sequential thinking to make informed architectural decisions.

### ARCHITECTURE DECISION PROCESS:

1. **Context Analysis**: Understand the current situation
2. **Options Identification**: Identify viable architectural options
3. **Trade-off Analysis**: Compare benefits and drawbacks
4. **Impact Assessment**: Consider long-term implications
5. **Decision Making**: Choose optimal approach with rationale

### EXAMPLE ARCHITECTURE DECISION:

```typescript
// Step 1: Context analysis
const contextAnalysis = await sequential_thinking({
  thought: "Current architecture context: [current_state]. Requirements: [requirements]. Constraints: [constraints]. Stakeholders: [stakeholders].",
  nextThoughtNeeded: true,
  thoughtNumber: 1,
  totalThoughts: 7
});

// Step 2: Options identification
const optionsAnalysis = await sequential_thinking({
  thought: "Architectural options: Option 1: [option1] - Use case: [use_case1]. Option 2: [option2] - Use case: [use_case2]. Option 3: [option3] - Use case: [use_case3].",
  nextThoughtNeeded: true,
  thoughtNumber: 2,
  totalThoughts: 7
});

// Step 3: Branching for detailed analysis
const option1Analysis = await sequential_thinking({
  thought: "Deep dive on Option 1: [detailed_analysis]. Implementation complexity: [complexity]. Performance implications: [performance]. Maintenance considerations: [maintenance].",
  nextThoughtNeeded: true,
  thoughtNumber: 3,
  totalThoughts: 7,
  branchFromThought: 2,
  branchId: "option1-analysis"
});
```

Document your reasoning process for future reference.
```

## Multi-Agent Coordination Prompt Template

```markdown
🤝 MULTI-AGENT COORDINATION - Sequential Thinking

COORDINATION_GOAL: [Describe coordination objective]

Use sequential thinking to plan effective multi-agent coordination.

### COORDINATION PLANNING PROCESS:

1. **Objective Analysis**: Understand the coordination goal
2. **Agent Role Definition**: Define roles and responsibilities
3. **Dependency Mapping**: Identify task dependencies
4. **Communication Strategy**: Plan inter-agent communication
5. **Monitoring Plan**: Design progress tracking

### EXAMPLE COORDINATION PLANNING:

```typescript
// Step 1: Objective analysis
const objectiveAnalysis = await sequential_thinking({
  thought: "Coordination objective: [goal]. Complexity level: [level]. Required agent types: [types]. Success criteria: [criteria].",
  nextThoughtNeeded: true,
  thoughtNumber: 1,
  totalThoughts: 6
});

// Step 2: Agent role definition
const roleDefinition = await sequential_thinking({
  thought: "Agent roles: Backend Agent: [backend_role], Frontend Agent: [frontend_role], Testing Agent: [testing_role]. Capabilities needed: [capabilities].",
  nextThoughtNeeded: true,
  thoughtNumber: 2,
  totalThoughts: 6
});

// Step 3: Dependency mapping
const dependencyMapping = await sequential_thinking({
  thought: "Dependencies: Task A must complete before Task B. Frontend depends on Backend API. Testing depends on both implementations. Critical path: [path].",
  nextThoughtNeeded: true,
  thoughtNumber: 3,
  totalThoughts: 6
});
```

Plan coordination systematically to avoid conflicts and delays.
```

## Debugging and Troubleshooting Prompt Template

```markdown
🐛 DEBUGGING - Sequential Thinking Approach

ISSUE: [Describe the issue or bug]

Use sequential thinking to systematically debug and resolve issues.

### DEBUGGING METHODOLOGY:

1. **Issue Reproduction**: Understand and reproduce the problem
2. **Information Gathering**: Collect relevant data and logs
3. **Hypothesis Generation**: Form testable hypotheses
4. **Testing**: Systematically test each hypothesis
5. **Solution Implementation**: Implement and verify the fix

### EXAMPLE DEBUGGING PROCESS:

```typescript
// Step 1: Issue reproduction
const issueReproduction = await sequential_thinking({
  thought: "Issue description: [issue]. Steps to reproduce: [steps]. Expected behavior: [expected]. Actual behavior: [actual]. Environment: [env].",
  nextThoughtNeeded: true,
  thoughtNumber: 1,
  totalThoughts: 6
});

// Step 2: Information gathering
const informationGathering = await sequential_thinking({
  thought: "Gathering information: Error logs: [logs]. System state: [state]. Recent changes: [changes]. Potential affected components: [components].",
  nextThoughtNeeded: true,
  thoughtNumber: 2,
  totalThoughts: 6
});

// Step 3: Hypothesis generation
const hypothesisGeneration = await sequential_thinking({
  thought: "Potential causes: Hypothesis 1: [hyp1] - Likelihood: [likelihood1]. Hypothesis 2: [hyp2] - Likelihood: [likelihood2]. Testing approach: [approach].",
  nextThoughtNeeded: true,
  thoughtNumber: 3,
  totalThoughts: 6
});
```

Focus on systematic investigation and evidence-based problem solving.
```

## Usage Guidelines

### When to Use Sequential Thinking

1. **Complex Problems**: When facing multi-faceted challenges
2. **Architecture Decisions**: When making significant design choices
3. **Planning**: When coordinating multiple agents or tasks
4. **Debugging**: When troubleshooting complex issues
5. **Risk Assessment**: When evaluating potential risks

### Best Practices

1. **Start Simple**: Begin with high-level analysis
2. **Be Systematic**: Follow logical progression
3. **Document Reasoning**: Explain your thought process
4. **Iterate**: Refine understanding as you learn more
5. **Branch When Needed**: Explore alternatives systematically

### Integration with Agent Tools

Sequential thinking works best when combined with other agent capabilities:

```typescript
// Example: Combining sequential thinking with agent actions
const plan = await sequential_thinking({
  thought: "Planning database migration strategy...",
  nextThoughtNeeded: true,
  thoughtNumber: 1,
  totalThoughts: 4
});

// Use the plan to create tasks
const migrationTask = await create_task({
  repository_path: ".",
  task_type: "migration",
  title: "Database Migration",
  description: "Based on sequential thinking analysis: " + plan.result
});

// Spawn agent to execute the plan
const migrationAgent = await spawn_agent({
  agent_type: "database",
  repository_path: ".",
  task_description: "Execute database migration plan",
  metadata: { planning_result: plan.result }
});
```

This integration enables more thoughtful and effective agent coordination.