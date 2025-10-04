import type { Page } from 'patchright';
import type {
  ActionStep,
  LocatorStrategy,
  WaitStrategy,
  VerificationRule
} from '../schemas/tools/dynamicInteraction.js';
import type { PageState, InteractiveElement } from './PageStateObserver.js';
import { ActionVerifier } from './ActionVerifier.js';
import { WaitStrategyFactory } from '../utils/waitStrategies.js';
import { Logger } from '../utils/logger.js';

const logger = new Logger('ActionPlanner');

export interface PlanningContext {
  objective: string;
  currentState: PageState;
  interactiveElements: InteractiveElement[];
  userCredentials?: {
    username?: string;
    password?: string;
    email?: string;
  };
}

export interface PlanningResult {
  steps: ActionStep[];
  confidence: number;
  reasoning: string[];
  fallbackStrategies: ActionStep[][];
}

/**
 * ActionPlanner converts natural language objectives into executable action sequences
 *
 * This service provides the "Plan" capability for the dynamic interaction loop.
 * It analyzes the current page state and generates appropriate action steps.
 */
export class ActionPlanner {
  constructor(private page: Page) {}

  /**
   * Plan action steps based on objective and current page state
   */
  async planActions(context: PlanningContext): Promise<PlanningResult> {
    logger.debug('Planning actions for objective:', context.objective);

    const steps: ActionStep[] = [];
    const reasoning: string[] = [];
    const fallbackStrategies: ActionStep[][] = [];

    // Analyze the objective to understand the intent
    const intent = this.analyzeObjective(context.objective);
    reasoning.push(`Detected intent: ${intent.type} - ${intent.description}`);

    // Plan based on intent type
    switch (intent.type) {
      case 'login':
        const loginPlan = await this.planLoginFlow(context, intent);
        steps.push(...loginPlan.steps);
        reasoning.push(...loginPlan.reasoning);
        fallbackStrategies.push(...loginPlan.fallbackStrategies);
        break;

      case 'form_fill':
        const formPlan = await this.planFormFillFlow(context, intent);
        steps.push(...formPlan.steps);
        reasoning.push(...formPlan.reasoning);
        fallbackStrategies.push(...formPlan.fallbackStrategies);
        break;

      case 'navigation':
        const navPlan = await this.planNavigationFlow(context, intent);
        steps.push(...navPlan.steps);
        reasoning.push(...navPlan.reasoning);
        fallbackStrategies.push(...navPlan.fallbackStrategies);
        break;

      case 'interaction':
        const interactionPlan = await this.planInteractionFlow(context, intent);
        steps.push(...interactionPlan.steps);
        reasoning.push(...interactionPlan.reasoning);
        fallbackStrategies.push(...interactionPlan.fallbackStrategies);
        break;

      case 'verification':
        const verificationPlan = await this.planVerificationFlow(context, intent);
        steps.push(...verificationPlan.steps);
        reasoning.push(...verificationPlan.reasoning);
        break;

      default:
        // Generic planning fallback
        const genericPlan = await this.planGenericFlow(context);
        steps.push(...genericPlan.steps);
        reasoning.push(...genericPlan.reasoning);
    }

    // Calculate confidence based on element detection and plan completeness
    const confidence = this.calculatePlanConfidence(steps, context);

    logger.debug(`Generated plan with ${steps.length} steps, confidence: ${confidence}`);

    return {
      steps,
      confidence,
      reasoning,
      fallbackStrategies
    };
  }

