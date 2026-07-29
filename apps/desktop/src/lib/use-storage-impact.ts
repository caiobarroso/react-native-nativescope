import { useMemo } from "react";
import { useStudio } from "./store.ts";
import { useNetwork } from "./network-store.ts";
import { buildStorageAttribution, type StorageAttribution } from "./network-storage-link.ts";

/**
 * Atribuição Network↔Storage memoizada. Lê os requests (network) e o log de
 * atividade de storage (studio) do device em foco. Recalcula quando qualquer
 * dos dois muda — barato: o log de atividade é limitado.
 */
export function useStorageAttribution(): StorageAttribution {
  const requests = useNetwork((s) => s.requests);
  const activity = useStudio((s) => s.activity);
  return useMemo(() => buildStorageAttribution(requests, activity), [requests, activity]);
}
