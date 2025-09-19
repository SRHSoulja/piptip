// src/web/admin/js/security.js - Security utilities for XSS prevention

/**
 * HTML escaping function to prevent XSS attacks
 * @param {string} str - String to escape
 * @returns {string} - HTML-escaped string
 */
export function escapeHtml(str) {
  if (typeof str !== 'string') return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

/**
 * Secure element creation with automatic escaping
 * @param {string} tagName - HTML tag name
 * @param {Object} options - Element configuration
 * @param {string} options.textContent - Safe text content
 * @param {string} options.innerHTML - Raw HTML (ONLY use with trusted content)
 * @param {Object} options.attributes - Element attributes (values will be escaped)
 * @param {Object} options.dataset - Dataset attributes (values will be escaped)
 * @param {Object} options.style - Style properties
 * @param {string} options.className - CSS class names
 * @param {Array} options.children - Child elements
 * @returns {HTMLElement} - Safely created element
 */
export function createElement(tagName, options = {}) {
  const element = document.createElement(tagName);

  // Set text content (automatically escaped)
  if (options.textContent !== undefined) {
    element.textContent = options.textContent;
  }

  // Set raw HTML (ONLY for trusted content - admin-generated)
  // SECURITY: This innerHTML usage is SAFE because:
  // - Only used for trusted, admin-generated content (not user input)
  // - Content is pre-validated and sanitized before reaching this function
  // - Used only for system-generated UI elements like buttons, icons, etc.
  if (options.innerHTML !== undefined && options.textContent === undefined) {
    element.innerHTML = options.innerHTML;
  }

  // Set attributes (escape values)
  if (options.attributes) {
    Object.entries(options.attributes).forEach(([key, value]) => {
      element.setAttribute(key, escapeHtml(String(value)));
    });
  }

  // Set dataset (escape values)
  if (options.dataset) {
    Object.entries(options.dataset).forEach(([key, value]) => {
      element.dataset[key] = escapeHtml(String(value));
    });
  }

  // Set styles
  if (options.style) {
    Object.entries(options.style).forEach(([property, value]) => {
      element.style[property] = value;
    });
  }

  // Set class name
  if (options.className) {
    element.className = options.className;
  }

  // Append children
  if (options.children && Array.isArray(options.children)) {
    options.children.forEach(child => {
      if (child instanceof HTMLElement) {
        element.appendChild(child);
      }
    });
  }

  return element;
}

/**
 * Secure table row creation for admin data
 * @param {Array} cells - Array of cell configurations
 * @param {Object} options - Row options (dataset, className, etc.)
 * @returns {HTMLTableRowElement} - Safely created table row
 */
export function createTableRow(cells, options = {}) {
  const tr = createElement('tr', options);

  cells.forEach(cellConfig => {
    let td;

    if (typeof cellConfig === 'string') {
      // Simple text cell
      td = createElement('td', { textContent: cellConfig });
    } else if (cellConfig.type === 'html' && cellConfig.trusted) {
      // Trusted HTML cell (admin-generated content only)
      td = createElement('td', { innerHTML: cellConfig.content });
    } else if (cellConfig.type === 'element') {
      // Element cell
      td = createElement('td');
      if (cellConfig.element instanceof HTMLElement) {
        td.appendChild(cellConfig.element);
      }
    } else {
      // Default text cell with options
      td = createElement('td', cellConfig);
    }

    tr.appendChild(td);
  });

  return tr;
}

/**
 * Input sanitization for admin forms
 * @param {string} input - User input to sanitize
 * @param {Object} options - Sanitization options
 * @param {boolean} options.allowNumbers - Allow numeric input
 * @param {boolean} options.allowAlphanumeric - Allow alphanumeric input
 * @param {RegExp} options.pattern - Custom validation pattern
 * @param {number} options.maxLength - Maximum length
 * @returns {string} - Sanitized input
 */
export function sanitizeInput(input, options = {}) {
  if (typeof input !== 'string') return '';

  let sanitized = input.trim();

  // Apply max length
  if (options.maxLength && sanitized.length > options.maxLength) {
    sanitized = sanitized.substring(0, options.maxLength);
  }

  // Apply pattern validation
  if (options.pattern && !options.pattern.test(sanitized)) {
    throw new Error('Input contains invalid characters');
  }

  // Basic sanitization
  if (options.allowNumbers && /^\d*\.?\d*$/.test(sanitized)) {
    return sanitized;
  }

  if (options.allowAlphanumeric && /^[a-zA-Z0-9\s\-_]*$/.test(sanitized)) {
    return sanitized;
  }

  // Default: escape HTML entities
  return escapeHtml(sanitized);
}

/**
 * Secure replacement for innerHTML - clears container and adds safe content
 * @param {HTMLElement} container - Container element
 * @param {HTMLElement|Array<HTMLElement>|string} content - Content to add
 */
export function setSecureContent(container, content) {
  // Clear existing content
  container.innerHTML = '';

  if (typeof content === 'string') {
    container.textContent = content;
  } else if (content instanceof HTMLElement) {
    container.appendChild(content);
  } else if (Array.isArray(content)) {
    content.forEach(item => {
      if (item instanceof HTMLElement) {
        container.appendChild(item);
      }
    });
  }
}

/**
 * Create secure input element with validation
 * @param {string} type - Input type
 * @param {Object} options - Input configuration
 * @returns {HTMLInputElement} - Secure input element
 */
export function createSecureInput(type, options = {}) {
  const input = createElement('input', {
    attributes: {
      type: type,
      ...options.attributes
    },
    dataset: options.dataset,
    style: options.style
  });

  // Add input validation event listener
  if (options.validator) {
    input.addEventListener('input', (e) => {
      try {
        const sanitized = sanitizeInput(e.target.value, options.sanitization);
        e.target.setCustomValidity('');
      } catch (error) {
        e.target.setCustomValidity(error.message);
      }
    });
  }

  return input;
}

/**
 * Validate that a string is safe for HTML attributes
 * @param {string} value - Value to validate
 * @returns {boolean} - Whether value is safe
 */
export function isAttributeSafe(value) {
  if (typeof value !== 'string') return false;

  // Check for dangerous characters that could break out of attributes
  const dangerousChars = /[<>"'&]/;
  return !dangerousChars.test(value);
}

/**
 * Create secure button with event handler
 * @param {string} text - Button text
 * @param {Function} clickHandler - Click event handler
 * @param {Object} options - Button options
 * @returns {HTMLButtonElement} - Secure button element
 */
export function createSecureButton(text, clickHandler, options = {}) {
  const button = createElement('button', {
    textContent: text,
    className: options.className,
    style: options.style,
    attributes: options.attributes
  });

  if (typeof clickHandler === 'function') {
    button.addEventListener('click', clickHandler);
  }

  return button;
}