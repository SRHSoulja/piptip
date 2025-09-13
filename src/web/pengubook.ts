// src/web/pengubook.ts - Web PenguBook interface
import { Router, Request, Response } from "express";
import { requireAuth, getCurrentUser } from "./auth.js";
import { prisma } from "../services/db.js";
import { findOrCreateUser } from "../services/user_helpers.js";
import { getUnreadMessageCount } from "../interactions/buttons/pengubook.js";
import { getActiveTokens, formatAmount, getTokenByAddress } from "../services/token.js";
import { processTip } from "../services/tip_processor.js";
import { getDiscordClient } from "../services/discord_users.js";
import { getConfig } from "../config.js";
import { getReferralStats, createReferralCode } from "../services/referrals.js";

export const pengubookRouter = Router();

// Middleware to require authentication for all PenguBook routes
pengubookRouter.use(requireAuth);

// GET /pengubook - Main PenguBook page
pengubookRouter.get("/", async (req: Request, res: Response) => {
  try {
    const currentUser = getCurrentUser(req);
    const referralCode = req.query.ref as string;

    if (!currentUser) {
      // If there's a referral code, store it in session for after auth
      if (referralCode) {
        (req.session as any).pendingReferralCode = referralCode;
      }
      return res.redirect("/auth/discord");
    }

    const user = await findOrCreateUser(currentUser.discordId);
    const unreadCount = await getUnreadMessageCount(currentUser.discordId);

    // Process referral code if present and user just authenticated
    if (referralCode || (req.session as any).pendingReferralCode) {
      const codeToProcess = referralCode || (req.session as any).pendingReferralCode;
      if (codeToProcess) {
        const { processReferralSignup } = await import("../services/referrals.js");
        const success = await processReferralSignup(codeToProcess, currentUser.discordId);

        if (success) {
          // Clear the session referral code
          delete (req.session as any).pendingReferralCode;

          // Redirect to profile page with success message
          return res.redirect("/pengubook/profile?referred=true");
        }

        // Clear invalid referral code from session
        delete (req.session as any).pendingReferralCode;
      }
    }

    res.send(generatePenguBookHTML({
      user: currentUser,
      dbUser: user,
      unreadCount,
      page: "home"
    }));
  } catch (error) {
    console.error("PenguBook home error:", error);
    res.status(500).send("Error loading PenguBook");
  }
});

// GET /pengubook/inbox - Messages inbox
pengubookRouter.get("/inbox", async (req: Request, res: Response) => {
  try {
    const currentUser = getCurrentUser(req);
    if (!currentUser) return res.redirect("/auth/discord");

    const user = await findOrCreateUser(currentUser.discordId);
    
    // Get messages with sender info
    const messages = await prisma.penguBookMessage.findMany({
      where: { toUserId: user.id },
      include: {
        from: true,
        tip: {
          include: { Token: true }
        }
      },
      orderBy: { createdAt: 'desc' },
      take: 50
    });

    // Mark messages as read
    await prisma.penguBookMessage.updateMany({
      where: { toUserId: user.id, read: false },
      data: { read: true }
    });

    res.send(generateInboxHTML({
      user: currentUser,
      messages,
      unreadCount: 0
    }));
  } catch (error) {
    console.error("PenguBook inbox error:", error);
    res.status(500).send("Error loading inbox");
  }
});

// GET /pengubook/tip - Tipping interface
pengubookRouter.get("/browse", async (req: Request, res: Response) => {
  try {
    const currentUser = getCurrentUser(req);
    if (!currentUser) return res.redirect("/auth/discord");

    const user = await findOrCreateUser(currentUser.discordId);
    const unreadCount = await getUnreadMessageCount(currentUser.discordId);

    // Get all users who show in PenguBook (excluding current user)
    const users = await prisma.user.findMany({
      where: { 
        showInPenguBook: true,
        id: { not: user.id }
      },
      select: {
        id: true,
        discordId: true,
        bio: true,
        bioLastUpdated: true,
        bioViewCount: true,
        xUsername: true,
        socials: true,
        wins: true,
        losses: true,
        ties: true,
        createdAt: true
      },
      orderBy: { bioLastUpdated: 'desc' },
      take: 50
    });

    res.send(generateBrowseHTML({
      user: currentUser,
      users,
      unreadCount
    }));
  } catch (error) {
    console.error("PenguBook browse error:", error);
    res.status(500).send("Error loading browse page");
  }
});

// GET /pengubook/user/:discordId - View individual user profile
pengubookRouter.get("/user/:discordId", async (req: Request, res: Response) => {
  try {
    const currentUser = getCurrentUser(req);
    if (!currentUser) return res.redirect("/auth/discord");

    const targetDiscordId = req.params.discordId;
    const currentDbUser = await findOrCreateUser(currentUser.discordId);
    const unreadCount = await getUnreadMessageCount(currentUser.discordId);

    // Get target user's profile
    const targetUser = await prisma.user.findUnique({
      where: { discordId: targetDiscordId },
      select: {
        id: true,
        discordId: true,
        bio: true,
        bioLastUpdated: true,
        bioViewCount: true,
        xUsername: true,
        socials: true,
        wins: true,
        losses: true,
        ties: true,
        createdAt: true,
        showInPenguBook: true
      }
    });

    if (!targetUser || !targetUser.showInPenguBook) {
      return res.status(404).send("User not found or profile not public");
    }

    // Record profile view
    await prisma.bioBrowse.upsert({
      where: {
        viewerId_profileId: {
          viewerId: currentDbUser.id,
          profileId: targetUser.id
        }
      },
      update: {},
      create: {
        viewerId: currentDbUser.id,
        profileId: targetUser.id
      }
    });

    // Increment view count
    await prisma.user.update({
      where: { id: targetUser.id },
      data: { bioViewCount: { increment: 1 } }
    });

    // Get tokens for tipping
    const tokens = await getActiveTokens();

    // Get current user's balances
    const balances = await prisma.userBalance.findMany({
      where: { userId: currentDbUser.id },
      include: { Token: true }
    });

    // Get app config for tax rates
    const config = await getConfig();

    res.send(generateUserProfileHTML({
      user: currentUser,
      targetUser,
      tokens,
      balances,
      unreadCount,
      config
    }));
  } catch (error) {
    console.error("PenguBook user profile error:", error);
    res.status(500).send("Error loading user profile");
  }
});

