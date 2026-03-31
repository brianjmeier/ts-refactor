export interface UserProfile {
  id: string;
  name: string;
  email: string;
}

export function createUser(name: string, email: string): UserProfile {
  return { id: crypto.randomUUID(), name, email };
}

export function getUserName(user: UserProfile): string {
  return user.name;
}

function localHelper(count: number): number {
  const multiplier = 2;
  return count * multiplier;
}

export const DEFAULT_COUNT = localHelper(5);
