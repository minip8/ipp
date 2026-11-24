/**
 * Better Auth, mounted at /api/auth. The browser reaches it through the web origin's `/api/*`
 * rewrite, so the base URL (cookies, OAuth callbacks) is WEB_ORIGIN.
 */
import { authSchema, type Db, messages, padMembers, runs } from '@ipp/db';
import { eq, sql } from '@ipp/db/orm';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { anonymous } from 'better-auth/plugins';
import type { Logger } from 'pino';
import type { Config } from './config';

export function createAuth(config: Config, db: Db, log: Logger) {
  const authLog = log.child({ component: 'auth' });
  return betterAuth({
    logger: {
      level: 'warn',
      log: (level, message) => authLog[level]({}, message),
    },
    appName: 'interview++',
    baseURL: config.webOrigin,
    basePath: '/api/auth',
    secret: config.authSecret,
    trustedOrigins: [config.webOrigin, config.apiOrigin],
    database: drizzleAdapter(db, { provider: 'pg', schema: authSchema }),
    emailAndPassword: {
      enabled: true,
      autoSignIn: true,
      minPasswordLength: 8,
      maxPasswordLength: 128,
      requireEmailVerification: false,
    },
    // A social sign-in whose email already belongs to a password account is NOT linked to it
    // automatically: Better Auth requires the local email to be verified first, and we do not
    // verify emails. That is deliberate (it blocks pre-registering someone else's address); the
    // web app explains the resulting `account_not_linked` error.
    socialProviders: {
      ...(config.github ? { github: config.github } : {}),
      ...(config.google ? { google: config.google } : {}),
    },
    session: {
      expiresIn: 60 * 60 * 24 * 30,
      updateAge: 60 * 60 * 24,
    },
    // Auth endpoints are rate limited per IP in Redis by our own middleware.
    rateLimit: { enabled: false },
    advanced: {
      // Better Auth skips its origin and callback-URL validation when NODE_ENV is "test" unless
      // this is set, so say it explicitly: the tests then exercise the real behaviour.
      disableOriginCheck: false,
      useSecureCookies: config.env === 'production',
      defaultCookieAttributes: {
        httpOnly: true,
        sameSite: 'lax',
        secure: config.env === 'production',
      },
      database: { generateId: () => crypto.randomUUID() },
      ipAddress: { ipAddressHeaders: ['x-forwarded-for'] },
    },
    telemetry: { enabled: false },
    plugins: [
      // Guests: someone who joins a room by its invite link with just a name. They are created
      // only by POST /api/pads/join-guest (the plugin's own sign-in endpoint is not routed), and
      // every route but the pad they joined refuses them (`requireAccount`).
      anonymous({
        emailDomainName: 'guest.invalid',
        // A guest who then signs in or signs up keeps the rooms they were in: memberships, runs
        // and messages move to the account before the plugin deletes the guest user.
        onLinkAccount: async ({ anonymousUser, newUser }) => {
          const from = anonymousUser.user.id;
          const to = newUser.user.id;
          if (from === to) return;
          await db.execute(sql`
            insert into pad_members (pad_id, user_id, role, joined_at)
            select pad_id, ${to}, role, joined_at from pad_members where user_id = ${from}
            on conflict do nothing`);
          await db.delete(padMembers).where(eq(padMembers.userId, from));
          await db.update(runs).set({ userId: to }).where(eq(runs.userId, from));
          await db.update(messages).set({ userId: to }).where(eq(messages.userId, from));
        },
      }),
    ],
  });
}

export type Auth = ReturnType<typeof createAuth>;

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  image: string | null;
  /** Joined a room by its link without an account: may only use the pads they are a member of. */
  guest: boolean;
}