// GET /pengubook/profile - Profile settings
pengubookRouter.get("/profile", async (req: Request, res: Response) => {
  try {
    const currentUser = getCurrentUser(req);
    if (!currentUser) return res.redirect("/auth/discord");

    const user = await findOrCreateUser(currentUser.discordId);
    const unreadCount = await getUnreadMessageCount(currentUser.discordId);

    // Get or create referral stats
    let referralStats;
    try {
      referralStats = await getReferralStats(currentUser.discordId);

      // Create referral code if user doesn't have one
      if (!referralStats.referralCode) {
        const newCode = await createReferralCode(currentUser.discordId);
        referralStats = await getReferralStats(currentUser.discordId); // Refresh stats
      }
    } catch (error) {
      console.error("Error getting referral stats:", error);
      referralStats = null;
    }

    res.send(generateProfileHTML({
      user: currentUser,
      dbUser: user,
      unreadCount,
      referralStats
    }));
  } catch (error) {
    console.error("PenguBook profile error:", error);
    res.status(500).send("Error loading profile");
  }
});

// API Endpoints for web PenguBook functionality

// POST /pengubook/api/tip - Process a tip from web interface
pengubookRouter.post("/api/tip", async (req: Request, res: Response) => {
  try {
    const currentUser = getCurrentUser(req);
    if (!currentUser) {
      return res.status(401).json({ success: false, error: "Not authenticated" });
    }

    const { recipient, token: tokenAddress, amount, message } = req.body;

    if (!recipient || !tokenAddress || !amount) {
      return res.status(400).json({ success: false, error: "Missing required fields" });
    }

    // Find recipient user
    const recipientUser = await findOrCreateUser(recipient);
    if (!recipientUser) {
      return res.status(404).json({ success: false, error: "Recipient not found" });
    }

    // Get token info using proper token service
    const token = await getTokenByAddress(tokenAddress);
    
    if (!token) {
      return res.status(404).json({ success: false, error: "Token not found" });
    }

    // Get Discord client
    const discordClient = getDiscordClient();
    if (!discordClient) {
      return res.status(500).json({ success: false, error: "Discord client not available" });
    }

    // Process the tip using the same logic as Discord tipping
    const tipData = {
      amount: parseFloat(amount),
      tipType: "direct" as const,
      targetUserId: recipient,
      note: message || "",
      tokenId: token.id,
      userId: currentUser.discordId,
      guildId: null, // Web tips are not guild-specific
      channelId: null, // Web tips don't have a channel
      fromPenguBook: true // Flag to indicate this came from PenguBook
    };

    const result = await processTip(tipData, discordClient);

    if (!result.success) {
      return res.status(400).json({ success: false, error: result.message });
    }

    res.json({
      success: true,
      message: result.message
    });

  } catch (error) {
    console.error("Web tip error:", error);
    res.status(500).json({ success: false, error: "Failed to process tip" });
  }
});

// POST /pengubook/api/profile - Update user profile
pengubookRouter.post("/api/profile", async (req: Request, res: Response) => {
  try {
    const currentUser = getCurrentUser(req);
    if (!currentUser) {
      return res.status(401).json({ success: false, error: "Not authenticated" });
    }

    const { bio, socials } = req.body;
    const user = await findOrCreateUser(currentUser.discordId);

    const updateData: any = {};
    
    if (bio !== undefined) {
      updateData.bio = bio.trim() || null;
    }
    
    if (socials !== undefined) {
      updateData.socials = socials.length > 0 ? JSON.stringify(socials) : null;
    }

    await prisma.user.update({
      where: { id: user.id },
      data: updateData
    });

    res.json({ success: true });

  } catch (error) {
    console.error("Profile update error:", error);
    res.status(500).json({ success: false, error: "Failed to update profile" });
  }
});

// GET /pengubook/api/balance - Get current user's balance
pengubookRouter.get("/api/balance", async (req: Request, res: Response) => {
  try {
    const currentUser = getCurrentUser(req);
    if (!currentUser) {
      return res.status(401).json({ success: false, error: "Not authenticated" });
    }

    const user = await findOrCreateUser(currentUser.discordId);
    const balances = await prisma.userBalance.findMany({
      where: { userId: user.id },
      include: { Token: true },
      orderBy: { Token: { symbol: "asc" } }
    });

    res.json({ success: true, balances });
  } catch (error) {
    console.error("Balance fetch error:", error);
    res.status(500).json({ success: false, error: "Failed to fetch balance" });
  }
});

