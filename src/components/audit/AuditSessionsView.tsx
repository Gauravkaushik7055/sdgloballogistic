import React, { useCallback, useEffect, useState } from 'react';
import {
  Database,
  Download,
  HardDrive,
  Lock,
  Plus,
  RefreshCw,
  Search,
  Shield,
  Trash2,
  UserCog,
  X,
} from 'lucide-react';
import { AdminPermissionPolicy, RetentionPolicyItem } from '../../types/index.ts';
import { apiFetch, fetchProtectedBlobUrl, formatDateTime } from '../../utils/api.ts';
import { formatBytesCompact } from '../common/MediaPreviewModal.tsx';

interface ManagedAdminRow {
  user_id: number;
  email: string;
  full_name: string;
  status: 'Active' | 'Inactive';
  last_login_at?: string | null;
  mfa_enabled: boolean;
  policy: AdminPermissionPolicy;
}

const CAPABILITY_LABELS: Array<{ key: keyof AdminPermissionPolicy; label: string; desc: string }> = [
  { key: 'can_view_chats', label: 'Direct & Task Chat', desc: 'Allows messaging scoped staff and moderators.' },
  { key: 'can_monitor_chats', label: 'Chat Archive Monitoring', desc: 'Audit scoped moderator conversations (logged).' },
  { key: 'can_view_reports', label: 'Enterprise Reports', desc: 'View live reports and saved report snapshots.' },
  { key: 'can_manage_assets', label: 'IT Asset & Excel Import', desc: 'Register, edit, assign, repair, and import IT assets.' },
  { key: 'can_view_budgets', label: 'View IT Budgets & Invoices', desc: 'Inspect INR financial allocations and expenses.' },
  { key: 'can_manage_budgets', label: 'Manage Budgets & Record Expenses', desc: 'Create/edit INR budgets and upload invoices.' },
  { key: 'can_approve_expenses', label: 'Approve / Reject Expenses', desc: 'Authorized to approve or reject pending invoices.' },
  { key: 'can_export_data', label: 'Export Excel / PDF / CSV', desc: 'Allow exporting datasets to spreadsheets and PDFs.' },
  { key: 'can_manage_tickets', label: 'Ticket Assignment & Edits', desc: 'Modify/assign scoped support tickets.' },
];

const DEFAULT_POLICY: AdminPermissionPolicy = {
  allowed_location_ids: [],
  allowed_department_ids: [],
  allowed_moderator_ids: [],
  can_view_chats: true,
  can_monitor_chats: false,
  can_view_reports: true,
  can_manage_assets: false,
  can_view_budgets: false,
  can_manage_budgets: false,
  can_approve_expenses: false,
  can_export_data: true,
  can_manage_tickets: true,
};

