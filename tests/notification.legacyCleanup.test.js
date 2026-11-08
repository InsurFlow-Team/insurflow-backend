const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const Notification = require('../src/modules/notifications/notification.model');
const deleteLegacyNotifications = require('../src/scripts/deleteLegacyNotifications');

describe('Legacy Notification Cleanup Script (deleteLegacyNotifications.js)', () => {
  let mongoServer;

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    await mongoose.connect(mongoServer.getUri());
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await mongoServer.stop();
  });

  beforeEach(async () => {
    await Notification.collection.deleteMany({});
  });

  it('dry-run deletes nothing and reports the legacy count', async () => {
    const orgId = new mongoose.Types.ObjectId();
    const userId = new mongoose.Types.ObjectId();
    const claimId = new mongoose.Types.ObjectId();

    // Insert 3 legacy notifications (no params key at all)
    await Notification.collection.insertMany([
      { recipientId: userId, organizationId: orgId, type: 'NEW_CLAIM', relatedClaimId: claimId, title: 'L1', body: 'B1' },
      { recipientId: userId, organizationId: orgId, type: 'NEW_CLAIM', relatedClaimId: claimId, title: 'L2', body: 'B2' },
      { recipientId: userId, organizationId: orgId, type: 'NEW_CLAIM', relatedClaimId: claimId, title: 'L3', body: 'B3' },
    ]);

    // Insert 2 new notifications (with params)
    await Notification.collection.insertMany([
      { recipientId: userId, organizationId: orgId, type: 'NEW_CLAIM', relatedClaimId: claimId, title: 'N1', body: 'B1', params: { actor: null, reason: null, notes: null } },
      { recipientId: userId, organizationId: orgId, type: 'ASSIGNMENT_DECLINED', relatedClaimId: claimId, title: 'N2', body: 'B2', params: { actor: { employeeCode: 'FA-01', name: 'A' }, reason: 'R', notes: null } },
    ]);

    const result = await deleteLegacyNotifications({ apply: false, disconnect: false });

    expect(result.found).toBe(3);
    expect(result.deleted).toBe(0);
    expect(result.isDryRun).toBe(true);

    const count = await Notification.collection.countDocuments();
    expect(count).toBe(5);
  });

  it('apply deletes only notifications that have no params key', async () => {
    const orgId = new mongoose.Types.ObjectId();
    const userId = new mongoose.Types.ObjectId();
    const claimId = new mongoose.Types.ObjectId();

    // Insert 3 legacy notifications (no params key at all)
    await Notification.collection.insertMany([
      { recipientId: userId, organizationId: orgId, type: 'NEW_CLAIM', relatedClaimId: claimId, title: 'L1', body: 'B1' },
      { recipientId: userId, organizationId: orgId, type: 'NEW_CLAIM', relatedClaimId: claimId, title: 'L2', body: 'B2' },
      { recipientId: userId, organizationId: orgId, type: 'NEW_CLAIM', relatedClaimId: claimId, title: 'L3', body: 'B3' },
    ]);

    // Insert 2 new notifications (with params)
    await Notification.collection.insertMany([
      { recipientId: userId, organizationId: orgId, type: 'NEW_CLAIM', relatedClaimId: claimId, title: 'N1', body: 'B1', params: { actor: null, reason: null, notes: null } },
      { recipientId: userId, organizationId: orgId, type: 'ASSIGNMENT_DECLINED', relatedClaimId: claimId, title: 'N2', body: 'B2', params: { actor: { employeeCode: 'FA-01', name: 'A' }, reason: 'R', notes: null } },
    ]);

    const result = await deleteLegacyNotifications({ apply: true, disconnect: false });

    expect(result.found).toBe(3);
    expect(result.deleted).toBe(3);
    expect(result.isDryRun).toBe(false);

    const remaining = await Notification.collection.find().toArray();
    expect(remaining).toHaveLength(2);
    expect(remaining.map(r => r.title).sort()).toEqual(['N1', 'N2']);
  });

  it('notifications with an all-null params object survive', async () => {
    const orgId = new mongoose.Types.ObjectId();
    const userId = new mongoose.Types.ObjectId();
    const claimId = new mongoose.Types.ObjectId();

    // Insert 2 new notifications with all-null params object
    await Notification.collection.insertMany([
      { recipientId: userId, organizationId: orgId, type: 'PENDING_ACCEPTANCE', relatedClaimId: claimId, title: 'N1', body: 'B1', params: { actor: null, reason: null, notes: null } },
      { recipientId: userId, organizationId: orgId, type: 'APPROVED', relatedClaimId: claimId, title: 'N2', body: 'B2', params: { actor: null, reason: null, notes: null } },
    ]);

    const result = await deleteLegacyNotifications({ apply: true, disconnect: false });

    expect(result.found).toBe(0);
    expect(result.deleted).toBe(0);

    const count = await Notification.collection.countDocuments();
    expect(count).toBe(2);
  });
});
