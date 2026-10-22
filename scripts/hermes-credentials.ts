/**
 * Manage Hermes API credentials. The plaintext key is printed once, on
 * create/rotate; store it straight into the Hermes gateway's secret store.
 *
 * Usage (HERMES_API_KEY_PEPPER and DATABASE_URL must be set):
 *   npm run hermes:credentials -- create --name "Hermes support" --merchant 1696031053 \
 *       --scopes hermes:support:read --created-by "<your name>" [--expires-days 90]
 *   npm run hermes:credentials -- list [--merchant 1696031053]
 *   npm run hermes:credentials -- revoke --id <id> --by "<your name>" [--reason "..."]
 *   npm run hermes:credentials -- rotate --id <id> --by "<your name>" [--grace-hours 24]
 */
import { prisma } from '@/lib/prisma';
import {
  createCredential,
  grantCredentialScopes,
  listCredentials,
  revokeCredential,
  rotateCredential,
  type IssuedCredential,
} from '@/app/lib/hermes/credential-admin';

function option(name: string): string | null {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] && !process.argv[index + 1].startsWith('--')
    ? process.argv[index + 1]
    : null;
}

function required(name: string): string {
  const value = option(name);
  if (!value) throw new Error(`--${name} is required`);
  return value;
}

function printIssued(issued: IssuedCredential) {
  console.log(`credential id : ${issued.id}`);
  console.log(`scopes        : ${issued.scopes.join(', ')}`);
  console.log(`expires at    : ${issued.expiresAt?.toISOString() ?? 'never'}`);
  console.log('');
  console.log('API key (shown once — it cannot be recovered):');
  console.log(issued.apiKey);
}

async function main() {
  const command = process.argv[2];
  switch (command) {
    case 'grant': {
      console.log(await grantCredentialScopes(required('id'), required('scopes').split(',').map(scope => scope.trim()), required('by')));
      break;
    }
    case 'create': {
      const expires = option('expires-days');
      printIssued(
        await createCredential({
          name: required('name'),
          merchantId: required('merchant'),
          scopes: required('scopes').split(',').map((scope) => scope.trim()),
          createdBy: required('created-by'),
          expiresInDays: expires ? Number(expires) : null,
        })
      );
      break;
    }
    case 'list': {
      const rows = await listCredentials(option('merchant') ?? undefined);
      console.table(
        rows.map((row) => ({
          id: row.id,
          key: `hrm_${row.keyId}_…`,
          name: row.name,
          merchant: row.merchantId,
          scopes: row.scopes.join(' '),
          expires: row.expiresAt?.toISOString() ?? '',
          revoked: row.revokedAt?.toISOString() ?? '',
          lastUsed: row.lastUsedAt?.toISOString() ?? '',
        }))
      );
      break;
    }
    case 'revoke':
      await revokeCredential(required('id'), required('by'), option('reason'));
      console.log('revoked');
      break;
    case 'rotate': {
      const grace = option('grace-hours');
      printIssued(await rotateCredential(required('id'), required('by'), grace ? Number(grace) : 24));
      break;
    }
    default:
      throw new Error('command must be one of: create, list, grant, revoke, rotate');
  }
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
