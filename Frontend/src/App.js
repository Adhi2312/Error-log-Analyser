import './App.css';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  FaBug,
  FaCheckCircle,
  FaCloudUploadAlt,
  FaEye,
  FaFileAlt,
  FaRedo,
  FaTimes,
  FaTimesCircle,
} from 'react-icons/fa';
import {
  analyzeErrorDirect,
  getApiErrorMessage,
  getBatchSnapshot,
  getErrorAnalysis,
  previewLog,
  retryBatch,
  retryError,
  startBatchAnalysis,
} from './api';
import { isTerminalBatchStatus, monitorBatch } from './batchMonitor';
import { processDirectBatch } from './directBatch';

const LAST_DIRECT_UPLOAD_KEY = 'error-log-analyser:last-direct-upload';

function forgetDirectUpload(uploadId) {
  if (window.localStorage.getItem(LAST_DIRECT_UPLOAD_KEY) === String(uploadId)) {
    window.localStorage.removeItem(LAST_DIRECT_UPLOAD_KEY);
  }
}

const STATUS_STYLES = {
  pending: 'bg-slate-100 text-slate-600',
  queued: 'bg-blue-100 text-blue-700',
  processing: 'bg-amber-100 text-amber-700',
  retrying: 'bg-orange-100 text-orange-700',
  completed: 'bg-emerald-100 text-emerald-700',
  queue_failed: 'bg-red-100 text-red-700',
  failed: 'bg-red-100 text-red-700',
};

const STATUS_LABELS = {
  pending: 'Pending',
  queued: 'Queued',
  processing: 'Processing',
  retrying: 'Retrying',
  completed: 'Completed',
  queue_failed: 'Queue failed',
  failed: 'Failed',
};

const RETRYABLE_STATUSES = new Set(['pending', 'queue_failed', 'failed']);

