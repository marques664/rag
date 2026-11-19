'use client';

import {
  BarChart3,
  Building2,
  ChevronDown,
  FileText,
  LogOut,
  Menu,
  MessageSquareText,
  ShieldCheck,
  X,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { useAuth } from '@/components/providers/auth-provider';
import { RoleBadge } from '@/components/ui/status-badge';

interface NavItem {
  href: string;
  label: string;
  icon: typeof BarChart3;
}

const NAV_ITEMS: NavItem[] = [
  { href: '/analytics', label: 'Analytics', icon: BarChart3 },
  { href: '/chat', label: 'AI Chat (RAG)', icon: MessageSquareText },
  { href: '/documents', label: 'Documents', icon: FileText },
  { href: '/organizations', label: 'Organizations', icon: Building2 },
];

export function AppShell({
  title,
  description,
  actions,
  requireOrganization = true,
  children,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  requireOrganization?: boolean;
  children: ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const {
    user,
    organizations,
    activeOrganization,
    activeOrganizationId,
    isLoading,
    isAuthenticated,
    logout,
    selectOrganization,
  } = useAuth();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      router.replace('/login');
    }
  }, [isLoading, isAuthenticated, router]);

  if (isLoading || !isAuthenticated) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-indigo-600 border-t-transparent" />
          <p className="text-sm font-medium text-slate-600">
            Loading workspace...
          </p>
        </div>
      </div>
    );
  }

  const handleLogout = async () => {
    await logout();
    router.replace('/login');
  };

  const sidebarContent = (
    <div className="flex h-full flex-col justify-between bg-slate-900 text-slate-100">
      <div>
        <div className="flex items-center justify-between border-b border-slate-800 px-5 py-4">
          <Link href="/analytics" className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-600 text-white">
              <ShieldCheck className="h-4 w-4" />
            </div>
            <div>
              <p className="text-sm font-semibold leading-tight text-white">
                Enterprise AI
              </p>
              <p className="text-[11px] text-slate-400">Knowledge RAG</p>
            </div>
          </Link>
          <button
            type="button"
            onClick={() => setMobileMenuOpen(false)}
            className="rounded-md p-1 text-slate-400 hover:bg-slate-800 hover:text-white lg:hidden"
            aria-label="Close navigation menu"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="border-b border-slate-800 px-4 py-4">
          <label
            htmlFor="org-switcher"
            className="block text-[11px] font-semibold uppercase tracking-wider text-slate-400"
          >
            Active Organization
          </label>
          {organizations.length > 0 ? (
            <div className="relative mt-2">
              <select
                id="org-switcher"
                value={activeOrganizationId ?? ''}
                onChange={(e) => selectOrganization(e.target.value)}
                className="w-full appearance-none rounded-lg border border-slate-700 bg-slate-800 py-2 pl-3 pr-8 text-sm font-medium text-white outline-none transition focus:border-indigo-500"
              >
                {organizations.map((org) => (
                  <option key={org.organizationId} value={org.organizationId}>
                    {org.name} ({org.role})
                  </option>
                ))}
              </select>
              <ChevronDown className="pointer-events-none absolute right-2.5 top-2.5 h-4 w-4 text-slate-400" />
            </div>
          ) : (
            <Link
              href="/organizations"
              className="mt-2 block rounded-lg border border-dashed border-slate-700 bg-slate-800/60 px-3 py-2 text-xs text-slate-300 hover:border-indigo-500 hover:text-white"
            >
              + Create or join an organization
            </Link>
          )}
        </div>

        <nav className="space-y-1 px-3 py-4">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const isActive =
              pathname === item.href || pathname.startsWith(`${item.href}/`);
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setMobileMenuOpen(false)}
                className={`group flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all duration-200 ${
                  isActive
                    ? 'bg-indigo-600 text-white shadow-sm shadow-indigo-950/40'
                    : 'text-slate-300 hover:translate-x-0.5 hover:bg-slate-800 hover:text-white'
                }`}
              >
                <Icon
                  className={`h-4 w-4 shrink-0 transition-transform duration-200 ${
                    isActive ? 'scale-105' : 'group-hover:scale-105'
                  }`}
                />
                {item.label}
              </Link>
            );
          })}
        </nav>
      </div>

      <div className="border-t border-slate-800 p-4">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-white">
              {user?.name}
            </p>
            <p className="truncate text-xs text-slate-400">{user?.email}</p>
          </div>
          <button
            type="button"
            onClick={() => void handleLogout()}
            className="rounded-lg p-2 text-slate-400 transition hover:bg-slate-800 hover:text-white"
            title="Sign out"
            aria-label="Sign out"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="flex min-h-screen bg-slate-50">
      <aside className="hidden w-64 shrink-0 lg:block">{sidebarContent}</aside>

      {mobileMenuOpen ? (
        <div className="fixed inset-0 z-50 flex lg:hidden">
          <div
            className="animate-fade-in fixed inset-0 bg-slate-900/50 backdrop-blur-[2px]"
            onClick={() => setMobileMenuOpen(false)}
          />
          <aside className="animate-slide-in-left relative z-10 w-64 max-w-full shadow-2xl">
            {sidebarContent}
          </aside>
        </div>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/95 backdrop-blur">
          <div className="flex flex-wrap items-center justify-between gap-4 px-4 py-4 sm:px-6">
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setMobileMenuOpen(true)}
                className="rounded-lg border border-slate-200 p-2 text-slate-600 hover:bg-slate-100 lg:hidden"
                aria-label="Open navigation menu"
              >
                <Menu className="h-5 w-5" />
              </button>
              <div>
                <div className="flex flex-wrap items-center gap-2.5">
                  <h1 className="text-lg font-semibold text-slate-900 sm:text-xl">
                    {title}
                  </h1>
                  {activeOrganization ? (
                    <span className="inline-flex items-center gap-1.5 rounded-md bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">
                      {activeOrganization.name}
                      <RoleBadge role={activeOrganization.role} />
                    </span>
                  ) : null}
                </div>
                {description ? (
                  <p className="mt-0.5 text-xs text-slate-500 sm:text-sm">
                    {description}
                  </p>
                ) : null}
              </div>
            </div>

            {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
          </div>
        </header>

        <main key={pathname} className="animate-fade-in flex-1 p-4 sm:p-6">
          {requireOrganization && !activeOrganization ? (
            <div className="mx-auto max-w-2xl rounded-2xl border border-amber-200 bg-amber-50 p-6 text-amber-950">
              <h2 className="text-base font-semibold">
                No active organization selected
              </h2>
              <p className="mt-1 text-sm text-amber-800">
                Create a new organization or accept a pending invitation to
                upload documents, run RAG queries, and view tenant analytics.
              </p>
              <Link
                href="/organizations"
                className="mt-4 inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-indigo-700"
              >
                <Building2 className="h-4 w-4" />
                Go to Organizations
              </Link>
            </div>
          ) : (
            children
          )}
        </main>
      </div>
    </div>
  );
}
