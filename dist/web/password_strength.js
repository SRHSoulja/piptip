// Password Strength Meter - Interactive password security assessment
import express from 'express';
export const passwordStrengthRouter = express.Router();
// Password strength assessment endpoint
passwordStrengthRouter.post('/check-strength', (req, res) => {
    try {
        const { password } = req.body;
        if (!password) {
            return res.status(400).json({
                success: false,
                error: 'Password is required'
            });
        }
        const assessment = assessPasswordStrength(password);
        res.json({
            success: true,
            assessment
        });
    }
    catch (error) {
        console.error('Password strength check error:', error);
        res.status(500).json({
            success: false,
            error: 'Assessment failed'
        });
    }
});
// Password change page with strength meter
passwordStrengthRouter.get('/password/:discordId', (req, res) => {
    try {
        const { discordId } = req.params;
        res.send(renderPasswordChangePage({ discordId }));
    }
    catch (error) {
        console.error('Password page error:', error);
        res.status(500).send('Password page unavailable');
    }
});
// Password strength assessment function
function assessPasswordStrength(password) {
    let score = 0;
    const feedback = [];
    const requirements = {
        length: false,
        lowercase: false,
        uppercase: false,
        numbers: false,
        symbols: false,
        noCommon: false,
        noPersonal: false
    };
    // Length check (0-25 points)
    if (password.length >= 8) {
        requirements.length = true;
        score += 15;
        if (password.length >= 12)
            score += 5;
        if (password.length >= 16)
            score += 5;
    }
    else {
        feedback.push('Use at least 8 characters');
    }
    // Lowercase letters (0-10 points)
    if (/[a-z]/.test(password)) {
        requirements.lowercase = true;
        score += 10;
    }
    else {
        feedback.push('Add lowercase letters (a-z)');
    }
    // Uppercase letters (0-10 points)
    if (/[A-Z]/.test(password)) {
        requirements.uppercase = true;
        score += 10;
    }
    else {
        feedback.push('Add uppercase letters (A-Z)');
    }
    // Numbers (0-10 points)
    if (/[0-9]/.test(password)) {
        requirements.numbers = true;
        score += 10;
    }
    else {
        feedback.push('Add numbers (0-9)');
    }
    // Special characters (0-15 points)
    if (/[^a-zA-Z0-9]/.test(password)) {
        requirements.symbols = true;
        score += 15;
    }
    else {
        feedback.push('Add symbols (!@#$%^&*)');
    }
    // Common password check (0-15 points)
    if (!isCommonPassword(password)) {
        requirements.noCommon = true;
        score += 15;
    }
    else {
        feedback.push('Avoid common passwords');
        score = Math.max(0, score - 20); // Penalty for common passwords
    }
    // Personal info check (0-5 points)
    if (!containsPersonalInfo(password)) {
        requirements.noPersonal = true;
        score += 5;
    }
    else {
        feedback.push('Avoid personal information');
    }
    // Repetition penalty
    if (hasRepeatedCharacters(password)) {
        feedback.push('Avoid repeated characters');
        score = Math.max(0, score - 10);
    }
    // Sequential penalty
    if (hasSequentialCharacters(password)) {
        feedback.push('Avoid sequential characters (abc, 123)');
        score = Math.max(0, score - 10);
    }
    // Determine strength level
    let level;
    let color;
    let message;
    if (score >= 90) {
        level = 'very_strong';
        color = '#00c851';
        message = 'Excellent! Your password is very strong.';
    }
    else if (score >= 75) {
        level = 'strong';
        color = '#00c851';
        message = 'Great! Your password is strong.';
    }
    else if (score >= 60) {
        level = 'good';
        color = '#33b5e5';
        message = 'Good password strength.';
    }
    else if (score >= 40) {
        level = 'fair';
        color = '#ffbb33';
        message = 'Fair password. Consider improvements.';
    }
    else if (score >= 20) {
        level = 'weak';
        color = '#ff8800';
        message = 'Weak password. Please strengthen it.';
    }
    else {
        level = 'very_weak';
        color = '#ff4444';
        message = 'Very weak password. Please choose a stronger password.';
    }
    return {
        score: Math.min(100, Math.max(0, score)),
        level,
        color,
        message,
        feedback,
        requirements,
        estimatedCrackTime: estimateCrackTime(password, score)
    };
}
// Check if password is commonly used
function isCommonPassword(password) {
    const commonPasswords = [
        'password', '123456', '123456789', 'qwerty', 'abc123', 'password123',
        'admin', 'letmein', 'welcome', 'monkey', '1234567890', 'dragon',
        'master', 'login', 'princess', 'qwertyuiop', 'solo', 'passw0rd',
        'starwars', 'football', 'baseball', 'superman', 'batman', 'trustno1'
    ];
    return commonPasswords.includes(password.toLowerCase());
}
// Check if password contains personal information (basic check)
function containsPersonalInfo(password) {
    // Basic checks - in production, this would check against user's known info
    const personalPatterns = [
        /\b(name|user|admin|email|phone)\b/i,
        /\b\d{4}\b/, // Years
        /\b(january|february|march|april|may|june|july|august|september|october|november|december)\b/i
    ];
    return personalPatterns.some(pattern => pattern.test(password));
}
// Check for repeated characters
function hasRepeatedCharacters(password) {
    return /(.)\1{2,}/.test(password); // 3 or more repeated characters
}
// Check for sequential characters
function hasSequentialCharacters(password) {
    const sequences = ['abc', 'bcd', 'cde', 'def', 'efg', 'fgh', 'ghi', 'hij', 'ijk', 'jkl', 'klm', 'lmn', 'mno', 'nop', 'opq', 'pqr', 'qrs', 'rst', 'stu', 'tuv', 'uvw', 'vwx', 'wxy', 'xyz'];
    const numberSeqs = ['123', '234', '345', '456', '567', '678', '789', '890'];
    const lowerPassword = password.toLowerCase();
    return sequences.some(seq => lowerPassword.includes(seq)) ||
        numberSeqs.some(seq => password.includes(seq));
}
// Estimate crack time
function estimateCrackTime(password, score) {
    const baseTime = Math.pow(2, password.length * 2); // Simplified calculation
    const adjustedTime = baseTime * (score / 100);
    if (adjustedTime < 1)
        return 'Instantly';
    if (adjustedTime < 60)
        return 'Less than a minute';
    if (adjustedTime < 3600)
        return `${Math.round(adjustedTime / 60)} minutes`;
    if (adjustedTime < 86400)
        return `${Math.round(adjustedTime / 3600)} hours`;
    if (adjustedTime < 31536000)
        return `${Math.round(adjustedTime / 86400)} days`;
    if (adjustedTime < 31536000000)
        return `${Math.round(adjustedTime / 31536000)} years`;
    return 'Centuries';
}
// Render password change page with strength meter
function renderPasswordChangePage(data) {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Change Password - PIPTip</title>
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
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }

    .password-container {
      background: white;
      border-radius: 20px;
      padding: 40px;
      box-shadow: 0 20px 60px rgba(0, 0, 0, 0.15);
      max-width: 500px;
      width: 100%;
    }

    .header {
      text-align: center;
      margin-bottom: 30px;
    }

    .header h1 {
      color: #333;
      margin-bottom: 10px;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 10px;
    }

    .header p {
      color: #666;
    }

    .form-group {
      margin-bottom: 25px;
    }

    .form-group label {
      display: block;
      margin-bottom: 8px;
      font-weight: 600;
      color: #333;
    }

    .password-input-container {
      position: relative;
    }

    .password-input {
      width: 100%;
      padding: 15px;
      border: 2px solid #e9ecef;
      border-radius: 10px;
      font-size: 16px;
      transition: border-color 0.3s;
    }

    .password-input:focus {
      outline: none;
      border-color: #667eea;
    }

    .password-toggle {
      position: absolute;
      right: 15px;
      top: 50%;
      transform: translateY(-50%);
      background: none;
      border: none;
      cursor: pointer;
      font-size: 18px;
      color: #666;
    }

    .strength-meter {
      margin-top: 15px;
      padding: 20px;
      background: #f8f9fa;
      border-radius: 10px;
      opacity: 0;
      transform: translateY(-10px);
      transition: all 0.3s ease;
    }

    .strength-meter.visible {
      opacity: 1;
      transform: translateY(0);
    }

    .strength-bar-container {
      margin-bottom: 15px;
    }

    .strength-bar {
      width: 100%;
      height: 8px;
      background: #e9ecef;
      border-radius: 4px;
      overflow: hidden;
    }

    .strength-fill {
      height: 100%;
      transition: width 0.5s ease, background-color 0.3s ease;
      width: 0%;
      background: #ff4444;
    }

    .strength-info {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 15px;
    }

    .strength-level {
      font-weight: 600;
      font-size: 0.9em;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    .strength-score {
      font-size: 0.9em;
      color: #666;
    }

    .strength-message {
      font-size: 0.9em;
      margin-bottom: 15px;
      padding: 10px;
      border-radius: 8px;
      background: #e9ecef;
    }

    .requirements {
      margin-bottom: 15px;
    }

    .requirements h4 {
      margin-bottom: 10px;
      color: #333;
      font-size: 0.9em;
    }

    .requirement {
      display: flex;
      align-items: center;
      gap: 8px;
      margin: 5px 0;
      font-size: 0.85em;
      transition: color 0.3s;
    }

    .requirement.met {
      color: #28a745;
    }

    .requirement.not-met {
      color: #dc3545;
    }

    .feedback {
      margin-top: 10px;
    }

    .feedback h4 {
      margin-bottom: 8px;
      color: #333;
      font-size: 0.9em;
    }

    .feedback-item {
      background: #fff3cd;
      border: 1px solid #ffeaa7;
      color: #856404;
      padding: 8px 12px;
      border-radius: 6px;
      margin: 5px 0;
      font-size: 0.85em;
    }

    .crack-time {
      margin-top: 10px;
      padding: 10px;
      background: #e3f2fd;
      border-radius: 8px;
      font-size: 0.85em;
      color: #1565c0;
    }

    .submit-button {
      width: 100%;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      border: none;
      padding: 15px;
      border-radius: 10px;
      font-size: 1.1em;
      cursor: pointer;
      transition: transform 0.3s, box-shadow 0.3s;
      margin-top: 20px;
    }

    .submit-button:hover:not(:disabled) {
      transform: translateY(-2px);
      box-shadow: 0 10px 30px rgba(102, 126, 234, 0.3);
    }

    .submit-button:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    .tips {
      margin-top: 25px;
      padding: 20px;
      background: #f8f9fa;
      border-radius: 10px;
    }

    .tips h3 {
      margin-bottom: 15px;
      color: #333;
      font-size: 1.1em;
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .tip {
      margin: 8px 0;
      font-size: 0.9em;
      color: #666;
      display: flex;
      align-items: start;
      gap: 8px;
    }

    @media (max-width: 768px) {
      .password-container {
        padding: 30px 20px;
      }
    }
  </style>
</head>
<body>
  <div class="password-container">
    <div class="header">
      <h1>
        <span>🔑</span>
        Change Password
      </h1>
      <p>Create a strong, secure password for your PIPTip account</p>
    </div>

    <form id="passwordForm">
      <div class="form-group">
        <label for="currentPassword">Current Password</label>
        <div class="password-input-container">
          <input type="password" id="currentPassword" class="password-input" required>
          <button type="button" class="password-toggle" onclick="togglePassword('currentPassword')">👁️</button>
        </div>
      </div>

      <div class="form-group">
        <label for="newPassword">New Password</label>
        <div class="password-input-container">
          <input type="password" id="newPassword" class="password-input" required>
          <button type="button" class="password-toggle" onclick="togglePassword('newPassword')">👁️</button>
        </div>

        <div class="strength-meter" id="strengthMeter">
          <div class="strength-bar-container">
            <div class="strength-bar">
              <div class="strength-fill" id="strengthFill"></div>
            </div>
          </div>

          <div class="strength-info">
            <span class="strength-level" id="strengthLevel">Very Weak</span>
            <span class="strength-score" id="strengthScore">0/100</span>
          </div>

          <div class="strength-message" id="strengthMessage">
            Enter a password to see strength analysis
          </div>

          <div class="requirements">
            <h4>Password Requirements:</h4>
            <div class="requirement not-met" id="req-length">
              <span>❌</span>
              <span>At least 8 characters</span>
            </div>
            <div class="requirement not-met" id="req-lowercase">
              <span>❌</span>
              <span>Lowercase letters (a-z)</span>
            </div>
            <div class="requirement not-met" id="req-uppercase">
              <span>❌</span>
              <span>Uppercase letters (A-Z)</span>
            </div>
            <div class="requirement not-met" id="req-numbers">
              <span>❌</span>
              <span>Numbers (0-9)</span>
            </div>
            <div class="requirement not-met" id="req-symbols">
              <span>❌</span>
              <span>Special characters (!@#$%^&*)</span>
            </div>
          </div>

          <div class="feedback" id="feedback" style="display: none;">
            <h4>Suggestions:</h4>
          </div>

          <div class="crack-time" id="crackTime" style="display: none;">
            <strong>Estimated crack time:</strong> <span id="crackTimeValue">Unknown</span>
          </div>
        </div>
      </div>

      <div class="form-group">
        <label for="confirmPassword">Confirm New Password</label>
        <div class="password-input-container">
          <input type="password" id="confirmPassword" class="password-input" required>
          <button type="button" class="password-toggle" onclick="togglePassword('confirmPassword')">👁️</button>
        </div>
      </div>

      <button type="submit" class="submit-button" id="submitButton" disabled>
        Update Password
      </button>
    </form>

    <div class="tips">
      <h3>💡 Password Tips</h3>
      <div class="tip">
        <span>🎯</span>
        <span>Use a unique password that you don't use anywhere else</span>
      </div>
      <div class="tip">
        <span>🔀</span>
        <span>Mix uppercase and lowercase letters, numbers, and symbols</span>
      </div>
      <div class="tip">
        <span>📏</span>
        <span>Longer passwords are generally more secure</span>
      </div>
      <div class="tip">
        <span>🚫</span>
        <span>Avoid personal information like names, birthdays, or addresses</span>
      </div>
      <div class="tip">
        <span>💾</span>
        <span>Consider using a password manager to generate and store strong passwords</span>
      </div>
    </div>
  </div>

  <script>
    let lastAssessment = null;

    // Password strength checking
    document.getElementById('newPassword').addEventListener('input', async function() {
      const password = this.value;
      const strengthMeter = document.getElementById('strengthMeter');

      if (password.length === 0) {
        strengthMeter.classList.remove('visible');
        checkFormValidity();
        return;
      }

      strengthMeter.classList.add('visible');

      try {
        const response = await fetch('/security/check-strength', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ password })
        });

        const result = await response.json();
        if (result.success) {
          lastAssessment = result.assessment;
          updateStrengthMeter(result.assessment);
        }
      } catch (error) {
        console.error('Password strength check failed:', error);
      }

      checkFormValidity();
    });

    // Confirm password matching
    document.getElementById('confirmPassword').addEventListener('input', checkFormValidity);
    document.getElementById('currentPassword').addEventListener('input', checkFormValidity);

    function updateStrengthMeter(assessment) {
      // Update strength bar
      const strengthFill = document.getElementById('strengthFill');
      strengthFill.style.width = assessment.score + '%';
      strengthFill.style.backgroundColor = assessment.color;

      // Update strength info
      document.getElementById('strengthLevel').textContent = assessment.level.replace('_', ' ').toUpperCase();
      document.getElementById('strengthLevel').style.color = assessment.color;
      document.getElementById('strengthScore').textContent = assessment.score + '/100';

      // Update message
      const messageEl = document.getElementById('strengthMessage');
      messageEl.textContent = assessment.message;
      messageEl.style.background = assessment.score >= 60 ? '#d4edda' : assessment.score >= 40 ? '#fff3cd' : '#f8d7da';
      messageEl.style.color = assessment.score >= 60 ? '#155724' : assessment.score >= 40 ? '#856404' : '#721c24';

      // Update requirements
      Object.keys(assessment.requirements).forEach(req => {
        const element = document.getElementById('req-' + req.replace(/([A-Z])/g, '-$1').toLowerCase());
        if (element) {
          if (assessment.requirements[req]) {
            element.className = 'requirement met';
            element.querySelector('span').textContent = '✅';
          } else {
            element.className = 'requirement not-met';
            element.querySelector('span').textContent = '❌';
          }
        }
      });

      // Update feedback
      const feedbackEl = document.getElementById('feedback');
      if (assessment.feedback.length > 0) {
        feedbackEl.style.display = 'block';
        feedbackEl.innerHTML = '<h4>Suggestions:</h4>' +
          assessment.feedback.map(f => '<div class="feedback-item">' + f + '</div>').join('');
      } else {
        feedbackEl.style.display = 'none';
      }

      // Update crack time
      const crackTimeEl = document.getElementById('crackTime');
      if (assessment.estimatedCrackTime) {
        crackTimeEl.style.display = 'block';
        document.getElementById('crackTimeValue').textContent = assessment.estimatedCrackTime;
      } else {
        crackTimeEl.style.display = 'none';
      }
    }

    function checkFormValidity() {
      const currentPassword = document.getElementById('currentPassword').value;
      const newPassword = document.getElementById('newPassword').value;
      const confirmPassword = document.getElementById('confirmPassword').value;
      const submitButton = document.getElementById('submitButton');

      const isValid = currentPassword.length > 0 &&
                      newPassword.length >= 8 &&
                      newPassword === confirmPassword &&
                      lastAssessment &&
                      lastAssessment.score >= 40;

      submitButton.disabled = !isValid;

      // Show password match status
      const confirmInput = document.getElementById('confirmPassword');
      if (confirmPassword.length > 0) {
        if (newPassword === confirmPassword) {
          confirmInput.style.borderColor = '#28a745';
        } else {
          confirmInput.style.borderColor = '#dc3545';
        }
      } else {
        confirmInput.style.borderColor = '#e9ecef';
      }
    }

    function togglePassword(fieldId) {
      const field = document.getElementById(fieldId);
      const button = field.nextElementSibling;

      if (field.type === 'password') {
        field.type = 'text';
        button.textContent = '🙈';
      } else {
        field.type = 'password';
        button.textContent = '👁️';
      }
    }

    // Form submission
    document.getElementById('passwordForm').addEventListener('submit', async function(e) {
      e.preventDefault();

      const submitButton = document.getElementById('submitButton');
      submitButton.disabled = true;
      submitButton.textContent = 'Updating...';

      try {
        // Simulate password update
        await new Promise(resolve => setTimeout(resolve, 2000));

        alert('Password updated successfully!');
        window.location.href = '/security/dashboard/${data.discordId}';
      } catch (error) {
        alert('Password update failed. Please try again.');
      } finally {
        submitButton.disabled = false;
        submitButton.textContent = 'Update Password';
      }
    });
  </script>
</body>
</html>`;
}
export { assessPasswordStrength };
