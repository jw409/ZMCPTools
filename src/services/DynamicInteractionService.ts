import type { Page, Locator } from 'patchright';
import type {
  PerformDynamicInteraction,
  DynamicInteractionResponse,
  ActionStep,
  LocatorStrategy,
  WaitStrategy,
  VerificationRule
} from '../schemas/tools/dynamicInteraction.js';
import { PageStateObserver, type PageState } from './PageStateObserver.js';
import { ActionPlanner, type PlanningContext } from './ActionPlanner.js';
import { ActionVerifier, type VerificationResult } from './ActionVerifier.js';
import { WaitStrategies } from '../utils/waitStrategies.js';
import { Logger } from '../utils/logger.js';
import { randomUUID } from 'crypto';
import { writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { tmpdir } from 'os';

const logger = new Logger('DynamicInteractionService');

export interface ExecutionContext {
  sessionId: string;
  objective: string;
  config: NonNullable<PerformDynamicInteraction['config']>;
  startTime: number;
  traceId: string;
  debugMode: boolean;
}

export interface StepResult {
  stepIndex: number;
  action: string;
  success: boolean;
  error?: string;
  retryCount: number;
  executionTime: number;
  verificationResults?: VerificationResult[];
  screenshot?: string;
  state?: PageState;
}

/**
 * DynamicInteractionService orchestrates the Observe→Plan→Act→Verify loop
 *
 * This is the main service that coordinates all dynamic web interaction capabilities,
 * leveraging Playwright's native features for maximum reliability.
 */
export class DynamicInteractionService {
  private stateObserver: PageStateObserver;
  private actionPlanner: ActionPlanner;
  private actionVerifier: ActionVerifier;
  private waitStrategies: WaitStrategies;

  constructor(private page: Page) {
    this.stateObserver = new PageStateObserver(page);
    this.actionPlanner = new ActionPlanner(page);
    this.actionVerifier = new ActionVerifier(page);
    this.waitStrategies = new WaitStrategies(page);
  }

  /**
   * Execute a dynamic interaction using the full Observe→Plan→Act→Verify loop
   */
  async executeInteraction(params: PerformDynamicInteraction): Promise<DynamicInteractionResponse> {
    const context: ExecutionContext = {
      sessionId: params.session_id,
      objective: params.objective,
      config: {
        maxRetries: 3,
        retryDelay: 1000,
        globalTimeout: 60000,
        debugMode: false,
        traceOnFailure: true,
        screenshotOnFailure: true,
        ...params.config
      },
      startTime: Date.now(),
      traceId: randomUUID(),
      debugMode: params.config?.debugMode || false
    };

    logger.info(`Starting dynamic interaction: ${context.objective}`, {
      sessionId: context.sessionId,
      traceId: context.traceId
    });

    try {
      // Start monitoring page state
      await this.stateObserver.startMonitoring();

      // Phase 1: Observe - Capture current page state
      const observeResult = await this.observePhase(context);
      if (!observeResult.success) {
        throw new Error(`Observation failed: ${observeResult.error}`);
      }

      // Phase 2: Plan - Generate action steps
      const planResult = await this.planPhase(context, observeResult.state!);
      if (!planResult.success) {
        throw new Error(`Planning failed: ${planResult.error}`);
      }

      // Phase 3: Act + Verify - Execute steps with verification
      const executionResult = await this.executePhase(context, planResult.steps!);

      // Capture final state
      const finalState = await this.captureFinalState();

      // Generate response
      const response: DynamicInteractionResponse = {
        success: executionResult.success,
        objective: context.objective,
        stepsExecuted: executionResult.stepsExecuted,
        stepsPlanned: planResult.steps!.length,
        executionTime: Date.now() - context.startTime,
        results: executionResult.results,
        finalState,
        traces: executionResult.traces,
        recommendations: this.generateRecommendations(executionResult, planResult)
      };

      logger.info(`Dynamic interaction completed: ${response.success ? 'SUCCESS' : 'FAILURE'}`, {
        sessionId: context.sessionId,
        traceId: context.traceId,
        executionTime: response.executionTime,
        stepsExecuted: response.stepsExecuted
      });

      return response;

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error(`Dynamic interaction failed: ${errorMessage}`, {
        sessionId: context.sessionId,
        traceId: context.traceId,
        error
      });

      // Capture failure state
      const finalState = await this.captureFinalState();

      return {
        success: false,
        objective: context.objective,
        stepsExecuted: 0,
        stepsPlanned: 0,
        executionTime: Date.now() - context.startTime,
        results: [{
          stepIndex: 0,
          action: 'error',
          success: false,
          error: errorMessage,
          retryCount: 0,
          executionTime: Date.now() - context.startTime
        }],
        finalState,
        recommendations: [`Failed with error: ${errorMessage}`]
      };

    } finally {
      // Clean up monitoring
      await this.stateObserver.stopMonitoring();
    }
  }

  /**
   * Phase 1: Observe - Capture and analyze current page state
   */
  private async observePhase(context: ExecutionContext): Promise<{
    success: boolean;
    state?: PageState;
    error?: string;
  }> {
    try {
      logger.debug('Starting observe phase', { traceId: context.traceId });

      // Wait for page to stabilize before observing
      await this.waitStrategies.smartWait(10000);

      // Capture current state
      const state = await this.stateObserver.captureCurrentState();

      logger.debug(`Observed page state:`, {
        url: state.url,
        title: state.title,
        interactiveElements: state.interactiveElements.length,
        loadingIndicators: state.loadingIndicators.length,
        traceId: context.traceId
      });

      return { success: true, state };

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Observation failed';
      logger.error('Observe phase failed', { error: errorMessage, traceId: context.traceId });
      return { success: false, error: errorMessage };
    }
  }

  /**
   * Phase 2: Plan - Generate action steps based on objective and current state
   */
  private async planPhase(context: ExecutionContext, state: PageState): Promise<{
    success: boolean;
    steps?: ActionStep[];
    confidence?: number;
    reasoning?: string[];
    error?: string;
  }> {
    try {
      logger.debug('Starting plan phase', { traceId: context.traceId });

      // Use provided steps if available, otherwise plan them
      if (context.config.steps) {
        logger.debug('Using pre-defined steps', {
          stepCount: context.config.steps.length,
          traceId: context.traceId
        });
        return {
          success: true,
          steps: context.config.steps,
          confidence: 1.0,
          reasoning: ['Using pre-defined action steps']
        };
      }

      // Plan actions based on objective
      const planningContext: PlanningContext = {
        objective: context.objective,
        currentState: state,
        interactiveElements: state.interactiveElements,
        userCredentials: context.config.userCredentials
      };

      const planResult = await this.actionPlanner.planActions(planningContext);

      logger.debug('Planning completed', {
        stepCount: planResult.steps.length,
        confidence: planResult.confidence,
        reasoning: planResult.reasoning,
        traceId: context.traceId
      });

      if (planResult.steps.length === 0) {
        return {
          success: false,
          error: 'No actionable steps could be planned for the given objective'
        };
      }

      return {
        success: true,
        steps: planResult.steps,
        confidence: planResult.confidence,
        reasoning: planResult.reasoning
      };

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Planning failed';
      logger.error('Plan phase failed', { error: errorMessage, traceId: context.traceId });
      return { success: false, error: errorMessage };
    }
  }

  /**
   * Phase 3: Execute - Run action steps with verification
   */
  private async executePhase(context: ExecutionContext, steps: ActionStep[]): Promise<{
    success: boolean;
    stepsExecuted: number;
    results: StepResult[];
    traces?: { traceFile?: string; screenshots?: string[] };
  }> {
    const results: StepResult[] = [];
    const screenshots: string[] = [];
    let traceFile: string | undefined;

    try {
      // Start tracing if debug mode is enabled
      if (context.debugMode || context.config.traceOnFailure) {
        traceFile = await this.startTracing(context);
      }

      for (let i = 0; i < steps.length; i++) {
        const step = steps[i];
        const stepStartTime = Date.now();

        logger.debug(`Executing step ${i + 1}/${steps.length}: ${step.action}`, {
          step,
          traceId: context.traceId
        });

        // Execute step with retries
        const stepResult = await this.executeStepWithRetries(context, step, i);
        stepResult.executionTime = Date.now() - stepStartTime;

        results.push(stepResult);

        // Take screenshot on failure
        if (!stepResult.success && context.config.screenshotOnFailure) {
          const screenshotPath = await this.captureFailureScreenshot(context, i);
          if (screenshotPath) {
            screenshots.push(screenshotPath);
            stepResult.screenshot = screenshotPath;
          }
        }

        // Stop on failure unless configured otherwise
        if (!stepResult.success) {
          logger.warn(`Step ${i + 1} failed, stopping execution`, {
            error: stepResult.error,
            traceId: context.traceId
          });
          break;
        }

        // Check global timeout
        if (Date.now() - context.startTime > context.config.globalTimeout) {
          logger.warn('Global timeout reached, stopping execution', {
            timeout: context.config.globalTimeout,
            traceId: context.traceId
          });
          break;
        }
      }

      // Stop tracing
      if (traceFile) {
        await this.stopTracing(traceFile);
      }

      const success = results.every(r => r.success);

      return {
        success,
        stepsExecuted: results.length,
        results,
        traces: {
          traceFile,
          screenshots: screenshots.length > 0 ? screenshots : undefined
        }
      };

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Execution failed';
      logger.error('Execute phase failed', { error: errorMessage, traceId: context.traceId });

      return {
        success: false,
        stepsExecuted: results.length,
        results,
        traces: { traceFile, screenshots }
      };
    }
  }

  /**
   * Execute a single step with retry logic
   */
  private async executeStepWithRetries(
    context: ExecutionContext,
    step: ActionStep,
    stepIndex: number
  ): Promise<StepResult> {
    let lastError: string | undefined;
    let retryCount = 0;
    const maxRetries = context.config.maxRetries;

    while (retryCount <= maxRetries) {
      try {
        // Apply pre-action wait
        if (step.waitBefore || context.config.defaultWaitBefore) {
          const waitStrategy = step.waitBefore || context.config.defaultWaitBefore!;
          await this.waitStrategies.executeWaitStrategy(waitStrategy);
        }

        // Execute the action
        await this.executeAction(step);

        // Apply post-action wait
        if (step.waitAfter || context.config.defaultWaitAfter) {
          const waitStrategy = step.waitAfter || context.config.defaultWaitAfter!;
          await this.waitStrategies.executeWaitStrategy(waitStrategy);
        }

        // Verify action success
        const verificationResults = await this.verifyStep(step);
        const verificationSuccess = verificationResults.every(r => r.success || !r.required);

        if (!verificationSuccess) {
          const failedVerifications = verificationResults.filter(r => !r.success && r.required);
          throw new Error(`Verification failed: ${failedVerifications.map(v => v.message).join(', ')}`);
        }

        // Success!
        return {
          stepIndex,
          action: step.action,
          success: true,
          retryCount,
          executionTime: 0, // Will be set by caller
          verificationResults
        };

      } catch (error) {
        lastError = error instanceof Error ? error.message : 'Unknown error';
        retryCount++;

        if (retryCount <= maxRetries) {
          const delay = WaitStrategies.calculateBackoffDelay(retryCount - 1, context.config.retryDelay);
          logger.debug(`Step failed, retrying in ${delay}ms (attempt ${retryCount}/${maxRetries + 1})`, {
            error: lastError,
            stepIndex,
            traceId: context.traceId
          });
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }

    // All retries exhausted
    return {
      stepIndex,
      action: step.action,
      success: false,
      error: lastError,
      retryCount: retryCount - 1,
      executionTime: 0 // Will be set by caller
    };
  }

  /**
   * Execute a single action using Playwright's robust methods
   */
  private async executeAction(step: ActionStep): Promise<void> {
    const locator = this.createPlaywrightLocator(step.locator);

    // Playwright automatically waits for actionability
    switch (step.action) {
      case 'click':
        await locator.click({
          force: step.options?.force,
          timeout: step.options?.timeout,
          clickCount: step.options?.clickCount || 1,
          modifiers: step.options?.modifiers as any
        });
        break;

      case 'type':
        if (typeof step.value === 'string') {
          await locator.type(step.value, { timeout: step.options?.timeout });
        }
        break;

      case 'fill':
        if (typeof step.value === 'string') {
          await locator.fill(step.value, { timeout: step.options?.timeout });
        }
        break;

      case 'select':
        if (Array.isArray(step.value)) {
          await locator.selectOption(step.value, { timeout: step.options?.timeout });
        } else if (typeof step.value === 'string') {
          await locator.selectOption(step.value, { timeout: step.options?.timeout });
        }
        break;

      case 'hover':
        await locator.hover({
          force: step.options?.force,
          timeout: step.options?.timeout
        });
        break;

      case 'scroll':
        await locator.scrollIntoViewIfNeeded({ timeout: step.options?.timeout });
        break;

      case 'upload':
        if (typeof step.value === 'string') {
          await locator.setInputFiles(step.value, { timeout: step.options?.timeout });
        } else if (Array.isArray(step.value)) {
          await locator.setInputFiles(step.value, { timeout: step.options?.timeout });
        }
        break;

      case 'press':
        if (step.options?.key) {
          await locator.press(step.options.key, { timeout: step.options?.timeout });
        }
        break;

      case 'wait':
        if (step.options?.timeout) {
          await new Promise(resolve => setTimeout(resolve, step.options!.timeout!));
        } else {
          await locator.waitFor({ timeout: step.options?.timeout });
        }
        break;

      default:
        throw new Error(`Unknown action type: ${step.action}`);
    }
  }

  /**
   * Verify step completion using ActionVerifier
   */
  private async verifyStep(step: ActionStep): Promise<VerificationResult[]> {
    if (!step.verify || step.verify.length === 0) {
      return [];
    }

    const results: VerificationResult[] = [];

    for (const rule of step.verify) {
      const result = await this.actionVerifier.verifyRule(rule);
      results.push(result);
    }

    return results;
  }

  /**
   * Create Playwright locator from our LocatorStrategy
   */
  private createPlaywrightLocator(strategy: LocatorStrategy): Locator {
    switch (strategy.type) {
      case 'role':
        return this.page.getByRole(strategy.value as any, {
          name: strategy.options?.name,
          exact: strategy.options?.exact
        });

      case 'text':
        return this.page.getByText(strategy.value, {
          exact: strategy.options?.exact
        });

      case 'label':
        return this.page.getByLabel(strategy.value, {
          exact: strategy.options?.exact
        });

      case 'placeholder':
        return this.page.getByPlaceholder(strategy.value, {
          exact: strategy.options?.exact
        });

      case 'testId':
        return this.page.getByTestId(strategy.value);

      case 'selector':
      default:
        return this.page.locator(strategy.value);
    }
  }

  /**
   * Capture final page state
   */
  private async captureFinalState(): Promise<DynamicInteractionResponse['finalState']> {
    try {
      const [url, title] = await Promise.all([
        this.page.url(),
        this.page.title()
      ]);

      return { url, title };
    } catch (error) {
      logger.warn('Failed to capture final state', { error });
      return { url: '', title: '' };
    }
  }

  /**
   * Start Playwright tracing for debugging
   */
  private async startTracing(context: ExecutionContext): Promise<string> {
    const traceDir = join(tmpdir(), 'zmcp-traces');
    mkdirSync(traceDir, { recursive: true });

    const traceFile = join(traceDir, `${context.traceId}.zip`);

    await this.page.context().tracing.start({
      screenshots: true,
      snapshots: true,
      sources: true
    });

    return traceFile;
  }

  /**
   * Stop tracing and save file
   */
  private async stopTracing(traceFile: string): Promise<void> {
    try {
      await this.page.context().tracing.stop({ path: traceFile });
      logger.debug(`Trace saved to: ${traceFile}`);
    } catch (error) {
      logger.warn('Failed to save trace', { error });
    }
  }

  /**
   * Capture screenshot on failure
   */
  private async captureFailureScreenshot(context: ExecutionContext, stepIndex: number): Promise<string | null> {
    try {
      const screenshotDir = join(tmpdir(), 'zmcp-screenshots');
      mkdirSync(screenshotDir, { recursive: true });

      const screenshotPath = join(screenshotDir, `${context.traceId}-step-${stepIndex}.png`);

      await this.page.screenshot({
        path: screenshotPath,
        fullPage: true
      });

      logger.debug(`Failure screenshot saved: ${screenshotPath}`);
      return screenshotPath;
    } catch (error) {
      logger.warn('Failed to capture screenshot', { error });
      return null;
    }
  }

  /**
   * Generate recommendations for improving future interactions
   */
  private generateRecommendations(
    executionResult: any,
    planResult: any
  ): string[] {
    const recommendations: string[] = [];

    // Analyze failure patterns
    const failedSteps = executionResult.results.filter((r: StepResult) => !r.success);

    if (failedSteps.length > 0) {
      recommendations.push('Consider using more robust element selectors (role, label, text-based)');

      if (failedSteps.some((s: StepResult) => s.retryCount > 0)) {
        recommendations.push('Increase wait timeouts for slow-loading elements');
      }

      if (failedSteps.some((s: StepResult) => s.error?.includes('timeout'))) {
        recommendations.push('Page may be experiencing performance issues - consider longer timeouts');
      }
    }

    // Analyze planning confidence
    if (planResult.confidence < 0.7) {
      recommendations.push('Low planning confidence - consider providing more specific selectors or test IDs');
    }

    return recommendations;
  }
}