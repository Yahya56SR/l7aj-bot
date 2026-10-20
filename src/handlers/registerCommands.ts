import { REST } from '@discordjs/rest';
import { Routes } from 'discord-api-types/v10';

export async function registerCommands(
  rest: REST,
  commands: any[],
  clientId: string,
  guildId: string,
): Promise<void> {
  await rest.put(Routes.applicationGuildCommands(clientId, guildId), {
    body: commands.map((c: any) => c.toJSON()),
  });
}
