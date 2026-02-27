require('dotenv').config();
const { Telegraf } = require('telegraf');

const BOT_TOKEN = process.env.BOT_TOKEN;
const CHAT_ADMIN = Number(process.env.CHAT_ADMIN);
const PAYMENT_ADMIN = Number(process.env.PAYMENT_ADMIN);

const bot = new Telegraf(BOT_TOKEN);

// messageMap: admin_side_msg_id -> { user_id, user_side_msg_id }
const messageMap = new Map();

// msgCounter: user_id -> integer (count messages FROM user)
const msgCounter = new Map();

// premiumUsers: user_id -> boolean
const premiumUsers = new Map();

bot.start((ctx) => {
    ctx.reply('Привет! Напиши мне сообщение, и я передам его администратору.');
});

async function sendInvoice(ctx, targetUserId) {
    console.log(`Sending invoice (100 stars) to user: ${targetUserId}`);
    try {
        await ctx.telegram.sendInvoice(targetUserId, {
            title: '⚡️ ПРИОРИТЕТНЫЙ ЧАТ',
            description: 'Вы достигли лимита в 10 сообщений. Активируйте ПРИОРИТЕТНЫЙ РЕЖИМ за 100 звезд, чтобы продолжить общение и получить статус VIP!',
            payload: `priority_${targetUserId}`,
            currency: 'XTR',
            prices: [{ label: '100 Stars', amount: 100 }],
            provider_token: ''
        });
    } catch (e) {
        console.error('Invoice error:', e);
    }
}

bot.on('message', async (ctx) => {
    const userId = ctx.from.id;
    const messageId = ctx.message.message_id;

    // --- LOGIC FOR ADMIN ---
    if (userId === CHAT_ADMIN && ctx.message.reply_to_message) {
        const replyToId = ctx.message.reply_to_message.message_id;
        const mapping = messageMap.get(replyToId);

        if (mapping) {
            try {
                const sentToUser = await ctx.telegram.copyMessage(mapping.user_id, userId, messageId, {
                    reply_to_message_id: mapping.user_side_msg_id
                });

                messageMap.set(sentToUser.message_id, {
                    user_id: CHAT_ADMIN,
                    user_side_msg_id: messageId
                });
                console.log(`Admin replied to user ${mapping.user_id}`);
            } catch (e) {
                console.error('Admin reply error:', e);
            }
        }
        return;
    }

    // --- LOGIC FOR USERS ---
    if (userId !== CHAT_ADMIN) {
        try {
            const isPremium = premiumUsers.get(userId);

            // --- LIMIT LOGIC ---
            if (!isPremium) {
                let currentCount = (msgCounter.get(userId) || 0) + 1;

                if (currentCount > 10) {
                    console.log(`User ${userId} over limit (${currentCount}). Blocking message.`);
                    ctx.reply('❌ Лимит бесплатных сообщений исчерпан.');
                    await sendInvoice(ctx, userId);
                    return; // STOP HERE - Message is not forwarded to admin
                }

                msgCounter.set(userId, currentCount);
                console.log(`User ${userId} message count: ${currentCount}/10`);

                if (currentCount === 10) {
                    // Notify on the last free message
                    await sendInvoice(ctx, userId);
                }
            }

            // --- FORWARDING (Only if not blocked above) ---
            const prefix = isPremium ? '⚡️ [VIP ПРИОРИТЕТ]\n' : '';
            const forwarded = await ctx.telegram.forwardMessage(CHAT_ADMIN, userId, messageId);

            if (isPremium) {
                await ctx.telegram.sendMessage(CHAT_ADMIN, '🔥 ПРИОРИТЕТНОЕ СООБЩЕНИЕ 🔥', {
                    reply_to_message_id: forwarded.message_id
                });
            }

            messageMap.set(forwarded.message_id, {
                user_id: userId,
                user_side_msg_id: messageId
            });

            await ctx.telegram.sendMessage(CHAT_ADMIN, `${prefix}ID пользователя: ${userId}`);
            ctx.reply('я уже получил ваше сообщение и отвечу вам как можно скорее');

        } catch (e) {
            console.error('Forwarding error:', e);
        }
    }
});

bot.on('pre_checkout_query', (ctx) => ctx.answerPreCheckoutQuery(true));

bot.on('successful_payment', async (ctx) => {
    const userId = ctx.from.id;
    premiumUsers.set(userId, true);
    ctx.reply('⚡️ ПРИОРИТЕТ АКТИВИРОВАН! Лимиты сняты, теперь ваши сообщения будут доставляться администратору мгновенно.');

    try {
        await ctx.telegram.sendMessage(PAYMENT_ADMIN, `💎 Пользователь ${userId} КУПИЛ ПРИОРИТЕТ за 100 звезд.`);
        await ctx.telegram.sendMessage(CHAT_ADMIN, `🚀 Пользователь ${userId} теперь VIP! Больше нет лимитов.`);
    } catch (e) {
        console.error('Payment notification error:', e);
    }
});

bot.launch().then(() => console.log('Bot updated: Messages over 10 are BLOCKED until 100 stars payment.'));

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
