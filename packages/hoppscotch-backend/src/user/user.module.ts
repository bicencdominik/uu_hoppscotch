import { Module } from '@nestjs/common';
import { UserResolver } from './user.resolver';
import { UserService } from './user.service';
import { UserSeederService } from './user-seeder.service';

@Module({
  providers: [UserResolver, UserService, UserSeederService],
  exports: [UserService],
})
export class UserModule {}
