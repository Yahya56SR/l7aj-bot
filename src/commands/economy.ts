import {
  SlashCommandBuilder,
  EmbedBuilder,
  ChatInputCommandInteraction,
} from 'discord.js';
import {
  getEconomy,
  setEconomy,
  addBalance,
  removeBalance,
  addBank,
  addInventoryItem,
  removeInventoryItem,
  getShopItem,
  listShopItems,
  addShopItem,
  removeShopItem,
  getUser,
} from '../db';
import { getConfig } from '../config';

const DAILY_AMOUNT = 100;
const WORK_MIN = 20;
const WORK_MAX = 80;

export const data = new SlashCommandBuilder()
  .setName('economy')
  .setDescription('Economy: balance, daily, work, shop, pay')
  .addSubcommand((sub) =>
    sub.setName('balance').setDescription('Check your balance and bank'),
  )
  .addSubcommand((sub) =>
    sub
      .setName('daily')
      .setDescription('Claim your daily reward'),
  )
  .addSubcommand((sub) =>
    sub.setName('work').setDescription('Work to earn some coins'),
  )
  .addSubcommand((sub) =>
    sub
      .setName('pay')
      .setDescription('Send coins to another member')
      .addUserOption((o) =>
        o.setName('member').setDescription('Member to pay').setRequired(true),
      )
      .addIntegerOption((o) =>
        o
          .setName('amount')
          .setDescription('Amount of coins to send')
          .setRequired(true)
          .setMinValue(1),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName('shop')
      .setDescription('Browse the server shop'),
  )
  .addSubcommand((sub) =>
    sub
      .setName('buy')
      .setDescription('Buy an item from the shop')
      .addStringOption((o) =>
        o.setName('item').setDescription('Item id to buy').setRequired(true),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName('inventory')
      .setDescription('View your inventory'),
  )
  .addSubcommandGroup((group) =>
    group
      .setName('admin')
      .setDescription('Admin economy tools')
      .addSubcommand((sub) =>
        sub
          .setName('add-item')
          .setDescription('Add an item to the shop')
          .addStringOption((o) =>
            o.setName('id').setDescription('Item id').setRequired(true),
          )
          .addStringOption((o) =>
            o.setName('name').setDescription('Item name').setRequired(true),
          )
          .addIntegerOption((o) =>
            o.setName('price').setDescription('Price in coins').setRequired(true).setMinValue(1),
          )
          .addStringOption((o) =>
            o.setName('description').setDescription('Item description').setRequired(true),
          ),
      )
      .addSubcommand((sub) =>
        sub
          .setName('remove-item')
          .setDescription('Remove an item from the shop')
          .addStringOption((o) =>
            o.setName('id').setDescription('Item id').setRequired(true),
          ),
      ),
  );

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.guild) {
    await interaction.reply({ content: 'This command can only be used in a server.', ephemeral: true });
    return;
  }

  const group = interaction.options.getSubcommandGroup(false);
  const sub = interaction.options.getSubcommand();

  if (group === 'admin') {
    if (sub === 'add-item') return adminAddItem(interaction);
    if (sub === 'remove-item') return adminRemoveItem(interaction);
    return;
  }

  switch (sub) {
    case 'balance': return balance(interaction);
    case 'daily': return daily(interaction);
    case 'work': return work(interaction);
    case 'pay': return pay(interaction);
    case 'shop': return shop(interaction);
    case 'buy': return buy(interaction);
    case 'inventory': return inventory(interaction);
    default: return;
  }
}

/* ------------------------------------------------------------------ */
/* Balance                                                            */
/* ------------------------------------------------------------------ */

async function balance(interaction: ChatInputCommandInteraction): Promise<void> {
  const userId = interaction.user.id;
  const data = getEconomy(userId);
  const embed = new EmbedBuilder()
    .setColor(0xf1c40f)
    .setTitle(`💰 ${interaction.user.username}'s Economy`)
    .addFields(
      { name: 'Wallet', value: `${data.balance} coins`, inline: true },
      { name: 'Bank', value: `${data.bank} / ${data.bankLimit} coins`, inline: true },
      { name: 'Total Earned', value: `${data.totalEarned} coins`, inline: true },
    );
  await interaction.reply({ embeds: [embed], ephemeral: true });
}

