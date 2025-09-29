#!/usr/bin/env tsx
/**
 * Meeting Simulation Tests for ZMCPTools
 * Tests the TypeScript MeetingProtocolEngine integration
 */

import { MeetingProtocolEngine, type CollaborationSession, type MeetingParticipant } from '../services/MeetingProtocolEngine.js';
import type { AgentSession } from '../schemas/agents.js';

// Mock agent sessions for testing
const createMockAgent = (id: string, name: string, type: 'planner_agent' | 'implementer_agent' | 'tester_agent'): AgentSession => ({
  id,
  agentName: name,
  agentType: type,
  repositoryPath: '/home/jw/dev/game1',
  task: 'Test task',
  objective: 'Test objective',
  status: 'active',
  claudePid: process.pid,
  process_pid: process.pid,
  startedAt: new Date().toISOString(),
  roomId: `room-${id}`,
  foundationSessionId: 'test-session',
  coordinationEvents: []
});

class MeetingSimulationTest {
  private engine = new MeetingProtocolEngine();
  private testResults: { [key: string]: boolean } = {};

  async runAllTests(): Promise<void> {
    console.log('🚀 Starting Meeting Simulation Tests');
    console.log('=' * 50);

    try {
      await this.testSessionInitialization();
      await this.testTurnManagement();
      await this.testPhaseTransitions();
      await this.testDecisionRecording();
      await this.testEscalation();
      await this.testMinuteGeneration();

      this.printResults();

    } catch (error) {
      console.error('❌ Test suite failed:', error);
      process.exit(1);
    }
  }

  private async testSessionInitialization(): Promise<void> {
    console.log('\n🧪 Testing Session Initialization...');

    try {
      const mockAgents = {
        planner: createMockAgent('planner-1', 'PlannerBot', 'planner_agent'),
        implementer: createMockAgent('impl-1', 'ImplBot', 'implementer_agent'),
        tester: createMockAgent('test-1', 'TestBot', 'tester_agent')
      };

      const session = await this.engine.initializeCollaborativeSession(
        'Implement user authentication system',
        '/home/jw/dev/game1',
        mockAgents
      );

      // Verify session properties
      const isValid = (
        session.sessionId !== undefined &&
        session.participants.size === 3 &&
        session.currentPhase === 0 &&
        session.status === 'planning' &&
        session.turnContext.currentSpeaker === mockAgents.planner.id
      );

      this.testResults['sessionInitialization'] = isValid;

      if (isValid) {
        console.log('✅ Session initialization passed');
        console.log(`   - Session ID: ${session.sessionId}`);
        console.log(`   - Participants: ${session.participants.size}`);
        console.log(`   - Initial speaker: ${session.turnContext.currentSpeaker}`);
      } else {
        console.log('❌ Session initialization failed');
        console.log('   Session:', session);
      }

    } catch (error) {
      console.log('❌ Session initialization error:', error);
      this.testResults['sessionInitialization'] = false;
    }
  }

  private async testTurnManagement(): Promise<void> {
    console.log('\n🧪 Testing Turn Management...');

    try {
      // Create test session
      const mockAgents = {
        planner: createMockAgent('planner-2', 'PlannerBot', 'planner_agent'),
        implementer: createMockAgent('impl-2', 'ImplBot', 'implementer_agent'),
        tester: createMockAgent('test-2', 'TestBot', 'tester_agent')
      };

      const session = await this.engine.initializeCollaborativeSession(
        'Test turn management',
        '/home/jw/dev/game1',
        mockAgents
      );

      // Test 1: Current speaker can continue speaking
      const continueResult = await this.engine.requestTurn(session.sessionId, mockAgents.planner.id, 'speak');
      const canContinue = continueResult.granted === true;

      // Test 2: Other agents should be queued
      const queueResult = await this.engine.requestTurn(session.sessionId, mockAgents.implementer.id, 'speak');
      const isQueued = queueResult.granted === false && queueResult.waitTime !== undefined;

      // Test 3: Turn completion passes to next agent
      const completeResult = await this.engine.requestTurn(session.sessionId, mockAgents.planner.id, 'complete_turn');
      const turnPassed = completeResult.granted === true && completeResult.currentSpeaker === mockAgents.implementer.id;

      const allTestsPassed = canContinue && isQueued && turnPassed;
      this.testResults['turnManagement'] = allTestsPassed;

      if (allTestsPassed) {
        console.log('✅ Turn management passed');
        console.log('   - Current speaker can continue: ✅');
        console.log('   - Others queued properly: ✅');
        console.log('   - Turn completion works: ✅');
      } else {
        console.log('❌ Turn management failed');
        console.log(`   - Continue result: ${JSON.stringify(continueResult)}`);
        console.log(`   - Queue result: ${JSON.stringify(queueResult)}`);
        console.log(`   - Complete result: ${JSON.stringify(completeResult)}`);
      }

    } catch (error) {
      console.log('❌ Turn management error:', error);
      this.testResults['turnManagement'] = false;
    }
  }

