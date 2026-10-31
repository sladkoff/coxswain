import { useQuery } from "@tanstack/react-query";
import type { Dispatch, SetStateAction } from "react";
import { defaultUiPreferences, type UiPreferences } from "../../shared/ui-preferences";
import { core, queryClient } from "./queries";

export function useUiPreferences() {
  const query = useQuery(core("getUiPreferences"));
  const preferences = query.data ?? defaultUiPreferences;
  return function preference<K extends keyof UiPreferences>(
    key: K,
  ): [UiPreferences[K], Dispatch<SetStateAction<UiPreferences[K]>>] {
    return [
      preferences[key],
      (change) => {
        const queryKey = core("getUiPreferences").queryKey;
        const before = queryClient.getQueryData<UiPreferences>(queryKey);
        if (!before) return;
        const value = typeof change === "function" ? change(before[key]) : change;
        queryClient.setQueryData(queryKey, { ...before, [key]: value });
        void window.coxswain.setUiPreferences({ [key]: value }).catch(() => {
          // Roll back only if a newer choice has not superseded this write.
          queryClient.setQueryData<UiPreferences>(queryKey, (current) =>
            current?.[key] === value ? { ...current, [key]: before[key] } : current,
          );
        });
      },
    ];
  };
}