  /**
   * Analyze objective text to understand user intent
   */
  private analyzeObjective(objective: string): {
    type: 'login' | 'form_fill' | 'navigation' | 'interaction' | 'verification' | 'generic';
    description: string;
    parameters: Record<string, any>;
  } {
    const lowerObjective = objective.toLowerCase();

    // Login patterns
    if (lowerObjective.includes('log in') || lowerObjective.includes('login') ||
        lowerObjective.includes('sign in') || lowerObjective.includes('signin')) {
      return {
        type: 'login',
        description: 'User wants to authenticate/login',
        parameters: {
          username: this.extractParameter(objective, ['username', 'user', 'email']),
          password: this.extractParameter(objective, ['password', 'pass']),
          verifySuccess: lowerObjective.includes('verify') || lowerObjective.includes('dashboard')
        }
      };
    }

    // Form filling patterns
    if (lowerObjective.includes('fill') || lowerObjective.includes('submit') ||
        lowerObjective.includes('form') || lowerObjective.includes('enter')) {
      return {
        type: 'form_fill',
        description: 'User wants to fill out a form',
        parameters: {
          fields: this.extractFormFields(objective),
          submit: lowerObjective.includes('submit')
        }
      };
    }

    // Navigation patterns
    if (lowerObjective.includes('navigate') || lowerObjective.includes('go to') ||
        lowerObjective.includes('visit') || lowerObjective.includes('open')) {
      return {
        type: 'navigation',
        description: 'User wants to navigate somewhere',
        parameters: {
          target: this.extractNavigationTarget(objective)
        }
      };
    }

    // Interaction patterns
    if (lowerObjective.includes('click') || lowerObjective.includes('select') ||
        lowerObjective.includes('choose') || lowerObjective.includes('press')) {
      return {
        type: 'interaction',
        description: 'User wants to interact with elements',
        parameters: {
          action: this.extractInteractionAction(objective),
          target: this.extractInteractionTarget(objective)
        }
      };
    }

    // Verification patterns
    if (lowerObjective.includes('verify') || lowerObjective.includes('check') ||
        lowerObjective.includes('confirm') || lowerObjective.includes('ensure')) {
      return {
        type: 'verification',
        description: 'User wants to verify something',
        parameters: {
          expectation: this.extractVerificationExpectation(objective)
        }
      };
    }

    return {
      type: 'generic',
      description: 'Generic objective requiring analysis',
      parameters: {}
    };
  }

  /**
   * Plan login flow actions
   */
  private async planLoginFlow(
    context: PlanningContext,
    intent: any
  ): Promise<{ steps: ActionStep[]; reasoning: string[]; fallbackStrategies: ActionStep[][] }> {
    const steps: ActionStep[] = [];
    const reasoning: string[] = [];
    const fallbackStrategies: ActionStep[][] = [];

    // Find username field
    const usernameField = this.findBestElement(context.interactiveElements, [
      'input[type="email"]', 'input[type="text"]', 'input[name*="user"]',
      'input[name*="email"]', 'input[placeholder*="user"]', 'input[placeholder*="email"]'
    ]);

    if (usernameField) {
      reasoning.push(`Found username field: ${usernameField.selector}`);
      steps.push({
        action: 'fill',
        locator: this.createLocatorFromElement(usernameField),
        value: intent.parameters.username || context.userCredentials?.username || 'admin',
        waitBefore: { type: 'element_visible', target: usernameField.selector, timeout: 5000 }
      });

      // Create fallback strategy using different selectors
      const fallbackUsername = this.createFallbackLocators(usernameField, ['user', 'email', 'login']);
      fallbackStrategies.push(fallbackUsername.map(locator => ({
        action: 'fill',
        locator,
        value: intent.parameters.username || 'admin'
      })));
    }

    // Find password field
    const passwordField = this.findBestElement(context.interactiveElements, [
      'input[type="password"]', 'input[name*="pass"]', 'input[placeholder*="pass"]'
    ]);

    if (passwordField) {
      reasoning.push(`Found password field: ${passwordField.selector}`);
      steps.push({
        action: 'fill',
        locator: this.createLocatorFromElement(passwordField),
        value: intent.parameters.password || context.userCredentials?.password || 'password123',
        waitBefore: { type: 'element_visible', target: passwordField.selector, timeout: 5000 }
      });

      // Fallback strategy for password
      const fallbackPassword = this.createFallbackLocators(passwordField, ['pass', 'pwd']);
      fallbackStrategies.push(fallbackPassword.map(locator => ({
        action: 'fill',
        locator,
        value: intent.parameters.password || 'password123'
      })));
    }

    // Find submit button
    const submitButton = this.findBestElement(context.interactiveElements, [
      'button[type="submit"]', 'input[type="submit"]',
      'button:contains("log in")', 'button:contains("sign in")',
      '.btn-primary', '.login-button', '.signin-button'
    ]);

    if (submitButton) {
      reasoning.push(`Found submit button: ${submitButton.selector}`);
      steps.push({
        action: 'click',
        locator: this.createLocatorFromElement(submitButton),
        waitAfter: WaitStrategyFactory.forFormSubmission()[0],
        verify: intent.parameters.verifySuccess ? [
          {
            type: 'url_changed',
            expectedUrl: '(dashboard|home|main)',
            timeout: 10000,
            required: false
          },
          {
            type: 'text_present',
            expectedText: 'welcome',
            timeout: 10000,
            required: false
          }
        ] : undefined
      });

      // Fallback strategy for submit
      const fallbackSubmit = this.createFallbackLocators(submitButton, ['submit', 'login', 'signin']);
      fallbackStrategies.push(fallbackSubmit.map(locator => ({
        action: 'click',
        locator
      })));
    }

    return { steps, reasoning, fallbackStrategies };
  }