  private async testPhaseTransitions(): Promise<void> {
    console.log('\n🧪 Testing Phase Transitions...');

    try {
      // Create test session
      const mockAgents = {
        planner: createMockAgent('planner-3', 'PlannerBot', 'planner_agent'),
        implementer: createMockAgent('impl-3', 'ImplBot', 'implementer_agent'),
        tester: createMockAgent('test-3', 'TestBot', 'tester_agent')
      };

      const session = await this.engine.initializeCollaborativeSession(
        'Test phase transitions',
        '/home/jw/dev/game1',
        mockAgents
      );

      const initialPhase = session.currentPhase;

      // Advance phase
      const advanceResult = await this.engine.advancePhase(session.sessionId, mockAgents.planner.id);

      const phaseAdvanced = (
        advanceResult.success === true &&
        session.currentPhase === initialPhase + 1 &&
        advanceResult.newPhase !== undefined
      );

      this.testResults['phaseTransitions'] = phaseAdvanced;

      if (phaseAdvanced) {
        console.log('✅ Phase transitions passed');
        console.log(`   - Advanced from phase ${initialPhase} to ${session.currentPhase}`);
        console.log(`   - New phase: ${advanceResult.newPhase?.name}`);
      } else {
        console.log('❌ Phase transitions failed');
        console.log(`   - Advance result: ${JSON.stringify(advanceResult)}`);
      }

    } catch (error) {
      console.log('❌ Phase transitions error:', error);
      this.testResults['phaseTransitions'] = false;
    }
  }

  private async testDecisionRecording(): Promise<void> {
    console.log('\n🧪 Testing Decision Recording...');

    try {
      // Create test session
      const mockAgents = {
        planner: createMockAgent('planner-4', 'PlannerBot', 'planner_agent'),
        implementer: createMockAgent('impl-4', 'ImplBot', 'implementer_agent'),
        tester: createMockAgent('test-4', 'TestBot', 'tester_agent')
      };

      const session = await this.engine.initializeCollaborativeSession(
        'Test decision recording',
        '/home/jw/dev/game1',
        mockAgents
      );

      // Record a decision
      const decision = await this.engine.recordDecision(
        session.sessionId,
        mockAgents.planner.id,
        'Use PostgreSQL for user data storage',
        'Provides ACID compliance and good performance for our use case',
        'objective',
        [mockAgents.implementer.id]
      );

      const decisionRecorded = (
        decision.id !== undefined &&
        decision.decision === 'Use PostgreSQL for user data storage' &&
        decision.decisionMaker === mockAgents.planner.id &&
        session.decisions.length === 1
      );

      this.testResults['decisionRecording'] = decisionRecorded;

      if (decisionRecorded) {
        console.log('✅ Decision recording passed');
        console.log(`   - Decision ID: ${decision.id}`);
        console.log(`   - Decision: ${decision.decision}`);
        console.log(`   - Session has ${session.decisions.length} decisions`);
      } else {
        console.log('❌ Decision recording failed');
        console.log(`   - Decision: ${JSON.stringify(decision)}`);
      }

    } catch (error) {
      console.log('❌ Decision recording error:', error);
      this.testResults['decisionRecording'] = false;
    }
  }

