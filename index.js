const { Telegraf } = require('telegraf');
const express = require('express');
const cors = require('cors');
const axios = require('axios');

// Initialize Express app
const app = express();
const PORT = process.env.PORT || 3001;

// URLs configuration
const FRONTEND_URL = 'https://cbot-phi.vercel.app';
const ADMIN_URL = 'https://coinbazar-admin.vercel.app';
const DASHBOARD_URL = 'https://cbot-phi.vercel.app';

// Middleware
app.use(cors({
    origin: [FRONTEND_URL, ADMIN_URL, 'http://localhost:5173', 'http://localhost:3000'],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
}));

app.use(express.json({ limit: '10mb' }));

// Store frontend connections
const frontendConnections = [];
const MAX_CONNECTIONS = 1000;

// --- Firebase Configuration ---
const FIREBASE_DB_URL = 'https://cbot-4baae-default-rtdb.firebaseio.com';

// --- Helper Functions ---
async function getData(path) {
  try {
    const res = await axios.get(`${FIREBASE_DB_URL}/${path}.json`);
    return res.data;
  } catch (err) {
    console.log('Firebase get error:', err.message);
    return null;
  }
}

async function setData(path, data) {
  try {
    await axios.put(`${FIREBASE_DB_URL}/${path}.json`, data);
    return true;
  } catch (err) {
    console.log('Firebase set error:', err.message);
    return false;
  }
}

async function updateData(path, data) {
  try {
    await axios.patch(`${FIREBASE_DB_URL}/${path}.json`, data);
    return true;
  } catch (err) {
    console.log('Firebase update error:', err.message);
    return false;
  }
}

// --- Database Structure Constants ---
const DEFAULT_USER_DATA = {
  coins: 0,
  balance: 0,
  keys: 0,
  diamonds: 0,
  tasksCompleted: {},
  watchedAds: {
    ad1: 0,
    ad2: 0,
    ad3: 0
  },
  directTasksClaimed: [false, false, false],
  referrals: [],
  totalEarned: 0,
  lastLogin: new Date().toISOString()
};

const REFERRAL_BONUS = 0.0015;

// --- Telegram Bot Setup ---
const BOT_TOKEN = '8335072542:AAFyTBDy0aN8Mq5U3gIhA3pE48u7kSPGSLY';
const bot = new Telegraf(BOT_TOKEN);

