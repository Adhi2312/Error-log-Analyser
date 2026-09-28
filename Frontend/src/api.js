import axios from 'axios';

export const API_BASE_URL = (process.env.REACT_APP_API_URL || 'http://localhost:3000')
  .replace(/\/+$/, '');

const api = axios.create({ baseURL: API_BASE_URL, timeout: 15000 });

export async function previewLog(file) {
  const text = await file.text();
  const response = await api.post('/preview', { filename: file.name, text });
  return response.data;
}

export async function startBatchAnalysis(file) {
  const body = new FormData();
  body.append('file', file);
  const response = await api.post('/upload', body);
  return response.data;
}

export async function getBatchSnapshot(uploadId) {
  const [summaryResponse, errorsResponse] = await Promise.all([
    api.get(`/api/uploads/${uploadId}/status`),
    api.get(`/api/uploads/${uploadId}/errors`),
  ]);
  return { summary: summaryResponse.data, errors: errorsResponse.data };
}

export async function getErrorAnalysis(errorId) {
  const response = await api.get(`/api/errors/${errorId}/analysis`);
  return response.data;
}

export async function retryError(errorId) {
  const response = await api.post(`/api/errors/${errorId}/retry`);
  return response.data;
}

export async function retryBatch(uploadId) {
  const response = await api.post(`/api/uploads/${uploadId}/retry`);
  return response.data;
}

const FRIENDLY_API_ERRORS = {
  no_file: 'Choose a log file first.',
  no_text_provided: 'The selected file is empty.',
  upload_not_found: 'This upload could not be found.',
  error_not_found: 'This error could not be found.',
  queue_unavailable: 'The processing queue is unavailable. Try again shortly.',
  no_recoverable_errors: 'There are no failed errors to retry.',
  job_already_active: 'This error is already being processed.',
};

export function getApiErrorMessage(error, fallback) {
  const code = error?.response?.data?.error;
  return FRIENDLY_API_ERRORS[code]
    || error?.response?.data?.message
    || error?.message
    || fallback;
}

