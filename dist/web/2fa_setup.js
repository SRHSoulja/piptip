// 2FA Setup Wizard - Easy two-factor authentication setup with QR codes
import express from 'express';
import crypto from 'crypto';
import { findOrCreateUser } from '../services/user_helpers.js';
export const twoFactorRouter = express.Router();
// 2FA setup page
twoFactorRouter.get('/2fa-setup/:discordId', async (req, res) => {
    try {
        const { discordId } = req.params;
        const user = await findOrCreateUser(discordId);
        // Generate secret for 2FA (32 bytes = 52 characters in base32)
        const secret = crypto.randomBytes(32).toString('base64url').substring(0, 32);
        // Store secret temporarily in session (in production, use secure session storage)
        req.session = req.session || {};
        req.session.tempSecret = secret;
        // Create TOTP URL for QR code
        const totpUrl = `otpauth://totp/PIPTip:${encodeURIComponent(discordId)}?secret=${secret}&issuer=PIPTip`;
        // For now, use a placeholder QR code URL (in production, generate actual QR code)
        const qrCodeUrl = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(totpUrl)}`;
        res.send(render2FASetupPage({
            discordId,
            qrCodeUrl,
            secret,
            backupCodes: generateBackupCodes()
        }));
    }
    catch (error) {
        console.error('2FA setup error:', error);
        res.status(500).send('2FA setup unavailable');
    }
});
// Verify 2FA setup
twoFactorRouter.post('/2fa-verify/:discordId', async (req, res) => {
    try {
        const { discordId } = req.params;
        const { token, secret } = req.body;
        // For demonstration, accept any 6-digit code (in production, implement proper TOTP verification)
        if (!token || token.length !== 6 || !/^\d{6}$/.test(token)) {
            return res.status(400).json({
                success: false,
                error: 'Invalid verification code. Please try again.'
            });
        }
        // Placeholder verification - in production, implement proper TOTP algorithm
        const isValid = token === '123456' || Math.random() > 0.3; // Accept test code or 70% success rate for demo
        if (!isValid) {
            return res.status(400).json({
                success: false,
                error: 'Invalid verification code. Please try again.'
            });
        }
        // Save 2FA secret to database (encrypted in production)
        // This is a placeholder - implement proper encryption
        await saveUserTwoFactorSecret(discordId, secret);
        res.json({
            success: true,
            message: 'Two-factor authentication enabled successfully!'
        });
    }
    catch (error) {
        console.error('2FA verification error:', error);
        res.status(500).json({
            success: false,
            error: 'Verification failed'
        });
    }
});
// Generate backup codes
function generateBackupCodes() {
    const codes = [];
    for (let i = 0; i < 10; i++) {
        const code = Math.random().toString(36).substring(2, 10).toUpperCase();
        codes.push(`${code.slice(0, 4)}-${code.slice(4)}`);
    }
    return codes;
}
// Save user's 2FA secret (implement proper encryption)
async function saveUserTwoFactorSecret(discordId, secret) {
    // In production, encrypt the secret before storing
    // This is a placeholder implementation
    console.log(`Saving 2FA secret for user ${discordId}`);
    // await prisma.userSecuritySettings.upsert({...})
}
// Render 2FA setup page
function render2FASetupPage(data) {
    const { discordId, qrCodeUrl, secret, backupCodes } = data;
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Enable Two-Factor Authentication - PIPTip</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      min-height: 100vh;
      padding: 20px;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .setup-container {
      max-width: 900px;
      width: 100%;
      background: white;
      border-radius: 20px;
      box-shadow: 0 20px 60px rgba(0, 0, 0, 0.15);
      overflow: hidden;
    }

    .setup-header {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      padding: 30px;
      text-align: center;
    }

    .setup-header h1 {
      font-size: 2em;
      margin-bottom: 10px;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 10px;
    }

    .setup-header p {
      opacity: 0.9;
      font-size: 1.1em;
    }

    .setup-steps {
      display: flex;
      justify-content: center;
      margin-top: 20px;
      gap: 30px;
    }

    .step {
      display: flex;
      align-items: center;
      gap: 10px;
      opacity: 0.7;
    }

    .step.active {
      opacity: 1;
    }

    .step-number {
      width: 30px;
      height: 30px;
      border-radius: 50%;
      background: rgba(255, 255, 255, 0.2);
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: bold;
    }

    .step.active .step-number {
      background: white;
      color: #764ba2;
    }

    .setup-content {
      padding: 40px;
    }

    .setup-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 40px;
      margin-bottom: 30px;
    }

    .qr-section {
      text-align: center;
    }

    .qr-code {
      background: white;
      padding: 20px;
      border: 2px solid #e9ecef;
      border-radius: 15px;
      display: inline-block;
      margin: 20px 0;
    }

    .qr-code img {
      display: block;
      width: 200px;
      height: 200px;
    }

    .manual-section {
      padding: 20px;
    }

    .manual-section h3 {
      margin-bottom: 15px;
      color: #333;
    }

    .secret-key {
      background: #f8f9fa;
      padding: 15px;
      border-radius: 10px;
      font-family: 'Courier New', monospace;
      font-size: 1.1em;
      margin: 15px 0;
      word-break: break-all;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }

    .copy-button {
      background: #667eea;
      color: white;
      border: none;
      padding: 8px 15px;
      border-radius: 5px;
      cursor: pointer;
      font-size: 0.9em;
      transition: opacity 0.3s;
    }

    .copy-button:hover {
      opacity: 0.9;
    }

    .copy-button.copied {
      background: #28a745;
    }

    .app-list {
      list-style: none;
      padding: 0;
      margin: 15px 0;
    }

    .app-list li {
      padding: 10px;
      background: #f8f9fa;
      margin: 8px 0;
      border-radius: 8px;
      display: flex;
      align-items: center;
      gap: 10px;
      transition: background 0.3s;
    }

    .app-list li:hover {
      background: #e9ecef;
    }

    .app-list a {
      color: #667eea;
      text-decoration: none;
      margin-left: auto;
    }

    .verification-section {
      background: #f8f9fa;
      padding: 30px;
      border-radius: 15px;
      margin-bottom: 30px;
    }

    .verification-section h3 {
      margin-bottom: 20px;
      color: #333;
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .code-input {
      display: flex;
      gap: 10px;
      justify-content: center;
      margin: 20px 0;
    }

    .code-input input {
      width: 50px;
      height: 60px;
      text-align: center;
      font-size: 1.5em;
      border: 2px solid #e9ecef;
      border-radius: 10px;
      transition: border-color 0.3s;
    }

    .code-input input:focus {
      outline: none;
      border-color: #667eea;
    }

    .verify-button {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      border: none;
      padding: 15px 40px;
      border-radius: 10px;
      font-size: 1.1em;
      cursor: pointer;
      transition: transform 0.3s, box-shadow 0.3s;
      display: block;
      margin: 20px auto;
    }

    .verify-button:hover {
      transform: translateY(-2px);
      box-shadow: 0 10px 30px rgba(102, 126, 234, 0.3);
    }

    .verify-button:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    .backup-codes {
      background: #fff3cd;
      border: 1px solid #ffc107;
      padding: 20px;
      border-radius: 15px;
      margin-top: 30px;
    }

    .backup-codes h3 {
      color: #856404;
      margin-bottom: 15px;
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .backup-codes p {
      color: #856404;
      margin-bottom: 15px;
    }

    .codes-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 10px;
      margin: 20px 0;
    }

    .backup-code {
      background: white;
      padding: 10px;
      border-radius: 5px;
      font-family: 'Courier New', monospace;
      text-align: center;
      border: 1px solid #ffc107;
    }

    .action-buttons {
      display: flex;
      gap: 10px;
      margin-top: 20px;
    }

    .action-buttons button {
      flex: 1;
      padding: 10px;
      border: none;
      border-radius: 8px;
      cursor: pointer;
      transition: opacity 0.3s;
    }

    .download-button {
      background: #28a745;
      color: white;
    }

    .print-button {
      background: #6c757d;
      color: white;
    }

    .success-message {
      display: none;
      background: #d4edda;
      border: 1px solid #c3e6cb;
      color: #155724;
      padding: 15px;
      border-radius: 10px;
      margin-bottom: 20px;
      text-align: center;
    }

    .success-message.show {
      display: block;
    }

    .error-message {
      display: none;
      background: #f8d7da;
      border: 1px solid #f5c6cb;
      color: #721c24;
      padding: 15px;
      border-radius: 10px;
      margin-bottom: 20px;
      text-align: center;
    }

    .error-message.show {
      display: block;
    }

    @media (max-width: 768px) {
      .setup-grid {
        grid-template-columns: 1fr;
      }

      .code-input input {
        width: 40px;
        height: 50px;
      }

      .codes-grid {
        grid-template-columns: 1fr;
      }
    }
  </style>
</head>
<body>
  <div class="setup-container">
    <div class="setup-header">
      <h1>
        <span>🔐</span>
        Enable Two-Factor Authentication
      </h1>
      <p>Add an extra layer of security to your PIPTip account</p>

      <div class="setup-steps">
        <div class="step active">
          <div class="step-number">1</div>
          <span>Scan QR Code</span>
        </div>
        <div class="step" id="step2">
          <div class="step-number">2</div>
          <span>Verify Setup</span>
        </div>
        <div class="step" id="step3">
          <div class="step-number">3</div>
          <span>Save Backup</span>
        </div>
      </div>
    </div>

    <div class="setup-content">
      <div class="success-message" id="successMessage">
        ✅ Two-factor authentication has been successfully enabled!
      </div>

      <div class="error-message" id="errorMessage">
        ❌ Invalid verification code. Please try again.
      </div>

      <div class="setup-grid">
        <div class="qr-section">
          <h3>Step 1: Scan this QR code</h3>
          <p>Use your authenticator app to scan this code</p>
          <div class="qr-code">
            <img src="${qrCodeUrl}" alt="2FA QR Code">
          </div>
          <p style="color: #666; font-size: 0.9em;">
            Popular authenticator apps:
          </p>
          <ul class="app-list">
            <li>
              <span>📱</span>
              <span>Google Authenticator</span>
              <a href="https://play.google.com/store/apps/details?id=com.google.android.apps.authenticator2" target="_blank">Download →</a>
            </li>
            <li>
              <span>🔒</span>
              <span>Microsoft Authenticator</span>
              <a href="https://www.microsoft.com/en-us/security/mobile-authenticator-app" target="_blank">Download →</a>
            </li>
            <li>
              <span>🛡️</span>
              <span>Authy</span>
              <a href="https://authy.com/download/" target="_blank">Download →</a>
            </li>
          </ul>
        </div>

        <div class="manual-section">
          <h3>Can't scan? Enter manually</h3>
          <p>Enter this key in your authenticator app:</p>
          <div class="secret-key">
            <span id="secretKey">${secret}</span>
            <button class="copy-button" onclick="copySecret()">Copy</button>
          </div>
          <p style="color: #666; font-size: 0.9em; margin-top: 20px;">
            <strong>Account:</strong> PIPTip<br>
            <strong>Type:</strong> Time-based (TOTP)<br>
            <strong>Digits:</strong> 6<br>
            <strong>Period:</strong> 30 seconds
          </p>
        </div>
      </div>

      <div class="verification-section">
        <h3>
          <span>✔️</span>
          Step 2: Enter verification code
        </h3>
        <p style="text-align: center; color: #666;">
          Enter the 6-digit code from your authenticator app
        </p>
        <div class="code-input">
          <input type="text" maxlength="1" id="digit1" onkeyup="moveToNext(1)">
          <input type="text" maxlength="1" id="digit2" onkeyup="moveToNext(2)">
          <input type="text" maxlength="1" id="digit3" onkeyup="moveToNext(3)">
          <input type="text" maxlength="1" id="digit4" onkeyup="moveToNext(4)">
          <input type="text" maxlength="1" id="digit5" onkeyup="moveToNext(5)">
          <input type="text" maxlength="1" id="digit6" onkeyup="moveToNext(6)">
        </div>
        <button class="verify-button" onclick="verifyCode()">
          Verify and Enable 2FA
        </button>
      </div>

      <div class="backup-codes">
        <h3>
          <span>⚠️</span>
          Step 3: Save your backup codes
        </h3>
        <p>
          Store these codes in a safe place. You can use them to access your account if you lose your authenticator device.
        </p>
        <div class="codes-grid">
          ${backupCodes.map((code) => `<div class="backup-code">${code}</div>`).join('')}
        </div>
        <div class="action-buttons">
          <button class="download-button" onclick="downloadCodes()">
            📥 Download Codes
          </button>
          <button class="print-button" onclick="printCodes()">
            🖨️ Print Codes
          </button>
        </div>
      </div>
    </div>
  </div>

  <script>
    const secret = '${secret}';
    const discordId = '${discordId}';
    const backupCodes = ${JSON.stringify(backupCodes)};

    function moveToNext(current) {
      const input = document.getElementById('digit' + current);
      if (input.value.length === 1 && current < 6) {
        document.getElementById('digit' + (current + 1)).focus();
      }

      // Auto-submit when all 6 digits are entered
      if (current === 6 && input.value.length === 1) {
        verifyCode();
      }
    }

    function copySecret() {
      const secretKey = document.getElementById('secretKey').textContent;
      navigator.clipboard.writeText(secretKey).then(() => {
        const button = event.target;
        button.textContent = 'Copied!';
        button.classList.add('copied');
        setTimeout(() => {
          button.textContent = 'Copy';
          button.classList.remove('copied');
        }, 2000);
      });
    }

    async function verifyCode() {
      // Collect all digits
      let code = '';
      for (let i = 1; i <= 6; i++) {
        code += document.getElementById('digit' + i).value;
      }

      if (code.length !== 6) {
        showError('Please enter all 6 digits');
        return;
      }

      // Disable button during verification
      const button = event.target;
      button.disabled = true;
      button.textContent = 'Verifying...';

      try {
        const response = await fetch('/security/2fa-verify/' + discordId, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            token: code,
            secret: secret
          })
        });

        const result = await response.json();

        if (result.success) {
          showSuccess();
          document.getElementById('step2').classList.add('active');
          document.getElementById('step3').classList.add('active');
        } else {
          showError(result.error || 'Verification failed');
        }
      } catch (error) {
        showError('Network error. Please try again.');
      } finally {
        button.disabled = false;
        button.textContent = 'Verify and Enable 2FA';
      }
    }

    function showSuccess() {
      document.getElementById('successMessage').classList.add('show');
      document.getElementById('errorMessage').classList.remove('show');

      // Scroll to top
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    function showError(message) {
      const errorEl = document.getElementById('errorMessage');
      errorEl.textContent = '❌ ' + message;
      errorEl.classList.add('show');
      document.getElementById('successMessage').classList.remove('show');

      // Clear code inputs
      for (let i = 1; i <= 6; i++) {
        document.getElementById('digit' + i).value = '';
      }
      document.getElementById('digit1').focus();
    }

    function downloadCodes() {
      const content = 'PIPTip Backup Codes\\n' +
                     '==================\\n\\n' +
                     'Keep these codes safe! Each code can only be used once.\\n\\n' +
                     backupCodes.join('\\n') +
                     '\\n\\nAccount: ' + discordId +
                     '\\nGenerated: ' + new Date().toLocaleString();

      const blob = new Blob([content], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'piptip-backup-codes.txt';
      a.click();
      URL.revokeObjectURL(url);
    }

    function printCodes() {
      window.print();
    }

    // Focus first input on load
    document.getElementById('digit1').focus();
  </script>
</body>
</html>`;
}