// --- Utility Functions ---
function generateTransactionId() {
  return 'txn_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}

function validateUserData(userData) {
  const requiredFields = ['coins', 'balance', 'keys', 'diamonds', 'tasksCompleted', 'watchedAds', 'directTasksClaimed', 'referrals', 'totalEarned'];
  
  for (const field of requiredFields) {
    if (userData[field] === undefined || userData[field] === null) {
      return false;
    }
  }
  
  // Check watchedAds structure
  if (!userData.watchedAds.ad1 || !userData.watchedAds.ad2 || !userData.watchedAds.ad3) {
    return false;
  }
  
  // Check directTasksClaimed array length
  if (!Array.isArray(userData.directTasksClaimed) || userData.directTasksClaimed.length !== 3) {
    return false;
  }
  
  return true;
}

function sanitizeUserData(userData) {
  return {
    ...DEFAULT_USER_DATA,
    ...userData,
    watchedAds: {
      ...DEFAULT_USER_DATA.watchedAds,
      ...userData.watchedAds
    },
    directTasksClaimed: Array.isArray(userData.directTasksClaimed) && userData.directTasksClaimed.length === 3 
      ? userData.directTasksClaimed 
      : DEFAULT_USER_DATA.directTasksClaimed,
    referrals: Array.isArray(userData.referrals) ? userData.referrals : DEFAULT_USER_DATA.referrals,
    tasksCompleted: typeof userData.tasksCompleted === 'object' ? userData.tasksCompleted : DEFAULT_USER_DATA.tasksCompleted
  };
}

// --- Telegram Bot Commands ---

// Start Command - Opens dashboard
bot.start(async (ctx) => {
  try {
    const messageText = ctx.message.text;
    const args = messageText.split(' ');
    const referrerId = args[1] || null;
    const currentUserId = String(ctx.from.id);

    console.log(`New user started: ${currentUserId}, referrer: ${referrerId}`);

    // Check if user exists
    let userData = await getData(`users/${currentUserId}`);
    let isNewUser = false;

    if (!userData) {
      isNewUser = true;
      // Create new user with consistent structure
      const newUserData = {
        telegramId: parseInt(currentUserId),
        username: ctx.from.username || "",
        firstName: ctx.from.first_name || "User",
        lastName: ctx.from.last_name || "",
        photoUrl: ctx.from.photo_url || "",
        joinDate: new Date().toISOString(),
        ...DEFAULT_USER_DATA
      };

      const success = await setData(`users/${currentUserId}`, newUserData);
      if (!success) {
        throw new Error('Failed to create user in database');
      }
      
      userData = newUserData;
      console.log(`Created new user: ${currentUserId}`);
    } else {
      // Sanitize existing user data
      userData = sanitizeUserData(userData);
      
      // Update last login for existing user
      await updateData(`users/${currentUserId}`, {
        lastLogin: new Date().toISOString()
      });
      
      console.log(`Updated existing user: ${currentUserId}`);
    }

    // Handle referral system
    if (referrerId && referrerId !== currentUserId && isNewUser) {
      console.log(`Processing referral: ${currentUserId} referred by ${referrerId}`);
      
      // Add to referrer's referrals list
      const referrerData = await getData(`users/${referrerId}`);
      if (referrerData) {
        const sanitizedReferrerData = sanitizeUserData(referrerData);
        const updatedReferrals = [...(sanitizedReferrerData.referrals || []), currentUserId];
        
        await updateData(`users/${referrerId}`, {
          referrals: updatedReferrals,
          balance: (sanitizedReferrerData.balance || 0) + REFERRAL_BONUS,
          totalEarned: (sanitizedReferrerData.totalEarned || 0) + REFERRAL_BONUS
        });

        // Create referral record
        await setData(`referrals/${referrerId}/${currentUserId}`, {
          referredUserId: currentUserId,
          referrerId: referrerId,
          joinedAt: new Date().toISOString(),
          bonusGiven: true,
          bonusAmount: REFERRAL_BONUS
        });

        // Notify referrer
        try {
          await ctx.telegram.sendMessage(referrerId, 
            `🎉 New referral! ${ctx.from.first_name} joined using your link. You earned $${REFERRAL_BONUS}!`, 
            { parse_mode: 'HTML' }
          );
          console.log(`Notified referrer: ${referrerId}`);
        } catch (error) {
          console.log('Could not notify referrer:', error.message);
        }
      } else {
        console.log(`Referrer ${referrerId} not found in database`);
      }
    }

    // Send dashboard message with button
    const welcomeMessage = isNewUser 
      ? `👋 <b>Welcome ${ctx.from.first_name}!</b>\n\n🎉 You're all set! Click below to start earning:`
      : `👋 <b>Welcome back ${ctx.from.first_name}!</b>\n\nClick below to continue earning:`;

    await ctx.reply(welcomeMessage, {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          [
            {
              text: '🚀 Open Dashboard',
              web_app: {
                url: DASHBOARD_URL
              }
            }
          ]
        ]
      }
    });

  } catch (error) {
    console.error('Start command error:', error);
    await ctx.reply('❌ An error occurred. Please try again.');
  }
});

// Add balance/coins command (Admin only)
bot.command('addbalance', async (ctx) => {
  try {
    // Simple admin check - you might want to implement proper admin authentication
    const args = ctx.message.text.split(' ');
    if (args.length < 4) {
      return ctx.reply('Usage: /addbalance <userId> <type> <amount>\nTypes: coins, balance, diamonds, keys');
    }

    const userId = args[1];
    const type = args[2];
    const amount = parseFloat(args[3]);
    
    if (isNaN(amount)) return ctx.reply('Invalid amount');

    const validTypes = ['coins', 'balance', 'diamonds', 'keys'];
    if (!validTypes.includes(type)) {
      return ctx.reply(`Invalid type. Use: ${validTypes.join(', ')}`);
    }

    const userData = await getData(`users/${userId}`);
    if (!userData) return ctx.reply('User not found');

    const sanitizedData = sanitizeUserData(userData);
    const currentValue = sanitizedData[type] || 0;
    
    const success = await updateData(`users/${userId}`, {
      [type]: currentValue + amount
    });

    if (success) {
      // Log the transaction
      await setData(`transactions/${generateTransactionId()}`, {
        userId: userId,
        type: 'admin_add',
        amount: amount,
        currency: type,
        adminId: ctx.from.id,
        timestamp: new Date().toISOString(),
        description: `Admin added ${amount} ${type}`
      });

      await ctx.reply(`✅ Added ${amount} ${type} to user ${userId}`);
    } else {
      await ctx.reply('❌ Failed to update user data.');
    }
  } catch (err) {
    console.error('Add balance error:', err);
    await ctx.reply('❌ Failed to add balance.');
  }
});

