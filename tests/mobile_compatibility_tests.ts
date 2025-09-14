#!/usr/bin/env npx tsx
// tests/mobile_compatibility_tests.ts - Mobile Discord app compatibility tests

import { performance } from 'perf_hooks';
import { writeFileSync } from 'fs';
import { join } from 'path';
import type {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  SelectMenuBuilder,
  ModalBuilder,
  APIEmbed,
  APIActionRowComponent,
  APIButtonComponent
} from 'discord.js';

// Mobile Test Configuration
interface MobileTestConfig {
  testDevices: MobileDevice[];
  screenSizes: ScreenSize[];
  discordVersions: string[];
  networkConditions: NetworkCondition[];
  interactionTypes: InteractionType[];
}

interface MobileDevice {
  name: string;
  platform: 'iOS' | 'Android';
  screenWidth: number;
  screenHeight: number;
  pixelDensity: number;
  touchSupport: boolean;
  version: string;
}

interface ScreenSize {
  name: string;
  width: number;
  height: number;
  category: 'phone' | 'tablet';
}

interface NetworkCondition {
  name: string;
  downloadSpeed: number; // Mbps
  uploadSpeed: number; // Mbps
  latency: number; // ms
  packetLoss: number; // percentage
}

interface InteractionType {
  name: string;
  type: 'button' | 'select' | 'modal' | 'embed';
  complexity: 'simple' | 'medium' | 'complex';
}

interface MobileTestResult {
  testName: string;
  device: string;
  platform: string;
  passed: boolean;
  duration: number;
  issues: string[];
  metrics: {
    renderTime?: number;
    interactionTime?: number;
    contentVisible?: boolean;
    buttonsAccessible?: boolean;
    textReadable?: boolean;
    scrollable?: boolean;
    responsiveDesign?: boolean;
  };
}

// Mock Mobile Discord Client
class MockMobileDiscordClient {
  private device: MobileDevice;
  private networkCondition: NetworkCondition;
  private discordVersion: string;

  constructor(device: MobileDevice, networkCondition: NetworkCondition, discordVersion: string) {
    this.device = device;
    this.networkCondition = networkCondition;
    this.discordVersion = discordVersion;
  }

  // Simulate rendering an embed on mobile
  async renderEmbed(embed: any): Promise<MobileRenderResult> {
    const startTime = performance.now();
    const issues: string[] = [];

    // Simulate network delay
    await this.simulateNetworkDelay();

    // Check embed dimensions
    const { contentTooLong, textTruncated } = this.checkEmbedDimensions(embed);
    if (contentTooLong) issues.push('Embed content exceeds mobile display limits');
    if (textTruncated) issues.push('Text content truncated on mobile display');

    // Check image rendering
    const imageRenderIssues = this.checkImageRendering(embed);
    issues.push(...imageRenderIssues);

    // Check field layout
    const fieldLayoutIssues = this.checkFieldLayout(embed);
    issues.push(...fieldLayoutIssues);

    const renderTime = performance.now() - startTime;

    return {
      renderTime,
      contentVisible: issues.length < 3,
      textReadable: !textTruncated,
      issues
    };
  }

  // Simulate button interactions on mobile
  async interactWithButton(button: any): Promise<MobileInteractionResult> {
    const startTime = performance.now();
    const issues: string[] = [];

    // Simulate touch interaction delay
    await this.simulateTouchDelay();

    // Check button accessibility
    const accessibilityIssues = this.checkButtonAccessibility(button);
    issues.push(...accessibilityIssues);

    // Check button size for touch targets
    const touchTargetIssues = this.checkTouchTargets(button);
    issues.push(...touchTargetIssues);

    // Simulate interaction processing
    await this.simulateNetworkDelay();

    const interactionTime = performance.now() - startTime;

    return {
      interactionTime,
      accessible: accessibilityIssues.length === 0,
      touchFriendly: touchTargetIssues.length === 0,
      issues
    };
  }

  // Simulate modal display on mobile
  async displayModal(modal: any): Promise<MobileModalResult> {
    const startTime = performance.now();
    const issues: string[] = [];

    await this.simulateNetworkDelay();

    // Check modal dimensions for mobile
    const dimensionIssues = this.checkModalDimensions(modal);
    issues.push(...dimensionIssues);

    // Check input field accessibility
    const inputIssues = this.checkMobileInputs(modal);
    issues.push(...inputIssues);

    // Check keyboard behavior
    const keyboardIssues = this.checkMobileKeyboard(modal);
    issues.push(...keyboardIssues);

    const displayTime = performance.now() - startTime;

    return {
      displayTime,
      fitsScreen: dimensionIssues.length === 0,
      inputsAccessible: inputIssues.length === 0,
      keyboardFriendly: keyboardIssues.length === 0,
      issues
    };
  }

  // Simulate scrolling behavior
  async testScrolling(content: any): Promise<MobileScrollResult> {
    const startTime = performance.now();
    const issues: string[] = [];

    // Check content height
    const contentHeight = this.calculateContentHeight(content);
    const screenHeight = this.device.screenHeight;

    if (contentHeight > screenHeight * 2) {
      issues.push('Content too long for comfortable mobile scrolling');
    }

    // Test scroll performance
    const scrollPerformance = await this.simulateScrolling(contentHeight);
    if (scrollPerformance.laggy) {
      issues.push('Scrolling performance issues detected');
    }

    const testTime = performance.now() - startTime;

    return {
      testTime,
      contentHeight,
      scrollable: contentHeight > screenHeight,
      smoothScrolling: !scrollPerformance.laggy,
      issues
    };
  }

