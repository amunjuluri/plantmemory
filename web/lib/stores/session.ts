import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

export type Role = "manager" | "qa";

export const ROLE_LABEL: Record<Role, string> = { manager: "Maintenance manager", qa: "QA reviewer" };

type SessionState = {
  role: Role;
  names: Record<Role, string>;
  setRole: (role: Role) => void;
  setName: (role: Role, name: string) => void;
};

/**
 * Who is acting. The demo has no sign-in, so the person picks a role and a name; the
 * server records that name on every action and refuses QA approval by the submitter.
 */
export const useSession = create<SessionState>()(
  persist(
    (set) => ({
      role: "manager",
      names: { manager: "Ravi Kumar", qa: "Sita Rao" },
      setRole: (role) => set({ role }),
      setName: (role, name) => set((s) => ({ names: { ...s.names, [role]: name } })),
    }),
    {
      name: "plantmemory-session",
      storage: createJSONStorage(() => localStorage),
      // Restored after mount (see Providers) so the first render matches the prerendered HTML.
      skipHydration: true,
    },
  ),
);

/** The acting person's name, never empty. */
export function useActorName(): string {
  return useSession((s) => s.names[s.role].trim() || ROLE_LABEL[s.role]);
}
