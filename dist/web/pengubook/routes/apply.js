import { getCurrentUser } from "../../auth.js";
import { getUnreadMessageCount } from "../../../interactions/buttons/pengubook.js";
import { generateBaseHTML } from "../templates.js";
import { prisma } from "../../../services/db.js";
async function applyHandler(req, res) {
  try {
    const currentUser = getCurrentUser(req);
    if (!currentUser) return res.redirect("/auth/discord");
    const unreadCount = await getUnreadMessageCount(currentUser.discordId);
    const pendingApplications = await prisma.serverApplication.findMany({
      where: {
        applicantId: currentUser.discordId,
        status: "PENDING"
      },
      orderBy: { submittedAt: "desc" }
    });
    const approvedServers = await prisma.approvedServer.findMany({
      where: { enabled: true }
    });
    const content = `
    <div class="pg-container">
        <h1 style="margin: 0 0 var(--pg-space-6) 0; color: var(--pg-dark-800);">\u{1F3E2} Server Application</h1>

        <!-- Information Section -->
        <div class="pg-card" style="margin-bottom: var(--pg-space-6);">
            <h2 style="margin: 0 0 var(--pg-space-4) 0; color: var(--pg-dark-800);">About PIPTip Server Applications</h2>

            <div style="margin-bottom: var(--pg-space-4);">
                <p style="margin-bottom: var(--pg-space-3); line-height: 1.6; color: var(--pg-dark-700);">
                    Want to bring PIPTip to your Discord server? Apply to get your community approved for crypto tipping,
                    gaming, and social features on Abstract Chain.
                </p>

                <div style="background: rgba(96, 165, 250, 0.1); border: 1px solid var(--pg-primary-300); border-radius: var(--pg-radius-md); padding: var(--pg-space-4); margin: var(--pg-space-4) 0;">
                    <h3 style="margin: 0 0 var(--pg-space-3) 0; color: var(--pg-primary-700);">\u2728 What You Get</h3>
                    <ul style="margin: 0; color: var(--pg-dark-700); line-height: 1.6;">
                        <li><strong>Multi-Token Tipping:</strong> PENGUIN, ICE, and PEBBLE support</li>
                        <li><strong>Rock Paper Scissors Gaming:</strong> Wager matches with crypto prizes</li>
                        <li><strong>Group Tips:</strong> Community tip pools and shared rewards</li>
                        <li><strong>Social Features:</strong> Profiles, messaging, and achievements</li>
                        <li><strong>Server Management:</strong> Configure channels, permissions, and settings</li>
                    </ul>
                </div>
            </div>
        </div>

        ${pendingApplications.length > 0 ? `
        <!-- Pending Applications -->
        <div class="pg-card" style="margin-bottom: var(--pg-space-6);">
            <h2 style="margin: 0 0 var(--pg-space-4) 0; color: var(--pg-dark-800);">\u23F3 Your Pending Applications</h2>

            ${pendingApplications.map((app) => `
                <div style="background: rgba(251, 191, 36, 0.1); border: 1px solid var(--pg-yellow-300); border-radius: var(--pg-radius-md); padding: var(--pg-space-4); margin-bottom: var(--pg-space-3);">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: var(--pg-space-2);">
                        <span style="font-weight: 600; color: var(--pg-dark-800);">Server ID: ${app.guildId}</span>
                        <span style="background: var(--pg-yellow-100); color: var(--pg-yellow-800); padding: 0.25rem 0.5rem; border-radius: var(--pg-radius-sm); font-size: var(--pg-text-sm);">
                            ${app.status}
                        </span>
                    </div>
                    <p style="margin: 0; color: var(--pg-dark-600); font-size: var(--pg-text-sm);">
                        Submitted: ${new Date(app.submittedAt).toLocaleDateString()}
                    </p>
                    ${app.description ? `
                    <div style="margin-top: var(--pg-space-2);">
                        <strong style="color: var(--pg-dark-700);">Description:</strong>
                        <p style="margin: 0.25rem 0 0 0; color: var(--pg-dark-600);">${app.description}</p>
                    </div>
                    ` : ""}
                </div>
            `).join("")}

            <div style="background: rgba(16, 185, 129, 0.1); border: 1px solid var(--pg-green-300); border-radius: var(--pg-radius-md); padding: var(--pg-space-3); margin-top: var(--pg-space-4);">
                <p style="margin: 0; color: var(--pg-green-700); font-size: var(--pg-text-sm);">
                    \u2139\uFE0F Applications are typically reviewed within 24-48 hours. You'll be notified when your application status changes.
                </p>
            </div>
        </div>
        ` : ""}

        <!-- Application Form -->
        <div class="pg-card">
            <h2 style="margin: 0 0 var(--pg-space-4) 0; color: var(--pg-dark-800);">\u{1F4DD} Submit New Application</h2>

            <form id="applicationForm" style="display: flex; flex-direction: column; gap: var(--pg-space-4);">
                <div>
                    <label for="guildId" style="display: block; margin-bottom: var(--pg-space-2); font-weight: 600; color: var(--pg-dark-700);">
                        Discord Server ID *
                    </label>
                    <input
                        type="text"
                        id="guildId"
                        name="guildId"
                        placeholder="123456789012345678"
                        required
                        style="width: 100%; padding: var(--pg-space-3); border: 2px solid var(--pg-dark-300); border-radius: var(--pg-radius-md); font-family: monospace;"
                    >
                    <div style="font-size: var(--pg-text-sm); color: var(--pg-dark-600); margin-top: var(--pg-space-1);">
                        Find your server ID by right-clicking your server name in Discord (Developer Mode required)
                    </div>
                </div>

                <div>
                    <label for="guildName" style="display: block; margin-bottom: var(--pg-space-2); font-weight: 600; color: var(--pg-dark-700);">
                        Server Name *
                    </label>
                    <input
                        type="text"
                        id="guildName"
                        name="guildName"
                        placeholder="My Awesome Discord Server"
                        required
                        maxlength="100"
                        style="width: 100%; padding: var(--pg-space-3); border: 2px solid var(--pg-dark-300); border-radius: var(--pg-radius-md);"
                    >
                    <div style="font-size: var(--pg-text-sm); color: var(--pg-dark-600); margin-top: var(--pg-space-1);">
                        The name of your Discord server
                    </div>
                </div>

                <div>
                    <label for="contactEmail" style="display: block; margin-bottom: var(--pg-space-2); font-weight: 600; color: var(--pg-dark-700);">
                        Contact Email (Optional)
                    </label>
                    <input
                        type="email"
                        id="contactEmail"
                        name="contactEmail"
                        placeholder="admin@yourserver.com"
                        style="width: 100%; padding: var(--pg-space-3); border: 2px solid var(--pg-dark-300); border-radius: var(--pg-radius-md);"
                    >
                </div>

                <div>
                    <label for="description" style="display: block; margin-bottom: var(--pg-space-2); font-weight: 600; color: var(--pg-dark-700);">
                        Server Description *
                    </label>
                    <textarea
                        id="description"
                        name="description"
                        placeholder="Tell us about your server community, what it's focused on, member count, etc."
                        required
                        minlength="50"
                        maxlength="500"
                        rows="4"
                        style="width: 100%; padding: var(--pg-space-3); border: 2px solid var(--pg-dark-300); border-radius: var(--pg-radius-md); font-family: inherit; resize: vertical;"
                    ></textarea>
                    <div style="font-size: var(--pg-text-sm); color: var(--pg-dark-600); margin-top: var(--pg-space-1);">
                        Minimum 50 characters, maximum 500 characters
                    </div>
                </div>

                <div>
                    <label for="useCase" style="display: block; margin-bottom: var(--pg-space-2); font-weight: 600; color: var(--pg-dark-700);">
                        How will you use PIPTip? *
                    </label>
                    <textarea
                        id="useCase"
                        name="useCase"
                        placeholder="Describe how your community plans to use PIPTip (tipping for contributions, gaming tournaments, reward systems, etc.)"
                        required
                        minlength="30"
                        maxlength="400"
                        rows="3"
                        style="width: 100%; padding: var(--pg-space-3); border: 2px solid var(--pg-dark-300); border-radius: var(--pg-radius-md); font-family: inherit; resize: vertical;"
                    ></textarea>
                    <div style="font-size: var(--pg-text-sm); color: var(--pg-dark-600); margin-top: var(--pg-space-1);">
                        Minimum 30 characters, maximum 400 characters
                    </div>
                </div>

                <div style="display: flex; gap: var(--pg-space-3); flex-wrap: wrap;">
                    <button type="submit" class="pg-btn pg-btn--primary">
                        \u{1F4E4} Submit Application
                    </button>
                    <a href="/pengubook" class="pg-btn pg-btn--secondary">
                        \u2190 Back to Home
                    </a>
                </div>
            </form>
        </div>

        <!-- Alternative Methods -->
        <div class="pg-card" style="margin-top: var(--pg-space-6);">
            <h2 style="margin: 0 0 var(--pg-space-4) 0; color: var(--pg-dark-800);">\u{1F3AE} Alternative: Discord Command</h2>
            <p style="margin-bottom: var(--pg-space-3); color: var(--pg-dark-700);">
                You can also apply directly from Discord using the slash command:
            </p>
            <div style="background: var(--pg-dark-100); border-radius: var(--pg-radius-md); padding: var(--pg-space-3); font-family: monospace; border: 2px solid var(--pg-dark-300);">
                /pip_apply
            </div>
            <p style="margin-top: var(--pg-space-2); font-size: var(--pg-text-sm); color: var(--pg-dark-600);">
                Use this command in the Discord server you want to apply for.
            </p>
        </div>
    </div>

    <script>
        document.getElementById('applicationForm').addEventListener('submit', async (e) => {
            e.preventDefault();

            const submitBtn = e.target.querySelector('button[type="submit"]');
            const originalText = submitBtn.textContent;
            submitBtn.textContent = '\u{1F4E4} Submitting...';
            submitBtn.disabled = true;

            try {
                const formData = new FormData(e.target);
                const data = {
                    guildId: formData.get('guildId'),
                    guildName: formData.get('guildName'),
                    contactEmail: formData.get('contactEmail'),
                    description: formData.get('description'),
                    useCase: formData.get('useCase')
                };

                const response = await fetch('/pengubook/api/apply', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(data)
                });

                const result = await response.json();

                if (result.success) {
                    submitBtn.textContent = '\u2705 Application Submitted!';
                    submitBtn.style.background = 'var(--pg-green-600)';

                    // Show success message
                    const successMsg = document.createElement('div');
                    successMsg.style.cssText = 'background: rgba(16, 185, 129, 0.1); border: 1px solid var(--pg-green-300); border-radius: var(--pg-radius-md); padding: var(--pg-space-4); margin-top: var(--pg-space-4); color: var(--pg-green-700);';
                    successMsg.innerHTML = \`
                        <strong>\u{1F389} Application Submitted Successfully!</strong><br>
                        <p style="margin: 0.5rem 0 0 0;">Your application has been submitted for review. You'll be notified when the status changes.</p>
                    \`;
                    e.target.appendChild(successMsg);

                    // Reset form after delay
                    setTimeout(() => {
                        window.location.reload();
                    }, 2000);
                } else {
                    throw new Error(result.error || 'Failed to submit application');
                }
            } catch (error) {
                submitBtn.textContent = '\u274C Error';
                submitBtn.style.background = 'var(--pg-red-600)';

                // Show error message
                const errorMsg = document.createElement('div');
                errorMsg.style.cssText = 'background: rgba(239, 68, 68, 0.1); border: 1px solid var(--pg-red-300); border-radius: var(--pg-radius-md); padding: var(--pg-space-4); margin-top: var(--pg-space-4); color: var(--pg-red-700);';
                errorMsg.innerHTML = \`
                    <strong>\u274C Submission Failed</strong><br>
                    <p style="margin: 0.5rem 0 0 0;">\${error.message}</p>
                \`;
                e.target.appendChild(errorMsg);

                console.error('Application submission error:', error);

                setTimeout(() => {
                    submitBtn.textContent = originalText;
                    submitBtn.disabled = false;
                    submitBtn.style.background = '';
                }, 3000);
            }
        });
    </script>`;
    res.send(generateBaseHTML(content, "\u{1F3E2} Server Application - PenguBook", "apply", {
      user: currentUser,
      unreadCount
    }));
  } catch (error) {
    console.error("PenguBook apply error:", error);
    res.status(500).send("Error loading application page");
  }
}
async function applyPostHandler(req, res) {
  try {
    const currentUser = getCurrentUser(req);
    if (!currentUser) {
      return res.status(401).json({ success: false, error: "Not authenticated" });
    }
    const { guildId, guildName, contactEmail, description, useCase } = req.body;
    if (!guildId || !guildName || !description || !useCase) {
      return res.status(400).json({
        success: false,
        error: "Guild ID, guild name, description, and use case are required"
      });
    }
    if (!/^\d{17,20}$/.test(guildId)) {
      return res.status(400).json({
        success: false,
        error: "Invalid Discord server ID format"
      });
    }
    if (description.length < 50 || description.length > 500) {
      return res.status(400).json({
        success: false,
        error: "Description must be between 50 and 500 characters"
      });
    }
    if (useCase.length < 30 || useCase.length > 400) {
      return res.status(400).json({
        success: false,
        error: "Use case must be between 30 and 400 characters"
      });
    }
    if (guildName.length < 1 || guildName.length > 100) {
      return res.status(400).json({
        success: false,
        error: "Guild name must be between 1 and 100 characters"
      });
    }
    const existingApplication = await prisma.serverApplication.findFirst({
      where: {
        guildId,
        status: { in: ["PENDING", "APPROVED"] }
      }
    });
    if (existingApplication) {
      return res.status(400).json({
        success: false,
        error: "An application for this server already exists"
      });
    }
    const approvedServer = await prisma.approvedServer.findFirst({
      where: { guildId, enabled: true }
    });
    if (approvedServer) {
      return res.status(400).json({
        success: false,
        error: "This server is already approved for PIPTip"
      });
    }
    await prisma.serverApplication.create({
      data: {
        guildId,
        guildName: guildName.trim(),
        applicantId: currentUser.discordId,
        applicantTag: currentUser.username || currentUser.discordId,
        // Use username or fall back to ID
        applicantRoles: null,
        // Cannot determine from web context
        applicantPermissions: null,
        // Cannot determine from web context
        isServerOwner: false,
        // Cannot determine from web context
        contactInfo: contactEmail || null,
        serverSize: null,
        // Cannot determine from web context
        description: description.trim(),
        useCase: useCase.trim(),
        status: "PENDING",
        submittedAt: /* @__PURE__ */ new Date()
      }
    });
    res.json({
      success: true,
      message: "Application submitted successfully"
    });
  } catch (error) {
    console.error("Server application submission error:", error);
    res.status(500).json({
      success: false,
      error: "Failed to submit application"
    });
  }
}
export {
  applyHandler,
  applyPostHandler
};
//# sourceMappingURL=apply.js.map