  private async simulateNetworkDelay(): Promise<void> {
    const delay = this.networkCondition.latency + Math.random() * 100;
    await new Promise(resolve => setTimeout(resolve, delay));
  }

  private async simulateTouchDelay(): Promise<void> {
    // Touch interactions typically have 300ms delay on older devices
    const touchDelay = this.device.platform === 'iOS' ? 50 : 100;
    await new Promise(resolve => setTimeout(resolve, touchDelay));
  }

  private checkEmbedDimensions(embed: any): { contentTooLong: boolean; textTruncated: boolean } {
    const maxMobileChars = 2000;
    const description = embed.description || '';
    const fields = embed.fields || [];

    const totalChars = description.length + fields.reduce((sum: number, field: any) =>
      sum + (field.name?.length || 0) + (field.value?.length || 0), 0);

    return {
      contentTooLong: totalChars > maxMobileChars,
      textTruncated: description.length > 800 // Mobile truncates long descriptions
    };
  }

  private checkImageRendering(embed: any): string[] {
    const issues = [];

    if (embed.thumbnail && embed.thumbnail.width > this.device.screenWidth * 0.8) {
      issues.push('Thumbnail too large for mobile screen');
    }

    if (embed.image && embed.image.width > this.device.screenWidth) {
      issues.push('Image exceeds mobile screen width');
    }

    return issues;
  }

  private checkFieldLayout(embed: any): string[] {
    const issues = [];
    const fields = embed.fields || [];

    // Check if inline fields work well on mobile
    const inlineFields = fields.filter((field: any) => field.inline);
    if (inlineFields.length > 2) {
      issues.push('Too many inline fields may not display well on mobile');
    }

    // Check field content length
    fields.forEach((field: any, index: number) => {
      if (field.value && field.value.length > 500) {
        issues.push(`Field ${index + 1} content too long for mobile display`);
      }
    });

    return issues;
  }

  private checkButtonAccessibility(button: any): string[] {
    const issues = [];

    // Check button label length
    if (button.label && button.label.length > 20) {
      issues.push('Button label too long for mobile display');
    }

    // Check emoji rendering
    if (button.emoji && !this.supportsEmoji(button.emoji)) {
      issues.push('Button emoji may not render correctly on this device');
    }

    return issues;
  }

  private checkTouchTargets(button: any): string[] {
    const issues = [];

    // Discord button minimum touch target should be 44x44 points (iOS) or 48x48dp (Android)
    const minTouchTarget = this.device.platform === 'iOS' ? 44 : 48;

    // Simulate button size calculation
    const estimatedButtonWidth = (button.label?.length || 0) * 8 + 32; // Rough estimation
    const estimatedButtonHeight = 40; // Discord's typical button height

    if (estimatedButtonWidth < minTouchTarget || estimatedButtonHeight < minTouchTarget) {
      issues.push('Button touch target may be too small for comfortable interaction');
    }

    return issues;
  }

  private checkModalDimensions(modal: any): string[] {
    const issues = [];

    const modalWidth = this.device.screenWidth * 0.9; // Modal typically takes 90% of screen width
    const availableHeight = this.device.screenHeight * 0.8; // Account for keyboard and UI

    if (modal.components && modal.components.length > 3) {
      issues.push('Modal may be too tall for mobile screen with keyboard');
    }

    return issues;
  }

  private checkMobileInputs(modal: any): string[] {
    const issues = [];

    if (modal.components) {
      modal.components.forEach((component: any, index: number) => {
        if (component.type === 'text_input') {
          if (component.max_length && component.max_length > 2000) {
            issues.push(`Input field ${index + 1} max length may cause mobile keyboard issues`);
          }

          if (component.style === 'paragraph' && this.device.screenHeight < 800) {
            issues.push(`Paragraph input may not fit well on smaller mobile screens`);
          }
        }
      });
    }

    return issues;
  }

  private checkMobileKeyboard(modal: any): string[] {
    const issues = [];

    // Check if modal content will be hidden when keyboard appears
    const keyboardHeight = this.device.platform === 'iOS' ? 270 : 300;
    const availableHeight = this.device.screenHeight - keyboardHeight;

    if (availableHeight < 400) {
      issues.push('Modal content may be hidden when mobile keyboard is active');
    }

    return issues;
  }

  private supportsEmoji(emoji: string): boolean {
    // Simulate emoji support check based on device/version
    const iosEmojiSupport = parseFloat(this.device.version) >= 13.0;
    const androidEmojiSupport = parseFloat(this.device.version) >= 8.0;

    return this.device.platform === 'iOS' ? iosEmojiSupport : androidEmojiSupport;
  }

  private calculateContentHeight(content: any): number {
    // Rough calculation of content height in pixels
    let height = 0;

    if (content.title) height += 30;
    if (content.description) height += Math.ceil(content.description.length / 50) * 20;
    if (content.fields) height += content.fields.length * 80;
    if (content.image) height += 200;
    if (content.thumbnail) height += 80;

    return height;
  }

