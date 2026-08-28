import * as argon2 from 'argon2';

/**
 * Argon2 parameters used for every password hash produced by this application.
 *
 * These are pinned explicitly rather than left to the library defaults so that
 * they can be raised later deliberately, and so that the runtime sign-in path,
 * the boot-time admin seeder and the create-user CLI cannot drift apart.
 *
 * Every password hash and verification in this codebase MUST go through the two
 * functions below. Do not call argon2 directly for passwords.
 */
const PASSWORD_HASH_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19456, // 19 MiB - OWASP minimum recommendation for argon2id
  timeCost: 2,
  parallelism: 1,
};

/**
 * A pre-computed hash of a value nobody can supply, used to burn the same amount
 * of CPU on a failed lookup as on a real verification. See `dummyVerify`.
 */
let dummyHashPromise: Promise<string> | null = null;

/**
 * Hash a plaintext password for storage.
 *
 * @param plainTextPassword The password to hash
 * @returns The encoded argon2id hash, safe to store as-is
 */
export function hashPassword(plainTextPassword: string): Promise<string> {
  return argon2.hash(plainTextPassword, PASSWORD_HASH_OPTIONS);
}

/**
 * Verify a plaintext password against a stored hash.
 *
 * Returns false rather than throwing when the stored value is not a valid argon2
 * hash, so that a malformed or legacy row cannot crash the sign-in route.
 *
 * @param storedHash The hash previously produced by `hashPassword`
 * @param plainTextPassword The password supplied by the user
 * @returns Whether the password matches
 */
export async function verifyPassword(
  storedHash: string,
  plainTextPassword: string,
): Promise<boolean> {
  try {
    return await argon2.verify(storedHash, plainTextPassword);
  } catch (error) {
    return false;
  }
}

/**
 * Burn roughly the same CPU time as a real `verifyPassword` call.
 *
 * Called when no user matches the supplied identifier, so that the response time
 * of "unknown user" and "wrong password" are indistinguishable. Without this, the
 * sign-in route leaks which usernames exist.
 */
export async function dummyVerify(
  plainTextPassword: string,
): Promise<void> {
  try {
    if (!dummyHashPromise) {
      // Clear the cache on failure. Caching a rejected promise for the lifetime
      // of the process would make every unknown-user request throw a 500 while
      // wrong-password requests still returned 401 -- restoring exactly the
      // enumeration oracle this function exists to remove.
      dummyHashPromise = hashPassword('hoppscotch-timing-equalizer').catch(
        (error) => {
          dummyHashPromise = null;
          throw error;
        },
      );
    }

    await verifyPassword(await dummyHashPromise, plainTextPassword);
  } catch (error) {
    // Swallow: the caller is on a failure path already and must not behave
    // differently here than it would for a wrong password.
  }
}
