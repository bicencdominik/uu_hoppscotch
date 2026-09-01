/**
 * Create a local password user, or update an existing user's password.
 *
 * Built by the normal `nest build`, so it ships inside the image and can be run
 * against a live deployment:
 *
 *   docker exec -it <container> \
 *     node /dist/backend/dist/src/cli/create-user.js alice
 *   docker exec -it <container> \
 *     node /dist/backend/dist/src/cli/create-user.js alice --admin
 *   docker exec -it <container> \
 *     node /dist/backend/dist/src/cli/create-user.js alice --update
 *
 * Note the `dist/src/` segment: nest emits under dist/src, not dist -- the same
 * path prod_run.mjs uses to launch the server (/dist/backend/dist/src/main.js).
 * The `start:prod` script in package.json still says `node dist/main` and is
 * stale upstream; do not copy the path from there.
 *
 * It boots a Nest application context and goes through UserService, rather than
 * touching the database directly, so that a user created here is byte-for-byte
 * equivalent to one created by the boot-time seeder -- same argon2 parameters,
 * same Account bookkeeping.
 */
// Must run before any import that loads AppModule/PrismaService, which read
// DATABASE_URL at construction time. `docker exec` starts a process attached
// directly to the container, not a child of the app's own supervisor process,
// so it never sees env vars that were only set at runtime in that process's
// memory (e.g. the derived DATABASE_URL in the aio-standalone embedded-Postgres
// image) -- only the container's original static env. dotenv fills that gap
// from the .env file aio_run.mjs writes for exactly this purpose; it's a no-op
// when the file doesn't exist, which is every other deployment target.
import 'dotenv/config';

import { NestFactory } from '@nestjs/core';
import * as O from 'fp-ts/Option';
import * as readline from 'readline';
import { AppModule } from '../app.module';
import { UserService } from '../user/user.service';
import { hashPassword } from '../auth/password.util';

const USAGE = `
Usage: node dist/src/cli/create-user.js <username> [password] [--admin] [--update]

  <username>   Login identifier for the new account
  [password]   Password. Omit it to be prompted on stdin, which keeps the
               password out of your shell history and the process list.

  --admin      Grant administrator rights
  --update     Allow updating an account that already exists (this is the only
               supported way to rotate a password)
`.trim();

function fail(message: string): never {
  console.error(`Error: ${message}`);
  process.exit(1);
}

async function promptForPassword(): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stderr,
  });

  const ask = (question: string): Promise<string> =>
    new Promise((resolve) => rl.question(question, resolve));

  try {
    const password = await ask('Password: ');
    const confirmation = await ask('Confirm password: ');

    if (password !== confirmation) fail('Passwords did not match.');
    return password;
  } finally {
    rl.close();
  }
}

async function main() {
  const argv = process.argv.slice(2);

  if (argv.length === 0 || argv.includes('--help') || argv.includes('-h')) {
    console.log(USAGE);
    process.exit(0);
  }

  // Left undefined unless --admin is passed, so that a bare password rotation
  // preserves whatever role the account already has.
  const isAdmin = argv.includes('--admin') ? true : undefined;
  const allowUpdate = argv.includes('--update');
  const positional = argv.filter((arg) => !arg.startsWith('--'));

  const [username, passwordArg] = positional;

  if (!username) fail(`No username given.\n\n${USAGE}`);
  if (positional.length > 2) fail(`Too many arguments.\n\n${USAGE}`);

  const password = passwordArg ?? (await promptForPassword());
  if (!password) fail('Password must not be empty.');

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });

  try {
    const usersService = app.get(UserService);
    const existingUser = await usersService.findUserByEmail(username);
    const userExists = O.isSome(existingUser);

    if (userExists && !allowUpdate) {
      fail(
        `A user "${username}" already exists. Pass --update to change their password.`,
      );
    }

    const passwordHash = await hashPassword(password);
    await usersService.upsertUserWithPassword(username, passwordHash, isAdmin);

    const action = userExists ? 'Updated' : 'Created';
    const role = isAdmin ? 'admin' : 'user';
    console.log(`${action} ${role} "${username}".`);
    if (userExists && !isAdmin) {
      console.log('Existing admin rights, if any, were left unchanged.');
    }
  } finally {
    await app.close();
  }
}

main().catch((error) => {
  console.error(`Error: ${error?.message ?? error}`);
  process.exit(1);
});