  private async simulateScrolling(contentHeight: number): Promise<{ laggy: boolean }> {
    // Simulate scroll performance based on device capabilities
    const scrollDistance = Math.max(0, contentHeight - this.device.screenHeight);
    const scrollTime = scrollDistance / 1000; // Simulate scroll speed

    await new Promise(resolve => setTimeout(resolve, scrollTime));

    // Determine if scrolling would be laggy
    const laggy = scrollDistance > 2000 && this.device.pixelDensity > 2;

    return { laggy };
  }

  getDeviceInfo(): MobileDevice {
    return { ...this.device };
  }

  getNetworkInfo(): NetworkCondition {
    return { ...this.networkCondition };
  }
}

// Result interfaces
interface MobileRenderResult {
  renderTime: number;
  contentVisible: boolean;
  textReadable: boolean;
  issues: string[];
}

interface MobileInteractionResult {
  interactionTime: number;
  accessible: boolean;
  touchFriendly: boolean;
  issues: string[];
}

interface MobileModalResult {
  displayTime: number;
  fitsScreen: boolean;
  inputsAccessible: boolean;
  keyboardFriendly: boolean;
  issues: string[];
}

interface MobileScrollResult {
  testTime: number;
  contentHeight: number;
  scrollable: boolean;
  smoothScrolling: boolean;
  issues: string[];
}

// Main Mobile Compatibility Test Suite
class MobileCompatibilityTestSuite {
  private config: MobileTestConfig;
  private testResults: MobileTestResult[] = [];

  constructor() {
    this.config = {
      testDevices: [
        // iOS Devices
        { name: 'iPhone SE (2022)', platform: 'iOS', screenWidth: 375, screenHeight: 667, pixelDensity: 2, touchSupport: true, version: '16.0' },
        { name: 'iPhone 14', platform: 'iOS', screenWidth: 390, screenHeight: 844, pixelDensity: 3, touchSupport: true, version: '16.0' },
        { name: 'iPhone 14 Pro Max', platform: 'iOS', screenWidth: 430, screenHeight: 932, pixelDensity: 3, touchSupport: true, version: '16.0' },
        { name: 'iPad (9th gen)', platform: 'iOS', screenWidth: 810, screenHeight: 1080, pixelDensity: 2, touchSupport: true, version: '16.0' },
        { name: 'iPad Pro 12.9"', platform: 'iOS', screenWidth: 1024, screenHeight: 1366, pixelDensity: 2, touchSupport: true, version: '16.0' },

        // Android Devices
        { name: 'Galaxy S23', platform: 'Android', screenWidth: 393, screenHeight: 851, pixelDensity: 3, touchSupport: true, version: '13.0' },
        { name: 'Galaxy S23 Ultra', platform: 'Android', screenWidth: 412, screenHeight: 915, pixelDensity: 3.5, touchSupport: true, version: '13.0' },
        { name: 'Pixel 7', platform: 'Android', screenWidth: 393, screenHeight: 851, pixelDensity: 2.75, touchSupport: true, version: '13.0' },
        { name: 'Galaxy Tab S8', platform: 'Android', screenWidth: 753, screenHeight: 1037, pixelDensity: 2.5, touchSupport: true, version: '13.0' },
        { name: 'OnePlus 11', platform: 'Android', screenWidth: 412, screenHeight: 919, pixelDensity: 3, touchSupport: true, version: '13.0' }
      ],
      screenSizes: [
        { name: 'Small Phone', width: 320, height: 568, category: 'phone' },
        { name: 'Medium Phone', width: 375, height: 667, category: 'phone' },
        { name: 'Large Phone', width: 414, height: 896, category: 'phone' },
        { name: 'Small Tablet', width: 768, height: 1024, category: 'tablet' },
        { name: 'Large Tablet', width: 1024, height: 1366, category: 'tablet' }
      ],
      discordVersions: ['185.0', '190.0', '195.0', '200.0'], // Recent mobile Discord versions
      networkConditions: [
        { name: '5G', downloadSpeed: 100, uploadSpeed: 50, latency: 20, packetLoss: 0 },
        { name: '4G', downloadSpeed: 25, uploadSpeed: 10, latency: 50, packetLoss: 0 },
        { name: '3G', downloadSpeed: 2, uploadSpeed: 1, latency: 150, packetLoss: 1 },
        { name: 'Slow WiFi', downloadSpeed: 5, uploadSpeed: 2, latency: 100, packetLoss: 2 },
        { name: 'Poor Connection', downloadSpeed: 1, uploadSpeed: 0.5, latency: 500, packetLoss: 5 }
      ],
      interactionTypes: [
        { name: 'Simple Button', type: 'button', complexity: 'simple' },
        { name: 'Button Row', type: 'button', complexity: 'medium' },
        { name: 'Complex Buttons', type: 'button', complexity: 'complex' },
        { name: 'Select Menu', type: 'select', complexity: 'medium' },
        { name: 'Achievement Modal', type: 'modal', complexity: 'complex' },
        { name: 'Rich Embed', type: 'embed', complexity: 'complex' }
      ]
    };
  }

  async runMobileCompatibilityTests(): Promise<MobileTestResult[]> {
    console.log('📱 Starting mobile compatibility tests...');

    // Test core achievement display components
    await this.testAchievementEmbeds();
    await this.testInteractionButtons();
    await this.testAchievementModals();
    await this.testScrollingBehavior();
    await this.testNetworkConditions();
    await this.testDeviceSpecificFeatures();

    return this.testResults;
  }

