// TypeScript marker file for comprehensive symbol extraction testing
// Each symbol type appears EXACTLY once with clear marker names

export interface TestMarkerInterface {
  id: number;
}

export class TestMarkerClass {
  testMarkerMethod() {
    return "test";
  }
}

export function testMarkerFunction() {
  return 42;
}