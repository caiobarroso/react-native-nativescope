import { z } from "zod";

export const capabilitySchema = z.enum([
  "key-value.read",
  "key-value.write",
  "key-value.watch",
  "database.query",
  "database.mutate",
  "database.watch",
]);

export type Capability = z.infer<typeof capabilitySchema>;

export const instanceDescriptorSchema = z.object({
  instanceId: z.string(),
  label: z.string(),
});

export const providerDescriptorSchema = z.object({
  providerId: z.string(),
  /** Nome exibido na UI: "MMKV", "AsyncStorage", "SQLite". Nunca jargão nosso. */
  label: z.string(),
  capabilities: z.array(capabilitySchema),
  instances: z.array(instanceDescriptorSchema),
});

export type InstanceDescriptor = z.infer<typeof instanceDescriptorSchema>;
export type ProviderDescriptor = z.infer<typeof providerDescriptorSchema>;