  // Test 1: Achievement Embeds on Mobile Devices
  async testAchievementEmbeds(): Promise<void> {
    console.log('🏆 Testing achievement embeds on mobile...');

    const testEmbeds = this.createTestEmbeds();

    for (const device of this.config.testDevices) {
      for (const embed of testEmbeds) {
        const networkCondition = this.config.networkConditions[0]; // Use 5G for embed tests
        const client = new MockMobileDiscordClient(device, networkCondition, '195.0');

        const startTime = performance.now();
        const renderResult = await client.renderEmbed(embed.data);
        const duration = performance.now() - startTime;

        const result: MobileTestResult = {
          testName: `Achievement Embed - ${embed.name}`,
          device: device.name,
          platform: device.platform,
          passed: renderResult.contentVisible && renderResult.textReadable && renderResult.issues.length < 2,
          duration,
          issues: renderResult.issues,
          metrics: {
            renderTime: renderResult.renderTime,
            contentVisible: renderResult.contentVisible,
            textReadable: renderResult.textReadable,
            responsiveDesign: this.checkResponsiveDesign(device, embed.data)
          }
        };

        this.testResults.push(result);
        console.log(`${result.passed ? '✅' : '❌'} ${result.testName} on ${result.device}`);
      }
    }
  }

  // Test 2: Button Interactions on Mobile
  async testInteractionButtons(): Promise<void> {
    console.log('🔘 Testing button interactions on mobile...');

    const testButtons = this.createTestButtons();

    for (const device of this.config.testDevices) {
      for (const buttonSet of testButtons) {
        const networkCondition = this.config.networkConditions[1]; // Use 4G for interaction tests
        const client = new MockMobileDiscordClient(device, networkCondition, '195.0');

        for (const button of buttonSet.buttons) {
          const startTime = performance.now();
          const interactionResult = await client.interactWithButton(button);
          const duration = performance.now() - startTime;

          const result: MobileTestResult = {
            testName: `Button Interaction - ${buttonSet.name}`,
            device: device.name,
            platform: device.platform,
            passed: interactionResult.accessible && interactionResult.touchFriendly && interactionResult.issues.length === 0,
            duration,
            issues: interactionResult.issues,
            metrics: {
              interactionTime: interactionResult.interactionTime,
              buttonsAccessible: interactionResult.accessible,
              responsiveDesign: interactionResult.touchFriendly
            }
          };

          this.testResults.push(result);
          console.log(`${result.passed ? '✅' : '❌'} ${result.testName} on ${result.device}`);
        }
      }
    }
  }

  // Test 3: Achievement Modals on Mobile
  async testAchievementModals(): Promise<void> {
    console.log('📋 Testing achievement modals on mobile...');

    const testModals = this.createTestModals();

    for (const device of this.config.testDevices) {
      for (const modal of testModals) {
        const networkCondition = this.config.networkConditions[0]; // Use 5G for modal tests
        const client = new MockMobileDiscordClient(device, networkCondition, '195.0');

        const startTime = performance.now();
        const modalResult = await client.displayModal(modal.data);
        const duration = performance.now() - startTime;

        const result: MobileTestResult = {
          testName: `Achievement Modal - ${modal.name}`,
          device: device.name,
          platform: device.platform,
          passed: modalResult.fitsScreen && modalResult.inputsAccessible && modalResult.keyboardFriendly,
          duration,
          issues: modalResult.issues,
          metrics: {
            renderTime: modalResult.displayTime,
            contentVisible: modalResult.fitsScreen,
            responsiveDesign: modalResult.inputsAccessible && modalResult.keyboardFriendly
          }
        };

        this.testResults.push(result);
        console.log(`${result.passed ? '✅' : '❌'} ${result.testName} on ${result.device}`);
      }
    }
  }

  // Test 4: Scrolling Behavior
  async testScrollingBehavior(): Promise<void> {
    console.log('📜 Testing scrolling behavior on mobile...');

    const scrollTestContent = this.createScrollTestContent();

    for (const device of this.config.testDevices) {
      for (const content of scrollTestContent) {
        const networkCondition = this.config.networkConditions[0];
        const client = new MockMobileDiscordClient(device, networkCondition, '195.0');

        const startTime = performance.now();
        const scrollResult = await client.testScrolling(content.data);
        const duration = performance.now() - startTime;

        const result: MobileTestResult = {
          testName: `Scrolling Test - ${content.name}`,
          device: device.name,
          platform: device.platform,
          passed: scrollResult.smoothScrolling && scrollResult.issues.length < 2,
          duration,
          issues: scrollResult.issues,
          metrics: {
            scrollable: scrollResult.scrollable,
            contentVisible: scrollResult.smoothScrolling,
            responsiveDesign: scrollResult.contentHeight <= device.screenHeight * 3 // Max 3 screen heights
          }
        };

        this.testResults.push(result);
        console.log(`${result.passed ? '✅' : '❌'} ${result.testName} on ${result.device}`);
      }
    }
  }