  /**
   * Plan form filling flow
   */
  private async planFormFillFlow(
    context: PlanningContext,
    intent: any
  ): Promise<{ steps: ActionStep[]; reasoning: string[]; fallbackStrategies: ActionStep[][] }> {
    const steps: ActionStep[] = [];
    const reasoning: string[] = [];
    const fallbackStrategies: ActionStep[][] = [];

    reasoning.push('Planning form fill flow');

    // Extract field values from objective
    const fields = intent.parameters.fields || {};

    // Find all form inputs
    const formInputs = context.interactiveElements.filter(el =>
      el.tagName === 'input' || el.tagName === 'select' || el.tagName === 'textarea'
    );

    for (const [fieldName, fieldValue] of Object.entries(fields)) {
      const matchingInput = this.findBestElement(formInputs, [
        `input[name*="${fieldName}"]`,
        `input[placeholder*="${fieldName}"]`,
        `input[id*="${fieldName}"]`,
        `label:contains("${fieldName}") + input`,
        `label:contains("${fieldName}") input`
      ]);

      if (matchingInput) {
        reasoning.push(`Found field for ${fieldName}: ${matchingInput.selector}`);
        steps.push({
          action: 'fill',
          locator: this.createLocatorFromElement(matchingInput),
          value: fieldValue as string,
          waitBefore: { type: 'element_visible', target: matchingInput.selector, timeout: 5000 }
        });
      }
    }

    // Add submit step if requested
    if (intent.parameters.submit) {
      const submitButton = this.findBestElement(context.interactiveElements, [
        'button[type="submit"]', 'input[type="submit"]',
        '.btn-primary', '.submit-button'
      ]);

      if (submitButton) {
        steps.push({
          action: 'click',
          locator: this.createLocatorFromElement(submitButton),
          waitAfter: WaitStrategyFactory.forFormSubmission()[0]
        });
      }
    }

    return { steps, reasoning, fallbackStrategies };
  }

  /**
   * Plan navigation flow
   */
  private async planNavigationFlow(
    context: PlanningContext,
    intent: any
  ): Promise<{ steps: ActionStep[]; reasoning: string[]; fallbackStrategies: ActionStep[][] }> {
    const steps: ActionStep[] = [];
    const reasoning: string[] = [];
    const fallbackStrategies: ActionStep[][] = [];

    const target = intent.parameters.target;
    reasoning.push(`Planning navigation to: ${target}`);

    // Look for navigation links
    const navLinks = context.interactiveElements.filter(el =>
      el.tagName === 'a' &&
      (el.text?.toLowerCase().includes(target?.toLowerCase()) ||
       el.selector.toLowerCase().includes(target?.toLowerCase()))
    );

    if (navLinks.length > 0) {
      const bestLink = navLinks[0];
      reasoning.push(`Found navigation link: ${bestLink.selector}`);

      steps.push({
        action: 'click',
        locator: this.createLocatorFromElement(bestLink),
        waitAfter: WaitStrategyFactory.forSPANavigation()[0],
        verify: [{
          type: 'url_changed',
          expectedUrl: target,
          timeout: 10000,
          required: true
        }]
      });
    }

    return { steps, reasoning, fallbackStrategies };
  }

