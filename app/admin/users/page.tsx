'use client'

/**
 * Admin user-role management — the UI for lib/db-users.ts's listUsers/
 * setUserRole (that comment has said "for the admin user-management screen"
 * since it was written; this is that screen). Before this page existed, the
 * only way to promote or demote a user after the very first bootstrap admin
 * was a raw SQL UPDATE against production, or a hand-written fetch() call in
 * DevTools -- both undiscoverable and unaudited-by-UI. Gated by
 * app/admin/layout.tsx server-side; this page assumes it only ever renders
 * for an authenticated admin.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { ShieldCheck, Shield, Search, Loader2, AlertCircle, CheckCircle2 } from 'lucide-react'
import { DashboardHeader } from '@/components/DashboardHeader'
import { useAuthContext } from '@/components/AuthProvider'
import { cn } from '@/lib/utils'

interface UserSummary {
  id: number
  email: string
  full_name: string
  customer_id: number
  role: 'user' | 'admin'
  is_active: boolean
  created_at: string
  last_login: string | null
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

export default function AdminUsersPage() {
  const { user: me } = useAuthContext()
  const [users, setUsers] = useState<UserSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [pending, setPending] = useState<string | null>(null) // email currently being updated
  const [actionError, setActionError] = useState<string | null>(null)
  const [justUpdated, setJustUpdated] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true); setLoadError(null)
    try {
      const res = await fetch('/api/admin/users', { cache: 'no-store' })
      const json = await res.json()
      if (!res.ok) throw new Error(json?.data?.message || json?.error || `Failed to load (${res.status})`)
      setUsers(json.data?.users ?? [])
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Failed to load users')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return users
    return users.filter(u => u.email.toLowerCase().includes(q) || u.full_name.toLowerCase().includes(q))
  }, [users, query])

  async function toggleRole(target: UserSummary) {
    const nextRole = target.role === 'admin' ? 'user' : 'admin'
    setPending(target.email); setActionError(null); setJustUpdated(null)
    try {
      const res = await fetch('/api/admin/users', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: target.email, role: nextRole }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json?.data?.message || json?.error || 'Failed to update role')
      setUsers(prev => prev.map(u => u.email === target.email ? { ...u, role: nextRole } : u))
      setJustUpdated(target.email)
      setTimeout(() => setJustUpdated(cur => cur === target.email ? null : cur), 2500)
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to update role')
    } finally {
      setPending(null)
    }
  }

  const adminCount = users.filter(u => u.role === 'admin').length

  return (
    <div className="min-h-screen w-full">
      <DashboardHeader title="User Management" subtitle="Promote or demote accounts — changes take effect immediately" />

      <div className="w-full px-4 sm:px-6 lg:px-8 py-5 sm:py-8 max-w-[1200px] mx-auto space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="relative w-full sm:w-80">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search by email or name…"
              className="w-full rounded-lg border border-border bg-background pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>
          <div className="text-xs text-muted-foreground">
            {users.length} user{users.length === 1 ? '' : 's'} · {adminCount} admin{adminCount === 1 ? '' : 's'}
          </div>
        </div>

        {actionError && (
          <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{actionError}</span>
          </div>
        )}

        <div className="rounded-[16px] border border-border/60 bg-card shadow-[0_1px_3px_rgba(0,0,0,0.04),0_1px_2px_rgba(0,0,0,0.02)] overflow-hidden">
          {loading ? (
            <div className="p-8 flex items-center justify-center text-sm text-muted-foreground gap-2">
              <Loader2 className="w-4 h-4 animate-spin" /> Loading users…
            </div>
          ) : loadError ? (
            <div className="p-8 text-center text-sm text-destructive">{loadError}</div>
          ) : filtered.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground">No users match &quot;{query}&quot;.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border/60 text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="px-4 py-3 font-medium">User</th>
                    <th className="px-4 py-3 font-medium">Role</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                    <th className="px-4 py-3 font-medium">Last login</th>
                    <th className="px-4 py-3 font-medium">Joined</th>
                    <th className="px-4 py-3 font-medium text-right">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(u => {
                    const isSelf = me?.email?.toLowerCase().trim() === u.email.toLowerCase().trim()
                    const isPending = pending === u.email
                    return (
                      <tr key={u.id} className="border-b border-border/40 last:border-0 hover:bg-muted/30 transition-colors">
                        <td className="px-4 py-3">
                          <div className="font-medium text-foreground">{u.full_name || '—'}</div>
                          <div className="text-xs text-muted-foreground">{u.email}</div>
                        </td>
                        <td className="px-4 py-3">
                          <span className={cn(
                            'inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-semibold',
                            u.role === 'admin'
                              ? 'bg-primary/10 text-primary'
                              : 'bg-muted text-muted-foreground',
                          )}>
                            {u.role === 'admin' ? <ShieldCheck className="w-3 h-3" /> : <Shield className="w-3 h-3" />}
                            {u.role === 'admin' ? 'Admin' : 'User'}
                          </span>
                          {justUpdated === u.email && (
                            <span className="ml-2 inline-flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400">
                              <CheckCircle2 className="w-3 h-3" /> Updated
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-xs text-muted-foreground">{u.is_active ? 'Active' : 'Inactive'}</td>
                        <td className="px-4 py-3 text-xs text-muted-foreground">{fmtDate(u.last_login)}</td>
                        <td className="px-4 py-3 text-xs text-muted-foreground">{fmtDate(u.created_at)}</td>
                        <td className="px-4 py-3 text-right">
                          <button
                            type="button"
                            onClick={() => toggleRole(u)}
                            disabled={isPending || (isSelf && u.role === 'admin')}
                            title={isSelf && u.role === 'admin' ? "You can't remove your own admin role" : undefined}
                            className={cn(
                              'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed',
                              u.role === 'admin'
                                ? 'border border-border text-muted-foreground hover:text-foreground hover:border-foreground/30'
                                : 'bg-primary text-primary-foreground hover:opacity-90',
                            )}
                          >
                            {isPending && <Loader2 className="w-3 h-3 animate-spin" />}
                            {u.role === 'admin' ? 'Demote to User' : 'Promote to Admin'}
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