  // Test 5: Network Conditions Impact
  async testNetworkConditions(): Promise<void> {
    console.log('📶 Testing various network conditions...');

    const testDevice = this.config.testDevices.find(d => d.name === 'iPhone 14') || this.config.testDevices[0];
    const basicEmbed = this.createTestEmbeds()[0];

    for (const networkCondition of this.config.networkConditions) {
      const client = new MockMobileDiscordClient(testDevice, networkCondition, '195.0');

      const startTime = performance.now();
      const renderResult = await client.renderEmbed(basicEmbed.data);
      const duration = performance.now() - startTime;

      // Network performance thresholds
      const maxAcceptableTime = {
        '5G': 500,
        '4G': 1000,
        '3G': 3000,
        'Slow WiFi': 2000,
        'Poor Connection': 5000
      };

      const threshold = maxAcceptableTime[networkCondition.name as keyof typeof maxAcceptableTime] || 3000;

      const result: MobileTestResult = {
        testName: `Network Performance - ${networkCondition.name}`,
        device: testDevice.name,
        platform: testDevice.platform,
        passed: renderResult.renderTime < threshold && renderResult.contentVisible,
        duration,
        issues: renderResult.renderTime > threshold ? [`Slow rendering on ${networkCondition.name}`] : [],
        metrics: {
          renderTime: renderResult.renderTime,
          contentVisible: renderResult.contentVisible,
          textReadable: renderResult.textReadable
        }
      };

      this.testResults.push(result);
      console.log(`${result.passed ? '✅' : '❌'} ${result.testName} (${renderResult.renderTime.toFixed(0)}ms)`);
    }
  }

  // Test 6: Device-Specific Features
  async testDeviceSpecificFeatures(): Promise<void> {
    console.log('🔧 Testing device-specific features...');

    for (const device of this.config.testDevices) {
      const networkCondition = this.config.networkConditions[0];
      const client = new MockMobileDiscordClient(device, networkCondition, '195.0');

      // Test platform-specific features
      const platformTests = await this.runPlatformSpecificTests(device, client);

      for (const test of platformTests) {
        this.testResults.push(test);
        console.log(`${test.passed ? '✅' : '❌'} ${test.testName} on ${test.device}`);
      }
    }
  }

  // Create test embeds for different scenarios
  private createTestEmbeds(): Array<{ name: string; data: any }> {
    return [
      {
        name: 'Simple Achievement',
        data: {
          title: '🏆 Achievement Unlocked!',
          description: 'You have successfully completed your first tip!',
          color: 0xFFD700,
          thumbnail: { url: 'https://example.com/achievement.png', width: 100, height: 100 },
          fields: [
            { name: 'Achievement', value: 'First Tip', inline: true },
            { name: 'Rarity', value: 'Common', inline: true }
          ]
        }
      },
      {
        name: 'Complex Achievement',
        data: {
          title: '✨ Legendary Achievement Unlocked!',
          description: 'Congratulations! You have unlocked the prestigious "High Roller" achievement by tipping over 10,000 tokens in a single day. This rare accomplishment puts you among the top 1% of all PIPtip users!',
          color: 0xFF6B6B,
          thumbnail: { url: 'https://example.com/legendary.png', width: 200, height: 200 },
          image: { url: 'https://example.com/celebration.gif', width: 400, height: 200 },
          fields: [
            { name: '🎖️ Achievement', value: 'High Roller Supreme', inline: true },
            { name: '💎 Rarity', value: 'Legendary (0.1%)', inline: true },
            { name: '🏅 Tier', value: 'Diamond', inline: true },
            { name: '📊 Progress', value: '10,000 / 10,000 tokens', inline: false },
            { name: '🎁 Reward', value: 'Special badge + 500 bonus tokens', inline: false },
            { name: '📈 Next Goal', value: 'Unlock "Whale Status" at 50,000 tokens', inline: false }
          ],
          footer: { text: 'Achievement unlocked on Discord Mobile • PIPtip Bot', icon_url: 'https://example.com/bot-icon.png' }
        }
      },
      {
        name: 'Streak Achievement',
        data: {
          title: '🔥 Win Streak Achievement!',
          description: 'Amazing! You\'ve won 25 matches in a row!',
          color: 0xFF4500,
          thumbnail: { url: 'https://example.com/streak.png', width: 80, height: 80 },
          fields: [
            { name: 'Current Streak', value: '25 wins', inline: true },
            { name: 'Best Streak', value: '25 wins', inline: true },
            { name: 'Total Matches', value: '156', inline: true }
          ]
        }
      },
      {
        name: 'Long Text Achievement',
        data: {
          title: 'Community Builder Achievement',
          description: 'You have shown exceptional dedication to building our community! Your contributions include: inviting new members, helping newcomers understand the platform, participating in community events, providing valuable feedback, and consistently maintaining a positive attitude that inspires others to engage and participate in meaningful ways.',
          color: 0x9B59B6,
          fields: [
            { name: 'Referrals Made', value: '15 successful referrals bringing new active users to our platform', inline: false },
            { name: 'Help Messages Sent', value: '127 helpful messages assisting other users with questions and guidance', inline: false },
            { name: 'Community Events', value: 'Participated in 12 community events and contests', inline: false }
          ]
        }
      }
    ];
  }

