import { createCanvas, loadImage } from '@napi-rs/canvas';
import type { SKRSContext2D } from '@napi-rs/canvas';
import { ensureFonts, FONT_STACK, ellipsize } from './fonts';
import path from 'path';

export interface WelcomeCardData {
  avatarUrl: string;
  username: string;
  guildName: string;
  memberCount: number;
  welcomeMessage: string;
}

/**
 * Generates a welcome card using a background image.
 * The avatar is placed in the center (black hole area),
 * with welcome text below and member count at the bottom.
 */
export class WelcomeCardCanvas {
  width = 1024;
  height = 512;

  async generate(data: WelcomeCardData): Promise<Buffer> {
    ensureFonts();

    const canvas = createCanvas(this.width, this.height);
    const ctx = canvas.getContext('2d');

    // Draw background image
    await this.drawBackground(ctx, data);

    // Draw avatar in the center (black hole position)
    await this.drawAvatar(ctx, data.avatarUrl);

    // Draw welcome message (big bright white text)
    this.drawWelcomeText(ctx, data);

    // Draw member count (small light gray text)
    this.drawMemberCount(ctx, data.memberCount);

    return canvas.toBuffer('image/png');
  }

  private async drawBackground(ctx: SKRSContext2D, data: WelcomeCardData): Promise<void> {
    const config = await import('../config');
    const bgPath = config.getConfig().welcome.backgroundImage || 'assets/bg.jpg';
    const fullBgPath = path.resolve(process.cwd(), bgPath);

    try {
      const bgImage = await loadImage(fullBgPath);
      // Draw background covering entire canvas
      ctx.drawImage(bgImage, 0, 0, this.width, this.height);
    } catch (error) {
      console.error('[WelcomeCard] Failed to load background image, using fallback:', error);
      // Fallback gradient background
      const gradient = ctx.createLinearGradient(0, 0, this.width, this.height);
      gradient.addColorStop(0, '#0a0a1a');
      gradient.addColorStop(0.5, '#1a0a2e');
      gradient.addColorStop(1, '#0a0a1a');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, this.width, this.height);
    }

    // Dark overlay for better text readability
    const overlay = ctx.createLinearGradient(0, 0, 0, this.height);
    overlay.addColorStop(0, 'rgba(0, 0, 0, 0.3)');
    overlay.addColorStop(0.5, 'rgba(0, 0, 0, 0.5)');
    overlay.addColorStop(1, 'rgba(0, 0, 0, 0.7)');
    ctx.fillStyle = overlay;
    ctx.fillRect(0, 0, this.width, this.height);
  }

  private async drawAvatar(ctx: SKRSContext2D, avatarUrl: string): Promise<void> {
    const centerX = this.width / 2;
    const centerY = this.height / 2 - 30; // Slightly above center for the "black hole"
    const radius = 110;

    ctx.save();
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius, 0, Math.PI * 2, true);
    ctx.closePath();
    ctx.clip();

    try {
      if (avatarUrl) {
        const avatar = await loadImage(avatarUrl);
        const size = Math.max(avatar.width, avatar.height);
        const scale = (radius * 2) / size;
        const drawWidth = avatar.width * scale;
        const drawHeight = avatar.height * scale;
        ctx.drawImage(avatar, centerX - drawWidth / 2, centerY - drawHeight / 2, drawWidth, drawHeight);
      } else {
        throw new Error('no avatar');
      }
    } catch {
      // Fallback gradient avatar
      const fallback = ctx.createLinearGradient(
        centerX - radius,
        centerY - radius,
        centerX + radius,
        centerY + radius
      );
      fallback.addColorStop(0, '#5865f2');
      fallback.addColorStop(1, '#a033ff');
      ctx.fillStyle = fallback;
      ctx.fillRect(centerX - radius, centerY - radius, radius * 2, radius * 2);
    }
    ctx.restore();

    // Glowing ring around the avatar (black hole event horizon effect)
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius + 4, 0, Math.PI * 2, true);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 3;
    ctx.shadowColor = '#ffffff';
    ctx.shadowBlur = 20;
    ctx.stroke();
    ctx.shadowBlur = 0;

    // Outer glow ring
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius + 12, 0, Math.PI * 2, true);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  private drawWelcomeText(ctx: SKRSContext2D, data: WelcomeCardData): void {
    const centerX = this.width / 2;
    const textY = this.height / 2 + 110; // Below avatar

    // Replace placeholders in welcome message
    const message = data.welcomeMessage
      .replace(/{user}/g, `<@${data.username}>`) // Will be replaced with mention in actual send
      .replace(/{username}/g, data.username)
      .replace(/{server}/g, data.guildName)
      .replace(/{memberCount}/g, data.memberCount.toString());

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // Main welcome text - big bright white
    ctx.font = `bold 48px ${FONT_STACK}`;
    ctx.fillStyle = '#FFFFFF';
    ctx.shadowColor = 'rgba(255, 255, 255, 0.5)';
    ctx.shadowBlur = 15;
    ctx.fillText(this.fitText(ctx, message, this.width - 100), centerX, textY);
    ctx.shadowBlur = 0;
  }

  private drawMemberCount(ctx: SKRSContext2D, memberCount: number): void {
    const centerX = this.width / 2;
    const textY = this.height - 60; // Near bottom

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `20px ${FONT_STACK}`;
    ctx.fillStyle = '#b9bbbe'; // Light gray (Discord's secondary text color)
    ctx.fillText(`Member #${memberCount.toLocaleString()}`, centerX, textY);
  }

  private fitText(ctx: SKRSContext2D, text: string, maxWidth: number): string {
    return ellipsize((t) => ctx.measureText(t).width, text, maxWidth);
  }
}

export const welcomeCard = new WelcomeCardCanvas();
export default welcomeCard;