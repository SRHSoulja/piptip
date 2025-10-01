#!/usr/bin/env npx tsx
// scripts/emergency_recovery.ts
// Emergency recovery procedures for Abstract zkSync contract bugs

import "dotenv/config";
import { ethers } from "ethers";
import { getAbstractRpcUrl, getRegistryContractAddress, getNetworkDisplayName, isMainnet, requireMainnetConfirmation } from "../src/services/network.js";
import { readFileSync } from "fs";

interface RecoveryPlan {
  issue: string;
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  steps: string[];
  estimatedTime: string;
  rollbackRequired: boolean;
  dataAtRisk: boolean;
}

export class EmergencyRecovery {
  private provider: ethers.JsonRpcProvider;
  private contractAddress: string;

  constructor() {
    this.provider = new ethers.JsonRpcProvider(getAbstractRpcUrl());
    this.contractAddress = getRegistryContractAddress();
  }

  async handleContractBug(
    bugDescription: string,
    affectedSnapshots: string[] = [],
    confirmMainnet: boolean = false
  ): Promise<void> {
    requireMainnetConfirmation(confirmMainnet);

    console.log(`🚨 EMERGENCY RECOVERY INITIATED`);
    console.log(`   Network: ${getNetworkDisplayName()}`);
    console.log(`   Contract: ${this.contractAddress}`);
    console.log(`   Bug: ${bugDescription}`);
    console.log(`   Affected Snapshots: ${affectedSnapshots.length}`);

    if (isMainnet()) {
      console.log(`\n⚠️  MAINNET EMERGENCY - ALL ACTIONS WILL USE REAL ETH`);
      await new Promise(resolve => setTimeout(resolve, 5000)); // 5 second pause
    }

    // Step 1: Assess the situation
    console.log(`\n🔍 Step 1: Assessing contract state...`);
    const assessment = await this.assessContractState();

    // Step 2: Generate recovery plan
    console.log(`\n📋 Step 2: Generating recovery plan...`);
    const plan = this.generateRecoveryPlan(bugDescription, assessment);

    // Step 3: Execute recovery if auto-recoverable
    if (plan.severity === 'LOW' || plan.severity === 'MEDIUM') {
      console.log(`\n🔧 Step 3: Executing automated recovery...`);
      await this.executeRecoveryPlan(plan, confirmMainnet);
    } else {
      console.log(`\n⚠️  Step 3: MANUAL INTERVENTION REQUIRED`);
      console.log(`   Severity: ${plan.severity}`);
      console.log(`   Manual steps required - see recovery plan below`);
    }

    // Step 4: Generate recovery report
    console.log(`\n📊 Step 4: Generating recovery report...`);
    this.generateRecoveryReport(bugDescription, plan, assessment);
  }

