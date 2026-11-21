'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useMemo } from 'react';
import { ApiError, apiGet, apiPost, setApiHandlers } from './api';
import { qk } from './query-keys';
import { PREVIEW_USER } from './frontend-preview';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const queryClient = useQueryClient();

  const me = useQuery({
    queryKey: qk.me,
    queryFn: async () => {
      if (process.env.NEXT_PUBLIC_FRONTEND_ONLY === 'true') return PREVIEW_USER;
      try {
        return (await apiGet('/api/auth/me')).user;
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) return null;
        throw error;
      }
    },
    staleTime: 60_000,
  });

  const signedOut = useCallback(() => {
    queryClient.clear();
    queryClient.setQueryData(qk.me, null);
  }, [queryClient]);

  useEffect(() => {
    setApiHandlers({
      onUnauthorized: signedOut,
      onForbidden: () => queryClient.invalidateQueries({ queryKey: qk.me }),
    });
  }, [queryClient, signedOut]);

  const value = useMemo(() => {
    const user = me.data ?? null;
    const permissions = new Set(user?.permissions ?? []);
    return {
      user,
      loading: me.isPending,
      error: me.error,
      retry: me.refetch,
      /** Hides UI only. The server makes the real access decision. */
      can: (permission) => permissions.has(permission),
      signedIn: (nextUser) => queryClient.setQueryData(qk.me, nextUser),
      async signOut() {
        await apiPost('/api/auth/logout').catch(() => {});
        signedOut();
      },
    };
  }, [me.data, me.isPending, me.error, me.refetch, queryClient, signedOut]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}

export const PERM = {
  PAYROLL_READ: 'payroll.read',
  PAYROLL_MANAGE: 'payroll.manage',
  PAYROLL_APPROVE: 'payroll.approve',
  PAYSLIP_SEND: 'payslip.send',
  EMPLOYEES_READ: 'employees.read',
  EMPLOYEES_MANAGE: 'employees.manage',
  SETTINGS_MANAGE: 'settings.manage',
  USERS_MANAGE: 'users.manage',
  ROLES_MANAGE: 'roles.manage',
};
