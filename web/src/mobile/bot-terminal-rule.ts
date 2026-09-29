export interface BotTerminalCapabilities {
  server_host: string;
  client_on_server_host: boolean;
  profiles: Record<string, { backend: string; local_to_server: boolean }>;
}

export function showBotScreen(
  capabilities: BotTerminalCapabilities | null,
  profile: string,
  phone: boolean,
  hermeticHost?: string,
): boolean {
  if (phone) return true;
  if (!capabilities) return false; // no misleading local screen flash during discovery
  const local = capabilities.profiles[profile]?.local_to_server;
  if (!local) return true;
  return !(capabilities.client_on_server_host ||
    (hermeticHost !== undefined && hermeticHost === capabilities.server_host));
}