// User profile command
bot.command('profile', async (ctx) => {
  try {
    const userId = String(ctx.from.id);
    const userData = await getData(`users/${userId}`);

    if (!userData) {
      return ctx.reply('❌ User profile not found. Use /start first.');
    }

    const sanitizedData = sanitizeUserData(userData);
    
    const profileMessage = 
      `👤 <b>Your Profile</b>\n\n` +
      `💰 Balance: $${sanitizedData.balance.toFixed(4)}\n` +
      `🪙 Coins: ${sanitizedData.coins}\n` +
      `🔑 Keys: ${sanitizedData.keys}\n` +
      `💎 Diamonds: ${sanitizedData.diamonds}\n` +
      `📺 Ads Watched: ${sanitizedData.watchedAds.ad1 + sanitizedData.watchedAds.ad2 + sanitizedData.watchedAds.ad3}\n` +
      `👥 Referrals: ${sanitizedData.referrals.length}\n` +
      `📊 Total Earned: $${sanitizedData.totalEarned.toFixed(4)}\n` +
      `📅 Member since: ${new Date(sanitizedData.joinDate).toLocaleDateString()}`;

    await ctx.reply(profileMessage, { parse_mode: 'HTML' });
  } catch (error) {
    console.error('Profile command error:', error);
    await ctx.reply('❌ Error fetching profile.');
  }
});

// Reset user data command (Admin only - for testing)
bot.command('resetuser', async (ctx) => {
  try {
    const args = ctx.message.text.split(' ');
    const userId = args[1] || String(ctx.from.id);

    const newUserData = {
      telegramId: parseInt(userId),
      username: ctx.from.username || "",
      firstName: ctx.from.first_name || "User",
      lastName: ctx.from.last_name || "",
      photoUrl: ctx.from.photo_url || "",
      joinDate: new Date().toISOString(),
      ...DEFAULT_USER_DATA
    };

    const success = await setData(`users/${userId}`, newUserData);
    
    if (success) {
      await ctx.reply(`✅ User ${userId} data has been reset to defaults.`);
    } else {
      await ctx.reply('❌ Failed to reset user data.');
    }
  } catch (error) {
    console.error('Reset user error:', error);
    await ctx.reply('❌ Error resetting user data.');
  }
});

// --- Express Server Routes ---

// Helper function to clean old connections
function cleanOldConnections() {
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
    for (let i = frontendConnections.length - 1; i >= 0; i--) {
        const lastSeen = new Date(frontendConnections[i].lastSeen);
        if (lastSeen < fiveMinutesAgo) {
            frontendConnections.splice(i, 1);
        }
    }
}

// Update last seen for active connections
function updateConnectionLastSeen(connectionId) {
    const connection = frontendConnections.find(conn => conn.id === connectionId);
    if (connection) {
        connection.lastSeen = new Date().toISOString();
    }
}

// Root endpoint
app.get('/', (req, res) => {
    res.json({
        message: 'Telegram Bot & Tasks Backend Server is running!',
        timestamp: new Date().toISOString(),
        version: '1.0.0',
        endpoints: {
            '/api/health': 'Health check',
            '/api/user/:userId': 'Get user data',
            '/api/user/:userId/update': 'Update user data',
            '/api/users': 'Get all users (admin)',
            '/api/telegram/check-membership': 'Check Telegram channel membership',
            '/api/send-notification': 'Send notifications to all users'
        }
    });
});

