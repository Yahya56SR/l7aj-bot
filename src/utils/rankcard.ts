import { createCanvas, loadImage } from '@napi-rs/canvas';
import type { SKRSContext2D } from '@napi-rs/canvas';
import { ensureFonts, FONT_STACK, ellipsize } from './fonts';

export interface RankCardData {
  avatarUrl: string;
  username: string;
  statusText?: string | null;
  level: number;
  rank: number | null;
  totalRanked?: number;
  xpIntoLevel: number;
  xpNeeded: number;
  totalXp?: number;
  guildName?: string;
}

export interface LeaderboardRow {
  userId: string;
  username: string;
  avatarUrl: string;
  level: number;
  totalXp: number;
}

export class RankCardCanvas {
  width = 1000;
  height = 300;

  async generate(data: RankCardData): Promise<Buffer> {
    ensureFonts();

    const canvas = createCanvas(this.width, this.height);
    const ctx = canvas.getContext('2d');

    this.drawBackground(ctx);
    await this.drawAvatar(ctx, data.avatarUrl);

    const textX = 310;
    const rightX = 960;

    // Username
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.font = `bold 44px ${FONT_STACK}`;
    ctx.fillStyle = '#FFFFFF';
    ctx.fillText(this.fitText(ctx, data.username, 440), textX, 112);

    // Secondary line: total XP, or the member's custom status
    const secondary = data.statusText || `Total XP: ${(data.totalXp ?? 0).toLocaleString()}`;
    ctx.font = `24px ${FONT_STACK}`;
    ctx.fillStyle = '#b9bbbe';
    ctx.fillText(this.fitText(ctx, secondary, 440), textX, 152);

    // Rank (right)
    ctx.textAlign = 'right';
    ctx.font = `bold 40px ${FONT_STACK}`;
    ctx.fillStyle = '#f0b232';
    const rankLabel = data.rank
      ? `Rank #${data.rank}${data.totalRanked ? ` / ${data.totalRanked}` : ''}`
      : 'Unranked';
    ctx.fillText(rankLabel, rightX, 108);

    // Level (right)
    ctx.font = `bold 34px ${FONT_STACK}`;
    ctx.fillStyle = '#00b0f4';
    ctx.fillText(`Level ${data.level}`, rightX, 152);

    // XP labels
    const progress =
      data.xpNeeded > 0
        ? Math.min(1, Math.max(0, data.xpIntoLevel / data.xpNeeded))
        : 0;

    ctx.font = `24px ${FONT_STACK}`;
    ctx.fillStyle = '#b9bbbe';
    ctx.textAlign = 'left';
    ctx.fillText(
      `${data.xpIntoLevel.toLocaleString()} / ${data.xpNeeded.toLocaleString()} XP`,
      textX,
      212,
    );
    ctx.textAlign = 'right';
    ctx.fillText(`${Math.round(progress * 100)}%`, rightX, 212);

    // Progress bar
    this.drawProgressBar(ctx, textX, 228, rightX - textX, 28, progress);

    // Guild name under the bar
    if (data.guildName) {
      ctx.textAlign = 'left';
      ctx.font = `20px ${FONT_STACK}`;
      ctx.fillStyle = 'rgba(255, 255, 255, 0.45)';
      ctx.fillText(this.fitText(ctx, data.guildName, 650), textX, 284);
    }

    // Subtle border on top of everything
    this.roundedRect(ctx, 2, 2, this.width - 4, this.height - 4, 24);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.10)';
    ctx.lineWidth = 4;
    ctx.stroke();

    return canvas.toBuffer('image/png');
  }

  private drawBackground(ctx: SKRSContext2D): void {
    this.roundedRect(ctx, 0, 0, this.width, this.height, 24);
    const gradient = ctx.createLinearGradient(0, 0, this.width, this.height);
    gradient.addColorStop(0, '#1e1f3a');
    gradient.addColorStop(0.55, '#2b2d63');
    gradient.addColorStop(1, '#171831');
    ctx.fillStyle = gradient;
    ctx.fill();

    // Soft accent glow in the top-right corner
    const glow = ctx.createRadialGradient(this.width - 60, 40, 10, this.width - 60, 40, 420);
    glow.addColorStop(0, 'rgba(160, 51, 255, 0.35)');
    glow.addColorStop(1, 'rgba(160, 51, 255, 0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, this.width, this.height);
  }

  private async drawAvatar(ctx: SKRSContext2D, avatarUrl: string): Promise<void> {
    const x = 170;
    const y = 150;
    const radius = 100;

    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2, true);
    ctx.closePath();
    ctx.clip();

    try {
      if (avatarUrl) {
        const avatar = await loadImage(avatarUrl);
        const size = Math.max(avatar.width, avatar.height);
        ctx.drawImage(avatar, x - size / 2, y - size / 2, size, size);
      } else {
        throw new Error('no avatar');
      }
    } catch {
      const fallback = ctx.createLinearGradient(x - radius, y - radius, x + radius, y + radius);
      fallback.addColorStop(0, '#5865f2');
      fallback.addColorStop(1, '#a033ff');
      ctx.fillStyle = fallback;
      ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
    }
    ctx.restore();

    // Ring around the avatar
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2, true);
    ctx.strokeStyle = '#FFFFFF';
    ctx.lineWidth = 6;
    ctx.stroke();
  }

  private drawProgressBar(
    ctx: SKRSContext2D,
    x: number,
    y: number,
    width: number,
    height: number,
    progress: number,
  ): void {
    // Track
    this.roundedRect(ctx, x, y, width, height, height / 2);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.14)';
    ctx.fill();

    if (progress <= 0) return;

    // Fill
    const fillWidth = Math.max(height, width * progress);
    this.roundedRect(ctx, x, y, fillWidth, height, height / 2);
    const gradient = ctx.createLinearGradient(x, y, x + width, y);
    gradient.addColorStop(0, '#00b0f4');
    gradient.addColorStop(1, '#a033ff');
    ctx.fillStyle = gradient;
    ctx.fill();
  }

  private roundedRect(
    ctx: SKRSContext2D,
    x: number,
    y: number,
    width: number,
    height: number,
    radius: number,
  ): void {
    const r = Math.min(radius, width / 2, height / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + width, y, x + width, y + height, r);
    ctx.arcTo(x + width, y + height, x, y + height, r);
    ctx.arcTo(x, y + height, x, y, r);
    ctx.arcTo(x, y, x + width, y, r);
    ctx.closePath();
  }

  private fitText(ctx: SKRSContext2D, text: string, maxWidth: number): string {
    return ellipsize((t) => ctx.measureText(t).width, text, maxWidth);
  }
}

