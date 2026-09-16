const mongoose = require('mongoose');

const mockSendPush = jest.fn();
jest.mock('../src/services/push.service', () => ({
  sendPush: mockSendPush,
}));

const mockNotificationCreate = jest.fn();
jest.mock('../src/modules/notifications/notification.model', () => {
  const MockModel = function () {};
  MockModel.create = mockNotificationCreate;
  return MockModel;
});

const mockUserFindById = jest.fn();
jest.mock('../src/modules/users/user.model', () => ({
  findById: mockUserFindById,
}));

const { createAndSendNotification } = require('../src/modules/notifications/notification.service');

describe('Notification Service (notification.service.js)', () => {
  const recipientId = new mongoose.Types.ObjectId();
  const organizationId = new mongoose.Types.ObjectId();
  const relatedClaimId = new mongoose.Types.ObjectId();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should create a notification document and send push when user has fcmToken', async () => {
    const payload = {
      recipientId,
      organizationId,
      type: 'ASSIGNED',
      relatedClaimId,
      title: 'New Claim Assigned',
      body: 'You have been assigned a new claim.',
    };

    const mockNotificationDoc = {
      _id: new mongoose.Types.ObjectId(),
      ...payload,
      read: false,
      createdAt: new Date(),
    };

    mockNotificationCreate.mockResolvedValueOnce(mockNotificationDoc);

    const selectMock = jest.fn().mockReturnValue({
      lean: jest.fn().mockResolvedValueOnce({
        _id: recipientId,
        fcmToken: 'valid-fcm-token-123',
      }),
    });
    mockUserFindById.mockReturnValueOnce({
      select: selectMock,
    });

    mockSendPush.mockResolvedValueOnce('fcm-msg-id-123');

    const result = await createAndSendNotification(payload);

    expect(mockNotificationCreate).toHaveBeenCalledTimes(1);
    expect(mockNotificationCreate).toHaveBeenCalledWith(payload);

    expect(mockUserFindById).toHaveBeenCalledWith(recipientId);
    expect(selectMock).toHaveBeenCalledWith('fcmToken');

    expect(mockSendPush).toHaveBeenCalledTimes(1);
    expect(mockSendPush).toHaveBeenCalledWith(
      'valid-fcm-token-123',
      payload.title,
      payload.body,
      {
        claimId: relatedClaimId,
        type: 'ASSIGNED',
      }
    );

    expect(result).toBe(mockNotificationDoc);
  });

  it('should silently skip push if recipient user has no fcmToken', async () => {
    const payload = {
      recipientId,
      organizationId,
      type: 'CORRECTION_REQUIRED',
      relatedClaimId,
      title: 'Correction Required',
      body: 'Please correct the inspection report.',
    };

    const mockNotificationDoc = {
      _id: new mongoose.Types.ObjectId(),
      ...payload,
    };

    mockNotificationCreate.mockResolvedValueOnce(mockNotificationDoc);

    const selectMock = jest.fn().mockReturnValue({
      lean: jest.fn().mockResolvedValueOnce({
        _id: recipientId,
        fcmToken: null,
      }),
    });
    mockUserFindById.mockReturnValueOnce({
      select: selectMock,
    });

    const result = await createAndSendNotification(payload);

    expect(mockNotificationCreate).toHaveBeenCalledTimes(1);
    expect(mockSendPush).not.toHaveBeenCalled();
    expect(result).toBe(mockNotificationDoc);
  });

  it('should silently skip push if recipient user is not found', async () => {
    const payload = {
      recipientId,
      organizationId,
      type: 'APPROVED',
      relatedClaimId,
      title: 'Claim Approved',
      body: 'Your claim has been approved.',
    };

    const mockNotificationDoc = {
      _id: new mongoose.Types.ObjectId(),
      ...payload,
    };

    mockNotificationCreate.mockResolvedValueOnce(mockNotificationDoc);

    const selectMock = jest.fn().mockReturnValue({
      lean: jest.fn().mockResolvedValueOnce(null),
    });
    mockUserFindById.mockReturnValueOnce({
      select: selectMock,
    });

    const result = await createAndSendNotification(payload);

    expect(mockNotificationCreate).toHaveBeenCalledTimes(1);
    expect(mockSendPush).not.toHaveBeenCalled();
    expect(result).toBe(mockNotificationDoc);
  });

  it('should NOT propagate push notification error to caller when sendPush fails', async () => {
    const payload = {
      recipientId,
      organizationId,
      type: 'REJECTED',
      relatedClaimId,
      title: 'Claim Rejected',
      body: 'Your claim has been rejected.',
    };

    const mockNotificationDoc = {
      _id: new mongoose.Types.ObjectId(),
      ...payload,
    };

    mockNotificationCreate.mockResolvedValueOnce(mockNotificationDoc);

    const selectMock = jest.fn().mockReturnValue({
      lean: jest.fn().mockResolvedValueOnce({
        _id: recipientId,
        fcmToken: 'faulty-fcm-token',
      }),
    });
    mockUserFindById.mockReturnValueOnce({
      select: selectMock,
    });

    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    mockSendPush.mockRejectedValueOnce(new Error('FCM server unavailable'));

    const result = await createAndSendNotification(payload);

    expect(mockNotificationCreate).toHaveBeenCalledTimes(1);
    expect(mockSendPush).toHaveBeenCalledTimes(1);
    expect(consoleErrorSpy).toHaveBeenCalled();
    expect(result).toBe(mockNotificationDoc);

    consoleErrorSpy.mockRestore();
  });

  it('should propagate error if Notification.create fails', async () => {
    const payload = {
      recipientId,
      organizationId,
      type: 'INVALID_TYPE',
      relatedClaimId,
      title: 'Test',
      body: 'Test',
    };

    mockNotificationCreate.mockRejectedValueOnce(new Error('Validation failed'));

    await expect(createAndSendNotification(payload)).rejects.toThrow('Validation failed');
    expect(mockUserFindById).not.toHaveBeenCalled();
    expect(mockSendPush).not.toHaveBeenCalled();
  });
});
