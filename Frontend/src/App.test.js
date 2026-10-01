import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import App from './App';
import {
  analyzeErrorDirect,
  getBatchSnapshot,
  getErrorAnalysis,
  previewLog,
  startBatchAnalysis,
} from './api';

jest.mock('./api', () => ({
  analyzeErrorDirect: jest.fn(),
  getApiErrorMessage: jest.fn((error, fallback) => fallback),
  getBatchSnapshot: jest.fn(),
  getErrorAnalysis: jest.fn(),
  previewLog: jest.fn(),
  retryBatch: jest.fn(),
  retryError: jest.fn(),
  startBatchAnalysis: jest.fn(),
}));

beforeEach(() => {
  jest.clearAllMocks();
  window.localStorage.clear();
});

test('requires a preview with detected errors before starting batch analysis', async () => {
  previewLog.mockResolvedValue({
    totalErrors: 1,
    errors: [{ line_number: 8, redacted_text: 'ERROR connection refused' }],
  });
  render(<App />);

  const analyseButton = screen.getByRole('button', { name: /analyse all errors/i });
  expect(analyseButton).toBeDisabled();

  const file = new File(['ERROR connection refused'], 'server.log', { type: 'text/plain' });
  fireEvent.change(screen.getByLabelText(/choose a log file/i), { target: { files: [file] } });
  fireEvent.click(screen.getByRole('button', { name: /preview errors/i }));

  await waitFor(() => expect(screen.getByText(/error #1 · line 8/i)).toBeInTheDocument());
  expect(analyseButton).toBeEnabled();
  expect(screen.getByText(/process all of these errors/i)).toBeInTheDocument();
});

test('opens an analysis in a centered modal over a blurred backdrop', async () => {
  previewLog.mockResolvedValue({
    totalErrors: 1,
    errors: [{ line_number: 8, redacted_text: 'ERROR connection refused' }],
  });
  startBatchAnalysis.mockResolvedValue({
    uploadId: 12,
    totalErrors: 1,
    queueSummary: { queued: 1, failed: 0 },
    errors: [{ id: 91, line_number: 8, status: 'queued' }],
  });
  getBatchSnapshot.mockResolvedValue({
    summary: {
      uploadId: 12,
      filename: 'server.log',
      status: 'completed',
      totalErrors: 1,
      counts: { completed: 1 },
      progress: { finished: 1, percent: 100 },
      recoverableCount: 0,
    },
    errors: [{ id: 91, lineNumber: 8, status: 'completed', hasAnalysis: true }],
  });
  getErrorAnalysis.mockResolvedValue({
    source: 'llm',
    model: 'test-model',
    analysis_json: {
      root_cause: 'The database refused the connection.',
      suggested_fix: 'Check the database address.',
      severity: 'High',
      confidence: 0.9,
    },
  });

  render(<App />);
  const file = new File(['ERROR connection refused'], 'server.log', { type: 'text/plain' });
  fireEvent.change(screen.getByLabelText(/choose a log file/i), { target: { files: [file] } });
  fireEvent.click(screen.getByRole('button', { name: /preview errors/i }));
  await waitFor(() => expect(screen.getByRole('button', { name: /analyse all errors/i })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: /analyse all errors/i }));

  const viewButton = await screen.findByRole('button', { name: /view analysis/i });
  fireEvent.click(viewButton);

  const dialog = await screen.findByRole('dialog', { name: /ai analysis/i });
  expect(dialog.parentElement).toHaveClass('fixed', 'backdrop-blur-sm');
  await waitFor(() => {
    expect(within(dialog).getAllByText(/database refused the connection/i).length).toBeGreaterThan(0);
  });

  fireEvent.click(screen.getByRole('button', { name: /close analysis/i }));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

test('direct mode analyses every saved error and shows completed results', async () => {
  previewLog.mockResolvedValue({
    totalErrors: 2,
    errors: [
      { line_number: 8, redacted_text: 'ERROR first' },
      { line_number: 12, redacted_text: 'ERROR second' },
    ],
  });
  startBatchAnalysis.mockResolvedValue({
    uploadId: 22,
    processingMode: 'direct',
    totalErrors: 2,
    errors: [
      { id: 91, line_number: 8, status: 'pending' },
      { id: 92, line_number: 12, status: 'pending' },
    ],
  });
  const makeSnapshot = (first, second) => ({
    summary: {
      uploadId: 22,
      processingMode: 'direct',
      filename: 'server.log',
      status: first === 'completed' && second === 'completed' ? 'completed' : 'processing',
      totalErrors: 2,
      counts: { completed: [first, second].filter((status) => status === 'completed').length },
      progress: { finished: [first, second].filter((status) => status === 'completed').length, percent: 50 },
      recoverableCount: 0,
    },
    errors: [
      { id: 91, lineNumber: 8, status: first, hasAnalysis: first === 'completed' },
      { id: 92, lineNumber: 12, status: second, hasAnalysis: second === 'completed' },
    ],
  });
  getBatchSnapshot
    .mockResolvedValueOnce(makeSnapshot('pending', 'pending'))
    .mockResolvedValueOnce(makeSnapshot('completed', 'pending'))
    .mockResolvedValueOnce(makeSnapshot('completed', 'completed'));
  analyzeErrorDirect.mockResolvedValue({ status: 'completed' });

  render(<App />);
  const file = new File(['ERROR first\nERROR second'], 'server.log', { type: 'text/plain' });
  fireEvent.change(screen.getByLabelText(/choose a log file/i), { target: { files: [file] } });
  fireEvent.click(screen.getByRole('button', { name: /preview errors/i }));
  await waitFor(() => expect(screen.getByRole('button', { name: /analyse all errors/i })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: /analyse all errors/i }));

  await waitFor(() => expect(analyzeErrorDirect.mock.calls.map(([id]) => id)).toEqual([91, 92]));
  await waitFor(() => expect(screen.getAllByRole('button', { name: /view analysis/i })).toHaveLength(2));
  await waitFor(() => expect(window.localStorage.getItem('error-log-analyser:last-direct-upload')).toBeNull());
  fireEvent.click(screen.getByRole('button', { name: /new analysis/i }));
  expect(screen.getByText(/no preview yet/i)).toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: /batch progress/i })).not.toBeInTheDocument();
});

