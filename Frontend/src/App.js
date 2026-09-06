// App.jsx
import './App.css';
import { useState, useCallback, useEffect, useRef } from 'react';

import axios from 'axios';
import {
  FaUpload,
  FaTrash,
  FaBug,
  FaCloudUploadAlt,
  FaFileAlt,
  FaEye,
  FaTimes,
  FaTimesCircle,
  FaCheckCircle,
 
  FaRegImage,
} from "react-icons/fa";

// For Render backend:
axios.defaults.baseURL = 'http://localhost:3000'; // Change this to your backend URL if needed
// For local testing, you can temporarily use:
// axios.defaults.baseURL = 'http://localhost:3000';

function App() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-50">
      <Home />
    </div>
  );
}

const Home = () => {
  const [files, setFiles] = useState([]);
  const [isDragging, setIsDragging] = useState(false);
  const [preview, setPreview] = useState(null);
  const [selectedErrorIndex, setSelectedErrorIndex] = useState(null);
  const [analysis, setAnalysis] = useState(null);
  const [analyses, setAnalyses] = useState({});
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [loadingAnalyse, setLoadingAnalyse] = useState(false);
  const [processingErrors, setProcessingErrors] = useState({});
const [workspaceMode, setWorkspaceMode] = useState("preview");

  const fileInputRef = useRef(null);
  const filesRef = useRef([]);

  const prepareFilePreview = async (file) => {
    const fileObj = { file, name: file.name, size: file.size };

    if (file.type?.startsWith('image/')) {
      fileObj.kind = 'image';
      fileObj.preview = URL.createObjectURL(file);
      return fileObj;
    }

    if (file.type?.startsWith('text/') || /\.(md|txt|json|csv|log|xml)$/i.test(file.name)) {
      fileObj.kind = 'text';
      try {
        const text = await file.text();
        fileObj.text = text;
      } catch {
        fileObj.text = 'Could not read file as text.';
      }
      return fileObj;
    }

    fileObj.kind = 'other';
    return fileObj;
  };

  const traverseFileTree = (entry, path = '') =>
    new Promise((resolve) => {
      if (entry.isFile) {
        entry.file(
          (file) => {
            file.fullPath = path + file.name;
            resolve([file]);
          },
          () => resolve([]),
        );
      } else if (entry.isDirectory) {
        const reader = entry.createReader();
        const entries = [];
        const readEntries = () => {
          reader.readEntries(async (results) => {
            if (!results.length) {
              const promises = entries.map((e) => traverseFileTree(e, path + entry.name + '/'));
              const nested = await Promise.all(promises);
              resolve(nested.flat());
            } else {
              entries.push(...results);
              readEntries();
            }
          });
        };
        readEntries();
      } else {
        resolve([]);
      }
    });

  const getFilesFromDataTransferItems = async (items) => {
    const supportsEntry =
      typeof items?.[0]?.webkitGetAsEntry === 'function' ||
      typeof items?.[0]?.getAsEntry === 'function';

    if (supportsEntry) {
      const entryPromises = [];
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const getEntry = item.webkitGetAsEntry || item.getAsEntry;
        if (!getEntry) continue;
        const entry = getEntry.call(item);
        if (entry) entryPromises.push(traverseFileTree(entry));
      }
      const nested = await Promise.all(entryPromises);
      const files = nested.flat();
      return files.filter(Boolean);
    }

    const fallbackFiles = [];
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (it.kind === 'file') {
        const file = it.getAsFile ? it.getAsFile() : null;
        if (file) fallbackFiles.push(file);
      }
    }
    return fallbackFiles;
  };

  const processFiles = useCallback(
    async (fileList) => {
      if (!fileList || fileList.length === 0) return;
      const arr = Array.from(fileList);
      const prepared = await Promise.all(arr.map((f) => prepareFilePreview(f)));
      setFiles((prev) => [...prev, ...prepared]);
    },
    [setFiles],
  );

  const handleDrop = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    const dt = e.dataTransfer;
    if (dt && dt.items && dt.items.length) {
      try {
        const filesFromItems = await getFilesFromDataTransferItems(dt.items);
        if (filesFromItems && filesFromItems.length) {
          await processFiles(filesFromItems);
          return;
        }
      } catch {
        // fallback
      }
    }

    if (dt && dt.files && dt.files.length) {
      await processFiles(dt.files);
    }
  };

  const handleFileSelect = async (e) => {
    const inputEl = (e && (e.currentTarget || e.target)) || fileInputRef.current;
    if (!inputEl) return;

    const fileList = inputEl.files;
    if (!fileList || fileList.length === 0) return;

    await processFiles(fileList);

    try {
      inputEl.value = '';
    } catch (err) {
      console.debug('Could not clear file input value', err);
    }
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  };
  const handleDragEnter = (e) => {
    e.preventDefault();
    setIsDragging(true);
  };
  const handleDragLeave = (e) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const clearAll = () => {
    files.forEach((f) => {
      if (f.preview) URL.revokeObjectURL(f.preview);
    });
    setFiles([]);
    setPreview(null);
    setSelectedErrorIndex(null);
    setAnalysis(null);
  };

  useEffect(() => {
    filesRef.current = files;
  }, [files]);

  useEffect(() => {
    return () => {
      filesRef.current.forEach((f) => {
        if (f.preview) URL.revokeObjectURL(f.preview);
      });
    };
  }, []);

  const removeFile = (index) => {
    setFiles((prev) => {
      const copy = [...prev];
      const removed = copy.splice(index, 1)[0];
      if (removed?.preview) URL.revokeObjectURL(removed.preview);
      return copy;
    });
  };
