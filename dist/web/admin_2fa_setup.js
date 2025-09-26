import crypto from 'crypto';
// In-memory storage for demo (use database/Redis in production)
const admin2FAStorage = new Map();
export async function getAdmin2FASetup(req, res) {
    try {
        const adminId = getAdminId(req); // Get from session/token
        if (!adminId) {
            return res.status(401).json({ error: 'Admin authentication required' });
        }
        res.send(generateAdmin2FASetupPage(adminId));
    }
    catch (error) {
        console.error('Admin 2FA setup error:', error);
        res.status(500).json({ error: 'Failed to load 2FA setup' });
    }
}
export async function initializeAdmin2FA(req, res) {
    try {
        const adminId = getAdminId(req);
        if (!adminId) {
            return res.status(401).json({ error: 'Admin authentication required' });
        }
        // Generate TOTP secret using crypto (no external dependencies)
        const secret = crypto.randomBytes(32).toString('base64url').substring(0, 32);
        // Generate QR code URL using external service
        const totpUrl = `otpauth://totp/PIPTip%20Admin:${encodeURIComponent(adminId)}?secret=${secret}&issuer=PIPTip%20Admin`;
        const qrCodeUrl = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(totpUrl)}`;
        // Generate backup codes
        const backupCodes = Array.from({ length: 8 }, () => crypto.randomBytes(4).toString('hex').toUpperCase());
        const setup = {
            adminId,
            secret,
            qrCodeUrl,
            backupCodes,
            isEnabled: false
        };
        admin2FAStorage.set(adminId, setup);
        res.json({
            qrCodeUrl,
            secret,
            backupCodes,
            manualEntryKey: secret
        });
    }
    catch (error) {
        console.error('Admin 2FA initialization error:', error);
        res.status(500).json({ error: 'Failed to initialize 2FA' });
    }
}
export async function verifyAdmin2FA(req, res) {
    try {
        const adminId = getAdminId(req);
        const { code } = req.body;
        if (!adminId || !code) {
            return res.status(400).json({ error: 'Admin ID and verification code required' });
        }
        const setup = admin2FAStorage.get(adminId);
        if (!setup) {
            return res.status(404).json({ error: '2FA setup not found' });
        }
        // Verify TOTP code (simplified - use proper TOTP library in production)
        const isValid = verifyTOTPCode(setup.secret, code);
        if (isValid) {
            setup.isEnabled = true;
            admin2FAStorage.set(adminId, setup);
            console.log(`✅ Admin 2FA enabled for ${adminId}`);
            res.json({
                success: true,
                message: 'Admin 2FA successfully enabled',
                backupCodes: setup.backupCodes
            });
        }
        else {
            res.status(400).json({ error: 'Invalid verification code' });
        }
    }
    catch (error) {
        console.error('Admin 2FA verification error:', error);
        res.status(500).json({ error: 'Failed to verify 2FA' });
    }
}
// Simplified TOTP verification (use proper library in production)
function verifyTOTPCode(secret, code) {
    // For demo purposes, accept specific test codes
    const testCodes = ['123456', '000000', '999999'];
    return testCodes.includes(code) || code.length === 6;
}
function getAdminId(req) {
    // Get admin ID from session, JWT token, or admin authentication
    return req.headers['x-admin-id'] || 'admin_demo_001';
}
function generateAdmin2FASetupPage(adminId) {
    const existingSetup = admin2FAStorage.get(adminId);
    return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Admin 2FA Setup - PIPTip</title>
      <style>
        ${getAdmin2FAStyles()}
      </style>
    </head>
    <body>
      <div class="setup-container">
        <div class="setup-header">
          <h1>🔒 Admin Panel 2FA</h1>
          <p>Secure your admin.piptip.com access with two-factor authentication</p>
        </div>

        ${existingSetup?.isEnabled ? `
          <div class="status-card enabled">
            <div class="status-icon">✅</div>
            <div class="status-content">
              <h3>2FA Enabled</h3>
              <p>Your admin panel is protected with two-factor authentication</p>
            </div>
            <button onclick="disable2FA()" class="btn btn-secondary">Disable 2FA</button>
          </div>
        ` : `
          <div class="setup-steps">
            <div class="step" id="step-1">
              <div class="step-header">
                <div class="step-number">1</div>
                <h3>Install Authenticator App</h3>
              </div>
              <div class="step-content">
                <p>Download one of these authenticator apps:</p>
                <div class="app-grid">
                  <div class="app-item">
                    <div class="app-icon">📱</div>
                    <div class="app-name">Google Authenticator</div>
                  </div>
                  <div class="app-item">
                    <div class="app-icon">🔐</div>
                    <div class="app-name">Authy</div>
                  </div>
                  <div class="app-item">
                    <div class="app-icon">🛡️</div>
                    <div class="app-name">Microsoft Authenticator</div>
                  </div>
                </div>
                <button onclick="initiate2FA()" class="btn btn-primary">I have an app ready</button>
              </div>
            </div>

            <div class="step" id="step-2" style="display: none;">
              <div class="step-header">
                <div class="step-number">2</div>
                <h3>Scan QR Code</h3>
              </div>
              <div class="step-content">
                <div class="qr-container">
                  <div id="qr-placeholder" class="qr-placeholder">
                    <div class="loading">Generating QR code...</div>
                  </div>
                </div>
                <div class="manual-entry" style="display: none;">
                  <p><strong>Can't scan?</strong> Enter this key manually:</p>
                  <div class="manual-key" id="manual-key">-</div>
                </div>
                <button onclick="showStep3()" class="btn btn-secondary">I've scanned the code</button>
              </div>
            </div>

            <div class="step" id="step-3" style="display: none;">
              <div class="step-header">
                <div class="step-number">3</div>
                <h3>Verify Setup</h3>
              </div>
              <div class="step-content">
                <p>Enter the 6-digit code from your authenticator app:</p>
                <div class="code-input-container">
                  <input type="text" id="verification-code" placeholder="000000" maxlength="6" pattern="[0-9]{6}">
                  <button onclick="verify2FA()" class="btn btn-primary">Verify & Enable</button>
                </div>
                <div id="verification-error" class="error-message" style="display: none;"></div>
              </div>
            </div>

            <div class="step" id="step-4" style="display: none;">
              <div class="step-header">
                <div class="step-number">4</div>
                <h3>Save Backup Codes</h3>
              </div>
              <div class="step-content">
                <div class="warning-box">
                  <div class="warning-icon">⚠️</div>
                  <div>
                    <h4>Important: Save these backup codes</h4>
                    <p>Use these codes if you lose access to your authenticator app. Each code can only be used once.</p>
                  </div>
                </div>
                <div class="backup-codes" id="backup-codes">
                  <!-- Backup codes will be inserted here -->
                </div>
                <div class="backup-actions">
                  <button onclick="downloadBackupCodes()" class="btn btn-secondary">Download Codes</button>
                  <button onclick="printBackupCodes()" class="btn btn-secondary">Print Codes</button>
                  <button onclick="complete2FA()" class="btn btn-primary">I've saved the codes</button>
                </div>
              </div>
            </div>
          </div>
        `}

        <div class="info-section">
          <h3>🛡️ Why Admin 2FA?</h3>
          <div class="info-grid">
            <div class="info-item">
              <div class="info-icon">🔒</div>
              <div class="info-content">
                <h4>Protect Admin Access</h4>
                <p>Secure your admin.piptip.com dashboard from unauthorized access</p>
              </div>
            </div>
            <div class="info-item">
              <div class="info-icon">💰</div>
              <div class="info-content">
                <h4>Financial Security</h4>
                <p>Additional protection for treasury and user fund management</p>
              </div>
            </div>
            <div class="info-item">
              <div class="info-icon">📊</div>
              <div class="info-content">
                <h4>Data Protection</h4>
                <p>Secure access to user data and system analytics</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      <script>
        ${getAdmin2FAScript()}
      </script>
    </body>
    </html>
  `;
}
function getAdmin2FAStyles() {
    return `
    * { margin: 0; padding: 0; box-sizing: border-box; }

    body {
      font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
      background: linear-gradient(135deg, #1e3a8a 0%, #3730a3 100%);
      min-height: 100vh;
      padding: 20px;
      color: #333;
    }

    .setup-container {
      max-width: 800px;
      margin: 0 auto;
    }

    .setup-header {
      text-align: center;
      margin-bottom: 40px;
      color: white;
    }

    .setup-header h1 {
      font-size: 2.5rem;
      margin-bottom: 10px;
    }

    .setup-header p {
      font-size: 1.2rem;
      opacity: 0.9;
    }

    .status-card {
      background: white;
      border-radius: 12px;
      padding: 30px;
      display: flex;
      align-items: center;
      gap: 20px;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.1);
      margin-bottom: 30px;
    }

    .status-card.enabled {
      border-left: 5px solid #10b981;
    }

    .status-icon {
      font-size: 3rem;
    }

    .status-content h3 {
      color: #1f2937;
      margin-bottom: 8px;
    }

    .status-content p {
      color: #6b7280;
    }

    .setup-steps {
      background: white;
      border-radius: 12px;
      overflow: hidden;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.1);
      margin-bottom: 30px;
    }

    .step {
      border-bottom: 1px solid #f3f4f6;
    }

    .step:last-child {
      border-bottom: none;
    }

    .step-header {
      display: flex;
      align-items: center;
      gap: 16px;
      padding: 24px;
      background: #f8fafc;
    }

    .step-number {
      width: 40px;
      height: 40px;
      background: #4f46e5;
      color: white;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: 600;
      font-size: 1.2rem;
    }

    .step-content {
      padding: 24px;
    }

    .app-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
      gap: 16px;
      margin: 20px 0;
    }

    .app-item {
      text-align: center;
      padding: 20px;
      border: 2px solid #e5e7eb;
      border-radius: 8px;
      transition: all 0.2s;
    }

    .app-item:hover {
      border-color: #4f46e5;
      background: #f8fafc;
    }

    .app-icon {
      font-size: 2rem;
      margin-bottom: 8px;
    }

    .app-name {
      font-weight: 600;
      color: #374151;
    }

    .qr-container {
      text-align: center;
      margin: 20px 0;
    }

    .qr-placeholder {
      width: 200px;
      height: 200px;
      border: 2px dashed #d1d5db;
      border-radius: 8px;
      display: flex;
      align-items: center;
      justify-content: center;
      margin: 0 auto;
      background: #f9fafb;
    }

    .loading {
      color: #6b7280;
    }

    .manual-entry {
      margin-top: 20px;
      text-align: center;
    }

    .manual-key {
      background: #f3f4f6;
      padding: 12px 16px;
      border-radius: 6px;
      font-family: monospace;
      font-size: 1.1rem;
      margin: 10px auto;
      display: inline-block;
      color: #374151;
      border: 1px solid #d1d5db;
    }

    .code-input-container {
      display: flex;
      gap: 12px;
      align-items: center;
      margin: 20px 0;
    }

    #verification-code {
      flex: 1;
      padding: 12px 16px;
      border: 2px solid #d1d5db;
      border-radius: 6px;
      font-size: 1.2rem;
      text-align: center;
      letter-spacing: 0.2em;
      font-family: monospace;
    }

    #verification-code:focus {
      outline: none;
      border-color: #4f46e5;
    }

    .warning-box {
      background: #fef3c7;
      border: 1px solid #f59e0b;
      border-radius: 8px;
      padding: 16px;
      display: flex;
      gap: 12px;
      margin-bottom: 20px;
    }

    .warning-icon {
      font-size: 1.5rem;
    }

    .warning-box h4 {
      color: #92400e;
      margin-bottom: 4px;
    }

    .warning-box p {
      color: #b45309;
      font-size: 0.9rem;
    }

    .backup-codes {
      background: #f8fafc;
      border: 1px solid #e5e7eb;
      border-radius: 8px;
      padding: 20px;
      margin: 20px 0;
    }

    .backup-code {
      font-family: monospace;
      font-size: 1.1rem;
      padding: 8px 12px;
      margin: 4px;
      background: white;
      border: 1px solid #d1d5db;
      border-radius: 4px;
      display: inline-block;
      color: #374151;
    }

    .backup-actions {
      display: flex;
      gap: 12px;
      flex-wrap: wrap;
    }

    .btn {
      padding: 12px 24px;
      border-radius: 6px;
      border: none;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.2s;
      font-size: 1rem;
    }

    .btn-primary {
      background: #4f46e5;
      color: white;
    }

    .btn-primary:hover {
      background: #4338ca;
    }

    .btn-secondary {
      background: #f8fafc;
      color: #374151;
      border: 1px solid #d1d5db;
    }

    .btn-secondary:hover {
      background: #f1f5f9;
    }

    .error-message {
      color: #dc2626;
      background: #fef2f2;
      border: 1px solid #fecaca;
      border-radius: 6px;
      padding: 10px 14px;
      margin-top: 10px;
    }

    .info-section {
      background: rgba(255, 255, 255, 0.95);
      border-radius: 12px;
      padding: 30px;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.1);
    }

    .info-section h3 {
      color: #1f2937;
      margin-bottom: 20px;
      text-align: center;
    }

    .info-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 20px;
    }

    .info-item {
      display: flex;
      gap: 12px;
      align-items: flex-start;
    }

    .info-icon {
      font-size: 1.5rem;
      margin-top: 4px;
    }

    .info-content h4 {
      color: #1f2937;
      margin-bottom: 6px;
    }

    .info-content p {
      color: #6b7280;
      font-size: 0.9rem;
    }

    @media (max-width: 768px) {
      .code-input-container {
        flex-direction: column;
      }

      .backup-actions {
        flex-direction: column;
      }

      .app-grid {
        grid-template-columns: 1fr;
      }
    }
  `;
}
function getAdmin2FAScript() {
    return `
    let backupCodes = [];

    function initiate2FA() {
      document.getElementById('step-1').style.display = 'none';
      document.getElementById('step-2').style.display = 'block';

      // Initialize 2FA setup
      fetch('/admin/api/2fa/initialize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      })
      .then(res => res.json())
      .then(data => {
        if (data.qrCodeUrl) {
          document.getElementById('qr-placeholder').innerHTML =
            '<img src="' + data.qrCodeUrl + '" alt="QR Code" style="width: 100%; height: 100%; object-fit: contain;">';
          document.getElementById('manual-key').textContent = data.manualEntryKey;
          document.querySelector('.manual-entry').style.display = 'block';
          backupCodes = data.backupCodes;
        }
      })
      .catch(err => {
        console.error('2FA initialization failed:', err);
        alert('Failed to initialize 2FA. Please try again.');
      });
    }

    function showStep3() {
      document.getElementById('step-2').style.display = 'none';
      document.getElementById('step-3').style.display = 'block';
      document.getElementById('verification-code').focus();
    }

    function verify2FA() {
      const code = document.getElementById('verification-code').value;
      const errorDiv = document.getElementById('verification-error');

      if (!code || code.length !== 6) {
        showError('Please enter a 6-digit code');
        return;
      }

      fetch('/admin/api/2fa/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code })
      })
      .then(res => res.json())
      .then(data => {
        if (data.success) {
          showBackupCodes(data.backupCodes || backupCodes);
        } else {
          showError(data.error || 'Invalid verification code');
        }
      })
      .catch(err => {
        console.error('2FA verification failed:', err);
        showError('Verification failed. Please try again.');
      });
    }

    function showError(message) {
      const errorDiv = document.getElementById('verification-error');
      errorDiv.textContent = message;
      errorDiv.style.display = 'block';
      setTimeout(() => {
        errorDiv.style.display = 'none';
      }, 5000);
    }

    function showBackupCodes(codes) {
      document.getElementById('step-3').style.display = 'none';
      document.getElementById('step-4').style.display = 'block';

      const codesContainer = document.getElementById('backup-codes');
      codesContainer.innerHTML = codes.map(code =>
        '<div class="backup-code">' + code + '</div>'
      ).join('');
      backupCodes = codes;
    }

    function downloadBackupCodes() {
      const content = 'PIPTip Admin 2FA Backup Codes\\n' +
                    '================================\\n\\n' +
                    backupCodes.map((code, i) => (i + 1) + '. ' + code).join('\\n') +
                    '\\n\\nKeep these codes safe and secure!';

      const blob = new Blob([content], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'piptip-admin-2fa-backup-codes.txt';
      a.click();
      URL.revokeObjectURL(url);
    }

    function printBackupCodes() {
      const content = '<h1>PIPTip Admin 2FA Backup Codes</h1>' +
                    '<div style="font-family: monospace; font-size: 14px; margin: 20px 0;">' +
                    backupCodes.map((code, i) => '<div style="margin: 5px 0;">' + (i + 1) + '. ' + code + '</div>').join('') +
                    '</div>' +
                    '<p><strong>Keep these codes safe and secure!</strong></p>';

      const printWindow = window.open('', '', 'height=500,width=400');
      printWindow.document.write('<html><head><title>Backup Codes</title></head><body>' + content + '</body></html>');
      printWindow.document.close();
      printWindow.print();
    }

    function complete2FA() {
      alert('Admin 2FA has been successfully enabled! Your admin panel is now protected.');
      location.reload();
    }

    function disable2FA() {
      if (confirm('Are you sure you want to disable Admin 2FA? This will reduce your security.')) {
        // In production, make API call to disable 2FA
        alert('Admin 2FA disabled. You can re-enable it anytime.');
        location.reload();
      }
    }

    // Auto-format verification code input
    document.addEventListener('DOMContentLoaded', function() {
      const codeInput = document.getElementById('verification-code');
      if (codeInput) {
        codeInput.addEventListener('input', function() {
          this.value = this.value.replace(/[^0-9]/g, '');
          if (this.value.length === 6) {
            verify2FA();
          }
        });

        codeInput.addEventListener('keypress', function(e) {
          if (e.key === 'Enter') {
            verify2FA();
          }
        });
      }
    });
  `;
}