// Get user data endpoint
app.get('/api/user/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const userData = await getData(`users/${userId}`);

    if (!userData) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }

    // Sanitize and validate user data
    const sanitizedData = sanitizeUserData(userData);
    
    res.json({
      success: true,
      user: sanitizedData
    });
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch user data'
    });
  }
});

// Update user data endpoint
app.post('/api/user/:userId/update', async (req, res) => {
  try {
    const { userId } = req.params;
    const updates = req.body;

    // Validate required fields
    if (!updates || typeof updates !== 'object') {
      return res.status(400).json({
        success: false,
        error: 'Invalid updates data'
      });
    }

    // Get current user data
    const currentData = await getData(`users/${userId}`);
    if (!currentData) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }

    // Sanitize current data and merge with updates
    const sanitizedData = sanitizeUserData(currentData);
    const updatedData = { ...sanitizedData, ...updates, lastLogin: new Date().toISOString() };

    // Save updated data
    const success = await setData(`users/${userId}`, updatedData);
    
    if (!success) {
      return res.status(500).json({
        success: false,
        error: 'Failed to save user data'
      });
    }

    // Log the update
    await setData(`userUpdates/${userId}/${Date.now()}`, {
      updates: updates,
      timestamp: new Date().toISOString(),
      source: 'api'
    });

    res.json({
      success: true,
      message: 'User data updated successfully',
      user: updatedData
    });
  } catch (error) {
    console.error('Update user error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update user data'
    });
  }
});

// Get all users endpoint (for admin/analytics)
app.get('/api/users', async (req, res) => {
  try {
    const users = await getData('users');
    
    if (!users) {
      return res.json({
        success: true,
        users: {},
        stats: {
          totalUsers: 0,
          totalBalance: 0,
          totalCoins: 0
        }
      });
    }

    // Calculate statistics
    let totalUsers = 0;
    let totalBalance = 0;
    let totalCoins = 0;
    let totalEarned = 0;

    Object.values(users).forEach(userData => {
      const sanitizedData = sanitizeUserData(userData);
      totalUsers++;
      totalBalance += sanitizedData.balance;
      totalCoins += sanitizedData.coins;
      totalEarned += sanitizedData.totalEarned;
    });

    res.json({
      success: true,
      users: users,
      stats: {
        totalUsers,
        totalBalance: parseFloat(totalBalance.toFixed(4)),
        totalCoins,
        totalEarned: parseFloat(totalEarned.toFixed(4))
      }
    });
  } catch (error) {
    console.error('Get users error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch users data'
    });
  }
});

// Process spin result endpoint
app.post('/api/spin/process', async (req, res) => {
  try {
    const { userId, costCoins, costKeys, prize } = req.body;

    if (!userId || costCoins === undefined || costKeys === undefined || !prize) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: userId, costCoins, costKeys, prize'
      });
    }

    const userData = await getData(`users/${userId}`);
    if (!userData) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }

    const sanitizedData = sanitizeUserData(userData);
    
    // Check if user has sufficient balance
    if (sanitizedData.coins < costCoins || sanitizedData.keys < costKeys) {
      return res.status(400).json({
        success: false,
        error: 'Insufficient balance'
      });
    }

    let updates = {
      coins: sanitizedData.coins - costCoins,
      keys: sanitizedData.keys - costKeys
    };

    // Process prize
    if (prize.includes('$')) {
      const amount = parseFloat(prize.replace('$', '').trim());
      updates.balance = sanitizedData.balance + amount;
      updates.totalEarned = sanitizedData.totalEarned + amount;
    } else if (prize.includes('Coin')) {
      const coinAmount = parseInt(prize.replace('Coin', '').trim());
      updates.coins = (sanitizedData.coins - costCoins) + coinAmount;
    } else if (prize.includes('Key')) {
      const keyAmount = parseInt(prize.replace('Key', '').trim()) || 1;
      updates.keys = (sanitizedData.keys - costKeys) + keyAmount;
    }

    // Update user data
    const success = await updateData(`users/${userId}`, updates);
    
    if (success) {
      // Log spin transaction
      await setData(`spins/${userId}/${Date.now()}`, {
        userId,
        costCoins,
        costKeys,
        prize,
        updates,
        timestamp: new Date().toISOString()
      });

      res.json({
        success: true,
        message: 'Spin processed successfully',
        updates: updates,
        newBalance: updates.balance || sanitizedData.balance,
        newCoins: updates.coins,
        newKeys: updates.keys
      });
    } else {
      res.status(500).json({
        success: false,
        error: 'Failed to update user data after spin'
      });
    }
  } catch (error) {
    console.error('Process spin error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to process spin'
    });
  }
});