const uploadFileForAnalysis = async () => {
  const formData = new FormData();

  formData.append("file", files[0]);

  const res = await axios.post(
    "http://localhost:3000/upload",
    formData
  );

  console.log("Upload response:", res.data);

  return res.data;
};

  /**
   * PREVIEW:
   * - Read text in browser (already in f.text)
   * - Send JSON { filename, text } to /preview
   * - No multipart/form-data
   */
  const Preview = async () => {
    if (!files.length) {
      alert('No file selected for preview.');
      return;
    }

    const target = files[0];

    if (target.kind !== 'text') {
      alert('Preview currently supports only text / log files.');
      return;
    }
    if (!target.text) {
      alert('Could not read file content.');
      return;
    }

    setPreview(null);
    setSelectedErrorIndex(null);
    setAnalysis(null);
    setLoadingPreview(true);

    try {
      const res = await axios.post('/preview', {
        filename: target.name,
        text: target.text,
      });

      // expected: { totalErrors, errors: [{ line_number, raw_text, redacted_text }, ...] }
      setPreview(res.data);
      if (res.data?.errors && res.data.errors.length) setSelectedErrorIndex(0);
    } catch (err) {
      console.error(err);
      alert('Error generating preview. See console for details.');
    } finally {
      setLoadingPreview(false);
    }
  };
const pollAnalysis = async (errorId) => {
  while (true) {
    try {
      console.log("Calling analysis API:", errorId);

      const res = await axios.get(
        `/api/errors/${errorId}/analysis`
      );

      console.log(
        `Analysis ready for error ${errorId}:`,
        res.data
      );

      return res.data;

    } catch (err) {
      if (err.response?.status === 404) {
        await new Promise((resolve) =>
          setTimeout(resolve, 2000)
        );

        continue;
      }

      throw err;
    }
  }
};


