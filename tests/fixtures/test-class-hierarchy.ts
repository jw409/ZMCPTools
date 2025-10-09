/**
 * Test fixture for hierarchical symbol indexing
 * Contains classes with methods to verify parent-child relationships
 */

export class AuthService {
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async login(username: string, password: string): Promise<boolean> {
    // Login implementation
    return true;
  }

  async logout(): Promise<void> {
    // Logout implementation
  }

  validateToken(token: string): boolean {
    return token.length > 0;
  }
}

export class UserManager extends AuthService {
  async createUser(username: string, email: string): Promise<void> {
    // Create user implementation
  }

  async deleteUser(userId: string): Promise<boolean> {
    // Delete user implementation
    return true;
  }
}

export function standaloneFunction(): void {
  // Top-level function (no parent)
}

// Comment
