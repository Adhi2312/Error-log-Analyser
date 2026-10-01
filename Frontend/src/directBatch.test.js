import { processDirectBatch } from './directBatch';

test('processes every pending error while leaving a failed one for an explicit retry', async () => {
  const statuses = new Map([[1, 'pending'], [2, 'pending']]);
  const analyzed = [];
  const result = await processDirectBatch({
    uploadId: 7,
    getSnapshot: async () => ({
      summary: { status: 'processing' },
      errors: [...statuses].map(([id, status]) => ({ id, status })),
    }),
    analyzeError: async (id) => {
      analyzed.push(id);
      statuses.set(id, id === 1 ? 'failed' : 'completed');
      if (id === 1) throw { response: { status: 502 } };
    },
    onSnapshot: () => {},
  });

  expect(analyzed).toEqual([1, 2]);
  expect(result.reason).toBe('settled');
});

test('retry mode includes failed errors', async () => {
  let status = 'failed';
  const analyzed = [];
  const result = await processDirectBatch({
    uploadId: 7,
    getSnapshot: async () => ({ summary: {}, errors: [{ id: 1, status }] }),
    analyzeError: async (id) => { analyzed.push(id); status = 'completed'; },
    onSnapshot: () => {},
    retryFailed: true,
  });

  expect(analyzed).toEqual([1]);
  expect(result.reason).toBe('settled');
});
