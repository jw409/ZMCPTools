import type { Page, Locator } from 'patchright';
import { expect } from 'patchright/test';
import type { VerificationRule, LocatorStrategy } from '../schemas/tools/dynamicInteraction.js';
import { Logger } from '../utils/logger.js';

const logger = new Logger('ActionVerifier');

export interface VerificationResult {
  success: boolean;
  message: string;
  type: string;
  duration: number;
  error?: string;
  actualValue?: any;
  expectedValue?: any;
}

/**
 * ActionVerifier leverages Playwright's built-in expect library
 * for robust, auto-retrying verification of action outcomes.
 *
 * This is superior to manual DOM checks because Playwright's expect
 * automatically retries assertions for a configurable timeout period,
 * handling the asynchronous nature of modern web applications.
 */
export class ActionVerifier {
  constructor(private page: Page) {}

  /**
   * Execute a verification rule using Playwright's web-first assertions
   */
  async verifyRule(rule: VerificationRule): Promise<VerificationResult> {
    const startTime = Date.now();

    try {
      logger.debug(`Verifying rule: ${rule.type}`, { rule });

      let result: VerificationResult;

      switch (rule.type) {
        case 'element_present':
          result = await this.verifyElementPresent(rule);
          break;

        case 'element_absent':
          result = await this.verifyElementAbsent(rule);
          break;

        case 'text_present':
          result = await this.verifyTextPresent(rule);
          break;

        case 'url_changed':
          result = await this.verifyUrlChanged(rule);
          break;

        case 'network_response':
          result = await this.verifyNetworkResponse(rule);
          break;

        case 'console_message':
          result = await this.verifyConsoleMessage(rule);
          break;

        default:
          throw new Error(`Unknown verification type: ${rule.type}`);
      }

      const duration = Date.now() - startTime;
      result.duration = duration;

      logger.debug(`Verification completed: ${result.success ? 'PASS' : 'FAIL'}`, {
        type: rule.type,
        duration,
        message: result.message
      });

      return result;
    } catch (error) {
      const duration = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : 'Unknown verification error';

      logger.warn(`Verification failed: ${errorMessage}`, { rule, duration });

      return {
        success: false,
        message: `Verification failed: ${errorMessage}`,
        type: rule.type,
        duration,
        error: errorMessage
      };
    }
  }

  /**
   * Verify that an element is present and visible
   */
  private async verifyElementPresent(rule: VerificationRule): Promise<VerificationResult> {
    if (!rule.locator) {
      throw new Error('element_present verification requires a locator');
    }

    const locator = this.createLocator(rule.locator);

    try {
      // Use Playwright's auto-retrying expect
      await expect(locator).toBeVisible({ timeout: rule.timeout });

      const text = await locator.textContent({ timeout: 1000 }).catch(() => '');

      return {
        success: true,
        message: `Element found and visible${text ? `: "${text}"` : ''}`,
        type: rule.type,
        duration: 0, // Will be set by caller
        actualValue: text
      };
    } catch (error) {
      return {
        success: false,
        message: `Element not visible or not found`,
        type: rule.type,
        duration: 0,
        error: error instanceof Error ? error.message : 'Element verification failed'
      };
    }
  }

  /**
   * Verify that an element is absent or hidden
   */
  private async verifyElementAbsent(rule: VerificationRule): Promise<VerificationResult> {
    if (!rule.locator) {
      throw new Error('element_absent verification requires a locator');
    }

    const locator = this.createLocator(rule.locator);

    try {
      // Use Playwright's auto-retrying expect for hidden state
      await expect(locator).toBeHidden({ timeout: rule.timeout });

      return {
        success: true,
        message: 'Element successfully hidden or removed',
        type: rule.type,
        duration: 0
      };
    } catch (error) {
      return {
        success: false,
        message: 'Element is still visible',
        type: rule.type,
        duration: 0,
        error: error instanceof Error ? error.message : 'Element absence verification failed'
      };
    }
  }

  /**
   * Verify that specific text appears on the page
   */
  private async verifyTextPresent(rule: VerificationRule): Promise<VerificationResult> {
    if (!rule.expectedText) {
      throw new Error('text_present verification requires expectedText');
    }

    try {
      let locator: Locator;

      if (rule.locator) {
        // Check text within specific element
        locator = this.createLocator(rule.locator);
        await expect(locator).toContainText(rule.expectedText, { timeout: rule.timeout });
      } else {
        // Check text anywhere on page
        locator = this.page.getByText(rule.expectedText);
        await expect(locator).toBeVisible({ timeout: rule.timeout });
      }

      return {
        success: true,
        message: `Text found: "${rule.expectedText}"`,
        type: rule.type,
        duration: 0,
        expectedValue: rule.expectedText
      };
    } catch (error) {
      return {
        success: false,
        message: `Text not found: "${rule.expectedText}"`,
        type: rule.type,
        duration: 0,
        error: error instanceof Error ? error.message : 'Text verification failed',
        expectedValue: rule.expectedText
      };
    }
  }