export default function AuditSessionsView() {
  const [activeTab, setActiveTab] = useState<'logs' | 'permissions' | 'retention'>('logs');

  // Tab 1: Sessions & Immutable Audit Logs
  const [sessions, setSessions] = useState<any[]>([]);
  const [logs, setLogs] = useState<any[]>([]);
  const [roleFilter, setRoleFilter] = useState<string>('All');
  const [entityTypeFilter, setEntityTypeFilter] = useState<string>('All');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [search, setSearch] = useState('');

  // Tab 2: Admin Scopes & Permissions
  const [admins, setAdmins] = useState<ManagedAdminRow[]>([]);
  const [locations, setLocations] = useState<any[]>([]);
  const [departments, setDepartments] = useState<any[]>([]);
  const [moderators, setModerators] = useState<any[]>([]);
  const [draftPolicies, setDraftPolicies] = useState<Record<number, AdminPermissionPolicy & { status: 'Active' | 'Inactive' }>>({});
  const [savingAdminId, setSavingAdminId] = useState<number | null>(null);
  const [permMessage, setPermMessage] = useState('');
  const [permError, setPermError] = useState('');
  const [createAdminModal, setCreateAdminModal] = useState(false);
  const [newAdminName, setNewAdminName] = useState('');
  const [newAdminEmail, setNewAdminEmail] = useState('');
  const [newAdminPassword, setNewAdminPassword] = useState('');
  const [creatingAdmin, setCreatingAdmin] = useState(false);

  // Tab 3: Retention, Media Audit & Backup
  const [retentionPolicies, setRetentionPolicies] = useState<RetentionPolicyItem[]>([]);
  const [retentionCounts, setRetentionCounts] = useState<Record<string, number>>({});
  const [mediaAudit, setMediaAudit] = useState<{
    diskFileCount: number;
    diskBytes: number;
    ticketFiles: any[];
    chatFiles: any[];
  } | null>(null);
  const [savingRetention, setSavingRetention] = useState(false);
  const [purgeConfirmText, setPurgeConfirmText] = useState('');
  const [purging, setPurging] = useState(false);
  const [retentionMsg, setRetentionMsg] = useState('');
  const [retentionErr, setRetentionErr] = useState('');
  const [downloadingBackup, setDownloadingBackup] = useState<'sqlite' | 'json' | null>(null);

  const loadLogsAndSessions = useCallback(async () => {
    const sessParams = new URLSearchParams();
    if (roleFilter !== 'All') sessParams.set('role_name', roleFilter);

    const logParams = new URLSearchParams({ limit: '300' });
    if (roleFilter !== 'All') logParams.set('role_name', roleFilter);
    if (entityTypeFilter !== 'All') logParams.set('entity_type', entityTypeFilter);
    if (dateFrom) logParams.set('date_from', dateFrom);
    if (dateTo) logParams.set('date_to', dateTo);
    if (search.trim()) logParams.set('search', search.trim());

    try {
      const [sRes, aRes] = await Promise.all([
        apiFetch<{ sessions: any[] }>(`/api/auth/sessions?${sessParams.toString()}`),
        apiFetch<{ logs: any[] }>(`/api/auth/audit-logs?${logParams.toString()}`),
      ]);
      setSessions(sRes.sessions || []);
      setLogs(aRes.logs || []);
    } catch {
      // handled by auth layer
    }
  }, [roleFilter, entityTypeFilter, dateFrom, dateTo, search]);

  const loadPermissions = useCallback(async () => {
    try {
      const res = await apiFetch<{
        admins: ManagedAdminRow[];
        locations: any[];
        departments: any[];
        moderators: any[];
      }>('/api/auth/admin-permissions');
      setAdmins(res.admins || []);
      setLocations(res.locations || []);
      setDepartments(res.departments || []);
      setModerators(res.moderators || []);
      const drafts: Record<number, AdminPermissionPolicy & { status: 'Active' | 'Inactive' }> = {};
      for (const a of res.admins || []) {
        drafts[a.user_id] = { ...a.policy, status: a.status };
      }
      setDraftPolicies(drafts);
    } catch (err: any) {
      setPermError(err.message || 'Unable to load Admin permission policies');
    }
  }, []);

  const loadSecurityRetention = useCallback(async () => {
    try {
      const [rRes, mRes] = await Promise.all([
        apiFetch<{ policies: RetentionPolicyItem[]; counts: Record<string, number> }>('/api/auth/security/retention'),
        apiFetch<any>('/api/auth/security/media-audit'),
      ]);
      setRetentionPolicies(rRes.policies || []);
      setRetentionCounts(rRes.counts || {});
      setMediaAudit(mRes);
    } catch (err: any) {
      setRetentionErr(err.message || 'Failed to load retention & media audit telemetry');
    }
  }, []);

  useEffect(() => {
    if (activeTab === 'logs') loadLogsAndSessions();
    else if (activeTab === 'permissions') loadPermissions();
    else if (activeTab === 'retention') loadSecurityRetention();
  }, [activeTab, loadLogsAndSessions, loadPermissions, loadSecurityRetention]);

  const toggleScopeId = (
    userId: number,
    field: 'allowed_location_ids' | 'allowed_department_ids' | 'allowed_moderator_ids',
    id: number
  ) => {
    setDraftPolicies((prev) => {
      const cur = prev[userId];
      if (!cur) return prev;
      const arr = cur[field] || [];
      const next = arr.includes(id) ? arr.filter((x) => x !== id) : [...arr, id];
      return { ...prev, [userId]: { ...cur, [field]: next } };
    });
  };

  const handleSaveAdminPolicy = async (userId: number) => {
    const policy = draftPolicies[userId];
    if (!policy) return;
    setSavingAdminId(userId);
    setPermMessage('');
    setPermError('');
    try {
      await apiFetch(`/api/auth/admin-permissions/${userId}`, {
        method: 'PUT',
        body: JSON.stringify(policy),
      });
      setPermMessage('Admin scopes and permission matrix updated cleanly.');
      loadPermissions();
    } catch (err: any) {
      setPermError(err.message || 'Failed to update permissions');
    } finally {
      setSavingAdminId(null);
    }
  };

  const handleCreateAdmin = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreatingAdmin(true);
    setPermError('');
    setPermMessage('');
    try {
      await apiFetch('/api/auth/admin-accounts', {
        method: 'POST',
        body: JSON.stringify({
          full_name: newAdminName,
          email: newAdminEmail,
          password: newAdminPassword,
          policy: DEFAULT_POLICY,
        }),
      });
      setCreateAdminModal(false);
      setNewAdminName('');
      setNewAdminEmail('');
      setNewAdminPassword('');
      setPermMessage('New scoped Admin account created. Configure scopes & capabilities below.');
      loadPermissions();
    } catch (err: any) {
      setPermError(err.message || 'Failed to create Admin account');
    } finally {
      setCreatingAdmin(false);
    }
  };

  const handleSaveRetention = async () => {
    setSavingRetention(true);
    setRetentionMsg('');
    setRetentionErr('');
    try {
      const res = await apiFetch<{ policies: RetentionPolicyItem[] }>('/api/auth/security/retention', {
        method: 'PUT',
        body: JSON.stringify({
          policies: retentionPolicies.map((p) => ({
            entity_key: p.entity_key,
            retention_days: p.retention_days,
            auto_archive: Boolean(p.auto_archive),
          })),
        }),
      });
      setRetentionPolicies(res.policies || []);
      setRetentionMsg('Retention policies saved.');
    } catch (err: any) {
      setRetentionErr(err.message || 'Failed to save retention policies');
    } finally {
      setSavingRetention(false);
    }
  };

  const handleExecutePurge = async () => {
    if (purgeConfirmText !== 'CONFIRM_RETENTION_PURGE') return;
    setPurging(true);
    setRetentionMsg('');
    setRetentionErr('');
    try {
      const res = await apiFetch<{ purgedChats: number; purgedReports: number; note: string }>(
        '/api/auth/security/retention/purge',
        {
          method: 'POST',
          body: JSON.stringify({ confirm: 'CONFIRM_RETENTION_PURGE' }),
        }
      );
      setPurgeConfirmText('');
      setRetentionMsg(
        `Purge complete: removed ${res.purgedChats} expired chat message(s) and ${res.purgedReports} saved report(s). ${res.note}`
      );
      loadSecurityRetention();
    } catch (err: any) {
      setRetentionErr(err.message || 'Retention purge failed');
    } finally {
      setPurging(false);
    }
  };

  const handleDownloadBackup = async (format: 'sqlite' | 'json') => {
    setDownloadingBackup(format);
    setRetentionErr('');
    try {
      const blobUrl = await fetchProtectedBlobUrl(`/api/auth/security/backup?format=${format}`);
      const a = document.createElement('a');
      a.href = blobUrl;
      const stamp = new Date().toISOString().slice(0, 10);
      a.download = format === 'sqlite' ? `sdglobal-it-crm-${stamp}.db` : `sdglobal-it-crm-${stamp}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(blobUrl), 20000);
    } catch (err: any) {
      setRetentionErr(err.message || 'Backup download failed');
    } finally {
      setDownloadingBackup(null);
    }
  };

  return (
    <div className="space-y-6">
      {/* Security Center Navigation Header */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <Shield className="w-5 h-5 text-blue-600 shrink-0" />
          <div>
            <h2 className="text-sm font-display font-bold">
              Super Admin Security, Access Control & Audit Center
            </h2>
            <p className="text-xs text-slate-500">
              Immutable audit logs, Admin scope/capability policies, data retention, media integrity & backups.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5 bg-slate-100 dark:bg-slate-800 p-1 rounded-xl">
          <button
            type="button"
            onClick={() => setActiveTab('logs')}
            className={`px-3 py-1.5 text-xs font-semibold rounded-lg cursor-pointer whitespace-nowrap ${
              activeTab === 'logs'
                ? 'bg-white dark:bg-slate-900 text-blue-700 dark:text-blue-400 shadow-xs'
                : 'text-slate-600 dark:text-slate-300'
            }`}
          >
            Sessions & Audit Logs
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('permissions')}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg cursor-pointer whitespace-nowrap ${
              activeTab === 'permissions'
                ? 'bg-white dark:bg-slate-900 text-blue-700 dark:text-blue-400 shadow-xs'
                : 'text-slate-600 dark:text-slate-300'
            }`}
          >
            <UserCog className="w-3.5 h-3.5" />
            Admin Scopes & Permissions
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('retention')}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg cursor-pointer whitespace-nowrap ${
              activeTab === 'retention'
                ? 'bg-white dark:bg-slate-900 text-blue-700 dark:text-blue-400 shadow-xs'
                : 'text-slate-600 dark:text-slate-300'
            }`}
          >
            <Database className="w-3.5 h-3.5" />
            Retention, Media & Backups
          </button>
        </div>
      </div>

      {/* TAB 1: Sessions & Immutable Audit Logs */}
      {activeTab === 'logs' && (
        <div className="space-y-5">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700 dark:text-emerald-400">
                <Lock className="w-3.5 h-3.5" />
                <span>Append-only database triggers enabled — audit records cannot be altered or purged.</span>
              </div>
              <button
                type="button"
                onClick={loadLogsAndSessions}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-300 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                Refresh
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2.5">
              <select
                value={roleFilter}
                onChange={(e) => setRoleFilter(e.target.value)}
                className="px-3 py-1.5 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
              >
                <option value="All">All Roles</option>
                <option value="super_admin">Super Admin</option>
                <option value="management">Admins</option>
                <option value="moderator">Moderators</option>
                <option value="employee">Employees</option>
              </select>

              <select
                value={entityTypeFilter}
                onChange={(e) => setEntityTypeFilter(e.target.value)}
                className="px-3 py-1.5 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
              >
                <option value="All">All Entity Types</option>
                <option value="ticket">Tickets</option>
                <option value="direct_message">Direct Messages</option>
                <option value="chat_thread">Chat Monitoring</option>
                <option value="asset">IT Assets</option>
                <option value="asset_import_batch">Excel Imports</option>
                <option value="budget">IT Budgets</option>
                <option value="expense">IT Expenses</option>
                <option value="report">Saved Reports</option>
                <option value="admin_permissions">Admin Permissions</option>
                <option value="user_mfa">Two-Factor MFA</option>
                <option value="security">Unauthorized Attempts</option>
                <option value="database">Backups</option>
              </select>

              <input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                aria-label="Date from"
                className="px-3 py-1.5 text-xs font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
              />
              <input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                aria-label="Date to"
                className="px-3 py-1.5 text-xs font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
              />

              <div className="relative">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Email, action, ticket..."
                  className="w-full pl-8 pr-3 py-1.5 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                />
              </div>
            </div>
          </div>

          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
            <div className="px-5 py-3.5 border-b border-slate-200 dark:border-slate-800">
              <h3 className="text-sm font-display font-semibold">Login Sessions ({sessions.length})</h3>
            </div>
            <div className="overflow-x-auto max-h-72 overflow-y-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/50 text-slate-500">
                    <th className="py-2.5 px-4">User</th>
                    <th className="py-2.5 px-4">Role</th>
                    <th className="py-2.5 px-4">Login Time</th>
                    <th className="py-2.5 px-4">Last Activity</th>
                    <th className="py-2.5 px-4">Logout Time</th>
                    <th className="py-2.5 px-4 text-right">Duration</th>
                    <th className="py-2.5 px-4">IP Address</th>
                    <th className="py-2.5 px-4">State</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {sessions.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="py-6 text-center text-slate-500">
                        No matching login sessions recorded.
                      </td>
                    </tr>
                  ) : (
                    sessions.map((s) => (
                      <tr key={s.id}>
                        <td className="py-2.5 px-4 font-medium">
                          {s.full_name} · <span className="text-slate-500">{s.email}</span>
                        </td>
                        <td className="py-2.5 px-4 capitalize">{s.role_name?.replace('_', ' ')}</td>
                        <td className="py-2.5 px-4 font-mono">{formatDateTime(s.login_at)}</td>
                        <td className="py-2.5 px-4 font-mono">{formatDateTime(s.last_activity_at || s.login_at)}</td>
                        <td className="py-2.5 px-4 font-mono">{formatDateTime(s.logout_at)}</td>
                        <td className="py-2.5 px-4 text-right font-mono tabular-nums">{s.duration_minutes ?? 0} mins</td>
                        <td className="py-2.5 px-4 font-mono text-slate-500">{s.ip_address}</td>
                        <td className="py-2.5 px-4">
                          <span className={s.is_active ? 'text-emerald-600 font-semibold' : 'text-slate-500'}>
                            {s.is_active ? 'Active' : 'Ended'}
                          </span>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
            <div className="px-5 py-3.5 border-b border-slate-200 dark:border-slate-800">
              <h3 className="text-sm font-display font-semibold">
                Immutable Security & Activity Audit Trail ({logs.length})
              </h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/50 text-slate-500">
                    <th className="py-2.5 px-4">Timestamp</th>
                    <th className="py-2.5 px-4">Actor</th>
                    <th className="py-2.5 px-4">Action</th>
                    <th className="py-2.5 px-4">Entity</th>
                    <th className="py-2.5 px-4">Details</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {logs.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="py-6 text-center text-slate-500">
                        No activity logs match the current filter.
                      </td>
                    </tr>
                  ) : (
                    logs.map((l) => (
                      <tr key={l.id}>
                        <td className="py-2.5 px-4 font-mono text-slate-500 whitespace-nowrap">
                          {formatDateTime(l.created_at)}
                        </td>
                        <td className="py-2.5 px-4">
                          <span>{l.user_full_name ? `${l.user_full_name} (${l.user_email})` : l.user_email || 'System'}</span>
                          {l.role_name && <span className="text-slate-400"> · {l.role_name}</span>}
                        </td>
                        <td
                          className={`py-2.5 px-4 font-mono font-semibold ${
                            l.action === 'UNAUTHORIZED_ACCESS_ATTEMPT'
                              ? 'text-red-600'
                              : 'text-blue-700 dark:text-blue-400'
                          }`}
                        >
                          {l.action}
                        </td>
                        <td className="py-2.5 px-4 font-mono">
                          {l.entity_type} {l.entity_id ? `#${l.entity_id}` : ''}
                        </td>
                        <td className="py-2.5 px-4 font-mono text-slate-500 max-w-md break-all">
                          {l.details_json || '—'}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: Admin Scopes & Permissions */}
      {activeTab === 'permissions' && (
        <div className="space-y-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-display font-bold">Scoped Operations Admins ({admins.length})</h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Assign hub/department/moderator boundaries and granular module permissions per Admin account. Leave scope boxes unchecked for unrestricted access.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setCreateAdminModal(true)}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-lg bg-blue-700 hover:bg-blue-800 text-white cursor-pointer whitespace-nowrap"
            >
              <Plus className="w-3.5 h-3.5" />
              Create Scoped Admin
            </button>
          </div>

          {permError && (
            <div className="p-3 rounded-lg bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 text-xs text-red-700 dark:text-red-300">
              {permError}
            </div>
          )}
          {permMessage && (
            <div className="p-3 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900 text-xs text-emerald-700 dark:text-emerald-300">
              {permMessage}
            </div>
          )}

          {admins.length === 0 ? (
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-8 text-center text-xs text-slate-500">
              No Operations Admin (management) accounts exist yet. Create one above to delegate scoped permissions.
            </div>
          ) : (
            admins.map((adm) => {
              const draft = draftPolicies[adm.user_id];
              if (!draft) return null;
              return (
                <div
                  key={adm.user_id}
                  className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-4"
                >
                  <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 dark:border-slate-800 pb-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-display font-bold">{adm.full_name}</span>
                        <span
                          className={`text-[11px] font-semibold ${
                            adm.mfa_enabled ? 'text-emerald-700 dark:text-emerald-400' : 'text-amber-600'
                          }`}
                        >
                          {adm.mfa_enabled ? 'MFA Active' : 'MFA Not Enabled'}
                        </span>
                      </div>
                      <div className="text-xs font-mono text-slate-500">
                        {adm.email} · Last login: {adm.last_login_at ? formatDateTime(adm.last_login_at) : 'Never'}
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <select
                        value={draft.status}
                        onChange={(e) =>
                          setDraftPolicies((prev) => ({
                            ...prev,
                            [adm.user_id]: { ...prev[adm.user_id], status: e.target.value as 'Active' | 'Inactive' },
                          }))
                        }
                        className="px-2.5 py-1.5 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                      >
                        <option value="Active">Active</option>
                        <option value="Inactive">Inactive</option>
                      </select>
                      <button
                        type="button"
                        disabled={savingAdminId === adm.user_id}
                        onClick={() => handleSaveAdminPolicy(adm.user_id)}
                        className="px-4 py-1.5 text-xs font-semibold rounded-lg bg-blue-700 hover:bg-blue-800 text-white disabled:opacity-50 cursor-pointer whitespace-nowrap"
                      >
                        {savingAdminId === adm.user_id ? 'Saving...' : 'Save Permissions & Scope'}
                      </button>
                    </div>
                  </div>

                  {/* Scope Pickers */}
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
                    <div className="p-3 rounded-lg border border-slate-200 dark:border-slate-800 space-y-2">
                      <div className="font-semibold">
                        Allowed Hubs / Locations ({draft.allowed_location_ids.length || 'All'})
                      </div>
                      <div className="max-h-36 overflow-y-auto space-y-1">
                        {locations.map((loc) => (
                          <label key={loc.id} className="flex items-center gap-2 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={draft.allowed_location_ids.includes(loc.id)}
                              onChange={() => toggleScopeId(adm.user_id, 'allowed_location_ids', loc.id)}
                            />
                            <span className="truncate">
                              {loc.name} ({loc.code})
                            </span>
                          </label>
                        ))}
                      </div>
                    </div>

                    <div className="p-3 rounded-lg border border-slate-200 dark:border-slate-800 space-y-2">
                      <div className="font-semibold">
                        Allowed Departments ({draft.allowed_department_ids.length || 'All'})
                      </div>
                      <div className="max-h-36 overflow-y-auto space-y-1">
                        {departments.map((dept) => (
                          <label key={dept.id} className="flex items-center gap-2 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={draft.allowed_department_ids.includes(dept.id)}
                              onChange={() => toggleScopeId(adm.user_id, 'allowed_department_ids', dept.id)}
                            />
                            <span className="truncate">{dept.name}</span>
                          </label>
                        ))}
                      </div>
                    </div>

                    <div className="p-3 rounded-lg border border-slate-200 dark:border-slate-800 space-y-2">
                      <div className="font-semibold">
                        Allowed Moderators ({draft.allowed_moderator_ids.length || 'All'})
                      </div>
                      <div className="max-h-36 overflow-y-auto space-y-1">
                        {moderators.map((mod) => (
                          <label key={mod.id} className="flex items-center gap-2 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={draft.allowed_moderator_ids.includes(mod.id)}
                              onChange={() => toggleScopeId(adm.user_id, 'allowed_moderator_ids', mod.id)}
                            />
                            <span className="truncate">{mod.full_name}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* Capability Toggles */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5 text-xs">
                    {CAPABILITY_LABELS.map((cap) => (
                      <label
                        key={String(cap.key)}
                        className="flex items-start gap-2.5 p-2.5 rounded-lg border border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/40 cursor-pointer"
                      >
                        <input
                          type="checkbox"
                          checked={Boolean(draft[cap.key])}
                          onChange={(e) =>
                            setDraftPolicies((prev) => ({
                              ...prev,
                              [adm.user_id]: { ...prev[adm.user_id], [cap.key]: e.target.checked },
                            }))
                          }
                          className="mt-0.5"
                        />
                        <div>
                          <div className="font-semibold">{cap.label}</div>
                          <div className="text-[11px] text-slate-500">{cap.desc}</div>
                        </div>
                      </label>
                    ))}
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}

      {/* TAB 3: Retention, Media Audit & Backups */}
      {activeTab === 'retention' && (
        <div className="space-y-5">
          {retentionErr && (
            <div className="p-3 rounded-lg bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 text-xs text-red-700 dark:text-red-300">
              {retentionErr}
            </div>
          )}
          {retentionMsg && (
            <div className="p-3 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900 text-xs text-emerald-700 dark:text-emerald-300">
              {retentionMsg}
            </div>
          )}

          {/* Retention Policies + Backups */}
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-4">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <h3 className="text-sm font-display font-bold">Data Retention Policies</h3>
                  <p className="text-xs text-slate-500">
                    Configure retention windows (30–3650 days). Immutable audit logs are never deleted.
                  </p>
                </div>
                <button
                  type="button"
                  disabled={savingRetention}
                  onClick={handleSaveRetention}
                  className="px-3.5 py-1.5 text-xs font-semibold rounded-lg bg-blue-700 hover:bg-blue-800 text-white disabled:opacity-50 cursor-pointer whitespace-nowrap"
                >
                  {savingRetention ? 'Saving...' : 'Save Policies'}
                </button>
              </div>

              <div className="divide-y divide-slate-100 dark:divide-slate-800 text-xs">
                {retentionPolicies.map((rp) => (
                  <div key={rp.entity_key} className="py-3 flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="font-semibold capitalize">{rp.entity_key.replace('_', ' ')}</div>
                      <div className="font-mono text-[11px] text-slate-500 tabular-nums">
                        Current stored records: {retentionCounts[rp.entity_key] ?? 0}
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <label className="inline-flex items-center gap-1.5 text-[11px] text-slate-600 dark:text-slate-300">
                        <input
                          type="checkbox"
                          checked={Boolean(rp.auto_archive)}
                          onChange={(e) =>
                            setRetentionPolicies((prev) =>
                              prev.map((p) =>
                                p.entity_key === rp.entity_key ? { ...p, auto_archive: e.target.checked ? 1 : 0 } : p
                              )
                            )
                          }
                        />
                        Auto-Archive
                      </label>
                      <div className="flex items-center gap-1.5">
                        <input
                          type="number"
                          min={30}
                          max={3650}
                          value={rp.retention_days}
                          onChange={(e) => {
                            const val = Number(e.target.value) || 30;
                            setRetentionPolicies((prev) =>
                              prev.map((p) => (p.entity_key === rp.entity_key ? { ...p, retention_days: val } : p))
                            );
                          }}
                          className="w-20 px-2 py-1 text-xs font-mono rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                        />
                        <span className="text-slate-500">days</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              <div className="pt-3 border-t border-slate-200 dark:border-slate-800 space-y-2">
                <div className="text-xs font-semibold text-red-600">Execute Expired Chat & Report Purge</div>
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    type="text"
                    value={purgeConfirmText}
                    onChange={(e) => setPurgeConfirmText(e.target.value)}
                    placeholder="Type CONFIRM_RETENTION_PURGE"
                    className="flex-1 min-w-[210px] px-3 py-1.5 text-xs font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                  />
                  <button
                    type="button"
                    disabled={purging || purgeConfirmText !== 'CONFIRM_RETENTION_PURGE'}
                    onClick={handleExecutePurge}
                    className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold rounded-lg bg-red-600 hover:bg-red-700 text-white disabled:opacity-40 cursor-pointer whitespace-nowrap"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    {purging ? 'Purging...' : 'Run Purge'}
                  </button>
                </div>
              </div>
            </div>

            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-4">
              <div>
                <h3 className="text-sm font-display font-bold">Database & Audit Backups</h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Download verified point-in-time SQLite database snapshots or structured JSON export bundles. Every backup download is logged in the audit trail.
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <button
                  type="button"
                  disabled={downloadingBackup !== null}
                  onClick={() => handleDownloadBackup('sqlite')}
                  className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 hover:border-blue-600 text-left space-y-1.5 cursor-pointer disabled:opacity-50"
                >
                  <div className="flex items-center justify-between">
                    <Database className="w-5 h-5 text-blue-600" />
                    <Download className="w-4 h-4 text-slate-400" />
                  </div>
                  <div className="text-xs font-semibold">
                    {downloadingBackup === 'sqlite' ? 'Creating SQLite backup...' : 'Download SQLite (.db)'}
                  </div>
                  <div className="text-[11px] text-slate-500">Full hot SQLite binary snapshot via sqlite.backup().</div>
                </button>

                <button
                  type="button"
                  disabled={downloadingBackup !== null}
                  onClick={() => handleDownloadBackup('json')}
                  className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 hover:border-blue-600 text-left space-y-1.5 cursor-pointer disabled:opacity-50"
                >
                  <div className="flex items-center justify-between">
                    <HardDrive className="w-5 h-5 text-emerald-600" />
                    <Download className="w-4 h-4 text-slate-400" />
                  </div>
                  <div className="text-xs font-semibold">
                    {downloadingBackup === 'json' ? 'Generating JSON...' : 'Download JSON Archive'}
                  </div>
                  <div className="text-[11px] text-slate-500">Portable JSON bundle of operational tables & logs.</div>
                </button>
              </div>

              {mediaAudit && (
                <div className="pt-3 border-t border-slate-200 dark:border-slate-800 grid grid-cols-2 gap-3 text-xs">
                  <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
                    <div className="text-slate-500">Verified Disk Files</div>
                    <div className="text-lg font-mono font-bold tabular-nums">{mediaAudit.diskFileCount}</div>
                  </div>
                  <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
                    <div className="text-slate-500">Media Storage Footprint</div>
                    <div className="text-lg font-mono font-bold tabular-nums">
                      {formatBytesCompact(mediaAudit.diskBytes)}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Media Storage Audit Tables */}
          {mediaAudit && (
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
              <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
                <div className="px-5 py-3 border-b border-slate-200 dark:border-slate-800">
                  <h4 className="text-xs font-display font-bold">
                    Recent Ticket Attachments ({mediaAudit.ticketFiles.length})
                  </h4>
                </div>
                <div className="overflow-x-auto max-h-64 overflow-y-auto">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/50 text-slate-500">
                        <th className="py-2 px-3">Ticket</th>
                        <th className="py-2 px-3">File</th>
                        <th className="py-2 px-3 text-right">Size</th>
                        <th className="py-2 px-3">Uploader</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      {mediaAudit.ticketFiles.map((f) => (
                        <tr key={f.id}>
                          <td className="py-2 px-3 font-mono text-blue-700 dark:text-blue-400">{f.ref_code}</td>
                          <td className="py-2 px-3 truncate max-w-[180px]">{f.original_name}</td>
                          <td className="py-2 px-3 text-right font-mono tabular-nums">{formatBytesCompact(f.file_size)}</td>
                          <td className="py-2 px-3 text-slate-500">{f.uploaded_by || 'System'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
                <div className="px-5 py-3 border-b border-slate-200 dark:border-slate-800">
                  <h4 className="text-xs font-display font-bold">
                    Recent Chat Attachments ({mediaAudit.chatFiles.length})
                  </h4>
                </div>
                <div className="overflow-x-auto max-h-64 overflow-y-auto">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/50 text-slate-500">
                        <th className="py-2 px-3">Ref</th>
                        <th className="py-2 px-3">File</th>
                        <th className="py-2 px-3 text-right">Size</th>
                        <th className="py-2 px-3">Uploader</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      {mediaAudit.chatFiles.map((f) => (
                        <tr key={f.id}>
                          <td className="py-2 px-3 font-mono text-blue-700 dark:text-blue-400">{f.ref_code}</td>
                          <td className="py-2 px-3 truncate max-w-[180px]">{f.original_name}</td>
                          <td className="py-2 px-3 text-right font-mono tabular-nums">{formatBytesCompact(f.file_size)}</td>
                          <td className="py-2 px-3 text-slate-500">{f.uploaded_by || 'System'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Create Scoped Admin Account Modal */}
      {createAdminModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 flex items-center justify-center p-4">
          <form
            onSubmit={handleCreateAdmin}
            className="w-full max-w-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 space-y-3"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-base font-display font-bold">Create Operations Admin Account</h3>
              <button type="button" onClick={() => setCreateAdminModal(false)} className="cursor-pointer">
                <X className="w-4 h-4 text-slate-400" />
              </button>
            </div>
            <input
              required
              placeholder="Full Name *"
              value={newAdminName}
              onChange={(e) => setNewAdminName(e.target.value)}
              className="w-full px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
            />
            <input
              type="email"
              required
              placeholder="Work Email Address *"
              value={newAdminEmail}
              onChange={(e) => setNewAdminEmail(e.target.value)}
              className="w-full px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
            />
            <input
              type="password"
              required
              minLength={8}
              placeholder="Initial Password (min 8 chars) *"
              value={newAdminPassword}
              onChange={(e) => setNewAdminPassword(e.target.value)}
              className="w-full px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
            />
            <p className="text-[11px] text-slate-500">
              After creating the account, customize hub/department/moderator scopes and feature permissions directly in the Admin Scopes list.
            </p>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setCreateAdminModal(false)}
                className="px-4 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={creatingAdmin}
                className="px-4 py-2 text-xs font-semibold rounded-lg bg-blue-700 hover:bg-blue-800 text-white disabled:opacity-50 cursor-pointer"
              >
                {creatingAdmin ? 'Creating...' : 'Create Admin'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
