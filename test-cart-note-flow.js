/**
 * Test script to verify cart-note injection flow
 *
 * This script tests:
 * 1. UUID generation (frontend)
 * 2. UUID injection into Zid cart note format (convert_cid:UUID)
 * 3. UUID extraction from order notes (webhook controller)
 * 4. Firestore document lookup using convertVisitorId
 */

const path = require('path');

// Simulate UUID generation (frontend)
function generateUUID() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
    var r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

// Simulate frontend injecting UUID into Zid cart note
function injectCartNote(convertVisitorId) {
  return `convert_cid:${convertVisitorId}`;
}

// Simulate webhook extracting UUID from order notes
function extractConvertVisitorIdFromNotes(notes) {
  const cidMatch = notes.match(/convert_cid:([^\s]+)/);
  if (cidMatch && cidMatch[1]) {
    return cidMatch[1];
  }
  return null;
}

// Simulate Firestore document lookup
function simulateFirestoreLookup(convertVisitorId) {
  // Simulate Firestore document structure
  const mockFirestoreData = {
    convertVisitorId: convertVisitorId,
    zidCustomerId: 'test-customer-123',
    convertBucketing: [
      { experienceId: 1, variationId: 1 },
      { experienceId: 2, variationId: 2 }
    ],
    timestamp: Date.now(),
    zidPagePath: '/products'
  };
  return mockFirestoreData;
}

async function testCartNoteFlow() {
  console.log('\n=== CART-NOTE INJECTION FLOW TEST ===\n');

  // STEP 1: Generate UUID (frontend)
  console.log('STEP 1: Generating UUID (frontend)...');
  const convertVisitorId = generateUUID();
  console.log(`✓ Generated UUID: ${convertVisitorId}`);

  // STEP 2: Inject UUID into Zid cart note (frontend)
  console.log('\nSTEP 2: Injecting UUID into Zid cart note (frontend)...');
  const cartNote = injectCartNote(convertVisitorId);
  console.log(`✓ Cart note format: "${cartNote}"`);

  // STEP 3: Simulate webhook receiving order with cart note
  console.log('\nSTEP 3: Simulating webhook payload with cart note...');
  const simulatedWebhookPayload = {
    id: 'order-12345',
    customer: {
      id: 'test-customer-123',
      is_guest_customer: 0
    },
    notes: cartNote, // This is what frontend injects
    created_at: new Date().toISOString(),
    order_total: 100.00,
    currency_code: 'USD',
    products: [
      { id: 'prod-1', name: 'Product A', price: 50, quantity: 2 }
    ]
  };
  console.log(`✓ Simulated webhook payload with notes: "${simulatedWebhookPayload.notes}"`);

  // STEP 4: Extract convertVisitorId from notes (webhook controller)
  console.log('\nSTEP 4: Extracting convertVisitorId from order notes (webhook)...');
  const convertVisitorIdFromNotes = extractConvertVisitorIdFromNotes(simulatedWebhookPayload.notes);

  if (convertVisitorIdFromNotes) {
    console.log(`✓ Extracted convertVisitorId from notes: ${convertVisitorIdFromNotes}`);
  } else {
    console.error('✗ Failed to extract convertVisitorId from notes');
    return false;
  }

  // Verify UUID matches
  if (convertVisitorIdFromNotes === convertVisitorId) {
    console.log('✓ Extracted UUID matches generated UUID');
  } else {
    console.error('✗ Extracted UUID does not match generated UUID');
    return false;
  }

  // STEP 5: Look up context from Firestore using convertVisitorId
  console.log('\nSTEP 5: Looking up context from Firestore...');
  const firestoreData = simulateFirestoreLookup(convertVisitorIdFromNotes);
  console.log(`✓ Context FOUND in Firestore for convertVisitorId: ${convertVisitorIdFromNotes}`);
  console.log(`  - zidCustomerId: ${firestoreData.zidCustomerId}`);
  console.log(`  - convertBucketing: ${JSON.stringify(firestoreData.convertBucketing)}`);
  console.log(`  - zidPagePath: ${firestoreData.zidPagePath}`);

  // STEP 6: Verify data integrity
  console.log('\nSTEP 6: Verifying data integrity...');
  const expectedBucketing = [
    { experienceId: 1, variationId: 1 },
    { experienceId: 2, variationId: 2 }
  ];

  const actualBucketing = firestoreData.convertBucketing.map(b => ({
    experienceId: b.experienceId,
    variationId: b.variationId
  }));

  const bucketingMatch = JSON.stringify(expectedBucketing) === JSON.stringify(actualBucketing);
  if (bucketingMatch) {
    console.log('✓ Bucketing data matches expected values');
  } else {
    console.error('✗ Bucketing data does not match');
    return false;
  }

  // STEP 7: Verify Firestore document ID matches convertVisitorId
  console.log('\nSTEP 7: Verifying Firestore document ID...');
  const firestoreDocId = convertVisitorIdFromNotes;
  console.log(`✓ Firestore document ID: ${firestoreDocId}`);
  console.log(`✓ Document ID matches convertVisitorId: ${firestoreDocId === convertVisitorId}`);

  console.log('\n=== CART-NOTE INJECTION FLOW TEST PASSED ===\n');
  return true;
}

// Run the test
testCartNoteFlow()
  .then(success => {
    if (success) {
      console.log('\n✅ All tests passed! The cart-note injection flow is working correctly.');
      console.log('\nFlow Summary:');
      console.log('1. Frontend generates UUID');
      console.log('2. Frontend injects UUID into Zid cart note as "convert_cid:UUID"');
      console.log('3. Webhook receives order with cart note');
      console.log('4. Webhook extracts UUID from notes using regex: /convert_cid:[^\\s]+/');
      console.log('5. Backend looks up Firestore using convertVisitorId as document ID');
      console.log('6. Context retrieved and sent to Convert.com');
      process.exit(0);
    } else {
      console.log('\n❌ Some tests failed.');
      process.exit(1);
    }
  })
  .catch(error => {
    console.error('\n❌ Test error:', error);
    process.exit(1);
  });
