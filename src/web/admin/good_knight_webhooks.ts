// Good Knight webhook management admin routes
import { Router } from 'express';
import { goodKnightWebhooks } from '../../services/good_knight_webhooks.js';
import { viewOnlyAdminMiddleware, basicAdminMiddleware } from '../../services/admin_auth.js';

const router = Router();

// GET /admin/good-knight/status - View Good Knight webhook status
router.get('/status', viewOnlyAdminMiddleware(), async (req, res) => {
  try {
    const status = goodKnightWebhooks.getWebhookStatus();
    const fallbackLogs = goodKnightWebhooks.getFallbackLogs().slice(-20); // Last 20 entries

    res.json({
      success: true,
      data: {
        webhooks: {
          authorized: status.authorized,
          total: status.total,
          details: status.webhooks
        },
        recent_fallbacks: fallbackLogs.map(log => ({
          timestamp: log.timestamp,
          type: log.type,
          message: log.message,
          has_payload: !!log.payload
        })),
        configuration: {
          primary_webhook_configured: !!process.env.DISCORD_WEBHOOK_URL,
          guild_id_configured: !!process.env.DISCORD_GUILD_ID,
          good_knight_allowlist_configured: !!process.env.GOOD_KNIGHT_WEBHOOK_ALLOWLIST,
          authorized_webhooks_configured: !!process.env.GOOD_KNIGHT_AUTHORIZED_WEBHOOKS
        }
      }
    });
  } catch (error) {
    console.error('Good Knight webhook status error:', error);
    res.status(500).json({ success: false, error: 'Failed to get webhook status' });
  }
});

// POST /admin/good-knight/test - Test Good Knight webhook authorization
router.post('/test', basicAdminMiddleware(), async (req, res) => {
  try {
    const { type = 'system', message = 'Test message from PIPTip admin panel' } = req.body;

    const result = await goodKnightWebhooks.sendAuthorizedWebhook(
      type as 'alert' | 'monitoring' | 'system',
      {
        embeds: [{
          title: '🧪 Good Knight Webhook Test',
          description: message,
          color: 0x3b82f6,
          fields: [
            { name: 'Test Type', value: type, inline: true },
            { name: 'Admin User', value: 'Admin Panel', inline: true },
            { name: 'Timestamp', value: new Date().toISOString(), inline: true }
          ],
          footer: {
            text: 'PIPTip Good Knight Integration Test'
          }
        }]
      },
      { priority: 'low', fallbackToLog: true }
    );

    res.json({
      success: true,
      data: {
        webhook_sent: result.success,
        message: result.message,
        webhook_id: result.webhookId
      }
    });

  } catch (error) {
    console.error('Good Knight webhook test error:', error);
    res.status(500).json({ success: false, error: 'Failed to test webhook' });
  }
});

// GET /admin/good-knight/fallback-logs - Get detailed fallback logs
router.get('/fallback-logs', viewOnlyAdminMiddleware(), async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
    const logs = goodKnightWebhooks.getFallbackLogs().slice(-limit);

    res.json({
      success: true,
      data: {
        logs: logs.map(log => ({
          timestamp: log.timestamp,
          type: log.type,
          message: log.message,
          payload: log.payload
        })),
        total: logs.length
      }
    });
  } catch (error) {
    console.error('Good Knight fallback logs error:', error);
    res.status(500).json({ success: false, error: 'Failed to get fallback logs' });
  }
});

export { router as goodKnightWebhooksRouter };