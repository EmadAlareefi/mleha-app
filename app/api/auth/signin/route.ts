import { createAuthActionHandler } from '../auth-handler';

const handler = createAuthActionHandler(['signin']);

export { handler as GET, handler as POST };
