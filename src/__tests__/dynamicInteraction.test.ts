import { describe, it, expect, beforeEach, afterEach, vi, type MockedFunction } from 'vitest';
import { chromium, type Browser, type Page, type BrowserContext } from 'patchright';
import { DynamicInteractionService } from '../services/DynamicInteractionService.js';
import { PageStateObserver } from '../services/PageStateObserver.js';
import { ActionPlanner } from '../services/ActionPlanner.js';
import { ActionVerifier } from '../services/ActionVerifier.js';
import { WaitStrategies } from '../utils/waitStrategies.js';
import type { PerformDynamicInteraction } from '../schemas/tools/dynamicInteraction.js';

describe('DynamicInteractionService', () => {
  let browser: Browser;
  let context: BrowserContext;
  let page: Page;
  let service: DynamicInteractionService;

  beforeEach(async () => {
    browser = await chromium.launch({ headless: true });
    context = await browser.newContext();
    page = await context.newPage();
    service = new DynamicInteractionService(page);
  });

  afterEach(async () => {
    await page.close();
    await context.close();
    await browser.close();
  });

  describe('Basic Functionality', () => {
    it('should handle simple click interactions', async () => {
      // Set up a simple test page
      await page.setContent(`
        <html>
          <body>
            <button id="test-button">Click Me</button>
            <div id="result" style="display: none;">Success!</div>
            <script>
              document.getElementById('test-button').addEventListener('click', () => {
                document.getElementById('result').style.display = 'block';
              });
            </script>
          </body>
        </html>
      `);

      const params: PerformDynamicInteraction = {
        session_id: 'test-session',
        objective: 'Click the button and verify success message appears',
        steps: [
          {
            action: 'click',
            locator: { type: 'selector', value: '#test-button' },
            verify: [{
              type: 'element_present',
              locator: { type: 'selector', value: '#result' },
              timeout: 5000,
              required: true
            }]
          }
        ]
      };

      const result = await service.executeInteraction(params);

      expect(result.success).toBe(true);
      expect(result.stepsExecuted).toBe(1);
      expect(result.results).toHaveLength(1);
      expect(result.results[0].success).toBe(true);
    });

    it('should handle form filling interactions', async () => {
      await page.setContent(`
        <html>
          <body>
            <form id="test-form">
              <input type="text" id="username" placeholder="Username" />
              <input type="password" id="password" placeholder="Password" />
              <button type="submit">Submit</button>
            </form>
            <div id="success" style="display: none;">Form submitted!</div>
            <script>
              document.getElementById('test-form').addEventListener('submit', (e) => {
                e.preventDefault();
                document.getElementById('success').style.display = 'block';
              });
            </script>
          </body>
        </html>
      `);

      const params: PerformDynamicInteraction = {
        session_id: 'test-session',
        objective: 'Fill out the login form with username and password, then submit',
        steps: [
          {
            action: 'fill',
            locator: { type: 'selector', value: '#username' },
            value: 'testuser'
          },
          {
            action: 'fill',
            locator: { type: 'selector', value: '#password' },
            value: 'testpass'
          },
          {
            action: 'click',
            locator: { type: 'role', value: 'button', options: { name: 'Submit' } },
            verify: [{
              type: 'element_present',
              locator: { type: 'selector', value: '#success' },
              timeout: 5000,
              required: true
            }]
          }
        ]
      };

      const result = await service.executeInteraction(params);

      expect(result.success).toBe(true);
      expect(result.stepsExecuted).toBe(3);
      expect(result.results.every(r => r.success)).toBe(true);
    });
  });

  describe('Error Handling and Retries', () => {
    it('should retry failed actions according to configuration', async () => {
      await page.setContent(`
        <html>
          <body>
            <button id="flaky-button">Flaky Button</button>
            <div id="result" style="display: none;">Eventually works!</div>
            <script>
              let clickCount = 0;
              document.getElementById('flaky-button').addEventListener('click', () => {
                clickCount++;
                // Only work on the 3rd try
                if (clickCount >= 3) {
                  document.getElementById('result').style.display = 'block';
                }
              });
            </script>
          </body>
        </html>
      `);

      const params: PerformDynamicInteraction = {
        session_id: 'test-session',
        objective: 'Click the flaky button until it works',
        config: {
          maxRetries: 5,
          retryDelay: 100
        },
        steps: [
          {
            action: 'click',
            locator: { type: 'selector', value: '#flaky-button' },
            verify: [{
              type: 'element_present',
              locator: { type: 'selector', value: '#result' },
              timeout: 1000,
              required: true
            }]
          }
        ]
      };

      const result = await service.executeInteraction(params);

      expect(result.success).toBe(true);
      expect(result.results[0].retryCount).toBeGreaterThan(0);
      expect(result.results[0].retryCount).toBeLessThanOrEqual(5);
    });

    it('should handle timeout scenarios gracefully', async () => {
      await page.setContent(`
        <html>
          <body>
            <button id="slow-button">Slow Button</button>
            <div id="result" style="display: none;">Eventually appears</div>
            <script>
              document.getElementById('slow-button').addEventListener('click', () => {
                setTimeout(() => {
                  document.getElementById('result').style.display = 'block';
                }, 10000); // 10 second delay
              });
            </script>
          </body>
        </html>
      `);

      const params: PerformDynamicInteraction = {
        session_id: 'test-session',
        objective: 'Click button and wait for result (should timeout)',
        config: {
          maxRetries: 1,
          globalTimeout: 2000 // 2 second global timeout
        },
        steps: [
          {
            action: 'click',
            locator: { type: 'selector', value: '#slow-button' },
            verify: [{
              type: 'element_present',
              locator: { type: 'selector', value: '#result' },
              timeout: 5000,
              required: true
            }]
          }
        ]
      };

      const result = await service.executeInteraction(params);

      expect(result.success).toBe(false);
      expect(result.executionTime).toBeLessThan(3000); // Should timeout before verification completes
    });
  });

  describe('Dynamic Page Scenarios', () => {
    it('should handle SPA navigation', async () => {
      await page.setContent(`
        <html>
          <head>
            <style>
              .page { display: none; }
              .page.active { display: block; }
            </style>
          </head>
          <body>
            <nav>
              <a href="#" id="home-link">Home</a>
              <a href="#" id="about-link">About</a>
            </nav>
            <div id="home-page" class="page active">
              <h1>Home Page</h1>
              <p>Welcome to the home page</p>
            </div>
            <div id="about-page" class="page">
              <h1>About Page</h1>
              <p>This is the about page</p>
            </div>
            <script>
              document.getElementById('about-link').addEventListener('click', (e) => {
                e.preventDefault();
                document.getElementById('home-page').classList.remove('active');
                document.getElementById('about-page').classList.add('active');
                history.pushState({}, '', '/about');
              });
            </script>
          </body>
        </html>
      `);

      const params: PerformDynamicInteraction = {
        session_id: 'test-session',
        objective: 'Navigate to the about page',
        steps: [
          {
            action: 'click',
            locator: { type: 'selector', value: '#about-link' },
            waitAfter: { type: 'element_visible', target: '#about-page', timeout: 5000 },
            verify: [
              {
                type: 'element_present',
                locator: { type: 'selector', value: '#about-page.active' },
                timeout: 5000,
                required: true
              },
              {
                type: 'text_present',
                expectedText: 'This is the about page',
                timeout: 5000,
                required: true
              }
            ]
          }
        ]
      };

      const result = await service.executeInteraction(params);

      expect(result.success).toBe(true);
      expect(result.results[0].verificationResults).toHaveLength(2);
      expect(result.results[0].verificationResults?.every(v => v.success)).toBe(true);
    });

    it('should handle loading states', async () => {
      await page.setContent(`
        <html>
          <body>
            <button id="load-data">Load Data</button>
            <div id="loading" style="display: none;">Loading...</div>
            <div id="data" style="display: none;">Data loaded successfully!</div>
            <script>
              document.getElementById('load-data').addEventListener('click', () => {
                const loading = document.getElementById('loading');
                const data = document.getElementById('data');

                loading.style.display = 'block';

                setTimeout(() => {
                  loading.style.display = 'none';
                  data.style.display = 'block';
                }, 1000);
              });
            </script>
          </body>
        </html>
      `);

      const params: PerformDynamicInteraction = {
        session_id: 'test-session',
        objective: 'Load data and wait for completion',
        steps: [
          {
            action: 'click',
            locator: { type: 'selector', value: '#load-data' },
            waitAfter: { type: 'element_hidden', target: '#loading', timeout: 5000 },
            verify: [{
              type: 'element_present',
              locator: { type: 'selector', value: '#data' },
              timeout: 5000,
              required: true
            }]
          }
        ]
      };

      const result = await service.executeInteraction(params);

      expect(result.success).toBe(true);
      expect(result.results[0].success).toBe(true);
    });
  });
});

