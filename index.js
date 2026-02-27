require('dotenv').config();
const { Telegraf } = require('telegraf');
const fs = require('fs');
const path = require('path');

const BOT_TOKEN = process.env.BOT_TOKEN;
const CHAT_ADMIN = Number(process.env.CHAT_ADMIN);
const PAYMENT_ADMIN = Number(process.env.PAYMENT_ADMIN);

const DATA_FILE = path.join(__dirname, 'data.json');

const bot = new Telegraf(BOT_TOKEN);

// messageMap: admin_side_msg_id -> { user_id, user_side_msg_id }
const messageMap = new Map();

// State to persist
let state = {
    firstMessageDate: {}, // user_id -> timestamp
    premiumUsers: {}      // user_id -> boolean
};

// Load data from file
function loadData() {
    try {
        if (fs.existsSync(DATA_FILE)) {
            const fileData = fs.readFileSync(DATA_FILE, 'utf8');
            state = JSON.parse(fileData);
            console.log('Data loaded successfully');
        }
    } catch (e) {
        console.error('Error loading data:', e);
    }
}

// Save data to file
function saveData() {
    try {
        fs.writeFileSync(DATA_FILE, JSON.stringify(state, null, 2));
    } catch (e) {
        console.error('Error saving data:', e);
    }
}

loadData();

const TRIAL_DURATION = 3 * 24 * 60 * 60 * 1000; // 3 days in milliseconds

bot.start((ctx) => {
    ctx.reply('Привет! Напиши мне сообщение, и я передам его администратору.');
});

async function sendInvoice(ctx, targetUserId) {
    console.log(`Sending invoice (100 stars) to user: ${targetUserId}`);
    try {
        await ctx.telegram.sendInvoice(targetUserId, {
            title: '⚡️ ПРИОРИТЕТНЫЙ ЧАТ',
            description: 'Ваш пробный период (3 дня) закончился. Активируйте ПРИОРИТЕТНЫЙ РЕЖИМ за 100 звезд, чтобы продолжить общение!',
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
            const isPremium = state.premiumUsers[userId];

            // --- LIMIT LOGIC (3 DAYS TRIAL) ---
            if (!isPremium) {
                if (!state.firstMessageDate[userId]) {
                    state.firstMessageDate[userId] = Date.now();
                    saveData();
                    console.log(`User ${userId} started trial.`);
                }

                const trialStart = state.firstMessageDate[userId];
                const isOverTrial = (Date.now() - trialStart) > TRIAL_DURATION;

                if (isOverTrial) {
                    console.log(`User ${userId} trial expired. Blocking message.`);
                    ctx.reply('❌ Ваш пробный период (3 дня) завершен.');
                    await sendInvoice(ctx, userId);
                    return; // STOP HERE
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
    state.premiumUsers[userId] = true;
    saveData();

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
