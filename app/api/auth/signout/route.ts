import { createAuthActionHandler } from '../auth-handler';

const handler = createAuthActionHandler(['signout']);

export { handler as GET, handler as POST };