describe('PageStateObserver', () => {
  let browser: Browser;
  let context: BrowserContext;
  let page: Page;
  let observer: PageStateObserver;

  beforeEach(async () => {
    browser = await chromium.launch({ headless: true });
    context = await browser.newContext();
    page = await context.newPage();
    observer = new PageStateObserver(page);
  });

  afterEach(async () => {
    await observer.stopMonitoring();
    await page.close();
    await context.close();
    await browser.close();
  });

  it('should detect page state changes', async () => {
    await page.setContent(`
      <html>
        <body>
          <div id="content">Initial content</div>
          <button id="change-content">Change Content</button>
          <script>
            document.getElementById('change-content').addEventListener('click', () => {
              document.getElementById('content').textContent = 'Changed content';
            });
          </script>
        </body>
      </html>
    `);

    await observer.startMonitoring();

    const initialState = await observer.captureCurrentState();
    expect(initialState.interactiveElements.length).toBeGreaterThan(0);

    // Trigger a change
    await page.click('#change-content');

    // Wait a bit for the change to be detected
    await page.waitForTimeout(500);

    const changes = await observer.detectStateChanges();
    expect(changes.length).toBeGreaterThan(0);
  });

  it('should detect loading indicators', async () => {
    await page.setContent(`
      <html>
        <body>
          <button id="show-spinner">Show Spinner</button>
          <div class="spinner" id="spinner" style="display: none;">Loading...</div>
          <script>
            document.getElementById('show-spinner').addEventListener('click', () => {
              const spinner = document.getElementById('spinner');
              spinner.style.display = 'block';
              setTimeout(() => {
                spinner.style.display = 'none';
              }, 1000);
            });
          </script>
        </body>
      </html>
    `);

    await observer.startMonitoring();

    // Trigger loading state
    await page.click('#show-spinner');

    // Check if loading indicator is detected
    const state = await observer.captureCurrentState();
    const hasLoadingIndicator = state.loadingIndicators.some(
      indicator => indicator.selector === '.spinner' && indicator.visible
    );

    expect(hasLoadingIndicator).toBe(true);
  });

  it('should wait for stable state', async () => {
    await page.setContent(`
      <html>
        <body>
          <div id="content">Content</div>
          <script>
            let mutations = 0;
            const interval = setInterval(() => {
              document.getElementById('content').textContent = 'Content ' + mutations++;
              if (mutations > 3) {
                clearInterval(interval);
              }
            }, 100);
          </script>
        </body>
      </html>
    `);

    await observer.startMonitoring();

    const stabilityResult = await observer.waitForStableState(5000, 1000);
    expect(stabilityResult.success).toBe(true);
    expect(stabilityResult.duration).toBeGreaterThan(500); // Should take some time to stabilize
  });
});