// Helper function to generate HTML pages
function generatePenguBookHTML(data: any): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>🐧 PenguBook - Web Interface</title>
    <style>
        :root {
            color-scheme: dark;
            font-family: 'Segoe UI', system-ui, -apple-system, sans-serif;
        }
        body {
            margin: 0;
            background: linear-gradient(135deg, #0f1419 0%, #1a1f2e 100%);
            color: #e5e7eb;
            min-height: 100vh;
        }
        .header {
            background: #1f2937;
            border-bottom: 2px solid #374151;
            padding: 1rem 2rem;
            display: flex;
            justify-content: space-between;
            align-items: center;
            box-shadow: 0 4px 8px rgba(0,0,0,0.3);
        }
        .logo {
            font-size: 1.5rem;
            font-weight: bold;
            color: #60a5fa;
            text-decoration: none;
        }
        .user-info {
            display: flex;
            align-items: center;
            gap: 1rem;
        }
        .avatar {
            width: 40px;
            height: 40px;
            border-radius: 50%;
            border: 2px solid #60a5fa;
        }
        .nav {
            background: #374151;
            padding: 0.5rem 2rem;
            display: flex;
            gap: 2rem;
            border-bottom: 1px solid #4b5563;
        }
        .nav a {
            color: #d1d5db;
            text-decoration: none;
            padding: 0.5rem 1rem;
            border-radius: 0.5rem;
            transition: all 0.2s;
        }
        .nav a:hover, .nav a.active {
            background: #60a5fa;
            color: #1f2937;
        }
        .badge {
            background: #ef4444;
            color: white;
            border-radius: 50%;
            padding: 0.2rem 0.5rem;
            font-size: 0.75rem;
            margin-left: 0.5rem;
        }
        .container {
            max-width: 1200px;
            margin: 0 auto;
            padding: 2rem;
        }
        .card {
            background: rgba(31, 41, 55, 0.8);
            border-radius: 1rem;
            padding: 2rem;
            margin-bottom: 2rem;
            border: 1px solid #374151;
            box-shadow: 0 8px 32px rgba(0,0,0,0.2);
        }
        .welcome {
            text-align: center;
            background: linear-gradient(135deg, #60a5fa, #3b82f6);
            color: white;
            border: none;
        }
        .stats {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 1rem;
            margin-top: 1rem;
        }
        .stat-card {
            background: rgba(107, 114, 128, 0.1);
            border-radius: 0.5rem;
            padding: 1rem;
            text-align: center;
        }
        .stat-value {
            font-size: 2rem;
            font-weight: bold;
            color: #60a5fa;
        }
        .btn {
            background: #60a5fa;
            color: white;
            border: none;
            padding: 0.75rem 1.5rem;
            border-radius: 0.5rem;
            cursor: pointer;
            font-weight: 500;
            text-decoration: none;
            display: inline-block;
            transition: all 0.2s;
        }
        .btn:hover {
            background: #3b82f6;
        }
        .btn-secondary {
            background: #6b7280;
        }
        .btn-secondary:hover {
            background: #4b5563;
        }
        .features {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
            gap: 1.5rem;
        }
        .feature-card {
            background: rgba(31, 41, 55, 0.6);
            border-radius: 1rem;
            padding: 1.5rem;
            border: 1px solid #4b5563;
            text-align: center;
            transition: transform 0.2s;
        }
        .feature-card:hover {
            transform: translateY(-2px);
        }
        .feature-icon {
            font-size: 3rem;
            margin-bottom: 1rem;
        }
    </style>
</head>
<body>
    <div class="header">
        <a href="/pengubook" class="logo">🐧 PenguBook</a>
        <div class="user-info">
            <span>Welcome, ${data.user.username}</span>
            <img src="${data.user.avatar}" alt="Avatar" class="avatar">
            <a href="/auth/logout" class="btn btn-secondary">Logout</a>
        </div>
    </div>
    
    <nav class="nav">
        <a href="/pengubook" class="active">🏠 Home</a>
        <a href="/pengubook/inbox">📨 Inbox${data.unreadCount > 0 ? `<span class="badge">${data.unreadCount}</span>` : ''}</a>
        <a href="/pengubook/browse">👥 Browse Users</a>
        <a href="/pengubook/profile">⚙️ Profile</a>
    </nav>
    
    <div class="container">
        <div class="card welcome">
            <h1>🐧 Welcome to PenguBook Web!</h1>
            <p>Your crypto tipping companion is now available on the web. Send tips, manage your profile, and stay connected with your community!</p>
        </div>
        
        <div class="features">
            <div class="feature-card">
                <div class="feature-icon">💸</div>
                <h3>Send Tips</h3>
                <p>Tip users across your servers with our multi-token support</p>
                <a href="/pengubook/tip" class="btn">Start Tipping</a>
            </div>
            
            <div class="feature-card">
                <div class="feature-icon">📨</div>
                <h3>Message Center</h3>
                <p>View your tip notifications and messages in one place</p>
                <a href="/pengubook/inbox" class="btn">View Messages</a>
            </div>
            
            <div class="feature-card">
                <div class="feature-icon">⚙️</div>
                <h3>Profile Settings</h3>
                <p>Manage your bio, social links, and preferences</p>
                <a href="/pengubook/profile" class="btn">Edit Profile</a>
            </div>
        </div>
        
        ${data.dbUser?.bio ? `
        <div class="card">
            <h2>Your Bio</h2>
            <p>${data.dbUser.bio}</p>
            ${data.dbUser.socials ? `
            <div style="margin-top: 1rem;">
                <strong>Social Links:</strong>
                <div style="margin-top: 0.5rem;">
                    ${JSON.parse(data.dbUser.socials).map((social: any) => 
                        `<a href="${social.url}" target="_blank" style="color: #60a5fa; margin-right: 1rem;">${social.platform}</a>`
                    ).join('')}
                </div>
            </div>
            ` : ''}
        </div>
        ` : ''}
        
    </div>
</body>
</html>`;
}

function generateInboxHTML(data: any): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>📨 Inbox - PenguBook</title>
    <style>
        /* Same base styles as above */
        :root { color-scheme: dark; font-family: 'Segoe UI', system-ui, -apple-system, sans-serif; }
        body { margin: 0; background: linear-gradient(135deg, #0f1419 0%, #1a1f2e 100%); color: #e5e7eb; min-height: 100vh; }
        .header { background: #1f2937; border-bottom: 2px solid #374151; padding: 1rem 2rem; display: flex; justify-content: space-between; align-items: center; }
        .logo { font-size: 1.5rem; font-weight: bold; color: #60a5fa; text-decoration: none; }
        .user-info { display: flex; align-items: center; gap: 1rem; }
        .avatar { width: 40px; height: 40px; border-radius: 50%; border: 2px solid #60a5fa; }
        .nav { background: #374151; padding: 0.5rem 2rem; display: flex; gap: 2rem; }
        .nav a { color: #d1d5db; text-decoration: none; padding: 0.5rem 1rem; border-radius: 0.5rem; transition: all 0.2s; }
        .nav a:hover, .nav a.active { background: #60a5fa; color: #1f2937; }
        .container { max-width: 1200px; margin: 0 auto; padding: 2rem; }
        .btn-secondary { background: #6b7280; color: white; border: none; padding: 0.5rem 1rem; border-radius: 0.5rem; text-decoration: none; }
        .message { background: #1f2937; border-radius: 0.5rem; padding: 1rem; margin-bottom: 1rem; border-left: 4px solid #60a5fa; }
        .message.tip { border-left-color: #10b981; }
        .message-header { display: flex; justify-content: between; align-items: center; margin-bottom: 0.5rem; }
        .message-sender { font-weight: bold; color: #60a5fa; }
        .message-time { color: #9ca3af; font-size: 0.875rem; }
        .message-content { line-height: 1.5; }
        .tip-amount { color: #10b981; font-weight: bold; }
    </style>
</head>
<body>
    <div class="header">
        <a href="/pengubook" class="logo">🐧 PenguBook</a>
        <div class="user-info">
            <span>Welcome, ${data.user.username}</span>
            <img src="${data.user.avatar}" alt="Avatar" class="avatar">
            <a href="/auth/logout" class="btn-secondary">Logout</a>
        </div>
    </div>
    
    <nav class="nav">
        <a href="/pengubook">🏠 Home</a>
        <a href="/pengubook/inbox" class="active">📨 Inbox</a>
        <a href="/pengubook/browse">👥 Browse Users</a>
        <a href="/pengubook/profile">⚙️ Profile</a>
    </nav>
    
    <div class="container">
        <h1>📨 Your Messages</h1>
        
        ${data.messages.length === 0 ? `
        <div style="text-align: center; padding: 2rem; color: #9ca3af;">
            <div style="font-size: 4rem; margin-bottom: 1rem;">📭</div>
            <h2>No messages yet</h2>
            <p>Your tip notifications and messages will appear here!</p>
        </div>
        ` : data.messages.map((msg: any) => `
        <div class="message ${msg.tip ? 'tip' : ''}">
            <div class="message-header">
                <span class="message-sender">${msg.from.discordId === msg.from.id ? 'System' : `User#${msg.from.discordId.slice(-4)}`}</span>
                <span class="message-time">${new Date(msg.createdAt).toLocaleString()}</span>
            </div>
            <div class="message-content">
                ${msg.tip ? `
                <div class="tip-amount">💰 Received ${msg.tip.amountAtomic / Math.pow(10, msg.tip.Token.decimals)} ${msg.tip.Token.symbol}</div>
                ` : ''}
                ${msg.message}
            </div>
        </div>
        `).join('')}
    </div>
</body>
</html>`;
}

function generateBrowseHTML(data: any): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>👥 Browse Users - PenguBook</title>
    <style>
        /* Same base styles */
        :root { color-scheme: dark; font-family: 'Segoe UI', system-ui, -apple-system, sans-serif; }
        body { margin: 0; background: linear-gradient(135deg, #0f1419 0%, #1a1f2e 100%); color: #e5e7eb; min-height: 100vh; }
        .header { background: #1f2937; border-bottom: 2px solid #374151; padding: 1rem 2rem; display: flex; justify-content: space-between; align-items: center; }
        .logo { font-size: 1.5rem; font-weight: bold; color: #60a5fa; text-decoration: none; }
        .user-info { display: flex; align-items: center; gap: 1rem; }
        .avatar { width: 40px; height: 40px; border-radius: 50%; border: 2px solid #60a5fa; }
        .nav { background: #374151; padding: 0.5rem 2rem; display: flex; gap: 2rem; }
        .nav a { color: #d1d5db; text-decoration: none; padding: 0.5rem 1rem; border-radius: 0.5rem; transition: all 0.2s; }
        .nav a:hover, .nav a.active { background: #60a5fa; color: #1f2937; }
        .container { max-width: 1200px; margin: 0 auto; padding: 2rem; }
        .btn-secondary { background: #6b7280; color: white; border: none; padding: 0.5rem 1rem; border-radius: 0.5rem; text-decoration: none; }
        .user-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 1.5rem; }
        .user-card { background: #1f2937; border-radius: 0.75rem; padding: 1.5rem; border: 1px solid #374151; transition: all 0.2s; }
        .user-card:hover { border-color: #60a5fa; transform: translateY(-2px); }
        .user-header { display: flex; align-items: center; gap: 1rem; margin-bottom: 1rem; }
        .user-avatar { width: 50px; height: 50px; border-radius: 50%; border: 2px solid #60a5fa; }
        .user-name { font-weight: bold; font-size: 1.1rem; }
        .user-stats { display: flex; gap: 1rem; margin: 1rem 0; }
        .stat { background: #374151; padding: 0.5rem; border-radius: 0.5rem; text-align: center; flex: 1; }
        .stat-value { font-weight: bold; color: #60a5fa; }
        .stat-label { font-size: 0.8rem; color: #9ca3af; }
        .user-bio { color: #d1d5db; margin: 1rem 0; min-height: 2.5rem; }
        .social-links { display: flex; gap: 0.5rem; margin: 1rem 0; }
        .social-link { background: #374151; color: #60a5fa; text-decoration: none; padding: 0.25rem 0.5rem; border-radius: 0.25rem; font-size: 0.8rem; }
        .view-profile-btn { background: #60a5fa; color: white; text-decoration: none; padding: 0.75rem 1rem; border-radius: 0.5rem; display: inline-block; width: 100%; text-align: center; font-weight: 500; }
        .view-profile-btn:hover { background: #3b82f6; }
        .empty-state { text-align: center; color: #9ca3af; padding: 3rem; }
    </style>
</head>
<body>
    <div class="header">
        <a href="/pengubook" class="logo">🐧 PenguBook</a>
        <div class="user-info">
            <span>Welcome, ${data.user.username}</span>
            <img src="${data.user.avatar}" alt="Avatar" class="avatar">
            <a href="/auth/logout" class="btn-secondary">Logout</a>
        </div>
    </div>
    
    <nav class="nav">
        <a href="/pengubook">🏠 Home</a>
        <a href="/pengubook/inbox">📨 Inbox${data.unreadCount > 0 ? `<span class="badge">${data.unreadCount}</span>` : ''}</a>
        <a href="/pengubook/browse" class="active">👥 Browse Users</a>
        <a href="/pengubook/profile">⚙️ Profile</a>
    </nav>
    
    <div class="container">
        <h1>👥 Browse PenguBook Users</h1>
        
        ${data.users.length === 0 ? `
        <div class="empty-state">
            <h2>No users found</h2>
            <p>No users have set up their PenguBook profiles yet.</p>
        </div>
        ` : `
        <div class="user-grid">
            ${data.users.map((user: any) => {
              const socials = user.socials ? JSON.parse(user.socials) : [];
              const winRate = user.wins + user.losses > 0 ? ((user.wins / (user.wins + user.losses)) * 100).toFixed(1) : 'N/A';
              
              return `
              <div class="user-card">
                  <div class="user-header">
                      <img src="https://cdn.discordapp.com/embed/avatars/${parseInt(user.discordId.slice(-1)) % 6}.png" 
                           alt="Avatar" class="user-avatar" id="avatar-${user.discordId}">
                      <div>
                          <div class="user-name" id="username-${user.discordId}">User#${user.discordId.slice(-4)}</div>
                          <div style="color: #9ca3af; font-size: 0.9rem;">${user.bioViewCount} views</div>
                      </div>
                  </div>
                  
                  <div class="user-stats">
                      <div class="stat">
                          <div class="stat-value">${user.wins}</div>
                          <div class="stat-label">Wins</div>
                      </div>
                      <div class="stat">
                          <div class="stat-value">${user.losses}</div>
                          <div class="stat-label">Losses</div>
                      </div>
                      <div class="stat">
                          <div class="stat-value">${winRate}%</div>
                          <div class="stat-label">Win Rate</div>
                      </div>
                  </div>
                  
                  <div class="user-bio">${user.bio || 'No bio yet...'}</div>
                  
                  ${socials.length > 0 ? `
                  <div class="social-links">
                      ${socials.map((social: any) => `
                      <a href="${social.url}" target="_blank" class="social-link">${social.platform}</a>
                      `).join('')}
                  </div>
                  ` : ''}
                  
                  <a href="/pengubook/user/${user.discordId}" class="view-profile-btn">View Profile & Tip</a>
              </div>
              `;
            }).join('')}
        </div>
        `}
    </div>
    
    <script>
        // Load Discord usernames and avatars
        ${data.users.map((user: any) => `
        fetch('/pengubook/api/discord-user/${user.discordId}')
            .then(res => res.json())
            .then(data => {
                if (data.success) {
                    document.getElementById('username-${user.discordId}').textContent = data.username;
                    document.getElementById('avatar-${user.discordId}').src = data.avatarURL;
                }
            }).catch(() => {});
        `).join('')}
    </script>
</body>
</html>`;
}

function generateUserProfileHTML(data: any): string {
  const socials = data.targetUser.socials ? JSON.parse(data.targetUser.socials) : [];
  const winRate = data.targetUser.wins + data.targetUser.losses > 0 ? 
    ((data.targetUser.wins / (data.targetUser.wins + data.targetUser.losses)) * 100).toFixed(1) : 'N/A';

  return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Profile - PenguBook</title>
    <style>
        /* Same base styles */
        :root { color-scheme: dark; font-family: 'Segoe UI', system-ui, -apple-system, sans-serif; }
        body { margin: 0; background: linear-gradient(135deg, #0f1419 0%, #1a1f2e 100%); color: #e5e7eb; min-height: 100vh; }
        .header { background: #1f2937; border-bottom: 2px solid #374151; padding: 1rem 2rem; display: flex; justify-content: space-between; align-items: center; }
        .logo { font-size: 1.5rem; font-weight: bold; color: #60a5fa; text-decoration: none; }
        .user-info { display: flex; align-items: center; gap: 1rem; }
        .avatar { width: 40px; height: 40px; border-radius: 50%; border: 2px solid #60a5fa; }
        .nav { background: #374151; padding: 0.5rem 2rem; display: flex; gap: 2rem; }
        .nav a { color: #d1d5db; text-decoration: none; padding: 0.5rem 1rem; border-radius: 0.5rem; transition: all 0.2s; }
        .nav a:hover, .nav a.active { background: #60a5fa; color: #1f2937; }
        .container { max-width: 1000px; margin: 0 auto; padding: 2rem; }
        .btn-secondary { background: #6b7280; color: white; border: none; padding: 0.5rem 1rem; border-radius: 0.5rem; text-decoration: none; }
        .profile-header { display: flex; gap: 2rem; margin-bottom: 2rem; }
        .profile-avatar { width: 120px; height: 120px; border-radius: 50%; border: 3px solid #60a5fa; }
        .profile-info { flex: 1; }
        .profile-name { font-size: 2rem; font-weight: bold; margin-bottom: 0.5rem; }
        .profile-stats { display: flex; gap: 1rem; margin: 1rem 0; }
        .stat { background: #1f2937; padding: 1rem; border-radius: 0.5rem; text-align: center; flex: 1; }
        .stat-value { font-weight: bold; color: #60a5fa; font-size: 1.5rem; }
        .stat-label { color: #9ca3af; margin-top: 0.25rem; }
        .profile-bio { background: #1f2937; padding: 1.5rem; border-radius: 0.75rem; margin: 1rem 0; }
        .social-links { display: flex; gap: 1rem; margin: 1rem 0; }
        .social-link { background: #374151; color: #60a5fa; text-decoration: none; padding: 0.5rem 1rem; border-radius: 0.5rem; font-weight: 500; }
        .social-link:hover { background: #60a5fa; color: white; }
        .tip-section { background: #1f2937; padding: 1.5rem; border-radius: 0.75rem; margin-top: 2rem; }
        .form-group { margin-bottom: 1rem; }
        .form-group label { display: block; margin-bottom: 0.5rem; color: #d1d5db; }
        .form-group input, .form-group select, .form-group textarea { 
            width: 100%; padding: 0.75rem; border-radius: 0.5rem; border: 1px solid #4b5563; 
            background: #374151; color: #e5e7eb; font-size: 1rem;
        }
        .btn { background: #60a5fa; color: white; border: none; padding: 0.75rem 1.5rem; border-radius: 0.5rem; cursor: pointer; font-weight: 500; }
        .btn:hover { background: #3b82f6; }
        .balance-card { background: #374151; border-radius: 0.5rem; padding: 1rem; margin-bottom: 1rem; }
        .balance-amount { color: #10b981; font-weight: bold; font-size: 1.25rem; }
        .back-btn { background: #6b7280; color: white; text-decoration: none; padding: 0.5rem 1rem; border-radius: 0.5rem; margin-bottom: 1rem; display: inline-block; }
    </style>
</head>
<body>
    <div class="header">
        <a href="/pengubook" class="logo">🐧 PenguBook</a>
        <div class="user-info">
            <span>Welcome, ${data.user.username}</span>
            <img src="${data.user.avatar}" alt="Avatar" class="avatar">
            <a href="/auth/logout" class="btn-secondary">Logout</a>
        </div>
    </div>
    
    <nav class="nav">
        <a href="/pengubook">🏠 Home</a>
        <a href="/pengubook/inbox">📨 Inbox${data.unreadCount > 0 ? `<span class="badge">${data.unreadCount}</span>` : ''}</a>
        <a href="/pengubook/browse">👥 Browse Users</a>
        <a href="/pengubook/profile">⚙️ Profile</a>
    </nav>
    
    <div class="container">
        <a href="/pengubook/browse" class="back-btn">← Back to Browse</a>
        
        <div class="profile-header">
            <img src="https://cdn.discordapp.com/embed/avatars/${parseInt(data.targetUser.discordId.slice(-1)) % 6}.png" 
                 alt="Profile Avatar" class="profile-avatar" id="profileAvatar">
            <div class="profile-info">
                <div class="profile-name" id="profileName">User#${data.targetUser.discordId.slice(-4)}</div>
                <div style="color: #9ca3af;">👀 ${data.targetUser.bioViewCount} profile views</div>
                
                <div class="profile-stats">
                    <div class="stat">
                        <div class="stat-value">${data.targetUser.wins}</div>
                        <div class="stat-label">Wins</div>
                    </div>
                    <div class="stat">
                        <div class="stat-value">${data.targetUser.losses}</div>
                        <div class="stat-label">Losses</div>
                    </div>
                    <div class="stat">
                        <div class="stat-value">${data.targetUser.ties}</div>
                        <div class="stat-label">Ties</div>
                    </div>
                    <div class="stat">
                        <div class="stat-value">${winRate}%</div>
                        <div class="stat-label">Win Rate</div>
                    </div>
                </div>
                
                ${socials.length > 0 ? `
                <div class="social-links">
                    ${socials.map((social: any) => `
                    <a href="${social.url}" target="_blank" class="social-link">${social.platform}</a>
                    `).join('')}
                </div>
                ` : ''}
            </div>
        </div>
        
        ${data.targetUser.bio ? `
        <div class="profile-bio">
            <h3>About Me</h3>
            <p>${data.targetUser.bio}</p>
        </div>
        ` : `
        <div class="profile-bio">
            <h3>About Me</h3>
            <p style="color: #9ca3af; font-style: italic;">This user hasn't written a bio yet.</p>
        </div>
        `}
        
        <div class="tip-section">
            <h3>💸 Send a Tip</h3>
            
            <div style="margin-bottom: 2rem;">
                <h4>Your Balances</h4>
                ${data.balances.map((balance: any) => `
                <div class="balance-card">
                    <div>${balance.Token.symbol}</div>
                    <div class="balance-amount">${Number(balance.amount).toFixed(2).replace(/\.?0+$/, '')}</div>
                </div>
                `).join('')}
            </div>
            
            <form id="tipForm">
                <div class="form-group">
                    <label>Token</label>
                    <select id="token" required>
                        <option value="">Select a token</option>
                        ${data.tokens.map((token: any) => `
                        <option value="${token.address}">${token.symbol}</option>
                        `).join('')}
                    </select>
                </div>
                
                <div class="form-group">
                    <label>Amount</label>
                    <input type="number" id="amount" step="0.000000001" placeholder="0.0" required>
                </div>
                
                <div class="form-group">
                    <label>Message (optional)</label>
                    <textarea id="message" placeholder="Say something nice..." rows="3"></textarea>
                </div>

                <!-- Tax Preview Section -->
                <div id="taxPreview" style="background: rgba(96, 165, 250, 0.1); border: 1px solid #60a5fa; border-radius: 0.5rem; padding: 1rem; margin: 1rem 0; display: none;">
                    <h4 style="color: #60a5fa; margin: 0 0 0.5rem 0;">💸 Tip Preview</h4>
                    <div style="display: flex; justify-content: space-between; margin-bottom: 0.5rem;">
                        <span>Tip Amount:</span>
                        <span id="previewAmount">-</span>
                    </div>
                    <div style="display: flex; justify-content: space-between; margin-bottom: 0.5rem;">
                        <span>Tax Fee:</span>
                        <span id="previewTax">-</span>
                    </div>
                    <div style="display: flex; justify-content: space-between; border-top: 1px solid #60a5fa; padding-top: 0.5rem; font-weight: bold;">
                        <span>Total Deducted:</span>
                        <span id="previewTotal" style="color: #60a5fa;">-</span>
                    </div>
                </div>

                <button type="submit" class="btn">Send Tip</button>
            </form>
            
            <div id="result" style="margin-top: 1rem;"></div>
        </div>
    </div>
    
    <script>
        // Load Discord username and avatar
        fetch('/pengubook/api/discord-user/${data.targetUser.discordId}')
            .then(res => res.json())
            .then(data => {
                if (data.success) {
                    document.getElementById('profileName').textContent = data.username;
                    document.getElementById('profileAvatar').src = data.avatarURL;
                }
            }).catch(() => {});

        // Tax calculation preview functionality
        const tokenSelect = document.getElementById('token');
        const amountInput = document.getElementById('amount');
        const taxPreview = document.getElementById('taxPreview');
        const previewAmount = document.getElementById('previewAmount');
        const previewTax = document.getElementById('previewTax');
        const previewTotal = document.getElementById('previewTotal');

        async function updateTaxPreview() {
            const selectedTokenAddress = tokenSelect.value;
            const amount = parseFloat(amountInput.value);

            if (!selectedTokenAddress || !amount || amount <= 0) {
                taxPreview.style.display = 'none';
                return;
            }

            try {
                // Find selected token info
                const tokens = ${JSON.stringify(data.tokens)};
                const selectedToken = tokens.find(t => t.address === selectedTokenAddress);

                if (!selectedToken) return;

                // Get actual tax rate from server config (basis points to percentage)
                const config = ${JSON.stringify(data.config)};
                const taxBps = selectedToken.tipFeeBps || config.tipFeeBps || 100; // Default 100 BPS = 1%
                const taxRate = taxBps / 10000; // Convert basis points to decimal (100 BPS = 0.01 = 1%)
                const taxAmount = amount * taxRate;
                const totalDeducted = amount + taxAmount;

                // Update preview display
                previewAmount.textContent = amount.toFixed(2) + ' ' + selectedToken.symbol;
                previewTax.textContent = taxAmount.toFixed(2) + ' ' + selectedToken.symbol;
                previewTotal.textContent = totalDeducted.toFixed(2) + ' ' + selectedToken.symbol;

                taxPreview.style.display = 'block';

            } catch (error) {
                console.error('Error calculating tax preview:', error);
                taxPreview.style.display = 'none';
            }
        }

        // Add event listeners for real-time preview updates
        tokenSelect.addEventListener('change', updateTaxPreview);
        amountInput.addEventListener('input', updateTaxPreview);

        document.getElementById('tipForm').addEventListener('submit', async (e) => {
            e.preventDefault();
            const result = document.getElementById('result');
            result.innerHTML = 'Processing tip...';
            result.style.color = '#60a5fa';
            
            try {
                const formData = {
                    recipient: '${data.targetUser.discordId}',
                    token: document.getElementById('token').value,
                    amount: document.getElementById('amount').value,
                    message: document.getElementById('message').value
                };
                
                const response = await fetch('/pengubook/api/tip', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(formData)
                });
                
                const data = await response.json();
                
                if (data.success) {
                    result.innerHTML = '✅ Tip sent successfully!';
                    result.style.color = '#10b981';
                    document.getElementById('tipForm').reset();
                    taxPreview.style.display = 'none'; // Hide tax preview after reset

                    // Refresh balance display
                    await refreshBalance();
                } else {
                    result.innerHTML = '❌ ' + (data.error || 'Failed to send tip');
                    result.style.color = '#ef4444';
                }
            } catch (error) {
                result.innerHTML = '❌ Network error';
                result.style.color = '#ef4444';
            }
        });

        async function refreshBalance() {
            try {
                const response = await fetch('/pengubook/api/balance');
                if (response.ok) {
                    const data = await response.json();
                    // Update balance display by finding and replacing existing balance cards
                    const existingCards = document.querySelectorAll('.balance-card');

                    if (existingCards.length > 0 && data.balances) {
                        // Create a map of current balances for easy lookup
                        const balanceMap = new Map();
                        data.balances.forEach(balance => {
                            balanceMap.set(balance.Token.symbol, balance);
                        });

                        // Update existing cards or remove them if token no longer exists
                        existingCards.forEach(card => {
                            const symbolDiv = card.querySelector('div:first-child');
                            const amountDiv = card.querySelector('.balance-amount');

                            if (symbolDiv && amountDiv) {
                                const symbol = symbolDiv.textContent;
                                const balance = balanceMap.get(symbol);

                                if (balance) {
                                    // Update the amount
                                    const amount = Number(balance.amount).toFixed(2).replace(/\\.?0+$/, '');
                                    amountDiv.textContent = amount;
                                    balanceMap.delete(symbol); // Mark as processed
                                } else {
                                    // Token no longer exists, remove the card
                                    card.remove();
                                }
                            }
                        });

                        // Add any new tokens that weren't in the existing cards
                        const balanceContainer = document.querySelector('.balance-card')?.parentElement;
                        if (balanceContainer) {
                            balanceMap.forEach(balance => {
                                const amount = Number(balance.amount).toFixed(2).replace(/\\.?0+$/, '');
                                const balanceCard = document.createElement('div');
                                balanceCard.className = 'balance-card';
                                balanceCard.innerHTML = \`
                                    <div>\${balance.Token.symbol}</div>
                                    <div class="balance-amount">\${amount}</div>
                                \`;
                                balanceContainer.appendChild(balanceCard);
                            });
                        }
                    }
                } else {
                    console.error('Failed to fetch updated balance:', response.status);
                }
            } catch (error) {
                console.error('Failed to refresh balance:', error);
            }
        }
    </script>
</body>
</html>`;
}

function generateProfileHTML(data: any): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>⚙️ Profile - PenguBook</title>
    <style>
        /* Same base styles */
        :root { color-scheme: dark; font-family: 'Segoe UI', system-ui, -apple-system, sans-serif; }
        body { margin: 0; background: linear-gradient(135deg, #0f1419 0%, #1a1f2e 100%); color: #e5e7eb; min-height: 100vh; }
        .header { background: #1f2937; border-bottom: 2px solid #374151; padding: 1rem 2rem; display: flex; justify-content: space-between; align-items: center; }
        .logo { font-size: 1.5rem; font-weight: bold; color: #60a5fa; text-decoration: none; }
        .user-info { display: flex; align-items: center; gap: 1rem; }
        .avatar { width: 40px; height: 40px; border-radius: 50%; border: 2px solid #60a5fa; }
        .nav { background: #374151; padding: 0.5rem 2rem; display: flex; gap: 2rem; }
        .nav a { color: #d1d5db; text-decoration: none; padding: 0.5rem 1rem; border-radius: 0.5rem; transition: all 0.2s; }
        .nav a:hover, .nav a.active { background: #60a5fa; color: #1f2937; }
        .container { max-width: 800px; margin: 0 auto; padding: 2rem; }
        .btn-secondary { background: #6b7280; color: white; border: none; padding: 0.5rem 1rem; border-radius: 0.5rem; text-decoration: none; }
        .form-group { margin-bottom: 1rem; }
        .form-group label { display: block; margin-bottom: 0.5rem; color: #d1d5db; }
        .form-group input, .form-group select, .form-group textarea { 
            width: 100%; padding: 0.75rem; border-radius: 0.5rem; border: 1px solid #4b5563; 
            background: #374151; color: #e5e7eb; font-size: 1rem;
        }
        .btn { background: #60a5fa; color: white; border: none; padding: 0.75rem 1.5rem; border-radius: 0.5rem; cursor: pointer; font-weight: 500; }
        .btn:hover { background: #3b82f6; }
        .card { background: #1f2937; border-radius: 1rem; padding: 2rem; margin-bottom: 1rem; border: 1px solid #374151; }
    </style>
</head>
<body>
    <div class="header">
        <a href="/pengubook" class="logo">🐧 PenguBook</a>
        <div class="user-info">
            <span>Welcome, ${data.user.username}</span>
            <img src="${data.user.avatar}" alt="Avatar" class="avatar">
            <a href="/auth/logout" class="btn-secondary">Logout</a>
        </div>
    </div>
    
    <nav class="nav">
        <a href="/pengubook">🏠 Home</a>
        <a href="/pengubook/inbox">📨 Inbox</a>
        <a href="/pengubook/browse">👥 Browse Users</a>
        <a href="/pengubook/profile" class="active">⚙️ Profile</a>
    </nav>
    
    <div class="container">
        <h1>⚙️ Your Profile</h1>
        
        <div class="card">
            <h2>Bio</h2>
            <form id="bioForm">
                <div class="form-group">
                    <label>About You</label>
                    <textarea id="bio" rows="4" placeholder="Tell everyone about yourself...">${data.dbUser?.bio || ''}</textarea>
                </div>
                <button type="submit" class="btn">Update Bio</button>
            </form>
        </div>
        
        <div class="card">
            <h2>Social Links</h2>
            <form id="socialsForm">
                <div id="socialLinks">
                    ${data.dbUser?.socials ? JSON.parse(data.dbUser.socials).map((social: any, index: number) => `
                    <div class="social-link" style="display: flex; gap: 1rem; margin-bottom: 1rem;">
                        <select name="platform_${index}" style="flex: 0 0 120px;">
                            <option value="Twitter" ${social.platform === 'Twitter' ? 'selected' : ''}>Twitter</option>
                            <option value="GitHub" ${social.platform === 'GitHub' ? 'selected' : ''}>GitHub</option>
                            <option value="Discord" ${social.platform === 'Discord' ? 'selected' : ''}>Discord</option>
                            <option value="Website" ${social.platform === 'Website' ? 'selected' : ''}>Website</option>
                        </select>
                        <input type="url" name="url_${index}" placeholder="https://..." value="${social.url}" style="flex: 1;">
                        <button type="button" onclick="removeSocial(this)" style="background: #ef4444;">Remove</button>
                    </div>
                    `).join('') : ''}
                </div>
                <button type="button" onclick="addSocial()" class="btn btn-secondary">Add Social Link</button>
                <button type="submit" class="btn">Update Links</button>
            </form>
        </div>

        ${data.referralStats ? `
        <div class="card">
            <h2>🎁 Referral System</h2>
            <p>Invite friends to PenguBook and reduce your tip taxes! Every 10 verified referrals earns you 1 week of tax-free tipping.</p>

            <div style="background: rgba(16, 185, 129, 0.1); border: 1px solid #10b981; border-radius: 0.5rem; padding: 1rem; margin: 1rem 0;">
                <h3 style="color: #10b981; margin: 0 0 1rem 0;">📊 Your Referral Stats</h3>
                <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 1rem;">
                    <div style="text-align: center;">
                        <div style="font-size: 2rem; color: #10b981; font-weight: bold;">${data.referralStats.verifiedReferrals}</div>
                        <div style="color: #6b7280;">Verified Referrals</div>
                    </div>
                    <div style="text-align: center;">
                        <div style="font-size: 2rem; color: #60a5fa; font-weight: bold;">${data.referralStats.totalReferrals}</div>
                        <div style="color: #6b7280;">Total Referrals</div>
                    </div>
                    <div style="text-align: center;">
                        <div style="font-size: 2rem; color: #f59e0b; font-weight: bold;">${data.referralStats.taxFreeWeeksEarned}</div>
                        <div style="color: #6b7280;">Tax-Free Weeks Earned</div>
                    </div>
                    <div style="text-align: center;">
                        <div style="font-size: 2rem; color: #ef4444; font-weight: bold;">${data.referralStats.referralsUntilTaxFree}</div>
                        <div style="color: #6b7280;">Until Next Tax-Free Week</div>
                    </div>
                </div>
            </div>

            <div style="background: rgba(96, 165, 250, 0.1); border: 1px solid #60a5fa; border-radius: 0.5rem; padding: 1rem; margin: 1rem 0;">
                <h3 style="color: #60a5fa; margin: 0 0 1rem 0;">🔗 Your Referral Link</h3>
                <div style="display: flex; gap: 1rem; align-items: center;">
                    <input type="text" id="referralLink" readonly
                           value="${data.referralStats.referralCode ? `${process.env.PUBLIC_BASE_URL || 'https://your-domain.com'}/pengubook?ref=${data.referralStats.referralCode}` : 'Generating...'}"
                           style="flex: 1; padding: 0.75rem; border-radius: 0.5rem; border: 1px solid #4b5563; background: #374151; color: #e5e7eb;">
                    <button onclick="copyReferralLink()" class="btn" style="white-space: nowrap;">📋 Copy Link</button>
                </div>
                <div style="font-size: 0.875rem; color: #9ca3af; margin-top: 0.5rem;">
                    Share this link with friends! They'll be credited to you when they sign up via this link.
                </div>
            </div>

            ${data.referralStats.pendingReferrals.length > 0 ? `
            <div style="margin-top: 1rem;">
                <h3>⏳ Pending Referrals</h3>
                <div style="max-height: 200px; overflow-y: auto;">
                    ${data.referralStats.pendingReferrals.map((pending: any) => `
                    <div style="background: rgba(107, 114, 128, 0.1); border-radius: 0.5rem; padding: 1rem; margin: 0.5rem 0;">
                        <div style="display: flex; justify-content: space-between; align-items: center;">
                            <span>Joined: ${new Date(pending.joinedAt).toLocaleDateString()}</span>
                            <span style="color: ${pending.progress >= 20 ? '#10b981' : '#f59e0b'};">
                                ${pending.progress.toFixed(1)}/20 tokens tipped
                            </span>
                        </div>
                        <div style="background: #374151; border-radius: 0.25rem; height: 0.5rem; margin-top: 0.5rem; overflow: hidden;">
                            <div style="background: ${pending.progress >= 20 ? '#10b981' : '#f59e0b'}; height: 100%; width: ${Math.min(100, (pending.progress / 20) * 100)}%; transition: width 0.3s;"></div>
                        </div>
                    </div>
                    `).join('')}
                </div>
            </div>
            ` : ''}
        </div>
        ` : ''}
    </div>
    
    <script>
        let socialIndex = ${data.dbUser?.socials ? JSON.parse(data.dbUser.socials).length : 0};
        
        function addSocial() {
            const container = document.getElementById('socialLinks');
            const div = document.createElement('div');
            div.className = 'social-link';
            div.style.cssText = 'display: flex; gap: 1rem; margin-bottom: 1rem;';
            div.innerHTML = \`
                <select name="platform_\${socialIndex}" style="flex: 0 0 120px;">
                    <option value="Twitter">Twitter</option>
                    <option value="GitHub">GitHub</option>
                    <option value="Discord">Discord</option>
                    <option value="Website">Website</option>
                </select>
                <input type="url" name="url_\${socialIndex}" placeholder="https://..." style="flex: 1;">
                <button type="button" onclick="removeSocial(this)" style="background: #ef4444;">Remove</button>
            \`;
            container.appendChild(div);
            socialIndex++;
        }
        
        function removeSocial(button) {
            button.parentElement.remove();
        }
        
        document.getElementById('bioForm').addEventListener('submit', async (e) => {
            e.preventDefault();
            const bio = document.getElementById('bio').value;
            
            const response = await fetch('/pengubook/api/profile', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ bio })
            });
            
            if (response.ok) {
                alert('Bio updated successfully!');
            } else {
                alert('Failed to update bio');
            }
        });
        
        document.getElementById('socialsForm').addEventListener('submit', async (e) => {
            e.preventDefault();
            const formData = new FormData(e.target);
            const socials = [];
            
            for (let i = 0; i < socialIndex; i++) {
                const platform = formData.get(\`platform_\${i}\`);
                const url = formData.get(\`url_\${i}\`);
                if (platform && url) {
                    socials.push({ platform, url });
                }
            }
            
            const response = await fetch('/pengubook/api/profile', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ socials })
            });
            
            if (response.ok) {
                alert('Social links updated successfully!');
            } else {
                alert('Failed to update social links');
            }
        });

        // Referral link copying functionality
        function copyReferralLink() {
            const referralInput = document.getElementById('referralLink');
            referralInput.select();
            referralInput.setSelectionRange(0, 99999); // For mobile devices

            navigator.clipboard.writeText(referralInput.value).then(() => {
                // Visual feedback
                const button = event.target;
                const originalText = button.textContent;
                button.textContent = '✅ Copied!';
                button.style.background = '#10b981';

                setTimeout(() => {
                    button.textContent = originalText;
                    button.style.background = '';
                }, 2000);
            }).catch(() => {
                // Fallback for older browsers
                document.execCommand('copy');
                alert('Referral link copied to clipboard!');
            });
        }
    </script>
</body>
</html>`;
}

// GET /pengubook/api/discord-user/:discordId - Fetch Discord user info
pengubookRouter.get("/api/discord-user/:discordId", async (req: Request, res: Response) => {
  try {
    const currentUser = getCurrentUser(req);
    if (!currentUser) return res.status(401).json({ success: false, error: "Not authenticated" });

    const discordId = req.params.discordId;
    
    // Get Discord client from services
    const { getDiscordClient } = await import("../services/discord_users.js");
    const client = getDiscordClient();
    
    if (!client) {
      return res.json({
        success: true,
        username: `User#${discordId.slice(-4)}`,
        avatarURL: `https://cdn.discordapp.com/embed/avatars/${parseInt(discordId.slice(-1)) % 6}.png`
      });
    }

    try {
      const user = await client.users.fetch(discordId);
      res.json({
        success: true,
        username: user.username || user.displayName || `User#${discordId.slice(-4)}`,
        avatarURL: user.displayAvatarURL({ size: 256, extension: 'png' })
      });
    } catch (error) {
      // User not found or not accessible, return fallback
      res.json({
        success: true,
        username: `User#${discordId.slice(-4)}`,
        avatarURL: `https://cdn.discordapp.com/embed/avatars/${parseInt(discordId.slice(-1)) % 6}.png`
      });
    }
  } catch (error) {
    console.error("Discord user fetch error:", error);
    res.status(500).json({ success: false, error: "Failed to fetch user info" });
  }
});