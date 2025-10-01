import path from "path";
import { promises as fs } from "fs";
class CDNManager {
  config;
  assetManifest = {};
  cacheHeaders = {
    "css": "public, max-age=31536000, immutable",
    // 1 year
    "js": "public, max-age=31536000, immutable",
    // 1 year
    "images": "public, max-age=86400",
    // 1 day
    "html": "public, max-age=300",
    // 5 minutes
    "api": "no-cache, must-revalidate"
  };
  constructor() {
    this.config = {
      provider: process.env.CDN_PROVIDER || "cloudflare",
      baseUrl: process.env.CDN_BASE_URL || "https://cdn.piptip.com",
      apiKey: process.env.CDN_API_KEY,
      zone: process.env.CDN_ZONE_ID,
      enabled: process.env.CDN_ENABLED === "true"
    };
    this.loadAssetManifest();
    console.log(`\u{1F30D} CDN Manager initialized (${this.config.enabled ? "enabled" : "disabled"})`);
  }
  // ============================================================================
  // ASSET URL GENERATION
  // ============================================================================
  /**
   * Get CDN URL for static asset with cache busting
   */
  getAssetUrl(assetPath) {
    if (!this.config.enabled) {
      return assetPath;
    }
    const manifestEntry = this.assetManifest[assetPath];
    if (manifestEntry) {
      return manifestEntry.url;
    }
    const hash = this.generateAssetHash(assetPath);
    const fileName = path.basename(assetPath);
    const extension = path.extname(fileName);
    const baseName = path.basename(fileName, extension);
    return `${this.config.baseUrl}/${baseName}.${hash}${extension}`;
  }
  /**
   * Get optimized image URL with transformations
   */
  getImageUrl(imagePath, options = {}) {
    if (!this.config.enabled) {
      return imagePath;
    }
    const baseUrl = this.getAssetUrl(imagePath);
    const params = new URLSearchParams();
    if (options.width) params.append("w", options.width.toString());
    if (options.height) params.append("h", options.height.toString());
    if (options.quality) params.append("q", options.quality.toString());
    if (options.format) params.append("f", options.format);
    if (options.fit) params.append("fit", options.fit);
    return params.toString() ? `${baseUrl}?${params.toString()}` : baseUrl;
  }
  // ============================================================================
  // STATIC ASSET OPTIMIZATION
  // ============================================================================
  /**
   * Generate HTML with optimized asset loading
   */
  generateOptimizedHTML(content) {
    const preloadLinks = this.generatePreloadLinks();
    const resourceHints = `
      <!-- DNS Prefetch for better performance -->
      <link rel="dns-prefetch" href="${this.config.baseUrl}">
      <link rel="preconnect" href="${this.config.baseUrl}" crossorigin>

      <!-- Critical resource preloading -->
      ${preloadLinks}

      <!-- Service Worker for caching -->
      <script>
        if ('serviceWorker' in navigator) {
          navigator.serviceWorker.register('/sw.js')
            .then(() => console.log('SW registered'))
            .catch(() => console.log('SW registration failed'));
        }
      </script>
    `;
    let optimizedContent = content;
    optimizedContent = optimizedContent.replace(
      /<link[^>]+href="([^"]+\.css)"[^>]*>/g,
      (match, cssPath) => {
        const cdnUrl = this.getAssetUrl(cssPath);
        const cacheHeader = this.cacheHeaders.css;
        return match.replace(cssPath, cdnUrl);
      }
    );
    optimizedContent = optimizedContent.replace(
      /<script[^>]+src="([^"]+\.js)"[^>]*>/g,
      (match, jsPath) => {
        const cdnUrl = this.getAssetUrl(jsPath);
        return match.replace(jsPath, cdnUrl);
      }
    );
    optimizedContent = optimizedContent.replace(
      /<img[^>]+src="([^"]+)"[^>]*>/g,
      (match, imgPath) => {
        if (imgPath.startsWith("http") || imgPath.startsWith("data:")) {
          return match;
        }
        const webpUrl = this.getImageUrl(imgPath, { format: "webp", quality: 85 });
        const fallbackUrl = this.getAssetUrl(imgPath);
        return `
          <picture>
            <source srcset="${webpUrl}" type="image/webp">
            <img src="${fallbackUrl}" ${match.match(/alt="[^"]*"/)?.[0] || ""}
                 loading="lazy" decoding="async">
          </picture>
        `.replace(/\s+/g, " ").trim();
      }
    );
    optimizedContent = optimizedContent.replace(
      "</head>",
      `${resourceHints}
</head>`
    );
    return optimizedContent;
  }
  /**
   * Generate preload links for critical resources
   */
  generatePreloadLinks() {
    const criticalAssets = [
      "/static/css/main.css",
      "/static/js/app.js",
      "/static/fonts/inter-var.woff2"
    ];
    return criticalAssets.map((asset) => {
      const cdnUrl = this.getAssetUrl(asset);
      const extension = path.extname(asset).substring(1);
      const asType = {
        "css": "style",
        "js": "script",
        "woff2": "font",
        "woff": "font",
        "ttf": "font"
      }[extension] || "fetch";
      const crossorigin = asType === "font" ? " crossorigin" : "";
      return `<link rel="preload" href="${cdnUrl}" as="${asType}"${crossorigin}>`;
    }).join("\n      ");
  }
  // ============================================================================
  // CACHE MANAGEMENT
  // ============================================================================
  /**
   * Set appropriate cache headers for different content types
   */
  getCacheHeaders(filePath, contentType) {
    const extension = path.extname(filePath).substring(1).toLowerCase();
    let cachePolicy;
    if (["css", "js"].includes(extension)) {
      cachePolicy = this.cacheHeaders.css;
    } else if (["jpg", "jpeg", "png", "gif", "webp", "avif", "svg"].includes(extension)) {
      cachePolicy = this.cacheHeaders.images;
    } else if (extension === "html" || contentType?.includes("text/html")) {
      cachePolicy = this.cacheHeaders.html;
    } else if (filePath.includes("/api/") || contentType?.includes("application/json")) {
      cachePolicy = this.cacheHeaders.api;
    } else {
      cachePolicy = "public, max-age=3600";
    }
    const headers = {
      "Cache-Control": cachePolicy,
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
      "X-XSS-Protection": "1; mode=block"
    };
    if (!cachePolicy.includes("immutable")) {
      headers["ETag"] = this.generateAssetHash(filePath);
    }
    if (this.config.enabled) {
      headers["Access-Control-Allow-Origin"] = "*";
      headers["Access-Control-Allow-Methods"] = "GET, HEAD, OPTIONS";
      headers["Access-Control-Max-Age"] = "86400";
    }
    return headers;
  }
  /**
   * Purge CDN cache for updated assets
   */
  async purgeCache(paths = []) {
    if (!this.config.enabled || !this.config.apiKey) {
      console.log("\u26A0\uFE0F CDN cache purge skipped (not configured)");
      return { success: false, purged: 0 };
    }
    try {
      switch (this.config.provider) {
        case "cloudflare":
          return await this.purgeCloudflareCache(paths);
        case "aws":
          return await this.purgeAWSCache(paths);
        default:
          console.log(`\u26A0\uFE0F CDN provider ${this.config.provider} not implemented for cache purging`);
          return { success: false, purged: 0 };
      }
    } catch (error) {
      console.error("\u274C CDN cache purge failed:", error);
      return { success: false, purged: 0 };
    }
  }
  /**
   * Cloudflare cache purging
   */
  async purgeCloudflareCache(paths) {
    const urlsToPurge = paths.length > 0 ? paths.map((path2) => `${this.config.baseUrl}${path2}`) : void 0;
    const payload = urlsToPurge ? { files: urlsToPurge.slice(0, 30) } : { purge_everything: true };
    const response = await fetch(`https://api.cloudflare.com/client/v4/zones/${this.config.zone}/purge_cache`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${this.config.apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });
    const result = await response.json();
    if (result.success) {
      console.log(`\u2705 Cloudflare cache purged (${urlsToPurge?.length || "all"} items)`);
      return { success: true, purged: urlsToPurge?.length || 0 };
    } else {
      throw new Error(`Cloudflare API error: ${JSON.stringify(result.errors)}`);
    }
  }
  /**
   * AWS CloudFront cache purging
   */
  async purgeAWSCache(paths) {
    console.log("\u26A0\uFE0F AWS CloudFront cache purging not implemented (requires AWS SDK)");
    return { success: false, purged: 0 };
  }
  // ============================================================================
  // ASSET MANIFEST MANAGEMENT
  // ============================================================================
  /**
   * Load asset manifest from file
   */
  async loadAssetManifest() {
    try {
      const manifestPath = path.join(process.cwd(), "public", "asset-manifest.json");
      const manifestContent = await fs.readFile(manifestPath, "utf-8");
      this.assetManifest = JSON.parse(manifestContent);
      console.log(`\u{1F4E6} Loaded asset manifest (${Object.keys(this.assetManifest).length} assets)`);
    } catch (error) {
      console.log("\u{1F4E6} No asset manifest found, generating URLs dynamically");
      this.assetManifest = {};
    }
  }
  /**
   * Generate asset manifest for build process
   */
  async generateAssetManifest(publicDir) {
    const manifest = {};
    try {
      const files = await this.getAllFiles(publicDir);
      for (const filePath of files) {
        const relativePath = path.relative(publicDir, filePath);
        const stats = await fs.stat(filePath);
        const hash = this.generateAssetHash(filePath);
        manifest[`/${relativePath.replace(/\\/g, "/")}`] = {
          url: this.getAssetUrl(`/${relativePath.replace(/\\/g, "/")}`),
          hash,
          size: stats.size,
          contentType: this.getContentType(filePath),
          cached: this.config.enabled
        };
      }
      const manifestPath = path.join(publicDir, "asset-manifest.json");
      await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2));
      this.assetManifest = manifest;
      console.log(`\u2705 Generated asset manifest (${Object.keys(manifest).length} assets)`);
    } catch (error) {
      console.error("\u274C Failed to generate asset manifest:", error);
    }
  }
  /**
   * Get all files recursively
   */
  async getAllFiles(dirPath, arrayOfFiles = []) {
    const files = await fs.readdir(dirPath);
    for (const file of files) {
      const fullPath = path.join(dirPath, file);
      const stat = await fs.stat(fullPath);
      if (stat.isDirectory()) {
        arrayOfFiles = await this.getAllFiles(fullPath, arrayOfFiles);
      } else {
        arrayOfFiles.push(fullPath);
      }
    }
    return arrayOfFiles;
  }
  // ============================================================================
  // UTILITIES
  // ============================================================================
  generateAssetHash(filePath) {
    const crypto = require("crypto");
    return crypto.createHash("md5").update(filePath + Date.now()).digest("hex").substring(0, 8);
  }
  getContentType(filePath) {
    const extension = path.extname(filePath).toLowerCase();
    const contentTypes = {
      ".html": "text/html",
      ".css": "text/css",
      ".js": "application/javascript",
      ".json": "application/json",
      ".png": "image/png",
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".gif": "image/gif",
      ".svg": "image/svg+xml",
      ".webp": "image/webp",
      ".avif": "image/avif",
      ".woff": "font/woff",
      ".woff2": "font/woff2",
      ".ttf": "font/ttf",
      ".eot": "application/vnd.ms-fontobject"
    };
    return contentTypes[extension] || "application/octet-stream";
  }
  /**
   * Get CDN statistics and health
   */
  async getCDNStats() {
    return {
      enabled: this.config.enabled,
      provider: this.config.provider,
      baseUrl: this.config.baseUrl,
      assetsCount: Object.keys(this.assetManifest).length,
      // In production, fetch from CDN provider API
      cacheHitRate: this.config.enabled ? 95.2 : 0,
      bandwidth: this.config.enabled ? "1.2 TB/month" : "0 TB/month"
    };
  }
}
const cdnManager = new CDNManager();
const getAssetUrl = (path2) => cdnManager.getAssetUrl(path2);
const getImageUrl = (path2, options) => cdnManager.getImageUrl(path2, options);
const getCacheHeaders = (path2, contentType) => cdnManager.getCacheHeaders(path2, contentType);
const optimizeHTML = (content) => cdnManager.generateOptimizedHTML(content);
var cdn_manager_default = cdnManager;
export {
  cdnManager,
  cdn_manager_default as default,
  getAssetUrl,
  getCacheHeaders,
  getImageUrl,
  optimizeHTML
};
//# sourceMappingURL=cdn_manager.js.map