describe('ActionPlanner', () => {
  let browser: Browser;
  let context: BrowserContext;
  let page: Page;
  let planner: ActionPlanner;

  beforeEach(async () => {
    browser = await chromium.launch({ headless: true });
    context = await browser.newContext();
    page = await context.newPage();
    planner = new ActionPlanner(page);
  });

  afterEach(async () => {
    await page.close();
    await context.close();
    await browser.close();
  });

  it('should plan login flow correctly', async () => {
    const mockState = {
      url: 'https://example.com/login',
      title: 'Login Page',
      readyState: 'complete',
      timestamp: Date.now(),
      networkRequests: [],
      domMutations: 0,
      consoleMessages: [],
      loadingIndicators: [],
      interactiveElements: [
        {
          selector: 'input[type="email"]',
          tagName: 'input',
          type: 'email',
          visible: true,
          enabled: true,
          text: '',
          timestamp: Date.now()
        },
        {
          selector: 'input[type="password"]',
          tagName: 'input',
          type: 'password',
          visible: true,
          enabled: true,
          text: '',
          timestamp: Date.now()
        },
        {
          selector: 'button[type="submit"]',
          tagName: 'button',
          type: 'submit',
          visible: true,
          enabled: true,
          text: 'Sign In',
          timestamp: Date.now()
        }
      ]
    };

    const planResult = await planner.planActions({
      objective: 'Log in with username admin and password secret123',
      currentState: mockState,
      interactiveElements: mockState.interactiveElements,
      userCredentials: {
        username: 'admin',
        password: 'secret123'
      }
    });

    expect(planResult.steps.length).toBe(3); // Email, password, submit
    expect(planResult.steps[0].action).toBe('fill');
    expect(planResult.steps[0].value).toBe('admin');
    expect(planResult.steps[1].action).toBe('fill');
    expect(planResult.steps[1].value).toBe('secret123');
    expect(planResult.steps[2].action).toBe('click');
    expect(planResult.confidence).toBeGreaterThan(0.7);
  });

  it('should plan form filling flow', async () => {
    const mockState = {
      url: 'https://example.com/contact',
      title: 'Contact Form',
      readyState: 'complete',
      timestamp: Date.now(),
      networkRequests: [],
      domMutations: 0,
      consoleMessages: [],
      loadingIndicators: [],
      interactiveElements: [
        {
          selector: 'input[name="name"]',
          tagName: 'input',
          type: 'text',
          visible: true,
          enabled: true,
          text: '',
          timestamp: Date.now()
        },
        {
          selector: 'input[name="email"]',
          tagName: 'input',
          type: 'email',
          visible: true,
          enabled: true,
          text: '',
          timestamp: Date.now()
        },
        {
          selector: 'textarea[name="message"]',
          tagName: 'textarea',
          visible: true,
          enabled: true,
          text: '',
          timestamp: Date.now()
        },
        {
          selector: 'button[type="submit"]',
          tagName: 'button',
          type: 'submit',
          visible: true,
          enabled: true,
          text: 'Send Message',
          timestamp: Date.now()
        }
      ]
    };

    const planResult = await planner.planActions({
      objective: 'Fill contact form with name=John, email=john@example.com, message=Hello and submit',
      currentState: mockState,
      interactiveElements: mockState.interactiveElements
    });

    expect(planResult.steps.length).toBeGreaterThan(0);
    expect(planResult.reasoning).toContain('Planning form fill flow');
  });
});