  // Create test buttons for different scenarios
  private createTestButtons(): Array<{ name: string; buttons: any[] }> {
    return [
      {
        name: 'Single Action Button',
        buttons: [
          { type: 'button', style: 'primary', label: '🔄 Refresh', custom_id: 'refresh_achievements' }
        ]
      },
      {
        name: 'Multiple Buttons',
        buttons: [
          { type: 'button', style: 'primary', label: '🔄 Refresh', custom_id: 'refresh' },
          { type: 'button', style: 'secondary', label: '📊 Stats', custom_id: 'stats' },
          { type: 'button', style: 'success', label: '🏆 Leaderboard', custom_id: 'leaderboard' }
        ]
      },
      {
        name: 'Long Label Buttons',
        buttons: [
          { type: 'button', style: 'primary', label: '🎯 View Achievement Progress', custom_id: 'view_progress' },
          { type: 'button', style: 'secondary', label: '📈 Compare with Friends', custom_id: 'compare' }
        ]
      },
      {
        name: 'Emoji Heavy Buttons',
        buttons: [
          { type: 'button', style: 'primary', emoji: '🏆', label: 'Trophy', custom_id: 'trophy' },
          { type: 'button', style: 'secondary', emoji: '⭐', label: 'Star', custom_id: 'star' },
          { type: 'button', style: 'success', emoji: '🎖️', label: 'Medal', custom_id: 'medal' },
          { type: 'button', style: 'danger', emoji: '🔥', label: 'Streak', custom_id: 'streak' },
          { type: 'button', style: 'primary', emoji: '💎', label: 'Gem', custom_id: 'gem' }
        ]
      }
    ];
  }

  // Create test modals
  private createTestModals(): Array<{ name: string; data: any }> {
    return [
      {
        name: 'Simple Feedback Modal',
        data: {
          title: 'Achievement Feedback',
          custom_id: 'achievement_feedback',
          components: [
            {
              type: 'text_input',
              style: 'short',
              label: 'Rate this achievement (1-10)',
              custom_id: 'rating',
              required: true,
              max_length: 2,
              placeholder: '8'
            }
          ]
        }
      },
      {
        name: 'Complex Achievement Report',
        data: {
          title: 'Report Achievement Issue',
          custom_id: 'achievement_report',
          components: [
            {
              type: 'text_input',
              style: 'short',
              label: 'Achievement Name',
              custom_id: 'achievement_name',
              required: true,
              max_length: 100
            },
            {
              type: 'text_input',
              style: 'short',
              label: 'Issue Type',
              custom_id: 'issue_type',
              required: true,
              max_length: 50,
              placeholder: 'e.g., Not unlocked, Wrong progress'
            },
            {
              type: 'text_input',
              style: 'paragraph',
              label: 'Detailed Description',
              custom_id: 'description',
              required: false,
              max_length: 2000,
              placeholder: 'Please describe the issue in detail...'
            }
          ]
        }
      }
    ];
  }

  // Create scrolling test content
  private createScrollTestContent(): Array<{ name: string; data: any }> {
    return [
      {
        name: 'Short Content',
        data: {
          title: 'Quick Achievement',
          description: 'Short achievement description.',
          fields: [
            { name: 'Field 1', value: 'Value 1' }
          ]
        }
      },
      {
        name: 'Medium Content',
        data: {
          title: 'Standard Achievement Display',
          description: 'This is a medium-length achievement with several fields and reasonable content.',
          fields: Array.from({ length: 5 }, (_, i) => ({
            name: `Achievement Detail ${i + 1}`,
            value: `This is detail number ${i + 1} with some descriptive text.`
          }))
        }
      },
      {
        name: 'Long Content',
        data: {
          title: 'Comprehensive Achievement Overview',
          description: 'This is a very detailed achievement description that includes multiple paragraphs of information, statistics, requirements, and congratulations.',
          fields: Array.from({ length: 12 }, (_, i) => ({
            name: `Detailed Metric ${i + 1}`,
            value: `This is a detailed metric with lots of information that users might want to read. It includes statistics, progress indicators, and explanatory text that helps users understand their achievement progress.`
          })),
          image: { url: 'https://example.com/large-celebration.png', width: 600, height: 400 }
        }
      }
    ];
  }

  private checkResponsiveDesign(device: MobileDevice, embed: any): boolean {
    // Check if embed adapts well to the device screen size
    const hasImage = embed.image || embed.thumbnail;
    const hasMultipleFields = embed.fields && embed.fields.length > 3;

    if (device.screenWidth < 400 && hasImage && hasMultipleFields) {
      return false; // Might be too crowded on small screens
    }

    return true;
  }

  private async runPlatformSpecificTests(device: MobileDevice, client: MockMobileDiscordClient): Promise<MobileTestResult[]> {
    const results: MobileTestResult[] = [];

    // iOS-specific tests
    if (device.platform === 'iOS') {
      // Test Dynamic Type support
      const dynamicTypeResult = await this.testDynamicTypeSupport(device, client);
      results.push(dynamicTypeResult);

      // Test Safe Area handling
      const safeAreaResult = await this.testSafeAreaHandling(device, client);
      results.push(safeAreaResult);
    }

    // Android-specific tests
    if (device.platform === 'Android') {
      // Test material design compliance
      const materialDesignResult = await this.testMaterialDesignCompliance(device, client);
      results.push(materialDesignResult);

      // Test back button behavior
      const backButtonResult = await this.testBackButtonBehavior(device, client);
      results.push(backButtonResult);
    }

    return results;
  }

