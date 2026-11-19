import type { DocumentStatus, OrganizationRole } from '@/lib/api/types';

const DOCUMENT_STATUS_STYLES: Record<
  DocumentStatus,
  { label: string; className: string; dotClassName: string }
> = {
  PENDING: {
    label: 'Pending',
    className: 'border-amber-200 bg-amber-50 text-amber-800',
    dotClassName: 'bg-amber-500',
  },
  PROCESSING: {
    label: 'Processing',
    className: 'border-sky-200 bg-sky-50 text-sky-800',
    dotClassName: 'bg-sky-500 animate-pulse',
  },
  COMPLETED: {
    label: 'Completed',
    className: 'border-emerald-200 bg-emerald-50 text-emerald-800',
    dotClassName: 'bg-emerald-500',
  },
  FAILED: {
    label: 'Failed',
    className: 'border-rose-200 bg-rose-50 text-rose-800',
    dotClassName: 'bg-rose-500',
  },
};

const ROLE_STYLES: Record<OrganizationRole, string> = {
  OWNER: 'border-indigo-200 bg-indigo-50 text-indigo-700',
  ADMIN: 'border-violet-200 bg-violet-50 text-violet-700',
  MEMBER: 'border-slate-200 bg-slate-100 text-slate-700',
};

export function DocumentStatusBadge({ status }: { status: DocumentStatus }) {
  const style = DOCUMENT_STATUS_STYLES[status];
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium ${style.className}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${style.dotClassName}`} />
      {style.label}
    </span>
  );
}

export function RoleBadge({ role }: { role: OrganizationRole }) {
  return (
    <span
      className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-semibold tracking-wide ${ROLE_STYLES[role]}`}
    >
      {role}
    </span>
  );
}
