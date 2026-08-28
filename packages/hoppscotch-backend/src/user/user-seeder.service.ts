import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { UserService } from './user.service';
import { hashPassword } from 'src/auth/password.util';
import * as O from 'fp-ts/Option';

/**
 * Creates the initial administrator account at boot from environment variables.
 *
 * This exists because the instance is deployed on an air-gapped network with no
 * mail server and no SSO, so there is no self-service way for the very first
 * account to come into being. Every subsequent account is created with the
 * create-user CLI.
 *
 * The seeder is deliberately create-only: if the account already exists it is
 * left completely alone, so that a password changed with the CLI is not silently
 * reverted to the environment value on the next container restart. Use the CLI's
 * update mode to rotate a password.
 */
@Injectable()
export class UserSeederService implements OnModuleInit {
  private readonly logger = new Logger(UserSeederService.name);

  constructor(private readonly usersService: UserService) {}

  async onModuleInit() {
    await this.seedInitialAdmin();
  }

  private async seedInitialAdmin() {
    const username = process.env.HOPP_INITIAL_ADMIN_USER?.trim();
    const password = process.env.HOPP_INITIAL_ADMIN_PASSWORD;

    if (!username && !password) return; // nothing configured, nothing to do

    if (!username || !password) {
      this.logger.error(
        'HOPP_INITIAL_ADMIN_USER and HOPP_INITIAL_ADMIN_PASSWORD must be set together. No admin was seeded.',
      );
      return;
    }

    try {
      const existingUser = await this.usersService.findUserByEmail(username);
      if (O.isSome(existingUser)) {
        this.logger.log(
          `Initial admin "${username}" already exists, leaving it untouched.`,
        );
        return;
      }

      const passwordHash = await hashPassword(password);
      await this.usersService.upsertUserWithPassword(
        username,
        passwordHash,
        true,
      );

      this.logger.log(`Seeded initial admin account "${username}".`);
    } catch (error) {
      // Never take the whole application down over seeding: an operator can
      // always create the account with the CLI instead.
      this.logger.error(
        `Failed to seed the initial admin account: ${error?.message ?? error}`,
      );
    }
  }
}