describe('ActionVerifier', () => {
  let browser: Browser;
  let context: BrowserContext;
  let page: Page;
  let verifier: ActionVerifier;

  beforeEach(async () => {
    browser = await chromium.launch({ headless: true });
    context = await browser.newContext();
    page = await context.newPage();
    verifier = new ActionVerifier(page);
  });

  afterEach(async () => {
    await page.close();
    await context.close();
    await browser.close();
  });

  it('should verify element presence correctly', async () => {
    await page.setContent(`
      <html>
        <body>
          <div id="visible-element">I am visible</div>
          <div id="hidden-element" style="display: none;">I am hidden</div>
        </body>
      </html>
    `);

    const visibleResult = await verifier.verifyRule({
      type: 'element_present',
      locator: { type: 'selector', value: '#visible-element' },
      timeout: 5000,
      required: true
    });

    expect(visibleResult.success).toBe(true);
    expect(visibleResult.message).toContain('visible');

    const hiddenResult = await verifier.verifyRule({
      type: 'element_present',
      locator: { type: 'selector', value: '#hidden-element' },
      timeout: 1000,
      required: true
    });

    expect(hiddenResult.success).toBe(false);
  });

  it('should verify text presence correctly', async () => {
    await page.setContent(`
      <html>
        <body>
          <div>Welcome to our website!</div>
          <p>This is some content</p>
        </body>
      </html>
    `);

    const presentResult = await verifier.verifyRule({
      type: 'text_present',
      expectedText: 'Welcome to our website',
      timeout: 5000,
      required: true
    });

    expect(presentResult.success).toBe(true);

    const absentResult = await verifier.verifyRule({
      type: 'text_present',
      expectedText: 'This text does not exist',
      timeout: 1000,
      required: true
    });

    expect(absentResult.success).toBe(false);
  });

  it('should verify URL changes correctly', async () => {
    await page.goto('data:text/html,<html><body><h1>Test Page</h1></body></html>');

    const urlResult = await verifier.verifyRule({
      type: 'url_changed',
      expectedUrl: 'data:text/html',
      timeout: 5000,
      required: true
    });

    expect(urlResult.success).toBe(true);
  });
});