  /**
   * Verify that the URL has changed to match expected pattern
   */
  private async verifyUrlChanged(rule: VerificationRule): Promise<VerificationResult> {
    if (!rule.expectedUrl) {
      throw new Error('url_changed verification requires expectedUrl');
    }

    try {
      // Wait for URL to change with auto-retry
      await expect(this.page).toHaveURL(new RegExp(rule.expectedUrl), { timeout: rule.timeout });

      const currentUrl = this.page.url();

      return {
        success: true,
        message: `URL changed to: ${currentUrl}`,
        type: rule.type,
        duration: 0,
        actualValue: currentUrl,
        expectedValue: rule.expectedUrl
      };
    } catch (error) {
      const currentUrl = this.page.url();

      return {
        success: false,
        message: `URL did not change to expected pattern. Current: ${currentUrl}`,
        type: rule.type,
        duration: 0,
        error: error instanceof Error ? error.message : 'URL verification failed',
        actualValue: currentUrl,
        expectedValue: rule.expectedUrl
      };
    }
  }

  /**
   * Verify that a specific network response was received
   */
  private async verifyNetworkResponse(rule: VerificationRule): Promise<VerificationResult> {
    if (!rule.apiEndpoint) {
      throw new Error('network_response verification requires apiEndpoint');
    }

    try {
      // Set up response monitoring
      const responsePromise = this.page.waitForResponse(
        response => {
          const url = response.url();
          const matchesEndpoint = url.includes(rule.apiEndpoint!) ||
                                new RegExp(rule.apiEndpoint!).test(url);

          if (matchesEndpoint) {
            logger.debug(`Network response captured: ${response.status()} ${url}`);
            return response.ok();
          }
          return false;
        },
        { timeout: rule.timeout }
      );

      const response = await responsePromise;
      const responseData = {
        url: response.url(),
        status: response.status(),
        statusText: response.statusText()
      };

      return {
        success: true,
        message: `Network response received: ${response.status()} ${response.url()}`,
        type: rule.type,
        duration: 0,
        actualValue: responseData
      };
    } catch (error) {
      return {
        success: false,
        message: `Expected network response not received for: ${rule.apiEndpoint}`,
        type: rule.type,
        duration: 0,
        error: error instanceof Error ? error.message : 'Network response verification failed',
        expectedValue: rule.apiEndpoint
      };
    }
  }

  /**
   * Verify that a specific console message appeared
   */
  private async verifyConsoleMessage(rule: VerificationRule): Promise<VerificationResult> {
    if (!rule.expectedText) {
      throw new Error('console_message verification requires expectedText');
    }

    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        resolve({
          success: false,
          message: `Console message not found: "${rule.expectedText}"`,
          type: rule.type,
          duration: 0,
          expectedValue: rule.expectedText
        });
      }, rule.timeout);

      // Monitor console messages
      const messageHandler = (msg: any) => {
        const text = msg.text();
        if (text.includes(rule.expectedText!)) {
          clearTimeout(timeout);
          this.page.off('console', messageHandler);

          resolve({
            success: true,
            message: `Console message found: "${text}"`,
            type: rule.type,
            duration: 0,
            actualValue: text,
            expectedValue: rule.expectedText
          });
        }
      };

      this.page.on('console', messageHandler);
    });
  }

  /**
   * Verify multiple rules and return combined result
   */
  async verifyMultipleRules(
    rules: VerificationRule[],
    mode: 'all' | 'any' = 'all'
  ): Promise<{
    success: boolean;
    results: VerificationResult[];
    summary: string;
  }> {
    const results: VerificationResult[] = [];
    let successCount = 0;

    for (const rule of rules) {
      const result = await this.verifyRule(rule);
      results.push(result);

      if (result.success) {
        successCount++;
      } else if (mode === 'all') {
        // In 'all' mode, fail fast on first failure
        break;
      }
    }

    const success = mode === 'all'
      ? successCount === rules.length
      : successCount > 0;

    const summary = `${successCount}/${rules.length} verifications passed (mode: ${mode})`;

    return { success, results, summary };
  }

  /**
   * Create a Playwright locator from our LocatorStrategy
   */
  private createLocator(strategy: LocatorStrategy): Locator {
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
   * Create verification rules for common scenarios
   */
  static createCommonVerifications() {
    return {
      /**
       * Verify successful login by checking for dashboard/welcome elements
       */
      loginSuccess: (dashboardSelector: string = '[data-testid="dashboard"]'): VerificationRule[] => [
        {
          type: 'element_present' as const,
          locator: { type: 'selector', value: dashboardSelector },
          timeout: 10000,
          required: true
        },
        {
          type: 'url_changed' as const,
          expectedUrl: '(dashboard|home|main)',
          timeout: 5000,
          required: false
        }
      ],

      /**
       * Verify form submission success
       */
      formSubmitSuccess: (successMessage: string = 'success'): VerificationRule[] => [
        {
          type: 'text_present' as const,
          expectedText: successMessage,
          timeout: 10000,
          required: true
        },
        {
          type: 'network_response' as const,
          apiEndpoint: '/api/',
          timeout: 15000,
          required: true
        }
      ],

      /**
       * Verify modal dialog appeared
       */
      modalAppeared: (): VerificationRule[] => [
        {
          type: 'element_present' as const,
          locator: { type: 'role', value: 'dialog' },
          timeout: 5000,
          required: true
        }
      ],

      /**
       * Verify loading spinner disappeared
       */
      loadingComplete: (): VerificationRule[] => [
        {
          type: 'element_absent' as const,
          locator: { type: 'selector', value: '.loading, .spinner, [data-loading="true"]' },
          timeout: 15000,
          required: true
        }
      ]
    };
  }
}