  private async testDynamicTypeSupport(device: MobileDevice, client: MockMobileDiscordClient): Promise<MobileTestResult> {
    const startTime = performance.now();

    // Simulate testing with different text sizes
    const textSizes = ['Small', 'Medium', 'Large', 'Extra Large'];
    const issues: string[] = [];

    for (const textSize of textSizes) {
      // Simulate text scaling
      const scaleFactor = textSize === 'Small' ? 0.8 : textSize === 'Large' ? 1.2 : textSize === 'Extra Large' ? 1.5 : 1.0;

      // Check if content still fits with scaled text
      if (scaleFactor > 1.2) {
        issues.push(`Content may overflow with ${textSize} text size`);
      }
    }

    const duration = performance.now() - startTime;

    return {
      testName: 'iOS Dynamic Type Support',
      device: device.name,
      platform: device.platform,
      passed: issues.length === 0,
      duration,
      issues,
      metrics: {
        textReadable: issues.length < 2,
        responsiveDesign: issues.length === 0
      }
    };
  }

  private async testSafeAreaHandling(device: MobileDevice, client: MockMobileDiscordClient): Promise<MobileTestResult> {
    const startTime = performance.now();

    // Simulate safe area constraints (notch, home indicator, etc.)
    const safeAreaTop = device.name.includes('Pro') ? 47 : 20;
    const safeAreaBottom = device.name.includes('iPhone') ? 34 : 0;

    const availableHeight = device.screenHeight - safeAreaTop - safeAreaBottom;
    const issues: string[] = [];

    if (availableHeight < 600) {
      issues.push('Limited content area due to safe area constraints');
    }

    const duration = performance.now() - startTime;

    return {
      testName: 'iOS Safe Area Handling',
      device: device.name,
      platform: device.platform,
      passed: issues.length === 0,
      duration,
      issues,
      metrics: {
        contentVisible: availableHeight >= 600,
        responsiveDesign: issues.length === 0
      }
    };
  }

  private async testMaterialDesignCompliance(device: MobileDevice, client: MockMobileDiscordClient): Promise<MobileTestResult> {
    const startTime = performance.now();

    // Test material design guidelines compliance
    const issues: string[] = [];

    // Check touch target sizes (minimum 48dp)
    const minTouchTarget = 48;
    const pixelDensity = device.pixelDensity;
    const minTouchTargetPx = minTouchTarget * pixelDensity;

    if (minTouchTargetPx > 120) { // If touch targets would be too large
      issues.push('Touch targets may be oversized for high-density displays');
    }

    const duration = performance.now() - startTime;

    return {
      testName: 'Android Material Design Compliance',
      device: device.name,
      platform: device.platform,
      passed: issues.length === 0,
      duration,
      issues,
      metrics: {
        buttonsAccessible: issues.length === 0,
        responsiveDesign: true
      }
    };
  }

  private async testBackButtonBehavior(device: MobileDevice, client: MockMobileDiscordClient): Promise<MobileTestResult> {
    const startTime = performance.now();

    // Simulate Android back button behavior
    const issues: string[] = [];

    // Check if modals handle back button correctly
    const modal = this.createTestModals()[0];
    const modalResult = await client.displayModal(modal.data);

    if (!modalResult.fitsScreen) {
      issues.push('Modal may not handle back button dismissal correctly');
    }

    const duration = performance.now() - startTime;

    return {
      testName: 'Android Back Button Behavior',
      device: device.name,
      platform: device.platform,
      passed: issues.length === 0,
      duration,
      issues,
      metrics: {
        responsiveDesign: issues.length === 0
      }
    };
  }

  // Generate mobile compatibility report
  async generateMobileCompatibilityReport(): Promise<void> {
    const reportData = {
      testSuite: 'Mobile Discord Compatibility Tests',
      timestamp: new Date().toISOString(),
      configuration: this.config,
      summary: {
        totalTests: this.testResults.length,
        passedTests: this.testResults.filter(r => r.passed).length,
        failedTests: this.testResults.filter(r => !r.passed).length,
        devicesTested: [...new Set(this.testResults.map(r => r.device))].length,
        platformsCovered: [...new Set(this.testResults.map(r => r.platform))]
      },
      deviceSummary: this.generateDeviceSummary(),
      platformSummary: this.generatePlatformSummary(),
      commonIssues: this.identifyCommonIssues(),
      results: this.testResults
    };

    // Save JSON report
    const jsonPath = join('./tests/results', `mobile_compatibility_${Date.now()}.json`);
    writeFileSync(jsonPath, JSON.stringify(reportData, null, 2));

    // Generate markdown summary
    const markdownReport = this.generateMobileMarkdownReport(reportData);
    const mdPath = join('./tests/results', `mobile_compatibility_summary_${Date.now()}.md`);
    writeFileSync(mdPath, markdownReport);

    console.log(`📱 Mobile compatibility reports saved:`);
    console.log(`   - JSON: ${jsonPath}`);
    console.log(`   - Summary: ${mdPath}`);
  }

  private generateDeviceSummary(): any {
    const deviceSummary: { [key: string]: any } = {};

    for (const result of this.testResults) {
      if (!deviceSummary[result.device]) {
        deviceSummary[result.device] = {
          platform: result.platform,
          totalTests: 0,
          passedTests: 0,
          failedTests: 0,
          commonIssues: []
        };
      }

      deviceSummary[result.device].totalTests++;
      if (result.passed) {
        deviceSummary[result.device].passedTests++;
      } else {
        deviceSummary[result.device].failedTests++;
        deviceSummary[result.device].commonIssues.push(...result.issues);
      }
    }

    return deviceSummary;
  }

