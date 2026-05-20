import { createAuthActionHandler } from '../auth-handler';

const handler = createAuthActionHandler(['csrf']);

export { handler as GET, handler as POST };