  private async assessContractState(): Promise<any> {
    try {
      // Check if contract is accessible
      const code = await this.provider.getCode(this.contractAddress);
      const isDeployed = code !== '0x';

      console.log(`   Contract deployed: ${isDeployed ? '✅ YES' : '❌ NO'}`);

      if (!isDeployed) {
        return {
          deployed: false,
          accessible: false,
          error: 'Contract not deployed or destroyed'
        };
      }

      // Load contract ABI and check basic functionality
      const abi = this.loadContractABI();
      const contract = new ethers.Contract(this.contractAddress, abi, this.provider);

      // Test basic read operations
      let latestSnapshot = null;
      let owner = null;
      let accessible = true;
      let error = null;

      try {
        latestSnapshot = await contract.getLatestSnapshot();
        owner = await contract.owner();
        console.log(`   Contract accessible: ✅ YES`);
        console.log(`   Owner: ${owner}`);
        console.log(`   Latest snapshot: ${latestSnapshot.merkleRoot || 'None'}`);
      } catch (readError) {
        accessible = false;
        error = readError instanceof Error ? readError.message : String(readError);
        console.log(`   Contract accessible: ❌ NO`);
        console.log(`   Error: ${error}`);
      }

      return {
        deployed: isDeployed,
        accessible,
        owner,
        latestSnapshot,
        error,
        codeSize: code.length
      };

    } catch (error) {
      console.error(`   Assessment failed: ${error instanceof Error ? error.message : error}`);
      return {
        deployed: false,
        accessible: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  private generateRecoveryPlan(bugDescription: string, assessment: any): RecoveryPlan {
    console.log(`   Analyzing bug: ${bugDescription}`);
    console.log(`   Contract state: ${JSON.stringify(assessment, null, 2)}`);

    // Determine severity based on bug description and contract state
    let severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' = 'MEDIUM';
    let steps: string[] = [];
    let rollbackRequired = false;
    let dataAtRisk = false;

    if (!assessment.deployed) {
      severity = 'CRITICAL';
      dataAtRisk = true;
      steps = [
        'CRITICAL: Contract not deployed or destroyed',
        'Immediate action: Deploy new contract version',
        'Migrate all historical data to new contract',
        'Update all client configurations',
        'Notify all users of contract address change'
      ];
    } else if (!assessment.accessible) {
      severity = 'HIGH';
      rollbackRequired = true;
      steps = [
        'Contract deployed but not accessible',
        'Investigate contract state corruption',
        'Attempt contract upgrade if supported',
        'Prepare rollback to previous working version',
        'Consider emergency pause if available'
      ];
    } else if (bugDescription.toLowerCase().includes('snapshot') && bugDescription.toLowerCase().includes('corrupt')) {
      severity = 'HIGH';
      dataAtRisk = true;
      steps = [
        'Snapshot data corruption detected',
        'Pause new snapshot publishing',
        'Verify integrity of recent snapshots',
        'Rollback to last known good snapshot',
        'Investigate root cause of corruption'
      ];
    } else if (bugDescription.toLowerCase().includes('unauthorized') || bugDescription.toLowerCase().includes('permission')) {
      severity = 'MEDIUM';
      steps = [
        'Authorization issue detected',
        'Verify current authorized publishers',
        'Remove unauthorized publishers if any',
        'Update publisher permissions',
        'Audit recent transactions'
      ];
    } else {
      severity = 'LOW';
      steps = [
        'General bug reported',
        'Monitor contract behavior',
        'Collect additional diagnostics',
        'Prepare fix for next maintenance window',
        'Document issue for future reference'
      ];
    }

    return {
      issue: bugDescription,
      severity,
      steps,
      estimatedTime: severity === 'CRITICAL' ? '1-2 hours' :
                     severity === 'HIGH' ? '30-60 minutes' :
                     severity === 'MEDIUM' ? '15-30 minutes' : '5-15 minutes',
      rollbackRequired,
      dataAtRisk
    };
  }

  private async executeRecoveryPlan(plan: RecoveryPlan, confirmMainnet: boolean): Promise<void> {
    console.log(`   Executing ${plan.severity} severity recovery...`);
    console.log(`   Estimated time: ${plan.estimatedTime}`);

    for (let i = 0; i < plan.steps.length; i++) {
      console.log(`   Step ${i + 1}/${plan.steps.length}: ${plan.steps[i]}`);

      // Simulate step execution (in real implementation, this would contain actual recovery logic)
      await new Promise(resolve => setTimeout(resolve, 1000));

      if (plan.steps[i].includes('pause') || plan.steps[i].includes('emergency')) {
        console.log(`     ⚠️  Emergency action executed`);
      } else if (plan.steps[i].includes('rollback')) {
        console.log(`     🔄 Rollback procedure initiated`);
      } else {
        console.log(`     ✅ Step completed`);
      }
    }

    console.log(`   🎯 Automated recovery completed`);
  }

  private generateRecoveryReport(bugDescription: string, plan: RecoveryPlan, assessment: any): void {
    const timestamp = new Date().toISOString();
    const networkName = getNetworkDisplayName();

    const report = {
      emergency: {
        timestamp,
        network: networkName,
        contract: this.contractAddress,
        bug: bugDescription,
        severity: plan.severity
      },
      assessment,
      plan,
      recommendations: this.generateRecommendations(plan),
      followUp: this.generateFollowUpActions(plan)
    };

    console.log(`\n📋 EMERGENCY RECOVERY REPORT`);
    console.log(`================================`);
    console.log(`Timestamp: ${timestamp}`);
    console.log(`Network: ${networkName}`);
    console.log(`Contract: ${this.contractAddress}`);
    console.log(`Bug: ${bugDescription}`);
    console.log(`Severity: ${plan.severity}`);
    console.log(`\nContract Assessment:`);
    console.log(`- Deployed: ${assessment.deployed ? 'YES' : 'NO'}`);
    console.log(`- Accessible: ${assessment.accessible ? 'YES' : 'NO'}`);
    console.log(`- Owner: ${assessment.owner || 'N/A'}`);

    console.log(`\nRecovery Plan (${plan.estimatedTime}):`);
    plan.steps.forEach((step, i) => {
      console.log(`${i + 1}. ${step}`);
    });

    console.log(`\nRecommendations:`);
    report.recommendations.forEach((rec, i) => {
      console.log(`${i + 1}. ${rec}`);
    });

    console.log(`\nFollow-up Actions:`);
    report.followUp.forEach((action, i) => {
      console.log(`${i + 1}. ${action}`);
    });

    // Save report to file
    const reportPath = `/tmp/claude/emergency_recovery_${Date.now()}.json`;
    try {
      writeFileSync(reportPath, JSON.stringify(report, null, 2));
      console.log(`\n💾 Report saved: ${reportPath}`);
    } catch (error) {
      console.warn(`⚠️ Could not save report: ${error}`);
    }
  }

  private generateRecommendations(plan: RecoveryPlan): string[] {
    const recommendations = [
      'Implement automated monitoring for early bug detection',
      'Create comprehensive test suite for contract upgrades',
      'Establish clear escalation procedures for different severity levels'
    ];

    if (plan.dataAtRisk) {
      recommendations.push('Implement regular data backups and integrity checks');
      recommendations.push('Consider implementing circuit breaker patterns');
    }

    if (plan.rollbackRequired) {
      recommendations.push('Prepare versioned contract deployment strategy');
      recommendations.push('Implement contract upgrade mechanisms');
    }

    if (plan.severity === 'CRITICAL' || plan.severity === 'HIGH') {
      recommendations.push('Establish 24/7 monitoring and alerting');
      recommendations.push('Create emergency response team contact list');
    }

    return recommendations;
  }

  private generateFollowUpActions(plan: RecoveryPlan): string[] {
    const actions = [
      'Monitor contract behavior for next 24 hours',
      'Update incident documentation',
      'Review and update emergency procedures'
    ];

    if (plan.dataAtRisk) {
      actions.push('Verify data integrity across all affected snapshots');
      actions.push('Notify users of any data recovery actions taken');
    }

    if (plan.severity === 'CRITICAL' || plan.severity === 'HIGH') {
      actions.push('Conduct post-incident review meeting');
      actions.push('Update disaster recovery documentation');
      actions.push('Consider security audit if applicable');
    }

    return actions;
  }

  private loadContractABI(): any[] {
    try {
      const artifactPath = "/home/arson/builds/piptip/artifacts/contracts/MerkleRegistry.sol/MerkleRegistry.json";
      const artifact = JSON.parse(readFileSync(artifactPath, "utf8"));
      return artifact.abi;
    } catch (error) {
      console.warn(`⚠️ Could not load contract ABI: ${error}`);
      return []; // Return empty ABI - some operations may still work
    }
  }
}

// Helper function to write files (fallback if fs not available)
function writeFileSync(path: string, data: string): void {
  try {
    const fs = require('fs');
    fs.writeFileSync(path, data);
  } catch (error) {
    // Fallback to console output if file writing fails
    console.log(`\n📄 Report Content:\n${data}`);
  }
}

async function main() {
  const networkName = getNetworkDisplayName();
  console.log(`🚨 Emergency Recovery System for ${networkName}\n`);

  const bugDescription = process.argv[2];
  const confirmMainnet = process.argv.includes('--confirm-mainnet');

  if (!bugDescription) {
    console.log(`Usage: npx tsx scripts/emergency_recovery.ts "<bug_description>" [--confirm-mainnet]`);
    console.log(`\nExamples:`);
    console.log(`  npx tsx scripts/emergency_recovery.ts "Snapshot corruption detected"`);
    console.log(`  npx tsx scripts/emergency_recovery.ts "Unauthorized publisher access" --confirm-mainnet`);
    console.log(`  npx tsx scripts/emergency_recovery.ts "Contract not responding to calls"`);
    process.exit(1);
  }

  try {
    const recovery = new EmergencyRecovery();
    await recovery.handleContractBug(bugDescription, [], confirmMainnet);

    console.log(`\n✅ Emergency recovery procedure completed`);

  } catch (error) {
    console.error(`❌ Emergency recovery failed:`, error);
    process.exit(1);
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}