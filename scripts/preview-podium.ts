import fs from 'node:fs';
import path from 'node:path';
import { leaderboardPodium } from '../src/utils/rankcard';

async function main() {
  const buffer = await leaderboardPodium.generate([
    { username: 'Amine', avatarUrl: '', level: 14, totalXp: 10751 },
    { username: 'Abdeldahi ✓', avatarUrl: '', level: 14, totalXp: 10116 },
    { username: 'iGilver_^', avatarUrl: '', level: 13, totalXp: 9470 },
  ]);
  const out = path.join(process.cwd(), 'preview-podium.png');
  fs.writeFileSync(out, buffer);
  console.log('wrote', out, buffer.length, 'bytes');
}

void main();
