import { createAuthActionHandler } from '../auth-handler';

const handler = createAuthActionHandler(['providers']);

export { handler as GET, handler as POST };
