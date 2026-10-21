/* Quick preview renderer for the welcome card — outputs to preview-welcome.png */
import { welcomeCard } from '../src/utils/welcomecard';

async function main() {
  const buffer = await welcomeCard.generate({
    avatarUrl: 'https://cdn.discordapp.com/embed/avatars/0.png',
    displayName: 'Test User',
    guildName: 'TALABA',
    memberCount: 1234,
    welcomeMessage: 'Welcome to {server}, {username}!',
  });

  const { writeFileSync } = await import('node:fs');
  writeFileSync('preview-welcome.png', buffer);
  console.log('Preview written to preview-welcome.png');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