describe('WaitStrategies', () => {
  let browser: Browser;
  let context: BrowserContext;
  let page: Page;
  let waitStrategies: WaitStrategies;

  beforeEach(async () => {
    browser = await chromium.launch({ headless: true });
    context = await browser.newContext();
    page = await context.newPage();
    waitStrategies = new WaitStrategies(page);
  });

  afterEach(async () => {
    await page.close();
    await context.close();
    await browser.close();
  });

  it('should execute element visibility wait strategy', async () => {
    await page.setContent(`
      <html>
        <body>
          <div id="initially-hidden" style="display: none;">Hidden content</div>
          <button id="show-content">Show Content</button>
          <script>
            document.getElementById('show-content').addEventListener('click', () => {
              setTimeout(() => {
                document.getElementById('initially-hidden').style.display = 'block';
              }, 500);
            });
          </script>
        </body>
      </html>
    `);

    // Trigger the show action
    await page.click('#show-content');

    const result = await waitStrategies.executeWaitStrategy({
      type: 'element_visible',
      target: 'selector:#initially-hidden',
      timeout: 2000
    });

    expect(result.success).toBe(true);
    expect(result.duration).toBeGreaterThan(400); // Should take at least 500ms
  });

  it('should execute smart wait correctly', async () => {
    await page.setContent(`
      <html>
        <body>
          <div class="loading" id="spinner">Loading...</div>
          <div id="content" style="display: none;">Content loaded</div>
          <script>
            setTimeout(() => {
              document.getElementById('spinner').style.display = 'none';
              document.getElementById('content').style.display = 'block';
            }, 800);
          </script>
        </body>
      </html>
    `);

    const result = await waitStrategies.smartWait(5000);

    expect(result.success).toBe(true);
    expect(['loading_indicator_.loading', 'dom_stable']).toContain(result.detectedState);
  });
});

describe('Integration Tests', () => {
  let browser: Browser;
  let context: BrowserContext;
  let page: Page;
  let service: DynamicInteractionService;

  beforeEach(async () => {
    browser = await chromium.launch({ headless: true });
    context = await browser.newContext();
    page = await context.newPage();
    service = new DynamicInteractionService(page);
  });

  afterEach(async () => {
    await page.close();
    await context.close();
    await browser.close();
  });

  it('should handle complex multi-step workflow', async () => {
    await page.setContent(`
      <html>
        <body>
          <div id="step1" class="step active">
            <h2>Step 1: Enter Information</h2>
            <input type="text" id="name" placeholder="Your name" />
            <button id="next1">Next</button>
          </div>

          <div id="step2" class="step" style="display: none;">
            <h2>Step 2: Confirmation</h2>
            <p>Hello, <span id="greeting-name"></span>!</p>
            <button id="confirm">Confirm</button>
          </div>

          <div id="step3" class="step" style="display: none;">
            <h2>Step 3: Complete</h2>
            <p>Process completed successfully!</p>
          </div>

          <script>
            document.getElementById('next1').addEventListener('click', () => {
              const name = document.getElementById('name').value;
              if (name) {
                document.getElementById('step1').style.display = 'none';
                document.getElementById('step2').style.display = 'block';
                document.getElementById('greeting-name').textContent = name;
              }
            });

            document.getElementById('confirm').addEventListener('click', () => {
              document.getElementById('step2').style.display = 'none';
              document.getElementById('step3').style.display = 'block';
            });
          </script>

          <style>
            .step { padding: 20px; border: 1px solid #ccc; margin: 10px; }
          </style>
        </body>
      </html>
    `);

    const params: PerformDynamicInteraction = {
      session_id: 'test-session',
      objective: 'Complete the 3-step process with name "John Doe"',
      steps: [
        {
          action: 'fill',
          locator: { type: 'selector', value: '#name' },
          value: 'John Doe'
        },
        {
          action: 'click',
          locator: { type: 'selector', value: '#next1' },
          verify: [{
            type: 'element_present',
            locator: { type: 'selector', value: '#step2' },
            timeout: 5000,
            required: true
          }]
        },
        {
          action: 'click',
          locator: { type: 'selector', value: '#confirm' },
          verify: [{
            type: 'text_present',
            expectedText: 'Process completed successfully',
            timeout: 5000,
            required: true
          }]
        }
      ]
    };

    const result = await service.executeInteraction(params);

    expect(result.success).toBe(true);
    expect(result.stepsExecuted).toBe(3);
    expect(result.results.every(r => r.success)).toBe(true);
    expect(result.results.every(r => r.verificationResults?.every(v => v.success) ?? true)).toBe(true);
  });
});