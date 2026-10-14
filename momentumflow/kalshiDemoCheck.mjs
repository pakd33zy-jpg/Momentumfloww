import 'dotenv/config';
import { createKalshiDemoReadOnly } from './kalshiDemoReadOnly.js';

if (!process.env.KALSHI_DEMO_KEY_ID || !process.env.KALSHI_DEMO_PRIVATE_KEY_PEM) {
  console.error('Missing KALSHI_DEMO_KEY_ID or KALSHI_DEMO_PRIVATE_KEY_PEM');
  process.exitCode = 1;
} else {
  try {
    const result = await createKalshiDemoReadOnly().verifyDemoCredentials();
    console.log('Kalshi DEMO authentication successful (read-only).');
    console.log('Virtual demo balance: $' + result.demoBalanceDollars.toFixed(2));
  } catch (error) {
    // Authentication errors are deliberately not accompanied by key material.
    console.error('Kalshi demo connection failed:', error.message);
    process.exitCode = 1;
  }
}