/**
 * MEE6-style leaderboard image.
 */
export class LeaderboardCanvas {
  width = 1000;
  rowHeight = 56;
  headerHeight = 120;

  async generate(
    rows: LeaderboardRow[],
    guildName: string,
    title = 'Top members',
  ): Promise<Buffer> {
    ensureFonts();

    const height = this.headerHeight + rows.length * this.rowHeight + 30;
    const canvas = createCanvas(this.width, height);
    const ctx = canvas.getContext('2d');

    this.drawBackground(ctx, height);

    // Title
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.font = `bold 40px ${FONT_STACK}`;
    ctx.fillStyle = '#FFFFFF';
    ctx.fillText(title, 50, 62);

    // Guild name
    ctx.textAlign = 'right';
    ctx.font = `24px ${FONT_STACK}`;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.55)';
    ctx.fillText(guildName, this.width - 50, 60);

    // Divider
    ctx.fillStyle = 'rgba(255, 255, 255, 0.12)';
    ctx.fillRect(50, 84, this.width - 100, 2);

    for (let i = 0; i < rows.length; i++) {
      await this.drawRow(ctx, rows[i], i, this.headerHeight + i * this.rowHeight);
    }

    this.roundedRect(ctx, 2, 2, this.width - 4, height - 4, 24);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.10)';
    ctx.lineWidth = 4;
    ctx.stroke();

    return canvas.toBuffer('image/png');
  }

  private async drawRow(
    ctx: SKRSContext2D,
    row: LeaderboardRow,
    index: number,
    y: number,
  ): Promise<void> {
    const centerY = y + this.rowHeight / 2;

    // Rank number
    ctx.textAlign = 'center';
    ctx.font = `bold 26px ${FONT_STACK}`;
    ctx.fillStyle =
      index === 0 ? '#f0b232' : index === 1 ? '#c0c6cf' : index === 2 ? '#cd7f32' : '#8b93a7';
    ctx.fillText(`${index + 1}`, 56, centerY + 9);

    // Avatar
    const avatarX = 120;
    const radius = 20;
    ctx.save();
    ctx.beginPath();
    ctx.arc(avatarX, centerY, radius, 0, Math.PI * 2, true);
    ctx.closePath();
    ctx.clip();
    try {
      const avatar = await loadImage(row.avatarUrl);
      const size = radius * 2;
      ctx.drawImage(avatar, avatarX - size / 2, centerY - size / 2, size, size);
    } catch {
      ctx.fillStyle = '#5865f2';
      ctx.fillRect(avatarX - radius, centerY - radius, radius * 2, radius * 2);
    }
    ctx.restore();

    ctx.beginPath();
    ctx.arc(avatarX, centerY, radius, 0, Math.PI * 2, true);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Username
    ctx.textAlign = 'left';
    ctx.font = `26px ${FONT_STACK}`;
    ctx.fillStyle = '#FFFFFF';
    ctx.fillText(
      ellipsize((t) => ctx.measureText(t).width, row.username, 400),
      160,
      centerY + 9,
    );

    // Level
    ctx.textAlign = 'right';
    ctx.font = `bold 24px ${FONT_STACK}`;
    ctx.fillStyle = '#00b0f4';
    ctx.fillText(`Level ${row.level}`, 760, centerY + 8);

    // XP
    ctx.font = `22px ${FONT_STACK}`;
    ctx.fillStyle = '#b9bbbe';
    ctx.fillText(`${row.totalXp.toLocaleString()} XP`, this.width - 50, centerY + 8);
  }

  private drawBackground(ctx: SKRSContext2D, height: number): void {
    this.roundedRect(ctx, 0, 0, this.width, height, 24);
    const gradient = ctx.createLinearGradient(0, 0, this.width, height);
    gradient.addColorStop(0, '#1e1f3a');
    gradient.addColorStop(0.55, '#2b2d63');
    gradient.addColorStop(1, '#171831');
    ctx.fillStyle = gradient;
    ctx.fill();

    const glow = ctx.createRadialGradient(this.width - 60, 40, 10, this.width - 60, 40, 420);
    glow.addColorStop(0, 'rgba(160, 51, 255, 0.35)');
    glow.addColorStop(1, 'rgba(160, 51, 255, 0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, this.width, height);
  }

  private roundedRect(
    ctx: SKRSContext2D,
    x: number,
    y: number,
    width: number,
    height: number,
    radius: number,
  ): void {
    const r = Math.min(radius, width / 2, height / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + width, y, x + width, y + height, r);
    ctx.arcTo(x + width, y + height, x, y + height, r);
    ctx.arcTo(x, y + height, x, y, r);
    ctx.arcTo(x, y, x + width, y, r);
    ctx.closePath();
  }
}

export const rankCard = new RankCardCanvas();
export const leaderboardCard = new LeaderboardCanvas();
export default rankCard;