function StatusBadge({ status }) {
  const working = ['queued', 'processing', 'retrying'].includes(status);
  return (
    <span className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold ${STATUS_STYLES[status] || STATUS_STYLES.pending}`}>
      {working && <span className="h-2 w-2 animate-pulse rounded-full bg-current" />}
      {status === 'completed' && <FaCheckCircle />}
      {(status === 'failed' || status === 'queue_failed') && <FaTimesCircle />}
      {STATUS_LABELS[status] || status}
    </span>
  );
}

function AnalysisModal({ analysis, loading, onClose }) {
  const details = analysis?.analysis_json || analysis?.analysis || analysis || {};
  const rows = [
    ['TYPE', details.type || details.issue_type || 'N/A', 'bg-blue-100 text-blue-700'],
    ['CAUSE', details.cause || details.root_cause || 'N/A', 'bg-red-100 text-red-700'],
    ['FIX', details.fix || details.suggested_fix || 'N/A', 'bg-emerald-100 text-emerald-700'],
  ];

  const closeButtonRef = useRef(null);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeButtonRef.current?.focus();

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4 backdrop-blur-sm"
      onMouseDown={onClose}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="analysis-title"
        className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-2xl border border-violet-200 bg-white shadow-2xl"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-200 bg-white/95 px-6 py-4 backdrop-blur">
          <div>
            <h3 id="analysis-title" className="font-semibold text-slate-900">AI analysis</h3>
            {!loading && (
              <p className="mt-1 text-xs text-slate-500">
                {analysis.source || 'llm'} · {analysis.model || details.model || 'model unavailable'}
              </p>
            )}
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            aria-label="Close analysis"
            onClick={onClose}
            className="rounded-lg p-2 text-slate-500 transition hover:bg-slate-100 hover:text-slate-800"
          >
            <FaTimes />
          </button>
        </header>

        {loading ? (
          <div className="flex items-center justify-center gap-3 p-16 text-sm text-slate-500">
            <span className="spinner spinner-dark" />Loading analysis...
          </div>
        ) : (
          <div className="bg-gradient-to-br from-violet-50 to-purple-50 p-6">
            <div className="mb-5 flex flex-wrap justify-end gap-2 text-xs font-semibold">
              <span className="rounded-lg bg-orange-100 px-3 py-2 text-orange-700">
                Severity: {details.severity || 'N/A'}
              </span>
              <span className="rounded-lg bg-cyan-100 px-3 py-2 text-cyan-700">
                Confidence: {details.confidence ?? 'N/A'}
              </span>
            </div>
            <div className="space-y-4">
              {rows.map(([label, value, colour]) => (
                <div key={label} className="grid gap-3 sm:grid-cols-[7rem_1fr]">
                  <span className={`h-fit rounded-lg px-3 py-2 text-center text-xs font-bold ${colour}`}>{label}</span>
                  <p className="py-1 text-sm leading-6 text-slate-700">{value}</p>
                </div>
              ))}
            </div>
            <details className="mt-5 border-t border-violet-200 pt-4">
              <summary className="cursor-pointer text-sm font-medium text-violet-700">View raw response</summary>
              <pre className="mt-3 overflow-x-auto rounded-xl bg-slate-900 p-4 text-xs text-slate-100">
                {JSON.stringify(details, null, 2)}
              </pre>
            </details>
          </div>
        )}
      </section>
    </div>
  );
}

function App() {
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [selectedPreviewIndex, setSelectedPreviewIndex] = useState(0);
  const [summary, setSummary] = useState(null);
  const [batchErrors, setBatchErrors] = useState([]);
  const [selectedErrorId, setSelectedErrorId] = useState(null);
  const [analysis, setAnalysis] = useState(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [startingBatch, setStartingBatch] = useState(false);
  const [polling, setPolling] = useState(false);
  const [loadingAnalysis, setLoadingAnalysis] = useState(false);
  const [retryingId, setRetryingId] = useState(null);
  const [retryingBatch, setRetryingBatch] = useState(false);
  const [message, setMessage] = useState(null);
  const monitorRef = useRef(null);
  const directRef = useRef(null);
  const analysisRequestRef = useRef(0);
  const runGenerationRef = useRef(0);

  const stopMonitoring = useCallback(() => {
    monitorRef.current?.abort();
    monitorRef.current = null;
  }, []);

  const stopDirect = useCallback(() => {
    directRef.current?.abort();
    directRef.current = null;
  }, []);

  useEffect(() => () => {
    stopMonitoring();
    stopDirect();
  }, [stopMonitoring, stopDirect]);

  const applySnapshot = useCallback((snapshot) => {
    setSummary(snapshot.summary);
    setBatchErrors(snapshot.errors);
    setSelectedErrorId((current) => {
      if (snapshot.errors.some((item) => item.id === current)) return current;
      return snapshot.errors.find((item) => item.status === 'completed')?.id
        || snapshot.errors[0]?.id
        || null;
    });
  }, []);

  const beginMonitoring = useCallback((uploadId) => {
    stopMonitoring();
    const controller = new AbortController();
    monitorRef.current = controller;
    setPolling(true);
    setMessage(null);

    monitorBatch({
      uploadId,
      getSnapshot: getBatchSnapshot,
      onSnapshot: applySnapshot,
      signal: controller.signal,
    }).then((result) => {
      if (controller.signal.aborted) return;
      if (result.reason === 'timeout') {
        setMessage({ type: 'warning', text: 'Automatic updates paused after 10 minutes. The worker may still be running; use Refresh status.' });
      }
    }).catch((error) => {
      if (!controller.signal.aborted) {
        setMessage({ type: 'error', text: getApiErrorMessage(error, 'Could not refresh batch progress.') });
      }
    }).finally(() => {
      if (monitorRef.current === controller) {
        monitorRef.current = null;
        setPolling(false);
      }
    });
  }, [applySnapshot, stopMonitoring]);

  const beginDirect = useCallback((uploadId, retryFailed = false) => {
    stopMonitoring();
    stopDirect();
    const controller = new AbortController();
    directRef.current = controller;
    window.localStorage.setItem(LAST_DIRECT_UPLOAD_KEY, String(uploadId));
    setPolling(true);
    setMessage(null);

    processDirectBatch({
      uploadId,
      getSnapshot: getBatchSnapshot,
      analyzeError: analyzeErrorDirect,
      onSnapshot: applySnapshot,
      retryFailed,
      signal: controller.signal,
    }).then((result) => {
      if (controller.signal.aborted) return;
      if (result.reason === 'settled' && isTerminalBatchStatus(result.snapshot.summary.status)) {
        forgetDirectUpload(uploadId);
      }
      if (result.reason === 'timeout') {
        setMessage({ type: 'warning', text: 'Automatic analysis paused after 10 minutes. Use Refresh status to continue unfinished errors.' });
      }
    }).catch((error) => {
      if (!controller.signal.aborted) {
        setMessage({ type: 'error', text: getApiErrorMessage(error, 'Could not continue analysis. Use Refresh status to resume.') });
      }
    }).finally(() => {
      if (directRef.current === controller) {
        directRef.current = null;
        setPolling(false);
      }
    });
  }, [applySnapshot, stopDirect, stopMonitoring]);

  useEffect(() => {
    const uploadId = Number(window.localStorage.getItem(LAST_DIRECT_UPLOAD_KEY));
    if (!Number.isSafeInteger(uploadId) || uploadId <= 0) {
      window.localStorage.removeItem(LAST_DIRECT_UPLOAD_KEY);
      return undefined;
    }
    let active = true;
    const generation = runGenerationRef.current;

    getBatchSnapshot(uploadId).then((snapshot) => {
      if (!active || generation !== runGenerationRef.current) return;
      if (snapshot.summary.processingMode !== 'direct'
        || isTerminalBatchStatus(snapshot.summary.status)) {
        forgetDirectUpload(uploadId);
        return;
      }
      applySnapshot(snapshot);
      beginDirect(uploadId);
    }).catch(() => {
      if (active) window.localStorage.removeItem(LAST_DIRECT_UPLOAD_KEY);
    });

    return () => { active = false; };
  }, [applySnapshot, beginDirect]);

  const resetRun = useCallback(() => {
    runGenerationRef.current += 1;
    stopMonitoring();
    stopDirect();
    window.localStorage.removeItem(LAST_DIRECT_UPLOAD_KEY);
    setPreview(null);
    setSummary(null);
    setBatchErrors([]);
    setSelectedErrorId(null);
    setAnalysis(null);
    setMessage(null);
    setPolling(false);
  }, [stopMonitoring, stopDirect]);

  const handleNewAnalysis = () => {
    setFile(null);
    setSelectedPreviewIndex(0);
    resetRun();
  };

  const handleFileChange = (event) => {
    const nextFile = event.target.files?.[0] || null;
    setFile(nextFile);
    setSelectedPreviewIndex(0);
    resetRun();
    event.target.value = '';
  };

  const removeFile = () => {
    setFile(null);
    setSelectedPreviewIndex(0);
    resetRun();
  };

  const handlePreview = async () => {
    if (!file) return;
    setLoadingPreview(true);
    setMessage(null);
    setSummary(null);
    setBatchErrors([]);
    setAnalysis(null);
    stopMonitoring();
    stopDirect();

    try {
      const result = await previewLog(file);
      setPreview(result);
      setSelectedPreviewIndex(0);
    } catch (error) {
      setMessage({ type: 'error', text: getApiErrorMessage(error, 'Could not preview this log.') });
    } finally {
      setLoadingPreview(false);
    }
  };

  const handleStartBatch = async () => {
    if (!file || !preview?.totalErrors) return;
    setStartingBatch(true);
    setMessage(null);
    setAnalysis(null);

    try {
      const result = await startBatchAnalysis(file);
      const direct = result.processingMode === 'direct';
      const initialErrors = (result.errors || []).map((item) => ({
        id: item.id,
        lineNumber: item.line_number,
        status: item.status,
        attemptCount: 0,
        hasAnalysis: false,
      }));
      setSummary({
        uploadId: result.uploadId,
        processingMode: result.processingMode || 'queue',
        filename: file.name,
        status: result.totalErrors ? 'processing' : 'no_errors',
        totalErrors: result.totalErrors,
        counts: {
          pending: direct ? result.totalErrors : 0,
          queued: direct ? 0 : result.queueSummary?.queued || 0,
          processing: 0,
          retrying: 0,
          completed: 0,
          queueFailed: result.queueSummary?.failed || 0,
          failed: 0,
        },
        progress: { finished: result.queueSummary?.failed || 0, percent: 0 },
        recoverableCount: direct ? result.totalErrors : result.queueSummary?.failed || 0,
      });
      setBatchErrors(initialErrors);
      setSelectedErrorId(initialErrors[0]?.id || null);
      if (direct) {
        beginDirect(result.uploadId);
      } else {
        beginMonitoring(result.uploadId);
      }
    } catch (error) {
      setMessage({ type: 'error', text: getApiErrorMessage(error, 'Could not start analysis.') });
    } finally {
      setStartingBatch(false);
    }
  };

  const refreshOnce = async () => {
    if (!summary?.uploadId) return;
    setMessage(null);
    try {
      const snapshot = await getBatchSnapshot(summary.uploadId);
      applySnapshot(snapshot);
      if (snapshot.summary.processingMode === 'direct') {
        if (isTerminalBatchStatus(snapshot.summary.status)) forgetDirectUpload(summary.uploadId);
        if (!isTerminalBatchStatus(snapshot.summary.status) && !directRef.current) {
          beginDirect(summary.uploadId);
        }
      } else if (!isTerminalBatchStatus(snapshot.summary.status)) {
        beginMonitoring(summary.uploadId);
      }
    } catch (error) {
      setMessage({ type: 'error', text: getApiErrorMessage(error, 'Could not refresh batch progress.') });
    }
  };

  const openAnalysis = async (errorId) => {
    const requestId = ++analysisRequestRef.current;
    setSelectedErrorId(errorId);
    setAnalysis(null);
    setLoadingAnalysis(true);
    setMessage(null);
    try {
      const result = await getErrorAnalysis(errorId);
      if (analysisRequestRef.current === requestId) setAnalysis(result);
    } catch (error) {
      if (analysisRequestRef.current === requestId) {
        setMessage({ type: 'error', text: getApiErrorMessage(error, 'Could not load this analysis.') });
      }
    } finally {
      if (analysisRequestRef.current === requestId) setLoadingAnalysis(false);
    }
  };

  const closeAnalysis = useCallback(() => {
    analysisRequestRef.current += 1;
    setLoadingAnalysis(false);
    setAnalysis(null);
  }, []);

  const handleRetryError = async (errorId) => {
    setRetryingId(errorId);
    setMessage(null);
    try {
      if (summary.processingMode === 'direct') {
        window.localStorage.setItem(LAST_DIRECT_UPLOAD_KEY, String(summary.uploadId));
        await analyzeErrorDirect(errorId);
      } else {
        await retryError(errorId);
        beginMonitoring(summary.uploadId);
      }
    } catch (error) {
      setMessage({ type: 'error', text: getApiErrorMessage(error, 'Could not retry this error.') });
    } finally {
      if (summary.processingMode === 'direct') {
        try {
          const snapshot = await getBatchSnapshot(summary.uploadId);
          applySnapshot(snapshot);
          if (isTerminalBatchStatus(snapshot.summary.status)) forgetDirectUpload(summary.uploadId);
        } catch {
          // Keep the analysis error visible; Refresh status can fetch the latest state.
        }
      }
      setRetryingId(null);
    }
  };

  const handleRetryBatch = async () => {
    setRetryingBatch(true);
    setMessage(null);
    try {
      if (summary.processingMode === 'direct') {
        beginDirect(summary.uploadId, true);
      } else {
        await retryBatch(summary.uploadId);
        beginMonitoring(summary.uploadId);
      }
    } catch (error) {
      setMessage({ type: 'error', text: getApiErrorMessage(error, 'Could not retry failed errors.') });
    } finally {
      setRetryingBatch(false);
    }
  };

  const previewByPosition = useMemo(() => preview?.errors || [], [preview]);
  const terminal = summary && isTerminalBatchStatus(summary.status);
  const isDirect = summary?.processingMode === 'direct';

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-violet-50">
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/85 backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl items-center gap-3 px-6 py-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-violet-600 to-purple-700 shadow-lg">
            <FaBug className="text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-900">Error Log Analyser</h1>
            <p className="text-xs text-slate-500">AI-powered batch error analysis</p>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-6 py-8">
        {message && (
          <div role="alert" className={`mb-6 rounded-xl border px-4 py-3 text-sm ${message.type === 'error' ? 'border-red-200 bg-red-50 text-red-700' : 'border-amber-200 bg-amber-50 text-amber-800'}`}>
            {message.text}
          </div>
        )}

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <aside className="lg:col-span-1">
            <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <h2 className="text-lg font-semibold text-slate-900">Upload log</h2>
              <p className="mb-6 mt-1 text-sm text-slate-500">Choose one LOG or TXT file. Every detected error will be analysed.</p>

              <label htmlFor="file-upload" className="flex h-40 w-full cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-slate-300 transition hover:border-violet-400 hover:bg-violet-50/50">
                <FaCloudUploadAlt size={32} className="mb-3 text-violet-500" />
                <span className="text-sm font-medium text-slate-700">Choose a log file</span>
                <span className="mt-1 text-xs text-slate-400">LOG or TXT</span>
                <input id="file-upload" type="file" className="hidden" accept=".log,.txt,text/plain" onChange={handleFileChange} />
              </label>

              {file && (
                <div className="mt-4 flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-violet-100"><FaFileAlt className="text-violet-600" /></div>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-slate-700">{file.name}</p>
                      <p className="text-xs text-slate-400">{(file.size / 1024).toFixed(1)} KB</p>
                    </div>
                  </div>
                  <button aria-label="Remove file" onClick={removeFile} className="p-2 text-slate-400 transition hover:text-red-500"><FaTimes /></button>
                </div>
              )}

              <button onClick={handlePreview} disabled={!file || loadingPreview || startingBatch} className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-slate-100 py-3 font-medium text-slate-700 transition hover:bg-slate-200 disabled:cursor-not-allowed disabled:opacity-50">
                {loadingPreview ? <><span className="spinner" />Reading log...</> : <><FaEye />Preview errors</>}
              </button>
              <button onClick={handleStartBatch} disabled={!preview?.totalErrors || startingBatch || polling} className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-violet-600 to-purple-600 py-3 font-semibold text-white shadow-lg shadow-violet-200 transition hover:from-violet-700 hover:to-purple-700 disabled:cursor-not-allowed disabled:opacity-50">
                {startingBatch ? <><span className="spinner" />Starting...</> : <><FaCheckCircle />Analyse all errors</>}
              </button>
            </div>

            <div className="mt-6 rounded-2xl border border-violet-100 bg-violet-50 p-5">
              <h3 className="mb-2 font-semibold text-violet-900">How it works</h3>
              <ol className="space-y-2 text-sm text-violet-800">
                <li><strong>1.</strong> Preview detected errors</li>
                <li><strong>2.</strong> Start analysis for every error</li>
                <li><strong>3.</strong> Watch batch progress</li>
                <li><strong>4.</strong> Open results or retry failures</li>
              </ol>
            </div>
          </aside>

          <section className="lg:col-span-2">
            <div className="min-h-[650px] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-6 py-4">
                <div>
                  <h2 className="text-lg font-semibold text-slate-900">{summary ? 'Batch progress' : 'Detected errors'}</h2>
                  <p className="mt-1 text-xs text-slate-500">{summary ? 'Each error is analysed independently.' : 'Preview the log before starting analysis.'}</p>
                </div>
                {summary && (
                  <div className="flex items-center gap-2">
                    {polling && <span className="text-xs font-medium text-amber-600">Updating...</span>}
                    <button onClick={refreshOnce} className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-violet-700 transition hover:bg-violet-50"><FaRedo />Refresh status</button>
                    <button onClick={handleNewAnalysis} className="rounded-lg px-3 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-100">New analysis</button>
                  </div>
                )}
              </div>

              <div className="p-6">
                {!summary && !preview && !loadingPreview && (
                  <div className="flex flex-col items-center justify-center py-24 text-center">
                    <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-slate-100"><FaFileAlt size={26} className="text-slate-400" /></div>
                    <h3 className="font-semibold text-slate-700">No preview yet</h3>
                    <p className="mt-1 max-w-sm text-sm text-slate-400">Choose a log file, then preview it to see the errors that will be analysed.</p>
                  </div>
                )}

                {loadingPreview && <div className="flex items-center justify-center gap-3 py-24 text-slate-500"><span className="spinner spinner-dark" />Detecting errors...</div>}

                {!summary && preview && (
                  <div>
                    <div className="mb-5 flex items-center justify-between">
                      <div>
                        <h3 className="font-semibold text-slate-800">Preview</h3>
                        <p className="mt-1 text-xs text-slate-500">The analyser will process all of these errors.</p>
                      </div>
                      <span className="rounded-full bg-violet-100 px-3 py-1.5 text-xs font-semibold text-violet-700">{preview.totalErrors} {preview.totalErrors === 1 ? 'error' : 'errors'}</span>
                    </div>
                    {preview.totalErrors === 0 ? (
                      <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-5 text-sm text-emerald-700">No errors were detected in this log.</div>
                    ) : (
                      <div className="space-y-3">
                        {preview.errors.map((item, index) => (
                          <button key={`${item.line_number}-${index}`} onClick={() => setSelectedPreviewIndex(index)} className={`w-full rounded-xl border-2 p-4 text-left transition ${selectedPreviewIndex === index ? 'border-violet-500 bg-violet-50 shadow-sm' : 'border-slate-200 hover:border-slate-300'}`}>
                            <div className="mb-2 flex items-center justify-between">
                              <span className="text-xs font-semibold text-slate-500">Error #{index + 1} · Line {item.line_number}</span>
                              {selectedPreviewIndex === index && <span className="text-xs font-semibold text-violet-600">Selected for preview</span>}
                            </div>
                            <pre className="whitespace-pre-wrap break-words rounded-lg bg-slate-50 p-3 font-mono text-sm text-slate-700">{item.redacted_text}</pre>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {summary && (
                  <div>
                    <div className="mb-6 rounded-2xl border border-slate-200 bg-slate-50 p-5">
                      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <p className="font-semibold text-slate-800">{summary.filename}</p>
                          <p className="mt-1 text-xs text-slate-500">{summary.progress?.finished || 0} of {summary.totalErrors} finished</p>
                        </div>
                        <span className={`rounded-full px-3 py-1.5 text-xs font-semibold ${summary.status === 'completed' ? 'bg-emerald-100 text-emerald-700' : summary.status === 'completed_with_failures' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'}`}>
                          {summary.status === 'completed_with_failures' ? 'Completed with failures' : summary.status === 'completed' ? 'Completed' : summary.status === 'no_errors' ? 'No errors' : 'Processing'}
                        </span>
                      </div>
                      <div className="h-2 overflow-hidden rounded-full bg-slate-200"><div className="h-full rounded-full bg-gradient-to-r from-violet-500 to-purple-600 transition-all" style={{ width: `${summary.progress?.percent || 0}%` }} /></div>
                      <div className="mt-3 flex flex-wrap gap-4 text-xs text-slate-600">
                        <span>Completed: <strong>{summary.counts?.completed || 0}</strong></span>
                        <span>Active: <strong>{(summary.counts?.queued || 0) + (summary.counts?.processing || 0) + (summary.counts?.retrying || 0) + (summary.counts?.pending || 0)}</strong></span>
                        <span>Failed: <strong>{(summary.counts?.failed || 0) + (summary.counts?.queueFailed || 0)}</strong></span>
                      </div>
                      {isDirect && !terminal && <p className="mt-3 text-xs text-slate-500">Keep this page open while analysis runs. If interrupted, reopen it to resume unfinished errors.</p>}
                      {terminal && summary.recoverableCount > 0 && (
                        <button onClick={handleRetryBatch} disabled={retryingBatch || (isDirect && polling)} className="mt-4 flex items-center gap-2 rounded-lg bg-red-100 px-3 py-2 text-sm font-semibold text-red-700 transition hover:bg-red-200 disabled:opacity-50"><FaRedo />{retryingBatch ? 'Retrying...' : `Retry all failed (${summary.recoverableCount})`}</button>
                      )}
                    </div>

                    <div className="space-y-3">
                      {batchErrors.map((item, index) => {
                        const previewItem = previewByPosition[index];
                        return (
                          <div key={item.id} className={`rounded-xl border-2 p-4 transition ${selectedErrorId === item.id ? 'border-violet-400 bg-violet-50/40' : 'border-slate-200'}`}>
                            <div className="flex flex-wrap items-center justify-between gap-3">
                              <button onClick={() => { setSelectedErrorId(item.id); setAnalysis(null); }} className="min-w-0 text-left">
                                <p className="text-sm font-semibold text-slate-800">Error #{index + 1} <span className="font-normal text-slate-400">· Line {item.lineNumber}</span></p>
                                {previewItem && <p className="mt-1 max-w-xl truncate font-mono text-xs text-slate-500">{previewItem.redacted_text}</p>}
                                {item.failureReason && <p className="mt-1 text-xs text-red-600">{item.failureReason}</p>}
                              </button>
                              <div className="flex items-center gap-2">
                                <StatusBadge status={item.status} />
                                {item.status === 'completed' && item.hasAnalysis && <button onClick={() => openAnalysis(item.id)} className="rounded-lg bg-violet-600 px-3 py-2 text-xs font-semibold text-white hover:bg-violet-700">View analysis</button>}
                                {(isDirect ? ['failed', 'queue_failed'].includes(item.status) : RETRYABLE_STATUSES.has(item.status)) && <button onClick={() => handleRetryError(item.id)} disabled={retryingId === item.id || (isDirect && polling)} className="rounded-lg bg-red-100 px-3 py-2 text-xs font-semibold text-red-700 hover:bg-red-200 disabled:opacity-50">{retryingId === item.id ? 'Retrying...' : 'Retry'}</button>}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>

                  </div>
                )}
              </div>
            </div>
          </section>
        </div>
      </main>
      {(loadingAnalysis || analysis) && (
        <AnalysisModal
          analysis={analysis}
          loading={loadingAnalysis}
          onClose={closeAnalysis}
        />
      )}
    </div>
  );
}

export default App;