/* ------------------------------------------------------------------ */
/* Daily                                                              */
/* ------------------------------------------------------------------ */

async function daily(interaction: ChatInputCommandInteraction): Promise<void> {
  const userId = interaction.user.id;
  const now = Date.now();
  const data = getEconomy(userId);

  const oneDayMs = 24 * 60 * 60 * 1000;
  if (data.lastDaily && now - data.lastDaily < oneDayMs) {
    const remaining = oneDayMs - (now - data.lastDaily);
    const minutes = Math.ceil(remaining / 60000);
    await interaction.reply({ content: `You already claimed your daily. Try again in **${minutes} minute(s)**.`, ephemeral: true });
    return;
  }

  // Streak logic: claim within ~28h extends streak, otherwise reset.
  let streak = data.dailyStreak;
  if (data.lastDaily && now - data.lastDaily <= oneDayMs + 4 * 60 * 60 * 1000) {
    streak += 1;
  } else {
    streak = 1;
  }

  const bonus = Math.floor(streak / 7) * 50; // +50 per full week
  const amount = DAILY_AMOUNT + bonus;

  const updated = { ...data, balance: data.balance + amount, lastDaily: now, dailyStreak: streak };
  setEconomy(userId, updated);

  await interaction.reply({
    content: `✅ Daily claimed! You received **${amount}** coins (streak: **${streak} day(s)** + **${bonus}** bonus). New wallet balance: **${updated.balance}** coins.`,
    ephemeral: true,
  });
}

/* ------------------------------------------------------------------ */
/* Work                                                               */
/* ------------------------------------------------------------------ */

async function work(interaction: ChatInputCommandInteraction): Promise<void> {
  const userId = interaction.user.id;
  const now = Date.now();
  const data = getEconomy(userId);

  const oneHourMs = 60 * 60 * 1000;
  if (data.lastWork && now - data.lastWork < oneHourMs) {
    const remaining = oneHourMs - (now - data.lastWork);
    const minutes = Math.ceil(remaining / 60000);
    await interaction.reply({ content: `You're tired from work. Rest for **${minutes} minute(s)** first.`, ephemeral: true });
    return;
  }

  const amount = Math.floor(Math.random() * (WORK_MAX - WORK_MIN + 1)) + WORK_MIN;
  const updated = { ...data, balance: data.balance + amount, lastWork: now, totalEarned: data.totalEarned + amount };
  setEconomy(userId, updated);

  const jobs = ['delivered pizzas', 'coded a bot', 'mowed a lawn', 'wrote an article', 'tutored a student'];
  const job = jobs[Math.floor(Math.random() * jobs.length)];
  await interaction.reply({
    content: `💼 You ${job} and earned **${amount}** coins. Wallet: **${updated.balance}** coins.`,
    ephemeral: true,
  });
}

/* ------------------------------------------------------------------ */
/* Pay                                                                */
/* ------------------------------------------------------------------ */

async function pay(interaction: ChatInputCommandInteraction): Promise<void> {
  const payer = interaction.user.id;
  const targetMember = interaction.options.getMember('member');
  if (!targetMember) {
    await interaction.reply({ content: 'Member not found.', ephemeral: true });
    return;
  }
  const member = targetMember as { user: { id: string; bot: boolean; username: string } };
  const recipient = member.user.id;
  if (recipient === payer) {
    await interaction.reply({ content: 'You cannot pay yourself.', ephemeral: true });
    return;
  }
  if (member.user.bot) {
    await interaction.reply({ content: 'You cannot pay bots.', ephemeral: true });
    return;
  }

  const amount = interaction.options.getInteger('amount')!;
  const data = getEconomy(payer);
  if (data.balance < amount) {
    await interaction.reply({ content: `You only have **${data.balance}** coins — not enough to pay **${amount}**.`, ephemeral: true });
    return;
  }

  removeBalance(payer, amount);
  addBalance(recipient, amount);

  await interaction.reply({
    content: `✅ Sent **${amount}** coins to <@${recipient}>. Your wallet: **${getEconomy(payer).balance}** coins.`,
    ephemeral: true,
  });
}

