import { isTerminalBatchStatus, monitorBatch } from './batchMonitor';

test.each(['completed', 'completed_with_failures', 'no_errors'])(
  'treats %s as a terminal batch state',
  (status) => expect(isTerminalBatchStatus(status)).toBe(true),
);

test('monitors one batch until it reaches a terminal state', async () => {
  const snapshots = [
    { summary: { status: 'processing' }, errors: [{ id: 1, status: 'processing' }] },
    { summary: { status: 'completed' }, errors: [{ id: 1, status: 'completed' }] },
  ];
  const getSnapshot = jest.fn()
    .mockResolvedValueOnce(snapshots[0])
    .mockResolvedValueOnce(snapshots[1]);
  const onSnapshot = jest.fn();

  const result = await monitorBatch({
    uploadId: 42,
    getSnapshot,
    onSnapshot,
    sleep: jest.fn().mockResolvedValue(),
  });

  expect(result.reason).toBe('terminal');
  expect(getSnapshot).toHaveBeenCalledTimes(2);
  expect(getSnapshot).toHaveBeenCalledWith(42);
  expect(onSnapshot).toHaveBeenLastCalledWith(snapshots[1]);
});

test('stops after repeated status failures instead of polling forever', async () => {
  const getSnapshot = jest.fn().mockRejectedValue(new Error('offline'));
  await expect(monitorBatch({
    uploadId: 42,
    getSnapshot,
    onSnapshot: jest.fn(),
    maxConsecutiveFailures: 3,
    sleep: jest.fn().mockResolvedValue(),
  })).rejects.toThrow('offline');
  expect(getSnapshot).toHaveBeenCalledTimes(3);
});
