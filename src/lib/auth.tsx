import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { Session } from "@supabase/supabase-js";

import { supabase } from "@/integrations/supabase/client";
import type { AppRole } from "@/lib/roles";

type AccountData = {
  profile: { id: string; full_name: string; email: string | null; is_active: boolean } | null;
  roles: AppRole[];
  permissions: string[];
  stationIds: string[];
};

type AuthValue = AccountData & {
  session: Session | null;
  loading: boolean;
  userId: string | null;
  hasRole: (role: AppRole) => boolean;
  hasPermission: (permission: string) => boolean;
  signOut: () => Promise<void>;
};

const emptyAccount: AccountData = {
  profile: null,
  roles: [],
  permissions: [],
  stationIds: [],
};

const AuthContext = createContext<AuthValue | null>(null);

async function loadAccount(userId: string): Promise<AccountData> {
  const [profileRes, rolesRes, overridesRes, scopesRes] = await Promise.all([
    supabase.from("profiles").select("id, full_name, email, is_active").eq("id", userId).maybeSingle(),
    supabase.from("user_roles").select("role").eq("user_id", userId),
    supabase.from("user_permission_overrides").select("permission_code, granted").eq("user_id", userId),
    supabase.from("user_station_scopes").select("station_id").eq("user_id", userId),
  ]);

  const roles = (rolesRes.data ?? []).map((r) => r.role as AppRole);

  let permissions: string[] = [];
  if (roles.length > 0) {
    const rp = await supabase.from("role_permissions").select("permission_code").in("role", roles);
    permissions = Array.from(new Set((rp.data ?? []).map((p) => p.permission_code)));
  }

  for (const o of overridesRes.data ?? []) {
    if (o.granted) {
      if (!permissions.includes(o.permission_code)) permissions.push(o.permission_code);
    } else {
      permissions = permissions.filter((p) => p !== o.permission_code);
    }
  }

  return {
    profile: profileRes.data ?? null,
    roles,
    permissions,
    stationIds: (scopesRes.data ?? []).map((s) => s.station_id),
  };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const queryClient = useQueryClient();

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((event, next) => {
      setSession(next);
      if (event === "SIGNED_IN" || event === "SIGNED_OUT" || event === "USER_UPDATED") {
        if (event !== "SIGNED_OUT") queryClient.invalidateQueries();
      }
    });
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });
    return () => sub.subscription.unsubscribe();
  }, [queryClient]);

  const userId = session?.user.id ?? null;

  const emailConfirmed = !!(session?.user.email_confirmed_at ?? session?.user.confirmed_at);

  const accountQuery = useQuery({
    queryKey: ["account", userId, emailConfirmed],
    enabled: !!userId,
    queryFn: async () => {
      // Davet yalnızca e-posta sahipliği doğrulandıktan sonra rol verir; kontrol sunucudadır.
      if (emailConfirmed) await supabase.rpc("claim_invite");
      return loadAccount(userId!);
    },
  });

  const account = accountQuery.data ?? emptyAccount;

  const value: AuthValue = {
    ...account,
    session,
    loading: loading || (!!userId && accountQuery.isLoading),
    userId,
    hasRole: (role) => account.roles.includes(role),
    hasPermission: (permission) =>
      (account.profile?.is_active ?? false) && account.permissions.includes(permission),
    signOut: async () => {
      await queryClient.cancelQueries();
      queryClient.clear();
      await supabase.auth.signOut();
    },
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth yalnızca AuthProvider içinde kullanılabilir");
  return ctx;
}
