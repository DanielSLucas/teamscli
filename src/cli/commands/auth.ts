import { requestDeviceCode, waitForDeviceLogin } from '../../auth/devicecode.ts';
import { writeIdentity } from '../../auth/identity.ts';
import { createSession } from '../../auth/session.ts';
import { CliError } from '../../errors.ts';
import type { Account } from '../../models.ts';
import type { Command } from '../command.ts';
import { secretStore } from '../session.ts';

const command: Command<Account & { secretStore: string }> = {
  name: 'auth',
  summary: 'Sign in with a device code and save the login for the account',
  mutates: true,
  async run(ctx) {
    const store = secretStore(ctx);
    const deps = { fetch: ctx.fetch, now: ctx.now };
    const code = await requestDeviceCode(deps);
    ctx.log(`To sign in, open ${code.verificationUri} and enter the code ${code.userCode}`);
    ctx.log('Waiting for sign-in...');
    const login = await waitForDeviceLogin(code, deps);
    if (!login.refreshToken) throw new CliError('auth_required', 'Azure AD returned no refresh token; the login cannot be kept.');

    // Proves the login reaches Teams before saving it.
    const account = await createSession({ account: ctx.account, store, fetch: ctx.fetch, login }).account();
    await store.set(ctx.account, login.refreshToken);
    writeIdentity(ctx.home, ctx.account, {
      userId: account.userId,
      tenantId: account.tenantId,
      region: account.region,
      displayName: account.displayName,
    });
    ctx.log(`Signed in; login saved in the ${store.kind} secret store.`);
    return { ...account, secretStore: store.kind };
  },
};

export default command;