/* ------------------------------------------------------------------ */
/* Shop                                                               */
/* ------------------------------------------------------------------ */

async function shop(interaction: ChatInputCommandInteraction): Promise<void> {
  const items = listShopItems();
  const embed = new EmbedBuilder().setColor(0x5865f2).setTitle('🛒 Server Shop');

  if (items.length === 0) {
    embed.setDescription('The shop is empty. Admins can add items with `/economy admin add-item`.');
  } else {
    embed.setDescription(items.map((item) => {
      const stock = item.stock === undefined ? '∞' : String(item.stock);
      return `**${item.name}** (\`${item.id}\`) — ${item.price} coins (stock: ${stock})\n  ${item.description}`;
    }).join('\n\n'));
  }

  await interaction.reply({ embeds: [embed], ephemeral: true });
}

/* ------------------------------------------------------------------ */
/* Buy                                                                */
/* ------------------------------------------------------------------ */

async function buy(interaction: ChatInputCommandInteraction): Promise<void> {
  const itemId = interaction.options.getString('item')!;
  const item = getShopItem(itemId);
  if (!item) {
    await interaction.reply({ content: `No shop item with id \`${itemId}\`.`, ephemeral: true });
    return;
  }
  if (item.stock !== undefined && item.stock <= 0) {
    await interaction.reply({ content: `**${item.name}** is out of stock.`, ephemeral: true });
    return;
  }

  const userId = interaction.user.id;
  const data = getEconomy(userId);
  if (data.balance < item.price) {
    await interaction.reply({ content: `You need **${item.price}** coins but only have **${data.balance}**.`, ephemeral: true });
    return;
  }

  removeBalance(userId, item.price);
  addInventoryItem(userId, itemId);
  if (item.stock !== undefined) {
    const current = getShopItem(itemId)!;
    addShopItem({ ...current, stock: item.stock - 1 });
  }

  await interaction.reply({ content: `✅ Purchased **${item.name}** for **${item.price}** coins!`, ephemeral: true });
}

/* ------------------------------------------------------------------ */
/* Inventory                                                          */
/* ------------------------------------------------------------------ */

async function inventory(interaction: ChatInputCommandInteraction): Promise<void> {
  const userId = interaction.user.id;
  const data = getEconomy(userId);
  const entries = Object.entries(data.inventory);

  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle(`🎒 ${interaction.user.username}'s Inventory`);

  if (entries.length === 0) {
    embed.setDescription('Your inventory is empty. Buy items from `/economy shop`.');
  } else {
    embed.setDescription(
      entries
        .map(([itemId, count]) => {
          const item = getShopItem(itemId);
          const name = item ? item.name : itemId;
          return `• **${name}** ×${count}`;
        })
        .join('\n'),
    );
  }

  await interaction.reply({ embeds: [embed], ephemeral: true });
}

/* ------------------------------------------------------------------ */
/* Admin                                                              */
/* ------------------------------------------------------------------ */

async function adminAddItem(interaction: ChatInputCommandInteraction): Promise<void> {
  const id = interaction.options.getString('id')!;
  const name = interaction.options.getString('name')!;
  const price = interaction.options.getInteger('price')!;
  const description = interaction.options.getString('description')!;

  if (getShopItem(id)) {
    await interaction.reply({ content: `Item \`${id}\` already exists.`, ephemeral: true });
    return;
  }

  addShopItem({ id, name, price, description });
  await interaction.reply({ content: `✅ Added shop item **${name}** (\`${id}\`) for **${price}** coins.`, ephemeral: true });
}

async function adminRemoveItem(interaction: ChatInputCommandInteraction): Promise<void> {
  const id = interaction.options.getString('id')!;
  if (!removeShopItem(id)) {
    await interaction.reply({ content: `No shop item with id \`${id}\`.`, ephemeral: true });
    return;
  }
  await interaction.reply({ content: `✅ Removed shop item \`${id}\`.`, ephemeral: true });
}
