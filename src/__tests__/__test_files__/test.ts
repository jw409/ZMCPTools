export class TestClass {
  constructor(public name: string) {}

  greet(): string {
    return `Hello, ${this.name}!`;
  }
}

export function testFunction(arg: string): void {
  console.log(arg);
}

export interface TestInterface {
  id: number;
  name: string;
}

const testVar = "test";
