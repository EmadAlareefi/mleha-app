/**
 * Test script to verify the 3-day return restriction logic
 */
export {};

type TestCase = {
  name: string;
  orderUpdatedAt: string;
  shouldAllow: boolean;
};

// Test cases for the 3-day validation
const testCases: TestCase[] = [
  {
    name: 'Order updated 1 day ago',
    orderUpdatedAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(),
    shouldAllow: true,
  },
  {
    name: 'Order updated 2 days ago',
    orderUpdatedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
    shouldAllow: true,
  },
  {
    name: 'Order updated exactly 3 days ago (72 hours)',
    orderUpdatedAt: new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString(),
    shouldAllow: true,
  },
  {
    name: 'Order updated 2 days 23 hours ago',
    orderUpdatedAt: new Date(Date.now() - (2 * 24 + 23) * 60 * 60 * 1000).toISOString(),
    shouldAllow: true,
  },
  {
    name: 'Order updated 3.5 days ago',
    orderUpdatedAt: new Date(Date.now() - 3.5 * 24 * 60 * 60 * 1000).toISOString(),
    shouldAllow: false,
  },
  {
    name: 'Order updated 4 days ago',
    orderUpdatedAt: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000).toISOString(),
    shouldAllow: false,
  },
  {
    name: 'Order updated 7 days ago',
    orderUpdatedAt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
    shouldAllow: false,
  },
  {
    name: 'Order updated 1 hour ago',
    orderUpdatedAt: new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString(),
    shouldAllow: true,
  },
];

function validateReturnPeriod(orderUpdatedAt: string): {
  allowed: boolean;
  daysDifference: number;
  message: string;
} {
  const updatedDate = new Date(orderUpdatedAt);
  const now = new Date();
  const daysDifference = (now.getTime() - updatedDate.getTime()) / (1000 * 60 * 60 * 24);

  // Allow returns within 3 days (exceeds means > 3 days, with small epsilon for floating point)
  const EPSILON = 0.001; // ~1.5 minutes tolerance
  const allowed = daysDifference <= 3 + EPSILON;

  return {
    allowed,
    daysDifference,
    message: allowed
      ? `مسموح - مرت ${daysDifference.toFixed(2)} يوم فقط`
      : `غير مسموح - مرت ${daysDifference.toFixed(2)} يوم (تجاوز 3 أيام)`,
  };
}

console.log('=== Testing 3-Day Return Period Validation ===\n');

let passed = 0;
let failed = 0;

testCases.forEach((testCase) => {
  const result = validateReturnPeriod(testCase.orderUpdatedAt);
  const testPassed = result.allowed === testCase.shouldAllow;

  console.log(`Test: ${testCase.name}`);
  console.log(`  Order Updated: ${testCase.orderUpdatedAt}`);
  console.log(`  Days Since Update: ${result.daysDifference.toFixed(2)}`);
  console.log(`  Exact Days: ${result.daysDifference}`);
  console.log(`  Expected: ${testCase.shouldAllow ? 'ALLOW' : 'REJECT'}`);
  console.log(`  Result: ${result.allowed ? 'ALLOW' : 'REJECT'}`);
  console.log(`  Message: ${result.message}`);
  console.log(`  Status: ${testPassed ? '✅ PASSED' : '❌ FAILED'}\n`);

  if (testPassed) {
    passed++;
  } else {
    failed++;
  }
});

console.log('=== Test Summary ===');
console.log(`Total Tests: ${testCases.length}`);
console.log(`Passed: ${passed}`);
console.log(`Failed: ${failed}`);
console.log(`Success Rate: ${((passed / testCases.length) * 100).toFixed(2)}%\n`);

if (failed === 0) {
  console.log('✅ All tests passed!');
  process.exit(0);
} else {
  console.log('❌ Some tests failed!');
  process.exit(1);
}