test('does not restore a finished failed batch after a page refresh', async () => {
  window.localStorage.setItem('error-log-analyser:last-direct-upload', '22');
  getBatchSnapshot.mockResolvedValue({
    summary: { uploadId: 22, processingMode: 'direct', status: 'completed_with_failures' },
    errors: [{ id: 91, status: 'failed' }],
  });

  render(<App />);

  await waitFor(() => expect(window.localStorage.getItem('error-log-analyser:last-direct-upload')).toBeNull());
  expect(screen.getByText(/no preview yet/i)).toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: /batch progress/i })).not.toBeInTheDocument();
  expect(analyzeErrorDirect).not.toHaveBeenCalled();
});

test('resumes an unfinished direct batch after a page refresh', async () => {
  window.localStorage.setItem('error-log-analyser:last-direct-upload', '22');
  const pending = {
    summary: { uploadId: 22, processingMode: 'direct', status: 'processing', filename: 'server.log', totalErrors: 1, counts: { pending: 1 }, progress: { finished: 0, percent: 0 } },
    errors: [{ id: 91, lineNumber: 8, status: 'pending', hasAnalysis: false }],
  };
  const completed = {
    summary: { uploadId: 22, processingMode: 'direct', status: 'completed', filename: 'server.log', totalErrors: 1, counts: { completed: 1 }, progress: { finished: 1, percent: 100 } },
    errors: [{ id: 91, lineNumber: 8, status: 'completed', hasAnalysis: true }],
  };
  getBatchSnapshot.mockResolvedValueOnce(pending).mockResolvedValueOnce(pending).mockResolvedValueOnce(completed);
  analyzeErrorDirect.mockResolvedValue({ status: 'completed' });

  render(<App />);

  await waitFor(() => expect(analyzeErrorDirect).toHaveBeenCalledWith(91));
  await waitFor(() => expect(screen.getByRole('button', { name: /view analysis/i })).toBeInTheDocument());
  await waitFor(() => expect(window.localStorage.getItem('error-log-analyser:last-direct-upload')).toBeNull());
});