const AnalyseSelected = async () => {
  if (!files.length) {
    alert("No file selected.");
    return;
  }

  setLoadingAnalyse(true);
  setAnalysis(null);
  setAnalyses({});
  setProcessingErrors({});
  setWorkspaceMode("processing");

  try {

    // Upload file to worker pipeline
    const formData = new FormData();

    formData.append("file", files[0].file);

    const uploadRes = await axios.post(
      "/upload",
      formData
    );

    console.log("Upload result:", uploadRes.data);

    const errors = uploadRes.data.errors || [];

    if (!errors.length) {
      alert("No errors found.");
      setWorkspaceMode("preview");
      return;
    }

    // Mark all errors as processing
    const initialStatus = {};

    errors.forEach((error) => {
      initialStatus[error.id] = "processing";
    });

    setProcessingErrors(initialStatus);


    // Start polling every error independently
    errors.forEach(async (error) => {

      try {

        const result = await pollAnalysis(error.id);

        // Save result
        setAnalyses((prev) => ({
          ...prev,
          [error.id]: result
        }));

        // Mark complete
        setProcessingErrors((prev) => ({
          ...prev,
          [error.id]: "complete"
        }));

        // Show result in workspace
        setAnalysis(result);
        setWorkspaceMode("result");

      } catch (err) {

        console.error(
          `Failed processing error ${error.id}:`,
          err
        );

        setProcessingErrors((prev) => ({
          ...prev,
          [error.id]: "failed"
        }));

      }

    });

  } catch (err) {

    console.error("Upload/analysis error:", err);

    alert("Error starting analysis.");

    setWorkspaceMode("preview");

  } finally {

    setLoadingAnalyse(false);

  }
};
return (
  <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-violet-50">

    {/* ================= HEADER ================= */}
    <header className="sticky top-0 z-20 bg-white/80 backdrop-blur-md border-b border-slate-200">
      <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">

        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-600 to-purple-700 flex items-center justify-center shadow-lg">
            <FaBug className="text-white" />
          </div>

          <div>
            <h1 className="text-xl font-bold text-slate-900">
              Error Log Analyser
            </h1>

            <p className="text-xs text-slate-500">
              AI-powered error analysis
            </p>
          </div>
        </div>

      </div>
    </header>


    {/* ================= MAIN ================= */}
    <main className="max-w-7xl mx-auto px-6 py-8">

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

        {/* ================================================= */}
        {/* LEFT SIDE - UPLOAD */}
        {/* ================================================= */}

        <div className="lg:col-span-1">

          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">

            <h2 className="text-lg font-semibold text-slate-900 mb-1">
              Upload Logs
            </h2>

            <p className="text-sm text-slate-500 mb-6">
              Upload your application log file to analyse errors.
            </p>


            {/* FILE INPUT */}
            <label
              htmlFor="file-upload"
              className="flex flex-col items-center justify-center w-full h-40 border-2 border-dashed border-slate-300 rounded-xl cursor-pointer hover:border-violet-400 hover:bg-violet-50/50 transition"
            >

              <FaCloudUploadAlt
                size={32}
                className="text-violet-500 mb-3"
              />

              <span className="text-sm font-medium text-slate-700">
                Click to upload
              </span>

              <span className="text-xs text-slate-400 mt-1">
                LOG, TXT files
              </span>

              <input
                id="file-upload"
                type="file"
                className="hidden"
                accept=".log,.txt"
                onChange={handleFileSelect}
              />

            </label>


            {/* SELECTED FILE */}
            {files.length > 0 && (

              <div className="mt-4 p-3 bg-slate-50 rounded-xl border border-slate-200">

                {files.map((file, index) => (

                  <div
                    key={index}
                    className="flex items-center justify-between"
                  >

                    <div className="flex items-center gap-3 min-w-0">

                      <div className="w-9 h-9 rounded-lg bg-violet-100 flex items-center justify-center flex-shrink-0">
                        <FaFileAlt className="text-violet-600" />
                      </div>

                      <div className="min-w-0">

                        <p className="text-sm font-medium text-slate-700 truncate">
                          {file.name}
                        </p>

                        <p className="text-xs text-slate-400">
                          {(file.size / 1024).toFixed(1)} KB
                        </p>

                      </div>

                    </div>


                    <button
                      onClick={() => removeFile(index)}
                      className="p-2 text-slate-400 hover:text-red-500 transition"
                    >
                      <FaTimes />
                    </button>

                  </div>

                ))}

              </div>

            )}


            {/* PREVIEW BUTTON */}
            <button
              onClick={Preview}
              disabled={!files.length || loadingPreview}
              className="w-full mt-4 py-3 rounded-xl bg-slate-100 text-slate-700 font-medium hover:bg-slate-200 disabled:opacity-50 disabled:cursor-not-allowed transition flex items-center justify-center gap-2"
            >

              {loadingPreview ? (
                <>
                  <span className="animate-spin">⏳</span>
                  Generating Preview...
                </>
              ) : (
                <>
                  <FaEye />
                  Preview
                </>
              )}

            </button>


            {/* ANALYSE BUTTON */}
            <button
              onClick={AnalyseSelected}
              disabled={
                !preview ||
                !preview.errors ||
                selectedErrorIndex === null ||
                loadingAnalyse
              }
              className="w-full mt-3 py-3 rounded-xl bg-gradient-to-r from-violet-600 to-purple-600 text-white font-semibold hover:from-violet-700 hover:to-purple-700 disabled:opacity-50 disabled:cursor-not-allowed transition flex items-center justify-center gap-2 shadow-lg shadow-violet-200"
            >

              {loadingAnalyse ? (
                <>
                  <span className="animate-spin">⏳</span>
                  Starting Analysis...
                </>
              ) : (
                <>
                  <FaCheckCircle />
                  Analyse Selected Error
                </>
              )}

            </button>

          </div>


          {/* INFO CARD */}
          <div className="mt-6 bg-violet-50 border border-violet-100 rounded-2xl p-5">

            <h3 className="font-semibold text-violet-900 mb-2">
              How it works
            </h3>

            <ol className="text-sm text-violet-800 space-y-2">

              <li>
                <span className="font-semibold">1.</span>{" "}
                Upload your log file
              </li>

              <li>
                <span className="font-semibold">2.</span>{" "}
                Preview detected errors
              </li>

              <li>
                <span className="font-semibold">3.</span>{" "}
                Select an error
              </li>

              <li>
                <span className="font-semibold">4.</span>{" "}
                Analyse using the background worker
              </li>

              <li>
                <span className="font-semibold">5.</span>{" "}
                View the AI-generated result
              </li>

            </ol>

          </div>

        </div>


        {/* ================================================= */}
        {/* RIGHT SIDE - SINGLE WORKSPACE */}
        {/* ================================================= */}

        <div className="lg:col-span-2">

          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden h-full min-h-[650px]">

            {/* WORKSPACE HEADER */}
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">

              <div>

                <h2 className="text-lg font-semibold text-slate-900">
                  Preview & Analysis
                </h2>

                <p className="text-xs text-slate-500 mt-1">

                  {workspaceMode === "preview" &&
                    "Review detected errors before analysis."}

                  {workspaceMode === "processing" &&
                    "Errors are being processed in the background."}

                  {workspaceMode === "result" &&
                    "AI analysis result."}

                </p>

              </div>


              {/* MODE INDICATOR */}
              <div>

                {workspaceMode === "preview" && (
                  <span className="px-3 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-700">
                    Preview
                  </span>
                )}

                {workspaceMode === "processing" && (
                  <span className="px-3 py-1 rounded-full text-xs font-medium bg-orange-100 text-orange-700">
                    Processing
                  </span>
                )}

                {workspaceMode === "result" && (
                  <span className="px-3 py-1 rounded-full text-xs font-medium bg-green-100 text-green-700">
                    Complete
                  </span>
                )}

              </div>

            </div>


            {/* ================================================= */}
            {/* WORKSPACE CONTENT */}
            {/* ================================================= */}

            <div className="h-[calc(100%-80px)] overflow-y-auto p-6">


              {/* ================================================= */}
              {/* PREVIEW MODE */}
              {/* ================================================= */}

              {workspaceMode === "preview" && (

                <div>

                  {loadingPreview && (

                    <div className="flex flex-col items-center justify-center py-24">

                      <div className="w-12 h-12 border-4 border-violet-200 border-t-violet-600 rounded-full animate-spin mb-4" />

                      <p className="text-sm font-medium text-slate-700">
                        Analysing log file...
                      </p>

                      <p className="text-xs text-slate-400 mt-1">
                        Detecting errors
                      </p>

                    </div>

                  )}


                  {!loadingPreview && !preview && (

                    <div className="flex flex-col items-center justify-center py-24 text-center">

                      <div className="w-16 h-16 rounded-2xl bg-slate-100 flex items-center justify-center mb-4">

                        <FaRegImage
                          size={28}
                          className="text-slate-400"
                        />

                      </div>

                      <h3 className="font-semibold text-slate-700">
                        No preview available
                      </h3>

                      <p className="text-sm text-slate-400 mt-1 max-w-sm">
                        Upload a log file and click Preview to
                        detect errors.
                      </p>

                    </div>

                  )}


                  {!loadingPreview && preview && (

                    <div>

                      {/* SUMMARY */}
                      <div className="flex items-center justify-between mb-5">

                        <div>

                          <h3 className="font-semibold text-slate-800">
                            Detected Errors
                          </h3>

                          <p className="text-xs text-slate-500 mt-1">
                            Select an error to analyse.
                          </p>

                        </div>


                        <span className="px-3 py-1.5 bg-violet-100 text-violet-700 rounded-full text-xs font-semibold">

                          {preview.totalErrors}{" "}

                          {preview.totalErrors === 1
                            ? "error"
                            : "errors"}

                        </span>

                      </div>


                      {/* ERRORS */}
                      <div className="space-y-3">

                        {preview.errors.map((e, i) => (

                          <div
                            key={i}
                            onClick={() =>
                              setSelectedErrorIndex(i)
                            }
                            className={`p-4 rounded-xl border-2 cursor-pointer transition-all ${
                              selectedErrorIndex === i
                                ? "border-violet-500 bg-violet-50 shadow-md"
                                : "border-slate-200 bg-white hover:border-slate-300 hover:shadow-sm"
                            }`}
                          >

                            <div className="flex items-center justify-between mb-2">

                              <div className="flex items-center gap-2">

                                <span className="px-2 py-1 bg-slate-100 text-slate-600 rounded text-xs font-semibold">
                                  #{i + 1}
                                </span>

                                <span className="text-xs font-medium text-slate-500">
                                  Line {e.line_number}
                                </span>

                              </div>


                              {selectedErrorIndex === i && (

                                <span className="text-xs font-semibold text-violet-600">
                                  Selected
                                </span>

                              )}

                            </div>


                            <pre className="whitespace-pre-wrap break-words text-sm text-slate-700 font-mono bg-slate-50 rounded-lg p-3">
                              {e.redacted_text ||
                                e.raw_text}
                            </pre>

                          </div>

                        ))}

                      </div>


                      {/* SELECTED ERROR */}
                      {selectedErrorIndex !== null && (

                        <div className="mt-5 p-4 bg-violet-50 border border-violet-200 rounded-xl">

                          <p className="text-sm text-violet-800">

                            <strong>
                              Error #{selectedErrorIndex + 1}
                            </strong>{" "}
                            is selected.

                            <br />

                            Click{" "}
                            <strong>
                              Analyse Selected Error
                            </strong>{" "}
                            to start background processing.

                          </p>

                        </div>

                      )}

                    </div>

                  )}

                </div>

              )}


              {/* ================================================= */}
              {/* PROCESSING MODE */}
              {/* ================================================= */}

              {workspaceMode === "processing" && (

                <div>

                  {/* PROCESSING HEADER */}
                  <div className="text-center mb-8">

                    <div className="w-16 h-16 mx-auto rounded-2xl bg-orange-100 flex items-center justify-center mb-4">

                      <span className="text-3xl animate-pulse">
                        ⚙️
                      </span>

                    </div>

                    <h3 className="text-lg font-semibold text-slate-800">
                      Processing Errors
                    </h3>

                    <p className="text-sm text-slate-500 mt-1">
                      Your errors are being analysed by the
                      background worker.
                    </p>

                  </div>


                  {/* PROCESSING LIST */}
                  <div className="space-y-3">

                    {Object.entries(processingErrors).map(
                      ([errorId, status]) => (

                        <div
                          key={errorId}
                          className="flex items-center justify-between p-4 rounded-xl border border-slate-200 bg-white"
                        >

                          <div className="flex items-center gap-3">

                            <div className="w-9 h-9 rounded-lg bg-slate-100 flex items-center justify-center">

                              <FaBug className="text-slate-500" />

                            </div>

                            <div>

                              <p className="text-sm font-semibold text-slate-700">
                                Error #{errorId}
                              </p>

                              <p className="text-xs text-slate-400">
                                Background job
                              </p>

                            </div>

                          </div>


                          {/* STATUS */}
                          {status === "processing" && (

                            <div className="flex items-center gap-2 text-orange-600">

                              <span className="w-4 h-4 border-2 border-orange-200 border-t-orange-600 rounded-full animate-spin" />

                              <span className="text-sm font-medium">
                                Processing...
                              </span>

                            </div>

                          )}


                          {status === "complete" && (

                            <div className="flex items-center gap-2 text-green-600">

                              <FaCheckCircle />

                              <span className="text-sm font-medium">
                                Complete
                              </span>

                            </div>

                          )}


                          {status === "failed" && (

                            <div className="flex items-center gap-2 text-red-600">

                              <FaTimesCircle />

                              <span className="text-sm font-medium">
                                Failed
                              </span>

                            </div>

                          )}

                        </div>

                      )
                    )}

                  </div>

                </div>

              )}


              {/* ================================================= */}
              {/* RESULT MODE */}
              {/* ================================================= */}

              {workspaceMode === "result" && analysis && (

                <div>

                  {/* RESULT HEADER */}
                  <div className="flex items-center justify-between mb-6">

                    <div>

                      <h3 className="text-lg font-semibold text-slate-800">
                        Analysis Result
                      </h3>

                      <p className="text-xs text-slate-500 mt-1">
                        AI analysis completed successfully.
                      </p>

                    </div>


                    <button
                      onClick={() =>
                        setWorkspaceMode("processing")
                      }
                      className="px-3 py-2 text-sm font-medium text-violet-600 hover:bg-violet-50 rounded-lg transition"
                    >
                      ← Back to Errors
                    </button>

                  </div>


                  {/* RESULT CARD */}
                  <div className="bg-gradient-to-br from-violet-50 to-purple-50 rounded-2xl p-6 border border-violet-200">

                    <div className="space-y-4">


                      {/* SOURCE */}
                      <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 items-start">

                        <div className="text-xs font-bold text-violet-700 bg-violet-200/80 px-3 py-2 rounded-lg text-center">
                          SOURCE
                        </div>

                        <div className="sm:col-span-3 text-sm text-slate-800 font-medium py-2">

                          {analysis.source ||
                            analysis.analysis?.source ||
                            "N/A"}

                        </div>

                      </div>


                      {/* MODEL */}
                      <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 items-start">

                        <div className="text-xs font-bold text-purple-700 bg-purple-200/80 px-3 py-2 rounded-lg text-center">
                          MODEL
                        </div>

                        <div className="sm:col-span-3 text-sm text-slate-800 font-medium py-2">

                          {analysis.model ||
                            analysis.analysis?.model ||
                            "N/A"}

                        </div>

                      </div>


                      {/* TYPE */}
                      <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 items-start">

                        <div className="text-xs font-bold text-blue-700 bg-blue-200/80 px-3 py-2 rounded-lg text-center">
                          TYPE
                        </div>

                        <div className="sm:col-span-3 text-sm text-slate-800 font-medium py-2">

                          {analysis.analysis_json?.type ||
                            analysis.analysis_json?.issue_type ||
                            analysis.analysis?.type ||
                            analysis.analysis?.issue_type ||
                            "N/A"}

                        </div>

                      </div>


                      {/* CAUSE */}
                      <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 items-start">

                        <div className="text-xs font-bold text-red-700 bg-red-200/80 px-3 py-2 rounded-lg text-center">
                          CAUSE
                        </div>

                        <div className="sm:col-span-3 text-sm text-slate-800 py-2 leading-relaxed">

                          {analysis.analysis_json?.cause ||
                            analysis.analysis_json?.root_cause ||
                            analysis.analysis?.cause ||
                            analysis.analysis?.root_cause ||
                            "N/A"}

                        </div>

                      </div>


                      {/* FIX */}
                      <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 items-start">

                        <div className="text-xs font-bold text-green-700 bg-green-200/80 px-3 py-2 rounded-lg text-center">
                          FIX
                        </div>

                        <div className="sm:col-span-3 text-sm text-slate-800 py-2 leading-relaxed">

                          {analysis.analysis_json?.fix ||
                            analysis.analysis_json?.suggested_fix ||
                            analysis.analysis?.fix ||
                            analysis.analysis?.suggested_fix ||
                            "N/A"}

                        </div>

                      </div>


                      {/* SEVERITY + CONFIDENCE */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-4 border-t border-violet-200">

                        {/* SEVERITY */}
                        <div className="flex items-center gap-3">

                          <span className="text-xs font-bold text-orange-700 bg-orange-200/80 px-3 py-2 rounded-lg">
                            SEVERITY
                          </span>

                          <span className="text-sm font-semibold text-slate-800">

                            {analysis.analysis_json?.severity ||
                              analysis.analysis?.severity ||
                              "N/A"}

                          </span>

                        </div>


                        {/* CONFIDENCE */}
                        <div className="flex items-center gap-3">

                          <span className="text-xs font-bold text-cyan-700 bg-cyan-200/80 px-3 py-2 rounded-lg">
                            CONFIDENCE
                          </span>

                          <span className="text-sm font-semibold text-slate-800">

                            {analysis.analysis_json?.confidence ??
                              analysis.analysis?.confidence ??
                              "N/A"}

                          </span>

                        </div>

                      </div>

                    </div>

                  </div>


                  {/* VIEW RAW JSON */}
                  <details className="mt-5">

                    <summary className="cursor-pointer text-sm font-medium text-slate-600 hover:text-violet-600">
                      View raw analysis response
                    </summary>

                    <pre className="mt-3 p-4 bg-slate-900 text-slate-100 rounded-xl text-xs overflow-x-auto">
                      {JSON.stringify(
                        analysis.analysis_json ||
                          analysis.analysis ||
                          analysis,
                        null,
                        2
                      )}
                    </pre>

                  </details>

                </div>

              )}

            </div>

          </div>

        </div>

      </div>

    </main>

  </div>
);

}

export default App;


