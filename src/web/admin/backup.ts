// src/web/admin/backup.ts - Backup management admin routes
import { Router, Request, Response } from "express";
import { backupService } from "../../services/backup.js";

export const backupRouter = Router();

// Get backup status and recent backups
backupRouter.get("/backup/status", async (req: Request, res: Response) => {
  try {
    const status = await backupService.getBackupStatus();
    res.json({ ok: true, ...status });
  } catch (error) {
    console.error("Failed to get backup status:", error);
    res.status(500).json({ ok: false, error: "Failed to get backup status" });
  }
});

// Create manual backup
backupRouter.post("/backup/create", async (req: Request, res: Response) => {
  try {
    const result = await backupService.createManualBackup();
    
    if (result.success) {
      res.json({ 
        ok: true, 
        message: `Backup created successfully: ${result.filename}`,
        filename: result.filename,
        size: result.size 
      });
    } else {
      res.status(500).json({ 
        ok: false, 
        error: result.error || "Backup failed" 
      });
    }
  } catch (error) {
    console.error("Manual backup failed:", error);
    res.status(500).json({ ok: false, error: "Failed to create backup" });
  }
});

// Start/stop backup service
backupRouter.post("/backup/toggle", async (req: Request, res: Response) => {
  try {
    const { action } = req.body;
    
    if (action === 'start') {
      await backupService.start();
      res.json({ ok: true, message: "Backup service started" });
    } else if (action === 'stop') {
      await backupService.stop();
      res.json({ ok: true, message: "Backup service stopped" });
    } else {
      res.status(400).json({ ok: false, error: "Invalid action. Use 'start' or 'stop'" });
    }
  } catch (error) {
    console.error("Failed to toggle backup service:", error);
    res.status(500).json({ ok: false, error: "Failed to toggle backup service" });
  }
});

// Get backup file (download)
backupRouter.get("/backup/download/:filename", async (req: Request, res: Response) => {
  try {
    const { filename } = req.params;
    
    // Security: Only allow downloading files that match backup pattern
    if (!filename.match(/^piptip_backup_[\d-T]+\.sql$/)) {
      return res.status(400).json({ ok: false, error: "Invalid backup filename" });
    }
    
    const backupDir = process.env.BACKUP_DIR || "./backups";
    const filepath = `${backupDir}/${filename}`;
    
    res.download(filepath, filename, (err) => {
      if (err) {
        console.error("Download error:", err);
        if (!res.headersSent) {
          res.status(404).json({ ok: false, error: "Backup file not found" });
        }
      }
    });
  } catch (error) {
    console.error("Failed to download backup:", error);
    res.status(500).json({ ok: false, error: "Failed to download backup" });
  }
});