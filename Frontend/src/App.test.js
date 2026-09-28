import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import App from './App';
import {
  getBatchSnapshot,
  getErrorAnalysis,
  previewLog,
  startBatchAnalysis,
} from './api';

jest.mock('./api', () => ({
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
