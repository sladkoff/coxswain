import type { Db } from "./db";
import { emit } from "./events.ts";
import { defaultUiPreferences, type UiPreferences } from "../shared/ui-preferences.ts";

export async function getUiPreferences(db: Db): Promise<UiPreferences> {
  const rows = await db.selectFrom("settings").selectAll().where("key", "like", "ui:%").execute();
  const saved = Object.fromEntries(rows.map((row) => [row.key.slice(3), JSON.parse(row.value)]));
  return { ...defaultUiPreferences, ...saved };
}

// Separate keys preserve unrelated choices made by another window or a concurrent resize.
export async function setUiPreferences(db: Db, patch: Partial<UiPreferences>): Promise<void> {
  const values = Object.entries(patch)
    .filter(([key]) => Object.hasOwn(defaultUiPreferences, key))
    .map(([key, value]) => ({ key: `ui:${key}`, value: JSON.stringify(value) }));
  if (!values.length) return;
  await db
    .insertInto("settings")
    .values(values)
    .onConflict((conflict) =>
      conflict.column("key").doUpdateSet((eb) => ({ value: eb.ref("excluded.value") })),
    )
    .execute();
  emit({ what: "settings" });
}
