import { ServiceKey, serviceDefinitions } from '@/app/lib/service-definitions';

export function extractServiceKeys(session: any | null): ServiceKey[] {
  if (!session?.user) {
    return [];
  }
  const user = session.user as any;
  const keys = Array.isArray(user.serviceKeys) ? user.serviceKeys : [];
  return keys.filter((key: unknown): key is ServiceKey =>
    serviceDefinitions.some((service) => service.key === key)
  );
}

export function hasServiceAccess(
  session: any | null,
  services: ServiceKey | ServiceKey[]
): boolean {
  if (!session?.user) {
    return false;
  }

  if ((session.user as any)?.role === 'admin') {
    return true;
  }

  const required = Array.isArray(services) ? services : [services];
  if (required.length === 0) {
    return true;
  }

  const serviceKeys = extractServiceKeys(session);
  return required.some((service) => serviceKeys.includes(service));
}
