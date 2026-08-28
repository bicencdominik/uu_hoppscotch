import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

/**
 * Inputs for local username/password sign-in.
 *
 * `username` is deliberately not validated as an email: this deployment reuses
 * the User.email column as a free-form login identifier, so operators can create
 * accounts like `admin` that are not email addresses.
 */
export class SignInPasswordDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  username: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(512) // guards against very long inputs being fed to argon2
  password: string;
}
