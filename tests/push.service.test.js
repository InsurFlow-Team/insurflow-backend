const mockSend = jest.fn();

jest.mock('../src/config/firebase', () => ({
  messaging: jest.fn(() => ({
    send: mockSend,
  })),
}));

const { sendPush } = require('../src/services/push.service');

describe('Push Notification Service (push.service.js)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should call admin.messaging().send() with correct token, notification, and data', async () => {
    const fakeToken = 'fcm-device-token-123';
    const fakeTitle = 'New Claim Assigned';
    const fakeBody = 'You have been assigned claim CLM-ORG-0001';
    const fakeData = { claimId: 'claim-123', status: 'ASSIGNED' };
    const expectedMessageId = 'projects/insurflow/messages/msg-987';

    mockSend.mockResolvedValueOnce(expectedMessageId);

    const result = await sendPush(fakeToken, fakeTitle, fakeBody, fakeData);

    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(mockSend).toHaveBeenCalledWith({
      token: fakeToken,
      notification: {
        title: fakeTitle,
        body: fakeBody,
      },
      data: {
        claimId: 'claim-123',
        status: 'ASSIGNED',
      },
    });
    expect(result).toBe(expectedMessageId);
  });

  it('should coerce all non-string data values (numbers, booleans, objects) to strings', async () => {
    const fakeToken = 'fcm-device-token-456';
    const fakeTitle = 'Claim Approved';
    const fakeBody = 'Claim CLM-ORG-0002 has been approved';
    const fakeData = {
      claimNumber: 1002,
      isApproved: true,
      amount: 450.75,
      meta: { priority: 'high' },
      nullField: null,
      undefinedField: undefined,
    };

    mockSend.mockResolvedValueOnce('msg-id-456');

    await sendPush(fakeToken, fakeTitle, fakeBody, fakeData);

    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(mockSend).toHaveBeenCalledWith({
      token: fakeToken,
      notification: {
        title: fakeTitle,
        body: fakeBody,
      },
      data: {
        claimNumber: '1002',
        isApproved: 'true',
        amount: '450.75',
        meta: '{"priority":"high"}',
        nullField: '',
        undefinedField: '',
      },
    });
  });

  it('should default data to an empty object when omitted', async () => {
    const fakeToken = 'fcm-device-token-789';
    const fakeTitle = 'Inspection Reminder';
    const fakeBody = 'Inspection starts in 15 minutes';

    mockSend.mockResolvedValueOnce('msg-id-789');

    await sendPush(fakeToken, fakeTitle, fakeBody);

    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(mockSend).toHaveBeenCalledWith({
      token: fakeToken,
      notification: {
        title: fakeTitle,
        body: fakeBody,
      },
      data: {},
    });
  });

  it('should throw immediately when admin.messaging().send() fails without catching or retrying', async () => {
    const fakeToken = 'invalid-device-token';
    const fakeTitle = 'Test';
    const fakeBody = 'Test Body';
    const fcmError = new Error('Requested entity was not found.');

    mockSend.mockRejectedValueOnce(fcmError);

    await expect(sendPush(fakeToken, fakeTitle, fakeBody)).rejects.toThrow(
      'Requested entity was not found.'
    );
    expect(mockSend).toHaveBeenCalledTimes(1);
  });
});
