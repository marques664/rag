'use client';

import {
  Building2,
  Check,
  Loader2,
  MailPlus,
  Plus,
  RefreshCw,
  Settings2,
  Users,
} from 'lucide-react';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { AppShell } from '@/components/layout/app-shell';
import { useAuth } from '@/components/providers/auth-provider';
import { RoleBadge } from '@/components/ui/status-badge';
import { apiClient } from '@/lib/api/client';
import type {
  Invitation,
  OrganizationMember,
  OrganizationRole,
} from '@/lib/api/types';
import { formatDateTime, getErrorMessage } from '@/lib/format';

export function OrganizationsWorkspace() {
  const {
    user,
    organizations,
    activeOrganization,
    activeOrganizationId,
    selectOrganization,
    refreshProfile,
  } = useAuth();

  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [members, setMembers] = useState<OrganizationMember[]>([]);
  const [loadingOrgData, setLoadingOrgData] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [newOrgName, setNewOrgName] = useState('');
  const [newOrgSlug, setNewOrgSlug] = useState('');
  const [creatingOrg, setCreatingOrg] = useState(false);

  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<'ADMIN' | 'MEMBER'>('MEMBER');
  const [sendingInvite, setSendingInvite] = useState(false);

  const [acceptingId, setAcceptingId] = useState<string | null>(null);
  const [updatingMemberId, setUpdatingMemberId] = useState<string | null>(null);

  const loadWorkspaceData = useCallback(async () => {
    setLoadingOrgData(true);
    setError(null);
    try {
      const [invRes, membersRes] = await Promise.all([
        apiClient.organizations.listPendingInvitations(),
        activeOrganizationId
          ? apiClient.organizations.listMembers(activeOrganizationId)
          : Promise.resolve({ members: [] }),
      ]);
      setInvitations(invRes.invitations);
      setMembers(membersRes.members);
    } catch (err) {
      setError(getErrorMessage(err, 'Failed to load organization details'));
    } finally {
      setLoadingOrgData(false);
    }
  }, [activeOrganizationId]);

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      try {
        const [invRes, membersRes] = await Promise.all([
          apiClient.organizations.listPendingInvitations(),
          activeOrganizationId
            ? apiClient.organizations.listMembers(activeOrganizationId)
            : Promise.resolve({ members: [] }),
        ]);
        if (cancelled) return;
        setInvitations(invRes.invitations);
        setMembers(membersRes.members);
        setError(null);
      } catch (err) {
        if (!cancelled) {
          setError(getErrorMessage(err, 'Failed to load organization details'));
        }
      } finally {
        if (!cancelled) {
          setLoadingOrgData(false);
        }
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [activeOrganizationId]);

  const isOwner = activeOrganization?.role === 'OWNER';
  const isAdminOrOwner =
    activeOrganization?.role === 'OWNER' || activeOrganization?.role === 'ADMIN';

  const handleCreateOrganization = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setNotice(null);
    const trimmedName = newOrgName.trim();
    const trimmedSlug = newOrgSlug.trim().toLowerCase();
    if (trimmedName.length < 2) {
      setError('Organization name must be at least 2 characters.');
      return;
    }

    setCreatingOrg(true);
    try {
      const res = await apiClient.organizations.create({
        name: trimmedName,
        ...(trimmedSlug ? { slug: trimmedSlug } : {}),
      });
      await refreshProfile();
      selectOrganization(res.organization.id);
      setNewOrgName('');
      setNewOrgSlug('');
      setNotice(`Created and switched to "${res.organization.name}".`);
    } catch (err) {
      setError(getErrorMessage(err, 'Failed to create organization'));
    } finally {
      setCreatingOrg(false);
    }
  };

  const handleUpdateOrganization = async (
    organizationId: string,
    name: string,
    slug: string,
  ) => {
    setError(null);
    setNotice(null);
    const res = await apiClient.organizations.update(organizationId, {
      name,
      slug,
    });
    await refreshProfile();
    setNotice(`Updated organization "${res.organization.name}".`);
  };

  const handleAcceptInvitation = async (invitationId: string) => {
    setError(null);
    setNotice(null);
    setAcceptingId(invitationId);
    try {
      const res = await apiClient.organizations.acceptInvitation(invitationId);
      await refreshProfile();
      selectOrganization(res.organization.id);
      await loadWorkspaceData();
      setNotice(`Joined "${res.organization.name}".`);
    } catch (err) {
      setError(getErrorMessage(err, 'Failed to accept invitation'));
    } finally {
      setAcceptingId(null);
    }
  };

  const handleCreateInvitation = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!activeOrganizationId) return;
    setError(null);
    setNotice(null);

    const trimmedEmail = inviteEmail.trim();
    if (!trimmedEmail) {
      setError('Invitee email is required.');
      return;
    }

    setSendingInvite(true);
    try {
      const res = await apiClient.organizations.createInvitation(
        activeOrganizationId,
        { email: trimmedEmail, role: inviteRole },
      );
      setInviteEmail('');
      setNotice(
        `Invitation sent to ${res.invitation.email} (${res.invitation.role}).`,
      );
    } catch (err) {
      setError(getErrorMessage(err, 'Failed to send invitation'));
    } finally {
      setSendingInvite(false);
    }
  };

  const handleRoleChange = async (userId: string, role: OrganizationRole) => {
    if (!activeOrganizationId) return;
    setError(null);
    setNotice(null);
    setUpdatingMemberId(userId);
    try {
      const res = await apiClient.organizations.updateMemberRole(
        activeOrganizationId,
        userId,
        role,
      );
      setMembers((prev) =>
        prev.map((m) => (m.userId === userId ? res.member : m)),
      );
      await refreshProfile();
      setNotice(`Updated ${res.member.name}'s role to ${res.member.role}.`);
    } catch (err) {
      setError(getErrorMessage(err, 'Failed to update member role'));
    } finally {
      setUpdatingMemberId(null);
    }
  };

  return (
    <AppShell
      title="Organizations"
      description="Manage multi-tenant workspaces, memberships, invitations, and role-based permissions."
      requireOrganization={false}
      actions={
        <button
          type="button"
          onClick={() => void loadWorkspaceData()}
          disabled={loadingOrgData}
          className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
        >
          <RefreshCw
            className={`h-3.5 w-3.5 ${loadingOrgData ? 'animate-spin' : ''}`}
          />
          Refresh
        </button>
      }
    >
      <div className="mx-auto max-w-6xl space-y-6">
        {error ? (
          <div
            role="alert"
            className="animate-fade-in-up rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800"
          >
            {error}
          </div>
        ) : null}

        {notice ? (
          <div className="animate-fade-in-up rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
            {notice}
          </div>
        ) : null}

        <div className="grid gap-6 lg:grid-cols-12">
          <section className="animate-fade-in-up rounded-2xl border border-slate-200 bg-white p-6 shadow-sm lg:col-span-7">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Building2 className="h-5 w-5 text-indigo-600" />
                <h2 className="text-base font-semibold text-slate-900">
                  Your Organizations
                </h2>
              </div>
              <span className="text-xs text-slate-500">
                {organizations.length} total
              </span>
            </div>

            {organizations.length === 0 ? (
              <p className="mt-4 rounded-xl border border-dashed border-slate-200 bg-slate-50 p-6 text-center text-sm text-slate-600">
                You do not belong to any organization yet. Create one using the
                form on the right or accept an invitation below.
              </p>
            ) : (
              <div className="mt-4 divide-y divide-slate-100">
                {organizations.map((org) => {
                  const isActive = org.organizationId === activeOrganizationId;
                  return (
                    <div
                      key={org.organizationId}
                      className="flex flex-wrap items-center justify-between gap-3 py-3.5"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="truncate text-sm font-semibold text-slate-900">
                            {org.name}
                          </p>
                          <RoleBadge role={org.role} />
                        </div>
                        <p className="mt-0.5 font-mono text-xs text-slate-500">
                          {org.slug} · {org.organizationId}
                        </p>
                      </div>

                      {isActive ? (
                        <span className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-50 px-3 py-1.5 text-xs font-semibold text-indigo-700">
                          <Check className="h-3.5 w-3.5" />
                          Active
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => selectOrganization(org.organizationId)}
                          className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
                        >
                          Switch
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          <section
            className="animate-fade-in-up rounded-2xl border border-slate-200 bg-white p-6 shadow-sm lg:col-span-5"
            style={{ animationDelay: '70ms' }}
          >
            <div className="flex items-center gap-2">
              <Plus className="h-5 w-5 text-indigo-600" />
              <h2 className="text-base font-semibold text-slate-900">
                Create Organization
              </h2>
            </div>
            <p className="mt-1 text-xs text-slate-500">
              Each organization isolates documents, chunks, conversations, and
              usage analytics.
            </p>

            <form
              onSubmit={(e) => void handleCreateOrganization(e)}
              className="mt-4 space-y-3"
            >
              <div>
                <label
                  htmlFor="create-org-name"
                  className="block text-xs font-medium text-slate-700"
                >
                  Organization name
                </label>
                <input
                  id="create-org-name"
                  type="text"
                  required
                  minLength={2}
                  maxLength={120}
                  value={newOrgName}
                  onChange={(e) => setNewOrgName(e.target.value)}
                  placeholder="Acme Engineering"
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
                />
              </div>

              <div>
                <label
                  htmlFor="create-org-slug"
                  className="block text-xs font-medium text-slate-700"
                >
                  Slug (optional)
                </label>
                <input
                  id="create-org-slug"
                  type="text"
                  maxLength={80}
                  value={newOrgSlug}
                  onChange={(e) => setNewOrgSlug(e.target.value)}
                  placeholder="acme-engineering"
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
                />
              </div>

              <button
                type="submit"
                disabled={creatingOrg}
                className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-indigo-700 disabled:opacity-60"
              >
                {creatingOrg ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Creating...
                  </>
                ) : (
                  'Create organization'
                )}
              </button>
            </form>
          </section>
        </div>

        {invitations.length > 0 ? (
          <section className="rounded-2xl border border-indigo-200 bg-indigo-50/50 p-6">
            <h2 className="text-base font-semibold text-slate-900">
              Pending Invitations ({invitations.length})
            </h2>
            <div className="mt-3 space-y-3">
              {invitations.map((inv) => (
                <div
                  key={inv.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-indigo-100 bg-white px-4 py-3"
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-semibold text-slate-900">
                        {inv.organizationName}
                      </p>
                      <RoleBadge role={inv.role} />
                    </div>
                    <p className="mt-0.5 text-xs text-slate-500">
                      Invited {formatDateTime(inv.createdAt)} · Expires{' '}
                      {formatDateTime(inv.expiresAt)}
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={acceptingId === inv.id}
                    onClick={() => void handleAcceptInvitation(inv.id)}
                    className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-3.5 py-2 text-xs font-semibold text-white transition hover:bg-indigo-700 disabled:opacity-60"
                  >
                    {acceptingId === inv.id ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : null}
                    Accept Invitation
                  </button>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        {activeOrganization ? (
          <div className="grid gap-6 lg:grid-cols-12">
            <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm lg:col-span-7">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Users className="h-5 w-5 text-indigo-600" />
                  <h2 className="text-base font-semibold text-slate-900">
                    Members · {activeOrganization.name}
                  </h2>
                </div>
                <span className="text-xs text-slate-500">
                  {members.length} member{members.length === 1 ? '' : 's'}
                </span>
              </div>

              <div className="mt-4 divide-y divide-slate-100">
                {members.map((member) => {
                  const isSelf = member.userId === user?.id;
                  return (
                    <div
                      key={member.userId}
                      className="flex flex-wrap items-center justify-between gap-3 py-3"
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-slate-900">
                          {member.name}
                          {isSelf ? (
                            <span className="ml-2 text-xs text-slate-400">
                              (you)
                            </span>
                          ) : null}
                        </p>
                        <p className="text-xs text-slate-500">
                          {member.email} · Joined{' '}
                          {formatDateTime(member.joinedAt)}
                        </p>
                      </div>

                      {isOwner && !isSelf ? (
                        <select
                          aria-label={`Role for ${member.name}`}
                          value={member.role}
                          disabled={updatingMemberId === member.userId}
                          onChange={(e) =>
                            void handleRoleChange(
                              member.userId,
                              e.target.value as OrganizationRole,
                            )
                          }
                          className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 outline-none focus:border-indigo-500 disabled:opacity-50"
                        >
                          <option value="OWNER">OWNER</option>
                          <option value="ADMIN">ADMIN</option>
                          <option value="MEMBER">MEMBER</option>
                        </select>
                      ) : (
                        <RoleBadge role={member.role} />
                      )}
                    </div>
                  );
                })}
              </div>
            </section>

            <div className="space-y-6 lg:col-span-5">
              {isAdminOrOwner ? (
                <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                  <div className="flex items-center gap-2">
                    <MailPlus className="h-5 w-5 text-indigo-600" />
                    <h2 className="text-base font-semibold text-slate-900">
                      Invite Member
                    </h2>
                  </div>
                  <form
                    onSubmit={(e) => void handleCreateInvitation(e)}
                    className="mt-4 space-y-3"
                  >
                    <div>
                      <label
                        htmlFor="invite-email"
                        className="block text-xs font-medium text-slate-700"
                      >
                        User email
                      </label>
                      <input
                        id="invite-email"
                        type="email"
                        required
                        value={inviteEmail}
                        onChange={(e) => setInviteEmail(e.target.value)}
                        placeholder="colleague@company.com"
                        className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
                      />
                    </div>
                    <div>
                      <label
                        htmlFor="invite-role"
                        className="block text-xs font-medium text-slate-700"
                      >
                        Role
                      </label>
                      <select
                        id="invite-role"
                        value={inviteRole}
                        onChange={(e) =>
                          setInviteRole(e.target.value as 'ADMIN' | 'MEMBER')
                        }
                        className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-indigo-500"
                      >
                        <option value="MEMBER">MEMBER</option>
                        <option value="ADMIN">ADMIN</option>
                      </select>
                    </div>
                    <button
                      type="submit"
                      disabled={sendingInvite}
                      className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-60"
                    >
                      {sendingInvite ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : null}
                      Send invitation
                    </button>
                  </form>
                </section>
              ) : null}

              {isAdminOrOwner ? (
                <OrganizationSettingsCard
                  key={activeOrganization.organizationId}
                  organizationId={activeOrganization.organizationId}
                  initialName={activeOrganization.name}
                  initialSlug={activeOrganization.slug}
                  onSave={handleUpdateOrganization}
                  onError={setError}
                />
              ) : null}
            </div>
          </div>
        ) : null}
      </div>
    </AppShell>
  );
}

function OrganizationSettingsCard({
  organizationId,
  initialName,
  initialSlug,
  onSave,
  onError,
}: {
  organizationId: string;
  initialName: string;
  initialSlug: string;
  onSave: (organizationId: string, name: string, slug: string) => Promise<void>;
  onError: (message: string | null) => void;
}) {
  const [name, setName] = useState(initialName);
  const [slug, setSlug] = useState(initialSlug);
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmedName = name.trim();
    const trimmedSlug = slug.trim().toLowerCase();
    if (trimmedName.length < 2 || trimmedSlug.length < 2) {
      onError('Organization name and slug must be at least 2 characters.');
      return;
    }

    setSaving(true);
    try {
      await onSave(organizationId, trimmedName, trimmedSlug);
    } catch (err) {
      onError(getErrorMessage(err, 'Failed to update organization'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex items-center gap-2">
        <Settings2 className="h-5 w-5 text-indigo-600" />
        <h2 className="text-base font-semibold text-slate-900">
          Organization Settings
        </h2>
      </div>
      <form onSubmit={(e) => void handleSubmit(e)} className="mt-4 space-y-3">
        <div>
          <label
            htmlFor="edit-org-name"
            className="block text-xs font-medium text-slate-700"
          >
            Name
          </label>
          <input
            id="edit-org-name"
            type="text"
            required
            minLength={2}
            maxLength={120}
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-indigo-500"
          />
        </div>
        <div>
          <label
            htmlFor="edit-org-slug"
            className="block text-xs font-medium text-slate-700"
          >
            Slug
          </label>
          <input
            id="edit-org-slug"
            type="text"
            required
            minLength={2}
            maxLength={80}
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm outline-none focus:border-indigo-500"
          />
        </div>
        <button
          type="submit"
          disabled={saving}
          className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-60"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          Save changes
        </button>
      </form>
    </section>
  );
}
