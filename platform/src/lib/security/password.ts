import { hash, verify } from "@node-rs/argon2";

/**
 * Argon2id with OWASP-recommended parameters (19 MiB, t=2, p=1).
 * `verifyPassword` against DUMMY_HASH when the user doesn't exist keeps login
 * timing uniform, so response time doesn't reveal which emails are registered.
 */

const OPTIONS = { memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;

export function hashPassword(password: string): Promise<string> {
  return hash(password, OPTIONS);
}

export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password);
  } catch {
    return false;
  }
}

let dummy: Promise<string> | null = null;
export function dummyHash(): Promise<string> {
  dummy ??= hash("not-a-real-password-used-for-timing", OPTIONS);
  return dummy;
}
