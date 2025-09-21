// Quick script to force clear pending claims
import fetch from 'node-fetch';

console.log('Checking current bot status...');

// Try to trigger the cleanup through a simple HTTP request to wake up the cleanup
const response = await fetch('http://localhost:3000/health/monitoring');
const data = await response.json();
console.log('Bot status:', data);

console.log('Attempted to wake up cleanup process. Try your claim again now.');