// Process ad watch endpoint
app.post('/api/ads/watch', async (req, res) => {
  try {
    const { userId, adType = 'ad1', rewardCoins = 5, rewardKeys = 1 } = req.body;

    if (!userId) {
      return res.status(400).json({
        success: false,
        error: 'Missing required field: userId'
      });
    }

    const userData = await getData(`users/${userId}`);
    if (!userData) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }

    const sanitizedData = sanitizeUserData(userData);
    
    // Update watched ads count and add rewards
    const updates = {
      watchedAds: {
        ...sanitizedData.watchedAds,
        [adType]: (sanitizedData.watchedAds[adType] || 0) + 1
      },
      coins: sanitizedData.coins + rewardCoins,
      keys: sanitizedData.keys + rewardKeys
    };

    const success = await updateData(`users/${userId}`, updates);
    
    if (success) {
      // Log ad watch
      await setData(`ads/${userId}/${Date.now()}`, {
        userId,
        adType,
        rewardCoins,
        rewardKeys,
        timestamp: new Date().toISOString()
      });

      res.json({
        success: true,
        message: 'Ad watch processed successfully',
        updates: updates,
        newCoins: updates.coins,
        newKeys: updates.keys
      });
    } else {
      res.status(500).json({
        success: false,
        error: 'Failed to update user data after ad watch'
      });
    }
  } catch (error) {
    console.error('Process ad watch error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to process ad watch'
    });
  }
});

// Test endpoint
app.get('/api/test', (req, res) => {
    res.json({
        success: true,
        message: 'Server is running and connected to frontend!',
        timestamp: new Date().toISOString(),
        database: 'Connected to Firebase',
        bot: 'Telegram Bot is running'
    });
});

// Test bot token endpoint
app.post('/api/test-notification', async (req, res) => {
    try {
        const { botToken } = req.body;
        
        if (!botToken) {
            return res.status(400).json({
                success: false,
                error: 'Bot token is required for testing'
            });
        }

        // Test the bot token by getting bot info
        const testResponse = await axios.get(`https://api.telegram.org/bot${botToken}/getMe`, {
            timeout: 10000
        });

        res.json({
            success: true,
            message: 'Bot token is valid',
            botInfo: testResponse.data.result
        });

    } catch (error) {
        res.status(400).json({
            success: false,
            error: 'Invalid bot token',
            details: error.response?.data?.description || error.message
        });
    }
});