  private async testEscalation(): Promise<void> {
    console.log('\n🧪 Testing Escalation...');

    try {
      // Create test session
      const mockAgents = {
        planner: createMockAgent('planner-5', 'PlannerBot', 'planner_agent'),
        implementer: createMockAgent('impl-5', 'ImplBot', 'implementer_agent'),
        tester: createMockAgent('test-5', 'TestBot', 'tester_agent')
      };

      const session = await this.engine.initializeCollaborativeSession(
        'Test escalation',
        '/home/jw/dev/game1',
        mockAgents
      );

      // Give turn to implementer first
      await this.engine.requestTurn(session.sessionId, mockAgents.planner.id, 'complete_turn');

      // Test escalation by planner (should work)
      const escalationResult = await this.engine.requestTurn(session.sessionId, mockAgents.planner.id, 'escalate');

      // Test escalation by non-planner (should fail)
      const failedEscalation = await this.engine.requestTurn(session.sessionId, mockAgents.implementer.id, 'escalate');

      const escalationWorks = (
        escalationResult.granted === true &&
        escalationResult.currentSpeaker === mockAgents.planner.id &&
        failedEscalation.granted === false
      );

      this.testResults['escalation'] = escalationWorks;

      if (escalationWorks) {
        console.log('✅ Escalation passed');
        console.log('   - Planner escalation: ✅');
        console.log('   - Non-planner escalation blocked: ✅');
      } else {
        console.log('❌ Escalation failed');
        console.log(`   - Planner escalation: ${JSON.stringify(escalationResult)}`);
        console.log(`   - Failed escalation: ${JSON.stringify(failedEscalation)}`);
      }

    } catch (error) {
      console.log('❌ Escalation error:', error);
      this.testResults['escalation'] = false;
    }
  }

  private async testMinuteGeneration(): Promise<void> {
    console.log('\n🧪 Testing Meeting Minutes Generation...');

    try {
      // Create test session
      const mockAgents = {
        planner: createMockAgent('planner-6', 'PlannerBot', 'planner_agent'),
        implementer: createMockAgent('impl-6', 'ImplBot', 'implementer_agent'),
        tester: createMockAgent('test-6', 'TestBot', 'tester_agent')
      };

      const session = await this.engine.initializeCollaborativeSession(
        'Test minute generation',
        '/home/jw/dev/game1',
        mockAgents
      );

      // Add some decisions and advance through phases
      await this.engine.recordDecision(
        session.sessionId,
        mockAgents.planner.id,
        'Use Node.js for backend',
        'Team has expertise and good ecosystem',
        'objective'
      );

      // Advance through all phases to complete meeting
      while (session.currentPhase < session.phases.length - 1) {
        await this.engine.advancePhase(session.sessionId, mockAgents.planner.id);
      }

      // Generate minutes
      const minutes = this.engine.generateMeetingMinutes(session.sessionId);

      const minutesValid = (
        minutes.summary.includes(session.objective) &&
        minutes.decisions.length === 1 &&
        minutes.participants.length === 3 &&
        minutes.phases.length > 0 &&
        minutes.recommendations.length >= 0
      );

      this.testResults['minuteGeneration'] = minutesValid;

      if (minutesValid) {
        console.log('✅ Minute generation passed');
        console.log(`   - Summary includes objective: ✅`);
        console.log(`   - Decisions recorded: ${minutes.decisions.length}`);
        console.log(`   - Participants: ${minutes.participants.length}`);
        console.log(`   - Phases: ${minutes.phases.length}`);
      } else {
        console.log('❌ Minute generation failed');
        console.log('   - Generated minutes structure incomplete');
      }

    } catch (error) {
      console.log('❌ Minute generation error:', error);
      this.testResults['minuteGeneration'] = false;
    }
  }

  private printResults(): void {
    console.log('\n📊 Test Results Summary');
    console.log('=' * 50);

    let passed = 0;
    let total = 0;

    for (const [testName, result] of Object.entries(this.testResults)) {
      const status = result ? '✅ PASS' : '❌ FAIL';
      console.log(`${status} ${testName}`);

      if (result) passed++;
      total++;
    }

    console.log('\n' + '=' * 50);
    console.log(`📈 Overall: ${passed}/${total} tests passed`);

    if (passed === total) {
      console.log('🎉 All meeting simulation tests passed!');
      process.exit(0);
    } else {
      console.log('❌ Some tests failed. Check implementation.');
      process.exit(1);
    }
  }
}

// Run tests if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const testSuite = new MeetingSimulationTest();
  testSuite.runAllTests().catch((error) => {
    console.error('Test suite crashed:', error);
    process.exit(1);
  });
}

export { MeetingSimulationTest };