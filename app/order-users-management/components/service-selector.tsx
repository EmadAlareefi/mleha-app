'use client';

import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import {
  getAssignableServices,
  serviceDefinitions,
  type ServiceDefinition,
  type ServiceKey,
  type ServiceRole,
} from '@/app/lib/service-definitions';

const ASSIGNABLE_SERVICES = getAssignableServices();
const SERVICE_MAP = new Map(serviceDefinitions.map((service) => [service.key, service]));

const ROLE_LABELS: Record<ServiceRole, string> = {
  orders: 'الطلبات',
  warehouse: 'المستودع',
  store_manager: 'إدارة المتجر',
  accountant: 'المحاسبة',
  delivery_agent: 'المناديب',
};

const OTHER_GROUP = 'أخرى';

// Place each service in a single group (its first granted role, or "other").
function getGroupLabel(service: ServiceDefinition): string {
  const role = service.grantsRoles[0];
  return role ? ROLE_LABELS[role] : OTHER_GROUP;
}

const GROUP_ORDER = [
  ROLE_LABELS.orders,
  ROLE_LABELS.warehouse,
  ROLE_LABELS.store_manager,
  ROLE_LABELS.accountant,
  ROLE_LABELS.delivery_agent,
  OTHER_GROUP,
];

interface ServiceSelectorProps {
  value: ServiceKey[];
  onChange: (next: ServiceKey[]) => void;
}

export function ServiceSelector({ value, onChange }: ServiceSelectorProps) {
  const [query, setQuery] = useState('');

  const selected = useMemo(() => new Set(value), [value]);

  const groups = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    const buckets = new Map<string, ServiceDefinition[]>();

    ASSIGNABLE_SERVICES.forEach((service) => {
      if (normalizedQuery) {
        const haystack = `${service.title} ${service.description}`.toLowerCase();
        if (!haystack.includes(normalizedQuery)) {
          return;
        }
      }
      const label = getGroupLabel(service);
      const bucket = buckets.get(label) ?? [];
      bucket.push(service);
      buckets.set(label, bucket);
    });

    return GROUP_ORDER.filter((label) => buckets.has(label)).map((label) => ({
      label,
      services: buckets.get(label)!,
    }));
  }, [query]);

  const toggleService = (key: ServiceKey) => {
    if (selected.has(key)) {
      if (value.length === 1) {
        return; // keep at least one selected
      }
      onChange(value.filter((item) => item !== key));
    } else {
      onChange([...value, key]);
    }
  };

  const toggleGroup = (services: ServiceDefinition[], allSelected: boolean) => {
    if (allSelected) {
      const groupKeys = new Set(services.map((service) => service.key));
      const next = value.filter((key) => !groupKeys.has(key));
      onChange(next.length > 0 ? next : value); // never clear everything
    } else {
      const merged = new Set(value);
      services.forEach((service) => merged.add(service.key));
      onChange(Array.from(merged));
    }
  };

  return (
    <div className="space-y-3">
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="ابحث عن صلاحية..."
          className="pr-9"
        />
      </div>

      <div className="max-h-72 space-y-4 overflow-y-auto rounded-lg border bg-muted/20 p-3">
        {groups.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            لا توجد صلاحيات مطابقة للبحث.
          </p>
        ) : (
          groups.map((group) => {
            const allSelected = group.services.every((service) => selected.has(service.key));
            return (
              <div key={group.label} className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-muted-foreground">{group.label}</span>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-6 px-2 text-xs"
                    onClick={() => toggleGroup(group.services, allSelected)}
                  >
                    {allSelected ? 'إلغاء الكل' : 'تحديد الكل'}
                  </Button>
                </div>
                <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                  {group.services.map((service) => {
                    const isSelected = selected.has(service.key);
                    return (
                      <label
                        key={service.key}
                        className={`flex cursor-pointer items-start gap-2.5 rounded-lg border px-3 py-2 transition ${
                          isSelected
                            ? 'border-primary bg-primary/5'
                            : 'border-border hover:border-muted-foreground/40'
                        }`}
                      >
                        <Checkbox
                          checked={isSelected}
                          onCheckedChange={() => toggleService(service.key)}
                          className="mt-0.5"
                        />
                        <div className="min-w-0">
                          <div className="text-sm font-medium">{service.title}</div>
                          <div className="text-xs text-muted-foreground">{service.description}</div>
                        </div>
                      </label>
                    );
                  })}
                </div>
              </div>
            );
          })
        )}
      </div>

      <div className="flex flex-wrap gap-1.5">
        {value.length > 0 ? (
          value.map((key) => (
            <Badge key={key} variant="secondary">
              {SERVICE_MAP.get(key)?.title || key}
            </Badge>
          ))
        ) : (
          <span className="text-xs text-muted-foreground">لم يتم اختيار صلاحيات بعد.</span>
        )}
      </div>
    </div>
  );
}