// Send notification endpoint
app.post('/api/send-notification', async (req, res) => {
    try {
        const { message, imageUrl, buttons, botToken } = req.body;

        console.log('Received notification request:', { 
            messageLength: message?.length, 
            hasImage: !!imageUrl, 
            buttonsCount: buttons?.length,
            hasBotToken: !!botToken
        });

        if (!message && !imageUrl) {
            return res.status(400).json({ 
                success: false,
                error: 'Message or image required' 
            });
        }

        // Use the provided bot token or fall back to the hardcoded one
        const tokenToUse = botToken || BOT_TOKEN;
        
        if (!tokenToUse) {
            return res.status(400).json({
                success: false,
                error: 'Bot token is required'
            });
        }

        // Fetch all users
        const users = await getData('users');
        if (!users) {
            return res.status(404).json({
                success: false,
                error: 'No users found in database'
            });
        }

        const chatIds = Object.values(users)
            .map(u => u.telegramId)
            .filter(id => id && id !== 'undefined');

        console.log(`Sending to ${chatIds.length} users`);

        // Prepare reply markup if buttons are provided
        let replyMarkup = undefined;
        if (buttons && buttons.length > 0) {
            // Filter out empty buttons
            const validButtons = buttons.filter(btn => btn.text && btn.url);
            if (validButtons.length > 0) {
                replyMarkup = {
                    inline_keyboard: [validButtons.map(b => ({ 
                        text: b.text.substring(0, 64), // Limit text length
                        url: b.url 
                    }))]
                };
            }
        }

        let successCount = 0;
        let failCount = 0;
        const errors = [];

        // Send notifications to all users with better error handling
        for (const chat_id of chatIds) {
            try {
                if (imageUrl) {
                    await axios.post(`https://api.telegram.org/bot${tokenToUse}/sendPhoto`, {
                        chat_id,
                        photo: imageUrl,
                        caption: message ? message.substring(0, 1024) : '', // Limit caption length
                        parse_mode: 'HTML',
                        reply_markup: replyMarkup
                    }, {
                        timeout: 10000
                    });
                } else {
                    await axios.post(`https://api.telegram.org/bot${tokenToUse}/sendMessage`, {
                        chat_id,
                        text: message.substring(0, 4096), // Limit message length
                        parse_mode: 'HTML',
                        reply_markup: replyMarkup,
                        disable_web_page_preview: true
                    }, {
                        timeout: 10000
                    });
                }
                successCount++;
                
                // Small delay to avoid rate limiting (10 messages per second)
                await new Promise(resolve => setTimeout(resolve, 150));
                
            } catch (err) {
                failCount++;
                const errorMsg = err.response?.data?.description || err.message;
                errors.push(`User ${chat_id}: ${errorMsg}`);
                
                // If it's a bot token error, break early
                if (err.response?.data?.error_code === 401) {
                    errors.push('INVALID_BOT_TOKEN');
                    break;
                }
            }
        }

        const result = {
            success: true,
            sentTo: successCount,
            message: `Notifications sent: ${successCount} successful, ${failCount} failed`,
            stats: {
                totalUsers: chatIds.length,
                successful: successCount,
                failed: failCount
            },
            timestamp: new Date().toISOString()
        };

        // If all failed due to bot token, return specific error
        if (successCount === 0 && errors.some(e => e.includes('INVALID_BOT_TOKEN'))) {
            return res.status(401).json({
                success: false,
                error: 'Invalid bot token. Please check your bot token in the admin panel.',
                details: 'The bot token provided is not valid or the bot has been deleted.'
            });
        }

        console.log('Notification result:', result);
        res.json(result);

    } catch (error) {
        console.error('Notification error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to send notifications',
            details: error.message
        });
    }
});

// Frontend connection registration endpoint
app.post('/api/frontend/connect', (req, res) => {
    try {
        const { timestamp, userAgent, frontendVersion, userData } = req.body;
        
        // Clean old connections first
        cleanOldConnections();
        
        const connectionId = `conn_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        const clientIp = req.ip || req.connection.remoteAddress || 'unknown';
        const origin = req.get('Origin') || 'unknown';
        
        const connectionInfo = {
            id: connectionId,
            timestamp: new Date().toISOString(),
            userAgent: userAgent || 'unknown',
            frontendVersion: frontendVersion || 'unknown',
            userData: userData || null,
            ip: clientIp,
            origin: origin,
            lastSeen: new Date().toISOString()
        };

        frontendConnections.push(connectionInfo);
        
        if (frontendConnections.length > MAX_CONNECTIONS) {
            frontendConnections.splice(0, frontendConnections.length - MAX_CONNECTIONS);
        }

        res.json({
            success: true,
            message: 'Frontend connection registered successfully',
            connectionId: connectionId,
            serverTime: new Date().toISOString()
        });

    } catch (error) {
        res.status(500).json({
            success: false,
            error: 'Internal server error'
        });
    }
});

// Function to check Telegram channel membership
async function checkTelegramChannelMembership(botToken, userId, channel) {
    try {
        const cleanChannel = channel.replace('@', '').trim();
        
        const chatIdFormats = [
            `@${cleanChannel}`,
            cleanChannel
        ];

        if (/^\d+$/.test(cleanChannel)) {
            chatIdFormats.push(`-100${cleanChannel}`);
        }

        let lastError = null;

        for (const chatId of chatIdFormats) {
            try {
                const url = `https://api.telegram.org/bot${botToken}/getChatMember`;
                
                const response = await axios.get(url, {
                    params: {
                        chat_id: chatId,
                        user_id: userId
                    },
                    timeout: 15000
                });

                if (response.data.ok) {
                    const status = response.data.result.status;
                    const isMember = ['member', 'administrator', 'creator', 'restricted'].includes(status);
                    return isMember;
                } else {
                    lastError = new Error(`Telegram API error: ${response.data.description}`);
                }
            } catch (formatError) {
                lastError = formatError;
            }
        }

        if (lastError) {
            throw lastError;
        }

        return false;

    } catch (error) {
        if (error.response?.data) {
            const telegramError = error.response.data;
            if (telegramError.error_code === 400) {
                throw new Error('User not found in channel or channel does not exist');
            } else if (telegramError.error_code === 403) {
                throw new Error('Bot is not a member of the channel or does not have permissions');
            } else if (telegramError.error_code === 404) {
                throw new Error('Channel not found or bot is not an admin');
            }
        }

        throw new Error(`Telegram API request failed: ${error.message}`);
    }
}

