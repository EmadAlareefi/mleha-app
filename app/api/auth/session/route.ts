import { createAuthActionHandler } from '../auth-handler';

const handler = createAuthActionHandler(['session']);

export { handler as GET, handler as POST };