  /**
   * Plan interaction flow
   */
  private async planInteractionFlow(
    context: PlanningContext,
    intent: any
  ): Promise<{ steps: ActionStep[]; reasoning: string[]; fallbackStrategies: ActionStep[][] }> {
    const steps: ActionStep[] = [];
    const reasoning: string[] = [];
    const fallbackStrategies: ActionStep[][] = [];

    const action = intent.parameters.action;
    const target = intent.parameters.target;

    reasoning.push(`Planning ${action} interaction with: ${target}`);

    // Find target element
    const targetElement = this.findBestElement(context.interactiveElements, [
      `button:contains("${target}")`,
      `a:contains("${target}")`,
      `[aria-label*="${target}"]`,
      `[title*="${target}"]`,
      `[data-testid*="${target}"]`
    ]);

    if (targetElement) {
      reasoning.push(`Found target element: ${targetElement.selector}`);

      steps.push({
        action: action === 'press' ? 'click' : action,
        locator: this.createLocatorFromElement(targetElement),
        waitBefore: { type: 'element_visible', target: targetElement.selector, timeout: 5000 }
      });
    }

    return { steps, reasoning, fallbackStrategies };
  }

  /**
   * Plan verification flow
   */
  private async planVerificationFlow(
    context: PlanningContext,
    intent: any
  ): Promise<{ steps: ActionStep[]; reasoning: string[] }> {
    const steps: ActionStep[] = [];
    const reasoning: string[] = [];

    const expectation = intent.parameters.expectation;
    reasoning.push(`Planning verification for: ${expectation}`);

    // Create verification-only step
    steps.push({
      action: 'wait',
      locator: { type: 'selector', value: 'body' },
      verify: [{
        type: 'text_present',
        expectedText: expectation,
        timeout: 10000,
        required: true
      }]
    });

    return { steps, reasoning };
  }

  /**
   * Plan generic flow as fallback
   */
  private async planGenericFlow(
    context: PlanningContext
  ): Promise<{ steps: ActionStep[]; reasoning: string[] }> {
    const steps: ActionStep[] = [];
    const reasoning: string[] = [];

    reasoning.push('Using generic planning approach');

    // Look for obvious interactive elements
    const buttons = context.interactiveElements.filter(el => el.tagName === 'button');
    const inputs = context.interactiveElements.filter(el => el.tagName === 'input');

    if (inputs.length > 0 && buttons.length > 0) {
      reasoning.push('Detected form-like structure, planning basic form interaction');

      // Fill first text input if present
      const textInput = inputs.find(input => input.type === 'text' || input.type === 'email');
      if (textInput) {
        steps.push({
          action: 'fill',
          locator: this.createLocatorFromElement(textInput),
          value: 'test-value'
        });
      }

      // Click first button
      if (buttons.length > 0) {
        steps.push({
          action: 'click',
          locator: this.createLocatorFromElement(buttons[0])
        });
      }
    }

    return { steps, reasoning };
  }

  /**
   * Find the best matching element from a list of selectors
   */
  private findBestElement(
    elements: InteractiveElement[],
    selectors: string[]
  ): InteractiveElement | null {
    for (const selector of selectors) {
      const element = elements.find(el => {
        if (selector.includes(':contains(')) {
          const textMatch = selector.match(/:contains\("([^"]+)"\)/);
          if (textMatch) {
            return el.text?.toLowerCase().includes(textMatch[1].toLowerCase());
          }
        }
        return el.selector.includes(selector.replace(/[\[\]]/g, ''));
      });

      if (element) {
        return element;
      }
    }

    return null;
  }

  /**
   * Create a locator strategy from an interactive element
   */
  private createLocatorFromElement(element: InteractiveElement): LocatorStrategy {
    // Prefer user-facing locators when possible
    if (element.text && element.text.length > 0 && element.text.length < 50) {
      if (element.tagName === 'button') {
        return { type: 'role', value: 'button', options: { name: element.text } };
      }
      if (element.tagName === 'a') {
        return { type: 'role', value: 'link', options: { name: element.text } };
      }
      return { type: 'text', value: element.text };
    }

    // Fallback to CSS selector
    return { type: 'selector', value: element.selector };
  }

