import { createCanvas, loadImage } from '@napi-rs/canvas';
import type { SKRSContext2D } from '@napi-rs/canvas';
import { ensureFonts, FONT_STACK, ellipsize } from './fonts';
import path from 'path';

export interface WelcomeCardData {
  avatarUrl: string;
  displayName: string;
  guildName: string;
  memberCount: number;
  welcomeMessage: string;
}

/**
 * Generates a sleek black & white welcome card.
 * Only black and white are used — no other colors anywhere.
 * Crisp lines, thin rings, high-contrast text on a black background.
 */
export class WelcomeCardCanvas {
  width = 1024;
  height = 512;

  async generate(data: WelcomeCardData): Promise<Buffer> {
    ensureFonts();

    const canvas = createCanvas(this.width, this.height);
    const ctx = canvas.getContext('2d');

    // Draw black & white background
    await this.drawBackground(ctx, data);

    // Draw avatar in the center with a crisp white ring
    await this.drawAvatar(ctx, data.avatarUrl);

    // Draw welcome message — big white text
    this.drawWelcomeText(ctx, data);

    // Draw member count — black pill badge, white border & text
    this.drawMemberCount(ctx, data.memberCount);

    return canvas.toBuffer('image/png');
  }

  private async drawBackground(ctx: SKRSContext2D, data: WelcomeCardData): Promise<void> {
    const config = await import('../config');
    const bgPath = config.getConfig().welcome.backgroundImage || 'assets/bg.jpg';
    const fullBgPath = path.resolve(process.cwd(), bgPath);

    try {
      const bgImage = await loadImage(fullBgPath);
      ctx.drawImage(bgImage, 0, 0, this.width, this.height);
    } catch (error) {
      console.error('[WelcomeCard] Failed to load background image, using black:', error);
      // Solid black fallback — no colors other than black/white
      ctx.fillStyle = '#000000';
      ctx.fillRect(0, 0, this.width, this.height);
    }

    // Dark overlay for text readability (black only, varying opacity)
    const overlay = ctx.createLinearGradient(0, 0, 0, this.height);
    overlay.addColorStop(0, 'rgba(0, 0, 0, 0.35)');
    overlay.addColorStop(0.5, 'rgba(0, 0, 0, 0.55)');
    overlay.addColorStop(1, 'rgba(0, 0, 0, 0.75)');
    ctx.fillStyle = overlay;
    ctx.fillRect(0, 0, this.width, this.height);
  }

  private async drawAvatar(ctx: SKRSContext2D, avatarUrl: string): Promise<void> {
    const centerX = this.width / 2;
    const centerY = this.height / 2 - 20;
    const radius = 100;

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
        ctx.drawImage(
          avatar,
          centerX - (avatar.width * scale) / 2,
          centerY - (avatar.height * scale) / 2,
          avatar.width * scale,
          avatar.height * scale,
        );
      } else {
        throw new Error('no avatar');
      }
    } catch {
      // Black fallback avatar — the white ring below is the only color
      ctx.fillStyle = '#111111';
      ctx.fillRect(centerX - radius, centerY - radius, radius * 2, radius * 2);
    }
    ctx.restore();

    // Crisp white ring around avatar (no glow — sleek, minimal)
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius + 3, 0, Math.PI * 2, true);
    ctx.strokeStyle = '#FFFFFF';
    ctx.lineWidth = 3;
    ctx.stroke();

    // Subtle inner highlight for depth (white, low opacity)
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius - 1, 0, Math.PI * 2, true);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  private drawWelcomeText(ctx: SKRSContext2D, data: WelcomeCardData): void {
    const centerX = this.width / 2;
    const avatarCenterY = this.height / 2 - 20;
    const avatarRadius = 100;
    const textY = avatarCenterY + avatarRadius + 90;

    // Replace placeholders in welcome message
    const message = data.welcomeMessage
      .replace(/{user}/g, `<@${data.displayName}>`) // Will be replaced with mention in actual send
      .replace(/{username}/g, data.displayName)
      .replace(/{server}/g, data.guildName)
      .replace(/{memberCount}/g, data.memberCount.toString());

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    ctx.font = `bold 46px ${FONT_STACK}`;
    ctx.fillStyle = '#FFFFFF';
    ctx.shadowColor = 'rgba(0, 0, 0, 0.85)';
    ctx.shadowBlur = 6;
    ctx.shadowOffsetY = 2;
    ctx.fillText(this.fitText(ctx, message, this.width - 120), centerX, textY);
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;
  }

  private drawMemberCount(ctx: SKRSContext2D, memberCount: number): void {
    const centerX = this.width / 2;
    const textY = this.height - 48;

    const memberText = `Member #${memberCount.toLocaleString()}`;

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `bold 20px ${FONT_STACK}`;

    const textMetrics = ctx.measureText(memberText);
    const textWidth = textMetrics.width;
    const paddingX = 24;
    const paddingY = 10;
    const bgWidth = textWidth + paddingX * 2;
    const bgHeight = 36;
    const bgX = centerX - bgWidth / 2;
    const bgY = textY - bgHeight / 2;
    const radius = 18;

    // Black pill badge with white border
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(bgX + radius, bgY);
    ctx.lineTo(bgX + bgWidth - radius, bgY);
    ctx.quadraticCurveTo(bgX + bgWidth, bgY, bgX + bgWidth, bgY + radius);
    ctx.lineTo(bgX + bgWidth, bgY + bgHeight - radius);
    ctx.quadraticCurveTo(bgX + bgWidth, bgY + bgHeight, bgX + bgWidth - radius, bgY + bgHeight);
    ctx.lineTo(bgX + radius, bgY + bgHeight);
    ctx.quadraticCurveTo(bgX, bgY + bgHeight, bgX, bgY + bgHeight - radius);
    ctx.lineTo(bgX, bgY + radius);
    ctx.quadraticCurveTo(bgX, bgY, bgX + radius, bgY);
    ctx.closePath();

    ctx.fillStyle = '#000000';
    ctx.fill();
    ctx.strokeStyle = '#FFFFFF';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.restore();

    // Member count text
    ctx.fillStyle = '#FFFFFF';
    ctx.shadowColor = 'rgba(0, 0, 0, 0.7)';
    ctx.shadowBlur = 3;
    ctx.shadowOffsetY = 1;
    ctx.fillText(memberText, centerX, textY);
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;
  }

  private fitText(ctx: SKRSContext2D, text: string, maxWidth: number): string {
    return ellipsize((t) => ctx.measureText(t).width, text, maxWidth);
  }
}

export const welcomeCard = new WelcomeCardCanvas();
export default welcomeCard;
