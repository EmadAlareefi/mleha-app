import { createAuthActionHandler } from '../auth-handler';

const handler = createAuthActionHandler(['error']);

export { handler as GET, handler as POST };