  /**
   * Create fallback locator strategies
   */
  private createFallbackLocators(
    element: InteractiveElement,
    keywords: string[]
  ): LocatorStrategy[] {
    const fallbacks: LocatorStrategy[] = [];

    // Try different locator approaches
    for (const keyword of keywords) {
      fallbacks.push({ type: 'selector', value: `input[name*="${keyword}"]` });
      fallbacks.push({ type: 'selector', value: `input[placeholder*="${keyword}"]` });
      fallbacks.push({ type: 'selector', value: `input[id*="${keyword}"]` });
    }

    // Add text-based fallback if element has text
    if (element.text) {
      fallbacks.push({ type: 'text', value: element.text });
    }

    return fallbacks;
  }

  /**
   * Calculate confidence score for the generated plan
   */
  private calculatePlanConfidence(steps: ActionStep[], context: PlanningContext): number {
    let confidence = 0.5; // Base confidence

    // Boost confidence for each step that has a clear target
    steps.forEach(step => {
      if (step.locator) {
        confidence += 0.1;
      }
      if (step.verify && step.verify.length > 0) {
        confidence += 0.1;
      }
    });

    // Boost confidence if we found specific elements for common patterns
    const hasFormInputs = context.interactiveElements.some(el =>
      el.tagName === 'input' && (el.type === 'text' || el.type === 'email' || el.type === 'password')
    );
    const hasButtons = context.interactiveElements.some(el => el.tagName === 'button');

    if (hasFormInputs && hasButtons) {
      confidence += 0.2;
    }

    return Math.min(confidence, 1.0);
  }

  /**
   * Helper methods for extracting parameters from objective text
   */
  private extractParameter(objective: string, keywords: string[]): string | null {
    for (const keyword of keywords) {
      const pattern = new RegExp(`${keyword}[\\s:='"]*([\\w\\.-]+)`, 'i');
      const match = objective.match(pattern);
      if (match) {
        return match[1];
      }
    }
    return null;
  }

  private extractFormFields(objective: string): Record<string, string> {
    const fields: Record<string, string> = {};

    // Simple pattern matching for field=value pairs
    const fieldPattern = /(\w+)[:\s=]+(['\"]?)([^'\"\\s,]+)\2/g;
    let match;

    while ((match = fieldPattern.exec(objective)) !== null) {
      fields[match[1]] = match[3];
    }

    return fields;
  }

  private extractNavigationTarget(objective: string): string {
    const patterns = [
      /(?:navigate|go)\s+to\s+([^\s]+)/i,
      /visit\s+([^\s]+)/i,
      /open\s+([^\s]+)/i
    ];

    for (const pattern of patterns) {
      const match = objective.match(pattern);
      if (match) {
        return match[1];
      }
    }

    return '';
  }

  private extractInteractionAction(objective: string): string {
    if (objective.toLowerCase().includes('click')) return 'click';
    if (objective.toLowerCase().includes('select')) return 'select';
    if (objective.toLowerCase().includes('choose')) return 'click';
    if (objective.toLowerCase().includes('press')) return 'press';
    return 'click';
  }

  private extractInteractionTarget(objective: string): string {
    const patterns = [
      /click\s+(?:on\s+)?([^,\s]+)/i,
      /select\s+([^,\s]+)/i,
      /choose\s+([^,\s]+)/i,
      /press\s+([^,\s]+)/i
    ];

    for (const pattern of patterns) {
      const match = objective.match(pattern);
      if (match) {
        return match[1];
      }
    }

    return '';
  }

  private extractVerificationExpectation(objective: string): string {
    const patterns = [
      /verify\s+(?:that\s+)?([^,]+)/i,
      /check\s+(?:that\s+)?([^,]+)/i,
      /confirm\s+([^,]+)/i,
      /ensure\s+([^,]+)/i
    ];

    for (const pattern of patterns) {
      const match = objective.match(pattern);
      if (match) {
        return match[1].trim();
      }
    }

    return '';
  }
}