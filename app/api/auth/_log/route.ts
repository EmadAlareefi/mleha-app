import { createAuthActionHandler } from '../auth-handler';

const handler = createAuthActionHandler(['_log']);

export { handler as GET, handler as POST };