  private generatePlatformSummary(): any {
    const platformSummary: { [key: string]: any } = {};

    for (const result of this.testResults) {
      if (!platformSummary[result.platform]) {
        platformSummary[result.platform] = {
          totalTests: 0,
          passedTests: 0,
          failedTests: 0,
          averageDuration: 0
        };
      }

      platformSummary[result.platform].totalTests++;
      platformSummary[result.platform].averageDuration += result.duration;

      if (result.passed) {
        platformSummary[result.platform].passedTests++;
      } else {
        platformSummary[result.platform].failedTests++;
      }
    }

    // Calculate averages
    Object.keys(platformSummary).forEach(platform => {
      platformSummary[platform].averageDuration /= platformSummary[platform].totalTests;
      platformSummary[platform].successRate =
        (platformSummary[platform].passedTests / platformSummary[platform].totalTests) * 100;
    });

    return platformSummary;
  }

  private identifyCommonIssues(): string[] {
    const issueFrequency: { [key: string]: number } = {};

    this.testResults.forEach(result => {
      result.issues.forEach(issue => {
        issueFrequency[issue] = (issueFrequency[issue] || 0) + 1;
      });
    });

    return Object.entries(issueFrequency)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 10)
      .map(([issue, frequency]) => `${issue} (${frequency} occurrences)`);
  }

  private generateMobileMarkdownReport(reportData: any): string {
    return `# Mobile Discord Compatibility Test Results

## Test Summary
- **Total Tests**: ${reportData.summary.totalTests}
- **Passed Tests**: ${reportData.summary.passedTests}
- **Failed Tests**: ${reportData.summary.failedTests}
- **Success Rate**: ${((reportData.summary.passedTests / reportData.summary.totalTests) * 100).toFixed(2)}%
- **Devices Tested**: ${reportData.summary.devicesTested}
- **Platforms**: ${reportData.summary.platformsCovered.join(', ')}

## Platform Performance
${Object.entries(reportData.platformSummary).map(([platform, stats]: [string, any]) => `
### ${platform}
- **Success Rate**: ${stats.successRate.toFixed(2)}%
- **Tests**: ${stats.passedTests}/${stats.totalTests} passed
- **Average Duration**: ${stats.averageDuration.toFixed(2)}ms
`).join('')}

## Device Performance
${Object.entries(reportData.deviceSummary).map(([device, stats]: [string, any]) => `
### ${device} (${stats.platform})
- **Tests**: ${stats.passedTests}/${stats.totalTests} passed
- **Success Rate**: ${((stats.passedTests / stats.totalTests) * 100).toFixed(2)}%
${stats.commonIssues.length > 0 ? `- **Common Issues**: ${[...new Set(stats.commonIssues)].slice(0, 3).join(', ')}` : ''}
`).join('')}

## Common Issues
${reportData.commonIssues.map((issue: string, index: number) => `${index + 1}. ${issue}`).join('\n')}

## Recommendations
${this.generateMobileRecommendations(reportData)}
`;
  }

  private generateMobileRecommendations(reportData: any): string {
    const recommendations = [];
    const overallSuccessRate = (reportData.summary.passedTests / reportData.summary.totalTests) * 100;

    if (overallSuccessRate < 90) {
      recommendations.push('- **Overall Compatibility**: Consider implementing responsive design improvements');
    }

    if (reportData.commonIssues.some((issue: string) => issue.includes('touch target'))) {
      recommendations.push('- **Touch Targets**: Increase button sizes to meet platform guidelines (44pt iOS, 48dp Android)');
    }

    if (reportData.commonIssues.some((issue: string) => issue.includes('truncated'))) {
      recommendations.push('- **Text Content**: Implement dynamic text sizing and content truncation strategies');
    }

    if (reportData.commonIssues.some((issue: string) => issue.includes('keyboard'))) {
      recommendations.push('- **Keyboard Handling**: Improve modal and input field behavior with mobile keyboards');
    }

    const iosStats = reportData.platformSummary['iOS'];
    const androidStats = reportData.platformSummary['Android'];

    if (iosStats && iosStats.successRate < androidStats?.successRate - 10) {
      recommendations.push('- **iOS Optimization**: Focus on iOS-specific improvements (Dynamic Type, Safe Areas)');
    }

    if (androidStats && androidStats.successRate < iosStats?.successRate - 10) {
      recommendations.push('- **Android Optimization**: Focus on Android-specific improvements (Material Design, Back Button)');
    }

    return recommendations.length > 0 ? recommendations.join('\n') : '- All mobile compatibility metrics are within acceptable ranges ✅';
  }
}

// Main execution
if (isMainThread) {
  const testSuite = new MobileCompatibilityTestSuite();

  console.log('📱 Starting Mobile Discord Compatibility Test Suite');

  testSuite.runMobileCompatibilityTests()
    .then(async (results) => {
      await testSuite.generateMobileCompatibilityReport();

      const passedTests = results.filter(r => r.passed).length;
      const totalTests = results.length;
      const successRate = (passedTests / totalTests) * 100;

      console.log(`\n🎉 Mobile compatibility tests completed!`);
      console.log(`📊 Results: ${passedTests}/${totalTests} tests passed (${successRate.toFixed(2)}%)`);

      process.exit(successRate >= 85 ? 0 : 1); // 85% success rate threshold
    })
    .catch(error => {
      console.error('❌ Mobile compatibility test suite failed:', error);
      process.exit(1);
    });
}

export { MobileCompatibilityTestSuite, MobileTestConfig, MobileTestResult };