// Telegram membership check endpoint
app.post('/api/telegram/check-membership', async (req, res) => {
    try {
        const { userId, username, channel, connectionId, taskId, taskName } = req.body;

        if (!userId || !channel) {
            return res.status(400).json({
                success: false,
                error: 'Missing required fields: userId and channel are required'
            });
        }

        // Update connection last seen
        if (connectionId) {
            updateConnectionLastSeen(connectionId);
        }

        // Check membership using Telegram Bot API
        const isMember = await checkTelegramChannelMembership(BOT_TOKEN, userId, channel);

        res.json({
            success: true,
            isMember: isMember,
            checkedAt: new Date().toISOString(),
            userId: userId,
            channel: channel
        });

    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message || 'Failed to check Telegram membership',
            isMember: false
        });
    }
});

// Health check endpoint
app.get('/api/health', async (req, res) => {
    try {
        cleanOldConnections();

        const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
        const activeConnections = frontendConnections.filter(conn => {
            const lastSeen = new Date(conn.lastSeen);
            return lastSeen > fiveMinutesAgo;
        });

        const memoryUsage = process.memoryUsage();

        // Test database connection
        const testData = await getData('healthCheck');
        const dbStatus = testData !== null ? 'connected' : 'error';

        // Test bot status
        let botStatus = 'unknown';
        try {
            const botInfo = await axios.get(`https://api.telegram.org/bot${BOT_TOKEN}/getMe`, {
                timeout: 5000
            });
            botStatus = botInfo.data.ok ? 'running' : 'error';
        } catch (error) {
            botStatus = 'error';
        }

        const healthInfo = {
            status: 'healthy',
            timestamp: new Date().toISOString(),
            uptime: process.uptime(),
            database: dbStatus,
            telegram_bot: botStatus,
            connections: {
                total: frontendConnections.length,
                active: activeConnections.length,
                unique_users: [...new Set(frontendConnections
                    .filter(conn => conn.userData?.telegramId)
                    .map(conn => conn.userData.telegramId)
                )].length
            },
            memory: {
                rss: Math.round(memoryUsage.rss / 1024 / 1024) + ' MB',
                heapTotal: Math.round(memoryUsage.heapTotal / 1024 / 1024) + ' MB',
                heapUsed: Math.round(memoryUsage.heapUsed / 1024 / 1024) + ' MB'
            },
            environment: process.env.NODE_ENV || 'development'
        };

        res.json(healthInfo);

    } catch (error) {
        res.status(500).json({
            status: 'unhealthy',
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

// Database status endpoint
app.get('/api/database/status', async (req, res) => {
    try {
        const users = await getData('users');
        const totalUsers = users ? Object.keys(users).length : 0;
        
        let totalBalance = 0;
        let totalCoins = 0;
        
        if (users) {
            Object.values(users).forEach(user => {
                const sanitized = sanitizeUserData(user);
                totalBalance += sanitized.balance;
                totalCoins += sanitized.coins;
            });
        }

        res.json({
            success: true,
            database: 'Firebase Realtime Database',
            stats: {
                totalUsers,
                totalBalance: parseFloat(totalBalance.toFixed(4)),
                totalCoins,
                storageUsed: 'N/A' // Firebase doesn't provide this easily
            },
            collections: {
                users: true,
                referrals: true,
                transactions: true,
                spins: true,
                ads: true
            }
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: 'Failed to get database status'
        });
    }
});

// Connections statistics endpoint
app.get('/api/connections', (req, res) => {
    try {
        cleanOldConnections();

        const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
        const activeConnections = frontendConnections.filter(conn => {
            const lastSeen = new Date(conn.lastSeen);
            return lastSeen > fiveMinutesAgo;
        });

        const uniqueUsers = [...new Set(
            frontendConnections
                .filter(conn => conn.userData && conn.userData.telegramId)
                .map(conn => conn.userData.telegramId)
        )];

        const stats = {
            total_connections: frontendConnections.length,
            active_connections: activeConnections.length,
            unique_users: uniqueUsers.length,
            connection_details: {
                max_stored: MAX_CONNECTIONS,
                cleanup_interval: '5 minutes'
            },
            recent_connections: frontendConnections
                .slice(-10)
                .reverse()
                .map(conn => ({
                    id: conn.id,
                    timestamp: conn.timestamp,
                    user: conn.userData ? 
                        `@${conn.userData.username || 'unknown'} (${conn.userData.telegramId})` : 
                        'Anonymous',
                    origin: conn.origin,
                    last_seen: conn.lastSeen
                }))
        };

        res.json(stats);

    } catch (error) {
        res.status(500).json({
            error: 'Failed to get connection statistics',
            details: error.message
        });
    }
});

// Error handling middleware
app.use((error, req, res, next) => {
    console.error('Unhandled error:', error);
    res.status(500).json({
        success: false,
        error: 'Internal server error',
        message: process.env.NODE_ENV === 'development' ? error.message : 'Something went wrong'
    });
});

// 404 handler
app.use('*', (req, res) => {
    res.status(404).json({
        success: false,
        error: 'Endpoint not found',
        path: req.originalUrl,
        availableEndpoints: [
            'GET  /',
            'GET  /api/health',
            'GET  /api/user/:userId',
            'POST /api/user/:userId/update',
            'GET  /api/users',
            'POST /api/spin/process',
            'POST /api/ads/watch',
            'POST /api/telegram/check-membership',
            'POST /api/send-notification',
            'GET  /api/database/status'
        ]
    });
});

// --- Bot Error handling ---
bot.catch((err, ctx) => {
    console.error('Bot error for update', ctx.updateType, err);
});

// --- Start Server and Bot ---
const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`📱 Frontend URL: ${FRONTEND_URL}`);
    console.log(`🤖 Bot is running with token: ${BOT_TOKEN ? 'Yes' : 'No'}`);
    console.log(`📊 Dashboard URL: ${DASHBOARD_URL}`);
});

// Start the Telegram bot
bot.launch().then(() => {
    console.log('✅ Telegram Bot started successfully');
}).catch(err => {
    console.error('❌ Failed to start Telegram Bot:', err);
});

// --- Graceful shutdown ---
process.once('SIGINT', () => {
    console.log('🛑 Shutting down gracefully...');
    bot.stop('SIGINT');
    server.close(() => {
        console.log('✅ Server closed');
        process.exit(0);
    });
});

process.once('SIGTERM', () => {
    console.log('🛑 Shutting down gracefully...');
    bot.stop('SIGTERM');
    server.close(() => {
        console.log('✅ Server closed');
        process.exit(0);
    });
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
    console.error('💥 Uncaught Exception:', error);
    process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('💥 Unhandled Rejection at:', promise, 'reason:', reason);
    process.exit(1);
});

// Initial health check
setTimeout(async () => {
    try {
        const testData = await getData('healthCheck');
        if (testData === null) {
            await setData('healthCheck', { 
                status: 'ok', 
                lastChecked: new Date().toISOString() 
            });
        }
        console.log('✅ Firebase connection test passed');
    } catch (error) {
        console.error('❌ Firebase connection test failed:', error.message);
    }
}, 2000);

module.exports = app;